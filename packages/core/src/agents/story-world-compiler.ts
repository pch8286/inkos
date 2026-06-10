import type { z } from "zod";
import {
  AdaptiveTickInputSchema,
  AdaptiveTickSchema,
  MovementCandidateSchema,
  type AdaptiveTick,
  type AdaptiveTickInput,
  type ChapterStatusRecord,
  type MovementCandidate,
  type MovementConflictLevel,
  type MovementRelevance,
  type MovementRisk,
  type MovementVisibility,
  type PressureLevel,
  type ProtagonistVisibility,
  type RepairStrategy,
  type SceneContract,
} from "../models/story-world-lab.js";

export interface SceneContractValidationResult {
  readonly ok: boolean;
  readonly blockers: string[];
  readonly warnings: string[];
}

const SAFE_SERIALIZED_REPAIR_STRATEGIES = new Set<RepairStrategy>([
  "forward_bend",
  "soft_reveal",
  "continuity_patch",
]);

export function createAdaptiveTick(rawInput: z.input<typeof AdaptiveTickInputSchema>): AdaptiveTick {
  const input = AdaptiveTickInputSchema.parse(rawInput);
  const candidates = [
    ...input.worldPressures.map((pressure, index) => MovementCandidateSchema.parse({
      id: `${input.id}-movement-${index + 1}`,
      sourceTickId: input.id,
      text: renderPressureMovementText(input, pressure.label, pressure.currentMotion),
      relevance: mapPressureLevel(pressure.pressureLevel),
      visibility: mapVisibility(pressure.visibleToProtagonist),
      risk: mapPressureLevel(pressure.pressureLevel),
      conflictLevel: pressure.pressureLevel === "high" ? "minor" : "none",
      status: "candidate",
      affectedChapters: [input.chapter],
      affectedStateKeys: [`world_pressures.${pressure.id}`],
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })),
    MovementCandidateSchema.parse({
      id: `${input.id}-movement-story-spine`,
      sourceTickId: input.id,
      text: renderStorySpineMovementText(input),
      relevance: "medium",
      visibility: "delayed",
      risk: "medium",
      conflictLevel: "none",
      status: "candidate",
      affectedChapters: [input.chapter],
      affectedStateKeys: [`story_spine.${input.storySpine.protagonistId}`],
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }),
  ];

  return AdaptiveTickSchema.parse({
    ...input,
    candidates,
  });
}

export function filterApprovedMovementCandidates(
  candidates: ReadonlyArray<MovementCandidate>,
): MovementCandidate[] {
  return candidates.filter((candidate) => candidate.status === "approved");
}

