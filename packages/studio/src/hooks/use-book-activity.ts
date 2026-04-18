import type { SSEMessage } from "./use-sse";

const START_EVENTS = new Set(["write:start", "draft:start"]);
const TERMINAL_EVENTS = new Set(["write:complete", "write:error", "draft:complete", "draft:error", "draft:cancelled"]);
const BOOK_REFRESH_EVENTS = new Set([
  "book:updated",
  "write:complete",
  "write:error",
  "draft:cancelled",
  "draft:complete",
  "draft:error",
  "rewrite:complete",
  "rewrite:error",
  "revise:complete",
  "revise:error",
  "audit:complete",
  "audit:error",
]);

const BOOK_COLLECTION_REFRESH_EVENTS = new Set([
  "book:created",
  "book:updated",
  "book:deleted",
  "book:error",
  "write:complete",
  "write:error",
  "draft:cancelled",
  "draft:complete",
  "draft:error",
  "rewrite:complete",
  "rewrite:error",
  "revise:complete",
  "revise:error",
  "audit:complete",
  "audit:error",
]);

const BOOK_CREATE_STATUS_REFRESH_EVENTS = new Set([
  "book:creating",
  "book:create:progress",
  "book:created",
  "book:error",
]);

const DAEMON_STATUS_REFRESH_EVENTS = new Set([
  "daemon:started",
  "daemon:stopped",
  "daemon:error",
]);

export interface BookActivity {
  readonly writing: boolean;
  readonly drafting: boolean;
  readonly draftCancelling: boolean;
  readonly lastError: string | null;
  readonly liveDetail: string | null;
  readonly elapsedMs: number | null;
  readonly totalChars: number | null;
}

function getBookId(message: SSEMessage): string | null {
  const data = message.data as { bookId?: unknown } | null;
  return typeof data?.bookId === "string" ? data.bookId : null;
}

function getLogMessage(message: SSEMessage): string | null {
  const data = message.data as { message?: unknown } | null;
  if (typeof data?.message !== "string") {
    return null;
  }
  const firstLine = data.message.split("\n")[0]?.trim();
  return firstLine ? firstLine : null;
}

function getProgressValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function deriveActiveBookIds(messages: ReadonlyArray<SSEMessage>): ReadonlySet<string> {
  const active = new Set<string>();

  for (const message of messages) {
    const bookId = getBookId(message);
    if (!bookId) continue;

    if (START_EVENTS.has(message.event)) {
      active.add(bookId);
      continue;
    }

    if (TERMINAL_EVENTS.has(message.event)) {
      active.delete(bookId);
    }
  }

  return active;
}

export function deriveBookActivity(messages: ReadonlyArray<SSEMessage>, bookId: string): BookActivity {
  let writing = false;
  let drafting = false;
  let draftCancelling = false;
  let lastError: string | null = null;
  let latestStartIndex = -1;
  let lastStartedBookId: string | null = null;

  for (const [index, message] of messages.entries()) {
    const messageBookId = getBookId(message);
    if ((message.event === "write:start" || message.event === "draft:start") && messageBookId) {
      lastStartedBookId = messageBookId;
      if (messageBookId === bookId) {
        latestStartIndex = index;
      }
    }

    if (messageBookId !== bookId) continue;

    const data = message.data as { error?: unknown } | null;

    switch (message.event) {
      case "write:start":
        writing = true;
        lastError = null;
        break;
      case "write:complete":
        writing = false;
        lastError = null;
        break;
      case "write:error":
        writing = false;
        lastError = typeof data?.error === "string" ? data.error : "Unknown error";
        break;
      case "draft:start":
        drafting = true;
        draftCancelling = false;
        lastError = null;
        break;
      case "draft:cancel-requested":
        drafting = true;
        draftCancelling = true;
        lastError = null;
        break;
      case "draft:cancelled":
        drafting = false;
        draftCancelling = false;
        lastError = null;
        break;
      case "draft:complete":
        drafting = false;
        draftCancelling = false;
        lastError = null;
        break;
      case "draft:error":
        drafting = false;
        draftCancelling = false;
        lastError = typeof data?.error === "string" ? data.error : "Unknown error";
        break;
      default:
        break;
    }
  }

  let liveDetail: string | null = null;
  let elapsedMs: number | null = null;
  let totalChars: number | null = null;

  // llm:progress/log SSE payloads are global, so only surface them when this
  // book owns the most recent active pipeline in the current session.
  const ownsLatestPipeline = latestStartIndex >= 0 && lastStartedBookId === bookId && (writing || drafting);
  if (ownsLatestPipeline) {
    for (const message of messages.slice(latestStartIndex + 1)) {
      if (message.event === "log") {
        liveDetail = getLogMessage(message) ?? liveDetail;
        continue;
      }
      if (message.event === "llm:progress") {
        const data = message.data as { elapsedMs?: unknown; totalChars?: unknown } | null;
        elapsedMs = getProgressValue(data?.elapsedMs) ?? elapsedMs;
        totalChars = getProgressValue(data?.totalChars) ?? totalChars;
      }
    }
  }

  return { writing, drafting, draftCancelling, lastError, liveDetail, elapsedMs, totalChars };
}

export function shouldRefetchBookView(message: SSEMessage, bookId: string): boolean {
  return getBookId(message) === bookId && BOOK_REFRESH_EVENTS.has(message.event);
}

export function shouldRefetchBookCollections(message: SSEMessage | undefined): boolean {
  return Boolean(message && BOOK_COLLECTION_REFRESH_EVENTS.has(message.event));
}

export function shouldRefetchBookCreateStatus(message: SSEMessage | undefined): boolean {
  return Boolean(message && BOOK_CREATE_STATUS_REFRESH_EVENTS.has(message.event));
}

export function shouldRefetchDaemonStatus(message: SSEMessage | undefined): boolean {
  return Boolean(message && DAEMON_STATUS_REFRESH_EVENTS.has(message.event));
}
