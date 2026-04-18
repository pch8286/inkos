export interface StudioEventLike {
  readonly event: string;
  readonly data: unknown;
  readonly timestamp: number;
}

export interface ActivityFeedEntry {
  readonly id: string;
  readonly event: string;
  readonly label: string;
  readonly detail: string;
  readonly tone: "neutral" | "success" | "error" | "progress";
  readonly timestamp: number;
}

function humanizeEvent(event: string): string {
  return event
    .replace(/[:\-]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function summarizeData(data: unknown): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (typeof data !== "object" || Array.isArray(data)) return String(data);

  const record = data as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.tag ? `[${String(record.tag)}] ${record.message}` : record.message;
  }
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error;
  }
  if (typeof record.savedPath === "string" && record.savedPath.trim()) {
    const parts = [record.savedPath];
    if (typeof record.status === "string" && record.status.trim()) {
      parts.push(String(record.status));
    }
    return parts.join(" · ");
  }
  if (typeof record.bookId === "string" && typeof record.chapterNumber === "number") {
    return `${record.bookId} · #${record.chapterNumber}`;
  }
  if (typeof record.bookId === "string") {
    return String(record.bookId);
  }
  if (typeof record.elapsedMs === "number" || typeof record.totalChars === "number") {
    const parts = [];
    if (typeof record.elapsedMs === "number") {
      parts.push(`${Math.max(0, Math.round(record.elapsedMs / 100) / 10)}s`);
    }
    if (typeof record.totalChars === "number") {
      parts.push(`${record.totalChars.toLocaleString()} chars`);
    }
    return parts.join(" · ");
  }
  if (typeof record.instruction === "string" && record.instruction.trim()) {
    return record.instruction;
  }
  if (typeof record.title === "string" && record.title.trim()) {
    return record.title;
  }
  if (typeof record.type === "string" && record.type.trim()) {
    return String(record.type);
  }

  const compact = Object.entries(record)
    .filter(([, value]) => value !== undefined && value !== null && typeof value !== "object")
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`);
  return compact.join(" · ");
}

export function toneForStudioEvent(event: string): ActivityFeedEntry["tone"] {
  if (event.endsWith(":error") || event === "book:error" || event === "daemon:error") return "error";
  if (event.endsWith(":complete") || event === "book:created" || event === "daemon:started") return "success";
  if (event.endsWith(":progress") || event.endsWith(":start") || event === "log") return "progress";
  return "neutral";
}

export function buildActivityFeedEntries(
  messages: ReadonlyArray<StudioEventLike>,
  options: { readonly includeProgress?: boolean } = {},
): ReadonlyArray<ActivityFeedEntry> {
  return messages
    .filter((message) => message.event !== "ping")
    .filter((message) => options.includeProgress || (message.event !== "llm:progress" && message.event !== "radar:progress"))
    .slice(-80)
    .sort((left, right) => right.timestamp - left.timestamp)
    .map((message, index) => ({
      id: `${message.timestamp}-${message.event}-${index}`,
      event: message.event,
      label: humanizeEvent(message.event),
      detail: summarizeData(message.data),
      tone: toneForStudioEvent(message.event),
      timestamp: message.timestamp,
    }));
}