export function validateSceneContractAgainstChapterStatus(
  contract: SceneContract,
  chapterStatuses: ReadonlyArray<ChapterStatusRecord>,
  candidates: ReadonlyArray<MovementCandidate>,
): SceneContractValidationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const statusByChapter = new Map(chapterStatuses.map((status) => [status.chapter, status.status]));
  const selectedCandidateIds = new Set(contract.movementCandidateIds);
  const suppliedCandidateIds = new Set(candidates.map((candidate) => candidate.id));
  const selectedCandidates = candidates.filter((candidate) => selectedCandidateIds.has(candidate.id));

  for (const candidateId of selectedCandidateIds) {
    if (!suppliedCandidateIds.has(candidateId)) {
      blockers.push(`Movement candidate ${candidateId} was selected but not supplied.`);
    }
  }

  for (const candidate of selectedCandidates) {
    if (candidate.status !== "approved") {
      warnings.push(`Movement candidate ${candidate.id} is ${candidate.status}, not approved.`);
      continue;
    }

    if (candidate.conflictLevel !== "major") {
      continue;
    }

    if (candidate.repairStrategy && SAFE_SERIALIZED_REPAIR_STRATEGIES.has(candidate.repairStrategy)) {
      continue;
    }

    for (const affectedChapter of candidate.affectedChapters) {
      const status = statusByChapter.get(affectedChapter);
      if (status === "published" || status === "locked") {
        blockers.push(
          `Movement candidate ${candidate.id} creates a major conflict with ${status} chapter ${affectedChapter}.`,
        );
      }
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function renderStoryWorldIntentMarkdown(
  contract: SceneContract,
  candidates: ReadonlyArray<MovementCandidate>,
): string {
  const selectedCandidateIds = new Set(contract.movementCandidateIds);
  const suppliedCandidateIds = new Set(candidates.map((candidate) => candidate.id));
  const missingCandidateConflicts = [...selectedCandidateIds]
    .filter((candidateId) => !suppliedCandidateIds.has(candidateId))
    .map((candidateId) => `missing_candidate: Movement candidate ${candidateId} was selected but not supplied.`);
  const selectedApprovedMovements = filterApprovedMovementCandidates(candidates)
    .filter((candidate) => selectedCandidateIds.has(candidate.id))
    .map((candidate) => candidate.text);
  const goal = contract.sceneGoal[0] ?? `Advance chapter ${contract.chapter}.`;
  const mustKeep = [
    ...contract.mustInclude,
    ...selectedApprovedMovements,
    ...contract.endingState,
  ];
  const conflicts = filterApprovedMovementCandidates(candidates)
    .filter((candidate) => selectedCandidateIds.has(candidate.id) && candidate.conflictLevel !== "none")
    .map((candidate) => `${candidate.conflictLevel}: ${candidate.text}`);

  return [
    "## Goal",
    normalizeIntentValue(goal),
    "",
    "## Outline Node",
    normalizeIntentValue(contract.outlineNode ?? `${contract.pov} at ${contract.location}`),
    "",
    "## Must Keep",
    renderList(mustKeep.map(normalizeIntentValue)),
    "",
    "## Must Avoid",
    renderList(contract.mustAvoid.map(normalizeIntentValue)),
    "",
    "## Style Emphasis",
    renderList(contract.styleEmphasis.map(normalizeIntentValue)),
    "",
    "## Conflicts",
    renderList([...conflicts, ...missingCandidateConflicts].map(normalizeIntentValue)),
    "",
  ].join("\n");
}

export function repairStrategiesForConflict(
  conflictLevel: MovementConflictLevel,
  serialized: boolean,
): RepairStrategy[] {
  if (conflictLevel === "none") {
    return ["forward_bend"];
  }

  if (conflictLevel === "minor") {
    return serialized
      ? ["forward_bend", "soft_reveal", "continuity_patch"]
      : ["local_rewrite", "forward_bend", "continuity_patch"];
  }

  return serialized
    ? ["forward_bend", "soft_reveal", "continuity_patch", "edition_retcon"]
    : ["local_rewrite", "cascade_retcon", "edition_retcon"];
}

function renderPressureMovementText(
  input: AdaptiveTickInput,
  label: string,
  currentMotion: string,
): string {
  const cause = tickCause(input);
  return `${label} keeps ${currentMotion} because ${cause}`;
}

function renderStorySpineMovementText(input: AdaptiveTickInput): string {
  const cause = tickCause(input);
  return `${input.storySpine.protagonistId} faces "${input.storySpine.currentQuestion}" as ${cause}`;
}

function tickCause(input: AdaptiveTickInput): string {
  switch (input.kind) {
    case "protagonist_action":
      return input.protagonistAction ?? input.storySpine.currentGoal;
    case "protagonist_inaction":
      return input.protagonistInaction ?? input.storySpine.currentGoal;
    case "elapsed_time":
      return input.elapsedTime ?? "time passes";
    case "direction_override":
      return input.userDirection ?? input.storySpine.currentGoal;
  }
}

function mapVisibility(visibility: ProtagonistVisibility): MovementVisibility {
  switch (visibility) {
    case "yes":
      return "observed_now";
    case "partial":
      return "rumor";
    case "no":
      return "hidden";
  }
}

function mapPressureLevel(level: PressureLevel): MovementRisk & MovementRelevance {
  switch (level) {
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
  }
}

function renderList(values: ReadonlyArray<string>): string {
  if (values.length === 0) return "- none";
  return values.map((value) => `- ${value}`).join("\n");
}

function normalizeIntentValue(value: string): string {
  const normalized = value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.startsWith("## ")) {
    return `# ${normalized}`;
  }

  return normalized;
}
