import type { StudioRun } from "../shared/contracts";
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
  readonly activeRun?: StudioRun | null;
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
  readonly elapsedMs?: number | null;
  readonly totalChars?: number | null;
}

export function deriveCockpitStatusStrip(input: CockpitStatusStripInput): CockpitStatusStrip {
  const stage = deriveCockpitStage(input);
  const targetLabel = resolveTargetLabel(input);
  const latestEventInfo = summarizeLatestEvent(input.activityEntries);
  const latestEvent = latestEventInfo.summary;
  const { mode: progressMode, value: progressValue } = deriveProgressMode(stage);
  const isLive = stage !== "idle" && stage !== "ready";
  const persistedRunDetail = getPersistedRunLiveDetail(input.activeRun);

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
      stage,
      isLive,
      createJobs: input.createJobs,
      latestEvent,
      persistedRunDetail,
      targetLabel,
    }),
    progressMode,
    progressValue,
    elapsedMs: getFiniteNumber(input.activeRun?.elapsedMs),
    totalChars: getFiniteNumber(input.activeRun?.totalChars),
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

  if (input.activeRun?.status === "running") {
    return "working";
  }

  if (input.activeRun?.status === "queued") {
    return "queued";
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
  readonly stage: CockpitStatusStage;
  readonly isLive: boolean;
  readonly createJobs: ReadonlyArray<CockpitCreateJob>;
  readonly latestEvent: string | null;
  readonly persistedRunDetail: string | null;
  readonly targetLabel: string;
}): string | null {
  if (!input.isLive) {
    return null;
  }

  if (input.stage === "queued" || input.stage === "creating") {
    for (const job of input.createJobs) {
      if (job.status !== "creating") {
        continue;
      }

      const createJobStage = trimText(job.stage);
      if (createJobStage) {
        return createJobStage;
      }
    }

    for (const job of input.createJobs) {
      if (job.status !== "creating") {
        continue;
      }

      const createJobMessage = trimText(job.message);
      if (createJobMessage) {
        return createJobMessage;
      }
    }
  }

  if (input.latestEvent) {
    return input.latestEvent;
  }

  if (input.persistedRunDetail) {
    return input.persistedRunDetail;
  }

  return input.targetLabel;
}

function getPersistedRunLiveDetail(activeRun: StudioRun | null | undefined): string | null {
  if (!activeRun) {
    return null;
  }

  const lastLogMessage = activeRun.logs.at(-1)?.message?.trim();
  if (lastLogMessage) {
    return lastLogMessage;
  }

  return trimText(activeRun.stage);
}

function getFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

  const chapterSummary = summarizeChapter(record.chapterNumber) || summarizeChapter(record.chapter);
  const bookId = trimText(record.bookId);
  const title = trimText(record.title);

  if (bookId) {
    return chapterSummary ? `${bookId} · ${chapterSummary}` : bookId;
  }

  if (title) {
    return chapterSummary ? `${title} · ${chapterSummary}` : title;
  }

  return chapterSummary;
}

function summarizeChapter(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0) {
    return `#${value}`;
  }

  const trimmed = trimText(value);
  if (!trimmed) {
    return null;
  }

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const numberValue = Number(trimmed);
  return Number.isFinite(numberValue) ? `#${numberValue}` : null;
}

function trimText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
