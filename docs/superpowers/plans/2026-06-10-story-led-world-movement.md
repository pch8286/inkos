# Story-Led World Movement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Story World Lab slice: protagonist-led adaptive ticks, world pressure candidates, human approval, draft/serialized guardrails, and scene-contract compile into the existing InkOS chapter intent flow.

**Architecture:** Add a focused story-world-lab domain in `@actalk/inkos-core`, expose it through Studio API persistence under `books/<bookId>/story/lab/`, and render a Studio page at `?page=story-world&bookId=<bookId>`. The feature writes lab artifacts and `story/runtime/chapter-XXXX.intent.md`; it does not mutate truth files or published chapter text.

**Tech Stack:** TypeScript, Zod, Node `fs/promises`, Hono, React, Vitest, React Testing Library, lucide-react.

---

## Scope Decisions

This plan resolves the current ambiguity this way:

- The center of the feature is `Story Spine`, not character chat.
- `Adaptive Tick` means protagonist action, protagonist inaction, elapsed time, or user direction causing story-relevant world movement.
- The first implementation uses deterministic candidate generation so storage, approval, conflict policy, compile, and UI can be tested without adding a new LLM call.
- LLM-driven tick generation, image generation, character chat, and generic always-on simulation logs are out of scope for this slice.
- `Draft Mode` is the default. Published chapters are immutable by default.
- Direction override changes unapproved candidates and future scene contracts. Existing published canon requires repair options or edition retcon planning.

## File Structure

- Create `packages/core/src/models/story-world-lab.ts`
  - Zod schemas and inferred types for story mode, chapter status, story spine, world pressure, adaptive tick, movement candidate, impact report, and scene contract.
- Create `packages/core/src/agents/story-world-compiler.ts`
  - Deterministic tick candidate generation, story relevance filtering, approved-only filtering, serialized conflict checks, and intent markdown rendering.
- Create `packages/core/src/__tests__/story-world-lab.test.ts`
  - Core model, tick, conflict, and compiler tests.
- Modify `packages/core/src/index.ts`
  - Export story-world-lab schemas, types, and helpers.
- Modify `packages/studio/src/shared/contracts.ts`
  - Add Studio API payload interfaces that mirror the core public contract.
- Modify `packages/studio/src/api/server.ts`
  - Add lab persistence helpers and `/api/books/:id/lab/*` endpoints.
- Modify `packages/studio/src/api/server.test.ts`
  - Add API coverage for persistence, tick creation, candidate decisions, published chapter guardrails, and compile output.
- Create `packages/studio/src/pages/story-world-state.ts`
  - Pure UI helpers for candidate grouping, form defaults, disabled states, and status labels.
- Create `packages/studio/src/pages/story-world-state.test.ts`
  - UI state helper tests.
- Create `packages/studio/src/pages/StoryWorldLab.tsx`
  - Studio work surface for Story Spine, World Pressure, Adaptive Tick, candidates, impact report, and compile.
- Modify `packages/studio/src/App.tsx`
  - Add `story-world` route, navigation, active book derivation, and page rendering.
- Modify `packages/studio/src/components/Sidebar.tsx`
  - Add a book-scoped Story World entry.
- Modify `packages/studio/src/App.test.ts`
  - Add route parsing and route building tests.

---

## Task 1: Core Schemas And Compiler

**Files:**
- Create: `packages/core/src/models/story-world-lab.ts`
- Create: `packages/core/src/agents/story-world-compiler.ts`
- Create: `packages/core/src/__tests__/story-world-lab.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing core tests**

Create `packages/core/src/__tests__/story-world-lab.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AdaptiveTickInputSchema,
  MovementCandidateSchema,
  SceneContractSchema,
  createAdaptiveTick,
  filterApprovedMovementCandidates,
  renderStoryWorldIntentMarkdown,
  validateSceneContractAgainstChapterStatus,
} from "../index.js";

const now = "2026-06-10T12:00:00.000Z";

describe("story world lab", () => {
  it("parses a protagonist-led tick input", () => {
    const parsed = AdaptiveTickInputSchema.parse({
      id: "tick-1",
      bookId: "demo",
      chapter: 4,
      kind: "protagonist_action",
      protagonistAction: "Sera exposes the false alibi in front of the guild.",
      storySpine: {
        protagonistId: "sera",
        currentGoal: "prove the alibi was manufactured",
        currentQuestion: "Can Sera act before the guild closes ranks?",
        emotionalState: ["angry but controlled"],
        activeChoices: ["public accusation", "private bargain"],
        constraints: ["the guild master can bury testimony"],
      },
      worldPressures: [{
        id: "pressure-guild",
        type: "faction",
        label: "Guild council",
        currentMotion: "closing ranks around the alibi",
        pressureLevel: "high",
        visibleToProtagonist: "partial",
      }],
      createdAt: now,
    });

    expect(parsed.kind).toBe("protagonist_action");
    expect(parsed.storySpine.currentGoal).toContain("alibi");
  });

  it("treats protagonist inaction as a valid tick source", () => {
    const tick = createAdaptiveTick({
      id: "tick-inaction",
      bookId: "demo",
      chapter: 5,
      kind: "protagonist_inaction",
      protagonistInaction: "Sera waits until dawn instead of confronting the courier.",
      storySpine: {
        protagonistId: "sera",
        currentGoal: "find the courier before the trail goes cold",
        currentQuestion: "What is lost if Sera waits?",
        emotionalState: ["exhausted", "uncertain"],
        activeChoices: ["wait", "force the gate"],
        constraints: ["the city curfew is active"],
      },
      worldPressures: [{
        id: "pressure-courier",
        type: "character",
        label: "Courier",
        currentMotion: "leaving the lower city",
        pressureLevel: "medium",
        visibleToProtagonist: "no",
      }],
      createdAt: now,
    });

    expect(tick.candidates).toHaveLength(2);
    expect(tick.candidates[0]?.visibility).toBe("hidden");
    expect(tick.candidates.map((candidate) => candidate.text).join("\n")).toContain("waits");
  });

  it("filters approved movement candidates before compile", () => {
    const approved = MovementCandidateSchema.parse({
      id: "move-1",
      sourceTickId: "tick-1",
      text: "The guild responds by calling an emergency vote.",
      relevance: "high",
      visibility: "observed_now",
      risk: "medium",
      conflictLevel: "none",
      status: "approved",
      affectedChapters: [4],
      affectedStateKeys: ["pending_hooks.guild_vote"],
      createdAt: now,
      updatedAt: now,
    });
    const held = MovementCandidateSchema.parse({
      ...approved,
      id: "move-2",
      text: "A second witness vanishes.",
      status: "hold",
    });

    expect(filterApprovedMovementCandidates([approved, held])).toEqual([approved]);
  });

  it("blocks major conflicts against published chapters", () => {
    const contract = SceneContractSchema.parse({
      id: "scene-1",
      chapter: 8,
      sourceTickIds: ["tick-1"],
      pov: "Sera",
      location: "guild hall",
      sceneGoal: ["Sera pressures the guild after the failed alibi."],
      mustInclude: ["The public vote must remain visible."],
      mustAvoid: ["Do not rewrite chapter 3."],
      movementCandidateIds: ["move-major"],
      endingState: ["Sera leaves with a partial concession."],
      conflictPolicy: "serialized_forward_only",
      createdAt: now,
      updatedAt: now,
    });

    const result = validateSceneContractAgainstChapterStatus(contract, [{
      chapter: 3,
      status: "published",
      updatedAt: now,
    }], [{
      id: "move-major",
      sourceTickId: "tick-1",
      text: "Chapter 3's public confession becomes false.",
      relevance: "high",
      visibility: "observed_now",
      risk: "high",
      conflictLevel: "major",
      status: "approved",
      affectedChapters: [3],
      affectedStateKeys: ["chapter_summaries.3"],
      createdAt: now,
      updatedAt: now,
    }]);

    expect(result.ok).toBe(false);
    expect(result.blockers[0]).toContain("published chapter 3");
  });

  it("renders approved movement into persisted chapter intent markdown", () => {
    const contract = SceneContractSchema.parse({
      id: "scene-1",
      chapter: 6,
      sourceTickIds: ["tick-1"],
      pov: "Sera",
      location: "guild hall",
      sceneGoal: ["Force the council to react to Sera's accusation."],
      mustInclude: ["Sera stays active, not reactive."],
      mustAvoid: ["Do not solve the entire guild conspiracy."],
      movementCandidateIds: ["move-1"],
      endingState: ["The council delays judgment but exposes a split."],
      conflictPolicy: "draft_rewrite_allowed",
      createdAt: now,
      updatedAt: now,
    });
    const markdown = renderStoryWorldIntentMarkdown(contract, [{
      id: "move-1",
      sourceTickId: "tick-1",
      text: "The guild responds by calling an emergency vote.",
      relevance: "high",
      visibility: "observed_now",
      risk: "medium",
      conflictLevel: "none",
      status: "approved",
      affectedChapters: [6],
      affectedStateKeys: ["pending_hooks.guild_vote"],
      createdAt: now,
      updatedAt: now,
    }]);

    expect(markdown).toContain("## Goal");
    expect(markdown).toContain("Force the council");
    expect(markdown).toContain("## Must Keep");
    expect(markdown).toContain("The guild responds by calling an emergency vote.");
    expect(markdown).toContain("## Must Avoid");
    expect(markdown).toContain("Do not solve the entire guild conspiracy.");
  });
});
```

- [ ] **Step 2: Run core tests to verify failure**

Run:

```bash
pnpm --filter @actalk/inkos-core test -- story-world-lab.test.ts
```

Expected: FAIL because `story-world-lab` exports do not exist.

- [ ] **Step 3: Add core schemas**

Create `packages/core/src/models/story-world-lab.ts`:

```ts
import { z } from "zod";

