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
}

export type TickRequestPayload =
  | { readonly chapter: number; readonly kind: "protagonist_action"; readonly protagonistAction: string }
  | { readonly chapter: number; readonly kind: "protagonist_inaction"; readonly protagonistInaction: string }
  | { readonly chapter: number; readonly kind: "elapsed_time"; readonly elapsedTime: string }
  | { readonly chapter: number; readonly kind: "direction_override"; readonly userDirection: string };

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

export function buildTickRequest(input: BuildTickRequestInput): TickRequestPayload {
  const text = input.actionText.trim();
  if (input.kind === "protagonist_action") {
    return { chapter: input.chapter, kind: "protagonist_action", protagonistAction: text };
  }
  if (input.kind === "protagonist_inaction") {
    return { chapter: input.chapter, kind: "protagonist_inaction", protagonistInaction: text };
  }
  if (input.kind === "elapsed_time") {
    return { chapter: input.chapter, kind: "elapsed_time", elapsedTime: text };
  }
  return { chapter: input.chapter, kind: "direction_override", userDirection: text };
}

/**
 * Client-side compile preflight only. The server compile path can still reject
 * serialized conflicts or other authoritative validation after submission.
 */
export function canCompileSceneContract(
  candidates: ReadonlyArray<MovementCandidatePayload>,
  selectedCandidateIds: ReadonlyArray<string>,
): boolean {
  const approved = new Set(
    candidates.filter((candidate) => candidate.status === "approved").map((candidate) => candidate.id),
  );
  return selectedCandidateIds.every((id) => approved.has(id));
}

export function hasSelectedConflictRisk(
  candidates: ReadonlyArray<MovementCandidatePayload>,
  selectedCandidateIds: ReadonlyArray<string>,
): boolean {
  const selected = new Set(selectedCandidateIds);
  return candidates.some((candidate) => selected.has(candidate.id) && candidate.conflictLevel !== "none");
}

export function statusLabelForChapter(status: "draft" | "locked" | "published"): string {
  if (status === "published") return "Published";
  if (status === "locked") return "Locked";
  return "Draft";
}
