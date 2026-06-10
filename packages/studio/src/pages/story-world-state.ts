import type {
  AdaptiveTickPayload,
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

export interface WorldDirectorMessage {
  readonly id: string;
  readonly role: "user" | "world";
  readonly chapter: number;
  readonly text: string;
  readonly createdAt: string;
  readonly candidateIds?: ReadonlyArray<string>;
  readonly tags?: ReadonlyArray<string>;
}

const TICK_KIND_LABELS: Record<AdaptiveTickKindPayload, string> = {
  protagonist_action: "Action",
  protagonist_inaction: "Inaction",
  elapsed_time: "Elapsed time",
  direction_override: "Direction",
};

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

export function buildDefaultStorySpineFromDirection(direction: string): StorySpinePayload {
  return {
    protagonistId: "Protagonist",
    currentGoal: direction.trim() || "Follow the user's latest direction.",
    currentQuestion: "How does the world respond now?",
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

export function buildChatTickRequest(input: { readonly chapter: number; readonly text: string }): TickRequestPayload {
  return buildTickRequest({
    chapter: input.chapter,
    kind: "direction_override",
    actionText: input.text,
  });
}

export function buildWorldDirectorTranscript(ticks: ReadonlyArray<AdaptiveTickPayload>): WorldDirectorMessage[] {
  return ticks.flatMap((tick) => [
    {
      id: `${tick.id}-user`,
      role: "user" as const,
      chapter: tick.chapter,
      text: tickInputText(tick),
      createdAt: tick.createdAt,
      tags: [TICK_KIND_LABELS[tick.kind]],
    },
    {
      id: `${tick.id}-world`,
      role: "world" as const,
      chapter: tick.chapter,
      text: tick.candidates.length > 0
        ? tick.candidates.map((candidate) => candidate.text).join("\n")
        : "No movement candidates yet.",
      createdAt: tick.createdAt,
      candidateIds: tick.candidates.map((candidate) => candidate.id),
      tags: [`${tick.candidates.length} ${tick.candidates.length === 1 ? "candidate" : "candidates"}`],
    },
  ]);
}

function tickInputText(tick: AdaptiveTickPayload): string {
  return tick.protagonistAction
    ?? tick.protagonistInaction
    ?? tick.elapsedTime
    ?? tick.userDirection
    ?? "World movement advanced.";
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