export const ProjectStoryModeSchema = z.enum(["draft", "serialized"]);
export const ChapterPublicationStatusSchema = z.enum(["draft", "locked", "published"]);
export const WorldPressureTypeSchema = z.enum(["faction", "character", "location", "hook", "environment"]);
export const PressureLevelSchema = z.enum(["low", "medium", "high"]);
export const ProtagonistVisibilitySchema = z.enum(["yes", "no", "partial"]);
export const AdaptiveTickKindSchema = z.enum([
  "protagonist_action",
  "protagonist_inaction",
  "elapsed_time",
  "direction_override",
]);
export const MovementRelevanceSchema = z.enum(["low", "medium", "high"]);
export const MovementVisibilitySchema = z.enum(["observed_now", "rumor", "hidden", "delayed"]);
export const MovementRiskSchema = z.enum(["low", "medium", "high"]);
export const MovementConflictLevelSchema = z.enum(["none", "minor", "major"]);
export const MovementCandidateStatusSchema = z.enum(["candidate", "approved", "rejected", "hold"]);
export const ConflictPolicySchema = z.enum([
  "draft_rewrite_allowed",
  "serialized_forward_only",
  "edition_retcon_required",
]);
export const RepairStrategySchema = z.enum([
  "forward_bend",
  "soft_reveal",
  "continuity_patch",
  "local_rewrite",
  "cascade_retcon",
  "edition_retcon",
]);

export const StorySpineSchema = z.object({
  protagonistId: z.string().trim().min(1),
  currentGoal: z.string().trim().min(1),
  currentQuestion: z.string().trim().min(1),
  emotionalState: z.array(z.string().trim().min(1)).default([]),
  activeChoices: z.array(z.string().trim().min(1)).default([]),
  constraints: z.array(z.string().trim().min(1)).default([]),
});

export const WorldPressureSchema = z.object({
  id: z.string().trim().min(1),
  type: WorldPressureTypeSchema,
  label: z.string().trim().min(1),
  currentMotion: z.string().trim().min(1),
  pressureLevel: PressureLevelSchema,
  visibleToProtagonist: ProtagonistVisibilitySchema,
});

export const AdaptiveTickInputSchema = z.object({
  id: z.string().trim().min(1),
  bookId: z.string().trim().min(1),
  chapter: z.number().int().positive(),
  kind: AdaptiveTickKindSchema,
  protagonistAction: z.string().trim().min(1).optional(),
  protagonistInaction: z.string().trim().min(1).optional(),
  elapsedTime: z.string().trim().min(1).optional(),
  userDirection: z.string().trim().min(1).optional(),
  storySpine: StorySpineSchema,
  worldPressures: z.array(WorldPressureSchema).default([]),
  createdAt: z.string().trim().min(1),
});

export const MovementCandidateSchema = z.object({
  id: z.string().trim().min(1),
  sourceTickId: z.string().trim().min(1),
  text: z.string().trim().min(1),
  relevance: MovementRelevanceSchema,
  visibility: MovementVisibilitySchema,
  risk: MovementRiskSchema,
  conflictLevel: MovementConflictLevelSchema,
  status: MovementCandidateStatusSchema.default("candidate"),
  affectedChapters: z.array(z.number().int().positive()).default([]),
  affectedStateKeys: z.array(z.string().trim().min(1)).default([]),
  reason: z.string().trim().min(1).optional(),
  repairStrategy: RepairStrategySchema.optional(),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
});

export const AdaptiveTickSchema = z.object({
  id: z.string().trim().min(1),
  input: AdaptiveTickInputSchema,
  candidates: z.array(MovementCandidateSchema),
  createdAt: z.string().trim().min(1),
});

export const ChapterStatusRecordSchema = z.object({
  chapter: z.number().int().positive(),
  status: ChapterPublicationStatusSchema,
  updatedAt: z.string().trim().min(1),
});

export const ImpactReportSchema = z.object({
  id: z.string().trim().min(1),
  candidateId: z.string().trim().min(1),
  conflictLevel: MovementConflictLevelSchema,
  affectedChapters: z.array(z.number().int().positive()),
  affectedStateKeys: z.array(z.string().trim().min(1)),
  repairStrategies: z.array(RepairStrategySchema),
  message: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
});

export const SceneContractSchema = z.object({
  id: z.string().trim().min(1),
  chapter: z.number().int().positive(),
  sourceTickIds: z.array(z.string().trim().min(1)),
  pov: z.string().trim().min(1),
  location: z.string().trim().min(1),
  sceneGoal: z.array(z.string().trim().min(1)),
  mustInclude: z.array(z.string().trim().min(1)).default([]),
  mustAvoid: z.array(z.string().trim().min(1)).default([]),
  movementCandidateIds: z.array(z.string().trim().min(1)),
  endingState: z.array(z.string().trim().min(1)).default([]),
  conflictPolicy: ConflictPolicySchema,
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
});

export type ProjectStoryMode = z.infer<typeof ProjectStoryModeSchema>;
export type ChapterPublicationStatus = z.infer<typeof ChapterPublicationStatusSchema>;
export type WorldPressureType = z.infer<typeof WorldPressureTypeSchema>;
export type PressureLevel = z.infer<typeof PressureLevelSchema>;
export type ProtagonistVisibility = z.infer<typeof ProtagonistVisibilitySchema>;
export type AdaptiveTickKind = z.infer<typeof AdaptiveTickKindSchema>;
export type MovementRelevance = z.infer<typeof MovementRelevanceSchema>;
export type MovementVisibility = z.infer<typeof MovementVisibilitySchema>;
export type MovementRisk = z.infer<typeof MovementRiskSchema>;
export type MovementConflictLevel = z.infer<typeof MovementConflictLevelSchema>;
export type MovementCandidateStatus = z.infer<typeof MovementCandidateStatusSchema>;
export type ConflictPolicy = z.infer<typeof ConflictPolicySchema>;
export type RepairStrategy = z.infer<typeof RepairStrategySchema>;
export type StorySpine = z.infer<typeof StorySpineSchema>;
export type WorldPressure = z.infer<typeof WorldPressureSchema>;
export type AdaptiveTickInput = z.infer<typeof AdaptiveTickInputSchema>;
export type MovementCandidate = z.infer<typeof MovementCandidateSchema>;
export type AdaptiveTick = z.infer<typeof AdaptiveTickSchema>;
export type ChapterStatusRecord = z.infer<typeof ChapterStatusRecordSchema>;
export type ImpactReport = z.infer<typeof ImpactReportSchema>;
export type SceneContract = z.infer<typeof SceneContractSchema>;
```

- [ ] **Step 4: Add core compiler helpers**

Create `packages/core/src/agents/story-world-compiler.ts`:

```ts
import type {
  AdaptiveTick,
  AdaptiveTickInput,
  ChapterStatusRecord,
  MovementCandidate,
  MovementConflictLevel,
  MovementRelevance,
  MovementRisk,
  MovementVisibility,
  RepairStrategy,
  SceneContract,
  WorldPressure,
} from "../models/story-world-lab.js";
import {
  AdaptiveTickInputSchema,
  AdaptiveTickSchema,
  MovementCandidateSchema,
} from "../models/story-world-lab.js";

export interface SceneContractValidationResult {
  readonly ok: boolean;
  readonly blockers: ReadonlyArray<string>;
}

function riskFromPressure(pressure: WorldPressure): MovementRisk {
  if (pressure.pressureLevel === "high") return "high";
  if (pressure.pressureLevel === "medium") return "medium";
  return "low";
}

function relevanceFromPressure(pressure: WorldPressure): MovementRelevance {
  if (pressure.pressureLevel === "high") return "high";
  if (pressure.pressureLevel === "medium") return "medium";
  return "low";
}

function visibilityFromPressure(pressure: WorldPressure): MovementVisibility {
  if (pressure.visibleToProtagonist === "yes") return "observed_now";
  if (pressure.visibleToProtagonist === "partial") return "rumor";
  return "hidden";
}

function conflictFromPressure(pressure: WorldPressure): MovementConflictLevel {
  return pressure.pressureLevel === "high" ? "minor" : "none";
}

function tickCause(input: AdaptiveTickInput): string {
  if (input.protagonistAction) return input.protagonistAction;
  if (input.protagonistInaction) return input.protagonistInaction;
  if (input.elapsedTime) return `time passes: ${input.elapsedTime}`;
  if (input.userDirection) return `direction changes: ${input.userDirection}`;
  return input.storySpine.currentGoal;
}

function movementText(input: AdaptiveTickInput, pressure: WorldPressure): string {
  const cause = tickCause(input);
  const direction = input.userDirection ? ` User direction: ${input.userDirection}` : "";
  if (input.kind === "protagonist_inaction") {
    return `${input.storySpine.protagonistId} waits or delays: ${cause}. ${pressure.label} continues ${pressure.currentMotion}, creating pressure on "${input.storySpine.currentQuestion}".${direction}`;
  }
  return `${input.storySpine.protagonistId} acts: ${cause}. ${pressure.label} reacts by ${pressure.currentMotion}, creating pressure on "${input.storySpine.currentQuestion}".${direction}`;
}

function fallbackMovementText(input: AdaptiveTickInput): string {
  const cause = tickCause(input);
  if (input.kind === "protagonist_inaction") {
    return `${input.storySpine.protagonistId} does not force the issue: ${cause}. The story pressure should surface as a delayed consequence tied to "${input.storySpine.currentGoal}".`;
  }
  return `${input.storySpine.protagonistId} pushes the story forward: ${cause}. The next scene should test "${input.storySpine.currentQuestion}".`;
}

