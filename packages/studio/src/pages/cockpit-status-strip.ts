import { compactModelLabel, shortLabelForProvider, type ReasoningEffort } from "../shared/llm";

export type CockpitStatusStage =
  | "idle"
  | "ready"
  | "queued"
  | "working"
  | "preparing-proposal"
  | "approving-proposal"
  | "previewing-foundation"
  | "creating";

export interface CockpitStatusActivityEntry {
  readonly event: string;
  readonly data: unknown;
  readonly timestamp: number;
}

export interface CockpitCreateJob {
  readonly bookId: string;
  readonly title: string;
  readonly status: "creating" | "error";
  readonly stage: string | null;
  readonly message: string | null;
}

export interface CockpitStatusStripInput {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort | "";
  readonly mode: "discuss" | "binder" | "draft";
  readonly selectedBookLabel: string;
  readonly selectedTruthLabel: string;
  readonly selectedChapterLabel: string;
  readonly showNewSetup: boolean;
  readonly busy: boolean;
  readonly preparingSetupProposal: boolean;
  readonly approvingSetup: boolean;
  readonly preparingFoundationPreview: boolean;
  readonly creatingBook: boolean;
  readonly createJobs: ReadonlyArray<CockpitCreateJob>;
  readonly setupDiscussionState: "discussing" | "ready";
  readonly setupSessionStatus: "proposed" | "approved" | "creating" | null;
  readonly activityEntries: ReadonlyArray<CockpitStatusActivityEntry>;
}

export interface CockpitStatusStrip {
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly reasoningLabel: string | null;
  readonly stage: CockpitStatusStage;
  readonly targetLabel: string;
  readonly latestEvent: string | null;
}

export function deriveCockpitStatusStrip(input: CockpitStatusStripInput): CockpitStatusStrip {
  return {
    providerLabel: shortLabelForProvider(input.provider.trim()),
    modelLabel: compactModelLabel(input.provider, input.model),
    reasoningLabel: normalizeReasoningLabel(input.reasoningEffort),
    stage: deriveCockpitStage(input),
    targetLabel: resolveTargetLabel(input),
    latestEvent: summarizeLatestEvent(input.activityEntries),
  };
}

function deriveCockpitStage(input: CockpitStatusStripInput): CockpitStatusStage {
  if (input.creatingBook) {
    return "creating";
  }

  if (input.preparingSetupProposal) {
    return "preparing-proposal";
  }

  if (input.approvingSetup) {
    return "approving-proposal";
  }

  if (input.preparingFoundationPreview) {
    return "previewing-foundation";
  }

  if (input.busy) {
    return "working";
  }

  if (input.createJobs.some((job) => job.status === "creating")) {
    return "queued";
  }

  if (input.setupSessionStatus === "creating" || input.setupDiscussionState === "ready") {
    return "ready";
  }

  return "idle";
}

function resolveTargetLabel(input: CockpitStatusStripInput): string {
  if (input.showNewSetup) {
    return input.selectedBookLabel.trim() || "—";
  }

  if (input.mode === "binder") {
    return input.selectedTruthLabel.trim() || "—";
  }

  if (input.mode === "draft") {
    return input.selectedBookLabel.trim() || "—";
  }

  return input.selectedBookLabel.trim() || "—";
}

function summarizeLatestEvent(entries: ReadonlyArray<CockpitStatusActivityEntry>): string | null {
  const sortedEntries = [...entries].sort((a, b) => b.timestamp - a.timestamp);

  for (const entry of sortedEntries) {
    const summary = deriveEntrySummary(entry);
    if (summary) {
      return summary;
    }
  }

  return null;
}

function deriveEntrySummary(entry: CockpitStatusActivityEntry): string | null {
  if (entry.event === "ping") {
    return null;
  }

  const message = extractActivityMessage(entry.data);
  if (!message) {
    return null;
  }

  return `${entry.event} · ${message}`;
}

function normalizeReasoningLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function extractActivityMessage(data: unknown): string | null {
  if (typeof data === "string") {
    return trimText(data);
  }

  if (data === null || typeof data !== "object") {
    return null;
  }

  const record = data as Readonly<Record<string, unknown>>;
  const candidates = [record.message, record.detail, record.text, record.summary, record.note, record.error];

  for (const candidate of candidates) {
    const value = trimText(candidate);
    if (value) {
      return value;
    }
  }

  return null;
}

function trimText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
