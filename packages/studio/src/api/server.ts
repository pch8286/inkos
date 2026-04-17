import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import {
  StateManager,
  PipelineRunner,
  Scheduler,
  createLLMClient,
  createLogger,
  computeAnalytics,
  loadProjectConfig,
  GLOBAL_ENV_PATH,
  type PipelineConfig,
  type ProjectConfig,
  type LogSink,
  type LogEntry
} from "@actalk/inkos-core";
import { access, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { basename, delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isSafeBookId } from "./safety.js";
import { ApiError } from "./errors.js";
import { buildStudioBookConfig, defaultStudioPlatformForLanguage, normalizeStudioPlatform } from "./book-create.js";
import { discoverLlmCapabilities } from "./llm-capabilities.js";
import { defaultModelForProvider, isCliOAuthProvider } from "../shared/llm.js";
import type {
  RadarHistoryEntry,
  RadarMode,
  RadarProgressSnapshot,
  RadarResult,
  RadarStatusSummary,
  RadarFitCheckMetadata,
  TruthAssistAlignmentPayload,
  TruthAssistRequest,
  BookSetupProposalPayload,
  BookSetupProposalRequest,
  BookSetupSessionPayload,
  BookSetupFoundationPreviewPayload,
  BookSetupRevisionRequest,
  BookSetupCreateRequest,
  BookSetupReviewThreadPayload,
  BookSetupReviewThreadsRequest,
  BookSetupSessionListPayload,
  ReaderSettings,
  TruthSaveRequest,
  TruthWriteScope,
} from "../shared/contracts.js";
import { ReaderSettingsSchema } from "@actalk/inkos-core";

// --- Event bus for SSE ---

type EventHandler = (event: string, data: unknown) => void;
const subscribers = new Set<EventHandler>();
interface BookCreateStatusEntry {
  readonly bookId: string;
  readonly title: string;
  readonly status: "creating" | "error";
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly stage: string | null;
  readonly message: string | null;
  readonly history: ReadonlyArray<{
    readonly timestamp: string;
    readonly kind: "start" | "stage" | "info" | "error";
    readonly label: string;
    readonly detail?: string | null;
  }>;
  readonly error?: string;
}

const bookCreateStatus = new Map<string, BookCreateStatusEntry>();
interface IdempotentCreateResponseRecord {
  readonly status: 200;
  readonly body: Readonly<Record<string, unknown>>;
}

interface CreateIdempotencyRecord {
  readonly fingerprint: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly state: "in_flight" | "completed";
  readonly response?: IdempotentCreateResponseRecord;
}

type CreateIdempotencyScope = "book-create" | "book-setup-create";

const createIdempotencyRecords = new Map<string, CreateIdempotencyRecord>();
const BOOK_CREATE_IDEMPOTENCY_TTL_MS = 1000 * 60 * 60 * 24;
const CREATE_IDEMPOTENCY_STORE_DIR = join(".inkos", "studio", "create-idempotency");
const CREATE_IDEMPOTENCY_STORE_KIND = "inkos-create-idempotency";
const CREATE_IDEMPOTENCY_STORE_VERSION = 1;

interface StoredCreateIdempotencyRecord {
  readonly kind: typeof CREATE_IDEMPOTENCY_STORE_KIND;
  readonly version: typeof CREATE_IDEMPOTENCY_STORE_VERSION;
  readonly cacheKey: string;
  readonly record: CreateIdempotencyRecord;
}

interface ExactBookProposal {
  readonly book: {
    readonly id: string;
    readonly title: string;
    readonly genre: string;
    readonly platform: string;
    readonly status: string;
    readonly targetChapters: number;
    readonly chapterWordCount: number;
    readonly language?: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly foundation: {
    readonly storyBible: string;
    readonly volumeOutline: string;
    readonly bookRules: string;
    readonly currentState: string;
    readonly pendingHooks: string;
  };
}

function withExactBookProposalSupport(pipeline: PipelineRunner): PipelineRunner & {
  proposeBook: (book: ExactBookProposal["book"]) => Promise<ExactBookProposal>;
  applyBookProposal: (proposal: ExactBookProposal) => Promise<void>;
} {
  return pipeline as PipelineRunner & {
    proposeBook: (book: ExactBookProposal["book"]) => Promise<ExactBookProposal>;
    applyBookProposal: (proposal: ExactBookProposal) => Promise<void>;
  };
}

interface BookSetupSessionRecord extends BookSetupSessionPayload {
  readonly proposal: BookSetupProposalPayload;
  readonly previousProposal?: BookSetupProposalPayload;
  readonly externalContext: string;
  readonly foundationPreview?: BookSetupFoundationPreviewPayload;
  readonly reviewThreads: ReadonlyArray<BookSetupReviewThreadPayload>;
  readonly exactProposal?: ExactBookProposal;
}
const bookSetupSessions = new Map<string, BookSetupSessionRecord>();
const BOOK_SETUP_SESSION_LIMIT = 24;
const BOOK_SETUP_SESSION_STORE_DIR = join(".inkos", "studio", "book-setup");
const BOOK_SETUP_SESSION_STORE_KIND = "inkos-book-setup-session";
const BOOK_SETUP_SESSION_STORE_VERSION = 1;
type StudioLanguage = "ko" | "zh" | "en";
type CliOAuthProvider = "gemini-cli" | "codex-cli";

interface StoredBookSetupSession {
  readonly kind: typeof BOOK_SETUP_SESSION_STORE_KIND;
  readonly version: typeof BOOK_SETUP_SESSION_STORE_VERSION;
  readonly session: BookSetupSessionRecord;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBookSetupSessionStatus(value: unknown): value is BookSetupSessionPayload["status"] {
  return value === "proposed" || value === "approved" || value === "creating";
}

function isBookSetupProposalPayloadValue(value: unknown): value is BookSetupProposalPayload {
  return isObjectRecord(value)
    && typeof value.content === "string"
    && typeof value.createdAt === "string"
    && typeof value.revision === "number"
    && Number.isInteger(value.revision)
    && value.revision > 0;
}

function isBookSetupReviewDecision(value: unknown): value is BookSetupReviewThreadPayload["decision"] {
  return value === "approve" || value === "request-change" || value === "comment";
}

function isBookSetupReviewThreadStatus(value: unknown): value is BookSetupReviewThreadPayload["status"] {
  return value === "open" || value === "resolved";
}

function isBookSetupReviewThreadPayloadValue(value: unknown): value is BookSetupReviewThreadPayload {
  return isObjectRecord(value)
    && typeof value.id === "string"
    && value.id.trim().length > 0
    && typeof value.targetId === "string"
    && value.targetId.trim().length > 0
    && typeof value.targetLabel === "string"
    && typeof value.startLine === "number"
    && Number.isInteger(value.startLine)
    && value.startLine > 0
    && typeof value.endLine === "number"
    && Number.isInteger(value.endLine)
    && value.endLine > 0
    && value.startLine <= value.endLine
    && isBookSetupReviewDecision(value.decision)
    && isBookSetupReviewThreadStatus(value.status)
    && typeof value.note === "string"
    && typeof value.quote === "string"
    && typeof value.createdAt === "string"
    && (value.resolvedAt === undefined || value.resolvedAt === null || typeof value.resolvedAt === "string");
}

function isBookSetupFoundationPreviewPayloadValue(value: unknown): value is BookSetupFoundationPreviewPayload {
  return isObjectRecord(value)
    && typeof value.createdAt === "string"
    && typeof value.revision === "number"
    && Number.isInteger(value.revision)
    && value.revision > 0
    && typeof value.digest === "string"
    && value.digest.trim().length > 0
    && typeof value.storyBible === "string"
    && typeof value.volumeOutline === "string"
    && typeof value.bookRules === "string"
    && typeof value.currentState === "string"
    && typeof value.pendingHooks === "string";
}

function isExactBookProposal(value: unknown): value is ExactBookProposal {
  if (!isObjectRecord(value) || !isObjectRecord(value.book) || !isObjectRecord(value.foundation)) {
    return false;
  }

  return typeof value.book.id === "string"
    && typeof value.book.title === "string"
    && typeof value.book.genre === "string"
    && typeof value.book.platform === "string"
    && typeof value.book.status === "string"
    && typeof value.book.targetChapters === "number"
    && typeof value.book.chapterWordCount === "number"
    && (value.book.language === undefined || value.book.language === null || typeof value.book.language === "string")
    && typeof value.book.createdAt === "string"
    && typeof value.book.updatedAt === "string"
    && typeof value.foundation.storyBible === "string"
    && typeof value.foundation.volumeOutline === "string"
    && typeof value.foundation.bookRules === "string"
    && typeof value.foundation.currentState === "string"
    && typeof value.foundation.pendingHooks === "string";
}

function computeLabeledDigest(fields: ReadonlyArray<readonly [string, string | number | null | undefined]>): string {
  const hash = createHash("sha256");
  for (const [label, value] of fields) {
    hash.update(label);
    hash.update("\0");
    hash.update(String(value ?? ""));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function computeBookSetupFoundationPreviewDigest(preview: {
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
  readonly currentState: string;
  readonly pendingHooks: string;
}): string {
  return computeLabeledDigest([
    ["storyBible", preview.storyBible],
    ["volumeOutline", preview.volumeOutline],
    ["bookRules", preview.bookRules],
    ["currentState", preview.currentState],
    ["pendingHooks", preview.pendingHooks],
  ]);
}

function inferLegacyBookSetupFoundationPreviewDigest(
  foundationPreview: Record<string, unknown>,
  exactProposal: unknown,
): string | undefined {
  if (typeof foundationPreview.storyBible === "string"
    && typeof foundationPreview.volumeOutline === "string"
    && typeof foundationPreview.bookRules === "string"
    && typeof foundationPreview.currentState === "string"
    && typeof foundationPreview.pendingHooks === "string") {
    return computeBookSetupFoundationPreviewDigest({
      storyBible: foundationPreview.storyBible,
      volumeOutline: foundationPreview.volumeOutline,
      bookRules: foundationPreview.bookRules,
      currentState: foundationPreview.currentState,
      pendingHooks: foundationPreview.pendingHooks,
    });
  }
  if (isExactBookProposal(exactProposal)) {
    return computeBookSetupFoundationPreviewDigest(exactProposal.foundation);
  }
  return undefined;
}
function isBookSetupSessionRecordValue(value: unknown): value is BookSetupSessionRecord {
  return isObjectRecord(value)
    && typeof value.id === "string"
    && typeof value.revision === "number"
    && Number.isInteger(value.revision)
    && value.revision > 0
    && isBookSetupSessionStatus(value.status)
    && typeof value.bookId === "string"
    && typeof value.title === "string"
    && typeof value.genre === "string"
    && isStudioLanguage(value.language)
    && typeof value.platform === "string"
    && typeof value.chapterWordCount === "number"
    && typeof value.targetChapters === "number"
    && typeof value.brief === "string"
    && isBookSetupProposalPayloadValue(value.proposal)
    && (value.previousProposal === undefined || isBookSetupProposalPayloadValue(value.previousProposal))
    && Array.isArray(value.reviewThreads)
    && value.reviewThreads.every((thread) => isBookSetupReviewThreadPayloadValue(thread))
    && typeof value.externalContext === "string"
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && (value.foundationPreview === undefined || isBookSetupFoundationPreviewPayloadValue(value.foundationPreview))
    && (value.exactProposal === undefined || isExactBookProposal(value.exactProposal));
}

function normalizeBookSetupReviewThreads(value: unknown): ReadonlyArray<BookSetupReviewThreadPayload> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((thread): thread is BookSetupReviewThreadPayload => isBookSetupReviewThreadPayloadValue(thread))
    .map((thread) => ({
      ...thread,
      id: thread.id.trim(),
      targetId: thread.targetId.trim(),
      targetLabel: thread.targetLabel.trim(),
      note: thread.note.trim(),
      quote: thread.quote.trim(),
      resolvedAt: thread.status === "resolved"
        ? (typeof thread.resolvedAt === "string" && thread.resolvedAt.trim().length > 0 ? thread.resolvedAt : thread.createdAt)
        : null,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function hasRequestChangesInReviewThreads(
  threads: ReadonlyArray<BookSetupReviewThreadPayload>,
  scope: "proposal" | "foundation",
): boolean {
  return threads.some((thread) => thread.status === "open"
    && thread.decision === "request-change"
    && (scope === "proposal" ? thread.targetId === "proposal" : thread.targetId.startsWith("foundation:")));
}

function didResolveFoundationReviewRequestChange(
  previousThreads: ReadonlyArray<BookSetupReviewThreadPayload>,
  nextThreads: ReadonlyArray<BookSetupReviewThreadPayload>,
): boolean {
  const previousOpenRequestIds = new Set(
    previousThreads
      .filter((thread) => thread.status === "open" && thread.decision === "request-change" && thread.targetId.startsWith("foundation:"))
      .map((thread) => thread.id),
  );
  return nextThreads.some((thread) => previousOpenRequestIds.has(thread.id) && thread.status === "resolved");
}

function isStoredBookSetupSession(value: unknown): value is StoredBookSetupSession {
  return isObjectRecord(value)
    && value.kind === BOOK_SETUP_SESSION_STORE_KIND
    && value.version === BOOK_SETUP_SESSION_STORE_VERSION
    && isBookSetupSessionRecordValue(value.session);
}

function inferLegacyBookSetupSessionRevision(session: Record<string, unknown>): number {
  if (typeof session.revision === "number" && Number.isInteger(session.revision) && session.revision > 0) {
    return session.revision;
  }
  if (session.status === "creating") {
    return 4;
  }
  if (session.foundationPreview && typeof session.foundationPreview === "object") {
    return 3;
  }
  if (session.status === "approved") {
    return 2;
  }
  return 1;
}

function normalizeReaderSettings(value: unknown): ReaderSettings | null {
  const parsed = ReaderSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function normalizeStoredBookSetupSession(value: unknown): BookSetupSessionRecord | null {
  if (isStoredBookSetupSession(value)) {
    return value.session;
  }
  if (!isObjectRecord(value) || value.kind !== BOOK_SETUP_SESSION_STORE_KIND || value.version !== BOOK_SETUP_SESSION_STORE_VERSION || !isObjectRecord(value.session)) {
    return null;
  }

  const legacySession = value.session;
  const revision = inferLegacyBookSetupSessionRevision(legacySession);
  const proposal = isObjectRecord(legacySession.proposal)
    ? { ...legacySession.proposal, revision: typeof legacySession.proposal.revision === "number" ? legacySession.proposal.revision : 1 }
    : legacySession.proposal;
  const previousProposal = isObjectRecord(legacySession.previousProposal)
    ? {
        ...legacySession.previousProposal,
        revision: typeof legacySession.previousProposal.revision === "number"
          ? legacySession.previousProposal.revision
          : 1,
      }
    : legacySession.previousProposal;
  const foundationPreview = isObjectRecord(legacySession.foundationPreview)
    ? {
        ...legacySession.foundationPreview,
        revision: typeof legacySession.foundationPreview.revision === "number"
          ? legacySession.foundationPreview.revision
          : revision >= 3
            ? revision
            : 3,
        digest: typeof legacySession.foundationPreview.digest === "string" && legacySession.foundationPreview.digest.trim().length > 0
          ? legacySession.foundationPreview.digest
          : inferLegacyBookSetupFoundationPreviewDigest(legacySession.foundationPreview, legacySession.exactProposal),
      }
    : legacySession.foundationPreview;
  const reviewThreads = normalizeBookSetupReviewThreads(legacySession.reviewThreads);
  const upgraded = {
    ...legacySession,
    revision,
    proposal,
    reviewThreads,
    ...(previousProposal ? { previousProposal } : {}),
    ...(foundationPreview ? { foundationPreview } : {}),
  };
  return isBookSetupSessionRecordValue(upgraded) ? upgraded : null;
}

function bookSetupSessionStoreDir(root: string): string {
  return join(root, BOOK_SETUP_SESSION_STORE_DIR);
}

function bookSetupSessionStorePath(root: string, sessionId: string): string {
  return join(bookSetupSessionStoreDir(root), sessionId + ".json");
}

async function readStoredBookSetupSession(root: string, sessionId: string): Promise<BookSetupSessionRecord | null> {
  try {
    const raw = await readFile(bookSetupSessionStorePath(root, sessionId), "utf-8");
    const payload = JSON.parse(raw) as unknown;
    return normalizeStoredBookSetupSession(payload);
  } catch {
    return null;
  }
}

async function readStoredBookSetupSessions(root: string): Promise<ReadonlyArray<BookSetupSessionRecord>> {
  let files: string[];
  try {
    files = (await readdir(bookSetupSessionStoreDir(root)))
      .filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }

  const sessions = await Promise.all(files.map(async (fileName) => {
    try {
      const raw = await readFile(join(bookSetupSessionStoreDir(root), fileName), "utf-8");
      const payload = JSON.parse(raw) as unknown;
      return normalizeStoredBookSetupSession(payload);
    } catch {
      return null;
    }
  }));

  return sessions
    .filter((session): session is BookSetupSessionRecord => session !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function persistBookSetupSession(root: string, session: BookSetupSessionRecord): Promise<void> {
  await mkdir(bookSetupSessionStoreDir(root), { recursive: true });
  const payload: StoredBookSetupSession = {
    kind: BOOK_SETUP_SESSION_STORE_KIND,
    version: BOOK_SETUP_SESSION_STORE_VERSION,
    session,
  };
  await writeFile(bookSetupSessionStorePath(root, session.id), JSON.stringify(payload, null, 2), "utf-8");
}

async function deleteStoredBookSetupSession(root: string, sessionId: string): Promise<void> {
  await rm(bookSetupSessionStorePath(root, sessionId), { force: true });
}

async function trimStoredBookSetupSessions(root: string, limit = BOOK_SETUP_SESSION_LIMIT): Promise<void> {
  const overflow = (await readStoredBookSetupSessions(root)).slice(limit);
  await Promise.all(overflow.map(async (session) => {
    await deleteStoredBookSetupSession(root, session.id);
  }));
}

async function upsertBookSetupSession(root: string, session: BookSetupSessionRecord): Promise<void> {
  bookSetupSessions.set(session.id, session);
  const trimmed = trimBookSetupSessions();
  await persistBookSetupSession(root, session);
  await Promise.all(trimmed.map(async (entry) => {
    await deleteStoredBookSetupSession(root, entry.id);
  }));
  await trimStoredBookSetupSessions(root);
}

async function findBookSetupSession(root: string, sessionId: string): Promise<BookSetupSessionRecord | null> {
  const cached = bookSetupSessions.get(sessionId);
  if (cached) {
    return cached;
  }

  const stored = await readStoredBookSetupSession(root, sessionId);
  if (!stored) {
    return null;
  }

  bookSetupSessions.set(stored.id, stored);
  trimBookSetupSessions();
  return stored;
}

async function listBookSetupSessions(root: string, limit = BOOK_SETUP_SESSION_LIMIT): Promise<ReadonlyArray<BookSetupSessionRecord>> {
  const merged = new Map<string, BookSetupSessionRecord>();
  for (const session of await readStoredBookSetupSessions(root)) {
    merged.set(session.id, session);
  }
  for (const session of bookSetupSessions.values()) {
    merged.set(session.id, session);
  }

  return [...merged.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

function createIdempotencyStoreDir(root: string): string {
  return join(root, CREATE_IDEMPOTENCY_STORE_DIR);
}

function createIdempotencyStorePath(root: string, cacheKey: string): string {
  return join(
    createIdempotencyStoreDir(root),
    createHash("sha256").update(cacheKey).digest("hex") + ".json",
  );
}

function isIdempotentCreateResponseRecordValue(value: unknown): value is IdempotentCreateResponseRecord {
  return isObjectRecord(value)
    && value.status === 200
    && isObjectRecord(value.body);
}

function isCreateIdempotencyRecordValue(value: unknown): value is CreateIdempotencyRecord {
  return isObjectRecord(value)
    && typeof value.fingerprint === "string"
    && typeof value.createdAt === "number"
    && Number.isFinite(value.createdAt)
    && typeof value.updatedAt === "number"
    && Number.isFinite(value.updatedAt)
    && (value.state === "in_flight" || value.state === "completed")
    && (value.state !== "completed" || isIdempotentCreateResponseRecordValue(value.response));
}

function isStoredCreateIdempotencyRecordValue(value: unknown): value is StoredCreateIdempotencyRecord {
  return isObjectRecord(value)
    && value.kind === CREATE_IDEMPOTENCY_STORE_KIND
    && value.version === CREATE_IDEMPOTENCY_STORE_VERSION
    && typeof value.cacheKey === "string"
    && isCreateIdempotencyRecordValue(value.record)
    && value.record.state === "completed";
}

async function readStoredCreateIdempotencyRecord(root: string, cacheKey: string): Promise<CreateIdempotencyRecord | null> {
  try {
    const raw = await readFile(createIdempotencyStorePath(root, cacheKey), "utf-8");
    const payload = JSON.parse(raw) as unknown;
    if (!isStoredCreateIdempotencyRecordValue(payload) || payload.cacheKey !== cacheKey) {
      return null;
    }
    return payload.record;
  } catch {
    return null;
  }
}

async function persistCreateIdempotencyRecord(root: string, cacheKey: string, record: CreateIdempotencyRecord): Promise<void> {
  if (record.state !== "completed" || !record.response) {
    return;
  }
  await mkdir(createIdempotencyStoreDir(root), { recursive: true });
  const payload: StoredCreateIdempotencyRecord = {
    kind: CREATE_IDEMPOTENCY_STORE_KIND,
    version: CREATE_IDEMPOTENCY_STORE_VERSION,
    cacheKey,
    record,
  };
  await writeFile(createIdempotencyStorePath(root, cacheKey), JSON.stringify(payload, null, 2), "utf-8");
}

async function deleteStoredCreateIdempotencyRecord(root: string, cacheKey: string): Promise<void> {
  await rm(createIdempotencyStorePath(root, cacheKey), { force: true });
}

async function purgeExpiredStoredCreateIdempotencyRecords(root: string, now = Date.now()): Promise<void> {
  let files: string[];
  try {
    files = (await readdir(createIdempotencyStoreDir(root)))
      .filter((name) => name.endsWith(".json"));
  } catch {
    return;
  }

  await Promise.all(files.map(async (fileName) => {
    const fullPath = join(createIdempotencyStoreDir(root), fileName);
    try {
      const raw = await readFile(fullPath, "utf-8");
      const payload = JSON.parse(raw) as unknown;
      if (!isStoredCreateIdempotencyRecordValue(payload) || now - payload.record.updatedAt > BOOK_CREATE_IDEMPOTENCY_TTL_MS) {
        await rm(fullPath, { force: true });
      }
    } catch {
      await rm(fullPath, { force: true }).catch(() => undefined);
    }
  }));
}

function readBookSetupExpectedRevision(body: Partial<BookSetupRevisionRequest> | null | undefined, sessionId: string): number {
  const expectedRevision = body?.expectedRevision;
  if (typeof expectedRevision === "number" && Number.isInteger(expectedRevision) && expectedRevision > 0) {
    return expectedRevision;
  }
  throw new ApiError(428, "BOOK_SETUP_PRECONDITION_REQUIRED", `Book setup session "${sessionId}" requires an expected revision.`);
}

function assertBookSetupExpectedRevision(
  session: BookSetupSessionRecord,
  expectedRevision: number,
  nextAction: string,
): void {
  if (session.revision === expectedRevision) {
    return;
  }
  throw new ApiError(
    412,
    "BOOK_SETUP_REVISION_MISMATCH",
    `Book setup session "${session.id}" changed while you were reviewing it. Refresh the latest setup before you ${nextAction}.`,
  );
}

function readBookSetupExpectedPreviewDigest(body: Partial<BookSetupCreateRequest> | null | undefined, sessionId: string): string {
  const expectedPreviewDigest = typeof body?.expectedPreviewDigest === "string"
    ? body.expectedPreviewDigest.trim()
    : "";
  if (expectedPreviewDigest.length > 0) {
    return expectedPreviewDigest;
  }
  throw new ApiError(428, "BOOK_SETUP_PRECONDITION_REQUIRED", `Book setup session "${sessionId}" requires an expected preview digest.`);
}

function readBookSetupReviewThreads(
  body: Partial<BookSetupReviewThreadsRequest> | null | undefined,
  sessionId: string,
): ReadonlyArray<BookSetupReviewThreadPayload> {
  if (!Array.isArray(body?.reviewThreads)) {
    throw new ApiError(428, "BOOK_SETUP_PRECONDITION_REQUIRED", `Book setup session "${sessionId}" requires review threads.`);
  }
  const reviewThreads = normalizeBookSetupReviewThreads(body.reviewThreads);
  if (reviewThreads.length !== body.reviewThreads.length) {
    throw new ApiError(400, "BOOK_SETUP_INVALID_REVIEW_THREADS", `Book setup session "${sessionId}" includes invalid review threads.`);
  }
  return reviewThreads;
}

function shouldRefreshPreviewOnResolve(body: Partial<BookSetupReviewThreadsRequest> | null | undefined): boolean {
  return body?.refreshPreviewOnResolve === true;
}

function assertBookSetupExpectedPreviewDigest(
  session: BookSetupSessionRecord,
  expectedPreviewDigest: string,
  nextAction: string,
): void {
  const currentDigest = session.foundationPreview?.digest ?? "";
  if (currentDigest.length > 0 && currentDigest === expectedPreviewDigest) {
    return;
  }
  throw new ApiError(
    412,
    "BOOK_SETUP_PREVIEW_DIGEST_MISMATCH",
    `Book setup session "${session.id}" changed while you were reviewing it. Refresh the latest setup before you ${nextAction}.`,
  );
}

function assertNoBookSetupReviewRequests(
  session: BookSetupSessionRecord,
  scope: "proposal" | "foundation",
  nextAction: string,
): void {
  if (!hasRequestChangesInReviewThreads(session.reviewThreads, scope)) {
    return;
  }
  throw new ApiError(
    409,
    "BOOK_SETUP_REVIEW_CHANGES_PENDING",
    `Book setup session "${session.id}" still has requested changes. Resolve or remove those review notes before you ${nextAction}.`,
  );
}

function readIdempotencyKey(value: string | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function hashCreateIdempotencyFingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function computeBookCreateIdempotencyFingerprint(body: {
  readonly title: string;
  readonly genre: string;
  readonly language?: StudioLanguage;
  readonly platform?: string;
  readonly chapterWordCount?: number;
  readonly targetChapters?: number;
  readonly brief?: string;
}): string {
  const normalized = buildStudioBookConfig(body, "idempotency");
  return hashCreateIdempotencyFingerprint({
    route: "books:create",
    bookId: normalized.id,
    title: body.title.trim(),
    genre: normalized.genre,
    language: normalized.language ?? null,
    platform: normalized.platform,
    chapterWordCount: normalized.chapterWordCount,
    targetChapters: normalized.targetChapters,
    brief: typeof body.brief === "string" ? body.brief.trim() : "",
  });
}

function computeBookSetupCreateIdempotencyFingerprint(
  sessionId: string,
  body: Partial<BookSetupCreateRequest> | null | undefined,
): string {
  return hashCreateIdempotencyFingerprint({
    route: "book-setup:create",
    sessionId,
    expectedRevision: typeof body?.expectedRevision === "number" ? body.expectedRevision : null,
    expectedPreviewDigest: typeof body?.expectedPreviewDigest === "string" ? body.expectedPreviewDigest.trim() : "",
  });
}

function createIdempotencyCacheKey(scope: CreateIdempotencyScope, idempotencyKey: string): string {
  return `${scope}:${idempotencyKey}`;
}

function purgeExpiredCreateIdempotencyRecords(now = Date.now()): void {
  for (const [cacheKey, record] of createIdempotencyRecords.entries()) {
    if (now - record.updatedAt > BOOK_CREATE_IDEMPOTENCY_TTL_MS) {
      createIdempotencyRecords.delete(cacheKey);
    }
  }
}

async function beginCreateIdempotency(
  root: string,
  scope: CreateIdempotencyScope,
  headerValue: string | undefined,
  fingerprint: string,
): Promise<{ readonly cacheKey: string | null; readonly replay?: IdempotentCreateResponseRecord }> {
  const idempotencyKey = readIdempotencyKey(headerValue);
  if (!idempotencyKey) {
    return { cacheKey: null };
  }

  const now = Date.now();
  purgeExpiredCreateIdempotencyRecords(now);
  await purgeExpiredStoredCreateIdempotencyRecords(root, now);
  const cacheKey = createIdempotencyCacheKey(scope, idempotencyKey);
  let existing = createIdempotencyRecords.get(cacheKey) ?? await readStoredCreateIdempotencyRecord(root, cacheKey);
  if (!existing) {
    createIdempotencyRecords.set(cacheKey, {
      fingerprint,
      createdAt: now,
      updatedAt: now,
      state: "in_flight",
    });
    return { cacheKey };
  }

  if (!createIdempotencyRecords.has(cacheKey)) {
    createIdempotencyRecords.set(cacheKey, existing);
  }

  if (existing.fingerprint !== fingerprint) {
    throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", `Idempotency-Key "${idempotencyKey}" was already used for a different create request.`);
  }

  if (existing.state === "completed" && existing.response) {
    const response = {
      status: existing.response.status,
      body: structuredClone(existing.response.body),
    } satisfies IdempotentCreateResponseRecord;
    createIdempotencyRecords.set(cacheKey, {
      ...existing,
      updatedAt: now,
      response,
    });
    return { cacheKey, replay: response };
  }

  throw new ApiError(409, "IDEMPOTENCY_KEY_IN_FLIGHT", `Create request with Idempotency-Key "${idempotencyKey}" is still in progress.`);
}

async function completeCreateIdempotency(root: string, cacheKey: string | null, body: Readonly<Record<string, unknown>>): Promise<void> {
  if (!cacheKey) {
    return;
  }
  const existing = createIdempotencyRecords.get(cacheKey);
  if (!existing) {
    return;
  }
  const record: CreateIdempotencyRecord = {
    ...existing,
    updatedAt: Date.now(),
    state: "completed",
    response: {
      status: 200,
      body: structuredClone(body),
    },
  };
  createIdempotencyRecords.set(cacheKey, record);
  await persistCreateIdempotencyRecord(root, cacheKey, record).catch(() => undefined);
}

function abandonCreateIdempotency(cacheKey: string | null): void {
  if (!cacheKey) {
    return;
  }
  const existing = createIdempotencyRecords.get(cacheKey);
  if (existing?.state === "in_flight") {
    createIdempotencyRecords.delete(cacheKey);
  }
}

interface AuthStatus {
  readonly available: boolean;
  readonly authenticated: boolean;
  readonly credentialPath: string;
  readonly command: string;
  readonly details?: string;
}

interface GlobalConfigPayload {
  readonly exists: boolean;
  readonly language: StudioLanguage;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
  readonly baseUrl: string;
  readonly apiKeySet: boolean;
  readonly auth: {
    readonly geminiCli: AuthStatus;
    readonly codexCli: AuthStatus;
  };
}

interface BootstrapPayload {
  readonly root: string;
  readonly suggestedProjectName: string;
  readonly projectInitialized: boolean;
  readonly globalConfig: GlobalConfigPayload;
}

type AuthSessionStatus = "starting" | "waiting-browser" | "awaiting-code" | "authorizing" | "succeeded" | "failed";

interface AuthSessionPayload {
  readonly id: string;
  readonly provider: CliOAuthProvider;
  readonly status: AuthSessionStatus;
  readonly url: string | null;
  readonly verificationCode: string | null;
  readonly error: string | null;
  readonly logs: ReadonlyArray<string>;
}

interface AuthSessionRecord {
  readonly id: string;
  readonly provider: CliOAuthProvider;
  child?: ReturnType<typeof spawn>;
  status: AuthSessionStatus;
  url?: string;
  verificationCode?: string;
  error?: string;
  logs: string[];
}

const authSessions = new Map<string, AuthSessionRecord>();
const RADAR_HISTORY_LIMIT = 12;
const RADAR_FIT_CHECK_CONTEXT_FILES = [
  "author_intent.md",
  "current_focus.md",
  "story_bible.md",
  "volume_outline.md",
  "book_rules.md",
  "current_state.md",
  "pending_hooks.md",
] as const;
const RADAR_FIT_CHECK_PREVIEW_LIMIT = 1200;
const TRUTH_FILES = [
  "author_intent.md",
  "current_focus.md",
  "story_bible.md",
  "volume_outline.md",
  "current_state.md",
  "particle_ledger.md",
  "pending_hooks.md",
  "chapter_summaries.md",
  "subplot_board.md",
  "emotional_arcs.md",
  "character_matrix.md",
  "style_guide.md",
  "parent_canon.md",
  "fanfic_canon.md",
  "book_rules.md",
] as const;
type TruthFileName = typeof TRUTH_FILES[number];
type TruthFileSection = "planning" | "tracking" | "reference";

interface TruthFileDefinition {
  readonly name: TruthFileName;
  readonly section: TruthFileSection;
  readonly optional: boolean;
}

const TRUTH_FILE_DEFINITIONS: ReadonlyArray<TruthFileDefinition> = [
  { name: "author_intent.md", section: "planning", optional: false },
  { name: "current_focus.md", section: "planning", optional: false },
  { name: "story_bible.md", section: "planning", optional: false },
  { name: "volume_outline.md", section: "planning", optional: false },
  { name: "book_rules.md", section: "planning", optional: false },
  { name: "current_state.md", section: "tracking", optional: false },
  { name: "pending_hooks.md", section: "tracking", optional: false },
  { name: "chapter_summaries.md", section: "tracking", optional: true },
  { name: "particle_ledger.md", section: "tracking", optional: true },
  { name: "subplot_board.md", section: "tracking", optional: true },
  { name: "emotional_arcs.md", section: "tracking", optional: true },
  { name: "character_matrix.md", section: "tracking", optional: true },
  { name: "style_guide.md", section: "reference", optional: true },
  { name: "parent_canon.md", section: "reference", optional: true },
  { name: "fanfic_canon.md", section: "reference", optional: true },
] as const;

function isAllowedTruthFile(file: string): file is TruthFileName {
  return (TRUTH_FILES as readonly string[]).includes(file);
}

function isStudioLanguage(value: unknown): value is StudioLanguage {
  return value === "ko" || value === "zh" || value === "en";
}

function truthFileDefinition(name: TruthFileName): TruthFileDefinition {
  return TRUTH_FILE_DEFINITIONS.find((entry) => entry.name === name)
    ?? { name, section: "reference", optional: true };
}

function readTruthWriteScope(value: unknown): TruthWriteScope | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record.kind === "read-only") {
    return { kind: "read-only" };
  }
  if (record.kind === "file" && typeof record.fileName === "string" && isAllowedTruthFile(record.fileName)) {
    return { kind: "file", fileName: record.fileName };
  }
  if (record.kind === "bundle" && Array.isArray(record.fileNames)) {
    const fileNames = record.fileNames
      .filter((fileName): fileName is string => typeof fileName === "string" && isAllowedTruthFile(fileName))
      .filter((fileName, index, files) => files.indexOf(fileName) === index);
    if (fileNames.length > 0) {
      return { kind: "bundle", fileNames: fileNames as [string, ...string[]] };
    }
  }

  return null;
}

function hasMatchingTruthScopeFiles(scopeFiles: ReadonlyArray<string>, targetFiles: ReadonlyArray<string>): boolean {
  const uniqueScopeFiles = [...new Set(scopeFiles)];
  const uniqueTargetFiles = [...new Set(targetFiles)];
  return uniqueScopeFiles.length === uniqueTargetFiles.length
    && uniqueScopeFiles.every((fileName) => uniqueTargetFiles.includes(fileName));
}

function validateTruthWriteScope(params: {
  readonly scope: TruthWriteScope | null;
  readonly targetFile?: TruthFileName;
  readonly requestedFiles?: ReadonlyArray<TruthFileName>;
  readonly writeOperation: boolean;
}): { readonly status: 400 | 409; readonly error: string } | null {
  if (!params.writeOperation) {
    return null;
  }

  if (!params.scope) {
    return { status: 400, error: "TRUTH_SCOPE_REQUIRED" };
  }
  if (params.scope.kind === "read-only") {
    return { status: 409, error: "TRUTH_SCOPE_READ_ONLY" };
  }
  if (params.scope.kind === "bundle") {
    if (params.targetFile) {
      return { status: 409, error: "TRUTH_SCOPE_FILE_MISMATCH" };
    }
    if (!params.requestedFiles || params.requestedFiles.length < 2) {
      return { status: 400, error: "TRUTH_SCOPE_MULTI_FILE_UNSUPPORTED" };
    }
    if (!hasMatchingTruthScopeFiles(params.scope.fileNames, params.requestedFiles)) {
      return { status: 409, error: "TRUTH_SCOPE_FILE_MISMATCH" };
    }
    return null;
  }

  if (params.requestedFiles && params.requestedFiles.length !== 1) {
    return { status: 400, error: "TRUTH_SCOPE_MULTI_FILE_UNSUPPORTED" };
  }

  const targetFile = params.targetFile ?? params.requestedFiles?.[0];
  if (!targetFile || params.scope.fileName !== targetFile) {
    return { status: 409, error: "TRUTH_SCOPE_FILE_MISMATCH" };
  }

  return null;
}

function truthFileSectionLabel(section: TruthFileSection, language: StudioLanguage): string {
  if (language === "ko") {
    if (section === "planning") return "핵심 기획";
    if (section === "tracking") return "진행 추적";
    return "참고 문서";
  }
  if (language === "zh") {
    if (section === "planning") return "核心设定";
    if (section === "tracking") return "进度追踪";
    return "参考资料";
  }
  if (section === "planning") return "Core Planning";
  if (section === "tracking") return "Progress Tracking";
  return "Reference";
}

function truthFileLabel(file: TruthFileName, language: StudioLanguage): string {
  const labels = language === "ko"
    ? {
        "author_intent.md": "작가 의도",
        "current_focus.md": "현재 포커스",
        "story_bible.md": "스토리 바이블",
        "volume_outline.md": "권별 아웃라인",
        "book_rules.md": "작품 규칙",
        "current_state.md": "현재 상태",
        "pending_hooks.md": "보류 중인 떡밥",
        "chapter_summaries.md": "화별 요약",
        "particle_ledger.md": "자원 장부",
        "subplot_board.md": "서브플롯 보드",
        "emotional_arcs.md": "감정 곡선",
        "character_matrix.md": "캐릭터 매트릭스",
        "style_guide.md": "문체 가이드",
        "parent_canon.md": "원작 정전 요약",
        "fanfic_canon.md": "파생 설정 정리",
      } as const
    : language === "zh"
      ? {
          "author_intent.md": "作者意图",
          "current_focus.md": "当前聚焦",
          "story_bible.md": "故事圣经",
          "volume_outline.md": "卷纲",
          "book_rules.md": "作品规则",
          "current_state.md": "当前状态",
          "pending_hooks.md": "待回收伏笔",
          "chapter_summaries.md": "章节摘要",
          "particle_ledger.md": "资源账本",
          "subplot_board.md": "支线进度板",
          "emotional_arcs.md": "情感弧线",
          "character_matrix.md": "角色关系矩阵",
          "style_guide.md": "文风指南",
          "parent_canon.md": "母本正典",
          "fanfic_canon.md": "同人设定汇总",
        } as const
      : {
          "author_intent.md": "Author Intent",
          "current_focus.md": "Current Focus",
          "story_bible.md": "Story Bible",
          "volume_outline.md": "Volume Outline",
          "book_rules.md": "Book Rules",
          "current_state.md": "Current State",
          "pending_hooks.md": "Pending Hooks",
          "chapter_summaries.md": "Chapter Summaries",
          "particle_ledger.md": "Resource Ledger",
          "subplot_board.md": "Subplot Board",
          "emotional_arcs.md": "Emotional Arcs",
          "character_matrix.md": "Character Matrix",
          "style_guide.md": "Style Guide",
          "parent_canon.md": "Parent Canon",
          "fanfic_canon.md": "Fanfic Canon",
        } as const;

  return labels[file];
}

function truthFileTemplate(file: TruthFileName, language: StudioLanguage): string {
  if (file === "author_intent.md") {
    if (language === "ko") return "# 작가 의도\n\n(이 작품의 장기적인 창작 방향을 적는다.)\n";
    if (language === "zh") return "# 作者意图\n\n（在这里描述这本书的长期创作方向。）\n";
    return "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n";
  }
  if (file === "current_focus.md") {
    if (language === "ko") return "# 현재 포커스\n\n## 현재 중점\n\n(앞으로 1-3화에서 가장 우선해야 할 전개를 적는다.)\n";
    if (language === "zh") return "# 当前聚焦\n\n## 当前重点\n\n（描述接下来 1-3 章最需要优先推进的内容。）\n";
    return "# Current Focus\n\n## Active Focus\n\n(Describe what the next 1-3 chapters should prioritize.)\n";
  }
  if (file === "story_bible.md") {
    if (language === "ko") return "# 스토리 바이블\n\n## 세계관\n\n## 주인공\n\n## 세력과 인물\n\n## 지리와 환경\n";
    if (language === "zh") return "# 故事圣经\n\n## 世界观\n\n## 主角\n\n## 势力与人物\n\n## 地理与环境\n";
    return "# Story Bible\n\n## Worldview\n\n## Protagonist\n\n## Factions and Characters\n\n## Geography and Environment\n";
  }
  if (file === "volume_outline.md") {
    if (language === "ko") return "# 권별 아웃라인\n\n## 1권\n- 화수 범위:\n- 핵심 갈등:\n- 주요 전환점:\n";
    if (language === "zh") return "# 卷纲\n\n## 第1卷\n- 章节范围：\n- 核心冲突：\n- 关键转折：\n";
    return "# Volume Outline\n\n## Volume 1\n- Chapter range:\n- Core conflict:\n- Key turning points:\n";
  }
  if (file === "book_rules.md") {
    if (language === "ko") {
      return "---\nversion: \"1.0\"\nprotagonist:\n  name: \n  personalityLock: []\n  behavioralConstraints: []\ngenreLock:\n  primary: \n  forbidden: []\nprohibitions: []\nchapterTypesOverride: []\nfatigueWordsOverride: []\nadditionalAuditDimensions: []\nenableFullCastTracking: false\n---\n\n## 서사 시점\n\n## 핵심 갈등 구동력\n";
    }
    if (language === "zh") {
      return "---\nversion: \"1.0\"\nprotagonist:\n  name: \n  personalityLock: []\n  behavioralConstraints: []\ngenreLock:\n  primary: \n  forbidden: []\nprohibitions: []\nchapterTypesOverride: []\nfatigueWordsOverride: []\nadditionalAuditDimensions: []\nenableFullCastTracking: false\n---\n\n## 叙事视角\n\n## 核心冲突驱动\n";
    }
    return "---\nversion: \"1.0\"\nprotagonist:\n  name: \n  personalityLock: []\n  behavioralConstraints: []\ngenreLock:\n  primary: \n  forbidden: []\nprohibitions: []\nchapterTypesOverride: []\nfatigueWordsOverride: []\nadditionalAuditDimensions: []\nenableFullCastTracking: false\n---\n\n## Narrative Perspective\n\n## Core Conflict Driver\n";
  }
  if (file === "current_state.md") {
    if (language === "ko") return "# 현재 상태\n\n## 현재 진행\n\n## 최근 변화\n\n## 다음 위험 요소\n";
    if (language === "zh") return "# 当前状态\n\n## 当前进度\n\n## 最近变化\n\n## 下一个风险点\n";
    return "# Current State\n\n## Current Progress\n\n## Recent Changes\n\n## Next Risks\n";
  }
  if (file === "pending_hooks.md") {
    if (language === "ko") return "# 보류 중인 떡밥\n\n| 떡밥 ID | 내용 | 도입 화 | 상태 | 예상 회수 시점 |\n|---|---|---|---|---|\n";
    if (language === "zh") return "# 待回收伏笔\n\n| 伏笔ID | 内容 | 埋入章节 | 状态 | 预计回收时点 |\n|---|---|---|---|---|\n";
    return "# Pending Hooks\n\n| Hook ID | Summary | Introduced In | Status | Planned Payoff |\n| --- | --- | --- | --- | --- |\n";
  }
  if (file === "chapter_summaries.md") {
    if (language === "ko") return "# 화별 요약\n\n| 화 | 제목 | 핵심 사건 | 상태 변화 | 다음 연결점 |\n|---|---|---|---|---|\n";
    if (language === "zh") return "# 章节摘要\n\n| 章节 | 标题 | 核心事件 | 状态变化 | 下一连接点 |\n|---|---|---|---|---|\n";
    return "# Chapter Summaries\n\n| Chapter | Title | Key Event | State Change | Next Link |\n| --- | --- | --- | --- | --- |\n";
  }
  if (file === "particle_ledger.md") {
    if (language === "ko") return "# 자원 장부\n\n| 회차 | 기초 수치 | 출처 | 완성도 | 증가분 | 마무리 수치 | 근거 |\n|---|---|---|---|---|---|---|\n| 0 | 0 | 초반 설정 | - | 0 | 0 | 초기 책 상태 |\n";
    if (language === "zh") return "# 资源账本\n\n| 章节 | 期初值 | 来源 | 完整度 | 增量 | 期末值 | 依据 |\n|------|--------|------|--------|------|--------|------|\n| 0 | 0 | 初始化 | - | 0 | 0 | 开书初始 |\n";
    return "# Resource Ledger\n\n| Chapter | Opening Value | Source | Integrity | Delta | Closing Value | Evidence |\n| --- | --- | --- | --- | --- | --- | --- |\n| 0 | 0 | Initialization | - | 0 | 0 | Initial book state |\n";
  }
  if (file === "subplot_board.md") {
    if (language === "ko") return "# 서브플롯 보드\n\n| 서브플롯 ID | 서브플롯 | 관련 인물 | 시작 화 | 최근 활동 화 | 경과 화수 | 상태 | 진행 요약 | 회수 ETA |\n|-------|--------|----------|--------|------------|----------|------|----------|---------|\n";
    if (language === "zh") return "# 支线进度板\n\n| 支线ID | 支线名 | 相关角色 | 起始章 | 最近活跃章 | 距今章数 | 状态 | 进度概述 | 回收ETA |\n|--------|--------|----------|--------|------------|----------|------|----------|---------|\n";
    return "# Subplot Board\n\n| Subplot ID | Subplot | Related Characters | Start Chapter | Last Active Chapter | Chapters Since | Status | Progress Summary | Payoff ETA |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n";
  }
  if (file === "emotional_arcs.md") {
    if (language === "ko") return "# 감정 곡선\n\n| 캐릭터 | 회차 | 감정 상태 | 촉발 사건 | 강도(1-10) | 곡선 방향 |\n|------|------|----------|----------|------------|----------|\n";
    if (language === "zh") return "# 情感弧线\n\n| 角色 | 章节 | 情绪状态 | 触发事件 | 强度(1-10) | 弧线方向 |\n|------|------|----------|----------|------------|----------|\n";
    return "# Emotional Arcs\n\n| Character | Chapter | Emotional State | Trigger Event | Intensity (1-10) | Arc Direction |\n| --- | --- | --- | --- | --- | --- |\n";
  }
  if (file === "character_matrix.md") {
    if (language === "ko") return "# 캐릭터 상호작용 매트릭스\n\n### 캐릭터 프로필\n| 캐릭터 | 핵심 태그 | 대비 포인트 | 말투 | 성격 핵심 | 주인공과의 관계 | 핵심 동기 | 현재 목표 |\n|------|----------|----------|----------|----------|------------|----------|----------|\n\n### 만남 로그\n| 캐릭터 A | 캐릭터 B | 최초 만남 화 | 최근 상호작용 화 | 관계 성격 | 관계 변화 |\n|-------|-------|------------|------------|----------|----------|\n\n### 정보 경계\n| 캐릭터 | 확인된 정보 | 미확인 정보 | 정보 출처 화 |\n|------|----------|----------|------------|\n";
    if (language === "zh") return "# 角色交互矩阵\n\n### 角色档案\n| 角色 | 核心标签 | 反差细节 | 说话风格 | 性格底色 | 与主角关系 | 核心动机 | 当前目标 |\n|------|----------|----------|----------|----------|------------|----------|----------|\n\n### 相遇记录\n| 角色A | 角色B | 首次相遇章 | 最近交互章 | 关系性质 | 关系变化 |\n|-------|-------|------------|------------|----------|----------|\n\n### 信息边界\n| 角色 | 已知信息 | 未知信息 | 信息来源章 |\n|------|----------|----------|------------|\n";
    return "# Character Matrix\n\n### Character Profiles\n| Character | Core Tags | Contrast Detail | Speech Style | Personality Core | Relationship to Protagonist | Core Motivation | Current Goal |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n\n### Encounter Log\n| Character A | Character B | First Meeting Chapter | Latest Interaction Chapter | Relationship Type | Relationship Change |\n| --- | --- | --- | --- | --- | --- |\n\n### Information Boundaries\n| Character | Known Information | Unknown Information | Source Chapter |\n| --- | --- | --- | --- |\n";
  }
  if (file === "style_guide.md") {
    if (language === "ko") return "# 문체 가이드\n\n- 문장 길이:\n- 어휘 톤:\n- 대사 운용:\n- 금지할 버릇:\n";
    if (language === "zh") return "# 文风指南\n\n- 句长：\n- 词汇风格：\n- 对话处理：\n- 禁止习惯：\n";
    return "# Style Guide\n\n- Sentence length:\n- Vocabulary tone:\n- Dialogue handling:\n- Habits to avoid:\n";
  }
  if (file === "parent_canon.md") {
    if (language === "ko") return "# 원작 정전 요약\n\n(원작/상위 작품의 설정을 정리한다.)\n";
    if (language === "zh") return "# 母本正典\n\n（整理原作/母本设定。）\n";
    return "# Parent Canon\n\n(Summarize the source canon here.)\n";
  }
  if (language === "ko") return "# 파생 설정 정리\n\n(파생 설정 또는 변형 규칙을 정리한다.)\n";
  if (language === "zh") return "# 同人设定汇总\n\n（整理衍生设定或改编规则。）\n";
  return "# Fanfic Canon\n\n(Summarize derivative canon or adaptation rules here.)\n";
}

async function resolveTruthFileLanguage(
  state: StateManager,
  bookId: string,
  fallbackConfig: ProjectConfig | null,
): Promise<StudioLanguage> {
  try {
    const book = await state.loadBookConfig(bookId);
    return isStudioLanguage(book.language) ? book.language : "ko";
  } catch {
    return isStudioLanguage(fallbackConfig?.language) ? fallbackConfig.language : "ko";
  }
}

async function readStoryFileSafe(bookDir: string, file: TruthFileName): Promise<string | null> {
  try {
    return await readFile(join(bookDir, "story", file), "utf-8");
  } catch {
    return null;
  }
}

async function ensureStudioControlDocuments(state: StateManager, bookId: string): Promise<void> {
  const maybeEnsure = (state as StateManager & {
    ensureControlDocuments?: (id: string) => Promise<void>;
  }).ensureControlDocuments;
  if (typeof maybeEnsure === "function") {
    await maybeEnsure.call(state, bookId);
  }
}

function truthAssistDefaultInstruction(file: TruthFileName, exists: boolean, language: StudioLanguage): string {
  if (language === "ko") {
    if (!exists) return "이 문서의 역할에 맞는 초안을 한국어로 작성해 줘.";
    if (file === "author_intent.md") return "이 작품의 장기 방향과 핵심 질문이 더 선명해지게 다듬어 줘.";
    if (file === "current_focus.md") return "다음 1~3화의 초점이 더 선명하게 보이도록 다듬어 줘.";
    if (file === "story_bible.md") return "핵심 설정이 빠지지 않도록 정리하고 문장을 다듬어 줘.";
    if (file === "volume_outline.md") return "권별 흐름이 읽히도록 아웃라인을 정리해 줘.";
    if (file === "book_rules.md") return "지켜야 할 규칙과 금기를 더 명확하게 정리해 줘.";
    return "이 문서를 더 읽기 쉽고 일관되게 다듬어 줘.";
  }
  if (language === "zh") {
    return exists ? "请把这个文档整理得更清晰、更一致。" : "请按这个文档的职责起草一份可直接使用的内容。";
  }
  return exists
    ? "Polish this document so it becomes clearer, tighter, and more useful."
    : "Draft a usable first version of this document for the book.";
}

function buildTruthAlignmentPrompt(
  alignment: TruthAssistAlignmentPayload | undefined,
  language: StudioLanguage,
): string {
  if (!alignment) return "";

  const knownFacts = (alignment.knownFacts ?? []).filter((item) => typeof item === "string" && item.trim().length > 0);
  const unknowns = (alignment.unknowns ?? []).filter((item) => typeof item === "string" && item.trim().length > 0);
  const mustDecide = typeof alignment.mustDecide === "string" ? alignment.mustDecide.trim() : "";
  const askFirst = typeof alignment.askFirst === "string" ? alignment.askFirst.trim() : "";
  if (!knownFacts.length && !unknowns.length && !mustDecide && !askFirst) {
    return "";
  }

  const knownLabel = language === "ko" ? "이미 확정된 사실" : language === "zh" ? "已确认事实" : "Settled facts";
  const unknownLabel = language === "ko" ? "아직 모르는 것" : language === "zh" ? "待确认空白" : "Open unknowns";
  const decideLabel = language === "ko" ? "이번 편집에서 반드시 결정할 것" : language === "zh" ? "本轮必须确定的决定" : "Decision required in this pass";
  const askLabel = language === "ko" ? "먼저 물어볼 질문" : language === "zh" ? "优先提问" : "Ask first";

  return [
    knownFacts.length > 0 ? `${knownLabel}:\n${knownFacts.map((item) => `- ${item}`).join("\n")}` : "",
    unknowns.length > 0 ? `${unknownLabel}:\n${unknowns.map((item) => `- ${item}`).join("\n")}` : "",
    mustDecide ? `${decideLabel}:\n${mustDecide}` : "",
    askFirst ? `${askLabel}:\n${askFirst}` : "",
  ].filter(Boolean).join("\n\n");
}

function buildTruthAlignmentPolicy(
  alignment: TruthAssistAlignmentPayload | undefined,
  language: StudioLanguage,
  mode: "proposal" | "question",
): string {
  const safeAlignment = {
    knownFacts: (alignment?.knownFacts ?? []).filter((item) => typeof item === "string" && item.trim().length > 0),
    unknowns: (alignment?.unknowns ?? []).filter((item) => typeof item === "string" && item.trim().length > 0),
    mustDecide: typeof alignment?.mustDecide === "string" ? alignment.mustDecide.trim() : "",
    askFirst: typeof alignment?.askFirst === "string" ? alignment.askFirst.trim() : "",
  };
  const hasConstraint = safeAlignment.knownFacts.length > 0
    || safeAlignment.unknowns.length > 0
    || Boolean(safeAlignment.mustDecide)
    || Boolean(safeAlignment.askFirst);

  if (mode === "question") {
    let askRule = "";
    if (safeAlignment.askFirst) {
      if (language === "ko") {
        askRule = `우선 묻는 질문을 그대로 사용: "${safeAlignment.askFirst}"`;
      } else if (language === "zh") {
        askRule = `先问的问题必须是：${safeAlignment.askFirst}`;
      } else {
        askRule = `Ask first: "${safeAlignment.askFirst}" must be asked first`;
      }
    } else if (language === "ko") {
      askRule = "최우선 질문이 없으면 열린 의심을 가장 빠르게 줄일 수 있는 핵심 질문 하나만 하라.";
    } else if (language === "zh") {
      askRule = "若未提供优先问题，则提出一个能最快缩小关键不确定性的单一问题。";
    } else {
      askRule = "If no explicit first question is given, ask exactly one question that reduces the largest uncertainty.";
    }

    let knownRule = "";
    if (safeAlignment.knownFacts.length > 0) {
      if (language === "ko") {
        knownRule = `이미 확정된 사실은 유지/수용한다: ${safeAlignment.knownFacts.join(" / ")}`;
      } else if (language === "zh") {
        knownRule = `已确认事实必须保留：${safeAlignment.knownFacts.join(" / ")}`;
      } else {
        knownRule = `Known facts must be preserved: ${safeAlignment.knownFacts.join(" / ")}`;
      }
    }

    let unknownRule = "";
    if (safeAlignment.unknowns.length > 0) {
      if (language === "ko") {
        unknownRule = `미해결 의문을 임의로 추측해 채우면 안 된다: ${safeAlignment.unknowns.join(" / ")}`;
      } else if (language === "zh") {
        unknownRule = `未确认空白不得凭空补充：${safeAlignment.unknowns.join(" / ")}`;
      } else {
        unknownRule = `Unresolved gaps must not be filled with speculation: ${safeAlignment.unknowns.join(" / ")}`;
      }
    }

    let decisionRule = "";
    if (safeAlignment.mustDecide) {
      if (language === "ko") {
        decisionRule = `반드시 남길 결정: ${safeAlignment.mustDecide}`;
      } else if (language === "zh") {
        decisionRule = `必须保留的决策：${safeAlignment.mustDecide}`;
      } else {
        decisionRule = `Must preserve decision target: ${safeAlignment.mustDecide}`;
      }
    }
    const antiRule = language === "ko"
      ? "근거가 없는 설정 확장/변형은 하지 않는다."
      : language === "zh"
        ? "禁止在缺乏证据的情况下扩展设定。"
        : "Do not introduce setting changes without evidence.";

    const questionRules = [
      askRule,
      knownRule,
      unknownRule,
      decisionRule,
      antiRule,
    ].filter(Boolean);

    return [
      language === "ko" ? "정렬 인터뷰어 제약:" : language === "zh" ? "对齐访谈约束：" : "Alignment interviewer constraints:",
      ...questionRules.map((rule) => `- ${rule}`),
    ].join("\n");
  }

  if (!hasConstraint) {
    return language === "ko"
      ? "문헌·대화·정렬 메모에서 근거 없는 내용은 쓰지 않는다."
      : language === "zh"
        ? "只使用现有文档、对话和对齐备忘中的支持信息，不得无凭证编造。"
        : "Use only grounded source/context and alignment notes; do not invent unsupported details.";
  }

  const decided = safeAlignment.mustDecide
    ? language === "ko"
      ? `반드시 결정해야 할 항목 유지/반영: ${safeAlignment.mustDecide}`
      : language === "zh"
        ? `必须保留/呈现的核心决策：${safeAlignment.mustDecide}`
        : `Must preserve the decision requirement: ${safeAlignment.mustDecide}`
    : "";

  const knownAnchor = language === "ko"
    ? "\"이미 아는 것\"은 문서의 기준 정보로 고정하고 임의로 바꾸지 않는다."
    : language === "zh"
      ? "\"已确认事实\"视为基准信息，不得擅自改写。"
      : "\"Known facts\" are fixed anchors and must not be rewritten arbitrarily.";
  const unknownAnchor = language === "ko"
    ? "\"아직 모르는 것\"은 대화 맥락 또는 지원 문맥으로만 보완하고, 근거가 없으면 유지한다."
    : language === "zh"
      ? "\"待确认空白\"只能根据现有上下文补充；无依据时保持原样。"
      : "Fill \"open unknowns\" only from available context; keep unchanged if unsupported.";
  const antiHallucination = language === "ko"
    ? "근거가 없는 세계관 확장이나 설정 변경은 금지한다."
    : language === "zh"
      ? "禁止编造新的设定拓展或擅自改变既有设定。"
      : "Never introduce new lore or setting shifts without evidence.";

  const blocks = [
    knownAnchor,
    unknownAnchor,
    decided,
    language === "ko"
      ? "필요한 결정은 반영하며, 대체안을 임의로 만들지 않는다."
      : language === "zh"
        ? "必须反映必要的决策，不得自行臆造替代方案。"
        : "Keep required decisions in place and do not invent alternatives.",
    antiHallucination,
  ].filter(Boolean);

  return [
    language === "ko" ? "정렬 제약:" : language === "zh" ? "对齐约束：" : "Alignment constraints:",
    ...blocks.map((block) => `- ${block}`),
  ].join("\n");
}

function parseTruthInterviewResponse(content: string): { question: string; rationale: string } {
  const trimmed = content.trim();
  if (!trimmed) {
    return { question: "", rationale: "" };
  }

  try {
    const parsed = JSON.parse(trimmed) as { question?: unknown; rationale?: unknown; reason?: unknown };
    return {
      question: typeof parsed.question === "string" ? parsed.question.trim() : "",
      rationale: typeof parsed.rationale === "string"
        ? parsed.rationale.trim()
        : typeof parsed.reason === "string"
          ? parsed.reason.trim()
          : "",
    };
  } catch {
    const questionMatch = trimmed.match(/question\s*:\s*(.+)/i);
    const rationaleMatch = trimmed.match(/(?:rationale|reason)\s*:\s*(.+)/i);
    return {
      question: questionMatch?.[1]?.trim() ?? trimmed.split("\n")[0]?.trim() ?? "",
      rationale: rationaleMatch?.[1]?.trim() ?? "",
    };
  }
}

interface StoredRadarScan {
  readonly kind: "inkos-radar-scan";
  readonly version: 1;
  readonly status: "succeeded" | "failed";
  readonly mode: RadarMode;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly savedAt: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly progress: RadarProgressSnapshot | null;
  readonly result: RadarResult | null;
  readonly error: string | null;
  readonly fitCheckMetadata?: RadarFitCheckMetadata;
}

function sanitizeStoredModelOverrides(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const sanitized: Record<string, unknown> = {};
  const validProviders = new Set(["anthropic", "openai", "custom", "gemini-cli", "codex-cli"]);
  const validReasoning = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

  for (const [agent, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") {
      const model = value.trim();
      if (model) sanitized[agent] = model;
      continue;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const candidate = value as Record<string, unknown>;
    const model = typeof candidate.model === "string" ? candidate.model.trim() : "";
    if (!model) continue;

    const provider = typeof candidate.provider === "string" && validProviders.has(candidate.provider)
      ? candidate.provider
      : undefined;
    const baseUrl = typeof candidate.baseUrl === "string" && candidate.baseUrl.trim().length > 0
      ? candidate.baseUrl.trim()
      : undefined;
    const apiKeyEnv = typeof candidate.apiKeyEnv === "string" && candidate.apiKeyEnv.trim().length > 0
      ? candidate.apiKeyEnv.trim()
      : undefined;
    const reasoningEffort = typeof candidate.reasoningEffort === "string" && validReasoning.has(candidate.reasoningEffort)
      ? candidate.reasoningEffort
      : undefined;
    const stream = typeof candidate.stream === "boolean" ? candidate.stream : undefined;

    sanitized[agent] = {
      model,
      ...(provider ? { provider } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiKeyEnv ? { apiKeyEnv } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(stream !== undefined ? { stream } : {}),
    };
  }

  return sanitized;
}

function resolveStudioLanguage(
  value: unknown,
  fallback: StudioLanguage = "ko",
): StudioLanguage {
  return value === "ko" || value === "zh" || value === "en" ? value : fallback;
}

function normalizeRadarMode(value: unknown): RadarMode {
  return value === "idea-mining" || value === "fit-check"
    ? value
    : value === "market-trends"
      ? value
      : "market-trends";
}

function defaultFanficGenreForLanguage(language: StudioLanguage): string {
  return language === "ko" ? "korean-other" : "other";
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function parseProgressStage(message: string): string | null {
  const trimmed = String(message ?? "").trim();
  if (!trimmed) return null;
  for (const prefix of ["Stage: ", "단계: ", "阶段："]) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim() || null;
    }
  }
  return null;
}

function trimBookCreateHistory(
  entries: ReadonlyArray<BookCreateStatusEntry["history"][number]>,
  limit = 10,
): ReadonlyArray<BookCreateStatusEntry["history"][number]> {
  return entries.slice(-limit);
}

function summarizeBookSetupFoundationPreview(proposal: ExactBookProposal, createdAt: string, revision: number): BookSetupFoundationPreviewPayload {
  return {
    createdAt,
    revision,
    digest: computeBookSetupFoundationPreviewDigest(proposal.foundation),
    storyBible: proposal.foundation.storyBible,
    volumeOutline: proposal.foundation.volumeOutline,
    bookRules: proposal.foundation.bookRules,
    currentState: proposal.foundation.currentState,
    pendingHooks: proposal.foundation.pendingHooks,
  };
}

function summarizeBookSetupSession(session: BookSetupSessionRecord): BookSetupSessionPayload {
  return {
    id: session.id,
    revision: session.revision,
    status: session.status,
    bookId: session.bookId,
    title: session.title,
    genre: session.genre,
    language: session.language,
    platform: session.platform,
    chapterWordCount: session.chapterWordCount,
    targetChapters: session.targetChapters,
    brief: session.brief,
    proposal: session.proposal,
    previousProposal: session.previousProposal,
    foundationPreview: session.foundationPreview,
    reviewThreads: session.reviewThreads,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function trimBookSetupSessions(limit = BOOK_SETUP_SESSION_LIMIT): ReadonlyArray<BookSetupSessionRecord> {
  const overflow = bookSetupSessions.size - limit;
  if (overflow <= 0) return [];
  const oldest = [...bookSetupSessions.values()]
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, overflow);
  for (const entry of oldest) {
    bookSetupSessions.delete(entry.id);
  }
  return oldest;
}

function normalizeBookSetupConversation(
  conversation: BookSetupProposalRequest["conversation"],
  language: StudioLanguage,
): string {
  return (conversation ?? [])
    .filter((entry): entry is NonNullable<BookSetupProposalRequest["conversation"]>[number] => (
      (entry?.role === "user" || entry?.role === "assistant")
      && typeof entry.content === "string"
      && entry.content.trim().length > 0
    ))
    .slice(-10)
    .map((entry) => `${entry.role === "user"
      ? language === "ko"
        ? "사용자"
        : language === "zh"
          ? "用户"
          : "User"
      : language === "ko"
        ? "어시스턴트"
        : language === "zh"
          ? "助手"
          : "Assistant"}: ${entry.content.trim()}`)
    .join("\n");
}

function extractMarkdownSection(markdown: string, heading: string): string | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const normalizedHeading = `## ${heading}`.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === normalizedHeading);
  if (start < 0) return null;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index]?.trim().startsWith("## ")) {
      end = index;
      break;
    }
  }

  const content = lines.slice(start + 1, end).join("\n").trim();
  return content || null;
}

function extractApprovedCreativeBrief(markdown: string): string {
  return extractMarkdownSection(markdown, "Approved Creative Brief") ?? markdown.trim();
}

async function resolveCommandPath(command: string): Promise<string | null> {
  const trimmed = command.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/")) {
    try {
      await access(trimmed);
      return trimmed;
    } catch {
      return null;
    }
  }

  for (const part of (process.env.PATH ?? "").split(delimiter)) {
    if (!part) continue;
    const candidate = join(part, trimmed);
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function getGeminiAuthPath(): string {
  const sourceHome = process.env.INKOS_GEMINI_CLI_SOURCE_HOME
    ?? process.env.GEMINI_CLI_HOME
    ?? homedir();
  return join(sourceHome, ".gemini", "oauth_creds.json");
}

function getCodexAuthPath(): string {
  const sourceHome = process.env.INKOS_CODEX_CLI_SOURCE_HOME
    ?? process.env.CODEX_HOME
    ?? join(homedir(), ".codex");
  return process.env.INKOS_CODEX_CLI_AUTH_SOURCE
    ?? join(sourceHome, "auth.json");
}

async function getAuthStatus(): Promise<GlobalConfigPayload["auth"]> {
  const [geminiCommandPath, codexCommandPath] = await Promise.all([
    resolveCommandPath("gemini"),
    resolveCommandPath("codex"),
  ]);

  let geminiDetails: string | undefined;
  try {
    const raw = JSON.parse(await readFile(join(resolveGeminiCliHomeForAuth(), ".gemini", "settings.json"), "utf-8")) as {
      security?: { auth?: { selectedType?: string } };
    };
    if (typeof raw.security?.auth?.selectedType === "string") {
      geminiDetails = raw.security.auth.selectedType;
    }
  } catch {
    geminiDetails = undefined;
  }

  let codexDetails: string | undefined;
  try {
    const raw = JSON.parse(await readFile(getCodexAuthPath(), "utf-8")) as { auth_mode?: string };
    if (typeof raw.auth_mode === "string") {
      codexDetails = raw.auth_mode;
    }
  } catch {
    codexDetails = undefined;
  }

  return {
    geminiCli: {
      available: geminiCommandPath !== null,
      authenticated: existsSync(getGeminiAuthPath()),
      credentialPath: getGeminiAuthPath(),
      command: "gemini",
      details: geminiDetails,
    },
    codexCli: {
      available: codexCommandPath !== null,
      authenticated: existsSync(getCodexAuthPath()),
      credentialPath: getCodexAuthPath(),
      command: "codex",
      details: codexDetails,
    },
  };
}

async function readGlobalConfigSummary(): Promise<GlobalConfigPayload> {
  const { parsed, exists } = await readGlobalEnvEntries();

  return {
    exists,
    language: resolveStudioLanguage(parsed.INKOS_DEFAULT_LANGUAGE, "ko"),
    provider: parsed.INKOS_LLM_PROVIDER ?? "",
    model: parsed.INKOS_LLM_MODEL ?? "",
    reasoningEffort: parsed.INKOS_LLM_REASONING_EFFORT ?? "",
    baseUrl: parsed.INKOS_LLM_BASE_URL ?? "",
    apiKeySet: typeof parsed.INKOS_LLM_API_KEY === "string" && parsed.INKOS_LLM_API_KEY.trim().length > 0,
    auth: await getAuthStatus(),
  };
}

async function readGlobalEnvEntries(): Promise<{
  readonly parsed: Record<string, string>;
  readonly exists: boolean;
}> {
  const { parse: parseEnv } = await import("dotenv");

  try {
    return {
      parsed: parseEnv(await readFile(GLOBAL_ENV_PATH, "utf-8")),
      exists: true,
    };
  } catch {
    return {
      parsed: {},
      exists: false,
    };
  }
}

function buildGlobalConfigLines(entries: {
  readonly language: StudioLanguage;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}): string {
  const lines = [
    "# InkOS Global LLM Configuration",
    `INKOS_LLM_PROVIDER=${entries.provider}`,
  ];
  if (entries.baseUrl) lines.push(`INKOS_LLM_BASE_URL=${entries.baseUrl}`);
  if (entries.apiKey) lines.push(`INKOS_LLM_API_KEY=${entries.apiKey}`);
  lines.push(`INKOS_LLM_MODEL=${entries.model}`);
  if (entries.reasoningEffort) lines.push(`INKOS_LLM_REASONING_EFFORT=${entries.reasoningEffort}`);
  lines.push(`INKOS_DEFAULT_LANGUAGE=${entries.language}`);
  return `${lines.join("\n")}\n`;
}

async function writeGlobalConfig(payload: {
  readonly language?: StudioLanguage;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
}): Promise<void> {
  const { GLOBAL_CONFIG_DIR } = await import("@actalk/inkos-core");
  const { mkdir, writeFile } = await import("node:fs/promises");

  await mkdir(GLOBAL_CONFIG_DIR ?? dirname(GLOBAL_ENV_PATH), { recursive: true });
  const { parsed: existing } = await readGlobalEnvEntries();

  const provider = String(payload.provider ?? "").trim();
  const existingProvider = String(existing.INKOS_LLM_PROVIDER ?? "").trim();
  const cliOAuthProvider = isCliOAuthProvider(provider);
  const model = String(payload.model ?? "").trim()
    || defaultModelForProvider(provider);
  const rawBaseUrl = String(payload.baseUrl ?? "").trim();
  const rawApiKey = String(payload.apiKey ?? "").trim();
  const baseUrl = rawBaseUrl
    || (!cliOAuthProvider && existingProvider === provider ? String(existing.INKOS_LLM_BASE_URL ?? "").trim() : "");
  const apiKey = rawApiKey
    || (!cliOAuthProvider && existingProvider === provider ? String(existing.INKOS_LLM_API_KEY ?? "").trim() : "");
  const language = resolveStudioLanguage(payload.language ?? existing.INKOS_DEFAULT_LANGUAGE, "ko");
  const reasoningCandidate = String(payload.reasoningEffort ?? "").trim();
  const reasoningEffort = ["none", "minimal", "low", "medium", "high", "xhigh"].includes(reasoningCandidate)
    ? reasoningCandidate
    : "";

  if (!provider) {
    throw new ApiError(400, "INVALID_PROVIDER", "provider is required");
  }
  if (!model) {
    throw new ApiError(400, "INVALID_MODEL", "model is required");
  }
  if (!cliOAuthProvider && !baseUrl) {
    throw new ApiError(400, "INVALID_BASE_URL", "baseUrl is required unless provider is gemini-cli or codex-cli");
  }
  if (!cliOAuthProvider && !apiKey) {
    throw new ApiError(400, "INVALID_API_KEY", "apiKey is required unless provider is gemini-cli or codex-cli");
  }

  await writeFile(GLOBAL_ENV_PATH, buildGlobalConfigLines({
    language,
    provider,
    model,
    reasoningEffort,
    baseUrl,
    apiKey,
  }), "utf-8");

  process.env.INKOS_LLM_PROVIDER = provider;
  process.env.INKOS_LLM_MODEL = model;
  if (reasoningEffort) process.env.INKOS_LLM_REASONING_EFFORT = reasoningEffort;
  else delete process.env.INKOS_LLM_REASONING_EFFORT;
  if (baseUrl) process.env.INKOS_LLM_BASE_URL = baseUrl;
  else delete process.env.INKOS_LLM_BASE_URL;
  if (apiKey) process.env.INKOS_LLM_API_KEY = apiKey;
  else delete process.env.INKOS_LLM_API_KEY;
  process.env.INKOS_DEFAULT_LANGUAGE = language;
}

function syncProjectRuntimeLlmEnv(llm: {
  readonly provider?: unknown;
  readonly model?: unknown;
  readonly reasoningEffort?: unknown;
  readonly baseUrl?: unknown;
  readonly temperature?: unknown;
  readonly maxTokens?: unknown;
}): void {
  const provider = String(llm.provider ?? "").trim();
  const model = String(llm.model ?? "").trim() || defaultModelForProvider(provider);
  const reasoningEffort = String(llm.reasoningEffort ?? "").trim();
  const baseUrl = String(llm.baseUrl ?? "").trim();

  if (provider) process.env.INKOS_LLM_PROVIDER = provider;
  else delete process.env.INKOS_LLM_PROVIDER;

  if (model) process.env.INKOS_LLM_MODEL = model;
  else delete process.env.INKOS_LLM_MODEL;

  if (["none", "minimal", "low", "medium", "high", "xhigh"].includes(reasoningEffort)) {
    process.env.INKOS_LLM_REASONING_EFFORT = reasoningEffort;
  } else {
    delete process.env.INKOS_LLM_REASONING_EFFORT;
  }

  if (baseUrl) process.env.INKOS_LLM_BASE_URL = baseUrl;
  else delete process.env.INKOS_LLM_BASE_URL;

  if (typeof llm.temperature === "number" && Number.isFinite(llm.temperature)) {
    process.env.INKOS_LLM_TEMPERATURE = String(llm.temperature);
  } else {
    delete process.env.INKOS_LLM_TEMPERATURE;
  }

  if (typeof llm.maxTokens === "number" && Number.isFinite(llm.maxTokens)) {
    process.env.INKOS_LLM_MAX_TOKENS = String(llm.maxTokens);
  } else {
    delete process.env.INKOS_LLM_MAX_TOKENS;
  }
}

async function initializeProjectAtRoot(root: string, options: {
  readonly name?: string;
  readonly language?: StudioLanguage;
}): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");

  const language = resolveStudioLanguage(options.language, "ko");
  const projectName = String(options.name ?? basename(root)).trim() || basename(root);
  const globalConfig = await readGlobalConfigSummary();

  await mkdir(join(root, "books"), { recursive: true });
  await mkdir(join(root, "radar"), { recursive: true });

  const config = {
    name: projectName,
    version: "0.1.0",
    language,
    llm: {
      provider: globalConfig.provider || "openai",
      baseUrl: isCliOAuthProvider(globalConfig.provider) ? "" : globalConfig.baseUrl,
      model: globalConfig.model || defaultModelForProvider(globalConfig.provider),
    },
    notify: [],
    daemon: {
      schedule: {
        radarCron: "0 */6 * * *",
        writeCron: "*/15 * * * *",
      },
      maxConcurrentBooks: 3,
    },
  };

  await writeFile(join(root, "inkos.json"), JSON.stringify(config, null, 2), "utf-8");
  await writeFile(join(root, ".nvmrc"), "22\n", "utf-8");
  await writeFile(join(root, ".node-version"), "22\n", "utf-8");

  const envLines = globalConfig.exists
    ? [
        "# Project-level LLM overrides (optional)",
        "# Global config at ~/.inkos/.env will be used by default.",
        "# Uncomment below to override for this project only:",
        "# INKOS_LLM_PROVIDER=openai          # or gemini-cli / codex-cli",
        "# INKOS_LLM_BASE_URL=",
        "# INKOS_LLM_API_KEY=",
        "# INKOS_LLM_MODEL=",
        "",
        "# Web search (optional):",
        "# TAVILY_API_KEY=tvly-xxxxx",
      ]
    : [
        "# LLM Configuration",
        "# Tip: Configure global access in Studio Settings or with 'inkos config set-global'.",
        "# Provider: openai / anthropic / custom / gemini-cli / codex-cli",
        "# Uncomment the lines below to use project-specific overrides:",
        "# INKOS_LLM_PROVIDER=openai",
        "# INKOS_LLM_BASE_URL=",
        "# INKOS_LLM_API_KEY=",
        "# INKOS_LLM_MODEL=",
      ];
  await writeFile(join(root, ".env"), `${envLines.join("\n")}\n`, "utf-8");
  await writeFile(join(root, ".gitignore"), [".env", "node_modules/", ".DS_Store", ".inkos/"].join("\n"), "utf-8");
}

function summarizeAuthSession(session: AuthSessionRecord): AuthSessionPayload {
  return {
    id: session.id,
    provider: session.provider,
    status: session.status,
    url: session.url ?? null,
    verificationCode: session.verificationCode ?? null,
    error: session.error ?? null,
    logs: session.logs.slice(-20),
  };
}

function appendAuthLog(session: AuthSessionRecord, chunk: Buffer | string): void {
  const text = stripAnsi(String(chunk));
  if (!text) return;
  session.logs.push(text);

  if (!session.url) {
    const urlMatch = text.match(/https:\/\/[^\s)]+/);
    if (urlMatch) session.url = urlMatch[0];
  }

  if (session.provider === "codex-cli" && !session.verificationCode) {
    const codeMatch = text.match(/\b[A-Z0-9]{4,}-[A-Z0-9]{4,}\b/);
    if (codeMatch) session.verificationCode = codeMatch[0];
  }

  if (session.provider === "gemini-cli") {
    if (text.includes("Enter the authorization code:")) {
      session.status = "awaiting-code";
      return;
    }
    if (session.url || /authentication/i.test(text)) {
      session.status = "waiting-browser";
    }
    return;
  }

  if (session.url || session.verificationCode) {
    session.status = "waiting-browser";
  }
}

function attachAuthSessionListeners(session: AuthSessionRecord): void {
  if (!session.child) return;

  const consume = (chunk: Buffer | string) => {
    appendAuthLog(session, chunk);
  };

  const stdout = session.child.stdout;
  if (stdout) {
    stdout.on("data", consume);
  }
  const stderr = session.child.stderr;
  if (stderr) {
    stderr.on("data", consume);
  }
  session.child.on("error", (error) => {
    session.status = "failed";
    session.error = error.message;
  });
  session.child.on("exit", (code) => {
    void (async () => {
      if (code === 0) {
        const auth = await getAuthStatus();
        const key: keyof Awaited<ReturnType<typeof getAuthStatus>> =
          session.provider === "gemini-cli" ? "geminiCli" : "codexCli";
        if (auth[key].authenticated) {
          session.status = "succeeded";
          return;
        }
      }
      if (session.status !== "succeeded") {
        session.status = "failed";
        session.error = session.error ?? `Authentication exited with code ${code ?? 1}.`;
      }
    })();
  });
}

async function resolveGeminiCliPackageRoot(commandPath: string): Promise<string> {
  const realCommandPath = await realpath(commandPath);
  return dirname(dirname(realCommandPath));
}

async function runGeminiOAuthSession(session: AuthSessionRecord, commandPath: string): Promise<void> {
  const geminiCliHome = resolveGeminiCliHomeForAuth();
  const previousGeminiCliHome = process.env.GEMINI_CLI_HOME;
  try {
    const packageRoot = await resolveGeminiCliPackageRoot(commandPath);
    const coreRoot = join(packageRoot, "node_modules", "@google", "gemini-cli-core", "dist", "src");

    const [{ getOauthClient, clearOauthClientCache }, { AuthType }, { coreEvents, CoreEvent }] = await Promise.all([
      import(pathToFileURL(join(coreRoot, "code_assist", "oauth2.js")).href),
      import(pathToFileURL(join(coreRoot, "core", "contentGenerator.js")).href),
      import(pathToFileURL(join(coreRoot, "utils", "events.js")).href),
    ]);

    const handleFeedback = (payload: { readonly message?: string; readonly severity?: string }) => {
      appendAuthLog(session, payload.message ?? "");
      if (payload.severity === "error" && payload.message && !session.error) {
        session.error = payload.message;
      }
    };
    const handleConsent = (payload: { readonly prompt?: string; readonly onConfirm?: (confirmed: boolean) => void }) => {
      appendAuthLog(session, payload.prompt ?? "Gemini CLI login requested.");
      session.status = "waiting-browser";
      payload.onConfirm?.(true);
    };

    process.env.GEMINI_CLI_HOME = geminiCliHome;
    coreEvents.on(CoreEvent.UserFeedback, handleFeedback);
    coreEvents.on(CoreEvent.ConsentRequest, handleConsent);

    session.status = "authorizing";
    try {
      await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, {
        getProxy: () => undefined,
        isBrowserLaunchSuppressed: () => false,
      });

      if (!existsSync(getGeminiAuthPath())) {
        throw new Error(`Gemini CLI did not write credentials to ${getGeminiAuthPath()}.`);
      }

      appendAuthLog(session, "Gemini CLI authentication completed.");
      session.status = "succeeded";
    } finally {
      clearOauthClientCache();
      coreEvents.off(CoreEvent.UserFeedback, handleFeedback);
      coreEvents.off(CoreEvent.ConsentRequest, handleConsent);
    }
  } catch (error) {
    session.status = "failed";
    session.error = error instanceof Error ? error.message : String(error);
    appendAuthLog(session, session.error);
  } finally {
    if (previousGeminiCliHome) {
      process.env.GEMINI_CLI_HOME = previousGeminiCliHome;
    } else {
      delete process.env.GEMINI_CLI_HOME;
    }
  }
}

async function startOAuthSession(provider: CliOAuthProvider): Promise<AuthSessionRecord> {
  const id = `${provider}-${Date.now().toString(36)}`;
  const session: AuthSessionRecord = {
    id,
    provider,
    status: "starting",
    logs: [],
  };
  authSessions.set(id, session);

  if (provider === "codex-cli") {
    const commandPath = await resolveCommandPath("codex");
    if (!commandPath) {
      authSessions.delete(id);
      throw new ApiError(400, "AUTH_COMMAND_NOT_FOUND", "codex CLI is not installed or not in PATH.");
    }
    session.child = spawn(commandPath, ["login", "--device-auth"], {
      env: {
        ...process.env,
        CODEX_HOME: process.env.INKOS_CODEX_CLI_SOURCE_HOME
          ?? process.env.CODEX_HOME
          ?? join(homedir(), ".codex"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    attachAuthSessionListeners(session);
    return session;
  }

  const commandPath = await resolveCommandPath("gemini");
  if (!commandPath) {
    authSessions.delete(id);
    throw new ApiError(400, "AUTH_COMMAND_NOT_FOUND", "gemini CLI is not installed or not in PATH.");
  }
  appendAuthLog(session, `Using Gemini CLI at ${commandPath}`);
  void runGeminiOAuthSession(session, commandPath);
  return session;
}

function resolveGeminiCliHomeForAuth(): string {
  return process.env.INKOS_GEMINI_CLI_SOURCE_HOME
    ?? process.env.GEMINI_CLI_HOME
    ?? homedir();
}

function submitOAuthCode(sessionId: string, code: string): AuthSessionPayload {
  const session = authSessions.get(sessionId);
  if (!session) {
    throw new ApiError(404, "AUTH_SESSION_NOT_FOUND", `Auth session "${sessionId}" not found.`);
  }
  if (session.provider !== "gemini-cli") {
    throw new ApiError(400, "AUTH_CODE_UNSUPPORTED", "Only gemini-cli requires manual code submission.");
  }
  if (session.status !== "awaiting-code") {
    throw new ApiError(400, "AUTH_CODE_NOT_READY", `Gemini auth session is not waiting for a code (status=${session.status}).`);
  }
  if (!session.child?.stdin) {
    throw new ApiError(400, "AUTH_CODE_UNSUPPORTED", "This gemini-cli auth flow does not accept manual verification codes.");
  }
  session.status = "authorizing";
  const stdin = session.child.stdin;
  stdin?.write(`${code.trim()}\n`);
  return summarizeAuthSession(session);
}

function fanoutEvent(event: string, data: unknown): void {
  for (const handler of subscribers) {
    handler(event, data);
  }
}

function isRadarResult(value: unknown): value is RadarResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.marketSummary === "string" && Array.isArray(record.recommendations);
}

function isRadarMode(value: unknown): value is RadarMode {
  return value === "market-trends" || value === "idea-mining" || value === "fit-check";
}

function isStringArray(value: unknown): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRadarFitCheckMetadata(value: unknown): value is RadarFitCheckMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.bookId === "string"
    && record.bookId.trim().length > 0
    && typeof record.bookTitle === "string"
    && record.bookTitle.trim().length > 0
    && isStringArray(record.sourceFiles)
    && typeof record.contextPreview === "string"
    && typeof record.contextLength === "number"
    && record.contextLength >= 0
    && (record.note === null || typeof record.note === "string");
}

async function readFitCheckContextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

function buildFitCheckContextPreview(context: string): string {
  return context.trim().slice(0, RADAR_FIT_CHECK_PREVIEW_LIMIT);
}

async function buildFitCheckContextFromBook(
  state: StateManager,
  bookId: string,
  note?: string,
): Promise<{ context: string | undefined; metadata: RadarFitCheckMetadata }> {
  if (!isSafeBookId(bookId)) {
    throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
  }

  const book = await state.loadBookConfig(bookId).catch((error) => {
    if (
      error instanceof Error
      && ("code" in error)
      && typeof (error as NodeJS.ErrnoException).code === "string"
      && (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new ApiError(404, "BOOK_NOT_FOUND", `Book "${bookId}" not found`);
    }
    throw error;
  });
  const rawBookTitle = typeof (book as { title?: unknown }).title === "string"
    ? (book as { title: string }).title.trim()
    : "";
  const bookTitle = rawBookTitle || bookId;

  const bookDir = state.bookDir(bookId);
  const sourceFiles: string[] = [];
  const fragments: string[] = [];
  const noteText = note?.trim();

  for (const fileName of RADAR_FIT_CHECK_CONTEXT_FILES) {
    const content = await readFitCheckContextFile(join(bookDir, "story", fileName));
    if (!content || !content.trim()) continue;
    sourceFiles.push(fileName);
    fragments.push(`## ${fileName}\n${content.trim()}`);
  }

  if (noteText) {
    fragments.push(`# Note\n${noteText}`);
  }

  const context = fragments.length > 0 ? fragments.join("\n\n").trim() : "";

  return {
    context: context.length > 0 ? context : undefined,
    metadata: {
      bookId,
      bookTitle,
      sourceFiles,
      contextPreview: buildFitCheckContextPreview(context),
      contextLength: context.length,
      note: noteText ?? null,
    },
  };
}

function isStoredRadarScan(value: unknown): value is StoredRadarScan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.kind === "inkos-radar-scan"
    && record.version === 1
    && (record.mode === undefined || isRadarMode(record.mode))
    && (record.status === "succeeded" || record.status === "failed")
    && typeof record.savedAt === "string"
    && (record.result === null || record.result === undefined || isRadarResult(record.result))
    && (record.error === null || record.error === undefined || typeof record.error === "string")
    && (record.fitCheckMetadata === undefined || isRadarFitCheckMetadata(record.fitCheckMetadata));
}

function radarScanFileName(date = new Date()): string {
  return `scan-${date.toISOString().replace(/[:.]/g, "-")}.json`;
}

function radarEntryFromFile(
  fileName: string,
  savedAtDate: Date,
  payload: unknown,
): RadarHistoryEntry | null {
  const savedPath = `radar/${fileName}`;
  const savedAt = savedAtDate.toISOString();

  if (isStoredRadarScan(payload)) {
    return {
      id: fileName,
      savedPath,
      savedAt: payload.savedAt || savedAt,
      status: payload.status,
      mode: isRadarMode(payload.mode) ? payload.mode : "market-trends",
      startedAt: payload.startedAt,
      finishedAt: payload.finishedAt,
      provider: payload.provider,
      model: payload.model,
      result: payload.result,
      error: payload.error,
      fitCheckMetadata: payload.fitCheckMetadata,
    };
  }

  if (isRadarResult(payload)) {
    return {
      id: fileName,
      savedPath,
      savedAt,
      status: "succeeded",
      mode: "market-trends",
      startedAt: null,
      finishedAt: savedAt,
      provider: null,
      model: null,
      result: payload,
      error: null,
      fitCheckMetadata: undefined,
    };
  }

  return null;
}

async function readRadarHistory(root: string, limit = RADAR_HISTORY_LIMIT): Promise<ReadonlyArray<RadarHistoryEntry>> {
  const radarDir = join(root, "radar");
  let files: string[];
  try {
    files = (await readdir(radarDir))
      .filter((name) => /^scan-.*\.json$/i.test(name))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, limit);
  } catch {
    return [];
  }

  const entries = await Promise.all(files.map(async (fileName) => {
    try {
      const fullPath = join(radarDir, fileName);
      const [raw, fileStat] = await Promise.all([
        readFile(fullPath, "utf-8"),
        stat(fullPath),
      ]);
      return radarEntryFromFile(fileName, fileStat.mtime, JSON.parse(raw));
    } catch {
      return null;
    }
  }));

  return entries.filter((entry): entry is RadarHistoryEntry => entry !== null);
}

async function persistRadarHistory(root: string, record: StoredRadarScan): Promise<RadarHistoryEntry> {
  const radarDir = join(root, "radar");
  await mkdir(radarDir, { recursive: true });
  const fileName = radarScanFileName(new Date(record.savedAt));
  await writeFile(join(radarDir, fileName), JSON.stringify(record, null, 2), "utf-8");
  const entry = radarEntryFromFile(fileName, new Date(record.savedAt), record);
  if (!entry) {
    throw new Error(`Failed to read persisted radar scan: ${fileName}`);
  }
  return entry;
}

function radarStatusFromHistory(entry: RadarHistoryEntry): RadarStatusSummary {
  return {
    status: entry.status,
    mode: entry.mode,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt ?? entry.savedAt,
    progress: null,
    result: entry.result,
    error: entry.error,
    fitCheckMetadata: entry.fitCheckMetadata,
  };
}

// --- Server factory ---

export function createStudioServer(initialConfig: ProjectConfig | null, root: string) {
  bookCreateStatus.clear();
  bookSetupSessions.clear();
  createIdempotencyRecords.clear();
  const app = new Hono();
  const state = new StateManager(root);
  let cachedConfig = initialConfig;
  let radarScanInFlight: Promise<void> | null = null;
  let recentActivity: Array<{ event: string; data: unknown; timestamp: number }> = [];
  let radarState: RadarStatusSummary = {
    status: "idle",
    mode: "market-trends",
    startedAt: null,
    finishedAt: null,
    progress: null,
    result: null,
    error: null,
  };
  const broadcast = (event: string, data: unknown): void => {
    recentActivity = [...recentActivity.slice(-199), { event, data, timestamp: Date.now() }];
    fanoutEvent(event, data);
  };

  async function hydrateRadarStateFromDisk(): Promise<void> {
    if (radarScanInFlight) return;
    if (radarState.status !== "idle" || radarState.result || radarState.error) return;
    const [latest] = await readRadarHistory(root, 1);
    if (!latest) return;
    radarState = radarStatusFromHistory(latest);
  }

  app.use("/*", cors());

  // Structured error handler — ApiError returns typed JSON, others return 500
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } },
      500,
    );
  });

  // BookId validation middleware — blocks path traversal on all book routes
  app.use("/api/books/:id/*", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });
  app.use("/api/books/:id", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });

  // Logger sink that broadcasts to SSE
  const sseSink: LogSink = {
    write(entry: LogEntry): void {
      broadcast("log", { level: entry.level, tag: entry.tag, message: entry.message });
    },
  };

  async function loadCurrentProjectConfig(
    options?: { readonly requireApiKey?: boolean },
  ): Promise<ProjectConfig> {
    try {
      await access(join(root, "inkos.json"));
    } catch {
      throw new ApiError(
        409,
        "PROJECT_NOT_INITIALIZED",
        `No InkOS project found in ${root}. Initialize one from Studio first.`,
      );
    }
    const freshConfig = await loadProjectConfig(root, options);
    cachedConfig = freshConfig;
    return freshConfig;
  }

  async function buildPipelineConfig(
    currentConfig?: ProjectConfig,
    options?: {
      readonly onStreamProgress?: NonNullable<PipelineConfig["onStreamProgress"]>;
      readonly extraSinks?: ReadonlyArray<LogSink>;
      readonly externalContext?: string;
    },
  ): Promise<PipelineConfig> {
    const resolvedConfig = currentConfig ?? await loadCurrentProjectConfig();
    const logger = createLogger({ tag: "studio", sinks: [sseSink, ...(options?.extraSinks ?? [])] });
    return {
      client: createLLMClient({
        ...resolvedConfig.llm,
        extra: { ...(resolvedConfig.llm.extra ?? {}), projectRoot: root },
      }),
      model: resolvedConfig.llm.model,
      projectRoot: root,
      language: resolvedConfig.language,
      defaultLLMConfig: resolvedConfig.llm,
      modelOverrides: resolvedConfig.modelOverrides,
      notifyChannels: resolvedConfig.notify,
      externalContext: options?.externalContext,
      logger,
      onStreamProgress: (progress) => {
        if (progress.status === "streaming") {
          broadcast("llm:progress", {
            elapsedMs: progress.elapsedMs,
            totalChars: progress.totalChars,
            chineseChars: progress.chineseChars,
          });
        }
        options?.onStreamProgress?.(progress);
      },
    };
  }

  // --- Books ---

  app.get("/api/books", async (c) => {
    const bookIds = await state.listBooks();
    const books = await Promise.all(
      bookIds.map(async (id) => {
        const book = await state.loadBookConfig(id);
        const nextChapter = await state.getNextChapterNumber(id);
        return { ...book, chaptersWritten: nextChapter - 1 };
      }),
    );
    return c.json({ books });
  });

  app.get("/api/books/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const book = await state.loadBookConfig(id);
      const chapters = await state.loadChapterIndex(id);
      const nextChapter = await state.getNextChapterNumber(id);
      return c.json({ book, chapters, nextChapter });
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });

  // --- Genres ---

  app.get("/api/genres", async (c) => {
    const { listAvailableGenres, readGenreProfile } = await import("@actalk/inkos-core");
    const rawGenres = await listAvailableGenres(root);
    const genres = await Promise.all(
      rawGenres.map(async (g) => {
        try {
          const { profile } = await readGenreProfile(root, g.id);
          return { ...g, language: resolveStudioLanguage(profile.language) };
        } catch {
          return { ...g, language: "ko" };
        }
      }),
    );
    return c.json({ genres });
  });

  // --- Book Create ---

  const inFlightBookCreates = new Set<string>();
  function reserveStudioBookCreate(bookId: string): () => void {
    const current = bookCreateStatus.get(bookId);
    if (inFlightBookCreates.has(bookId) || current?.status === "creating") {
      throw new ApiError(409, "BOOK_CREATE_ALREADY_IN_PROGRESS", `Book "${bookId}" is already being created.`);
    }
    inFlightBookCreates.add(bookId);
    return () => {
      inFlightBookCreates.delete(bookId);
    };
  }

  async function ensureStudioBookCreateAvailable(bookId: string): Promise<void> {
    const bookDir = state.bookDir(bookId);
    try {
      await access(join(bookDir, "book.json"));
      await access(join(bookDir, "story", "story_bible.md"));
    } catch {
      return;
    }
    throw new ApiError(409, "BOOK_ALREADY_EXISTS", `Book "${bookId}" already exists`);
  }

  async function queueStudioBookCreate(
    body: {
      readonly title: string;
      readonly genre: string;
      readonly language?: StudioLanguage;
      readonly platform?: string;
      readonly chapterWordCount?: number;
      readonly targetChapters?: number;
    },
    options?: {
      readonly externalContext?: string;
    },
  ): Promise<{ status: "creating"; bookId: string }> {
    const now = new Date().toISOString();
    const bookConfig = buildStudioBookConfig(body, now);
    const bookId = bookConfig.id;

    if (!bookId.trim()) {
      throw new ApiError(400, "INVALID_BOOK_TITLE", "Title must include letters or numbers.");
    }

    const releaseBookCreate = reserveStudioBookCreate(bookId);
    try {
      await ensureStudioBookCreateAvailable(bookId);

      broadcast("book:creating", { bookId, title: body.title });
      const startedAt = new Date().toISOString();
      bookCreateStatus.set(bookId, {
        bookId,
        title: body.title,
        status: "creating",
        startedAt,
        updatedAt: startedAt,
        stage: null,
        message: null,
        history: [
          {
            timestamp: startedAt,
            kind: "start",
            label: "book creation queued",
            detail: body.title,
          },
        ],
      });

      const statusSink: LogSink = {
        write(entry: LogEntry): void {
          const current = bookCreateStatus.get(bookId);
          if (!current || current.status !== "creating") return;
          const stage = parseProgressStage(entry.message);
          const updatedAt = new Date().toISOString();
          const kind = stage ? "stage" : "info";
          const label = stage ?? entry.message;
          const lastHistory = current.history.at(-1);
          const nextHistory = lastHistory && lastHistory.kind === kind && lastHistory.label === label
            ? current.history
            : trimBookCreateHistory([
                ...current.history,
                {
                  timestamp: updatedAt,
                  kind,
                  label,
                  detail: stage ? entry.message : null,
                },
              ]);
          const next: BookCreateStatusEntry = {
            ...current,
            updatedAt,
            stage: stage ?? current.stage,
            message: entry.message,
            history: nextHistory,
          };
          bookCreateStatus.set(bookId, next);
          broadcast("book:create:progress", {
            bookId,
            title: current.title,
            stage: next.stage,
            message: next.message,
            updatedAt,
          });
        },
      };

      const pipeline = new PipelineRunner(await buildPipelineConfig(undefined, {
        extraSinks: [statusSink],
        externalContext: options?.externalContext,
      }));
      pipeline.initBook(bookConfig).then(
        () => {
          releaseBookCreate();
          bookCreateStatus.delete(bookId);
          broadcast("book:created", { bookId });
        },
        (e: unknown) => {
          releaseBookCreate();
          const error = e instanceof Error ? e.message : String(e);
          const current = bookCreateStatus.get(bookId);
          bookCreateStatus.set(bookId, {
            bookId,
            title: current?.title ?? body.title,
            status: "error",
            startedAt: current?.startedAt ?? startedAt,
            updatedAt: new Date().toISOString(),
            stage: current?.stage ?? null,
            message: current?.message ?? null,
            history: trimBookCreateHistory([
              ...(current?.history ?? []),
              {
                timestamp: new Date().toISOString(),
                kind: "error",
                label: "book creation failed",
                detail: error,
              },
            ]),
            error,
          });
          broadcast("book:error", { bookId, title: body.title, error });
        },
      );

      return { status: "creating", bookId };
    } catch (error) {
      releaseBookCreate();
      bookCreateStatus.delete(bookId);
      throw error;
    }
  }

  async function queueStudioBookProposalApply(
    proposal: ExactBookProposal,
    options?: {
      readonly externalContext?: string;
    },
  ): Promise<{ status: "creating"; bookId: string }> {
    const bookId = proposal.book.id;
    if (!bookId.trim()) {
      throw new ApiError(400, "INVALID_BOOK_TITLE", "Title must include letters or numbers.");
    }

    const releaseBookCreate = reserveStudioBookCreate(bookId);
    try {
      await ensureStudioBookCreateAvailable(bookId);

      broadcast("book:creating", { bookId, title: proposal.book.title });
      const startedAt = new Date().toISOString();
      bookCreateStatus.set(bookId, {
        bookId,
        title: proposal.book.title,
        status: "creating",
        startedAt,
        updatedAt: startedAt,
        stage: null,
        message: null,
        history: [
          {
            timestamp: startedAt,
            kind: "start",
            label: "book creation queued",
            detail: proposal.book.title,
          },
        ],
      });

      const statusSink: LogSink = {
        write(entry: LogEntry): void {
          const current = bookCreateStatus.get(bookId);
          if (!current || current.status !== "creating") return;
          const stage = parseProgressStage(entry.message);
          const updatedAt = new Date().toISOString();
          const kind = stage ? "stage" : "info";
          const label = stage ?? entry.message;
          const lastHistory = current.history.at(-1);
          const nextHistory = lastHistory && lastHistory.kind === kind && lastHistory.label === label
            ? current.history
            : trimBookCreateHistory([
                ...current.history,
                {
                  timestamp: updatedAt,
                  kind,
                  label,
                  detail: stage ? entry.message : null,
                },
              ]);
          const next: BookCreateStatusEntry = {
            ...current,
            updatedAt,
            stage: stage ?? current.stage,
            message: entry.message,
            history: nextHistory,
          };
          bookCreateStatus.set(bookId, next);
          broadcast("book:create:progress", {
            bookId,
            title: current.title,
            stage: next.stage,
            message: next.message,
            updatedAt,
          });
        },
      };

      const pipeline = withExactBookProposalSupport(new PipelineRunner(await buildPipelineConfig(undefined, {
        extraSinks: [statusSink],
        externalContext: options?.externalContext,
      })));
      pipeline.applyBookProposal(proposal).then(
        () => {
          releaseBookCreate();
          bookCreateStatus.delete(bookId);
          broadcast("book:created", { bookId });
        },
        (e: unknown) => {
          releaseBookCreate();
          const error = e instanceof Error ? e.message : String(e);
          const current = bookCreateStatus.get(bookId);
          bookCreateStatus.set(bookId, {
            bookId,
            title: current?.title ?? proposal.book.title,
            status: "error",
            startedAt: current?.startedAt ?? startedAt,
            updatedAt: new Date().toISOString(),
            stage: current?.stage ?? null,
            message: current?.message ?? null,
            history: trimBookCreateHistory([
              ...(current?.history ?? []),
              {
                timestamp: new Date().toISOString(),
                kind: "error",
                label: "book creation failed",
                detail: error,
              },
            ]),
            error,
          });
          broadcast("book:error", { bookId, title: proposal.book.title, error });
        },
      );

      return { status: "creating", bookId };
    } catch (error) {
      releaseBookCreate();
      bookCreateStatus.delete(bookId);
      throw error;
    }
  }

  app.post("/api/book-setup/propose", async (c) => {
    const body = await c.req.json<BookSetupProposalRequest>().catch(() => ({} as BookSetupProposalRequest));
    const title = String(body.title ?? "").trim();
    const genre = String(body.genre ?? "").trim();
    const requestedSessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!title) {
      throw new ApiError(400, "TITLE_REQUIRED", "Title is required.");
    }
    if (!genre) {
      throw new ApiError(400, "GENRE_REQUIRED", "Genre is required.");
    }

    const currentConfig = await loadCurrentProjectConfig();
    const language = resolveStudioLanguage(body.language, resolveStudioLanguage(currentConfig.language, "ko"));
    const now = new Date().toISOString();
    const draft = buildStudioBookConfig({
      title,
      genre,
      language,
      platform: body.platform,
      chapterWordCount: body.chapterWordCount,
      targetChapters: body.targetChapters,
    }, now);
    if (!draft.id.trim()) {
      throw new ApiError(400, "INVALID_BOOK_TITLE", "Title must include letters or numbers.");
    }

    const revisingSession = requestedSessionId
      ? await findBookSetupSession(root, requestedSessionId)
      : null;
    if (requestedSessionId && !revisingSession) {
      throw new ApiError(404, "BOOK_SETUP_SESSION_NOT_FOUND", `Book setup session "${requestedSessionId}" not found.`);
    }
    if (revisingSession) {
      const expectedRevision = readBookSetupExpectedRevision(body, revisingSession.id);
      assertBookSetupExpectedRevision(revisingSession, expectedRevision, "revise the setup proposal");
      if (revisingSession.status === "creating") {
        throw new ApiError(409, "BOOK_SETUP_ALREADY_CREATING", `Book setup session "${revisingSession.id}" is already creating a book.`);
      }
    }

    const brief = typeof body.brief === "string" ? body.brief.trim() : "";
    const conversation = normalizeBookSetupConversation(body.conversation, language);
    const client = createLLMClient({
      ...currentConfig.llm,
      extra: { ...(currentConfig.llm.extra ?? {}), projectRoot: root },
    });
    const { chatCompletion } = await import("@actalk/inkos-core");
    const systemPrompt = language === "ko"
      ? [
          "당신은 InkOS의 책 생성 전 제안 설계자다.",
          "아직 어떤 파일도 만들지 않는다.",
          "사용자가 이미 정한 값은 존중하고, 모르는 것은 단정하지 말고 열린 질문으로 남겨라.",
          "반드시 마크다운만 반환하고 아래 섹션 제목을 그대로 사용하라.",
          "# Setup Proposal",
          "## Alignment Summary",
          "## Chosen Parameters",
          "## Open Questions",
          "## Approved Creative Brief",
          "## Why This Shape",
          "Approved Creative Brief 섹션은 실제 책 생성기에 넘길 수 있도록 구체적이고 보수적으로 작성하라.",
        ].join("\n")
      : language === "zh"
        ? [
            "你是 InkOS 在建书前的提案规划助手。",
            "此阶段不能创建任何文件。",
            "尊重用户已经指定的参数，未知内容不要擅自补完，而是放入开放问题。",
            "只返回 Markdown，并严格使用这些标题：",
            "# Setup Proposal",
            "## Alignment Summary",
            "## Chosen Parameters",
            "## Open Questions",
            "## Approved Creative Brief",
            "## Why This Shape",
            "其中 Approved Creative Brief 要写成可以直接交给建书流程的创作说明。",
          ].join("\n")
        : [
            "You are InkOS's pre-creation setup planner.",
            "Do not create or imply any files yet.",
            "Respect parameters the user has already chosen.",
            "Do not invent unresolved canon details; list them as open questions instead.",
            "Return Markdown only and use these exact headings:",
            "# Setup Proposal",
            "## Alignment Summary",
            "## Chosen Parameters",
            "## Open Questions",
            "## Approved Creative Brief",
            "## Why This Shape",
            "The Approved Creative Brief section should be specific enough to pass into the book-creation pipeline.",
          ].join("\n");
    const parameterLines = language === "ko"
      ? [
          `제목: ${draft.title}`,
          `장르: ${draft.genre}`,
          `플랫폼: ${draft.platform}`,
          `장당 분량: ${draft.chapterWordCount}`,
          `목표 장 수: ${draft.targetChapters}`,
          `Book ID: ${draft.id}`,
        ]
      : language === "zh"
        ? [
            `标题：${draft.title}`,
            `题材：${draft.genre}`,
            `平台：${draft.platform}`,
            `每章字数：${draft.chapterWordCount}`,
            `目标章节：${draft.targetChapters}`,
            `Book ID：${draft.id}`,
          ]
        : [
            `Title: ${draft.title}`,
            `Genre: ${draft.genre}`,
            `Platform: ${draft.platform}`,
            `Words / Chapter: ${draft.chapterWordCount}`,
            `Target Chapters: ${draft.targetChapters}`,
            `Book ID: ${draft.id}`,
          ];
    const userPrompt = [
      parameterLines.join("\n"),
      brief
        ? language === "ko"
          ? `사용자 메모:\n${brief}`
          : language === "zh"
            ? `用户备注：\n${brief}`
            : `User brief:\n${brief}`
        : "",
      conversation
        ? language === "ko"
          ? `최근 설정 논의:\n${conversation}`
          : language === "zh"
            ? `最近设定讨论：\n${conversation}`
            : `Recent setup discussion:\n${conversation}`
        : "",
      language === "ko"
        ? "Chosen Parameters 섹션에는 사용자가 고른 값을 그대로 bullet로 적고, Alignment Summary / Open Questions / Why This Shape 는 짧고 검증 가능하게 써라."
        : language === "zh"
          ? "Chosen Parameters 部分要逐项复述用户已选择的参数；Alignment Summary / Open Questions / Why This Shape 保持简洁、可核对。"
          : "In Chosen Parameters, restate the selected values exactly. Keep Alignment Summary, Open Questions, and Why This Shape concise and checkable.",
    ].filter(Boolean).join("\n\n");

    const response = await chatCompletion(client, currentConfig.llm.model, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    const proposalCreatedAt = new Date().toISOString();
    const proposalContent = response.content.trim();
    const nextRevision = revisingSession ? revisingSession.revision + 1 : 1;
    const nextProposal: BookSetupProposalPayload = {
      content: proposalContent,
      createdAt: proposalCreatedAt,
      revision: nextRevision,
    };
    const session: BookSetupSessionRecord = revisingSession
      ? {
          ...revisingSession,
          revision: nextRevision,
          status: "proposed",
          bookId: draft.id,
          title: draft.title,
          genre: draft.genre,
          language: resolveStudioLanguage(draft.language, language),
          platform: draft.platform,
          chapterWordCount: draft.chapterWordCount,
          targetChapters: draft.targetChapters,
          brief,
          proposal: nextProposal,
          previousProposal: revisingSession.proposal,
          reviewThreads: [],
          foundationPreview: undefined,
          exactProposal: undefined,
          externalContext: extractApprovedCreativeBrief(proposalContent),
          updatedAt: proposalCreatedAt,
        }
      : {
          id: randomUUID(),
          revision: 1,
          status: "proposed",
          bookId: draft.id,
          title: draft.title,
          genre: draft.genre,
          language: resolveStudioLanguage(draft.language, language),
          platform: draft.platform,
          chapterWordCount: draft.chapterWordCount,
          targetChapters: draft.targetChapters,
          brief,
          proposal: nextProposal,
          reviewThreads: [],
          externalContext: extractApprovedCreativeBrief(proposalContent),
          createdAt: now,
          updatedAt: proposalCreatedAt,
        };
    await upsertBookSetupSession(root, session);
    broadcast("book:setup:proposed", { sessionId: session.id, bookId: session.bookId, title: session.title });
    return c.json(summarizeBookSetupSession(session));
  });


  app.get("/api/book-setup", async (c) => {
    const payload: BookSetupSessionListPayload = {
      sessions: (await listBookSetupSessions(root)).map(summarizeBookSetupSession),
    };
    return c.json(payload);
  });

  app.get("/api/book-setup/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await findBookSetupSession(root, sessionId);
    if (!session) {
      throw new ApiError(404, "BOOK_SETUP_SESSION_NOT_FOUND", `Book setup session "${sessionId}" not found.`);
    }
    return c.json(summarizeBookSetupSession(session));
  });

  app.put("/api/book-setup/:sessionId/reviews", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await findBookSetupSession(root, sessionId);
    if (!session) {
      throw new ApiError(404, "BOOK_SETUP_SESSION_NOT_FOUND", `Book setup session "${sessionId}" not found.`);
    }
    const body = await c.req.json<Partial<BookSetupReviewThreadsRequest>>().catch(() => null);
    const expectedRevision = readBookSetupExpectedRevision(body, sessionId);
    assertBookSetupExpectedRevision(session, expectedRevision, "update review notes");
    if (session.status === "creating") {
      throw new ApiError(409, "BOOK_SETUP_ALREADY_CREATING", `Book setup session "${sessionId}" is already creating a book.`);
    }

    const reviewThreads = readBookSetupReviewThreads(body, sessionId);
    const hasProposalRequestChanges = hasRequestChangesInReviewThreads(reviewThreads, "proposal");
    const refreshPreviewOnResolve = shouldRefreshPreviewOnResolve(body);
    const resolvedFoundationRequestChange = didResolveFoundationReviewRequestChange(session.reviewThreads, reviewThreads);
    let foundationPreview = hasProposalRequestChanges ? undefined : session.foundationPreview;
    let exactProposal = hasProposalRequestChanges ? undefined : session.exactProposal;
    let updatedAt = new Date().toISOString();

    if (
      refreshPreviewOnResolve
      && !hasProposalRequestChanges
      && session.status === "approved"
      && session.foundationPreview
      && session.exactProposal
      && resolvedFoundationRequestChange
    ) {
      const bookConfig = buildStudioBookConfig({
        title: session.title,
        genre: session.genre,
        language: session.language,
        platform: session.platform,
        chapterWordCount: session.chapterWordCount,
        targetChapters: session.targetChapters,
      }, updatedAt);
      const pipeline = withExactBookProposalSupport(new PipelineRunner(await buildPipelineConfig(undefined, {
        externalContext: session.externalContext,
      })));
      const refreshedProposal = await pipeline.proposeBook(bookConfig);
      exactProposal = refreshedProposal;
      foundationPreview = summarizeBookSetupFoundationPreview(refreshedProposal, updatedAt, session.revision + 1);
    }

    const updated: BookSetupSessionRecord = {
      ...session,
      revision: session.revision + 1,
      status: hasProposalRequestChanges ? "proposed" : session.status,
      reviewThreads,
      foundationPreview,
      exactProposal,
      updatedAt,
    };
    await upsertBookSetupSession(root, updated);
    broadcast("book:setup:reviews-updated", {
      sessionId: updated.id,
      bookId: updated.bookId,
      title: updated.title,
      reviewThreads: updated.reviewThreads.length,
      hasProposalRequestChanges,
      refreshedPreview: refreshPreviewOnResolve && resolvedFoundationRequestChange,
    });
    return c.json(summarizeBookSetupSession(updated));
  });

  app.post("/api/book-setup/:sessionId/approve", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await findBookSetupSession(root, sessionId);
    if (!session) {
      throw new ApiError(404, "BOOK_SETUP_SESSION_NOT_FOUND", `Book setup session "${sessionId}" not found.`);
    }
    const body = await c.req.json<Partial<BookSetupRevisionRequest>>().catch(() => null);
    const expectedRevision = readBookSetupExpectedRevision(body, sessionId);
    assertBookSetupExpectedRevision(session, expectedRevision, "approve it");
    if (session.status === "creating") {
      throw new ApiError(409, "BOOK_SETUP_ALREADY_CREATING", `Book setup session "${sessionId}" is already creating a book.`);
    }
    if (session.status === "approved") {
      return c.json(summarizeBookSetupSession(session));
    }
    assertNoBookSetupReviewRequests(session, "proposal", "approve it");

    const updated: BookSetupSessionRecord = {
      ...session,
      revision: session.revision + 1,
      status: "approved",
      updatedAt: new Date().toISOString(),
    };
    await upsertBookSetupSession(root, updated);
    broadcast("book:setup:approved", { sessionId: session.id, bookId: session.bookId, title: session.title });
    return c.json(summarizeBookSetupSession(updated));
  });

  app.post("/api/book-setup/:sessionId/foundation-preview", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await findBookSetupSession(root, sessionId);
    if (!session) {
      throw new ApiError(404, "BOOK_SETUP_SESSION_NOT_FOUND", `Book setup session "${sessionId}" not found.`);
    }
    const body = await c.req.json<Partial<BookSetupRevisionRequest>>().catch(() => null);
    const expectedRevision = readBookSetupExpectedRevision(body, sessionId);
    assertBookSetupExpectedRevision(session, expectedRevision, "prepare the exact foundation preview");
    if (session.status === "creating") {
      throw new ApiError(409, "BOOK_SETUP_ALREADY_CREATING", `Book setup session "${sessionId}" is already creating a book.`);
    }
    if (session.status !== "approved") {
      throw new ApiError(409, "BOOK_SETUP_NOT_APPROVED", `Book setup session "${sessionId}" must be approved before preparing an exact foundation preview.`);
    }
    assertNoBookSetupReviewRequests(session, "proposal", "prepare the exact foundation preview");
    if (session.exactProposal && session.foundationPreview) {
      return c.json(summarizeBookSetupSession(session));
    }

    const previewCreatedAt = new Date().toISOString();
    const bookConfig = buildStudioBookConfig({
      title: session.title,
      genre: session.genre,
      language: session.language,
      platform: session.platform,
      chapterWordCount: session.chapterWordCount,
      targetChapters: session.targetChapters,
    }, previewCreatedAt);
    const pipeline = withExactBookProposalSupport(new PipelineRunner(await buildPipelineConfig(undefined, {
      externalContext: session.externalContext,
    })));
    const exactProposal = await pipeline.proposeBook(bookConfig);
    const nextRevision = session.revision + 1;
    const updated: BookSetupSessionRecord = {
      ...session,
      revision: nextRevision,
      foundationPreview: summarizeBookSetupFoundationPreview(exactProposal, previewCreatedAt, nextRevision),
      exactProposal,
      updatedAt: previewCreatedAt,
    };
    await upsertBookSetupSession(root, updated);
    broadcast("book:setup:foundation-previewed", { sessionId: session.id, bookId: session.bookId, title: session.title });
    return c.json(summarizeBookSetupSession(updated));
  });

  app.post("/api/book-setup/:sessionId/create", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<Partial<BookSetupCreateRequest>>().catch(() => null);
    const idempotency = await beginCreateIdempotency(
      root,
      "book-setup-create",
      c.req.header("Idempotency-Key"),
      computeBookSetupCreateIdempotencyFingerprint(sessionId, body),
    );
    if (idempotency.replay) {
      return c.json(idempotency.replay.body, idempotency.replay.status);
    }

    try {
      const session = await findBookSetupSession(root, sessionId);
      if (!session) {
        throw new ApiError(404, "BOOK_SETUP_SESSION_NOT_FOUND", `Book setup session "${sessionId}" not found.`);
      }
      const expectedRevision = readBookSetupExpectedRevision(body, sessionId);
      assertBookSetupExpectedRevision(session, expectedRevision, "create the book");
      if (session.status === "creating") {
        throw new ApiError(409, "BOOK_SETUP_ALREADY_CREATING", `Book setup session "${sessionId}" is already creating a book.`);
      }
      if (session.status !== "approved") {
        throw new ApiError(409, "BOOK_SETUP_NOT_APPROVED", `Book setup session "${sessionId}" must be approved before creation.`);
      }
      assertNoBookSetupReviewRequests(session, "proposal", "create the book");

      if (!session.foundationPreview || !session.exactProposal) {
        throw new ApiError(409, "BOOK_SETUP_FOUNDATION_PREVIEW_REQUIRED", `Book setup session "${sessionId}" must prepare an exact foundation preview before creation.`);
      }
      assertNoBookSetupReviewRequests(session, "foundation", "create the book");

      const expectedPreviewDigest = readBookSetupExpectedPreviewDigest(body, sessionId);
      assertBookSetupExpectedPreviewDigest(session, expectedPreviewDigest, "create the book");

      const result = await queueStudioBookProposalApply(session.exactProposal, {
        externalContext: session.externalContext,
      });

      const updated: BookSetupSessionRecord = {
        ...session,
        revision: session.revision + 1,
        status: "creating",
        updatedAt: new Date().toISOString(),
      };
      await upsertBookSetupSession(root, updated);
      broadcast("book:setup:creating", { sessionId: session.id, bookId: result.bookId, title: session.title });
      const responseBody = { ...result, session: summarizeBookSetupSession(updated) };
      await completeCreateIdempotency(root, idempotency.cacheKey, responseBody);
      return c.json(responseBody);
    } catch (error) {
      abandonCreateIdempotency(idempotency.cacheKey);
      throw error;
    }
  });

  app.post("/api/books/create", async (c) => {
    const body = await c.req.json<{
      title: string;
      genre: string;
      language?: StudioLanguage;
      platform?: string;
      chapterWordCount?: number;
      targetChapters?: number;
      brief?: string;
    }>();
    const idempotency = await beginCreateIdempotency(
      root,
      "book-create",
      c.req.header("Idempotency-Key"),
      computeBookCreateIdempotencyFingerprint(body),
    );
    if (idempotency.replay) {
      return c.json(idempotency.replay.body, idempotency.replay.status);
    }

    try {
      const result = await queueStudioBookCreate(body, {
        externalContext: typeof body.brief === "string" && body.brief.trim().length > 0
          ? body.brief.trim()
          : undefined,
      });
      await completeCreateIdempotency(root, idempotency.cacheKey, result);
      return c.json(result);
    } catch (error) {
      abandonCreateIdempotency(idempotency.cacheKey);
      throw error;
    }
  });

  app.get("/api/book-create-status", async (c) => {
    const entries = [...bookCreateStatus.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return c.json({ entries });
  });

  app.get("/api/books/:id/create-status", async (c) => {
    const id = c.req.param("id");
    const status = bookCreateStatus.get(id);
    if (!status) {
      return c.json({ status: "missing" }, 404);
    }
    return c.json(status);
  });

  // --- Chapters ---

  app.get("/api/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const bookDir = state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");

    try {
      const files = await readdir(chaptersDir);
      const paddedNum = String(num).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);
      const content = await readFile(join(chaptersDir, match), "utf-8");
      const book = await state.loadBookConfig(id);
      return c.json({
        chapterNumber: num,
        filename: match,
        content,
        language: book.language ?? "ko",
        readerSettings: book.readerSettings,
      });
    } catch {
      return c.json({ error: "Chapter not found" }, 404);
    }
  });

  // --- Chapter Save ---

  app.put("/api/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const bookDir = state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");
    const { content } = await c.req.json<{ content: string }>();

    try {
      const files = await readdir(chaptersDir);
      const paddedNum = String(num).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const { writeFile: writeFileFs } = await import("node:fs/promises");
      await writeFileFs(join(chaptersDir, match), content, "utf-8");
      return c.json({ ok: true, chapterNumber: num });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Truth files ---

  app.get("/api/books/:id/truth/:file", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");

    if (!isAllowedTruthFile(file)) {
      return c.json({ error: "Invalid truth file" }, 400);
    }

    const bookDir = state.bookDir(id);
    await ensureStudioControlDocuments(state, id).catch(() => undefined);
    const language = await resolveTruthFileLanguage(state, id, cachedConfig);
    const content = await readStoryFileSafe(bookDir, file);
    const definition = truthFileDefinition(file);
    return c.json({
      file,
      name: file,
      label: truthFileLabel(file, language),
      section: definition.section,
      sectionLabel: truthFileSectionLabel(definition.section, language),
      exists: content !== null,
      path: `story/${file}`,
      optional: definition.optional,
      available: true,
      preview: (content ?? truthFileTemplate(file, language)).slice(0, 200),
      size: content?.length ?? 0,
      content: content ?? truthFileTemplate(file, language),
    });
  });

  app.post("/api/books/:id/truth/assist", async (c) => {
    const id = c.req.param("id");
    const body = await c.req
      .json<TruthAssistRequest>()
      .catch(() => ({} as TruthAssistRequest));
    const requestedTargets = [
      ...(typeof body.fileName === "string" ? [body.fileName] : []),
      ...((body.fileNames ?? []).filter((file): file is string => typeof file === "string")),
    ]
      .map((file) => file.trim())
      .filter(Boolean)
      .filter((file, index, files) => files.indexOf(file) === index);
    const requestedFiles = requestedTargets.filter(isAllowedTruthFile);

    if (requestedTargets.length === 0 || requestedFiles.length === 0) {
      return c.json({ error: "Invalid truth file" }, 400);
    }
    if (requestedTargets.length !== requestedFiles.length && requestedTargets.length > 1) {
      return c.json({ error: "TRUTH_SCOPE_MULTI_FILE_UNSUPPORTED" }, 400);
    }

    await ensureStudioControlDocuments(state, id).catch(() => undefined);
    const currentConfig = await loadCurrentProjectConfig();
    const language = await resolveTruthFileLanguage(state, id, cachedConfig);
    const bookDir = state.bookDir(id);
    const book = await state.loadBookConfig(id).catch(() => null);
    const assistMode = body.mode === "question" ? "question" : "proposal";
    const scopeError = validateTruthWriteScope({
      scope: readTruthWriteScope(body.scope),
      requestedFiles,
      writeOperation: assistMode === "proposal",
    });
    if (scopeError) {
      return c.json({ error: scopeError.error }, scopeError.status);
    }
    const alignmentPrompt = buildTruthAlignmentPrompt(body.alignment, language);
    const alignmentPolicy = buildTruthAlignmentPolicy(body.alignment, language, assistMode);
    const conversation = (body.conversation ?? [])
      .filter((entry: { role?: string; content?: string }): entry is { role: "user" | "assistant"; content: string } => (
        (entry.role === "user" || entry.role === "assistant")
        && typeof entry.content === "string"
        && entry.content.trim().length > 0
      ))
      .slice(-8)
      .map((entry: { role: "user" | "assistant"; content: string }) => `${entry.role === "user"
        ? (language === "ko" ? "사용자" : language === "zh" ? "用户" : "User")
        : (language === "ko" ? "에이전트" : language === "zh" ? "助手" : "Assistant")}: ${entry.content.trim()}`);

    try {
      const { chatCompletion } = await import("@actalk/inkos-core");
      const client = createLLMClient({
        ...currentConfig.llm,
        extra: { ...(currentConfig.llm.extra ?? {}), projectRoot: root },
      });
      if (assistMode === "question") {
        const focusFile = requestedFiles[0]!;
        const currentContent = await readStoryFileSafe(bookDir, focusFile);
        const targetContent = currentContent ?? truthFileTemplate(focusFile, language);
        const supportNames = [
          "author_intent.md",
          "current_focus.md",
          "story_bible.md",
          "volume_outline.md",
          "book_rules.md",
          "current_state.md",
          "pending_hooks.md",
        ].filter((name): name is TruthFileName => name !== focusFile && isAllowedTruthFile(name));
        const supportBlocks = await Promise.all(
          supportNames.map(async (name) => {
            const content = await readStoryFileSafe(bookDir, name);
            if (!content?.trim()) return null;
            return `### ${truthFileLabel(name, language)}\n${content.slice(0, 1400)}`;
          }),
        );
        const interviewRequest = body.instruction?.trim()
          || (language === "ko"
            ? "지금 문서를 고치기 전에 가장 중요한 확인 질문 하나를 뽑아 줘."
            : language === "zh"
              ? "在改写文档前，请先提出最关键的确认问题。"
              : "Before rewriting the binder file, ask the single most important clarifying question.");
        const interviewPrompt = [
          language === "ko"
            ? `대상 문서: ${truthFileLabel(focusFile, language)} (${focusFile})`
            : language === "zh"
              ? `目标文档：${truthFileLabel(focusFile, language)} (${focusFile})`
              : `Target file: ${truthFileLabel(focusFile, language)} (${focusFile})`,
          requestedFiles.length > 1
            ? language === "ko"
              ? `묶음 편집 대상: ${requestedFiles.map((name) => truthFileLabel(name, language)).join(", ")}`
              : language === "zh"
                ? `本次联动编辑文档：${requestedFiles.map((name) => truthFileLabel(name, language)).join("、")}`
                : `Bundle targets: ${requestedFiles.map((name) => truthFileLabel(name, language)).join(", ")}`
            : "",
          book
            ? language === "ko"
              ? `책 정보: ${book.title} / ${book.genre} / ${book.platform}`
              : language === "zh"
                ? `书籍信息：${book.title} / ${book.genre} / ${book.platform}`
                : `Book: ${book.title} / ${book.genre} / ${book.platform}`
            : "",
          language === "ko"
            ? `정렬 목표: ${interviewRequest}`
            : language === "zh"
              ? `对齐目标：${interviewRequest}`
              : `Alignment request: ${interviewRequest}`,
          alignmentPrompt
            ? language === "ko"
              ? `정렬 메모:\n${alignmentPrompt}`
              : language === "zh"
                ? `对齐备忘：\n${alignmentPrompt}`
                : `Alignment notes:\n${alignmentPrompt}`
            : "",
          conversation.length > 0
            ? language === "ko"
              ? `최근 대화 맥락:\n${conversation.join("\n")}`
              : language === "zh"
                ? `最近对话上下文：\n${conversation.join("\n")}`
                : `Recent conversation:\n${conversation.join("\n")}`
            : "",
          language === "ko" ? "현재 문서:" : language === "zh" ? "当前文档：" : "Current file:",
          targetContent,
          language === "ko" ? "참고 문맥:" : language === "zh" ? "参考上下文：" : "Reference context:",
          supportBlocks.filter(Boolean).join("\n\n"),
        ].filter(Boolean).join("\n\n");
        const interviewSystemPrompt = language === "ko"
          ? `당신은 InkOS 설정집 정렬 인터뷰어다. 문서를 다시 쓰기 전에 딱 한 개의 핵심 확인 질문만 골라야 한다. 모호함을 줄이고 추측 작성 가능성을 가장 크게 낮추는 질문이어야 한다. 사용자를 대신해 설정을 결정하거나 문서를 작성하면 안 된다. JSON만 반환하라. 형식: {"question":"...","rationale":"..."}\n${alignmentPolicy}`
          : language === "zh"
            ? `你是 InkOS 设定集对齐访谈助手。在改写前只提出一个最关键的问题，目标是最大限度降低臆测改写。不要代替用户完成设定决定。只返回 JSON：{"question":"...","rationale":"..."}\n${alignmentPolicy}`
            : `You are an InkOS binder alignment interviewer. Ask exactly one clarifying question before any rewrite. Pick the question that most reduces speculation. Do not make the decision for the user. Return JSON only: {"question":"...","rationale":"..."}. ${alignmentPolicy}`;
        const interviewResponse = await chatCompletion(client, currentConfig.llm.model, [
          { role: "system", content: interviewSystemPrompt },
          { role: "user", content: interviewPrompt },
        ]);
        const parsed = parseTruthInterviewResponse(interviewResponse.content);
        const question = parsed.question || interviewResponse.content.trim();
        return c.json({
          mode: "question",
          content: question,
          changes: [],
          question,
          rationale: parsed.rationale,
        });
      }

      const changes = [];

      for (const fileName of requestedFiles) {
        const currentContent = await readStoryFileSafe(bookDir, fileName);
        const targetContent = currentContent ?? truthFileTemplate(fileName, language);
        const supportNames = [
          "author_intent.md",
          "current_focus.md",
          "story_bible.md",
          "volume_outline.md",
          "book_rules.md",
          "current_state.md",
          "pending_hooks.md",
        ].filter((name): name is TruthFileName => name !== fileName && isAllowedTruthFile(name));
        const supportBlocks = await Promise.all(
          supportNames.map(async (name) => {
            const content = await readStoryFileSafe(bookDir, name);
            if (!content?.trim()) return null;
            return `### ${truthFileLabel(name, language)}\n${content.slice(0, 2200)}`;
          }),
        );
        const instruction = body.instruction?.trim() || truthAssistDefaultInstruction(fileName, currentContent !== null, language);
        const systemPrompt = language === "ko"
          ? `당신은 InkOS 설정집 편집 보조자다. 대화 맥락과 책 설정을 반영해 단 하나의 truth file만 다시 작성한다. 설명이나 해설 없이 최종 markdown 본문만 반환하라. 한국어 프로젝트라면 자연스러운 한국어로 쓰고, 기존 제목/표/frontmatter가 유용하면 유지하라.\n${alignmentPolicy}`
          : language === "zh"
            ? `你是 InkOS 设定集编辑助手。结合对话上下文与书籍设定，只重写一个 truth file。不要解释，只返回最终 markdown 正文。若原文已有标题、表格或 frontmatter 且有用，请保留。\n${alignmentPolicy}`
            : `You are an InkOS binder editor. Use the conversation context plus the book binder to rewrite exactly one truth file. Return only the final markdown body. Do not explain. Preserve useful headings, tables, and frontmatter.\n${alignmentPolicy}`;
        const userPrompt = [
          language === "ko"
            ? `대상 문서: ${truthFileLabel(fileName, language)} (${fileName})`
            : language === "zh"
              ? `目标文档：${truthFileLabel(fileName, language)} (${fileName})`
              : `Target file: ${truthFileLabel(fileName, language)} (${fileName})`,
          requestedFiles.length > 1
            ? language === "ko"
              ? `묶음 편집 대상: ${requestedFiles.map((name) => truthFileLabel(name, language)).join(", ")}`
              : language === "zh"
                ? `本次联动编辑文档：${requestedFiles.map((name) => truthFileLabel(name, language)).join("、")}`
                : `Bundle targets: ${requestedFiles.map((name) => truthFileLabel(name, language)).join(", ")}`
            : "",
          book
            ? language === "ko"
              ? `책 정보: ${book.title} / ${book.genre} / ${book.platform}`
              : language === "zh"
                ? `书籍信息：${book.title} / ${book.genre} / ${book.platform}`
                : `Book: ${book.title} / ${book.genre} / ${book.platform}`
            : "",
          language === "ko"
            ? `요청: ${instruction}`
            : language === "zh"
              ? `要求：${instruction}`
              : `Instruction: ${instruction}`,
          alignmentPrompt
            ? language === "ko"
              ? `정렬 메모:\n${alignmentPrompt}`
              : language === "zh"
                ? `对齐备忘：\n${alignmentPrompt}`
                : `Alignment notes:\n${alignmentPrompt}`
            : "",
          conversation.length > 0
            ? language === "ko"
              ? `최근 대화 맥락:\n${conversation.join("\n")}`
              : language === "zh"
                ? `最近对话上下文：\n${conversation.join("\n")}`
                : `Recent conversation:\n${conversation.join("\n")}`
            : "",
          language === "ko" ? "현재 문서:" : language === "zh" ? "当前文档：" : "Current file:",
          targetContent,
          language === "ko" ? "참고 문맥:" : language === "zh" ? "参考上下文：" : "Reference context:",
          supportBlocks.filter(Boolean).join("\n\n"),
        ].filter(Boolean).join("\n\n");
        // Sequential generation keeps each truth-file rewrite focused and deterministic.
        // eslint-disable-next-line no-await-in-loop
        const response = await chatCompletion(client, currentConfig.llm.model, [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ]);
        changes.push({
          fileName,
          label: truthFileLabel(fileName, language),
          content: response.content.trim(),
        });
      }

      return c.json({ mode: "proposal", content: changes[0]?.content ?? "", changes });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  // --- Analytics ---

  app.get("/api/books/:id/analytics", async (c) => {
    const id = c.req.param("id");
    try {
      const chapters = await state.loadChapterIndex(id);
      return c.json(computeAnalytics(id, chapters));
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });

  // --- Actions ---

  app.post("/api/books/:id/write-next", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ wordCount?: number }>().catch(() => ({ wordCount: undefined }));

    broadcast("write:start", { bookId: id });

    // Fire and forget — progress/completion/errors pushed via SSE
    const pipeline = new PipelineRunner(await buildPipelineConfig());
    pipeline.writeNextChapter(id, body.wordCount).then(
      (result) => {
        broadcast("write:complete", { bookId: id, chapterNumber: result.chapterNumber, status: result.status, title: result.title, wordCount: result.wordCount });
      },
      (e: unknown) => {
        broadcast("write:error", { bookId: id, error: e instanceof Error ? e.message : String(e) });
      },
    );

    return c.json({ status: "writing", bookId: id });
  });

  app.post("/api/books/:id/draft", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ wordCount?: number; context?: string }>().catch(() => ({ wordCount: undefined, context: undefined }));

    broadcast("draft:start", { bookId: id });

    const pipeline = new PipelineRunner(await buildPipelineConfig());
    pipeline.writeDraft(id, body.context, body.wordCount).then(
      (result) => {
        broadcast("draft:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount });
      },
      (e: unknown) => {
        broadcast("draft:error", { bookId: id, error: e instanceof Error ? e.message : String(e) });
      },
    );

    return c.json({ status: "drafting", bookId: id });
  });

  app.post("/api/books/:id/chapters/:num/approve", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);

    try {
      const index = await state.loadChapterIndex(id);
      const updated = index.map((ch) =>
        ch.number === num ? { ...ch, status: "approved" as const } : ch,
      );
      await state.saveChapterIndex(id, updated);
      return c.json({ ok: true, chapterNumber: num, status: "approved" });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/books/:id/chapters/:num/reject", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);

    try {
      const index = await state.loadChapterIndex(id);
      const updated = index.map((ch) =>
        ch.number === num ? { ...ch, status: "rejected" as const } : ch,
      );
      await state.saveChapterIndex(id, updated);
      return c.json({ ok: true, chapterNumber: num, status: "rejected" });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- SSE ---

  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      const handler: EventHandler = (event, data) => {
        stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      subscribers.add(handler);

      // Keep alive
      const keepAlive = setInterval(() => {
        stream.writeSSE({ event: "ping", data: "" });
      }, 30000);

      stream.onAbort(() => {
        subscribers.delete(handler);
        clearInterval(keepAlive);
      });

      // Block until aborted
      await new Promise(() => {});
    });
  });

  // --- Bootstrap / onboarding ---

  app.get("/api/bootstrap", async (c) => {
    const projectInitialized = existsSync(join(root, "inkos.json"));
    const globalConfig = await readGlobalConfigSummary();
    const payload: BootstrapPayload = {
      root,
      suggestedProjectName: basename(root),
      projectInitialized,
      globalConfig,
    };
    return c.json(payload);
  });

  app.post("/api/project/init", async (c) => {
    const body = await c.req.json<{ name?: string; language?: StudioLanguage }>().catch(() => ({}));
    if (existsSync(join(root, "inkos.json"))) {
      throw new ApiError(409, "PROJECT_ALREADY_EXISTS", `inkos.json already exists in ${root}`);
    }
    await initializeProjectAtRoot(root, body);
    cachedConfig = await loadProjectConfig(root, { requireApiKey: false });
    return c.json({ ok: true, root, name: cachedConfig.name });
  });

  app.get("/api/global-config", async (c) => {
    return c.json(await readGlobalConfigSummary());
  });

  app.get("/api/llm-capabilities", async (c) => {
    return c.json(await discoverLlmCapabilities(root));
  });

  app.put("/api/global-config", async (c) => {
    const body = await c.req.json<{
      language?: StudioLanguage;
      provider: string;
      model: string;
      reasoningEffort?: string;
      baseUrl?: string;
      apiKey?: string;
    }>();
    await writeGlobalConfig(body);
    return c.json({ ok: true });
  });

  app.get("/api/auth/:sessionId", async (c) => {
    const session = authSessions.get(c.req.param("sessionId"));
    if (!session) {
      throw new ApiError(404, "AUTH_SESSION_NOT_FOUND", `Auth session "${c.req.param("sessionId")}" not found.`);
    }
    return c.json(summarizeAuthSession(session));
  });

  app.post("/api/auth/:provider/login", async (c) => {
    const provider = c.req.param("provider");
    if (provider !== "gemini-cli" && provider !== "codex-cli") {
      throw new ApiError(400, "INVALID_PROVIDER", `Unsupported auth provider: "${provider}"`);
    }
    return c.json(summarizeAuthSession(await startOAuthSession(provider)));
  });

  app.post("/api/auth/:sessionId/submit", async (c) => {
    const body = await c.req.json<{ code?: string }>().catch((): { code?: string } => ({ code: undefined }));
    const code = body.code;
    if (!code?.trim()) {
      throw new ApiError(400, "AUTH_CODE_REQUIRED", "code is required.");
    }
    return c.json(submitOAuthCode(c.req.param("sessionId"), code));
  });

  // --- Project info ---

  app.get("/api/project", async (c) => {
    const projectInitialized = existsSync(join(root, "inkos.json"));
    if (!projectInitialized) {
      const globalConfig = await readGlobalConfigSummary();
      return c.json({
        initialized: false,
        projectRoot: root,
        suggestedProjectName: basename(root),
        name: basename(root),
        language: globalConfig.language,
        languageExplicit: false,
        model: globalConfig.model,
        reasoningEffort: globalConfig.reasoningEffort ?? "",
        provider: globalConfig.provider,
        baseUrl: globalConfig.baseUrl,
        stream: true,
        temperature: 0.7,
        maxTokens: 8192,
      });
    }

    const currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
    // Check if language was explicitly set in inkos.json (not just the schema default)
    const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    const languageExplicit = "language" in raw && raw.language !== "";

    return c.json({
      initialized: true,
      projectRoot: root,
      suggestedProjectName: basename(root),
      name: currentConfig.name,
      language: currentConfig.language,
      languageExplicit,
      model: currentConfig.llm.model,
      reasoningEffort: currentConfig.llm.reasoningEffort ?? "",
      provider: currentConfig.llm.provider,
      baseUrl: currentConfig.llm.baseUrl,
      stream: currentConfig.llm.stream,
      temperature: currentConfig.llm.temperature,
      maxTokens: currentConfig.llm.maxTokens,
    });
  });

  // --- Config editing ---

  app.put("/api/project", async (c) => {
    const updates = await c.req.json<Record<string, unknown>>();
    const configPath = join(root, "inkos.json");
    try {
      const raw = await readFile(configPath, "utf-8");
      const existing = JSON.parse(raw);
      existing.llm ??= {};

      if (typeof updates.provider === "string" && updates.provider.trim().length > 0) {
        existing.llm.provider = updates.provider.trim();
      }
      if (typeof updates.model === "string" && updates.model.trim().length > 0) {
        existing.llm.model = updates.model.trim();
      }
      if (updates.reasoningEffort !== undefined) {
        const reasoning = String(updates.reasoningEffort ?? "").trim();
        if (["none", "minimal", "low", "medium", "high", "xhigh"].includes(reasoning)) {
          existing.llm.reasoningEffort = reasoning;
        } else {
          delete existing.llm.reasoningEffort;
        }
      }
      if (updates.baseUrl !== undefined) {
        const provider = String(existing.llm.provider ?? "").trim();
        existing.llm.baseUrl = isCliOAuthProvider(provider) ? "" : String(updates.baseUrl ?? "").trim();
      } else if (isCliOAuthProvider(String(existing.llm.provider ?? "").trim())) {
        existing.llm.baseUrl = "";
      }
      // Merge LLM settings
      if (updates.temperature !== undefined) {
        existing.llm.temperature = updates.temperature;
      }
      if (updates.maxTokens !== undefined) {
        existing.llm.maxTokens = updates.maxTokens;
      }
      if (updates.stream !== undefined) {
        existing.llm.stream = updates.stream;
      }
      if (updates.language === "zh" || updates.language === "en" || updates.language === "ko") {
        existing.language = updates.language;
      }
      const { writeFile: writeFileFs } = await import("node:fs/promises");
      await writeFileFs(configPath, JSON.stringify(existing, null, 2), "utf-8");
      syncProjectRuntimeLlmEnv(existing.llm);
      cachedConfig = await loadProjectConfig(root, { requireApiKey: false });
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Truth files browser ---

  app.get("/api/books/:id/truth", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    await ensureStudioControlDocuments(state, id).catch(() => undefined);
    const language = await resolveTruthFileLanguage(state, id, cachedConfig);
    const result = await Promise.all(
      TRUTH_FILE_DEFINITIONS.map(async (definition) => {
        const content = await readStoryFileSafe(bookDir, definition.name);
        const previewSource = content ?? truthFileTemplate(definition.name, language);
        return {
          name: definition.name,
          label: truthFileLabel(definition.name, language),
          section: definition.section,
          sectionLabel: truthFileSectionLabel(definition.section, language),
          exists: content !== null,
          path: `story/${definition.name}`,
          optional: definition.optional,
          available: true,
          preview: previewSource.slice(0, 200),
          size: content?.length ?? 0,
        };
      }),
    );
    return c.json({ files: result });
  });

  // --- Daemon control ---

  let schedulerInstance: import("@actalk/inkos-core").Scheduler | null = null;

  app.get("/api/daemon", (c) => {
    return c.json({
      running: schedulerInstance?.isRunning ?? false,
    });
  });

  app.post("/api/daemon/start", async (c) => {
    if (schedulerInstance?.isRunning) {
      return c.json({ error: "Daemon already running" }, 400);
    }
    try {
      const currentConfig = await loadCurrentProjectConfig();
      const scheduler = new Scheduler({
        ...(await buildPipelineConfig(currentConfig)),
        radarCron: currentConfig.daemon.schedule.radarCron,
        writeCron: currentConfig.daemon.schedule.writeCron,
        maxConcurrentBooks: currentConfig.daemon.maxConcurrentBooks,
        chaptersPerCycle: currentConfig.daemon.chaptersPerCycle,
        retryDelayMs: currentConfig.daemon.retryDelayMs,
        cooldownAfterChapterMs: currentConfig.daemon.cooldownAfterChapterMs,
        maxChaptersPerDay: currentConfig.daemon.maxChaptersPerDay,
        onChapterComplete: (bookId, chapter, status) => {
          broadcast("daemon:chapter", { bookId, chapter, status });
        },
        onError: (bookId, error) => {
          broadcast("daemon:error", { bookId, error: error.message });
        },
      });
      schedulerInstance = scheduler;
      broadcast("daemon:started", {});
      void scheduler.start().catch((e: unknown) => {
        const error = e instanceof Error ? e : new Error(String(e));
        if (schedulerInstance === scheduler) {
          scheduler.stop();
          schedulerInstance = null;
          broadcast("daemon:stopped", {});
        }
        broadcast("daemon:error", { bookId: "scheduler", error: error.message });
      });
      return c.json({ ok: true, running: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/daemon/stop", (c) => {
    if (!schedulerInstance?.isRunning) {
      return c.json({ error: "Daemon not running" }, 400);
    }
    schedulerInstance.stop();
    schedulerInstance = null;
    broadcast("daemon:stopped", {});
    return c.json({ ok: true, running: false });
  });

  // --- Logs ---

  app.get("/api/activity", async (c) => {
    return c.json({ entries: recentActivity.slice().reverse() });
  });

  app.get("/api/logs", async (c) => {
    const logPath = join(root, "inkos.log");
    try {
      const content = await readFile(logPath, "utf-8");
      const lines = content.trim().split("\n").slice(-100);
      const entries = lines.map((line) => {
        try { return JSON.parse(line); } catch { return { message: line }; }
      });
      return c.json({ entries });
    } catch {
      return c.json({ entries: [] });
    }
  });

  // --- Agent chat ---

  app.post("/api/agent", async (c) => {
    const { instruction } = await c.req.json<{ instruction: string }>();
    if (!instruction?.trim()) {
      return c.json({ error: "No instruction provided" }, 400);
    }

    broadcast("agent:start", { instruction });

    try {
      const { runAgentLoop } = await import("@actalk/inkos-core");

      const result = await runAgentLoop(
        await buildPipelineConfig(),
        instruction
      );

      broadcast("agent:complete", { instruction, response: result });
      return c.json({ response: result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      broadcast("agent:error", { instruction, error: msg });
      return c.json({ response: msg });
    }
  });

  // --- Language setup ---

  app.post("/api/project/language", async (c) => {
    const { language } = await c.req.json<{ language: StudioLanguage }>();
    const configPath = join(root, "inkos.json");
    try {
      const raw = await readFile(configPath, "utf-8");
      const existing = JSON.parse(raw);
      existing.language = resolveStudioLanguage(language);
      const { writeFile: writeFileFs } = await import("node:fs/promises");
      await writeFileFs(configPath, JSON.stringify(existing, null, 2), "utf-8");
      return c.json({ ok: true, language });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Audit ---

  app.post("/api/books/:id/audit/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);

    broadcast("audit:start", { bookId: id, chapter: chapterNum });
    try {
      const book = await state.loadBookConfig(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");
      const currentConfig = await loadCurrentProjectConfig();
      const { ContinuityAuditor } = await import("@actalk/inkos-core");
      const auditor = new ContinuityAuditor({
        client: createLLMClient(currentConfig.llm),
        model: currentConfig.llm.model,
        projectRoot: root,
        bookId: id,
      });
      const result = await auditor.auditChapter(bookDir, content, chapterNum, book.genre);
      broadcast("audit:complete", { bookId: id, chapter: chapterNum, passed: result.passed });
      return c.json(result);
    } catch (e) {
      broadcast("audit:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Revise ---

  app.post("/api/books/:id/revise/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);
    const body = await c.req.json<{ mode?: string }>().catch(() => ({ mode: "spot-fix" }));

    broadcast("revise:start", { bookId: id, chapter: chapterNum });
    try {
      const book = await state.loadBookConfig(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");

      // Get audit issues first
      const index = await state.loadChapterIndex(id);
      const chapterMeta = index.find((ch) => ch.number === chapterNum);
      const issues = (chapterMeta?.auditIssues ?? []).map((desc) => ({
        severity: "warning" as const,
        category: "general",
        description: desc,
        suggestion: "",
      }));

      const currentConfig = await loadCurrentProjectConfig();
      const { ReviserAgent } = await import("@actalk/inkos-core");
      const reviser = new ReviserAgent({
        client: createLLMClient(currentConfig.llm),
        model: currentConfig.llm.model,
        projectRoot: root,
        bookId: id,
      });
      const result = await reviser.reviseChapter(
        bookDir, content, chapterNum, issues,
        (body.mode ?? "spot-fix") as "spot-fix",
        book.genre,
      );
      broadcast("revise:complete", { bookId: id, chapter: chapterNum });
      return c.json(result);
    } catch (e) {
      broadcast("revise:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Export ---

  app.get("/api/books/:id/export", async (c) => {
    const id = c.req.param("id");
    const format = (c.req.query("format") ?? "txt") as string;
    const approvedOnly = c.req.query("approvedOnly") === "true";
    const bookDir = state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");

    try {
      const book = await state.loadBookConfig(id);
      const index = await state.loadChapterIndex(id);
      const approvedNums = new Set(
        approvedOnly ? index.filter((ch) => ch.status === "approved").map((ch) => ch.number) : [],
      );

      const files = await readdir(chaptersDir);
      const mdFiles = files.filter((f) => f.endsWith(".md") && /^\d{4}/.test(f)).sort();

      const filteredFiles = approvedOnly
        ? mdFiles.filter((f) => approvedNums.has(parseInt(f.slice(0, 4), 10)))
        : mdFiles;

      const contents = await Promise.all(
        filteredFiles.map((f) => readFile(join(chaptersDir, f), "utf-8")),
      );

      if (format === "epub") {
        // Basic EPUB: XHTML container
        const chapters = contents.map((content, i) => {
          const title = content.match(/^#\s+(.+)$/m)?.[1] ?? `Chapter ${i + 1}`;
          const html = content.split("\n").filter((l) => !l.startsWith("#")).map((l) => l.trim() ? `<p>${l}</p>` : "").join("\n");
          return { title, html };
        });
        const toc = chapters.map((ch, i) => `<li><a href="#ch${i}">${ch.title}</a></li>`).join("\n");
        const body = chapters.map((ch, i) => `<h2 id="ch${i}">${ch.title}</h2>\n${ch.html}`).join("\n<hr/>\n");
        const epub = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${book.title}</title><style>body{font-family:serif;max-width:40em;margin:auto;padding:2em;line-height:1.8}h2{margin-top:3em}</style></head><body><h1>${book.title}</h1><nav><ol>${toc}</ol></nav><hr/>${body}</body></html>`;
        return new Response(epub, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Disposition": `attachment; filename="${id}.html"`,
          },
        });
      }
      if (format === "md") {
        const body = contents.join("\n\n---\n\n");
        return new Response(body, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename="${id}.md"`,
          },
        });
      }
      // Default: txt
      const body = contents.join("\n\n");
      return new Response(body, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${id}.txt"`,
        },
      });
    } catch {
      return c.json({ error: "Export failed" }, 500);
    }
  });

  // --- Export to file (save to project dir) ---

  app.post("/api/books/:id/export-save", async (c) => {
    const id = c.req.param("id");
    const { format, approvedOnly } = await c.req.json<{ format?: string; approvedOnly?: boolean }>().catch(() => ({ format: "txt", approvedOnly: false }));
    const bookDir = state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");
    const fmt = format ?? "txt";

    try {
      const book = await state.loadBookConfig(id);
      const index = await state.loadChapterIndex(id);
      const approvedNums = new Set(
        approvedOnly ? index.filter((ch) => ch.status === "approved").map((ch) => ch.number) : [],
      );

      const files = await readdir(chaptersDir);
      const mdFiles = files.filter((f) => f.endsWith(".md") && /^\d{4}/.test(f)).sort();
      const filteredFiles = approvedOnly
        ? mdFiles.filter((f) => approvedNums.has(parseInt(f.slice(0, 4), 10)))
        : mdFiles;
      const contents = await Promise.all(
        filteredFiles.map((f) => readFile(join(chaptersDir, f), "utf-8")),
      );

      const { writeFile: writeFileFs } = await import("node:fs/promises");
      let outputPath: string;
      let body: string;

      if (fmt === "md") {
        body = contents.join("\n\n---\n\n");
        outputPath = join(bookDir, `${id}.md`);
      } else if (fmt === "epub") {
        const chapters = contents.map((content, i) => {
          const title = content.match(/^#\s+(.+)$/m)?.[1] ?? `Chapter ${i + 1}`;
          const html = content.split("\n").filter((l) => !l.startsWith("#")).map((l) => l.trim() ? `<p>${l}</p>` : "").join("\n");
          return { title, html };
        });
        const toc = chapters.map((ch, i) => `<li><a href="#ch${i}">${ch.title}</a></li>`).join("\n");
        const chapterHtml = chapters.map((ch, i) => `<h2 id="ch${i}">${ch.title}</h2>\n${ch.html}`).join("\n<hr/>\n");
        body = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${book.title}</title><style>body{font-family:serif;max-width:40em;margin:auto;padding:2em;line-height:1.8}h2{margin-top:3em}</style></head><body><h1>${book.title}</h1><nav><ol>${toc}</ol></nav><hr/>${chapterHtml}</body></html>`;
        outputPath = join(bookDir, `${id}.html`);
      } else {
        body = contents.join("\n\n");
        outputPath = join(bookDir, `${id}.txt`);
      }

      await writeFileFs(outputPath, body, "utf-8");
      return c.json({ ok: true, path: outputPath, format: fmt, chapters: filteredFiles.length });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Genre detail + copy ---

  app.get("/api/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    try {
      const { readGenreProfile } = await import("@actalk/inkos-core");
      const { profile, body } = await readGenreProfile(root, genreId);
      return c.json({ profile, body });
    } catch (e) {
      return c.json({ error: String(e) }, 404);
    }
  });

  app.post("/api/genres/:id/copy", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }
    try {
      const { getBuiltinGenresDir } = await import("@actalk/inkos-core");
      const { mkdir: mkdirFs, copyFile } = await import("node:fs/promises");
      const builtinDir = getBuiltinGenresDir();
      const projectGenresDir = join(root, "genres");
      await mkdirFs(projectGenresDir, { recursive: true });
      await copyFile(join(builtinDir, `${genreId}.md`), join(projectGenresDir, `${genreId}.md`));
      return c.json({ ok: true, path: `genres/${genreId}.md` });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Model overrides ---

  app.get("/api/project/model-overrides", async (c) => {
    const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    return c.json({ overrides: sanitizeStoredModelOverrides(raw.modelOverrides) });
  });

  app.put("/api/project/model-overrides", async (c) => {
    const { overrides } = await c.req.json<{ overrides: Record<string, unknown> }>();
    const configPath = join(root, "inkos.json");
    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    raw.modelOverrides = sanitizeStoredModelOverrides(overrides);
    const { writeFile: writeFileFs } = await import("node:fs/promises");
    await writeFileFs(configPath, JSON.stringify(raw, null, 2), "utf-8");
    return c.json({ ok: true });
  });

  // --- Notify channels ---

  app.get("/api/project/notify", async (c) => {
    const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    return c.json({ channels: raw.notify ?? [] });
  });

  app.put("/api/project/notify", async (c) => {
    const { channels } = await c.req.json<{ channels: unknown[] }>();
    const configPath = join(root, "inkos.json");
    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    raw.notify = channels;
    const { writeFile: writeFileFs } = await import("node:fs/promises");
    await writeFileFs(configPath, JSON.stringify(raw, null, 2), "utf-8");
    return c.json({ ok: true });
  });

  // --- AIGC Detection ---

  app.post("/api/books/:id/detect/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");
      const { analyzeAITells } = await import("@actalk/inkos-core");
      const result = analyzeAITells(content);
      return c.json({ chapterNumber: chapterNum, ...result });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Truth file edit ---

  app.put("/api/books/:id/truth/:file", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    if (!isAllowedTruthFile(file)) {
      return c.json({ error: "Invalid truth file" }, 400);
    }
    const body = await c.req.json<Partial<TruthSaveRequest>>()
      .catch(() => ({} as Partial<TruthSaveRequest>));
    const scopeError = validateTruthWriteScope({
      scope: readTruthWriteScope(body.scope),
      targetFile: file,
      writeOperation: true,
    });
    if (scopeError) {
      return c.json({ error: scopeError.error }, scopeError.status);
    }
    const content = typeof body.content === "string" ? body.content : "";
    const bookDir = state.bookDir(id);
    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    await mkdirFs(join(bookDir, "story"), { recursive: true });
    await writeFileFs(join(bookDir, "story", file), content, "utf-8");
    return c.json({ ok: true });
  });

  // =============================================
  // NEW ENDPOINTS — CLI parity
  // =============================================

  // --- Book Delete ---

  app.delete("/api/books/:id", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(bookDir, { recursive: true, force: true });
      broadcast("book:deleted", { bookId: id });
      return c.json({ ok: true, bookId: id });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Book Update ---

  app.put("/api/books/:id", async (c) => {
    const id = c.req.param("id");
    const updates = await c.req.json<{
      title?: string;
      chapterWordCount?: number;
      targetChapters?: number;
      status?: string;
      language?: StudioLanguage;
      platform?: string;
      readerSettings?: ReaderSettings;
    }>();
    try {
      const book = await state.loadBookConfig(id);
      const nextTitle = updates.title === undefined ? undefined : updates.title.trim();
      if (nextTitle !== undefined && nextTitle.length === 0) {
        return c.json({ error: "Book title cannot be empty" }, 400);
      }
      let readerSettings: ReaderSettings | undefined;
      if (updates.readerSettings !== undefined) {
        const normalized = normalizeReaderSettings(updates.readerSettings);
        if (!normalized) {
          return c.json({ error: "Invalid readerSettings" }, 400);
        }
        readerSettings = normalized;
      }
      const updated = {
        ...book,
        ...(nextTitle !== undefined ? { title: nextTitle } : {}),
        ...(updates.chapterWordCount !== undefined ? { chapterWordCount: Number(updates.chapterWordCount) } : {}),
        ...(updates.targetChapters !== undefined ? { targetChapters: Number(updates.targetChapters) } : {}),
        ...(updates.status !== undefined ? { status: updates.status as typeof book.status } : {}),
        ...(updates.language !== undefined ? { language: resolveStudioLanguage(updates.language) } : {}),
        ...(updates.platform !== undefined ? { platform: normalizeStudioPlatform(updates.platform) } : {}),
        ...(readerSettings !== undefined ? { readerSettings } : {}),
        updatedAt: new Date().toISOString(),
      };
      await state.saveBookConfig(id, updated);
      broadcast("book:updated", { bookId: id, title: updated.title });
      return c.json({ ok: true, book: updated });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Write Rewrite (specific chapter) ---

  app.post("/api/books/:id/rewrite/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);

    broadcast("rewrite:start", { bookId: id, chapter: chapterNum });
    try {
      const restored = await state.restoreState(id, chapterNum);
      if (!restored) {
        return c.json({ error: `Cannot restore state to chapter ${chapterNum}` }, 400);
      }
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      pipeline.writeNextChapter(id).then(
        (result) => broadcast("rewrite:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount }),
        (e) => broadcast("rewrite:error", { bookId: id, error: e instanceof Error ? e.message : String(e) }),
      );
      return c.json({ status: "rewriting", bookId: id, chapter: chapterNum });
    } catch (e) {
      broadcast("rewrite:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Detect All chapters ---

  app.post("/api/books/:id/detect-all", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const mdFiles = files.filter((f) => f.endsWith(".md") && /^\d{4}/.test(f)).sort();
      const { analyzeAITells } = await import("@actalk/inkos-core");

      const results = await Promise.all(
        mdFiles.map(async (f) => {
          const num = parseInt(f.slice(0, 4), 10);
          const content = await readFile(join(chaptersDir, f), "utf-8");
          const result = analyzeAITells(content);
          return { chapterNumber: num, filename: f, ...result };
        }),
      );
      return c.json({ bookId: id, results });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Detect Stats ---

  app.get("/api/books/:id/detect/stats", async (c) => {
    const id = c.req.param("id");
    try {
      const { loadDetectionHistory, analyzeDetectionInsights } = await import("@actalk/inkos-core");
      const bookDir = state.bookDir(id);
      const history = await loadDetectionHistory(bookDir);
      const insights = analyzeDetectionInsights(history);
      return c.json(insights);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Genre Create ---

  app.post("/api/genres/create", async (c) => {
    const body = await c.req.json<{
      id: string; name: string; language?: string;
      chapterTypes?: string[]; fatigueWords?: string[];
      numericalSystem?: boolean; powerScaling?: boolean; eraResearch?: boolean;
      pacingRule?: string; satisfactionTypes?: string[]; auditDimensions?: number[];
      body?: string;
    }>();

    if (!body.id || !body.name) {
      return c.json({ error: "id and name are required" }, 400);
    }
    if (/[/\\\0]/.test(body.id) || body.id.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${body.id}"`);
    }

    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const genresDir = join(root, "genres");
    await mkdirFs(genresDir, { recursive: true });

    const frontmatter = [
      "---",
      `name: ${body.name}`,
      `id: ${body.id}`,
      `language: ${resolveStudioLanguage(body.language)}`,
      `chapterTypes: ${JSON.stringify(body.chapterTypes ?? [])}`,
      `fatigueWords: ${JSON.stringify(body.fatigueWords ?? [])}`,
      `numericalSystem: ${body.numericalSystem ?? false}`,
      `powerScaling: ${body.powerScaling ?? false}`,
      `eraResearch: ${body.eraResearch ?? false}`,
      `pacingRule: "${body.pacingRule ?? ""}"`,
      `satisfactionTypes: ${JSON.stringify(body.satisfactionTypes ?? [])}`,
      `auditDimensions: ${JSON.stringify(body.auditDimensions ?? [])}`,
      "---",
      "",
      body.body ?? "",
    ].join("\n");

    await writeFileFs(join(genresDir, `${body.id}.md`), frontmatter, "utf-8");
    return c.json({ ok: true, id: body.id });
  });

  // --- Genre Edit ---

  app.put("/api/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }

    const body = await c.req.json<{ profile: Record<string, unknown>; body: string }>();
    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const genresDir = join(root, "genres");
    await mkdirFs(genresDir, { recursive: true });

    const p = body.profile;
    const frontmatter = [
      "---",
      `name: ${p.name ?? genreId}`,
      `id: ${p.id ?? genreId}`,
      `language: ${resolveStudioLanguage(p.language)}`,
      `chapterTypes: ${JSON.stringify(p.chapterTypes ?? [])}`,
      `fatigueWords: ${JSON.stringify(p.fatigueWords ?? [])}`,
      `numericalSystem: ${p.numericalSystem ?? false}`,
      `powerScaling: ${p.powerScaling ?? false}`,
      `eraResearch: ${p.eraResearch ?? false}`,
      `pacingRule: "${p.pacingRule ?? ""}"`,
      `satisfactionTypes: ${JSON.stringify(p.satisfactionTypes ?? [])}`,
      `auditDimensions: ${JSON.stringify(p.auditDimensions ?? [])}`,
      "---",
      "",
      body.body ?? "",
    ].join("\n");

    await writeFileFs(join(genresDir, `${genreId}.md`), frontmatter, "utf-8");
    return c.json({ ok: true, id: genreId });
  });

  // --- Genre Delete (project-level only) ---

  app.delete("/api/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }

    const filePath = join(root, "genres", `${genreId}.md`);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(filePath);
      return c.json({ ok: true, id: genreId });
    } catch (e) {
      return c.json({ error: `Genre "${genreId}" not found in project` }, 404);
    }
  });

  // --- Style Analyze ---

  app.post("/api/style/analyze", async (c) => {
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const { analyzeStyle } = await import("@actalk/inkos-core");
      const profile = analyzeStyle(text, sourceName ?? "unknown");
      return c.json(profile);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Import to Book ---

  app.post("/api/books/:id/style/import", async (c) => {
    const id = c.req.param("id");
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();

    broadcast("style:start", { bookId: id });
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const result = await pipeline.generateStyleGuide(id, text, sourceName ?? "unknown");
      broadcast("style:complete", { bookId: id });
      return c.json({ ok: true, result });
    } catch (e) {
      broadcast("style:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Chapters ---

  app.post("/api/books/:id/import/chapters", async (c) => {
    const id = c.req.param("id");
    const { text, splitRegex } = await c.req.json<{ text: string; splitRegex?: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    broadcast("import:start", { bookId: id, type: "chapters" });
    try {
      const { splitChapters } = await import("@actalk/inkos-core");
      const chapters = [...splitChapters(text, splitRegex)];

      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const result = await pipeline.importChapters({ bookId: id, chapters });
      broadcast("import:complete", { bookId: id, type: "chapters", count: result.importedCount });
      return c.json(result);
    } catch (e) {
      broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Canon ---

  app.post("/api/books/:id/import/canon", async (c) => {
    const id = c.req.param("id");
    const { fromBookId } = await c.req.json<{ fromBookId: string }>();
    if (!fromBookId) return c.json({ error: "fromBookId is required" }, 400);

    broadcast("import:start", { bookId: id, type: "canon" });
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.importCanon(id, fromBookId);
      broadcast("import:complete", { bookId: id, type: "canon" });
      return c.json({ ok: true });
    } catch (e) {
      broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Fanfic Init ---

  app.post("/api/fanfic/init", async (c) => {
    const body = await c.req.json<{
      title: string; sourceText: string; sourceName?: string;
      mode?: string; genre?: string; platform?: string;
      targetChapters?: number; chapterWordCount?: number; language?: string;
    }>();
    if (!body.title || !body.sourceText) {
      return c.json({ error: "title and sourceText are required" }, 400);
    }

    const now = new Date().toISOString();
    const language = resolveStudioLanguage(body.language);
    const bookId = body.title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff가-힣]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30);

    const bookConfig = {
      id: bookId,
      title: body.title,
      platform: normalizeStudioPlatform(body.platform ?? defaultStudioPlatformForLanguage(language)),
      genre: body.genre ?? defaultFanficGenreForLanguage(language),
      status: "outlining" as const,
      targetChapters: body.targetChapters ?? 100,
      chapterWordCount: body.chapterWordCount ?? 3000,
      fanficMode: (body.mode ?? "canon") as "canon",
      language,
      createdAt: now,
      updatedAt: now,
    };

    broadcast("fanfic:start", { bookId, title: body.title });
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.initFanficBook(bookConfig, body.sourceText, body.sourceName ?? "source", (body.mode ?? "canon") as "canon");
      broadcast("fanfic:complete", { bookId });
      return c.json({ ok: true, bookId });
    } catch (e) {
      broadcast("fanfic:error", { bookId, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Fanfic Show (read canon) ---

  app.get("/api/books/:id/fanfic", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    try {
      const content = await readFile(join(bookDir, "story", "fanfic_canon.md"), "utf-8");
      return c.json({ bookId: id, content });
    } catch {
      return c.json({ bookId: id, content: null });
    }
  });

  // --- Fanfic Refresh ---

  app.post("/api/books/:id/fanfic/refresh", async (c) => {
    const id = c.req.param("id");
    const { sourceText, sourceName } = await c.req.json<{ sourceText: string; sourceName?: string }>();
    if (!sourceText?.trim()) return c.json({ error: "sourceText is required" }, 400);

    broadcast("fanfic:refresh:start", { bookId: id });
    try {
      const book = await state.loadBookConfig(id);
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.importFanficCanon(id, sourceText, sourceName ?? "source", (book.fanficMode ?? "canon") as "canon");
      broadcast("fanfic:refresh:complete", { bookId: id });
      return c.json({ ok: true });
    } catch (e) {
      broadcast("fanfic:refresh:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Radar Scan ---

  app.get("/api/radar/status", async (c) => {
    await hydrateRadarStateFromDisk();
    return c.json(radarState);
  });

  app.get("/api/radar/history", async (c) => {
    const scans = await readRadarHistory(root);
    return c.json({ scans });
  });

  app.post("/api/radar/fit-check/preview", async (c) => {
    const body = await c.req.json<{ mode?: string; bookId?: string; context?: string }>().catch(
      () => ({} as { mode?: string; bookId?: string; context?: string }),
    );
    const selectedMode = body?.mode ? normalizeRadarMode(body.mode) : "fit-check";
    if (selectedMode !== "fit-check") {
      return c.json({ error: "mode must be fit-check for preview" }, 400);
    }

    const note = body?.context?.trim();
    const bookId = typeof body?.bookId === "string" ? body.bookId.trim() : "";
    if (!bookId) {
      return c.json({
        mode: "fit-check",
        context: note,
        metadata: undefined,
      });
    }

    const compiled = await buildFitCheckContextFromBook(state, bookId, note);
    return c.json({
      mode: "fit-check",
      context: compiled.context,
      metadata: compiled.metadata,
    });
  });

  app.post("/api/radar/scan", async (c) => {
    if (radarScanInFlight) {
      return c.json(radarState, 202);
    }

    const body = await c.req.json<{ mode?: string; context?: string; bookId?: string }>().catch(
      () => ({} as { mode?: string; context?: string; bookId?: string }),
    );
    const selectedMode = normalizeRadarMode(body?.mode);
    const contextInput = body?.context?.trim();
    const bookId = typeof body?.bookId === "string" ? body.bookId.trim() : "";
    let resolvedContext = contextInput;
    let fitCheckMetadata: RadarFitCheckMetadata | undefined;
    if (selectedMode === "fit-check" && bookId) {
      const compiled = await buildFitCheckContextFromBook(state, bookId, contextInput);
      resolvedContext = compiled.context;
      fitCheckMetadata = compiled.metadata;
    }

    const startedAt = new Date().toISOString();
    radarState = {
      status: "running",
      mode: selectedMode,
      startedAt,
      finishedAt: null,
      progress: null,
      result: null,
      error: null,
      fitCheckMetadata,
    };
    broadcast("radar:start", { startedAt });

    radarScanInFlight = (async () => {
      let llmProvider: string | null = null;
      let llmModel: string | null = null;
      try {
        const currentConfig = await loadCurrentProjectConfig();
        llmProvider = currentConfig.llm.provider;
        llmModel = currentConfig.llm.model;
        const pipeline = new PipelineRunner(await buildPipelineConfig(currentConfig, {
          onStreamProgress: (progress) => {
            if (progress.status !== "streaming" || radarState.status !== "running") return;
            const snapshot: RadarProgressSnapshot = {
              elapsedMs: progress.elapsedMs,
              totalChars: progress.totalChars,
              chineseChars: progress.chineseChars,
            };
            radarState = { ...radarState, progress: snapshot };
            broadcast("radar:progress", snapshot);
          },
        }));
        const result = await pipeline.runRadar(selectedMode, resolvedContext);
        const finishedAt = new Date().toISOString();
        radarState = {
          status: "succeeded",
          mode: selectedMode,
          startedAt,
          finishedAt,
          progress: radarState.progress,
          result,
          error: null,
          fitCheckMetadata,
        };
        try {
          const saved = await persistRadarHistory(root, {
            kind: "inkos-radar-scan",
            version: 1,
            status: "succeeded",
            mode: selectedMode,
            startedAt,
            finishedAt,
            savedAt: new Date().toISOString(),
            provider: llmProvider,
            model: llmModel,
            progress: radarState.progress,
            result,
            error: null,
            fitCheckMetadata,
          });
          broadcast("radar:saved", {
            status: "succeeded",
            savedPath: saved.savedPath,
            provider: saved.provider,
            model: saved.model,
          });
        } catch (persistError) {
          broadcast("radar:save:error", { error: String(persistError) });
        }
        broadcast("radar:complete", { result, finishedAt: radarState.finishedAt });
      } catch (e) {
        const error = String(e);
        const finishedAt = new Date().toISOString();
        radarState = {
          status: "failed",
          mode: selectedMode,
          startedAt,
          finishedAt,
          progress: radarState.progress,
          result: null,
          error,
          fitCheckMetadata,
        };
        try {
          const saved = await persistRadarHistory(root, {
            kind: "inkos-radar-scan",
            version: 1,
            status: "failed",
            mode: selectedMode,
            startedAt,
            finishedAt,
            savedAt: new Date().toISOString(),
            provider: llmProvider,
            model: llmModel,
            progress: radarState.progress,
            result: null,
            error,
            fitCheckMetadata,
          });
          broadcast("radar:saved", {
            status: "failed",
            savedPath: saved.savedPath,
            provider: saved.provider,
            model: saved.model,
          });
        } catch (persistError) {
          broadcast("radar:save:error", { error: String(persistError) });
        }
        broadcast("radar:error", { error, finishedAt: radarState.finishedAt });
      } finally {
        radarScanInFlight = null;
      }
    })();
    return c.json(radarState, 202);
  });

  // --- Doctor (environment health check) ---

  app.get("/api/doctor", async (c) => {
    const { existsSync } = await import("node:fs");
    const { GLOBAL_ENV_PATH } = await import("@actalk/inkos-core");

    const checks = {
      inkosJson: existsSync(join(root, "inkos.json")),
      projectEnv: existsSync(join(root, ".env")),
      globalEnv: existsSync(GLOBAL_ENV_PATH),
      booksDir: existsSync(join(root, "books")),
      llmConnected: false,
      bookCount: 0,
    };

    try {
      const books = await state.listBooks();
      checks.bookCount = books.length;
    } catch { /* ignore */ }

    try {
      const currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
      const client = createLLMClient(currentConfig.llm);
      const { chatCompletion } = await import("@actalk/inkos-core");
      await chatCompletion(client, currentConfig.llm.model, [{ role: "user", content: "ping" }], { maxTokens: 5 });
      checks.llmConnected = true;
    } catch { /* ignore */ }

    return c.json(checks);
  });

  return app;
}

// --- Standalone runner ---

export async function startStudioServer(
  root: string,
  port = 4567,
  options?: { readonly staticDir?: string },
): Promise<void> {
  let config: ProjectConfig | null = null;
  try {
    config = await loadProjectConfig(root);
  } catch {
    config = null;
  }

  const app = createStudioServer(config, root);

  // Serve frontend static files — single process for API + frontend
  if (options?.staticDir) {
    const { readFile: readFileFs } = await import("node:fs/promises");
    const { join: joinPath } = await import("node:path");
    const { existsSync } = await import("node:fs");

    // Serve static assets (js, css, etc.)
    app.get("/assets/*", async (c) => {
      const filePath = joinPath(options.staticDir!, c.req.path);
      try {
        const content = await readFileFs(filePath);
        const ext = filePath.split(".").pop() ?? "";
        const contentTypes: Record<string, string> = {
          js: "application/javascript",
          css: "text/css",
          svg: "image/svg+xml",
          png: "image/png",
          ico: "image/x-icon",
          json: "application/json",
        };
        return new Response(content, {
          headers: { "Content-Type": contentTypes[ext] ?? "application/octet-stream" },
        });
      } catch {
        return c.notFound();
      }
    });

    const studioIndexPath = joinPath(options.staticDir!, "index.html");
    const cockpitIndexPath = joinPath(options.staticDir!, "cockpit", "index.html");
    if (existsSync(cockpitIndexPath)) {
      const cockpitIndexHtml = await readFileFs(cockpitIndexPath, "utf-8");
      app.get("/cockpit", (c) => c.html(cockpitIndexHtml));
      app.get("/cockpit/", (c) => c.html(cockpitIndexHtml));
    }

    // SPA fallback — serve the Studio root shell for all other non-API routes.
    if (existsSync(studioIndexPath)) {
      const studioIndexHtml = await readFileFs(studioIndexPath, "utf-8");
      app.get("*", (c) => {
        if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return c.notFound();
        return c.html(studioIndexHtml);
      });
    }
  }

  console.log(`InkOS Studio running on http://localhost:${port}`);
  serve({ fetch: app.fetch, port });
}
