import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createIdempotencyKey, fetchJson, postApi, putApi, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import type { SSEMessage } from "../hooks/use-sse";
import { resolveStudioLanguage } from "../shared/language";
import { defaultChapterWordsForLanguage, pickValidValue, platformOptionsForLanguage } from "../shared/book-create-form";
import type {
  BookSetupConversationEntry,
  BookSetupCreateRequest,
  BookSetupRevisionRequest,
  BookSetupSessionPayload,
  TruthAssistResponse,
  TruthFileDetail,
  TruthFileSummary,
} from "../shared/contracts";
import {
  compactModelLabel,
  defaultModelForProvider,
  modelSuggestionsForProvider,
  normalizeReasoningEffortForProvider,
  reasoningEffortsForProvider,
  shortLabelForProvider,
  supportsReasoningEffort,
  type LlmCapabilitiesSummary,
  type ReasoningEffort,
} from "../shared/llm";
import { buildTruthLineDiff, makeTruthPreview, summarizeTruthDiff } from "../shared/truth-assistant";
import { shouldRefetchBookCollections, shouldRefetchBookCreateStatus, shouldRefetchBookView } from "../hooks/use-book-activity";
import {
  buildSetupDraftFingerprint,
  buildSetupNotes,
  buildSetupProposalDeltaSummary,
  canPrepareSetupProposal,
  deriveSetupDiscussionState,
} from "./cockpit-setup-state";
import {
  deriveCockpitRailVisibility,
  deriveSetupPrimaryAction,
  type CockpitMode,
  type SetupPrimaryAction,
} from "./cockpit-ui-state";
import { deriveCockpitStatusStrip } from "./cockpit-status-strip";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  FileText,
  Lightbulb,
  Loader2,
  MessageSquareText,
  PenSquare,
  Plus,
  RefreshCcw,
  Sparkles,
  Wand2,
} from "lucide-react";

interface Nav {
  readonly toDashboard: () => void;
  readonly toBook: (id: string) => void;
  readonly toBookCreate?: () => void;
  readonly toTruth: (id: string) => void;
}

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly platform: string;
  readonly chaptersWritten: number;
}

interface BookChapterSummary {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly updatedAt: string;
}

interface BookDetailResponse {
  readonly book: {
    readonly id: string;
    readonly title: string;
    readonly genre: string;
    readonly platform: string;
    readonly chapterWordCount: number;
    readonly targetChapters: number;
    readonly language: string | null;
  };
  readonly chapters: ReadonlyArray<BookChapterSummary>;
  readonly nextChapter: number;
}

interface ChapterDetailResponse {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
  readonly language: string;
}

interface GenreInfo {
  readonly id: string;
  readonly name: string;
  readonly source: "project" | "builtin";
  readonly language: "ko" | "zh" | "en";
}

interface BookCreateJob {
  readonly bookId: string;
  readonly title: string;
  readonly status: "creating" | "error";
  readonly stage: string | null;
  readonly message: string | null;
  readonly error?: string;
}

interface ProjectSummary {
  readonly language: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

type ComposerAction = "discuss" | "ask" | "propose" | "draft" | "write-next";

interface BookSetupSessionSummary {
  readonly id: string;
  readonly revision: number;
  readonly status: "proposed" | "approved" | "creating";
  readonly title: string;
  readonly genre: string;
  readonly language: "ko" | "zh" | "en";
  readonly platform: string;
  readonly chapterWordCount: number;
  readonly targetChapters: number;
  readonly brief: string;
  readonly bookId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = parseInt(asText(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asSetupLanguage(value: unknown): "ko" | "zh" | "en" {
  const valueAsText = asText(value);
  if (valueAsText === "ko" || valueAsText === "zh" || valueAsText === "en") return valueAsText;
  return "ko";
}

function asSetupStatus(value: unknown): "proposed" | "approved" | "creating" {
  if (value === "approved" || value === "creating") return value;
  return "proposed";
}

function toBookSetupSessionSummary(value: unknown): BookSetupSessionSummary | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const id = asText(record.id);
  if (!id) return null;

  return {
    id,
    revision: asNumber(record.revision, 1),
    status: asSetupStatus(record.status),
    title: asText(record.title),
    genre: asText(record.genre),
    language: asSetupLanguage(record.language),
    platform: asText(record.platform),
    chapterWordCount: asNumber(record.chapterWordCount),
    targetChapters: asNumber(record.targetChapters),
    brief: asText(record.brief),
    bookId: asText(record.bookId) || id,
    createdAt: asText(record.createdAt),
    updatedAt: asText(record.updatedAt),
  };
}

function parseSetupSessions(value: unknown): ReadonlyArray<BookSetupSessionSummary> {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { sessions?: unknown[] }).sessions)
      ? (value as { sessions: unknown[] }).sessions
      : value && typeof value === "object" && Array.isArray((value as { entries?: unknown[] }).entries)
        ? (value as { entries: unknown[] }).entries
        : [];

  return raw
    .map(toBookSetupSessionSummary)
    .filter((session): session is BookSetupSessionSummary => session !== null)
    .sort((a, b) => {
      const aStamp = a.updatedAt || a.createdAt;
      const bStamp = b.updatedAt || b.createdAt;
      return bStamp.localeCompare(aStamp);
    });
}

function isBookSetupRevisionMismatchMessage(message: string): boolean {
  return message.includes("changed while you were reviewing it");
}

function buildSetupCreateRequestFingerprint(input: {
  readonly sessionId: string;
  readonly expectedRevision: number;
  readonly expectedPreviewDigest: string;
}): string {
  return JSON.stringify({
    sessionId: input.sessionId,
    expectedRevision: input.expectedRevision,
    expectedPreviewDigest: input.expectedPreviewDigest,
  });
}

interface CockpitMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly createdAt: number;
}

interface ProposalState {
  readonly changes: ReadonlyArray<{
    readonly fileName: string;
    readonly label: string;
    readonly content: string;
  }>;
  readonly createdAt: number;
}

type FoundationPreviewKey = "storyBible" | "volumeOutline" | "bookRules" | "currentState" | "pendingHooks";
type InspectorTab = "focus" | "changes" | "setup" | "activity";

function buildFoundationPreviewTabs(
  preview: NonNullable<BookSetupSessionPayload["foundationPreview"]>,
  t: TFunction,
): ReadonlyArray<{ readonly key: FoundationPreviewKey; readonly label: string; readonly content: string }> {
  return [
    { key: "storyBible", label: t("cockpit.foundationStoryBible"), content: preview.storyBible },
    { key: "volumeOutline", label: t("cockpit.foundationVolumeOutline"), content: preview.volumeOutline },
    { key: "bookRules", label: t("cockpit.foundationBookRules"), content: preview.bookRules },
    { key: "currentState", label: t("cockpit.foundationCurrentState"), content: preview.currentState },
    { key: "pendingHooks", label: t("cockpit.foundationPendingHooks"), content: preview.pendingHooks },
  ];
}

function createMessage(role: CockpitMessage["role"], content: string): CockpitMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
  };
}

function buildConversationTranscript(messages: ReadonlyArray<CockpitMessage>): string {
  return messages
    .slice(-8)
    .map((message) => `${message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System"}: ${message.content}`)
    .join("\n");
}

function toSetupConversation(messages: ReadonlyArray<CockpitMessage>): ReadonlyArray<BookSetupConversationEntry> {
  return messages
    .filter((message): message is CockpitMessage & { readonly role: "user" | "assistant" } => message.role !== "system")
    .map((message) => ({ role: message.role, content: message.content }));
}

function parseComposerCommand(input: string): { action: ComposerAction; text: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const [command, ...rest] = trimmed.split(/\s+/);
  const text = rest.join(" ").trim();
  switch (command.toLowerCase()) {
    case "/ask":
      return { action: "ask", text };
    case "/propose":
      return { action: "propose", text };
    case "/draft":
      return { action: "draft", text };
    case "/write":
    case "/write-next":
      return { action: "write-next", text };
    case "/discuss":
      return { action: "discuss", text };
    default:
      return null;
  }
}

function defaultActionForMode(mode: CockpitMode): ComposerAction {
  if (mode === "binder") return "ask";
  if (mode === "draft") return "draft";
  return "discuss";
}

function summarizeProposal(changes: ReadonlyArray<{ readonly label: string; readonly content: string }>): string {
  if (!changes.length) return "";
  return changes
    .map((change) => `${change.label}\n${makeTruthPreview(change.content, 140)}`)
    .join("\n\n");
}

function extractWordCount(value: string, fallback?: number): number | undefined {
  const match = value.trim().match(/\b(\d{3,5})\b/);
  if (match) return parseInt(match[1]!, 10);
  return fallback;
}

function renderChapterStatus(status: string): string {
  switch (status) {
    case "approved":
      return "approved";
    case "drafted":
      return "drafted";
    case "rejected":
      return "rejected";
    default:
      return status;
  }
}

