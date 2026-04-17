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

export type CockpitStatusProgressMode = "determinate" | "indeterminate" | "none";

export interface CockpitStatusStrip {
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly reasoningLabel: string | null;
  readonly stage: CockpitStatusStage;
  readonly targetLabel: string;
  readonly latestEvent: string | null;
  readonly latestEventIsError: boolean;
  readonly isLive: boolean;
  readonly liveStage: CockpitStatusStage | null;
  readonly liveDetail: string | null;
  readonly progressMode: CockpitStatusProgressMode;
  readonly progressValue: number | null;
}

export function deriveCockpitStatusStrip(input: CockpitStatusStripInput): CockpitStatusStrip {
  const stage = deriveCockpitStage(input);
  const targetLabel = resolveTargetLabel(input);
  const latestEventInfo = summarizeLatestEvent(input.activityEntries);
  const latestEvent = latestEventInfo.summary;
  const { mode: progressMode, value: progressValue } = deriveProgressMode(stage);
  const isLive = stage !== "idle" && stage !== "ready";

  return {
    providerLabel: shortLabelForProvider(input.provider.trim()),
    modelLabel: compactModelLabel(input.provider, input.model),
    reasoningLabel: normalizeReasoningLabel(input.reasoningEffort),
    stage,
    targetLabel,
    latestEvent,
    latestEventIsError: latestEventInfo.isError,
    isLive,
    liveStage: isLive ? stage : null,
    liveDetail: deriveLiveDetail({
      isLive,
      createJobs: input.createJobs,
      latestEvent,
      targetLabel,
    }),
    progressMode,
    progressValue,
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

function summarizeLatestEvent(entries: ReadonlyArray<CockpitStatusActivityEntry>): {
  summary: string | null;
  isError: boolean;
} {
  const sortedEntries = [...entries].sort((a, b) => b.timestamp - a.timestamp);

  for (const entry of sortedEntries) {
    const summary = deriveEntrySummary(entry);
    if (summary) {
      return {
        summary,
        isError: /\berror\b/i.test(entry.event),
      };
    }
  }

  return {
    summary: null,
    isError: false,
  };
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

function deriveProgressMode(stage: CockpitStatusStage): {
  readonly mode: CockpitStatusProgressMode;
  readonly value: number | null;
} {
  switch (stage) {
    case "preparing-proposal":
      return { mode: "determinate", value: 20 };
    case "approving-proposal":
      return { mode: "determinate", value: 40 };
    case "previewing-foundation":
      return { mode: "determinate", value: 65 };
    case "creating":
      return { mode: "determinate", value: 85 };
    case "working":
    case "queued":
      return { mode: "indeterminate", value: null };
    default:
      return { mode: "none", value: null };
  }
}

function deriveLiveDetail(input: {
  readonly isLive: boolean;
  readonly createJobs: ReadonlyArray<CockpitCreateJob>;
  readonly latestEvent: string | null;
  readonly targetLabel: string;
}): string | null {
  if (!input.isLive) {
    return null;
  }

  const activeCreateJobWithDetail = input.createJobs.find((job) => {
    if (job.status !== "creating") {
      return false;
    }

    if (trimText(job.stage)) {
      return true;
    }

    if (trimText(job.message)) {
      return true;
    }

    return false;
  });

  if (activeCreateJobWithDetail) {
    const createJobStage = trimText(activeCreateJobWithDetail.stage);
    if (createJobStage) {
      return createJobStage;
    }

    const createJobMessage = trimText(activeCreateJobWithDetail.message);
    if (createJobMessage) {
      return createJobMessage;
    }
  }

  if (input.latestEvent) {
    return input.latestEvent;
  }

  return input.targetLabel;
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
