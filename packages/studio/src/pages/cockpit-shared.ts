import type { TFunction } from "../hooks/use-i18n";
import type { BookSetupConversationEntry, BookSetupSessionPayload } from "../shared/contracts";

export interface BookSetupSessionSummary {
  readonly id: string;
  readonly revision: number;
  readonly status: BookSetupSessionPayload["status"];
  readonly title: string;
  readonly genre: string;
  readonly language: BookSetupSessionPayload["language"];
  readonly platform: string;
  readonly chapterWordCount: number;
  readonly targetChapters: number;
  readonly brief: string;
  readonly bookId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CockpitMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly createdAt: number;
}

export interface ProposalState {
  readonly changes: ReadonlyArray<{
    readonly fileName: string;
    readonly label: string;
    readonly beforeContent: string;
    readonly content: string;
  }>;
  readonly createdAt: number;
}

export type FoundationPreviewKey = "storyBible" | "volumeOutline" | "bookRules" | "currentState" | "pendingHooks";
export type InspectorTab = "focus" | "changes" | "setup" | "activity";

export interface FoundationPreviewTab {
  readonly key: FoundationPreviewKey;
  readonly label: string;
  readonly content: string;
}

export function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = parseInt(asText(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function asSetupLanguage(value: unknown): BookSetupSessionPayload["language"] {
  const valueAsText = asText(value);
  if (valueAsText === "ko" || valueAsText === "zh" || valueAsText === "en") return valueAsText;
  return "ko";
}

export function asSetupStatus(value: unknown): BookSetupSessionPayload["status"] {
  if (value === "approved" || value === "creating") return value;
  return "proposed";
}

export function toBookSetupSessionSummary(value: unknown): BookSetupSessionSummary | null {
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

export function parseSetupSessions(value: unknown): ReadonlyArray<BookSetupSessionSummary> {
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

export function isBookSetupRevisionMismatchMessage(message: string): boolean {
  return message.includes("changed while you were reviewing it");
}

export function buildSetupCreateRequestFingerprint(input: {
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

export function buildFoundationPreviewTabs(
  preview: NonNullable<BookSetupSessionPayload["foundationPreview"]>,
  t: TFunction,
): ReadonlyArray<FoundationPreviewTab> {
  return [
    { key: "storyBible", label: t("cockpit.foundationStoryBible"), content: preview.storyBible },
    { key: "volumeOutline", label: t("cockpit.foundationVolumeOutline"), content: preview.volumeOutline },
    { key: "bookRules", label: t("cockpit.foundationBookRules"), content: preview.bookRules },
    { key: "currentState", label: t("cockpit.foundationCurrentState"), content: preview.currentState },
    { key: "pendingHooks", label: t("cockpit.foundationPendingHooks"), content: preview.pendingHooks },
  ];
}

export function createMessage(role: CockpitMessage["role"], content: string): CockpitMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
  };
}

export function toSetupConversation(messages: ReadonlyArray<CockpitMessage>): ReadonlyArray<BookSetupConversationEntry> {
  return messages
    .filter((message): message is CockpitMessage & { readonly role: "user" | "assistant" } => message.role !== "system")
    .map((message) => ({ role: message.role, content: message.content }));
}