export function Cockpit({
  nav,
  theme,
  t,
  sse,
  initialBookId,
}: {
  readonly nav: Nav;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage> };
  readonly initialBookId?: string;
}) {
  const c = useColors(theme);
  const { data: booksData, loading: booksLoading, error: booksError, refetch: refetchBooks } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const { data: project, refetch: refetchProject } = useApi<ProjectSummary>("/project");
  const { data: llmCapabilities } = useApi<LlmCapabilitiesSummary>("/llm-capabilities");
  const { data: genreData } = useApi<{ genres: ReadonlyArray<GenreInfo> }>("/genres");
  const { data: activityData, refetch: refetchActivity } = useApi<{ entries: ReadonlyArray<SSEMessage> }>("/activity");
  const { data: createStatusData, refetch: refetchCreateStatus } = useApi<{ entries: ReadonlyArray<BookCreateJob> }>("/book-create-status");

  const [mode, setMode] = useState<CockpitMode>("discuss");
  const [selectedBookId, setSelectedBookId] = useState(initialBookId ?? "");
  const [selectedTruthFile, setSelectedTruthFile] = useState("");
  const [selectedChapterNumber, setSelectedChapterNumber] = useState<number | null>(null);
  const [showNewSetup, setShowNewSetup] = useState(!initialBookId);
  const [input, setInput] = useState("");
  const [threads, setThreads] = useState<Record<string, ReadonlyArray<CockpitMessage>>>({});
  const [proposals, setProposals] = useState<Record<string, ProposalState>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingBook, setCreatingBook] = useState(false);
  const [approvingSetup, setApprovingSetup] = useState(false);
  const [preparingFoundationPreview, setPreparingFoundationPreview] = useState(false);
  const [preparingSetupProposal, setPreparingSetupProposal] = useState(false);
  const [setupSession, setSetupSession] = useState<BookSetupSessionPayload | null>(null);
  const [setupTitle, setSetupTitle] = useState("");
  const [setupGenre, setSetupGenre] = useState("");
  const [setupPlatform, setSetupPlatform] = useState("");
  const [setupWords, setSetupWords] = useState(defaultChapterWordsForLanguage(resolveStudioLanguage(project?.language)));
  const [setupTargetChapters, setSetupTargetChapters] = useState("200");
  const [setupBrief, setSetupBrief] = useState("");
  const [readySetupFingerprint, setReadySetupFingerprint] = useState<string | null>(null);
  const [committedSetupFingerprint, setCommittedSetupFingerprint] = useState<string | null>(null);
  const [setupLlmForm, setSetupLlmForm] = useState<{ model: string; reasoningEffort: ReasoningEffort }>({
    model: "",
    reasoningEffort: "",
  });
  const [setupLlmSaving, setSetupLlmSaving] = useState(false);
  const [setupLlmError, setSetupLlmError] = useState<string | null>(null);
  const [pendingSetupBookId, setPendingSetupBookId] = useState("");
  const [selectedFoundationPreviewKey, setSelectedFoundationPreviewKey] = useState<FoundationPreviewKey>("storyBible");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(!initialBookId ? "setup" : "focus");
  const [recentSetupSessions, setRecentSetupSessions] = useState<ReadonlyArray<BookSetupSessionSummary>>([]);
  const [loadingRecentSetupSessions, setLoadingRecentSetupSessions] = useState(false);
  const [resumingSetupSessionId, setResumingSetupSessionId] = useState("");
  const [setupRecoveryError, setSetupRecoveryError] = useState<string | null>(null);
  const setupCreateAttemptRef = useRef<{ readonly fingerprint: string; readonly key: string } | null>(null);

  const projectLanguage = resolveStudioLanguage(project?.language);
  const projectProvider = project?.provider ?? "";
  const projectModel = (project?.model ?? "").trim() || defaultModelForProvider(projectProvider, llmCapabilities) || "";
  const projectReasoningEffort = normalizeReasoningEffortForProvider(
    project?.reasoningEffort ?? "",
    projectProvider,
    llmCapabilities,
  );
  const books = booksData?.books ?? [];
  const genres = useMemo(
    () => (genreData?.genres ?? []).filter((genre) => genre.language === projectLanguage || genre.source === "project"),
    [genreData?.genres, projectLanguage],
  );
  const platformOptions = useMemo(() => platformOptionsForLanguage(projectLanguage), [projectLanguage]);
  const setupThreadKey = "project:setup";
  const activeThreadKey = useMemo(() => {
    if (mode === "binder") {
      return `${selectedBookId || "project"}:binder:${selectedTruthFile || "none"}`;
    }
    if (mode === "discuss" && showNewSetup) {
      return setupThreadKey;
    }
    return `${selectedBookId || "project"}:${mode}`;
  }, [mode, selectedBookId, selectedTruthFile, showNewSetup]);
  const activeMessages = threads[activeThreadKey] ?? [];
  const activeProposal = proposals[activeThreadKey];
  const setupThreadMessages = threads[setupThreadKey] ?? [];
  const setupConversation = useMemo(
    () => toSetupConversation(setupThreadMessages),
    [setupThreadMessages],
  );
  const currentSetupDraftFingerprint = useMemo(() => buildSetupDraftFingerprint({
    title: setupTitle,
    genre: setupGenre,
    platform: setupPlatform,
    chapterWordCount: setupWords,
    targetChapters: setupTargetChapters,
    brief: setupBrief,
    conversation: setupConversation,
  }), [setupBrief, setupConversation, setupGenre, setupPlatform, setupTargetChapters, setupTitle, setupWords]);
  const setupDiscussionState = deriveSetupDiscussionState(readySetupFingerprint, currentSetupDraftFingerprint);
  const setupNotes = useMemo(() => buildSetupNotes({
    title: setupTitle,
    genre: setupGenre,
    platform: setupPlatform,
    chapterWordCount: setupWords,
    targetChapters: setupTargetChapters,
    brief: setupBrief,
    conversation: setupConversation,
    proposalContent: setupSession?.proposal.content,
  }), [setupBrief, setupConversation, setupGenre, setupPlatform, setupSession?.proposal.content, setupTargetChapters, setupTitle, setupWords]);
  const setupProposalDelta = useMemo(() => buildSetupProposalDeltaSummary({
    previousContent: setupSession?.previousProposal?.content,
    currentContent: setupSession?.proposal.content ?? "",
  }), [setupSession?.previousProposal?.content, setupSession?.proposal.content]);
  const setupDraftDirty = Boolean(
    setupSession
    && committedSetupFingerprint
    && committedSetupFingerprint !== currentSetupDraftFingerprint,
  );
  const setupCanPrepareProposal = canPrepareSetupProposal({
    discussionState: setupDiscussionState,
    title: setupTitle,
    genre: setupGenre,
  });
  const setupModelSuggestions = useMemo(
    () => modelSuggestionsForProvider(projectProvider, llmCapabilities),
    [llmCapabilities, projectProvider],
  );
  const setupReasoningEfforts = useMemo(
    () => reasoningEffortsForProvider(projectProvider, llmCapabilities),
    [llmCapabilities, projectProvider],
  );
  const setupSupportsReasoning = supportsReasoningEffort(projectProvider, llmCapabilities);
  const setupModelListId = useMemo(
    () => `cockpit-model-suggestions-${projectProvider || "default"}`,
    [projectProvider],
  );
  const setupLlmDirty = setupLlmForm.model.trim() !== projectModel
    || setupLlmForm.reasoningEffort !== projectReasoningEffort;
  const foundationPreviewTabs = useMemo(
    () => setupSession?.foundationPreview ? buildFoundationPreviewTabs(setupSession.foundationPreview, t) : [],
    [setupSession?.foundationPreview, t],
  );
  const activeFoundationPreview = foundationPreviewTabs.find((tab) => tab.key === selectedFoundationPreviewKey) ?? foundationPreviewTabs[0] ?? null;

  const loadRecentSetupSessions = useCallback(async () => {
    setLoadingRecentSetupSessions(true);
    setSetupRecoveryError(null);
    try {
      const data = await fetchJson<unknown>("/book-setup");
      setRecentSetupSessions(parseSetupSessions(data));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/^404\b/i.test(message) || message.toLowerCase().includes("not found")) {
        setRecentSetupSessions([]);
        return;
      }
      setSetupRecoveryError(message);
      setRecentSetupSessions([]);
    } finally {
      setLoadingRecentSetupSessions(false);
    }
  }, []);

  useEffect(() => {
    void loadRecentSetupSessions();
  }, [loadRecentSetupSessions]);

  const { data: bookDetailData, error: bookDetailError, refetch: refetchBookDetail } = useApi<BookDetailResponse>(
    selectedBookId ? `/books/${selectedBookId}` : "",
  );
  const { data: truthListData, refetch: refetchTruthList } = useApi<{ files: ReadonlyArray<TruthFileSummary> }>(
    selectedBookId ? `/books/${selectedBookId}/truth` : "",
  );
  const { data: truthDetailData, refetch: refetchTruthDetail } = useApi<TruthFileDetail>(
    selectedBookId && selectedTruthFile ? `/books/${selectedBookId}/truth/${selectedTruthFile}` : "",
  );
  const { data: chapterDetailData, refetch: refetchChapterDetail } = useApi<ChapterDetailResponse>(
    selectedBookId && selectedChapterNumber
      ? `/books/${selectedBookId}/chapters/${selectedChapterNumber}`
      : "",
  );

  useEffect(() => {
    if (initialBookId) {
      setSelectedBookId(initialBookId);
      setShowNewSetup(false);
    }
  }, [initialBookId]);

  useEffect(() => {
    const availableGenres = genres.map((genre) => genre.id);
    setSetupGenre((current) => pickValidValue(current, availableGenres));
  }, [genres]);

  useEffect(() => {
    const availablePlatforms = platformOptions.map((option) => option.value);
    setSetupPlatform((current) => pickValidValue(current, availablePlatforms));
  }, [platformOptions]);

  useEffect(() => {
    setSetupWords(defaultChapterWordsForLanguage(projectLanguage));
  }, [projectLanguage]);

  useEffect(() => {
    setSetupLlmForm({
      model: projectModel,
      reasoningEffort: projectReasoningEffort,
    });
  }, [projectModel, projectReasoningEffort, projectProvider]);

  useEffect(() => {
    setSetupLlmError(null);
  }, [setupLlmForm.model, setupLlmForm.reasoningEffort]);

  useEffect(() => {
    if (!showNewSetup) {
      setSetupSession(null);
      setPendingSetupBookId("");
      setReadySetupFingerprint(null);
      setCommittedSetupFingerprint(null);
      setInspectorTab((current) => current === "setup" ? "focus" : current);
    }
  }, [showNewSetup]);

  useEffect(() => {
    if (!foundationPreviewTabs.length) {
      setSelectedFoundationPreviewKey("storyBible");
      return;
    }
    if (!foundationPreviewTabs.some((tab) => tab.key === selectedFoundationPreviewKey)) {
      setSelectedFoundationPreviewKey(foundationPreviewTabs[0]!.key);
    }
  }, [foundationPreviewTabs, selectedFoundationPreviewKey]);

  useEffect(() => {
    if (!pendingSetupBookId) return;
    const created = books.some((book) => book.id === pendingSetupBookId);
    if (!created) return;

    setSelectedBookId(pendingSetupBookId);
    setShowNewSetup(false);
    setMode("discuss");
    setInspectorTab("focus");
    setPendingSetupBookId("");
  }, [books, pendingSetupBookId]);

  useEffect(() => {
    if (showNewSetup) {
      setSelectedBookId("");
      return;
    }

    if (!books.length) {
      setSelectedBookId("");
      return;
    }

    const stillExists = books.some((book) => book.id === selectedBookId);
    if (!selectedBookId || !stillExists) {
      setSelectedBookId(books[0]!.id);
    }
  }, [books, selectedBookId, showNewSetup]);

  useEffect(() => {
    const files = truthListData?.files ?? [];
    if (!files.length) {
      setSelectedTruthFile("");
      return;
    }

    const stillExists = files.some((file) => file.name === selectedTruthFile);
    if (!selectedTruthFile || !stillExists) {
      const preferred = files.find((file) => file.exists) ?? files[0]!;
      setSelectedTruthFile(preferred.name);
    }
  }, [selectedTruthFile, truthListData?.files]);

  useEffect(() => {
    const chapters = bookDetailData?.chapters ?? [];
    if (!chapters.length) {
      setSelectedChapterNumber(null);
      return;
    }

    const stillExists = chapters.some((chapter) => chapter.number === selectedChapterNumber);
    if (!selectedChapterNumber || !stillExists) {
      setSelectedChapterNumber(chapters[chapters.length - 1]!.number);
    }
  }, [bookDetailData?.chapters, selectedChapterNumber]);

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;

    if (shouldRefetchBookCollections(recent)) {
      void refetchBooks();
    }
    if (shouldRefetchBookCreateStatus(recent)) {
      void refetchCreateStatus();
    }
    if (selectedBookId && shouldRefetchBookView(recent, selectedBookId)) {
      void refetchBookDetail();
      void refetchTruthList();
      void refetchChapterDetail();
    }
    if (recent.event !== "ping") {
      void refetchActivity();
    }
  }, [
    refetchActivity,
    refetchBookDetail,
    refetchBooks,
    refetchChapterDetail,
    refetchCreateStatus,
    refetchTruthList,
    selectedBookId,
    sse.messages,
  ]);

  const appendMessage = (key: string, message: CockpitMessage) => {
    setThreads((current) => ({
      ...current,
      [key]: [...(current[key] ?? []), message],
    }));
  };

  const replaceProposal = (key: string, proposal: ProposalState | null) => {
    setProposals((current) => {
      if (!proposal) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: proposal };
    });
  };

  const syncSetupDraftSnapshot = useCallback((fingerprint: string) => {
    setReadySetupFingerprint(fingerprint);
    setCommittedSetupFingerprint(fingerprint);
  }, []);

  const buildSetupFingerprintFromSession = useCallback((session: BookSetupSessionPayload) => {
    return buildSetupDraftFingerprint({
      title: session.title,
      genre: session.genre,
      platform: session.platform,
      chapterWordCount: String(session.chapterWordCount),
      targetChapters: String(session.targetChapters),
      brief: session.brief,
      conversation: [],
    });
  }, []);

  const hydrateSetupSessionState = useCallback((session: BookSetupSessionPayload, summary?: BookSetupSessionSummary) => {
    setSetupSession(session);
    setSetupTitle(session.title || summary?.title || "");
    setSetupGenre(session.genre || summary?.genre || "");
    setSetupPlatform(session.platform || summary?.platform || "");
    setSetupWords(String(session.chapterWordCount || summary?.chapterWordCount || defaultChapterWordsForLanguage(projectLanguage)));
    setSetupTargetChapters(String(session.targetChapters || summary?.targetChapters || 200));
    setSetupBrief(session.brief || summary?.brief || "");
    setShowNewSetup(true);
    setMode("discuss");
    setInspectorTab("setup");
    setSelectedFoundationPreviewKey("storyBible");
  }, [projectLanguage]);

  const recoverLatestSetupSession = useCallback(async (sessionId: string, message: string) => {
    try {
      const latest = await fetchJson<BookSetupSessionPayload>("/book-setup/" + sessionId);
      hydrateSetupSessionState(latest);
      syncSetupDraftSnapshot(buildSetupFingerprintFromSession(latest));
      appendMessage(setupThreadKey, createMessage("system", message));
      setError(message);
      await loadRecentSetupSessions();
      return latest;
    } catch {
      setError(message);
      return null;
    }
  }, [buildSetupFingerprintFromSession, hydrateSetupSessionState, loadRecentSetupSessions, setupThreadKey, syncSetupDraftSnapshot]);

  const selectedBook = books.find((book) => book.id === selectedBookId) ?? null;
  const chapterItems = bookDetailData?.chapters ?? [];
  const truthFiles = truthListData?.files ?? [];
  const activityEntries = activityData?.entries.slice(0, 6) ?? [];
  const createJobs = createStatusData?.entries ?? [];

  const saveSetupLlm = async () => {
    if (!projectProvider) {
      return;
    }

    const nextModel = setupLlmForm.model.trim() || defaultModelForProvider(projectProvider, llmCapabilities) || "";
    if (!nextModel) {
      setSetupLlmError(t("config.modelRequired"));
      return;
    }

    setSetupLlmSaving(true);
    setSetupLlmError(null);
    try {
      await putApi("/project", {
        model: nextModel,
        reasoningEffort: normalizeReasoningEffortForProvider(
          setupLlmForm.reasoningEffort,
          projectProvider,
          llmCapabilities,
        ) || "",
      });
      await refetchProject();
    } catch (cause) {
      setSetupLlmError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSetupLlmSaving(false);
    }
  };

  const sendDiscussPrompt = async (
    rawText: string,
    options?: {
      readonly threadKey?: string;
      readonly forceSetup?: boolean;
    },
  ) => {
    const text = rawText.trim();
    if (!text) return;

    const threadKey = options?.threadKey ?? activeThreadKey;
    const threadMessages = threads[threadKey] ?? [];
    const useSetupScope = options?.forceSetup ?? false;
    const userMessage = createMessage("user", text);
    appendMessage(threadKey, userMessage);

    const scopeBlock = !useSetupScope && selectedBookId
      ? [
          `Current book: ${selectedBook?.title ?? selectedBookId}`,
          selectedTruthFile ? `Focused binder file: ${selectedTruthFile}` : "",
          selectedChapterNumber ? `Focused chapter: ${selectedChapterNumber}` : "",
        ].filter(Boolean).join("\n")
      : [
          `Project language: ${projectLanguage}`,
          setupTitle ? `Setup title: ${setupTitle}` : "",
          setupGenre ? `Setup genre: ${setupGenre}` : "",
          setupPlatform ? `Setup platform: ${setupPlatform}` : "",
          setupBrief ? `Setup brief:\n${setupBrief}` : "",
        ].filter(Boolean).join("\n");

    const instruction = [
      "You are helping plan and steer a novel inside InkOS Studio.",
      "Stay in discussion mode. Do not claim to edit files or commit changes.",
      "Ask clarifying questions when needed, summarize alignment clearly, and suggest the next concrete step.",
      scopeBlock ? `Context:\n${scopeBlock}` : "",
      threadMessages.length > 0 ? `Recent conversation:\n${buildConversationTranscript(threadMessages)}` : "",
      `User request:\n${text}`,
    ].filter(Boolean).join("\n\n");

    setBusy(true);
    setError(null);
    try {
      const response = await postApi<{ response?: string; error?: string }>("/agent", { instruction });
      appendMessage(threadKey, createMessage("assistant", response.response ?? response.error ?? ""));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      appendMessage(threadKey, createMessage("system", message));
    } finally {
      setBusy(false);
    }
  };

  const sendBinderPrompt = async (rawText: string, action: "ask" | "propose") => {
    const text = rawText.trim();
    if (!selectedBookId || !selectedTruthFile) {
      setError(t("cockpit.noBook"));
      return;
    }
    if (!text) return;

    const userMessage = createMessage("user", text);
    appendMessage(activeThreadKey, userMessage);

    setBusy(true);
    setError(null);
    try {
      const response = await fetchJson<TruthAssistResponse>(`/books/${selectedBookId}/truth/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: selectedTruthFile,
          scope: {
            kind: "file",
            fileName: selectedTruthFile,
          },
          instruction: text,
          mode: action === "ask" ? "question" : "proposal",
          conversation: [...activeMessages, userMessage]
            .filter((message) => message.role !== "system")
            .map((message) => ({ role: message.role, content: message.content })),
        }),
      });

      if (action === "ask" || response.mode === "question" || response.question) {
        appendMessage(activeThreadKey, createMessage("assistant", response.question ?? response.content));
        replaceProposal(activeThreadKey, null);
        setInspectorTab("focus");
        return;
      }

      const changes = response.changes ?? [];
      replaceProposal(activeThreadKey, {
        changes,
        createdAt: Date.now(),
      });
      setInspectorTab("changes");
      appendMessage(activeThreadKey, createMessage("assistant", summarizeProposal(changes)));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      appendMessage(activeThreadKey, createMessage("system", message));
    } finally {
      setBusy(false);
    }
  };

  const triggerDraftAction = async (rawText: string, action: "draft" | "write-next") => {
    if (!selectedBookId || !bookDetailData?.book) {
      setError(t("cockpit.noBook"));
      return;
    }

    const text = rawText.trim();
    if (text) {
      appendMessage(activeThreadKey, createMessage("user", text));
    }

    const body = action === "draft"
      ? {
          context: text || undefined,
          wordCount: extractWordCount(text, bookDetailData.book.chapterWordCount),
        }
      : {
          wordCount: extractWordCount(text, bookDetailData.book.chapterWordCount),
        };

    setBusy(true);
    setError(null);
    try {
      await postApi(`/books/${selectedBookId}/${action === "draft" ? "draft" : "write-next"}`, body);
      appendMessage(
        activeThreadKey,
        createMessage(
          "system",
          action === "draft"
            ? `${t("cockpit.generateDraft")} queued for ${selectedBook?.title ?? selectedBookId}.`
            : `${t("cockpit.writeNext")} queued for ${selectedBook?.title ?? selectedBookId}.`,
        ),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      appendMessage(activeThreadKey, createMessage("system", message));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (explicitAction?: ComposerAction) => {
    const parsedCommand = parseComposerCommand(input);
    const action = explicitAction ?? parsedCommand?.action ?? defaultActionForMode(mode);
    const text = (parsedCommand?.text ?? input).trim();

    if (action !== "write-next" && !text) return;

    setInput("");
    if (action === "ask") {
      await sendBinderPrompt(text, "ask");
      return;
    }
    if (action === "propose") {
      await sendBinderPrompt(text, "propose");
      return;
    }
    if (action === "draft" || action === "write-next") {
      await triggerDraftAction(text, action);
      return;
    }
    await sendDiscussPrompt(text);
  };

  const handleApplyChange = async (fileName: string, content: string) => {
    if (!selectedBookId) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/books/${selectedBookId}/truth/${fileName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          scope: {
            kind: "file",
            fileName,
          },
        }),
      });
      appendMessage(activeThreadKey, createMessage("system", `${t("cockpit.apply")} ${fileName}`));
      const nextChanges = (activeProposal?.changes ?? []).filter((change) => change.fileName !== fileName);
      replaceProposal(activeThreadKey, nextChanges.length ? { changes: nextChanges, createdAt: Date.now() } : null);
      setInspectorTab(nextChanges.length ? "changes" : "focus");
      await Promise.all([refetchTruthList(), refetchTruthDetail(), refetchBookDetail()]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      appendMessage(activeThreadKey, createMessage("system", message));
    } finally {
      setBusy(false);
    }
  };

  const handleApplyAll = async () => {
    if (!activeProposal?.changes.length) return;
    for (const change of activeProposal.changes) {
      // Sequential writes keep the UI consistent with single-file apply semantics.
      // eslint-disable-next-line no-await-in-loop
      await handleApplyChange(change.fileName, change.content);
    }
  };

  const handlePrepareSetupProposal = async () => {
    if (!setupTitle.trim()) {
      setError(t("create.titleRequired"));
      return;
    }
    if (!setupGenre) {
      setError(t("create.genreRequired"));
      return;
    }
    if (!setupCanPrepareProposal) {
      setError(t("cockpit.setupReadyHint"));
      return;
    }

    setShowNewSetup(true);
    setMode("discuss");
    setPendingSetupBookId("");
    setPreparingSetupProposal(true);
    setError(null);
    try {
      const result = await postApi<BookSetupSessionPayload>("/book-setup/propose", {
        sessionId: setupSession?.id,
        expectedRevision: setupSession?.revision,
        title: setupTitle.trim(),
        genre: setupGenre,
        language: projectLanguage,
        platform: setupPlatform,
        chapterWordCount: parseInt(setupWords, 10),
        targetChapters: parseInt(setupTargetChapters, 10),
        brief: setupBrief,
        conversation: setupConversation,
      });
      setSetupSession(result);
      syncSetupDraftSnapshot(currentSetupDraftFingerprint);
      setSelectedFoundationPreviewKey("storyBible");
      setInspectorTab("setup");
      appendMessage(setupThreadKey, createMessage("system", t("cockpit.setupProposalReady")));
      await loadRecentSetupSessions();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (setupSession && isBookSetupRevisionMismatchMessage(message)) {
        await recoverLatestSetupSession(setupSession.id, t("cockpit.setupRevisionChanged"));
        return;
      }
      setError(message);
    } finally {
      setPreparingSetupProposal(false);
    }
  };

  const handleApproveSetup = async () => {
    if (!setupSession) {
      setError(t("cockpit.setupProposalEmpty"));
      return;
    }
    if (setupDraftDirty) {
      setError(t("cockpit.setupDraftChanged"));
      return;
    }

    setApprovingSetup(true);
    setError(null);
    try {
      const request: BookSetupRevisionRequest = { expectedRevision: setupSession.revision };
      const result = await postApi<BookSetupSessionPayload>(`/book-setup/${setupSession.id}/approve`, request);
      setSetupSession(result);
      setCommittedSetupFingerprint(currentSetupDraftFingerprint);
      setShowNewSetup(true);
      setMode("discuss");
      setInspectorTab("setup");
      appendMessage(setupThreadKey, createMessage("system", t("cockpit.setupApproved")));
      await loadRecentSetupSessions();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (isBookSetupRevisionMismatchMessage(message)) {
        await recoverLatestSetupSession(setupSession.id, t("cockpit.setupRevisionChanged"));
        return;
      }
      setError(message);
    } finally {
      setApprovingSetup(false);
    }
  };

  const handlePrepareFoundationPreview = async () => {
    if (!setupSession) {
      setError(t("cockpit.setupProposalEmpty"));
      return;
    }
    if (setupSession.status !== "approved") {
      setError(t("cockpit.setupApproveFirst"));
      return;
    }
    if (setupDraftDirty) {
      setError(t("cockpit.setupDraftChanged"));
      return;
    }

    setPreparingFoundationPreview(true);
    setError(null);
    try {
      const request: BookSetupRevisionRequest = { expectedRevision: setupSession.revision };
      const result = await postApi<BookSetupSessionPayload>(`/book-setup/${setupSession.id}/foundation-preview`, request);
      setSetupSession(result);
      setCommittedSetupFingerprint(currentSetupDraftFingerprint);
      setSelectedFoundationPreviewKey("storyBible");
      setShowNewSetup(true);
      setMode("discuss");
      setInspectorTab("setup");
      appendMessage(setupThreadKey, createMessage("system", t("cockpit.foundationPreviewReady")));
      await loadRecentSetupSessions();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (isBookSetupRevisionMismatchMessage(message)) {
        await recoverLatestSetupSession(setupSession.id, t("cockpit.setupRevisionChanged"));
        return;
      }
      setError(message);
    } finally {
      setPreparingFoundationPreview(false);
    }
  };

  const handleCreateSetup = async () => {
    if (!setupSession) {
      setError(t("cockpit.setupProposalEmpty"));
      return;
    }
    if (setupSession.status !== "approved") {
      setError(t("cockpit.setupApproveFirst"));
      return;
    }
    if (!setupSession.foundationPreview) {
      setError(t("cockpit.foundationPreviewRequired"));
      return;
    }
    if (setupDraftDirty) {
      setError(t("cockpit.setupDraftChanged"));
      return;
    }

    setCreatingBook(true);
    setError(null);
    try {
      const request: BookSetupCreateRequest = {
        expectedRevision: setupSession.revision,
        expectedPreviewDigest: setupSession.foundationPreview.digest,
      };
      const fingerprint = buildSetupCreateRequestFingerprint({
        sessionId: setupSession.id,
        expectedRevision: request.expectedRevision,
        expectedPreviewDigest: request.expectedPreviewDigest,
      });
      const currentAttempt = setupCreateAttemptRef.current;
      const idempotencyKey = currentAttempt?.fingerprint === fingerprint
        ? currentAttempt.key
        : createIdempotencyKey();
      setupCreateAttemptRef.current = { fingerprint, key: idempotencyKey };

      const result = await postApi<{ bookId: string; session: BookSetupSessionPayload }>(`/book-setup/${setupSession.id}/create`, request, {
        headers: { "Idempotency-Key": idempotencyKey },
      });
      setSetupSession(result.session);
      setCommittedSetupFingerprint(currentSetupDraftFingerprint);
      setPendingSetupBookId(result.bookId);
      setMode("discuss");
      setInspectorTab("setup");
      appendMessage(setupThreadKey, createMessage("system", t("cockpit.setupApprovedQueued")));
      await Promise.all([refetchBooks(), refetchCreateStatus(), loadRecentSetupSessions()]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (isBookSetupRevisionMismatchMessage(message)) {
        await recoverLatestSetupSession(setupSession.id, t("cockpit.setupRevisionChanged"));
        return;
      }
      setError(message);
    } finally {
      setCreatingBook(false);
    }
  };

  const handleResumeSetupSession = async (summary: BookSetupSessionSummary) => {
    if (resumingSetupSessionId) {
      return;
    }

    setResumingSetupSessionId(summary.id);
    setError(null);
    setSetupRecoveryError(null);
    try {
      const result = await fetchJson<BookSetupSessionPayload>(`/book-setup/${summary.id}`);
      hydrateSetupSessionState(result, summary);
      syncSetupDraftSnapshot(buildSetupFingerprintFromSession(result));
      setThreads((current) => ({
        ...current,
        [setupThreadKey]: [createMessage("system", `${t("cockpit.setupRecoveredHeadline")} ${result.title}.`)],
      }));
      setProposals((current) => {
        const next = { ...current };
        delete next[setupThreadKey];
        return next;
      });
      await loadRecentSetupSessions();
      await Promise.all([refetchBooks(), refetchCreateStatus()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setResumingSetupSessionId("");
    }
  };

  const handleDiscussSetup = async () => {
    setShowNewSetup(true);
    setMode("discuss");
    setInspectorTab("setup");
    const prompt = [
      setupTitle ? `Title idea: ${setupTitle}` : "",
      setupGenre ? `Genre: ${setupGenre}` : "",
      setupPlatform ? `Platform: ${setupPlatform}` : "",
      setupBrief ? `Brief:\n${setupBrief}` : "Brainstorm a new story setup with me before writing binder files.",
    ].filter(Boolean).join("\n\n");
    await sendDiscussPrompt(prompt, { threadKey: setupThreadKey, forceSetup: true });
  };

  const canUseBinder = Boolean(selectedBookId && selectedTruthFile);
  const canUseDraft = Boolean(selectedBookId);
  const hasPendingChanges = Boolean(activeProposal?.changes.length);
  const modeLabel = mode === "binder" ? t("cockpit.binder") : mode === "draft" ? t("cockpit.draft") : t("cockpit.discuss");
  const selectedBookLabel = showNewSetup ? t("cockpit.newSetup") : selectedBook?.title ?? t("cockpit.noBook");
  const selectedTruthLabel = truthDetailData?.label ?? (selectedTruthFile || "—");
  const scopeDisplayLabel = mode === "binder" ? `${t("cockpit.selectedTruth")}: ${selectedTruthLabel}` : modeLabel;
  const selectedChapterLabel = selectedChapterNumber ? t("chapter.label").replace("{n}", `${selectedChapterNumber}`) : "—";
  const setupStatusLabel = setupSession ? `${setupSession.status} · r${setupSession.revision}` : t("cockpit.newSetup");
  const setupDiscussionLabel = setupDiscussionState === "ready"
    ? t("cockpit.setupReadyForProposal")
    : t("cockpit.setupDiscussing");
  const setupMissingInfoLabels = setupNotes.missing.map((item) => {
    if (item === "title") return t("cockpit.setupMissingTitle");
    if (item === "genre") return t("cockpit.setupMissingGenre");
    if (item === "brief") return t("cockpit.setupMissingBrief");
    return t("cockpit.setupMissingDiscussion");
  });
  const focusPreviewHeading = mode === "draft" ? t("cockpit.selectedChapter") : t("cockpit.selectedTruth");
  const focusPreviewTitle = mode === "draft"
    ? (chapterDetailData ? t("chapter.label").replace("{n}", `${chapterDetailData.chapterNumber}`) : t("cockpit.selectedChapter"))
    : (truthDetailData?.label ?? t("cockpit.selectedTruth"));
  const focusPreviewContent = mode === "draft" ? (chapterDetailData?.content ?? "") : (truthDetailData?.content ?? "");
  const railVisibility = deriveCockpitRailVisibility({ mode, showNewSetup });
  const setupPrimaryAction = deriveSetupPrimaryAction({
    discussionState: setupDiscussionState,
    draftDirty: setupDraftDirty,
    canPrepare: setupCanPrepareProposal,
    sessionStatus: setupSession?.status ?? null,
    hasFoundationPreview: Boolean(setupSession?.foundationPreview),
  });
  const statusStrip = deriveCockpitStatusStrip({
    provider: projectProvider,
    model: projectModel,
    reasoningEffort: projectReasoningEffort,
    mode,
    selectedBookLabel,
    selectedTruthLabel,
    selectedChapterLabel,
    showNewSetup,
    busy,
    preparingSetupProposal,
    approvingSetup,
    preparingFoundationPreview,
    creatingBook,
    createJobs,
    setupDiscussionState,
    setupSessionStatus: setupSession?.status ?? null,
    activityEntries,
  });
  const statusStageLabel = t(`cockpit.stage.${statusStrip.stage}`);
  const statusModelLabel = statusStrip.modelLabel === "-"
    ? (statusStrip.providerLabel || "-")
    : statusStrip.providerLabel
      ? `${statusStrip.providerLabel} · ${statusStrip.modelLabel}`
      : statusStrip.modelLabel;
  const statusReasoningLabel = statusStrip.reasoningLabel
    ? formatReasoningEffortLabel(statusStrip.reasoningLabel, t)
    : null;

  const renderSetupActionButton = (action: SetupPrimaryAction, primary = false) => {
    const className = primary ? c.btnPrimary : c.btnSecondary;

    switch (action) {
      case "discuss":
        return (
          <ActionButton
            key={action}
            className={className}
            icon={<Bot size={14} />}
            label={t("cockpit.discussSetup")}
            onClick={() => void handleDiscussSetup()}
          />
        );
      case "mark-ready":
        return (
          <ActionButton
            key={action}
            disabled={!setupTitle.trim() || !setupGenre || setupDiscussionState === "ready"}
            className={className}
            icon={<Check size={14} />}
            label={t("cockpit.setupMarkReady")}
            onClick={() => {
              setReadySetupFingerprint(currentSetupDraftFingerprint);
              setError(null);
            }}
          />
        );
      case "prepare-proposal":
        return (
          <ActionButton
            key={action}
            disabled={!setupCanPrepareProposal || preparingSetupProposal || approvingSetup || preparingFoundationPreview || creatingBook}
            className={className}
            icon={preparingSetupProposal ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            label={t("cockpit.prepareSetupProposal")}
            onClick={() => void handlePrepareSetupProposal()}
          />
        );
      case "approve":
        return (
          <ActionButton
            key={action}
            disabled={setupDraftDirty || approvingSetup || !setupSession || setupSession.status !== "proposed"}
            className={className}
            icon={approvingSetup ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            label={t("cockpit.approveCreate")}
            onClick={() => void handleApproveSetup()}
          />
        );
      case "preview-foundation":
        return (
          <ActionButton
            key={action}
            disabled={setupDraftDirty || preparingFoundationPreview || creatingBook || !setupSession || setupSession.status !== "approved"}
            className={className}
            icon={preparingFoundationPreview ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            label={t("cockpit.previewFoundation")}
            onClick={() => void handlePrepareFoundationPreview()}
          />
        );
      case "create":
        return (
          <ActionButton
            key={action}
            disabled={setupDraftDirty || creatingBook || !setupSession || setupSession.status !== "approved" || !setupSession.foundationPreview}
            className={className}
            icon={creatingBook ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            label={t("cockpit.createFromSetup")}
            onClick={() => void handleCreateSetup()}
          />
        );
      default: {
        const exhaustiveAction: never = action;
        return exhaustiveAction;
      }
    }
  };

  const secondarySetupActions: ReadonlyArray<SetupPrimaryAction> = ([
    "discuss",
    "mark-ready",
    "prepare-proposal",
    "approve",
    "preview-foundation",
    "create",
  ] as const).filter((action): action is SetupPrimaryAction => action !== setupPrimaryAction);

  return (
    <div className="space-y-6">
      <section className="rounded-[1.65rem] border border-border/50 bg-card/70 px-5 py-5 shadow-soft">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full studio-badge-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
              <MessageSquareText size={14} />
              {t("nav.cockpit")}
            </div>
            <div>
              <h1 className="font-serif text-[clamp(1.9rem,3vw,2.75rem)] leading-[1.04] text-foreground/92">
                {t("cockpit.title")}
              </h1>
              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
                {t("cockpit.subtitle")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => {
              void refetchBooks();
              void refetchCreateStatus();
              void refetchBookDetail();
              void refetchTruthList();
              void refetchTruthDetail();
              void refetchChapterDetail();
              void refetchActivity();
              void loadRecentSetupSessions();
            }} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${c.btnSecondary}`}>
              <RefreshCcw size={15} />
              {t("common.refresh")}
            </button>
            {selectedBookId && (
              <>
                <button onClick={() => nav.toBook(selectedBookId)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${c.btnSecondary}`}>
                  <BookOpen size={15} />
                  {t("cockpit.openBook")}
                </button>
                <button onClick={() => nav.toTruth(selectedBookId)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${c.btnPrimary}`}>
                  <FileText size={15} />
                  {t("cockpit.openBinder")}
                </button>
              </>
            )}
          </div>
        </div>

        {(booksLoading || booksError || createJobs.length > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {booksLoading && (
              <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 size={13} className="animate-spin" />
                {t("common.loading")}
              </div>
            )}
            {booksError && (
              <div className={`inline-flex max-w-full items-center rounded-full border px-3 py-2 text-xs ${c.error}`}>
                {booksError}
              </div>
            )}
            {createJobs.map((job) => (
              <div key={job.bookId} className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/50 bg-background/70 px-3 py-2 text-xs text-foreground/85">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
                  job.status === "error" ? "studio-badge-warn" : "studio-badge-ok"
                }`}>
                  {job.status === "error" ? t("dash.createFailed") : t("dash.createRunning")}
                </span>
                <span className="truncate font-medium">{job.title}</span>
                <span className="truncate text-muted-foreground">
                  {(job.error || job.stage || job.message || t("create.creatingHint")).split("\n")[0]}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="studio-cockpit-shell grid gap-5">
        <aside className="studio-cockpit-left studio-cockpit-rail space-y-4 xl:pr-1">
          <div className="rounded-[1.6rem] border border-border/50 bg-card/70 p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("cockpit.selectBook")}
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setShowNewSetup(true);
                  setMode("discuss");
                  setInspectorTab("setup");
                }}
                className={`w-full rounded-xl px-3 py-3 text-left text-sm transition-all ${
                  showNewSetup
                    ? "studio-chip-accent text-foreground font-semibold"
                    : "studio-chip"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Plus size={14} />
                  {t("cockpit.newSetup")}
                </div>
              </button>

              {books.map((book) => (
                <button
                  key={book.id}
                  type="button"
                  onClick={() => {
                    setShowNewSetup(false);
                    setSelectedBookId(book.id);
                    setInspectorTab("focus");
                  }}
                  className={`w-full rounded-xl px-3 py-3 text-left text-sm transition-all ${
                    !showNewSetup && selectedBookId === book.id
                      ? "studio-chip-accent text-foreground font-semibold"
                      : "studio-chip"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{book.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {book.genre} · {book.platform}
                      </div>
                    </div>
                    {book.chaptersWritten > 0 && (
                      <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold">
                        {book.chaptersWritten}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[1.6rem] border border-border/50 bg-card/70 p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("cockpit.scope")}
            </div>
            <div className="grid gap-2">
              <ModeButton
                active={mode === "discuss"}
                icon={<MessageSquareText size={15} />}
                label={t("cockpit.discuss")}
                onClick={() => {
                  setMode("discuss");
                  setInspectorTab(showNewSetup ? "setup" : "focus");
                }}
              />
              <ModeButton
                active={mode === "binder"}
                disabled={!selectedBookId}
                icon={<Wand2 size={15} />}
                label={t("cockpit.binder")}
                onClick={() => {
                  setMode("binder");
                  setInspectorTab("focus");
                }}
              />
              <ModeButton
                active={mode === "draft"}
                disabled={!selectedBookId}
                icon={<PenSquare size={15} />}
                label={t("cockpit.draft")}
                onClick={() => {
                  setMode("draft");
                  setInspectorTab("focus");
                }}
              />
            </div>
            <div className="mt-3 rounded-xl border border-border/50 bg-background/60 px-3 py-3 text-xs leading-6 text-muted-foreground">
              {t("cockpit.commandHint")}
            </div>
          </div>

          {railVisibility.showTruthList && selectedBookId && truthFiles.length > 0 && (
            <div className="rounded-[1.6rem] border border-border/50 bg-card/70 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                <FileText size={14} />
                {t("cockpit.selectedTruth")}
              </div>
              <div className="max-h-[18rem] space-y-2 overflow-y-auto pr-1">
                {truthFiles.map((file) => (
                  <button
                    key={file.name}
                    type="button"
                    onClick={() => {
                      setSelectedTruthFile(file.name);
                      setMode("binder");
                      setInspectorTab("focus");
                    }}
                    className={`w-full rounded-xl px-3 py-3 text-left text-sm transition-all ${
                      selectedTruthFile === file.name
                        ? "studio-chip-accent text-foreground font-semibold"
                        : "studio-chip"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{file.label}</span>
                      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {file.exists ? "saved" : "seed"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {makeTruthPreview(file.preview, 72)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {railVisibility.showChapterList && selectedBookId && chapterItems.length > 0 && (
            <div className="rounded-[1.6rem] border border-border/50 bg-card/70 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                <BookOpen size={14} />
                {t("cockpit.selectedChapter")}
              </div>
              <div className="max-h-[16rem] space-y-2 overflow-y-auto pr-1">
                {[...chapterItems].reverse().slice(0, 8).map((chapter) => (
                  <button
                    key={chapter.number}
                    type="button"
                    onClick={() => {
                      setSelectedChapterNumber(chapter.number);
                      setMode("draft");
                      setInspectorTab("focus");
                    }}
                    className={`w-full rounded-xl px-3 py-3 text-left text-sm transition-all ${
                      selectedChapterNumber === chapter.number
                        ? "studio-chip-accent text-foreground font-semibold"
                        : "studio-chip"
                    }`}
                  >
                    <div className="truncate font-medium">
                      {t("chapter.label").replace("{n}", `${chapter.number}`)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {chapter.title || renderChapterStatus(chapter.status)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <div className="studio-cockpit-main rounded-[1.9rem] border border-border/50 bg-card/70 p-4 md:p-5">
          <div className="mb-4 space-y-4 border-b border-border/50 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {t("cockpit.scope")}
                </div>
                <div className="mt-2 text-lg font-semibold text-foreground">
                  {modeLabel}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {selectedBookLabel}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <ScopeChip accent label={t("cockpit.scope")} value={scopeDisplayLabel} />
              <ScopeChip label={t("cockpit.selectBook")} value={selectedBookLabel} />
              {!showNewSetup && mode === "binder" && (
                <ScopeChip label={t("cockpit.selectedTruth")} value={selectedTruthLabel} />
              )}
              {!showNewSetup && mode === "draft" && (
                <ScopeChip label={t("cockpit.selectedChapter")} value={selectedChapterLabel} />
              )}
              {showNewSetup && (
                <ScopeChip label={t("cockpit.setupTitle")} value={setupStatusLabel} />
              )}
              {hasPendingChanges && (
                <ScopeChip accent label={t("cockpit.pendingChanges")} value={`${activeProposal?.changes.length ?? 0}`} />
              )}
            </div>
          </div>

          <div className="flex min-h-[clamp(22rem,50vh,30rem)] flex-col">
            <div className="min-h-[clamp(12rem,28vh,18rem)] flex-1 space-y-3 overflow-y-auto pr-1">
              {activeMessages.length === 0 ? (
                <div className="rounded-[1.35rem] border border-dashed border-border/60 bg-background/55 px-5 py-7 text-center text-sm leading-7 text-muted-foreground">
                  {t("cockpit.messagesEmpty")}
                </div>
              ) : (
                activeMessages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))
              )}
            </div>

            <div className="mt-5 border-t border-border/50 pt-4">
              {error && (
                <div className={`mb-3 rounded-xl border px-4 py-3 text-sm ${c.error}`}>
                  {error}
                </div>
              )}

              <div className="studio-cockpit-status-strip mb-3">
                <div className="studio-cockpit-status-pills">
                  <StatusPill accent label={t("cockpit.statusStage")} value={statusStageLabel} />
                  <StatusPill label={t("cockpit.statusModel")} value={statusModelLabel} />
                  {statusReasoningLabel ? (
                    <StatusPill label={t("config.reasoningLevel")} value={statusReasoningLabel} />
                  ) : null}
                </div>
                {statusStrip.latestEvent ? (
                  <div className="studio-cockpit-status-event">
                    <span className="studio-cockpit-status-event-label">{t("cockpit.statusLatestEvent")}</span>
                    <span className="truncate">{statusStrip.latestEvent}</span>
                  </div>
                ) : null}
              </div>

              <div className="rounded-[1.35rem] border border-border/50 bg-background/55 p-3">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void handleSubmit();
                    }
                  }}
                  placeholder={t("common.enterCommand")}
                  className={`min-h-[112px] w-full rounded-[1.15rem] border-0 bg-transparent px-3 py-3 text-sm leading-7 outline-none ${c.input}`}
                />

                <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="text-xs leading-6 text-muted-foreground">
                    {t("cockpit.commandHint")}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {mode === "binder" ? (
                      <>
                        <ActionButton
                          disabled={busy || !canUseBinder}
                          className={c.btnPrimary}
                          icon={<Lightbulb size={14} />}
                          label={t("cockpit.ask")}
                          onClick={() => void handleSubmit("ask")}
                        />
                        <ActionButton
                          disabled={busy || !canUseBinder}
                          className={c.btnSecondary}
                          icon={<Wand2 size={14} />}
                          label={t("cockpit.propose")}
                          onClick={() => void handleSubmit("propose")}
                        />
                        {activeProposal?.changes.length ? (
                          <ActionButton
                            disabled={busy}
                            className={c.btnSecondary}
                            icon={<Check size={14} />}
                            label={t("cockpit.applyAll")}
                            onClick={() => void handleApplyAll()}
                          />
                        ) : null}
                      </>
                    ) : mode === "draft" ? (
                      <>
                        <ActionButton
                          disabled={busy || !canUseDraft}
                          className={c.btnPrimary}
                          icon={<PenSquare size={14} />}
                          label={t("cockpit.generateDraft")}
                          onClick={() => void handleSubmit("draft")}
                        />
                        <ActionButton
                          disabled={busy || !canUseDraft}
                          className={c.btnSecondary}
                          icon={<Sparkles size={14} />}
                          label={t("cockpit.writeNext")}
                          onClick={() => void handleSubmit("write-next")}
                        />
                      </>
                    ) : (
                      <ActionButton
                        disabled={busy}
                        className={c.btnPrimary}
                        icon={<Bot size={14} />}
                        label={t("cockpit.discuss")}
                        onClick={() => void handleSubmit("discuss")}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="studio-cockpit-right studio-cockpit-rail xl:pr-1">
          <div className="rounded-[1.6rem] border border-border/50 bg-card/70 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {t("cockpit.currentContext")}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {selectedBookLabel}
                </div>
              </div>
              {hasPendingChanges && (
                <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
                  {activeProposal?.changes.length}
                </span>
              )}
            </div>

            <div className="studio-inspector-tabbar">
              <InspectorTabButton
                active={inspectorTab === "focus"}
                icon={<BookOpen size={13} />}
                label={t("cockpit.currentContext")}
                onClick={() => setInspectorTab("focus")}
              />
              <InspectorTabButton
                active={inspectorTab === "changes"}
                icon={<Check size={13} />}
                label={t("cockpit.pendingChanges")}
                badge={hasPendingChanges ? activeProposal?.changes.length : undefined}
                onClick={() => setInspectorTab("changes")}
              />
              <InspectorTabButton
                active={inspectorTab === "setup"}
                icon={<Sparkles size={13} />}
                label={t("cockpit.setupTitle")}
                onClick={() => setInspectorTab("setup")}
              />
              <InspectorTabButton
                active={inspectorTab === "activity"}
                icon={<RefreshCcw size={13} />}
                label={t("cockpit.activity")}
                onClick={() => setInspectorTab("activity")}
              />
            </div>

            <div className="mt-4">
              {inspectorTab === "focus" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      {focusPreviewHeading}
                    </div>
                    {focusPreviewContent ? (
                      <div className="rounded-xl border border-border/50 bg-background/70 px-4 py-4">
                        <div className="mb-2 font-medium text-foreground">{focusPreviewTitle}</div>
                        <div className="max-h-[24rem] overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-foreground/85">
                          {focusPreviewContent.slice(0, 1600)}
                          {focusPreviewContent.length > 1600 ? "…" : ""}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border/60 bg-background/50 px-4 py-8 text-center text-sm text-muted-foreground">
                        {t("cockpit.noBook")}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {inspectorTab === "changes" && (
                activeProposal?.changes.length ? (
                  <div className="space-y-4">
                    {activeProposal.changes.map((change) => {
                      const before = change.fileName === selectedTruthFile ? truthDetailData?.content ?? "" : "";
                      const diff = buildTruthLineDiff(before, change.content);
                      const summary = summarizeTruthDiff(diff);
                      return (
                        <div key={change.fileName} className="rounded-2xl border border-border/50 bg-background/60 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-medium text-foreground">{change.label}</div>
                              <div className="text-xs text-muted-foreground">
                                +{summary.added} / -{summary.removed}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleApplyChange(change.fileName, change.content)}
                              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${c.btnPrimary}`}
                            >
                              <Check size={13} />
                              {t("cockpit.apply")}
                            </button>
                          </div>

                          <div className="mt-3 max-h-[18rem] overflow-y-auto rounded-xl border border-border/50 bg-background/70 px-3 py-3 font-mono text-xs leading-6">
                            {diff.map((line, index) => (
                              <div
                                key={`${change.fileName}-${index}`}
                                className={
                                  line.type === "add"
                                    ? "text-emerald-300"
                                    : line.type === "remove"
                                      ? "text-rose-300"
                                      : line.type === "skip"
                                        ? "text-muted-foreground italic"
                                        : "text-foreground/75"
                                }
                              >
                                {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                                {line.text}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/60 bg-background/50 px-4 py-8 text-center text-sm leading-7 text-muted-foreground">
                    {t("cockpit.commandHint")}
                  </div>
                )
              )}

              {inspectorTab === "setup" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                    <div className="mb-3 flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      <span>{t("cockpit.setupRecoveryTitle")}</span>
                      {loadingRecentSetupSessions && <Loader2 size={12} className="animate-spin" />}
                    </div>
                    <div className="mb-3 text-xs leading-6 text-muted-foreground">
                      {t("cockpit.setupRecoveryHint")}
                    </div>

                    {setupRecoveryError && (
                      <div className={`rounded-xl border px-3 py-2 text-xs ${c.error}`}>
                        {setupRecoveryError}
                      </div>
                    )}

                    {recentSetupSessions.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/60 bg-background/50 px-3 py-6 text-center text-xs text-muted-foreground">
                        {t("cockpit.setupRecoveryEmpty")}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {recentSetupSessions.map((session) => {
                          const sessionLabel = session.updatedAt || session.createdAt;
                          return (
                            <div key={session.id} className="rounded-2xl border border-border/50 bg-background/70 px-3 py-3">
                              <div className="mb-2 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-foreground">{session.title}</div>
                                  <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                                    <span className="rounded-full studio-badge-soft px-2 py-1 uppercase tracking-[0.12em]">{session.status}</span>
                                    <span>{session.genre}</span>
                                    <span>·</span>
                                    <span>{session.platform}</span>
                                    <span>·</span>
                                    <span>{`${session.chapterWordCount}/${session.targetChapters} ch`}</span>
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">{sessionLabel}</div>
                                  {session.brief ? (
                                    <div className="mt-2 text-xs leading-5 text-muted-foreground">
                                      {makeTruthPreview(session.brief, 78)}
                                    </div>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void handleResumeSetupSession(session)}
                                  disabled={resumingSetupSessionId === session.id}
                                  className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${
                                    resumingSetupSessionId === session.id
                                      ? "cursor-not-allowed opacity-45"
                                      : c.btnSecondary
                                  }`}
                                >
                                  {resumingSetupSessionId === session.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
                                  {t("cockpit.resumeSetup")}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                          {t("app.llmSettings")}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-border/40 bg-card/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {projectProvider ? shortLabelForProvider(projectProvider) : "-"}
                          </span>
                          <span className="text-xs text-foreground/85">
                            {projectProvider ? compactModelLabel(projectProvider, projectModel || "-") : "-"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mb-3 text-xs leading-6 text-muted-foreground">
                      {t("cockpit.setupLlmHint")}
                    </div>

                    {setupLlmError && (
                      <div className={`mb-3 rounded-xl border px-3 py-2 text-xs ${c.error}`}>
                        {setupLlmError}
                      </div>
                    )}

                    <div className="space-y-3">
                      <label className="block space-y-1">
                        <span className="text-[11px] font-medium text-muted-foreground">{t("config.model")}</span>
                        <input
                          list={setupModelListId}
                          value={setupLlmForm.model}
                          onChange={(event) => setSetupLlmForm((current) => ({ ...current, model: event.target.value }))}
                          placeholder={defaultModelForProvider(projectProvider, llmCapabilities) || t("config.model")}
                          disabled={!projectProvider || setupLlmSaving}
                          className={`w-full rounded-xl px-3 py-2.5 text-sm outline-none ${c.input}`}
                        />
                        <datalist id={setupModelListId}>
                          {setupModelSuggestions.map((model) => (
                            <option key={model} value={model} />
                          ))}
                        </datalist>
                      </label>

                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                        <label className="block space-y-1">
                          <span className="text-[11px] font-medium text-muted-foreground">{t("config.reasoningLevel")}</span>
                          <select
                            value={setupSupportsReasoning ? setupLlmForm.reasoningEffort : ""}
                            onChange={(event) => setSetupLlmForm((current) => ({
                              ...current,
                              reasoningEffort: event.target.value as ReasoningEffort,
                            }))}
                            disabled={!setupSupportsReasoning || setupLlmSaving}
                            className={`rounded-xl px-3 py-2.5 text-sm outline-none ${c.input} disabled:opacity-60`}
                          >
                            <option value="">{setupSupportsReasoning ? t("config.default") : t("config.reasoningUnsupported")}</option>
                            {setupReasoningEfforts.map((effort) => (
                              <option key={effort} value={effort}>
                                {effort === "none"
                                  ? t("config.reasoningNone")
                                  : effort === "minimal"
                                    ? t("config.reasoningMinimal")
                                    : effort === "low"
                                      ? t("config.reasoningLow")
                                      : effort === "medium"
                                        ? t("config.reasoningMedium")
                                        : effort === "high"
                                          ? t("config.reasoningHigh")
                                          : t("config.reasoningXHigh")}
                              </option>
                            ))}
                          </select>
                        </label>

                        <button
                          type="button"
                          onClick={() => void saveSetupLlm()}
                          disabled={setupLlmSaving || !setupLlmDirty || !projectProvider}
                          className={`self-end rounded-xl px-3 py-2 text-sm font-semibold ${
                            setupLlmSaving || !setupLlmDirty || !projectProvider ? "cursor-not-allowed opacity-45" : c.btnPrimary
                          }`}
                        >
                          {setupLlmSaving ? t("config.saving") : t("config.save")}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                        {t("cockpit.setupTitle")}
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                        setupDiscussionState === "ready" ? "studio-badge-ok" : "studio-badge-soft"
                      }`}>
                        {setupDiscussionLabel}
                      </span>
                    </div>
                    <div className="mb-3 text-xs leading-6 text-muted-foreground">
                      {t("cockpit.setupReadyHint")}
                    </div>
                    {setupDraftDirty && (
                      <div className={`mb-3 rounded-xl border px-3 py-2 text-xs ${c.error}`}>
                        {t("cockpit.setupDraftChanged")}
                      </div>
                    )}
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
                          {setupStatusLabel}
                        </span>
                        {setupSession?.previousProposal && (
                          <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
                            {t("cockpit.setupWhatChanged")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 space-y-3">
                      <input
                        value={setupTitle}
                        onChange={(event) => setSetupTitle(event.target.value)}
                        placeholder={t("create.placeholder")}
                        className={`w-full rounded-xl px-3 py-2.5 text-sm outline-none ${c.input}`}
                      />
                      <div className="grid gap-3 md:grid-cols-2">
                        <select
                          value={setupGenre}
                          onChange={(event) => setSetupGenre(event.target.value)}
                          className={`rounded-xl px-3 py-2.5 text-sm outline-none ${c.input}`}
                        >
                          {genres.map((genre) => (
                            <option key={genre.id} value={genre.id}>{genre.name}</option>
                          ))}
                        </select>
                        <select
                          value={setupPlatform}
                          onChange={(event) => setSetupPlatform(event.target.value)}
                          className={`rounded-xl px-3 py-2.5 text-sm outline-none ${c.input}`}
                        >
                          {platformOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <input
                          value={setupWords}
                          onChange={(event) => setSetupWords(event.target.value)}
                          placeholder={t("create.wordsPerChapter")}
                          className={`rounded-xl px-3 py-2.5 text-sm outline-none ${c.input}`}
                        />
                        <input
                          value={setupTargetChapters}
                          onChange={(event) => setSetupTargetChapters(event.target.value)}
                          placeholder={t("create.targetChapters")}
                          className={`rounded-xl px-3 py-2.5 text-sm outline-none ${c.input}`}
                        />
                      </div>
                      <textarea
                        value={setupBrief}
                        onChange={(event) => setSetupBrief(event.target.value)}
                        placeholder={t("cockpit.setupBrief")}
                        className={`min-h-[120px] w-full rounded-xl px-3 py-3 text-sm leading-7 outline-none ${c.input}`}
                      />
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          {renderSetupActionButton(setupPrimaryAction, true)}
                          {secondarySetupActions.map((action) => renderSetupActionButton(action))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <ActionButton
                            className={c.btnSecondary}
                            icon={<ArrowRight size={14} />}
                            label={t("cockpit.legacyCreate")}
                            onClick={() => nav.toBookCreate?.()}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      {t("cockpit.setupNotes")}
                    </div>
                    <div className="space-y-3">
                      <div>
                        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          {t("cockpit.setupChosen")}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(setupNotes.chosen.length > 0 ? setupNotes.chosen : ["-"]).map((item) => (
                            <span key={`chosen-${item}`} className="rounded-full studio-badge-soft px-2 py-1 text-[11px] text-foreground/85">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          {t("cockpit.setupMissingInfo")}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(setupMissingInfoLabels.length > 0 ? setupMissingInfoLabels : ["-"]).map((item) => (
                            <span key={`missing-${item}`} className="rounded-full border border-border/40 bg-card/70 px-2 py-1 text-[11px] text-muted-foreground">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          {t("cockpit.setupOpenQuestions")}
                        </div>
                        <div className="space-y-1">
                          {(setupNotes.openQuestions.length > 0 ? setupNotes.openQuestions : ["-"]).map((item) => (
                            <div key={`question-${item}`} className="text-sm leading-6 text-foreground/85">
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          {t("cockpit.setupCreativeBrief")}
                        </div>
                        <div className="rounded-xl border border-border/50 bg-background/70 px-3 py-3 text-sm leading-6 text-foreground/85">
                          {setupNotes.creativeBriefPreview || "-"}
                        </div>
                      </div>
                    </div>
                  </div>

                  {setupSession && (
                    <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                      <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                        {t("cockpit.setupWhatChanged")}
                      </div>
                      {setupProposalDelta.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {setupProposalDelta.map((item) => (
                            <span key={`delta-${item}`} className="rounded-full studio-badge-soft px-2 py-1 text-[11px] text-foreground/85">
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm leading-6 text-muted-foreground">
                          {t("cockpit.setupNoDelta")}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                        {t("cockpit.setupProposalTitle")}
                      </div>
                      {setupSession && (
                        <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
                          {setupSession.status} · {setupSession.bookId} · r{setupSession.revision}
                        </span>
                      )}
                    </div>
                    <div className="mb-3 text-xs leading-6 text-muted-foreground">
                      {t("cockpit.approvalGate")}
                    </div>
                    {setupSession ? (
                      <div className="max-h-[19rem] overflow-y-auto whitespace-pre-wrap rounded-xl border border-border/50 bg-background/70 px-3 py-3 text-sm leading-7 text-foreground/88">
                        {setupSession.proposal.content}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border/60 bg-background/50 px-3 py-6 text-sm leading-7 text-muted-foreground">
                        {t("cockpit.setupProposalEmpty")}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                        {t("cockpit.foundationPreviewTitle")}
                      </div>
                      {setupSession?.foundationPreview && (
                        <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
                          exact preview
                        </span>
                      )}
                    </div>
                    <div className="mb-3 text-xs leading-6 text-muted-foreground">
                      {t("cockpit.foundationGate")}
                    </div>
                    {setupSession?.foundationPreview && activeFoundationPreview ? (
                      <>
                        <div className="mb-3 flex flex-wrap gap-2">
                          {foundationPreviewTabs.map((entry) => (
                            <button
                              key={entry.key}
                              type="button"
                              onClick={() => setSelectedFoundationPreviewKey(entry.key)}
                              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectedFoundationPreviewKey === entry.key ? c.btnPrimary : c.btnSecondary}`}
                            >
                              {entry.label}
                            </button>
                          ))}
                        </div>
                        <div className="max-h-[22rem] overflow-y-auto whitespace-pre-wrap rounded-xl border border-border/50 bg-background/70 px-3 py-3 text-sm leading-7 text-foreground/88">
                          {activeFoundationPreview.content}
                        </div>
                      </>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border/60 bg-background/50 px-3 py-6 text-sm leading-7 text-muted-foreground">
                        {t("cockpit.foundationPreviewEmpty")}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {inspectorTab === "activity" && (
                <div className="space-y-2">
                  {activityEntries.length > 0 ? activityEntries.map((entry, index) => (
                    <div key={`${entry.event}-${entry.timestamp}-${index}`} className="rounded-xl border border-border/50 bg-background/60 px-3 py-3">
                      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        {entry.event}
                      </div>
                      <div className="mt-1 text-sm text-foreground/85">
                        {makeTruthPreview(JSON.stringify(entry.data ?? {}, null, 2), 140)}
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-xl border border-dashed border-border/60 bg-background/50 px-3 py-6 text-center text-sm text-muted-foreground">
                      {t("app.alertsEmpty")}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>
      </section>

      {bookDetailError && selectedBookId && !showNewSetup && (
        <div className="rounded-2xl border border-border/50 bg-card/70 px-5 py-4 text-sm text-muted-foreground">
          {bookDetailError}
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition-all ${
        active
          ? "studio-chip-accent text-foreground font-semibold"
          : "studio-chip"
      } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function InspectorTabButton({
  active,
  icon,
  label,
  badge,
  onClick,
}: {
  readonly active: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly badge?: number;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`studio-inspector-tab inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold ${active ? "studio-chip-accent text-foreground" : "studio-chip"}`}
    >
      {icon}
      <span>{label}</span>
      {typeof badge === "number" ? (
        <span className="rounded-full studio-badge-soft px-1.5 py-0.5 text-[10px] font-bold">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function ScopeChip({
  label,
  value,
  accent = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly accent?: boolean;
}) {
  return (
    <div className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-2 text-xs ${accent ? "studio-chip-accent" : "studio-chip"}`}>
      <span className="shrink-0 font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="truncate text-sm font-semibold text-foreground/90">
        {value}
      </span>
    </div>
  );
}

function StatusPill({
  label,
  value,
  accent = false,
}: {
  readonly label?: string;
  readonly value: string;
  readonly accent?: boolean;
}) {
  return (
    <div className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-[11px] ${accent ? "studio-chip-accent" : "studio-chip"}`}>
      {label ? (
        <span className="shrink-0 font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
      ) : null}
      <span className="truncate text-sm font-semibold text-foreground/90">
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  disabled = false,
  className = "studio-chip",
  icon,
  label,
  onClick,
}: {
  readonly disabled?: boolean;
  readonly className?: string;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${className} ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
    >
      {icon}
      {label}
    </button>
  );
}

function formatReasoningEffortLabel(value: string, t: TFunction): string {
  if (value === "none") return t("config.reasoningNone");
  if (value === "minimal") return t("config.reasoningMinimal");
  if (value === "low") return t("config.reasoningLow");
  if (value === "medium") return t("config.reasoningMedium");
  if (value === "high") return t("config.reasoningHigh");
  if (value === "xhigh") return t("config.reasoningXHigh");
  return value;
}

function MessageBubble({ message }: { readonly message: CockpitMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-[1.35rem] px-4 py-3 text-sm leading-7 shadow-sm ${
        isUser
          ? "bg-foreground text-background"
          : isSystem
            ? "border border-border/60 bg-background/70 text-muted-foreground"
            : "border border-border/60 bg-card text-foreground/90"
      }`}>
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    </div>
  );
}
