import type {
  AdaptiveTickKindPayload,
  MovementCandidatePayload,
  MovementCandidateStatusPayload,
  StorySpinePayload,
} from "../shared/contracts";

export interface GroupedMovementCandidates {
  readonly candidate: MovementCandidatePayload[];
  readonly approved: MovementCandidatePayload[];
  readonly hold: MovementCandidatePayload[];
  readonly rejected: MovementCandidatePayload[];
}

export interface BuildTickRequestInput {
  readonly chapter: number;
  readonly kind: AdaptiveTickKindPayload;
  readonly actionText: string;
  readonly storySpine: StorySpinePayload;
}

export function buildDefaultStorySpine(): StorySpinePayload {
  return {
    protagonistId: "",
    currentGoal: "",
    currentQuestion: "",
    emotionalState: [],
    activeChoices: [],
    constraints: [],
  };
}

export function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function linesValue(items: ReadonlyArray<string>): string {
  return items.join("\n");
}

export function groupMovementCandidates(
  candidates: ReadonlyArray<MovementCandidatePayload>,
): GroupedMovementCandidates {
  const grouped: Record<MovementCandidateStatusPayload, MovementCandidatePayload[]> = {
    candidate: [],
    approved: [],
    hold: [],
    rejected: [],
  };
  for (const candidate of candidates) {
    grouped[candidate.status].push(candidate);
  }
  return grouped;
}

export function buildTickRequest(input: BuildTickRequestInput): Record<string, unknown> {
  const text = input.actionText.trim();
  const base = {
    chapter: input.chapter,
    kind: input.kind,
  };
  if (input.kind === "protagonist_action") return { ...base, protagonistAction: text };
  if (input.kind === "protagonist_inaction") return { ...base, protagonistInaction: text };
  if (input.kind === "elapsed_time") return { ...base, elapsedTime: text };
  return { ...base, userDirection: text };
}

export function canCompileSceneContract(
  candidates: ReadonlyArray<MovementCandidatePayload>,
  selectedCandidateIds: ReadonlyArray<string>,
): boolean {
  const approved = new Set(
    candidates.filter((candidate) => candidate.status === "approved").map((candidate) => candidate.id),
  );
  return selectedCandidateIds.length > 0 && selectedCandidateIds.every((id) => approved.has(id));
}

export function statusLabelForChapter(status: "draft" | "locked" | "published"): string {
  if (status === "published") return "Published";
  if (status === "locked") return "Locked";
  return "Draft";
}