export function createAdaptiveTick(rawInput: AdaptiveTickInput): AdaptiveTick {
  const input = AdaptiveTickInputSchema.parse(rawInput);
  const timestamp = input.createdAt;
  const candidates = input.worldPressures.map((pressure, index) => MovementCandidateSchema.parse({
    id: `${input.id}-move-${String(index + 1).padStart(2, "0")}`,
    sourceTickId: input.id,
    text: movementText(input, pressure),
    relevance: relevanceFromPressure(pressure),
    visibility: visibilityFromPressure(pressure),
    risk: riskFromPressure(pressure),
    conflictLevel: conflictFromPressure(pressure),
    status: "candidate",
    affectedChapters: [input.chapter],
    affectedStateKeys: [`world_pressures.${pressure.id}`],
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  candidates.push(MovementCandidateSchema.parse({
    id: `${input.id}-move-${String(candidates.length + 1).padStart(2, "0")}`,
    sourceTickId: input.id,
    text: fallbackMovementText(input),
    relevance: "high",
    visibility: input.kind === "protagonist_inaction" ? "delayed" : "observed_now",
    risk: "medium",
    conflictLevel: "none",
    status: "candidate",
    affectedChapters: [input.chapter],
    affectedStateKeys: ["story_spine.currentQuestion"],
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  return AdaptiveTickSchema.parse({
    id: input.id,
    input,
    candidates,
    createdAt: timestamp,
  });
}

export function filterApprovedMovementCandidates(
  candidates: ReadonlyArray<MovementCandidate>,
): MovementCandidate[] {
  return candidates.filter((candidate) => candidate.status === "approved");
}

function serializedSafeRepair(candidate: MovementCandidate): boolean {
  return candidate.repairStrategy === "forward_bend"
    || candidate.repairStrategy === "soft_reveal"
    || candidate.repairStrategy === "continuity_patch";
}

export function validateSceneContractAgainstChapterStatus(
  contract: SceneContract,
  chapterStatuses: ReadonlyArray<ChapterStatusRecord>,
  candidates: ReadonlyArray<MovementCandidate>,
): SceneContractValidationResult {
  const statusByChapter = new Map(chapterStatuses.map((entry) => [entry.chapter, entry.status]));
  const relevant = candidates.filter((candidate) => contract.movementCandidateIds.includes(candidate.id));
  const blockers: string[] = [];

  for (const candidate of relevant) {
    if (candidate.conflictLevel !== "major") continue;
    for (const chapter of candidate.affectedChapters) {
      const status = statusByChapter.get(chapter);
      if (status !== "published" && status !== "locked") continue;
      if (contract.conflictPolicy === "serialized_forward_only" && serializedSafeRepair(candidate)) continue;
      blockers.push(`Movement candidate ${candidate.id} has a major conflict with ${status} chapter ${chapter}.`);
    }
  }

  return { ok: blockers.length === 0, blockers };
}

function listSection(items: ReadonlyArray<string>): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

export function renderStoryWorldIntentMarkdown(
  contract: SceneContract,
  candidates: ReadonlyArray<MovementCandidate>,
): string {
  const approved = filterApprovedMovementCandidates(candidates)
    .filter((candidate) => contract.movementCandidateIds.includes(candidate.id));
  const movementLines = approved.map((candidate) => {
    const visibility = candidate.visibility.replaceAll("_", " ");
    return `${candidate.text} [${candidate.relevance} relevance, ${visibility}]`;
  });
  const mustKeep = [
    ...contract.mustInclude,
    ...movementLines,
    ...contract.endingState.map((state) => `Ending state: ${state}`),
  ];
  const conflicts = approved
    .filter((candidate) => candidate.conflictLevel !== "none")
    .map((candidate) => `${candidate.conflictLevel}: ${candidate.repairStrategy ?? "resolve forward without rewriting published canon"}`);

  return [
    "# Chapter Intent",
    "",
    "## Goal",
    contract.sceneGoal.join(" "),
    "",
    "## Outline Node",
    `POV: ${contract.pov}; Location: ${contract.location}; Policy: ${contract.conflictPolicy}.`,
    "",
    "## Must Keep",
    listSection(mustKeep),
    "",
    "## Must Avoid",
    listSection(contract.mustAvoid),
    "",
    "## Style Emphasis",
    "- protagonist agency remains visible",
    "- world movement appears through story-relevant pressure",
    "",
    "## Conflicts",
    listSection(conflicts),
    "",
  ].join("\n");
}

export function repairStrategiesForConflict(
  conflictLevel: MovementConflictLevel,
  serialized: boolean,
): RepairStrategy[] {
  if (conflictLevel === "none") return ["forward_bend"];
  if (!serialized) return ["forward_bend", "soft_reveal", "local_rewrite", "cascade_retcon"];
  if (conflictLevel === "minor") return ["forward_bend", "soft_reveal", "continuity_patch"];
  return ["forward_bend", "soft_reveal", "continuity_patch", "edition_retcon"];
}
```

- [ ] **Step 5: Export the core domain**

Modify `packages/core/src/index.ts` by adding these exports after the existing model exports:

```ts
export {
  type ProjectStoryMode,
  type ChapterPublicationStatus,
  type WorldPressureType,
  type PressureLevel,
  type ProtagonistVisibility,
  type AdaptiveTickKind,
  type MovementRelevance,
  type MovementVisibility,
  type MovementRisk,
  type MovementConflictLevel,
  type MovementCandidateStatus,
  type ConflictPolicy,
  type RepairStrategy,
  type StorySpine,
  type WorldPressure,
  type AdaptiveTickInput,
  type MovementCandidate,
  type AdaptiveTick,
  type ChapterStatusRecord,
  type ImpactReport,
  type SceneContract,
  ProjectStoryModeSchema,
  ChapterPublicationStatusSchema,
  WorldPressureTypeSchema,
  PressureLevelSchema,
  ProtagonistVisibilitySchema,
  AdaptiveTickKindSchema,
  MovementRelevanceSchema,
  MovementVisibilitySchema,
  MovementRiskSchema,
  MovementConflictLevelSchema,
  MovementCandidateStatusSchema,
  ConflictPolicySchema,
  RepairStrategySchema,
  StorySpineSchema,
  WorldPressureSchema,
  AdaptiveTickInputSchema,
  MovementCandidateSchema,
  AdaptiveTickSchema,
  ChapterStatusRecordSchema,
  ImpactReportSchema,
  SceneContractSchema,
} from "./models/story-world-lab.js";
export {
  createAdaptiveTick,
  filterApprovedMovementCandidates,
  renderStoryWorldIntentMarkdown,
  repairStrategiesForConflict,
  validateSceneContractAgainstChapterStatus,
  type SceneContractValidationResult,
} from "./agents/story-world-compiler.js";
```

- [ ] **Step 6: Verify core tests**

Run:

```bash
pnpm --filter @actalk/inkos-core test -- story-world-lab.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit core work**

Run:

```bash
git add packages/core/src/models/story-world-lab.ts packages/core/src/agents/story-world-compiler.ts packages/core/src/__tests__/story-world-lab.test.ts packages/core/src/index.ts
git commit -m "feat(core): add story world movement contracts"
```

---

## Task 2: Studio Contracts And API Persistence

**Files:**
- Modify: `packages/studio/src/shared/contracts.ts`
- Modify: `packages/studio/src/api/server.ts`
- Modify: `packages/studio/src/api/server.test.ts`

- [ ] **Step 1: Write failing Studio API tests**

In `packages/studio/src/api/server.test.ts`, extend the existing `vi.mock("@actalk/inkos-core", ...)` body before `return { ... }`:

```ts
  const passthroughSchema = {
    parse(value: unknown): unknown {
      return value;
    },
  };
```

Then extend the mocked return object with these schema and helper exports. Do not add separate top-level imports for these helpers in this test file; `server.ts` receives them from the mocked package when it is dynamically imported.

```ts
AdaptiveTickInputSchema: passthroughSchema,
ChapterPublicationStatusSchema: passthroughSchema,
ChapterStatusRecordSchema: passthroughSchema,
MovementCandidateSchema: passthroughSchema,
ProjectStoryModeSchema: passthroughSchema,
SceneContractSchema: passthroughSchema,
StorySpineSchema: passthroughSchema,
WorldPressureSchema: passthroughSchema,
createAdaptiveTick: vi.fn((input: any) => ({
  id: input.id,
  input,
  createdAt: input.createdAt,
  candidates: [{
    id: `${input.id}-move-01`,
    sourceTickId: input.id,
    text: `${input.storySpine.protagonistId} acts: ${input.protagonistAction ?? input.protagonistInaction ?? input.userDirection ?? input.elapsedTime}.`,
    relevance: "high",
    visibility: "observed_now",
    risk: "medium",
    conflictLevel: "none",
    status: "candidate",
    affectedChapters: [input.chapter],
    affectedStateKeys: ["story_spine.currentQuestion"],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }],
})),
renderStoryWorldIntentMarkdown: vi.fn((contract: any, candidates: any[]) => [
  "# Chapter Intent",
  "",
  "## Goal",
  contract.sceneGoal.join(" "),
  "",
  "## Outline Node",
  `POV: ${contract.pov}; Location: ${contract.location}; Policy: ${contract.conflictPolicy}.`,
  "",
  "## Must Keep",
  candidates.filter((candidate) => candidate.status === "approved").map((candidate) => `- ${candidate.text}`).join("\n") || "- none",
  "",
  "## Must Avoid",
  contract.mustAvoid.map((item: string) => `- ${item}`).join("\n") || "- none",
  "",
  "## Style Emphasis",
  "- protagonist agency remains visible",
  "",
  "## Conflicts",
  "- none",
  "",
].join("\n")),
validateSceneContractAgainstChapterStatus: vi.fn((contract: any, statuses: any[], candidates: any[]) => {
  const published = new Set(statuses.filter((entry) => entry.status === "published").map((entry) => entry.chapter));
  const blocked = candidates
    .filter((candidate) => contract.movementCandidateIds.includes(candidate.id))
    .some((candidate) => candidate.conflictLevel === "major" && candidate.affectedChapters.some((chapter: number) => published.has(chapter)));
  return blocked ? { ok: false, blockers: ["major conflict with published chapter"] } : { ok: true, blockers: [] };
}),
repairStrategiesForConflict: vi.fn((conflictLevel: string, serialized: boolean) => (
  conflictLevel === "none"
    ? ["forward_bend"]
    : serialized
      ? ["forward_bend", "soft_reveal", "continuity_patch", "edition_retcon"]
      : ["forward_bend", "soft_reveal", "local_rewrite", "cascade_retcon"]
)),
```

Then add a server test block near other book-scoped API tests:

```ts
describe("story world lab API", () => {
  it("persists story spine, pressures, ticks, decisions, and compiled intent without mutating truth files", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-story-world-api-"));
    const bookId = "story-world-demo";
    const storyDir = join(root, "books", bookId, "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(root, "inkos.json"), JSON.stringify(projectConfig), "utf-8");
    await writeFile(join(root, "books", bookId, "book.json"), JSON.stringify({
      id: bookId,
      title: "Story World Demo",
      status: "draft",
      platform: "custom",
      genre: "fantasy",
      targetChapters: 20,
      chapterWordCount: 3000,
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    }), "utf-8");
    await writeFile(join(storyDir, "story_bible.md"), "original bible", "utf-8");
    await writeFile(join(storyDir, "current_state.md"), "original state", "utf-8");
    await writeFile(join(storyDir, "character_matrix.md"), "original matrix", "utf-8");
    await writeFile(join(storyDir, "pending_hooks.md"), "original hooks", "utf-8");

    try {
      const { createStudioServer } = await import("./server.js");
      const app = createStudioServer(projectConfig as any, root);

      const spineResponse = await app.request(`/api/books/${bookId}/lab/story-spine`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protagonistId: "sera",
          currentGoal: "expose the false alibi",
          currentQuestion: "Can Sera act before the guild closes ranks?",
          emotionalState: ["controlled anger"],
          activeChoices: ["public accusation"],
          constraints: ["guild pressure"],
        }),
      });
      expect(spineResponse.status).toBe(200);

      const pressureResponse = await app.request(`/api/books/${bookId}/lab/world-pressures`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          worldPressures: [{
            id: "pressure-guild",
            type: "faction",
            label: "Guild council",
            currentMotion: "closing ranks around the alibi",
            pressureLevel: "high",
            visibleToProtagonist: "partial",
          }],
        }),
      });
      expect(pressureResponse.status).toBe(200);

      const tickResponse = await app.request(`/api/books/${bookId}/lab/ticks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chapter: 4,
          kind: "protagonist_action",
          protagonistAction: "Sera exposes the false alibi in front of the guild.",
        }),
      });
      expect(tickResponse.status).toBe(200);
      const tickJson = await tickResponse.json() as { tick: { candidates: Array<{ id: string }> } };
      const candidateId = tickJson.tick.candidates[0]!.id;

      const decisionResponse = await app.request(`/api/books/${bookId}/lab/movement-candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      expect(decisionResponse.status).toBe(200);

      const contractResponse = await app.request(`/api/books/${bookId}/lab/scene-contracts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chapter: 4,
          pov: "Sera",
          location: "guild hall",
          sceneGoal: ["Make the guild react to Sera's accusation."],
          mustInclude: ["Sera stays active."],
          mustAvoid: ["Do not solve the whole conspiracy."],
          movementCandidateIds: [candidateId],
          endingState: ["The guild exposes a visible split."],
        }),
      });
      expect(contractResponse.status).toBe(200);
      const contractJson = await contractResponse.json() as { sceneContract: { id: string } };

      const compileResponse = await app.request(`/api/books/${bookId}/lab/scene-contracts/${contractJson.sceneContract.id}/compile`, {
        method: "POST",
      });
      expect(compileResponse.status).toBe(200);
      const intent = await readFile(join(storyDir, "runtime", "chapter-0004.intent.md"), "utf-8");
      expect(intent).toContain("## Goal");
      expect(intent).toContain("Make the guild react");

      await expect(readFile(join(storyDir, "story_bible.md"), "utf-8")).resolves.toBe("original bible");
      await expect(readFile(join(storyDir, "current_state.md"), "utf-8")).resolves.toBe("original state");
      await expect(readFile(join(storyDir, "character_matrix.md"), "utf-8")).resolves.toBe("original matrix");
      await expect(readFile(join(storyDir, "pending_hooks.md"), "utf-8")).resolves.toBe("original hooks");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks compiling a major conflict against a published chapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-story-world-published-"));
    const bookId = "published-demo";
    const storyDir = join(root, "books", bookId, "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(root, "inkos.json"), JSON.stringify(projectConfig), "utf-8");
    await writeFile(join(root, "books", bookId, "book.json"), JSON.stringify({
      id: bookId,
      title: "Published Demo",
      status: "draft",
      platform: "custom",
      genre: "fantasy",
      targetChapters: 20,
      chapterWordCount: 3000,
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    }), "utf-8");

    try {
      const { createStudioServer } = await import("./server.js");
      const app = createStudioServer(projectConfig as any, root);

      await app.request(`/api/books/${bookId}/lab/chapter-status/3`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "published" }),
      });

      const labDir = join(storyDir, "lab");
      await mkdir(labDir, { recursive: true });
      await writeFile(join(labDir, "movement_candidates.json"), JSON.stringify([{
        id: "move-major",
        sourceTickId: "tick-manual",
        text: "Chapter 3's confession is now false.",
        relevance: "high",
        visibility: "observed_now",
        risk: "high",
        conflictLevel: "major",
        status: "approved",
        affectedChapters: [3],
        affectedStateKeys: ["chapter_summaries.3"],
        createdAt: "2026-06-10T00:00:00.000Z",
        updatedAt: "2026-06-10T00:00:00.000Z",
      }], null, 2), "utf-8");

      const contractResponse = await app.request(`/api/books/${bookId}/lab/scene-contracts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chapter: 6,
          pov: "Sera",
          location: "archive",
          sceneGoal: ["Use the contradiction without rewriting chapter 3."],
          movementCandidateIds: ["move-major"],
        }),
      });
      expect(contractResponse.status).toBe(200);
      const contractJson = await contractResponse.json() as { sceneContract: { id: string } };

      const compileResponse = await app.request(`/api/books/${bookId}/lab/scene-contracts/${contractJson.sceneContract.id}/compile`, {
        method: "POST",
      });
      expect(compileResponse.status).toBe(409);
      expect(await compileResponse.text()).toContain("published chapter");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run Studio API tests to verify failure**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- server.test.ts
```

Expected: FAIL because `/api/books/:id/lab/*` routes and payload contracts do not exist.

- [ ] **Step 3: Add shared Studio contracts**

Append to `packages/studio/src/shared/contracts.ts`:

```ts
// --- Story World Lab ---

export type ProjectStoryModePayload = "draft" | "serialized";
export type ChapterPublicationStatusPayload = "draft" | "locked" | "published";
export type WorldPressureTypePayload = "faction" | "character" | "location" | "hook" | "environment";
export type PressureLevelPayload = "low" | "medium" | "high";
export type ProtagonistVisibilityPayload = "yes" | "no" | "partial";
export type AdaptiveTickKindPayload = "protagonist_action" | "protagonist_inaction" | "elapsed_time" | "direction_override";
export type MovementRelevancePayload = "low" | "medium" | "high";
export type MovementVisibilityPayload = "observed_now" | "rumor" | "hidden" | "delayed";
export type MovementRiskPayload = "low" | "medium" | "high";
export type MovementConflictLevelPayload = "none" | "minor" | "major";
export type MovementCandidateStatusPayload = "candidate" | "approved" | "rejected" | "hold";
export type ConflictPolicyPayload = "draft_rewrite_allowed" | "serialized_forward_only" | "edition_retcon_required";
export type RepairStrategyPayload =
  | "forward_bend"
  | "soft_reveal"
  | "continuity_patch"
  | "local_rewrite"
  | "cascade_retcon"
  | "edition_retcon";

export interface StorySpinePayload {
  readonly protagonistId: string;
  readonly currentGoal: string;
  readonly currentQuestion: string;
  readonly emotionalState: ReadonlyArray<string>;
  readonly activeChoices: ReadonlyArray<string>;
  readonly constraints: ReadonlyArray<string>;
}

export interface WorldPressurePayload {
  readonly id: string;
  readonly type: WorldPressureTypePayload;
  readonly label: string;
  readonly currentMotion: string;
  readonly pressureLevel: PressureLevelPayload;
  readonly visibleToProtagonist: ProtagonistVisibilityPayload;
}

export interface AdaptiveTickInputPayload {
  readonly id: string;
  readonly bookId: string;
  readonly chapter: number;
  readonly kind: AdaptiveTickKindPayload;
  readonly protagonistAction?: string;
  readonly protagonistInaction?: string;
  readonly elapsedTime?: string;
  readonly userDirection?: string;
  readonly storySpine: StorySpinePayload;
  readonly worldPressures: ReadonlyArray<WorldPressurePayload>;
  readonly createdAt: string;
}

export interface MovementCandidatePayload {
  readonly id: string;
  readonly sourceTickId: string;
  readonly text: string;
  readonly relevance: MovementRelevancePayload;
  readonly visibility: MovementVisibilityPayload;
  readonly risk: MovementRiskPayload;
  readonly conflictLevel: MovementConflictLevelPayload;
  readonly status: MovementCandidateStatusPayload;
  readonly affectedChapters: ReadonlyArray<number>;
  readonly affectedStateKeys: ReadonlyArray<string>;
  readonly reason?: string | null;
  readonly repairStrategy?: RepairStrategyPayload | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdaptiveTickPayload {
  readonly id: string;
  readonly input: AdaptiveTickInputPayload;
  readonly candidates: ReadonlyArray<MovementCandidatePayload>;
  readonly createdAt: string;
}

export interface ChapterStatusRecordPayload {
  readonly chapter: number;
  readonly status: ChapterPublicationStatusPayload;
  readonly updatedAt: string;
}

export interface ImpactReportPayload {
  readonly id: string;
  readonly candidateId: string;
  readonly conflictLevel: MovementConflictLevelPayload;
  readonly affectedChapters: ReadonlyArray<number>;
  readonly affectedStateKeys: ReadonlyArray<string>;
  readonly repairStrategies: ReadonlyArray<RepairStrategyPayload>;
  readonly message: string;
  readonly createdAt: string;
}

export interface SceneContractPayload {
  readonly id: string;
  readonly chapter: number;
  readonly sourceTickIds: ReadonlyArray<string>;
  readonly pov: string;
  readonly location: string;
  readonly sceneGoal: ReadonlyArray<string>;
  readonly mustInclude: ReadonlyArray<string>;
  readonly mustAvoid: ReadonlyArray<string>;
  readonly movementCandidateIds: ReadonlyArray<string>;
  readonly endingState: ReadonlyArray<string>;
  readonly conflictPolicy: ConflictPolicyPayload;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoryWorldLabPayload {
  readonly projectMode: ProjectStoryModePayload;
  readonly chapterStatus: ReadonlyArray<ChapterStatusRecordPayload>;
  readonly storySpine: StorySpinePayload | null;
  readonly worldPressures: ReadonlyArray<WorldPressurePayload>;
  readonly ticks: ReadonlyArray<AdaptiveTickPayload>;
  readonly movementCandidates: ReadonlyArray<MovementCandidatePayload>;
  readonly impactReports: ReadonlyArray<ImpactReportPayload>;
  readonly sceneContracts: ReadonlyArray<SceneContractPayload>;
}
```

- [ ] **Step 4: Add server imports**

Modify the `@actalk/inkos-core` import in `packages/studio/src/api/server.ts` to include:

```ts
  AdaptiveTickInputSchema,
  ChapterStatusRecordSchema,
  MovementCandidateSchema,
  ProjectStoryModeSchema,
  SceneContractSchema,
  StorySpineSchema,
  WorldPressureSchema,
  createAdaptiveTick,
  repairStrategiesForConflict,
  renderStoryWorldIntentMarkdown,
  validateSceneContractAgainstChapterStatus,
  type AdaptiveTick,
  type ChapterStatusRecord,
  type ImpactReport,
  type MovementCandidate,
  type ProjectStoryMode,
  type SceneContract,
  type StorySpine,
  type WorldPressure,
```

- [ ] **Step 5: Add persistence helpers**

In `packages/studio/src/api/server.ts`, insert these helpers above `// --- Server factory ---`:

```ts
function storyWorldLabDir(root: string, bookId: string): string {
  if (!isSafeBookId(bookId)) {
    throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
  }
  return join(root, "books", bookId, "story", "lab");
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf-8");
}

async function readStorySpine(root: string, bookId: string): Promise<StorySpine | null> {
  const raw = await readJsonFile<unknown | null>(join(storyWorldLabDir(root, bookId), "story_spine.json"), null);
  return raw ? StorySpineSchema.parse(raw) : null;
}

async function writeStorySpine(root: string, bookId: string, storySpine: StorySpine): Promise<void> {
  await writeJsonFile(join(storyWorldLabDir(root, bookId), "story_spine.json"), StorySpineSchema.parse(storySpine));
}

async function readProjectStoryMode(root: string, bookId: string): Promise<ProjectStoryMode> {
  const raw = await readJsonFile<unknown>(join(storyWorldLabDir(root, bookId), "project_mode.json"), "draft");
  return ProjectStoryModeSchema.parse(raw);
}

async function writeProjectStoryMode(root: string, bookId: string, mode: ProjectStoryMode): Promise<void> {
  await writeJsonFile(join(storyWorldLabDir(root, bookId), "project_mode.json"), ProjectStoryModeSchema.parse(mode));
}

async function readChapterStatus(root: string, bookId: string): Promise<ChapterStatusRecord[]> {
  const raw = await readJsonFile<unknown[]>(join(storyWorldLabDir(root, bookId), "chapter_status.json"), []);
  return raw.map((entry) => ChapterStatusRecordSchema.parse(entry));
}

async function writeChapterStatus(root: string, bookId: string, statuses: ReadonlyArray<ChapterStatusRecord>): Promise<void> {
  await writeJsonFile(join(storyWorldLabDir(root, bookId), "chapter_status.json"), statuses.map((entry) => ChapterStatusRecordSchema.parse(entry)));
}

async function readWorldPressures(root: string, bookId: string): Promise<WorldPressure[]> {
  const raw = await readJsonFile<unknown[]>(join(storyWorldLabDir(root, bookId), "world_pressures.json"), []);
  return raw.map((entry) => WorldPressureSchema.parse(entry));
}

async function writeWorldPressures(root: string, bookId: string, pressures: ReadonlyArray<WorldPressure>): Promise<void> {
  await writeJsonFile(join(storyWorldLabDir(root, bookId), "world_pressures.json"), pressures.map((entry) => WorldPressureSchema.parse(entry)));
}

async function readAdaptiveTicks(root: string, bookId: string): Promise<AdaptiveTick[]> {
  const tickDir = join(storyWorldLabDir(root, bookId), "ticks");
  let files: string[];
  try {
    files = (await readdir(tickDir)).filter((file) => file.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const ticks = await Promise.all(files.map(async (file) => readJsonFile<AdaptiveTick | null>(join(tickDir, file), null)));
  return ticks.filter((tick): tick is AdaptiveTick => tick !== null);
}

async function writeAdaptiveTick(root: string, bookId: string, tick: AdaptiveTick): Promise<void> {
  await writeJsonFile(join(storyWorldLabDir(root, bookId), "ticks", `${tick.id}.json`), tick);
}

async function readMovementCandidates(root: string, bookId: string): Promise<MovementCandidate[]> {
  const raw = await readJsonFile<unknown[]>(join(storyWorldLabDir(root, bookId), "movement_candidates.json"), []);
  return raw.map((entry) => MovementCandidateSchema.parse(entry));
}

async function writeMovementCandidates(root: string, bookId: string, candidates: ReadonlyArray<MovementCandidate>): Promise<void> {
  await writeJsonFile(join(storyWorldLabDir(root, bookId), "movement_candidates.json"), candidates.map((entry) => MovementCandidateSchema.parse(entry)));
}

async function readImpactReports(root: string, bookId: string): Promise<ImpactReport[]> {
  const reportDir = join(storyWorldLabDir(root, bookId), "impact_reports");
  let files: string[];
  try {
    files = (await readdir(reportDir)).filter((file) => file.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const reports = await Promise.all(files.map(async (file) => readJsonFile<ImpactReport | null>(join(reportDir, file), null)));
  return reports.filter((report): report is ImpactReport => report !== null);
}

async function writeImpactReport(root: string, bookId: string, report: ImpactReport): Promise<void> {
  await writeJsonFile(join(storyWorldLabDir(root, bookId), "impact_reports", `${report.id}.json`), report);
}

async function readSceneContracts(root: string, bookId: string): Promise<SceneContract[]> {
  const contractDir = join(storyWorldLabDir(root, bookId), "scene_contracts");
  let files: string[];
  try {
    files = (await readdir(contractDir)).filter((file) => file.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const contracts = await Promise.all(files.map(async (file) => readJsonFile<SceneContract | null>(join(contractDir, file), null)));
  return contracts.filter((contract): contract is SceneContract => contract !== null);
}

async function writeSceneContract(root: string, bookId: string, contract: SceneContract): Promise<void> {
  await writeJsonFile(join(storyWorldLabDir(root, bookId), "scene_contracts", `${contract.id}.json`), SceneContractSchema.parse(contract));
}

function nextStoryWorldId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split("\n").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}
```

If `dirname` is not imported, update the `node:path` import to include it:

```ts
import { basename, dirname, extname, join, relative } from "node:path";
```

- [ ] **Step 6: Add Story World Lab endpoints**

Inside `createStudioServer`, insert these routes after the `/api/books/:id` route and before chapter routes:

```ts
  app.get("/api/books/:id/lab", async (c) => {
    const bookId = c.req.param("id");
    return c.json({
      projectMode: await readProjectStoryMode(root, bookId),
      chapterStatus: await readChapterStatus(root, bookId),
      storySpine: await readStorySpine(root, bookId),
      worldPressures: await readWorldPressures(root, bookId),
      ticks: await readAdaptiveTicks(root, bookId),
      movementCandidates: await readMovementCandidates(root, bookId),
      impactReports: await readImpactReports(root, bookId),
      sceneContracts: await readSceneContracts(root, bookId),
    });
  });

  app.put("/api/books/:id/lab/story-spine", async (c) => {
    const bookId = c.req.param("id");
    const storySpine = StorySpineSchema.parse(await c.req.json());
    await writeStorySpine(root, bookId, storySpine);
    return c.json({ storySpine });
  });

  app.put("/api/books/:id/lab/project-mode", async (c) => {
    const bookId = c.req.param("id");
    const body = await c.req.json() as { mode?: unknown };
    const mode = ProjectStoryModeSchema.parse(body.mode);
    await writeProjectStoryMode(root, bookId, mode);
    return c.json({ projectMode: mode });
  });

  app.patch("/api/books/:id/lab/chapter-status/:chapter", async (c) => {
    const bookId = c.req.param("id");
    const chapter = Number.parseInt(c.req.param("chapter"), 10);
    if (!Number.isInteger(chapter) || chapter <= 0) {
      throw new ApiError(400, "INVALID_CHAPTER", "Chapter must be a positive integer.");
    }
    const body = await c.req.json() as { status?: unknown };
    const status = ChapterPublicationStatusSchema.parse(body.status);
    const now = new Date().toISOString();
    const statuses = await readChapterStatus(root, bookId);
    const existing = statuses.find((entry) => entry.chapter === chapter);
    if (existing?.status === "published" && status !== "published") {
      throw new ApiError(409, "PUBLISHED_CHAPTER_IMMUTABLE", `Published chapter ${chapter} cannot be downgraded from Studio Lab.`);
    }
    const next = [
      ...statuses.filter((entry) => entry.chapter !== chapter),
      { chapter, status, updatedAt: now },
    ].sort((a, b) => a.chapter - b.chapter);
    await writeChapterStatus(root, bookId, next);
    return c.json({ chapterStatus: next });
  });

  app.put("/api/books/:id/lab/world-pressures", async (c) => {
    const bookId = c.req.param("id");
    const body = await c.req.json() as { worldPressures?: unknown };
    const worldPressures = Array.isArray(body.worldPressures)
      ? body.worldPressures.map((entry) => WorldPressureSchema.parse(entry))
      : [];
    await writeWorldPressures(root, bookId, worldPressures);
    return c.json({ worldPressures });
  });

  app.post("/api/books/:id/lab/ticks", async (c) => {
    const bookId = c.req.param("id");
    const body = await c.req.json() as Record<string, unknown>;
    const storySpine = await readStorySpine(root, bookId);
    if (!storySpine) {
      throw new ApiError(409, "STORY_SPINE_REQUIRED", "Create a Story Spine before advancing the world.");
    }
    const worldPressures = await readWorldPressures(root, bookId);
    const now = new Date().toISOString();
    const tick = createAdaptiveTick(AdaptiveTickInputSchema.parse({
      id: nextStoryWorldId("tick"),
      bookId,
      chapter: body.chapter,
      kind: body.kind,
      protagonistAction: typeof body.protagonistAction === "string" ? body.protagonistAction : undefined,
      protagonistInaction: typeof body.protagonistInaction === "string" ? body.protagonistInaction : undefined,
      elapsedTime: typeof body.elapsedTime === "string" ? body.elapsedTime : undefined,
      userDirection: typeof body.userDirection === "string" ? body.userDirection : undefined,
      storySpine,
      worldPressures,
      createdAt: now,
    }));
    await writeAdaptiveTick(root, bookId, tick);
    const existing = await readMovementCandidates(root, bookId);
    const nextCandidates = [...existing, ...tick.candidates];
    await writeMovementCandidates(root, bookId, nextCandidates);
    return c.json({ tick, movementCandidates: nextCandidates });
  });

  app.patch("/api/books/:id/lab/movement-candidates/:candidateId", async (c) => {
    const bookId = c.req.param("id");
    const candidateId = c.req.param("candidateId");
    const body = await c.req.json() as Record<string, unknown>;
    const now = new Date().toISOString();
    const candidates = await readMovementCandidates(root, bookId);
    const existing = candidates.find((candidate) => candidate.id === candidateId);
    if (!existing) {
      throw new ApiError(404, "CANDIDATE_NOT_FOUND", `Movement candidate "${candidateId}" was not found.`);
    }
    const updated = MovementCandidateSchema.parse({
      ...existing,
      text: typeof body.text === "string" && body.text.trim() ? body.text.trim() : existing.text,
      status: typeof body.status === "string" ? body.status : existing.status,
      reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : existing.reason,
      repairStrategy: typeof body.repairStrategy === "string" ? body.repairStrategy : existing.repairStrategy,
      updatedAt: now,
    });
    const next = candidates.map((candidate) => candidate.id === candidateId ? updated : candidate);
    await writeMovementCandidates(root, bookId, next);
    if (updated.conflictLevel !== "none") {
      const serialized = (await readProjectStoryMode(root, bookId)) === "serialized";
      const report: ImpactReport = {
        id: nextStoryWorldId("impact"),
        candidateId: updated.id,
        conflictLevel: updated.conflictLevel,
        affectedChapters: updated.affectedChapters,
        affectedStateKeys: updated.affectedStateKeys,
        repairStrategies: repairStrategiesForConflict(updated.conflictLevel, serialized),
        message: `Candidate ${updated.id} may affect ${updated.affectedChapters.length} chapter(s) and ${updated.affectedStateKeys.length} state key(s).`,
        createdAt: now,
      };
      await writeImpactReport(root, bookId, report);
    }
    return c.json({ movementCandidate: updated, movementCandidates: next });
  });

  app.post("/api/books/:id/lab/scene-contracts", async (c) => {
    const bookId = c.req.param("id");
    const body = await c.req.json() as Record<string, unknown>;
    const now = new Date().toISOString();
    const candidates = await readMovementCandidates(root, bookId);
    const selectedIds = Array.isArray(body.movementCandidateIds) ? body.movementCandidateIds.map(String) : [];
    const sourceTickIds = [...new Set(candidates
      .filter((candidate) => selectedIds.includes(candidate.id))
      .map((candidate) => candidate.sourceTickId))];
    const projectMode = await readProjectStoryMode(root, bookId);
    const contract = SceneContractSchema.parse({
      id: nextStoryWorldId("scene"),
      chapter: body.chapter,
      sourceTickIds,
      pov: typeof body.pov === "string" && body.pov.trim() ? body.pov.trim() : "Protagonist",
      location: typeof body.location === "string" && body.location.trim() ? body.location.trim() : "Current scene location",
      sceneGoal: parseStringList(body.sceneGoal),
      mustInclude: parseStringList(body.mustInclude),
      mustAvoid: parseStringList(body.mustAvoid),
      movementCandidateIds: selectedIds,
      endingState: parseStringList(body.endingState),
      conflictPolicy: projectMode === "serialized" ? "serialized_forward_only" : "draft_rewrite_allowed",
      createdAt: now,
      updatedAt: now,
    });
    await writeSceneContract(root, bookId, contract);
    return c.json({ sceneContract: contract });
  });

  app.post("/api/books/:id/lab/scene-contracts/:sceneContractId/compile", async (c) => {
    const bookId = c.req.param("id");
    const sceneContractId = c.req.param("sceneContractId");
    const contracts = await readSceneContracts(root, bookId);
    const contract = contracts.find((entry) => entry.id === sceneContractId);
    if (!contract) {
      throw new ApiError(404, "SCENE_CONTRACT_NOT_FOUND", `Scene contract "${sceneContractId}" was not found.`);
    }
    const candidates = await readMovementCandidates(root, bookId);
    const chapterStatus = await readChapterStatus(root, bookId);
    const validation = validateSceneContractAgainstChapterStatus(contract, chapterStatus, candidates);
    if (!validation.ok) {
      throw new ApiError(409, "SCENE_CONTRACT_CONFLICT", validation.blockers.join("\n"));
    }
    const markdown = renderStoryWorldIntentMarkdown(contract, candidates);
    const runtimeDir = join(state.bookDir(bookId), "story", "runtime");
    await mkdir(runtimeDir, { recursive: true });
    const runtimePath = join(runtimeDir, `chapter-${String(contract.chapter).padStart(4, "0")}.intent.md`);
    await writeFile(runtimePath, markdown, "utf-8");
    return c.json({ runtimePath, intentMarkdown: markdown });
  });
```

- [ ] **Step 7: Verify Studio API tests**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- server.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit API work**

Run:

```bash
git add packages/studio/src/shared/contracts.ts packages/studio/src/api/server.ts packages/studio/src/api/server.test.ts
git commit -m "feat(studio): persist story world lab state"
```

---

## Task 3: Studio Route And Navigation

**Files:**
- Modify: `packages/studio/src/App.tsx`
- Modify: `packages/studio/src/components/Sidebar.tsx`
- Modify: `packages/studio/src/App.test.ts`

- [ ] **Step 1: Add failing route tests**

In `packages/studio/src/App.test.ts`, add route helper expectations near existing route tests:

```ts
describe("story world route", () => {
  it("parses, builds, and marks the active book for Story World Lab", () => {
    expect(appModule.parseRouteFromSearch("?page=story-world&bookId=demo")).toEqual({
      page: "story-world",
      bookId: "demo",
    });
    expect(appModule.buildRouteSearch({ page: "story-world", bookId: "demo" })).toBe("?page=story-world&bookId=demo");
    expect(appModule.deriveActiveBookId({ page: "story-world", bookId: "demo" })).toBe("demo");
  });
});
```

- [ ] **Step 2: Run route tests to verify failure**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- App.test.ts
```

Expected: FAIL because the route union does not include `story-world`.

- [ ] **Step 3: Add route shape and parser support**

Modify `packages/studio/src/App.tsx`:

Add to the `Route` union:

```ts
  | { page: "story-world"; bookId: string }
```

Add to `parseRouteFromSearch`:

```ts
    case "story-world": {
      const bookId = params.get("bookId")?.trim();
      return bookId ? { page: "story-world", bookId } : null;
    }
```

Add to `buildRouteSearch`:

```ts
    case "story-world":
      params.set("page", "story-world");
      params.set("bookId", route.bookId);
      break;
```

Add `story-world` to `deriveActiveBookId`:

```ts
    || route.page === "story-world"
```

- [ ] **Step 4: Add navigation method and page rendering**

In `AppShell`, add a navigation method:

```ts
    toStoryWorld: (bookId: string) => {
      setRoute({ page: "story-world", bookId });
      setSidebarOpen(false);
    },
```

Update `contentWidthClass` so Story World Lab can use a wide work surface:

```ts
  const contentWidthClass = route.page === "config"
    ? "max-w-6xl"
    : route.page === "truth" || route.page === "story-world"
      ? "max-w-7xl"
      : "max-w-5xl";
```

Do not import or render `StoryWorldLab` in this task. The page file is created and wired in Task 5 so the route tests can pass before the component exists.

- [ ] **Step 5: Add Sidebar navigation entry**

Modify the `Nav` interface in `packages/studio/src/components/Sidebar.tsx`:

```ts
  toStoryWorld: (id: string) => void;
```

Add `Orbit` to the lucide import:

```ts
  Orbit,
```

Inside the book list rendering, replace each book button with a small two-action group:

```tsx
<div key={book.id} className="space-y-1">
  <button
    onClick={() => nav.toBook(book.id)}
    className={`w-full group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
      activePage === `book:${book.id}`
        ? "studio-chip-accent text-foreground font-semibold"
        : "studio-chip"
    }`}
  >
    <Book size={16} className={activePage === `book:${book.id}` ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"} />
    <span className="truncate flex-1 text-left">{book.title}</span>
    {book.chaptersWritten > 0 && (
      <span className="text-[10px] px-1.5 py-0.5 rounded studio-chip">
        {book.chaptersWritten}
      </span>
    )}
  </button>
  <button
    type="button"
    onClick={() => nav.toStoryWorld(book.id)}
    className={`ml-7 flex w-[calc(100%-1.75rem)] items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
      activePage === `story-world:${book.id}`
        ? "studio-chip-accent text-foreground font-semibold"
        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
    }`}
  >
    <Orbit size={13} />
    <span className="truncate text-left">Story World</span>
  </button>
</div>
```

Update `activePage` in `AppShell`:

```ts
  const activePage = route.page === "story-world"
    ? `story-world:${route.bookId}`
    : activeBookId
      ? `book:${activeBookId}`
      : route.page;
```

- [ ] **Step 6: Verify route tests**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- App.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit route work**

Run:

```bash
git add packages/studio/src/App.tsx packages/studio/src/components/Sidebar.tsx packages/studio/src/App.test.ts
git commit -m "feat(studio): route story world lab"
```

---

## Task 4: Studio UI State Helpers

**Files:**
- Create: `packages/studio/src/pages/story-world-state.ts`
- Create: `packages/studio/src/pages/story-world-state.test.ts`

- [ ] **Step 1: Write failing state helper tests**

Create `packages/studio/src/pages/story-world-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildDefaultStorySpine,
  buildTickRequest,
  canCompileSceneContract,
  groupMovementCandidates,
  statusLabelForChapter,
} from "./story-world-state";
import type { MovementCandidatePayload, StorySpinePayload } from "../shared/contracts";

const spine: StorySpinePayload = {
  protagonistId: "sera",
  currentGoal: "expose the alibi",
  currentQuestion: "Can Sera move first?",
  emotionalState: ["focused"],
  activeChoices: ["accuse publicly"],
  constraints: ["guild pressure"],
};

const candidate = (id: string, status: MovementCandidatePayload["status"]): MovementCandidatePayload => ({
  id,
  sourceTickId: "tick-1",
  text: `candidate ${id}`,
  relevance: "high",
  visibility: "observed_now",
  risk: "medium",
  conflictLevel: "none",
  status,
  affectedChapters: [3],
  affectedStateKeys: ["story_spine.currentQuestion"],
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
});

describe("story world state helpers", () => {
  it("builds a blank Story Spine", () => {
    expect(buildDefaultStorySpine()).toEqual({
      protagonistId: "",
      currentGoal: "",
      currentQuestion: "",
      emotionalState: [],
      activeChoices: [],
      constraints: [],
    });
  });

  it("groups movement candidates by status", () => {
    expect(groupMovementCandidates([
      candidate("a", "candidate"),
      candidate("b", "approved"),
      candidate("c", "rejected"),
      candidate("d", "hold"),
    ])).toEqual({
      candidate: [candidate("a", "candidate")],
      approved: [candidate("b", "approved")],
      hold: [candidate("d", "hold")],
      rejected: [candidate("c", "rejected")],
    });
  });

  it("builds a protagonist action tick request", () => {
    expect(buildTickRequest({
      chapter: 7,
      kind: "protagonist_action",
      actionText: "Sera confronts the guild master.",
      storySpine: spine,
    })).toEqual({
      chapter: 7,
      kind: "protagonist_action",
      protagonistAction: "Sera confronts the guild master.",
    });
  });

  it("requires an approved candidate before compile", () => {
    expect(canCompileSceneContract([candidate("a", "candidate")], ["a"])).toBe(false);
    expect(canCompileSceneContract([candidate("a", "approved")], ["a"])).toBe(true);
  });

  it("labels chapter statuses", () => {
    expect(statusLabelForChapter("draft")).toBe("Draft");
    expect(statusLabelForChapter("locked")).toBe("Locked");
    expect(statusLabelForChapter("published")).toBe("Published");
  });
});
```

- [ ] **Step 2: Run helper tests to verify failure**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- story-world-state.test.ts
```

Expected: FAIL because `story-world-state.ts` does not exist.

- [ ] **Step 3: Add state helpers**

Create `packages/studio/src/pages/story-world-state.ts`:

```ts
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
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
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
  const approved = new Set(candidates.filter((candidate) => candidate.status === "approved").map((candidate) => candidate.id));
  return selectedCandidateIds.length > 0 && selectedCandidateIds.every((id) => approved.has(id));
}

export function statusLabelForChapter(status: "draft" | "locked" | "published"): string {
  if (status === "published") return "Published";
  if (status === "locked") return "Locked";
  return "Draft";
}
```

- [ ] **Step 4: Verify helper tests**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- story-world-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper work**

Run:

```bash
git add packages/studio/src/pages/story-world-state.ts packages/studio/src/pages/story-world-state.test.ts
git commit -m "feat(studio): add story world ui state helpers"
```

---

## Task 5: Studio Story World Lab Page

**Files:**
- Create: `packages/studio/src/pages/StoryWorldLab.tsx`
- Modify: `packages/studio/src/App.test.ts`

- [ ] **Step 1: Add failing UI source wiring test**

In `packages/studio/src/App.test.ts`, add a light source-level test:

```ts
import { readFileSync } from "node:fs";

describe("story world page wiring", () => {
  it("renders StoryWorldLab from the app shell", () => {
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(appSource).toContain('from "./pages/StoryWorldLab"');
    expect(appSource).toContain('route.page === "story-world"');
    expect(appSource).toContain("<StoryWorldLab");
  });
});
```

- [ ] **Step 2: Run UI wiring test to verify failure**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- App.test.ts
```

Expected: FAIL until the page exists and App imports/renders it.

- [ ] **Step 3: Create the Story World Lab page**

Create `packages/studio/src/pages/StoryWorldLab.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Clock, FileText, GitBranch, Orbit, Play, RefreshCw, Save, ShieldAlert, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { fetchJson, postApi, putApi } from "../hooks/use-api";
import type {
  AdaptiveTickKindPayload,
  MovementCandidatePayload,
  StorySpinePayload,
  StoryWorldLabPayload,
  WorldPressurePayload,
} from "../shared/contracts";
import {
  buildDefaultStorySpine,
  buildTickRequest,
  canCompileSceneContract,
  groupMovementCandidates,
  linesValue,
  parseLines,
} from "./story-world-state";

interface StoryWorldLabProps {
  readonly bookId: string;
  readonly onOpenBook: () => void;
}

const PRESSURE_TYPES: WorldPressurePayload["type"][] = ["faction", "character", "location", "hook", "environment"];
const PRESSURE_LEVELS: WorldPressurePayload["pressureLevel"][] = ["low", "medium", "high"];
const VISIBILITY_OPTIONS: WorldPressurePayload["visibleToProtagonist"][] = ["yes", "partial", "no"];

function emptyPressure(): WorldPressurePayload {
  return {
    id: `pressure-${Date.now().toString(36)}`,
    type: "hook",
    label: "",
    currentMotion: "",
    pressureLevel: "medium",
    visibleToProtagonist: "partial",
  };
}

export function StoryWorldLab({ bookId, onOpenBook }: StoryWorldLabProps) {
  const [lab, setLab] = useState<StoryWorldLabPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [storySpine, setStorySpine] = useState<StorySpinePayload>(() => buildDefaultStorySpine());
  const [emotionalState, setEmotionalState] = useState("");
  const [activeChoices, setActiveChoices] = useState("");
  const [constraints, setConstraints] = useState("");
  const [worldPressures, setWorldPressures] = useState<WorldPressurePayload[]>([]);
  const [chapter, setChapter] = useState(1);
  const [tickKind, setTickKind] = useState<AdaptiveTickKindPayload>("protagonist_action");
  const [tickText, setTickText] = useState("");
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [sceneGoal, setSceneGoal] = useState("");
  const [pov, setPov] = useState("");
  const [location, setLocation] = useState("");
  const [mustInclude, setMustInclude] = useState("");
  const [mustAvoid, setMustAvoid] = useState("");
  const [endingState, setEndingState] = useState("");

  const loadLab = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchJson<StoryWorldLabPayload>(`/books/${bookId}/lab`);
      setLab(next);
      const spine = next.storySpine ?? buildDefaultStorySpine();
      setStorySpine(spine);
      setEmotionalState(linesValue(spine.emotionalState));
      setActiveChoices(linesValue(spine.activeChoices));
      setConstraints(linesValue(spine.constraints));
      setWorldPressures([...next.worldPressures]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLab();
  }, [bookId]);

  const grouped = useMemo(() => groupMovementCandidates(lab?.movementCandidates ?? []), [lab?.movementCandidates]);
  const canCompile = canCompileSceneContract(lab?.movementCandidates ?? [], selectedCandidateIds);

  const saveStorySpine = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: StorySpinePayload = {
        ...storySpine,
        emotionalState: parseLines(emotionalState),
        activeChoices: parseLines(activeChoices),
        constraints: parseLines(constraints),
      };
      await putApi(`/books/${bookId}/lab/story-spine`, payload);
      await loadLab();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const saveWorldPressures = async () => {
    setSaving(true);
    setError(null);
    try {
      await putApi(`/books/${bookId}/lab/world-pressures`, {
        worldPressures: worldPressures.filter((pressure) => pressure.label.trim() && pressure.currentMotion.trim()),
      });
      await loadLab();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const createTick = async () => {
    setSaving(true);
    setError(null);
    try {
      await postApi(`/books/${bookId}/lab/ticks`, buildTickRequest({
        chapter,
        kind: tickKind,
        actionText: tickText,
        storySpine,
      }));
      setTickText("");
      await loadLab();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const updateCandidate = async (candidate: MovementCandidatePayload, status: MovementCandidatePayload["status"]) => {
    setSaving(true);
    setError(null);
    try {
      await fetchJson(`/books/${bookId}/lab/movement-candidates/${candidate.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await loadLab();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const compileScene = async () => {
    setSaving(true);
    setError(null);
    try {
      const contract = await postApi<{ sceneContract: { id: string } }>(`/books/${bookId}/lab/scene-contracts`, {
        chapter,
        pov: pov || storySpine.protagonistId || "Protagonist",
        location: location || "Current scene",
        sceneGoal: parseLines(sceneGoal),
        mustInclude: parseLines(mustInclude),
        mustAvoid: parseLines(mustAvoid),
        endingState: parseLines(endingState),
        movementCandidateIds: selectedCandidateIds,
      });
      await postApi(`/books/${bookId}/lab/scene-contracts/${contract.sceneContract.id}/compile`);
      await loadLab();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const toggleSelected = (candidateId: string) => {
    setSelectedCandidateIds((current) => (
      current.includes(candidateId)
        ? current.filter((id) => id !== candidateId)
        : [...current, candidateId]
    ));
  };

  if (loading && !lab) {
    return <div className="p-8 text-sm text-muted-foreground">Loading Story World Lab...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Story World</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Protagonist-led world movement for book <span className="font-mono">{bookId}</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onOpenBook}><FileText size={16} /> Book</Button>
          <Button variant="outline" onClick={loadLab}><RefreshCw size={16} /> Refresh</Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/8 p-3 text-sm text-destructive">
          <AlertTriangle size={16} className="mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.05fr_1.2fr_0.95fr]">
        <section className="rounded-md border bg-card p-4">
          <div className="mb-4 flex items-center gap-2">
            <GitBranch size={16} />
            <h2 className="text-base font-semibold">Story Spine</h2>
          </div>
          <div className="space-y-3">
            <Label>Protagonist</Label>
            <Input value={storySpine.protagonistId} onChange={(event) => setStorySpine({ ...storySpine, protagonistId: event.target.value })} />
            <Label>Current Goal</Label>
            <textarea className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={storySpine.currentGoal} onChange={(event) => setStorySpine({ ...storySpine, currentGoal: event.target.value })} />
            <Label>Current Question</Label>
            <textarea className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={storySpine.currentQuestion} onChange={(event) => setStorySpine({ ...storySpine, currentQuestion: event.target.value })} />
            <Label>Emotional State</Label>
            <textarea className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={emotionalState} onChange={(event) => setEmotionalState(event.target.value)} />
            <Label>Active Choices</Label>
            <textarea className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={activeChoices} onChange={(event) => setActiveChoices(event.target.value)} />
            <Label>Constraints</Label>
            <textarea className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={constraints} onChange={(event) => setConstraints(event.target.value)} />
            <Button onClick={saveStorySpine} disabled={saving}><Save size={16} /> Save Spine</Button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-md border bg-card p-4">
            <div className="mb-4 flex items-center gap-2">
              <Play size={16} />
              <h2 className="text-base font-semibold">Adaptive Tick</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-[120px_1fr]">
              <div>
                <Label>Chapter</Label>
                <Input type="number" min={1} value={chapter} onChange={(event) => setChapter(Math.max(1, Number.parseInt(event.target.value, 10) || 1))} />
              </div>
              <div>
                <Label>Tick Type</Label>
                <select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={tickKind} onChange={(event) => setTickKind(event.target.value as AdaptiveTickKindPayload)}>
                  <option value="protagonist_action">Protagonist action</option>
                  <option value="protagonist_inaction">Protagonist inaction</option>
                  <option value="elapsed_time">Elapsed time</option>
                  <option value="direction_override">Direction override</option>
                </select>
              </div>
            </div>
            <textarea className="mt-3 min-h-28 w-full rounded-md border bg-background p-3 text-sm" value={tickText} onChange={(event) => setTickText(event.target.value)} />
            <Button className="mt-3" onClick={createTick} disabled={saving || !tickText.trim()}><Clock size={16} /> Advance</Button>
          </div>

          <div className="rounded-md border bg-card p-4">
            <div className="mb-4 flex items-center gap-2">
              <Check size={16} />
              <h2 className="text-base font-semibold">Movement Candidates</h2>
            </div>
            <div className="space-y-3">
              {[...grouped.candidate, ...grouped.approved, ...grouped.hold].map((candidate) => (
                <div key={candidate.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
                      <span>{candidate.relevance}</span>
                      <span>{candidate.visibility.replaceAll("_", " ")}</span>
                      <span>{candidate.conflictLevel}</span>
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={selectedCandidateIds.includes(candidate.id)} disabled={candidate.status !== "approved"} onChange={() => toggleSelected(candidate.id)} />
                      Scene
                    </label>
                  </div>
                  <p className="mt-2 text-sm leading-6">{candidate.text}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => updateCandidate(candidate, "approved")} disabled={saving || candidate.status === "approved"}><Check size={14} /> Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => updateCandidate(candidate, "hold")} disabled={saving || candidate.status === "hold"}><ShieldAlert size={14} /> Hold</Button>
                    <Button size="sm" variant="outline" onClick={() => updateCandidate(candidate, "rejected")} disabled={saving || candidate.status === "rejected"}><X size={14} /> Reject</Button>
                  </div>
                </div>
              ))}
              {lab && lab.movementCandidates.length === 0 && (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Save a Story Spine and advance a tick to create movement candidates.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-md border bg-card p-4">
            <div className="mb-4 flex items-center gap-2">
              <Orbit size={16} />
              <h2 className="text-base font-semibold">World Pressure</h2>
            </div>
            <div className="space-y-3">
              {worldPressures.map((pressure, index) => (
                <div key={pressure.id} className="rounded-md border p-3">
                  <Input value={pressure.label} placeholder="Label" onChange={(event) => setWorldPressures((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} />
                  <textarea className="mt-2 min-h-16 w-full rounded-md border bg-background p-2 text-sm" value={pressure.currentMotion} placeholder="Current motion" onChange={(event) => setWorldPressures((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, currentMotion: event.target.value } : item))} />
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <select className="h-9 rounded-md border bg-background px-2 text-xs" value={pressure.type} onChange={(event) => setWorldPressures((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as WorldPressurePayload["type"] } : item))}>
                      {PRESSURE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                    <select className="h-9 rounded-md border bg-background px-2 text-xs" value={pressure.pressureLevel} onChange={(event) => setWorldPressures((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, pressureLevel: event.target.value as WorldPressurePayload["pressureLevel"] } : item))}>
                      {PRESSURE_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                    </select>
                    <select className="h-9 rounded-md border bg-background px-2 text-xs" value={pressure.visibleToProtagonist} onChange={(event) => setWorldPressures((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, visibleToProtagonist: event.target.value as WorldPressurePayload["visibleToProtagonist"] } : item))}>
                      {VISIBILITY_OPTIONS.map((visibility) => <option key={visibility} value={visibility}>{visibility}</option>)}
                    </select>
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setWorldPressures((current) => [...current, emptyPressure()])}>Add Pressure</Button>
                <Button onClick={saveWorldPressures} disabled={saving}><Save size={16} /> Save</Button>
              </div>
            </div>
          </div>

          <div className="rounded-md border bg-card p-4">
            <div className="mb-4 flex items-center gap-2">
              <FileText size={16} />
              <h2 className="text-base font-semibold">Scene Contract</h2>
            </div>
            <div className="space-y-3">
              <Input value={pov} placeholder="POV" onChange={(event) => setPov(event.target.value)} />
              <Input value={location} placeholder="Location" onChange={(event) => setLocation(event.target.value)} />
              <textarea className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={sceneGoal} placeholder="Scene goal" onChange={(event) => setSceneGoal(event.target.value)} />
              <textarea className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={mustInclude} placeholder="Must include" onChange={(event) => setMustInclude(event.target.value)} />
              <textarea className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={mustAvoid} placeholder="Must avoid" onChange={(event) => setMustAvoid(event.target.value)} />
              <textarea className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={endingState} placeholder="Ending state" onChange={(event) => setEndingState(event.target.value)} />
              <Button onClick={compileScene} disabled={saving || !canCompile || !sceneGoal.trim()}><FileText size={16} /> Compile Intent</Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Confirm App renders the page**

If Task 3 did not already add the import and render branch, add them now:

```ts
import { StoryWorldLab } from "./pages/StoryWorldLab";
```

```tsx
{route.page === "story-world" && (
  <StoryWorldLab
    bookId={route.bookId}
    onOpenBook={() => nav.toBook(route.bookId)}
  />
)}
```

- [ ] **Step 5: Verify UI tests**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- App.test.ts story-world-state.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit UI work**

Run:

```bash
git add packages/studio/src/pages/StoryWorldLab.tsx packages/studio/src/App.tsx packages/studio/src/App.test.ts
git commit -m "feat(studio): build story world lab page"
```

---

## Task 6: Full Verification

**Files:**
- No new source files unless verification exposes a defect.

- [ ] **Step 1: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run targeted tests**

Run:

```bash
pnpm --filter @actalk/inkos-core test -- story-world-lab.test.ts
pnpm --filter @actalk/inkos-studio test -- server.test.ts App.test.ts story-world-state.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full tests**

Run:

```bash
pnpm test
```

Expected: PASS. If CLI tests fail because `packages/cli/dist/index.js` is missing in a fresh worktree, run:

```bash
pnpm --filter @actalk/inkos build
pnpm test
```

Expected after build: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Start Studio for manual verification**

Run the API server:

```bash
INKOS_STUDIO_PORT=4569 node --import ./packages/studio/node_modules/tsx/dist/loader.mjs packages/studio/src/api/index.ts
```

Run Vite in a second shell:

```bash
pnpm --filter @actalk/inkos-studio dev -- --host 127.0.0.1 --port 4567
```

Open:

```text
http://127.0.0.1:4567/?page=story-world&bookId=<existing-book-id>
```

Manual checks:

- Story Spine saves and reloads.
- World Pressure saves and reloads.
- Protagonist action creates movement candidates.
- Approve enables scene contract compile.
- Compile writes `story/runtime/chapter-XXXX.intent.md`.
- Published chapter conflict returns a visible error instead of mutating past content.

- [ ] **Step 6: Commit verification fixes**

If verification required fixes, commit only those touched files:

```bash
git add <fixed-files>
git commit -m "fix: stabilize story world lab verification"
```

Expected: no commit is needed if all verification passes without code changes.

## Task 7: Chat-First World Director Revision

**Files:**
- Modify: `docs/superpowers/specs/2026-06-10-story-led-world-movement-design.md`
- Modify: `packages/studio/src/pages/story-world-state.ts`
- Modify: `packages/studio/src/pages/story-world-state.test.ts`
- Modify: `packages/studio/src/pages/StoryWorldLab.tsx`

- [ ] **Step 1: Write failing UI helper tests**

Add tests to `packages/studio/src/pages/story-world-state.test.ts`:

```ts
it("builds a World Director transcript from adaptive ticks", () => {
  const transcript = buildWorldDirectorTranscript([tickWithTwoCandidates]);

  expect(transcript).toEqual([
    expect.objectContaining({ role: "user", text: "Reveal pressure through a public mistake." }),
    expect.objectContaining({ role: "world", text: expect.stringContaining("The guild makes a visible mistake.") }),
  ]);
});

it("bootstraps a Story Spine from the first chat direction", () => {
  expect(buildDefaultStorySpineFromDirection("  Make the witness force Sera to choose. ")).toMatchObject({
    protagonistId: "Protagonist",
    currentGoal: "Make the witness force Sera to choose.",
    currentQuestion: "How does the world respond now?",
  });
});

it("builds a chat tick request as a direction override", () => {
  expect(buildChatTickRequest({ chapter: 3, text: "Let the city react quietly." })).toEqual({
    chapter: 3,
    kind: "direction_override",
    userDirection: "Let the city react quietly.",
  });
});
```

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- story-world-state.test.ts
```

Expected: FAIL because the new helpers are not exported yet.

- [ ] **Step 2: Implement minimal UI state helpers**

Add these exports to `packages/studio/src/pages/story-world-state.ts`:

```ts
export function buildDefaultStorySpineFromDirection(direction: string): StorySpinePayload {
  const text = direction.trim() || "Follow the user's latest direction.";
  return {
    protagonistId: "Protagonist",
    currentGoal: text,
    currentQuestion: "How does the world respond now?",
    emotionalState: [],
    activeChoices: [],
    constraints: [],
  };
}

export function buildChatTickRequest(input: { readonly chapter: number; readonly text: string }): TickRequestPayload {
  return buildTickRequest({ chapter: input.chapter, kind: "direction_override", actionText: input.text });
}
```

Also add `buildWorldDirectorTranscript` so persisted ticks render as paired user/world messages.

- [ ] **Step 3: Run helper tests**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- story-world-state.test.ts
```

Expected: PASS.

- [ ] **Step 4: Refactor the Studio page around chat**

Change `packages/studio/src/pages/StoryWorldLab.tsx` so the first visible work surface is:

- `World Director` transcript in the main column.
- Bottom composer with chapter, optional tick kind, freeform text, and send button.
- Automatic minimal Story Spine save before the first chat tick if the lab has no saved spine.
- Right `Debug Board` with latest reaction, candidates, selected approvals, scene intent, contracts, and compile.
- Collapsible advanced Story Spine and World Pressure editors.

Keep `buildWorldPressuresPayload`, `buildSceneContractPayload`, and the existing `canCompileSceneContract(candidates, selectedCandidateIds)` source guard intact.

- [ ] **Step 5: Run targeted Studio verification**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- story-world-state.test.ts App.test.ts
pnpm --filter @actalk/inkos-studio typecheck
```

Expected: PASS.

- [ ] **Step 6: Run final verification and commit**

Run:

```bash
pnpm --filter @actalk/inkos-studio build
git diff --check
```

Expected: PASS. Commit changed files with:

```bash
git add docs/superpowers/specs/2026-06-10-story-led-world-movement-design.md docs/superpowers/plans/2026-06-10-story-led-world-movement.md packages/studio/src/pages/story-world-state.ts packages/studio/src/pages/story-world-state.test.ts packages/studio/src/pages/StoryWorldLab.tsx
git commit -m "feat(studio): make story world lab chat first"
```
