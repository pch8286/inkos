# Story Progress Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current world-reaction-centered Story World Lab flow with a high-level Story Progress Console that proposes story movement first, keeps usable material separately, and generates scene drafts only through explicit user action.

**Architecture:** Add `StoryProgress`, `UsableMaterial`, and `SceneDraft` models to `@actalk/inkos-core`; add pure console prompt/parser/draft helpers; persist new lab artifacts in Studio API; then refactor the Studio page so the first workflow is Director Console -> Story Progress -> Usable Material -> explicit Scene Draft. Existing ticks, movement candidates, and scene contracts remain available as debug/compile layers but are no longer the primary product surface.

**Tech Stack:** TypeScript, Zod, Hono, Node `fs/promises`, React, Vitest, React Testing Library/source assertions, existing InkOS `chatCompletion` LLM provider.

---

## File Structure

- Modify `packages/core/src/models/story-world-lab.ts`
  - Add schemas and types for `StoryProgress`, `UsableMaterial`, `SceneDraft`, and related enums.
- Create `packages/core/src/agents/story-progress-console.ts`
  - Build Director Console prompts, parse model JSON, provide deterministic Korean fallback, build scene drafts from accepted progress, and render draft intent markdown.
- Modify `packages/core/src/index.ts`
  - Export new schemas, types, and helper functions.
- Modify `packages/core/src/__tests__/story-world-lab.test.ts`
  - Add schema and compile-gate tests.
- Create `packages/core/src/__tests__/story-progress-console.test.ts`
  - Add prompt/parser/fallback/scene-draft helper tests.
- Modify `packages/studio/src/shared/contracts.ts`
  - Add payload types and include `storyProgress`, `usableMaterial`, and `sceneDrafts` in `StoryWorldLabPayload`.
- Modify `packages/studio/src/api/server.ts`
  - Add persistence helpers and endpoints for `director-turns`, `story-progress`, `usable-material`, and `scene-drafts`.
- Modify `packages/studio/src/api/server.test.ts`
  - Add API coverage for Director Console, progress acceptance, material persistence, draft generation, compile gating, and truth-file immutability.
- Modify `packages/studio/src/pages/story-world-state.ts`
  - Add UI helpers for progress grouping, draft action availability, material grouping, and latest proposal selection.
- Modify `packages/studio/src/pages/story-world-state.test.ts`
  - Add pure helper tests.
- Modify `packages/studio/src/pages/StoryWorldLab.tsx`
  - Refactor primary UI to Story Progress Console. Keep movement candidates/ticks in a collapsed debug section.
- Modify `packages/studio/src/App.test.ts`
  - Add source-level regression tests that Story World Lab remains progress-first and scene drafting remains explicit.

---

## Task 1: Core Schemas

**Files:**
- Modify: `packages/core/src/models/story-world-lab.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/__tests__/story-world-lab.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add these imports to `packages/core/src/__tests__/story-world-lab.test.ts`:

```ts
import {
  SceneDraftSchema,
  StoryProgressSchema,
  UsableMaterialSchema,
} from "../index.js";
```

Add these tests inside `describe("story world lab", () => { ... })`:

```ts
it("parses story progress as high-level non-prose planning state", () => {
  const progress = StoryProgressSchema.parse({
    id: "progress-1",
    sourceTurnIds: ["turn-user-1", "turn-world-1"],
    summary: "주인공의 침묵은 도시의 불안을 키우고 소문이 통제 밖으로 움직이게 만든다.",
    rationale: ["침묵은 행동 부재가 아니라 압박을 키우는 선택으로 작동한다."],
    currentQuestion: "소문은 언제 주인공에게 되돌아오는가?",
    protagonistState: "침묵으로 버티지만 통제권을 잃기 시작함",
    pressureChange: "도시 여론이 공식 발표에서 멀어진다.",
    usableMaterialIds: ["material-rumor"],
    sceneWorthiness: "strong",
    status: "proposed",
    createdAt: now,
    updatedAt: now,
  });

  expect(progress.status).toBe("proposed");
  expect(progress.sceneWorthiness).toBe("strong");
});

it("parses usable material as a non-canonical working shelf item", () => {
  const material = UsableMaterialSchema.parse({
    id: "material-rumor",
    type: "clue_or_rumor",
    text: "도시의 소문이 공식 발표와 반대 방향으로 흐른다.",
    sourceIds: ["progress-1"],
    usableFor: ["다음 장면의 압박", "주인공 선택 유도"],
    risk: "medium",
    status: "available",
    createdAt: now,
    updatedAt: now,
  });

  expect(material.type).toBe("clue_or_rumor");
  expect(material.status).toBe("available");
});

it("parses scene drafts separately from canonical chapters", () => {
  const draft = SceneDraftSchema.parse({
    id: "draft-1",
    progressIds: ["progress-1"],
    materialIds: ["material-rumor"],
    title: "소문이 돌아오는 밤",
    sceneGoal: ["소문이 주인공에게 되돌아와 다음 선택을 압박한다."],
    prose: "골목은 평소보다 조용했다. 그러나 조용한 것은 안전하다는 뜻이 아니었다.",
    status: "draft",
    createdAt: now,
    updatedAt: now,
  });

  expect(draft.status).toBe("draft");
  expect(draft.progressIds).toEqual(["progress-1"]);
});
```

- [ ] **Step 2: Run schema tests to verify failure**

Run:

```bash
pnpm --filter @actalk/inkos-core exec vitest run src/__tests__/story-world-lab.test.ts -t "story progress|usable material|scene drafts"
```

Expected: FAIL because `StoryProgressSchema`, `UsableMaterialSchema`, and `SceneDraftSchema` are not exported.

- [ ] **Step 3: Add schemas**

In `packages/core/src/models/story-world-lab.ts`, insert these schemas after `LabChatTurnSchema`:

```ts
export const StoryProgressStatusSchema = z.enum(["proposed", "accepted", "held", "revised", "discarded"]);
export type StoryProgressStatus = z.infer<typeof StoryProgressStatusSchema>;

export const SceneWorthinessSchema = z.enum(["none", "possible", "strong"]);
export type SceneWorthiness = z.infer<typeof SceneWorthinessSchema>;

export const UsableMaterialTypeSchema = z.enum([
  "character_pressure",
  "relationship_tension",
  "world_fact",
  "active_hook",
  "location_detail",
  "emotional_state",
  "clue_or_rumor",
  "scene_seed",
  "style_note",
]);
export type UsableMaterialType = z.infer<typeof UsableMaterialTypeSchema>;

export const UsableMaterialStatusSchema = z.enum(["available", "used", "held", "discarded"]);
export type UsableMaterialStatus = z.infer<typeof UsableMaterialStatusSchema>;

export const SceneDraftStatusSchema = z.enum(["draft", "saved", "accepted", "rejected", "superseded"]);
export type SceneDraftStatus = z.infer<typeof SceneDraftStatusSchema>;

export const StoryProgressSchema = z.object({
  id: NonEmptyStringSchema,
  sourceTurnIds: z.array(NonEmptyStringSchema).default([]),
  summary: NonEmptyStringSchema,
  rationale: z.array(NonEmptyStringSchema).default([]),
  currentQuestion: NonEmptyStringSchema.optional(),
  protagonistState: NonEmptyStringSchema.optional(),
  pressureChange: NonEmptyStringSchema.optional(),
  usableMaterialIds: z.array(NonEmptyStringSchema).default([]),
  sceneWorthiness: SceneWorthinessSchema.default("possible"),
  status: StoryProgressStatusSchema.default("proposed"),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();
export type StoryProgress = z.infer<typeof StoryProgressSchema>;

export const UsableMaterialSchema = z.object({
  id: NonEmptyStringSchema,
  type: UsableMaterialTypeSchema,
  text: NonEmptyStringSchema,
  sourceIds: z.array(NonEmptyStringSchema).default([]),
  usableFor: z.array(NonEmptyStringSchema).default([]),
  risk: MovementRiskSchema.default("medium"),
  status: UsableMaterialStatusSchema.default("available"),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();
export type UsableMaterial = z.infer<typeof UsableMaterialSchema>;

export const SceneDraftSchema = z.object({
  id: NonEmptyStringSchema,
  progressIds: z.array(NonEmptyStringSchema).default([]),
  materialIds: z.array(NonEmptyStringSchema).default([]),
  title: NonEmptyStringSchema.optional(),
  sceneGoal: z.array(NonEmptyStringSchema).default([]),
  prose: NonEmptyStringSchema,
  status: SceneDraftStatusSchema.default("draft"),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();
export type SceneDraft = z.infer<typeof SceneDraftSchema>;
```

- [ ] **Step 4: Export schemas and types**

In `packages/core/src/index.ts`, add the new types to the story-world export block:

```ts
  type StoryProgressStatus,
  type SceneWorthiness,
  type UsableMaterialType,
  type UsableMaterialStatus,
  type SceneDraftStatus,
  type StoryProgress,
  type UsableMaterial,
  type SceneDraft,
```

Add the new schemas to the same export block:

```ts
  StoryProgressStatusSchema,
  SceneWorthinessSchema,
  UsableMaterialTypeSchema,
  UsableMaterialStatusSchema,
  SceneDraftStatusSchema,
  StoryProgressSchema,
  UsableMaterialSchema,
  SceneDraftSchema,
```

- [ ] **Step 5: Run schema tests to verify pass**

Run:

```bash
pnpm --filter @actalk/inkos-core exec vitest run src/__tests__/story-world-lab.test.ts -t "story progress|usable material|scene drafts"
```

Expected: PASS.

- [ ] **Step 6: Commit core schemas**

Run:

```bash
git add packages/core/src/models/story-world-lab.ts packages/core/src/index.ts packages/core/src/__tests__/story-world-lab.test.ts
git commit -m "feat(core): add story progress lab models"
```

---

## Task 2: Core Story Progress Console Helpers

**Files:**
- Create: `packages/core/src/agents/story-progress-console.ts`
- Create: `packages/core/src/__tests__/story-progress-console.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing helper tests**

Create `packages/core/src/__tests__/story-progress-console.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildStoryProgressConsolePrompt,
  createFallbackStoryProgressArtifacts,
  createSceneDraftFromProgress,
  parseStoryProgressConsoleResponse,
  renderSceneDraftIntentMarkdown,
} from "../index.js";

const now = "2026-06-11T00:00:00.000Z";

describe("story progress console helpers", () => {
  it("builds a Korean director prompt that asks for high-level progress, not prose", () => {
    const messages = buildStoryProgressConsolePrompt({
      language: "ko",
      userText: "주인공이 침묵하면 도시가 어떻게 흔들릴까?",
      storyBible: "# Story Bible\n도시는 소문으로 움직인다.",
      currentState: "# Current State\n주인공은 공식 발표를 거부했다.",
      pendingHooks: "# Pending Hooks\n소문의 출처가 불명확하다.",
      previousProgress: [],
    });

    const joined = messages.map((message) => message.content).join("\n");
    expect(joined).toContain("고수준 이야기 진행");
    expect(joined).toContain("전체 소설 장면 초고를 쓰지 마라");
    expect(joined).toContain("JSON");
  });

  it("parses structured director JSON into progress and usable material", () => {
    const parsed = parseStoryProgressConsoleResponse({
      rawContent: JSON.stringify({
        reply: "진행 제안: 주인공의 침묵은 도시의 불안을 키운다.",
        progress: {
          summary: "주인공의 침묵은 도시의 불안을 키우고 소문이 통제 밖으로 움직이게 만든다.",
          rationale: ["침묵은 행동 부재가 아니라 압박을 키우는 선택이다."],
          currentQuestion: "소문은 언제 주인공에게 되돌아오는가?",
          protagonistState: "침묵으로 버티지만 통제권을 잃기 시작함",
          pressureChange: "도시 여론이 공식 발표에서 멀어진다.",
          sceneWorthiness: "strong",
        },
        usableMaterial: [{
          type: "clue_or_rumor",
          text: "도시의 소문이 공식 발표와 반대 방향으로 흐른다.",
          usableFor: ["다음 장면의 압박"],
          risk: "medium",
        }],
      }),
      idPrefix: "demo",
      sourceTurnIds: ["turn-user-1", "turn-world-1"],
      createdAt: now,
    });

    expect(parsed.reply).toContain("진행 제안");
    expect(parsed.progress.summary).toContain("침묵");
    expect(parsed.usableMaterial).toHaveLength(1);
    expect(parsed.progress.usableMaterialIds).toEqual([parsed.usableMaterial[0]?.id]);
  });

  it("creates a Korean fallback progress proposal when model JSON is unavailable", () => {
    const fallback = createFallbackStoryProgressArtifacts({
      idPrefix: "fallback",
      sourceTurnIds: ["turn-user-1", "turn-world-1"],
      userText: "주인공이 침묵하자 도시가 조용히 반응한다.",
      createdAt: now,
      language: "ko",
    });

    expect(fallback.reply).toContain("진행 제안");
    expect(fallback.progress.summary).toContain("주인공이 침묵하자 도시가 조용히 반응한다.");
    expect(fallback.usableMaterial[0]?.type).toBe("scene_seed");
  });

  it("creates a scene draft only from accepted progress", () => {
    const draft = createSceneDraftFromProgress({
      id: "draft-1",
      progress: {
        id: "progress-1",
        sourceTurnIds: ["turn-user-1"],
        summary: "소문이 주인공에게 되돌아온다.",
        rationale: ["다음 압박으로 자연스럽다."],
        usableMaterialIds: ["material-1"],
        sceneWorthiness: "strong",
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      },
      usableMaterial: [{
        id: "material-1",
        type: "clue_or_rumor",
        text: "도시의 소문",
        sourceIds: ["progress-1"],
        usableFor: ["압박"],
        risk: "medium",
        status: "available",
        createdAt: now,
        updatedAt: now,
      }],
      createdAt: now,
      language: "ko",
    });

    expect(draft.sceneGoal).toEqual(["소문이 주인공에게 되돌아온다."]);
    expect(draft.prose).toContain("소문이 주인공에게 되돌아온다.");
  });

  it("rejects scene draft creation from proposed progress", () => {
    expect(() => createSceneDraftFromProgress({
      id: "draft-1",
      progress: {
        id: "progress-1",
        sourceTurnIds: [],
        summary: "아직 승인되지 않은 진행",
        rationale: [],
        usableMaterialIds: [],
        sceneWorthiness: "possible",
        status: "proposed",
        createdAt: now,
        updatedAt: now,
      },
      usableMaterial: [],
      createdAt: now,
      language: "ko",
    })).toThrow("accepted story progress");
  });

  it("renders accepted scene draft into runtime intent markdown", () => {
    const markdown = renderSceneDraftIntentMarkdown({
      id: "draft-1",
      progressIds: ["progress-1"],
      materialIds: ["material-1"],
      title: "소문이 돌아오는 밤",
      sceneGoal: ["소문이 주인공에게 되돌아와 다음 선택을 압박한다."],
      prose: "골목은 평소보다 조용했다.",
      status: "accepted",
      createdAt: now,
      updatedAt: now,
    });

    expect(markdown).toContain("## Goal");
    expect(markdown).toContain("소문이 주인공에게 되돌아와 다음 선택을 압박한다.");
    expect(markdown).toContain("## Draft Source");
    expect(markdown).toContain("골목은 평소보다 조용했다.");
  });
});
```

- [ ] **Step 2: Run helper tests to verify failure**

Run:

```bash
pnpm --filter @actalk/inkos-core exec vitest run src/__tests__/story-progress-console.test.ts
```

Expected: FAIL because helper functions do not exist.

- [ ] **Step 3: Create helper implementation**

Create `packages/core/src/agents/story-progress-console.ts`:

```ts
import type { LLMMessage } from "../llm/provider.js";
import {
  SceneDraftSchema,
  StoryProgressSchema,
  UsableMaterialSchema,
  type SceneDraft,
  type StoryProgress,
  type UsableMaterial,
  type UsableMaterialType,
} from "../models/story-world-lab.js";

export type StoryProgressConsoleLanguage = "ko" | "zh" | "en";

export interface BuildStoryProgressConsolePromptInput {
  readonly language: StoryProgressConsoleLanguage;
  readonly userText: string;
  readonly storyBible: string;
  readonly currentState: string;
  readonly pendingHooks: string;
  readonly previousProgress: ReadonlyArray<StoryProgress>;
}

export interface ParsedStoryProgressConsoleResponse {
  readonly reply: string;
  readonly progress: StoryProgress;
  readonly usableMaterial: UsableMaterial[];
}

export function buildStoryProgressConsolePrompt(input: BuildStoryProgressConsolePromptInput): LLMMessage[] {
  const languageInstruction = input.language === "ko"
    ? "한국어로 답하라. 고수준 이야기 진행을 제안하라. 전체 소설 장면 초고를 쓰지 마라."
    : input.language === "zh"
      ? "用中文回答。提出高层故事进展，不要写完整小说场景草稿。"
      : "Answer in English. Propose high-level story progress. Do not write a full prose scene draft.";
  const previous = input.previousProgress
    .slice(-5)
    .map((progress) => `- ${progress.summary}`)
    .join("\n") || "- none";

  return [
    {
      role: "system",
      content: [
        "You are InkOS Story Progress Console.",
        languageInstruction,
        "Return strict JSON only. Do not wrap it in Markdown.",
        "Schema:",
        JSON.stringify({
          reply: "short director-facing response",
          progress: {
            summary: "high-level story movement",
            rationale: ["why this follows from current context"],
            currentQuestion: "optional current story question",
            protagonistState: "optional protagonist state",
            pressureChange: "optional pressure change",
            sceneWorthiness: "none | possible | strong",
          },
          usableMaterial: [{
            type: "character_pressure | relationship_tension | world_fact | active_hook | location_detail | emotional_state | clue_or_rumor | scene_seed | style_note",
            text: "usable material text",
            usableFor: ["specific future use"],
            risk: "low | medium | high",
          }],
        }),
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "## Story Bible",
        input.storyBible || "none",
        "",
        "## Current State",
        input.currentState || "none",
        "",
        "## Pending Hooks",
        input.pendingHooks || "none",
        "",
        "## Previous Story Progress",
        previous,
        "",
        "## User Direction",
        input.userText,
      ].join("\n"),
    },
  ];
}

export function parseStoryProgressConsoleResponse(input: {
  readonly rawContent: string;
  readonly idPrefix: string;
  readonly sourceTurnIds: ReadonlyArray<string>;
  readonly createdAt: string;
}): ParsedStoryProgressConsoleResponse {
  const parsed = JSON.parse(stripJsonFence(input.rawContent)) as {
    reply?: unknown;
    progress?: Record<string, unknown>;
    usableMaterial?: unknown;
  };
  const materialInputs = Array.isArray(parsed.usableMaterial) ? parsed.usableMaterial : [];
  const usableMaterial = materialInputs.map((item, index) => {
    const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    return UsableMaterialSchema.parse({
      id: `${input.idPrefix}-material-${String(index + 1).padStart(2, "0")}`,
      type: normalizeMaterialType(record.type),
      text: typeof record.text === "string" ? record.text : "사용 가능한 이야기 재료",
      sourceIds: [...input.sourceTurnIds],
      usableFor: Array.isArray(record.usableFor) ? record.usableFor : [],
      risk: record.risk,
      status: "available",
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  });
  const progressRecord = typeof parsed.progress === "object" && parsed.progress !== null ? parsed.progress : {};
  const progress = StoryProgressSchema.parse({
    id: `${input.idPrefix}-progress`,
    sourceTurnIds: [...input.sourceTurnIds],
    summary: typeof progressRecord.summary === "string" ? progressRecord.summary : "이야기 진행이 제안되었다.",
    rationale: Array.isArray(progressRecord.rationale) ? progressRecord.rationale : [],
    currentQuestion: typeof progressRecord.currentQuestion === "string" ? progressRecord.currentQuestion : undefined,
    protagonistState: typeof progressRecord.protagonistState === "string" ? progressRecord.protagonistState : undefined,
    pressureChange: typeof progressRecord.pressureChange === "string" ? progressRecord.pressureChange : undefined,
    usableMaterialIds: usableMaterial.map((material) => material.id),
    sceneWorthiness: progressRecord.sceneWorthiness,
    status: "proposed",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  return {
    reply: typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : `진행 제안: ${progress.summary}`,
    progress,
    usableMaterial,
  };
}

export function createFallbackStoryProgressArtifacts(input: {
  readonly idPrefix: string;
  readonly sourceTurnIds: ReadonlyArray<string>;
  readonly userText: string;
  readonly createdAt: string;
  readonly language: StoryProgressConsoleLanguage;
}): ParsedStoryProgressConsoleResponse {
  const korean = input.language === "ko" || /[가-힣]/.test(input.userText);
  const summary = korean
    ? `${input.userText} 이 진행은 다음 장면의 압박과 선택지를 만든다.`
    : `${input.userText} This direction creates pressure and a next-scene choice.`;
  const material = UsableMaterialSchema.parse({
    id: `${input.idPrefix}-material-01`,
    type: "scene_seed",
    text: input.userText,
    sourceIds: [...input.sourceTurnIds],
    usableFor: korean ? ["다음 장면의 씨앗"] : ["next scene seed"],
    risk: "low",
    status: "available",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  const progress = StoryProgressSchema.parse({
    id: `${input.idPrefix}-progress`,
    sourceTurnIds: [...input.sourceTurnIds],
    summary,
    rationale: korean ? ["사용자 방향에서 직접 나온 진행이다."] : ["This follows directly from the user's direction."],
    usableMaterialIds: [material.id],
    sceneWorthiness: "possible",
    status: "proposed",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  return {
    reply: korean ? `진행 제안: ${summary}` : `Progress proposal: ${summary}`,
    progress,
    usableMaterial: [material],
  };
}

export function createSceneDraftFromProgress(input: {
  readonly id: string;
  readonly progress: StoryProgress;
  readonly usableMaterial: ReadonlyArray<UsableMaterial>;
  readonly createdAt: string;
  readonly language: StoryProgressConsoleLanguage;
}): SceneDraft {
  if (input.progress.status !== "accepted") {
    throw new Error("Scene draft generation requires accepted story progress.");
  }
  const korean = input.language === "ko" || /[가-힣]/.test(input.progress.summary);
  const materialLines = input.usableMaterial.map((material) => `- ${material.text}`).join("\n");
  return SceneDraftSchema.parse({
    id: input.id,
    progressIds: [input.progress.id],
    materialIds: input.usableMaterial.map((material) => material.id),
    title: korean ? "진행 기반 장면 초안" : "Progress-based scene draft",
    sceneGoal: [input.progress.summary],
    prose: korean
      ? [`[장면 초안]`, input.progress.summary, materialLines].filter(Boolean).join("\n")
      : [`[Scene Draft]`, input.progress.summary, materialLines].filter(Boolean).join("\n"),
    status: "draft",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function renderSceneDraftIntentMarkdown(draft: SceneDraft): string {
  if (draft.status !== "accepted") {
    throw new Error("Only accepted scene drafts can compile into runtime intent.");
  }
  return [
    "## Goal",
    draft.sceneGoal.join(" ") || "Advance the accepted scene draft.",
    "",
    "## Outline Node",
    draft.title ?? "Accepted scene draft",
    "",
    "## Must Keep",
    draft.sceneGoal.map((goal) => `- ${goal}`).join("\n") || "- none",
    "",
    "## Draft Source",
    draft.prose,
    "",
  ].join("\n");
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeMaterialType(value: unknown): UsableMaterialType {
  const allowed: ReadonlyArray<UsableMaterialType> = [
    "character_pressure",
    "relationship_tension",
    "world_fact",
    "active_hook",
    "location_detail",
    "emotional_state",
    "clue_or_rumor",
    "scene_seed",
    "style_note",
  ];
  return typeof value === "string" && allowed.includes(value as UsableMaterialType)
    ? value as UsableMaterialType
    : "scene_seed";
}
```

- [ ] **Step 4: Export helper functions**

In `packages/core/src/index.ts`, add:

```ts
export {
  buildStoryProgressConsolePrompt,
  createFallbackStoryProgressArtifacts,
  createSceneDraftFromProgress,
  parseStoryProgressConsoleResponse,
  renderSceneDraftIntentMarkdown,
  type BuildStoryProgressConsolePromptInput,
  type ParsedStoryProgressConsoleResponse,
  type StoryProgressConsoleLanguage,
} from "./agents/story-progress-console.js";
```

- [ ] **Step 5: Run helper tests to verify pass**

Run:

```bash
pnpm --filter @actalk/inkos-core exec vitest run src/__tests__/story-progress-console.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit console helpers**

Run:

```bash
git add packages/core/src/agents/story-progress-console.ts packages/core/src/__tests__/story-progress-console.test.ts packages/core/src/index.ts
git commit -m "feat(core): add story progress console helpers"
```

---

## Task 3: Studio Contracts And UI State Helpers

**Files:**
- Modify: `packages/studio/src/shared/contracts.ts`
- Modify: `packages/studio/src/pages/story-world-state.ts`
- Modify: `packages/studio/src/pages/story-world-state.test.ts`

- [ ] **Step 1: Write failing UI state tests**

Add these imports to `packages/studio/src/pages/story-world-state.test.ts`:

```ts
import {
  canCreateSceneDraft,
  groupUsableMaterial,
  latestStoryProgressProposal,
} from "./story-world-state";
import type { StoryProgressPayload, UsableMaterialPayload } from "../shared/contracts";
```

Add these helper fixtures above `describe("story world state helpers", () => { ... })`:

```ts
const progress = (
  id: string,
  status: StoryProgressPayload["status"],
  updatedAt = "2026-06-11T00:00:00.000Z",
): StoryProgressPayload => ({
  id,
  sourceTurnIds: ["turn-1"],
  summary: `progress ${id}`,
  rationale: [],
  usableMaterialIds: [],
  sceneWorthiness: "possible",
  status,
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt,
});

const material = (
  id: string,
  type: UsableMaterialPayload["type"],
): UsableMaterialPayload => ({
  id,
  type,
  text: `material ${id}`,
  sourceIds: [],
  usableFor: [],
  risk: "low",
  status: "available",
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z",
});
```

Add these tests:

```ts
it("selects the latest proposed story progress", () => {
  expect(latestStoryProgressProposal([
    progress("old", "proposed", "2026-06-11T00:00:00.000Z"),
    progress("accepted", "accepted", "2026-06-11T00:02:00.000Z"),
    progress("new", "proposed", "2026-06-11T00:03:00.000Z"),
  ])?.id).toBe("new");
});

it("allows scene drafts only from accepted story progress", () => {
  expect(canCreateSceneDraft(progress("p1", "accepted"))).toBe(true);
  expect(canCreateSceneDraft(progress("p2", "proposed"))).toBe(false);
  expect(canCreateSceneDraft(null)).toBe(false);
});

it("groups usable material by type", () => {
  expect(groupUsableMaterial([
    material("rumor", "clue_or_rumor"),
    material("seed", "scene_seed"),
    material("hook", "active_hook"),
  ])).toMatchObject({
    clue_or_rumor: [material("rumor", "clue_or_rumor")],
    scene_seed: [material("seed", "scene_seed")],
    active_hook: [material("hook", "active_hook")],
  });
});
```

- [ ] **Step 2: Run UI state tests to verify failure**

Run:

```bash
pnpm --filter @actalk/inkos-studio exec vitest run src/pages/story-world-state.test.ts
```

Expected: FAIL because new payload types and helper functions are missing.

- [ ] **Step 3: Add Studio payload contracts**

In `packages/studio/src/shared/contracts.ts`, add these types near the Story World Lab section:

```ts
export type StoryProgressStatusPayload = "proposed" | "accepted" | "held" | "revised" | "discarded";
export type SceneWorthinessPayload = "none" | "possible" | "strong";
export type UsableMaterialTypePayload =
  | "character_pressure"
  | "relationship_tension"
  | "world_fact"
  | "active_hook"
  | "location_detail"
  | "emotional_state"
  | "clue_or_rumor"
  | "scene_seed"
  | "style_note";
export type UsableMaterialStatusPayload = "available" | "used" | "held" | "discarded";
export type SceneDraftStatusPayload = "draft" | "saved" | "accepted" | "rejected" | "superseded";

export interface StoryProgressPayload {
  readonly id: string;
  readonly sourceTurnIds: ReadonlyArray<string>;
  readonly summary: string;
  readonly rationale: ReadonlyArray<string>;
  readonly currentQuestion?: string;
  readonly protagonistState?: string;
  readonly pressureChange?: string;
  readonly usableMaterialIds: ReadonlyArray<string>;
  readonly sceneWorthiness: SceneWorthinessPayload;
  readonly status: StoryProgressStatusPayload;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UsableMaterialPayload {
  readonly id: string;
  readonly type: UsableMaterialTypePayload;
  readonly text: string;
  readonly sourceIds: ReadonlyArray<string>;
  readonly usableFor: ReadonlyArray<string>;
  readonly risk: MovementRiskPayload;
  readonly status: UsableMaterialStatusPayload;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SceneDraftPayload {
  readonly id: string;
  readonly progressIds: ReadonlyArray<string>;
  readonly materialIds: ReadonlyArray<string>;
  readonly title?: string;
  readonly sceneGoal: ReadonlyArray<string>;
  readonly prose: string;
  readonly status: SceneDraftStatusPayload;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

Add these fields to `StoryWorldLabPayload`:

```ts
  readonly storyProgress: ReadonlyArray<StoryProgressPayload>;
  readonly usableMaterial: ReadonlyArray<UsableMaterialPayload>;
  readonly sceneDrafts: ReadonlyArray<SceneDraftPayload>;
```

- [ ] **Step 4: Add UI state helpers**

In `packages/studio/src/pages/story-world-state.ts`, import the new types:

```ts
import type {
  StoryProgressPayload,
  UsableMaterialPayload,
  UsableMaterialTypePayload,
} from "../shared/contracts";
```

Add:

```ts
export function latestStoryProgressProposal(
  progress: ReadonlyArray<StoryProgressPayload>,
): StoryProgressPayload | null {
  return [...progress]
    .filter((entry) => entry.status === "proposed")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

export function canCreateSceneDraft(progress: StoryProgressPayload | null): boolean {
  return progress?.status === "accepted";
}

export function groupUsableMaterial(
  materials: ReadonlyArray<UsableMaterialPayload>,
): Record<UsableMaterialTypePayload, UsableMaterialPayload[]> {
  const grouped: Record<UsableMaterialTypePayload, UsableMaterialPayload[]> = {
    character_pressure: [],
    relationship_tension: [],
    world_fact: [],
    active_hook: [],
    location_detail: [],
    emotional_state: [],
    clue_or_rumor: [],
    scene_seed: [],
    style_note: [],
  };
  for (const material of materials) {
    grouped[material.type].push(material);
  }
  return grouped;
}
```

- [ ] **Step 5: Run UI state tests to verify pass**

Run:

```bash
pnpm --filter @actalk/inkos-studio exec vitest run src/pages/story-world-state.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit contracts and helpers**

Run:

```bash
git add packages/studio/src/shared/contracts.ts packages/studio/src/pages/story-world-state.ts packages/studio/src/pages/story-world-state.test.ts
git commit -m "feat(studio): add story progress UI contracts"
```

---

## Task 4: Studio API Persistence

**Files:**
- Modify: `packages/studio/src/api/server.ts`
- Modify: `packages/studio/src/api/server.test.ts`

- [ ] **Step 1: Write failing persistence API test**

Add a test after the existing Story World Lab tests in `packages/studio/src/api/server.test.ts`:

```ts
it("includes Story Progress Console stores in the lab payload", async () => {
  const bookId = "lab-progress-payload";
  await seedStoryWorldLabBook(root, bookId);
  const labDir = join(root, "books", bookId, "story", "lab");
  await mkdir(join(labDir, "scene_drafts"), { recursive: true });
  await writeFile(join(labDir, "story_progress.json"), JSON.stringify([{
    id: "progress-1",
    sourceTurnIds: ["turn-1"],
    summary: "주인공의 침묵이 도시의 불안을 키운다.",
    rationale: ["다음 장면 압박으로 자연스럽다."],
    usableMaterialIds: ["material-1"],
    sceneWorthiness: "strong",
    status: "proposed",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
  }]), "utf-8");
  await writeFile(join(labDir, "usable_material.json"), JSON.stringify([{
    id: "material-1",
    type: "clue_or_rumor",
    text: "도시의 소문",
    sourceIds: ["progress-1"],
    usableFor: ["다음 장면 압박"],
    risk: "medium",
    status: "available",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
  }]), "utf-8");
  await writeFile(join(labDir, "scene_drafts", "draft-1.json"), JSON.stringify({
    id: "draft-1",
    progressIds: ["progress-1"],
    materialIds: ["material-1"],
    title: "소문이 돌아오는 밤",
    sceneGoal: ["소문이 주인공에게 되돌아온다."],
    prose: "골목은 조용했다.",
    status: "draft",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
  }), "utf-8");
  const { createStudioServer } = await import("./server.js");
  const app = createStudioServer(cloneProjectConfig() as never, root);

  const response = await app.request(`http://localhost/api/books/${bookId}/lab`);

  expect(response.status).toBe(200);
  const payload = await response.json() as {
    storyProgress: unknown[];
    usableMaterial: unknown[];
    sceneDrafts: unknown[];
  };
  expect(payload.storyProgress).toHaveLength(1);
  expect(payload.usableMaterial).toHaveLength(1);
  expect(payload.sceneDrafts).toHaveLength(1);
});
```

- [ ] **Step 2: Run persistence test to verify failure**

Run:

```bash
pnpm --filter @actalk/inkos-studio exec vitest run src/api/server.test.ts -t "includes Story Progress Console stores"
```

Expected: FAIL because `GET /lab` does not return the new stores.

- [ ] **Step 3: Import core schemas and types**

In `packages/studio/src/api/server.ts`, add to the `@actalk/inkos-core` import:

```ts
  SceneDraftSchema,
  StoryProgressSchema,
  UsableMaterialSchema,
  type SceneDraft,
  type StoryProgress,
  type UsableMaterial,
```

Also update the test mock in `packages/studio/src/api/server.test.ts` to expose passthrough schemas:

```ts
    SceneDraftSchema: passthroughSchema,
    StoryProgressSchema: passthroughSchema,
    UsableMaterialSchema: passthroughSchema,
```

- [ ] **Step 4: Add persistence helpers**

In `packages/studio/src/api/server.ts`, near existing Story World persistence helpers, add:

```ts
async function readStoryProgress(root: string, bookId: string): Promise<StoryProgress[]> {
  const values = await readJsonFile<unknown[]>(join(storyWorldLabDir(root, bookId), "story_progress.json"), []);
  return values.map((value) => StoryProgressSchema.parse(value));
}

async function writeStoryProgress(root: string, bookId: string, progress: ReadonlyArray<StoryProgress>): Promise<void> {
  await writeJsonFile(join(storyWorldLabDir(root, bookId), "story_progress.json"), progress);
}

async function readUsableMaterial(root: string, bookId: string): Promise<UsableMaterial[]> {
  const values = await readJsonFile<unknown[]>(join(storyWorldLabDir(root, bookId), "usable_material.json"), []);
  return values.map((value) => UsableMaterialSchema.parse(value));
}

async function writeUsableMaterial(root: string, bookId: string, materials: ReadonlyArray<UsableMaterial>): Promise<void> {
  await writeJsonFile(join(storyWorldLabDir(root, bookId), "usable_material.json"), materials);
}

async function readSceneDrafts(root: string, bookId: string): Promise<SceneDraft[]> {
  const draftsDir = join(storyWorldLabDir(root, bookId), "scene_drafts");
  const files = await readdir(draftsDir).catch(() => []);
  const drafts = await Promise.all(files
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map(async (file) => SceneDraftSchema.parse(
      JSON.parse(await readFile(join(draftsDir, file), "utf-8")),
    )));
  return drafts;
}

async function writeSceneDraft(root: string, bookId: string, draft: SceneDraft): Promise<void> {
  await writeJsonFile(join(storyWorldLabDir(root, bookId), "scene_drafts", `${draft.id}.json`), draft);
}
```

- [ ] **Step 5: Include stores in lab payload**

In `GET /api/books/:id/lab`, add:

```ts
      storyProgress: await readStoryProgress(root, id),
      usableMaterial: await readUsableMaterial(root, id),
      sceneDrafts: await readSceneDrafts(root, id),
```

- [ ] **Step 6: Run persistence test to verify pass**

Run:

```bash
pnpm --filter @actalk/inkos-studio exec vitest run src/api/server.test.ts -t "includes Story Progress Console stores"
```

Expected: PASS.

- [ ] **Step 7: Commit API persistence**

Run:

```bash
git add packages/studio/src/api/server.ts packages/studio/src/api/server.test.ts
git commit -m "feat(studio): persist story progress console stores"
```

---

## Task 5: Director Turns And Progress Decisions API

**Files:**
- Modify: `packages/studio/src/api/server.ts`
- Modify: `packages/studio/src/api/server.test.ts`

- [ ] **Step 1: Write failing director-turn API test**

Add:

```ts
it("creates a director turn with proposed story progress and usable material", async () => {
  const bookId = "lab-director-turn";
  await seedStoryWorldLabBook(root, bookId);
  chatCompletionMock.mockResolvedValueOnce({
    content: JSON.stringify({
      reply: "진행 제안: 침묵은 도시의 소문을 흔든다.",
      progress: {
        summary: "주인공의 침묵은 도시의 불안을 키우고 소문이 통제 밖으로 움직이게 만든다.",
        rationale: ["침묵이 사건 회피가 아니라 압박을 키우는 선택으로 작동한다."],
        currentQuestion: "소문은 언제 주인공에게 되돌아오는가?",
        protagonistState: "침묵으로 버티지만 통제권을 잃기 시작함",
        pressureChange: "도시 여론이 공식 발표에서 멀어진다.",
        sceneWorthiness: "strong",
      },
      usableMaterial: [{
        type: "clue_or_rumor",
        text: "도시의 소문이 공식 발표와 반대 방향으로 흐른다.",
        usableFor: ["다음 장면의 압박"],
        risk: "medium",
      }],
    }),
  });
  const { createStudioServer } = await import("./server.js");
  const app = createStudioServer(cloneProjectConfig() as never, root);

  const response = await app.request(`http://localhost/api/books/${bookId}/lab/director-turns`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ text: "주인공이 침묵하면 도시가 어떻게 흔들릴까?" }),
  });

  const responseText = await response.clone().text();
  expect(response.status, responseText).toBe(200);
  const payload = await response.json() as {
    userTurn: { role: string; text: string };
    directorTurn: { role: string; text: string };
    storyProgress: { status: string; summary: string };
    usableMaterial: Array<{ type: string; text: string }>;
    chatTurns: unknown[];
  };
  expect(payload.userTurn).toMatchObject({ role: "user", text: "주인공이 침묵하면 도시가 어떻게 흔들릴까?" });
  expect(payload.directorTurn).toMatchObject({ role: "world", text: "진행 제안: 침묵은 도시의 소문을 흔든다." });
  expect(payload.storyProgress).toMatchObject({
    status: "proposed",
    summary: "주인공의 침묵은 도시의 불안을 키우고 소문이 통제 밖으로 움직이게 만든다.",
  });
  expect(payload.usableMaterial[0]).toMatchObject({
    type: "clue_or_rumor",
    text: "도시의 소문이 공식 발표와 반대 방향으로 흐른다.",
  });
  expect(payload.chatTurns).toHaveLength(2);

  const labResponse = await app.request(`http://localhost/api/books/${bookId}/lab`);
  const lab = await labResponse.json() as { storyProgress: unknown[]; usableMaterial: unknown[] };
  expect(lab.storyProgress).toHaveLength(1);
  expect(lab.usableMaterial).toHaveLength(1);
});
```

- [ ] **Step 2: Write failing progress decision test**

Add:

```ts
it("accepts story progress without mutating truth files", async () => {
  const bookId = "lab-progress-accept";
  const truthFiles = await seedStoryWorldLabBook(root, bookId);
  const labDir = join(root, "books", bookId, "story", "lab");
  await mkdir(labDir, { recursive: true });
  await writeFile(join(labDir, "story_progress.json"), JSON.stringify([{
    id: "progress-1",
    sourceTurnIds: ["turn-1"],
    summary: "소문이 주인공에게 되돌아온다.",
    rationale: [],
    usableMaterialIds: [],
    sceneWorthiness: "strong",
    status: "proposed",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
  }]), "utf-8");
  const { createStudioServer } = await import("./server.js");
  const app = createStudioServer(cloneProjectConfig() as never, root);

  const response = await app.request(`http://localhost/api/books/${bookId}/lab/story-progress/progress-1`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ status: "accepted" }),
  });

  expect(response.status).toBe(200);
  const payload = await response.json() as { storyProgress: { status: string } };
  expect(payload.storyProgress.status).toBe("accepted");
  await expect(readTruthFiles(root, bookId, truthFiles)).resolves.toEqual(truthFiles);
});
```

- [ ] **Step 3: Run director API tests to verify failure**

Run:

```bash
pnpm --filter @actalk/inkos-studio exec vitest run src/api/server.test.ts -t "director turn|accepts story progress"
```

Expected: FAIL because endpoints do not exist.

- [ ] **Step 4: Import console helpers**

In `packages/studio/src/api/server.ts`, add to the `@actalk/inkos-core` import:

```ts
  buildStoryProgressConsolePrompt,
  createFallbackStoryProgressArtifacts,
  parseStoryProgressConsoleResponse,
```

- [ ] **Step 5: Add director endpoint**

Add this route before `/lab/chat-turns`:

```ts
  app.post("/api/books/:id/lab/director-turns", async (c) => {
    const id = c.req.param("id");
    await assertLabBookExists(id);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      throw new ApiError(400, "DIRECTOR_TEXT_REQUIRED", "Director text is required.");
    }

    const book = await state.loadBookConfig(id);
    const language = isStudioLanguage(book.language) ? book.language : "ko";
    const now = new Date().toISOString();
    const userTurn = LabChatTurnSchema.parse({
      id: `turn-${randomUUID()}`,
      role: "user",
      text,
      createdAt: now,
    });
    const directorTurnId = `turn-${randomUUID()}`;
    const idPrefix = `director-${randomUUID()}`;
    const bookDir = state.bookDir(id);
    const readStoryFile = async (file: string): Promise<string> => {
      return await readFile(join(bookDir, "story", file), "utf-8").catch(() => "");
    };
    const currentConfig = await loadCurrentProjectConfig();
    const client = createLLMClient({
      ...currentConfig.llm,
      extra: { ...(currentConfig.llm.extra ?? {}), projectRoot: root },
    });
    const { chatCompletion } = await import("@actalk/inkos-core");
    let artifacts;
    try {
      const response = await chatCompletion(client, currentConfig.llm.model, buildStoryProgressConsolePrompt({
        language,
        userText: text,
        storyBible: await readStoryFile("story_bible.md"),
        currentState: await readStoryFile("current_state.md"),
        pendingHooks: await readStoryFile("pending_hooks.md"),
        previousProgress: await readStoryProgress(root, id),
      }));
      artifacts = parseStoryProgressConsoleResponse({
        rawContent: response.content,
        idPrefix,
        sourceTurnIds: [userTurn.id, directorTurnId],
        createdAt: now,
      });
    } catch {
      artifacts = createFallbackStoryProgressArtifacts({
        idPrefix,
        sourceTurnIds: [userTurn.id, directorTurnId],
        userText: text,
        createdAt: now,
        language,
      });
    }

    const directorTurn = LabChatTurnSchema.parse({
      id: directorTurnId,
      role: "world",
      text: artifacts.reply,
      createdAt: now,
    });
    const chatTurns = [...await readLabChatTurns(root, id), userTurn, directorTurn];
    const storyProgress = [...await readStoryProgress(root, id), artifacts.progress];
    const usableMaterial = [...await readUsableMaterial(root, id), ...artifacts.usableMaterial];
    await writeLabChatTurns(root, id, chatTurns);
    await writeStoryProgress(root, id, storyProgress);
    await writeUsableMaterial(root, id, usableMaterial);

    return c.json({
      userTurn,
      directorTurn,
      storyProgress: artifacts.progress,
      usableMaterial: artifacts.usableMaterial,
      chatTurns,
    });
  });
```

- [ ] **Step 6: Add story progress PATCH endpoint**

Add:

```ts
  app.patch("/api/books/:id/lab/story-progress/:progressId", async (c) => {
    const id = c.req.param("id");
    await assertLabBookExists(id);
    const progressId = c.req.param("progressId");
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const progressEntries = await readStoryProgress(root, id);
    const existing = progressEntries.find((entry) => entry.id === progressId);
    if (!existing) {
      throw new ApiError(404, "STORY_PROGRESS_NOT_FOUND", `Story progress "${progressId}" not found.`);
    }
    const updated = StoryProgressSchema.parse({
      ...existing,
      ...(typeof body.status === "string" ? { status: body.status } : {}),
      ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
      updatedAt: new Date().toISOString(),
    });
    const next = progressEntries.map((entry) => entry.id === progressId ? updated : entry);
    await writeStoryProgress(root, id, next);
    return c.json({ storyProgress: updated, storyProgressList: next });
  });
```

- [ ] **Step 7: Run director API tests to verify pass**

Run:

```bash
pnpm --filter @actalk/inkos-studio exec vitest run src/api/server.test.ts -t "director turn|accepts story progress"
```

Expected: PASS.

- [ ] **Step 8: Commit director API**

Run:

```bash
git add packages/studio/src/api/server.ts packages/studio/src/api/server.test.ts
git commit -m "feat(studio): add story progress director API"
```

---

## Task 6: Scene Draft API And Compile Gate

**Files:**
- Modify: `packages/studio/src/api/server.ts`
- Modify: `packages/studio/src/api/server.test.ts`

- [ ] **Step 1: Write failing scene draft API test**

Add:

```ts
it("creates scene drafts only from accepted story progress and keeps chapter text untouched", async () => {
  const bookId = "lab-scene-draft";
  const truthFiles = await seedStoryWorldLabBook(root, bookId);
  const labDir = join(root, "books", bookId, "story", "lab");
  await mkdir(labDir, { recursive: true });
  await writeFile(join(labDir, "story_progress.json"), JSON.stringify([{
    id: "progress-1",
    sourceTurnIds: ["turn-1"],
    summary: "소문이 주인공에게 되돌아온다.",
    rationale: ["다음 장면 압박으로 자연스럽다."],
    usableMaterialIds: ["material-1"],
    sceneWorthiness: "strong",
    status: "accepted",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
  }]), "utf-8");
  await writeFile(join(labDir, "usable_material.json"), JSON.stringify([{
    id: "material-1",
    type: "clue_or_rumor",
    text: "도시의 소문",
    sourceIds: ["progress-1"],
    usableFor: ["압박"],
    risk: "medium",
    status: "available",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
  }]), "utf-8");
  const { createStudioServer } = await import("./server.js");
  const app = createStudioServer(cloneProjectConfig() as never, root);

  const response = await app.request(`http://localhost/api/books/${bookId}/lab/scene-drafts`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ progressId: "progress-1" }),
  });

  expect(response.status).toBe(200);
  const payload = await response.json() as { sceneDraft: { id: string; status: string; prose: string } };
  expect(payload.sceneDraft.status).toBe("draft");
  expect(payload.sceneDraft.prose).toContain("소문이 주인공에게 되돌아온다.");
  await expect(readTruthFiles(root, bookId, truthFiles)).resolves.toEqual(truthFiles);
});

it("blocks scene draft generation from unaccepted progress", async () => {
  const bookId = "lab-scene-draft-block";
  await seedStoryWorldLabBook(root, bookId);
  const labDir = join(root, "books", bookId, "story", "lab");
  await mkdir(labDir, { recursive: true });
  await writeFile(join(labDir, "story_progress.json"), JSON.stringify([{
    id: "progress-1",
    sourceTurnIds: [],
    summary: "아직 승인되지 않은 진행",
    rationale: [],
    usableMaterialIds: [],
    sceneWorthiness: "possible",
    status: "proposed",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
  }]), "utf-8");
  const { createStudioServer } = await import("./server.js");
  const app = createStudioServer(cloneProjectConfig() as never, root);

  const response = await app.request(`http://localhost/api/books/${bookId}/lab/scene-drafts`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ progressId: "progress-1" }),
  });

  expect(response.status).toBe(409);
  await expect(response.text()).resolves.toContain("SCENE_DRAFT_PROGRESS_NOT_ACCEPTED");
});
```

- [ ] **Step 2: Write failing scene draft compile test**

Add:

```ts
it("compiles only accepted scene drafts into runtime intent", async () => {
  const bookId = "lab-scene-draft-compile";
  await seedStoryWorldLabBook(root, bookId);
  const labDir = join(root, "books", bookId, "story", "lab");
  await mkdir(join(labDir, "scene_drafts"), { recursive: true });
  await writeFile(join(labDir, "scene_drafts", "draft-1.json"), JSON.stringify({
    id: "draft-1",
    progressIds: ["progress-1"],
    materialIds: ["material-1"],
    title: "소문이 돌아오는 밤",
    sceneGoal: ["소문이 주인공에게 되돌아온다."],
    prose: "골목은 조용했다.",
    status: "accepted",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
  }), "utf-8");
  const { createStudioServer } = await import("./server.js");
  const app = createStudioServer(cloneProjectConfig() as never, root);

  const response = await app.request(`http://localhost/api/books/${bookId}/lab/scene-drafts/draft-1/compile`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ chapter: 4 }),
  });

  expect(response.status).toBe(200);
  const payload = await response.json() as { runtimePath: string; intentMarkdown: string };
  expect(payload.runtimePath).toBe("story/runtime/chapter-0004.intent.md");
  expect(payload.intentMarkdown).toContain("소문이 주인공에게 되돌아온다.");
});
```

- [ ] **Step 3: Run scene draft tests to verify failure**

Run:

```bash
pnpm --filter @actalk/inkos-studio exec vitest run src/api/server.test.ts -t "scene draft"
```

Expected: FAIL because scene draft endpoints do not exist.

- [ ] **Step 4: Import scene draft helpers**

In `packages/studio/src/api/server.ts`, add to the `@actalk/inkos-core` import:

```ts
  createSceneDraftFromProgress,
  renderSceneDraftIntentMarkdown,
```

- [ ] **Step 5: Add scene draft POST endpoint**

Add:

```ts
  app.post("/api/books/:id/lab/scene-drafts", async (c) => {
    const id = c.req.param("id");
    await assertLabBookExists(id);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const progressId = typeof body.progressId === "string" ? body.progressId : "";
    const progress = (await readStoryProgress(root, id)).find((entry) => entry.id === progressId);
    if (!progress) {
      throw new ApiError(404, "STORY_PROGRESS_NOT_FOUND", `Story progress "${progressId}" not found.`);
    }
    if (progress.status !== "accepted") {
      throw new ApiError(409, "SCENE_DRAFT_PROGRESS_NOT_ACCEPTED", "Scene draft generation requires accepted story progress.");
    }
    const materialById = new Map((await readUsableMaterial(root, id)).map((material) => [material.id, material]));
    const selectedMaterial = progress.usableMaterialIds
      .map((materialId) => materialById.get(materialId))
      .filter((material): material is UsableMaterial => Boolean(material));
    const book = await state.loadBookConfig(id);
    const language = isStudioLanguage(book.language) ? book.language : "ko";
    const now = new Date().toISOString();
    const sceneDraft = createSceneDraftFromProgress({
      id: `draft-${randomUUID()}`,
      progress,
      usableMaterial: selectedMaterial,
      createdAt: now,
      language,
    });
    await writeSceneDraft(root, id, sceneDraft);
    return c.json({ sceneDraft, sceneDrafts: await readSceneDrafts(root, id) });
  });
```

- [ ] **Step 6: Add scene draft PATCH endpoint**

Add:

```ts
  app.patch("/api/books/:id/lab/scene-drafts/:draftId", async (c) => {
    const id = c.req.param("id");
    await assertLabBookExists(id);
    const draftId = c.req.param("draftId");
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const sceneDraft = (await readSceneDrafts(root, id)).find((draft) => draft.id === draftId);
    if (!sceneDraft) {
      throw new ApiError(404, "SCENE_DRAFT_NOT_FOUND", `Scene draft "${draftId}" not found.`);
    }
    const updated = SceneDraftSchema.parse({
      ...sceneDraft,
      ...(typeof body.status === "string" ? { status: body.status } : {}),
      ...(typeof body.prose === "string" ? { prose: body.prose } : {}),
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      updatedAt: new Date().toISOString(),
    });
    await writeSceneDraft(root, id, updated);
    return c.json({ sceneDraft: updated, sceneDrafts: await readSceneDrafts(root, id) });
  });
```

- [ ] **Step 7: Add scene draft compile endpoint**

Add:

```ts
  app.post("/api/books/:id/lab/scene-drafts/:draftId/compile", async (c) => {
    const id = c.req.param("id");
    await assertLabBookExists(id);
    const draftId = c.req.param("draftId");
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const chapter = typeof body.chapter === "number" ? body.chapter : Number.parseInt(String(body.chapter ?? ""), 10);
    if (!Number.isInteger(chapter) || chapter < 1) {
      throw new ApiError(400, "INVALID_CHAPTER", "Chapter must be a positive integer.");
    }
    const sceneDraft = (await readSceneDrafts(root, id)).find((draft) => draft.id === draftId);
    if (!sceneDraft) {
      throw new ApiError(404, "SCENE_DRAFT_NOT_FOUND", `Scene draft "${draftId}" not found.`);
    }
    if (sceneDraft.status !== "accepted") {
      throw new ApiError(409, "SCENE_DRAFT_NOT_ACCEPTED", "Only accepted scene drafts can compile.");
    }
    const intentMarkdown = renderSceneDraftIntentMarkdown(sceneDraft);
    const fileName = `chapter-${String(chapter).padStart(4, "0")}.intent.md`;
    const runtimePath = join("story", "runtime", fileName);
    const fullRuntimePath = join(state.bookDir(id), runtimePath);
    await mkdir(dirname(fullRuntimePath), { recursive: true });
    await writeFile(fullRuntimePath, intentMarkdown, "utf-8");
    return c.json({ runtimePath, intentMarkdown });
  });
```

- [ ] **Step 8: Run scene draft tests to verify pass**

Run:

```bash
pnpm --filter @actalk/inkos-studio exec vitest run src/api/server.test.ts -t "scene draft"
```

Expected: PASS.

- [ ] **Step 9: Commit scene draft API**

Run:

```bash
git add packages/studio/src/api/server.ts packages/studio/src/api/server.test.ts
git commit -m "feat(studio): add scene draft API"
```

---

## Task 7: Story World Lab UI Refactor

**Files:**
- Modify: `packages/studio/src/pages/StoryWorldLab.tsx`
- Modify: `packages/studio/src/App.test.ts`

- [ ] **Step 1: Write failing source regression test**

Add this test under `describe("story world route", () => { ... })` in `packages/studio/src/App.test.ts`:

```ts
it("keeps Story World Lab progress-first with explicit scene drafting", () => {
  const source = readFileSync(new URL("./pages/StoryWorldLab.tsx", import.meta.url), "utf-8");

  expect(source).toContain("/lab/director-turns");
  expect(source).toContain("latestStoryProgressProposal");
  expect(source).toContain("Usable Material");
  expect(source).toContain("Scene Drafts");
  expect(source).toContain("Create Draft");
  expect(source).not.toContain("title=\"Movement Candidates\" meta={`${candidates.length} total`}");
});
```

- [ ] **Step 2: Run App test to verify failure**

Run:

```bash
pnpm --filter @actalk/inkos-studio exec vitest run src/App.test.ts -t "progress-first"
```

Expected: FAIL because the page still centers old movement candidates and uses `/lab/chat-turns`.

- [ ] **Step 3: Import new types and helpers**

In `packages/studio/src/pages/StoryWorldLab.tsx`, import:

```ts
  SceneDraftPayload,
  StoryProgressPayload,
  StoryProgressStatusPayload,
  UsableMaterialPayload,
```

From `./story-world-state`, import:

```ts
  canCreateSceneDraft,
  groupUsableMaterial,
  latestStoryProgressProposal,
```

- [ ] **Step 4: Add state and derived values**

Inside `StoryWorldLab`, add:

```ts
  const [selectedProgressId, setSelectedProgressId] = useState<string | null>(null);
  const [draftChapter, setDraftChapter] = useState("1");
```

Add derived values after `chatTurns`:

```ts
  const storyProgress = lab?.storyProgress ?? [];
  const usableMaterial = lab?.usableMaterial ?? [];
  const sceneDrafts = lab?.sceneDrafts ?? [];
  const latestProposal = latestStoryProgressProposal(storyProgress);
  const selectedProgress = storyProgress.find((entry) => entry.id === selectedProgressId)
    ?? latestProposal
    ?? storyProgress.find((entry) => entry.status === "accepted")
    ?? null;
  const groupedMaterial = useMemo(() => groupUsableMaterial(usableMaterial), [usableMaterial]);
```

- [ ] **Step 5: Change submit endpoint**

Replace the existing `submitChat` body so it posts to `/lab/director-turns`:

```ts
  const submitChat = () => runOperation("chat", async () => {
    const text = chatInput.trim();
    if (!text) {
      setMessage({ tone: "error", text: "Director text is required." });
      return;
    }
    const response = await postApi<{ storyProgress: StoryProgressPayload }>(
      `/books/${bookId}/lab/director-turns`,
      { text },
    );
    setChatInput("");
    setSelectedProgressId(response.storyProgress.id);
    await refetch();
  });
```

- [ ] **Step 6: Add progress decision action**

Add:

```ts
  const updateProgressStatus = async (progress: StoryProgressPayload, status: StoryProgressStatusPayload) => {
    setMessage(null);
    try {
      await fetchJson<{ storyProgress: StoryProgressPayload }>(
        `/books/${bookId}/lab/story-progress/${progress.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      setSelectedProgressId(progress.id);
      setMessage({ tone: "success", text: `Progress marked ${status}.` });
      await refetch();
    } catch (caught) {
      setMessage({ tone: "error", text: errorMessage(caught) });
    }
  };
```

- [ ] **Step 7: Add create/compile scene draft actions**

Add:

```ts
  const createSceneDraft = () => runOperation("scene-contract", async () => {
    if (!selectedProgress || !canCreateSceneDraft(selectedProgress)) {
      setMessage({ tone: "error", text: "Accept story progress before creating a scene draft." });
      return;
    }
    await postApi<{ sceneDraft: SceneDraftPayload }>(
      `/books/${bookId}/lab/scene-drafts`,
      { progressId: selectedProgress.id },
    );
    setMessage({ tone: "success", text: "Scene draft created." });
    await refetch();
  });

  const updateSceneDraftStatus = async (draft: SceneDraftPayload, status: SceneDraftPayload["status"]) => {
    await fetchJson<{ sceneDraft: SceneDraftPayload }>(
      `/books/${bookId}/lab/scene-drafts/${draft.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    await refetch();
  };

  const compileSceneDraft = async (draft: SceneDraftPayload) => {
    const chapter = parsePositiveChapter(draftChapter);
    if (!chapter) {
      setMessage({ tone: "error", text: "Draft chapter must be a positive integer." });
      return;
    }
    setCompileBusyId(draft.id);
    setCompileFeedback(null);
    try {
      const response = await postApi<{ runtimePath: string; intentMarkdown: string }>(
        `/books/${bookId}/lab/scene-drafts/${draft.id}/compile`,
        { chapter },
      );
      setCompileFeedback({
        contractId: draft.id,
        status: "success",
        message: "Draft intent compiled.",
        runtimePath: response.runtimePath,
        intentMarkdown: response.intentMarkdown,
      });
    } catch (caught) {
      setCompileFeedback({
        contractId: draft.id,
        status: "error",
        message: errorMessage(caught),
      });
    } finally {
      setCompileBusyId(null);
    }
  };
```

- [ ] **Step 8: Add progress-first sections above planning/debug sections**

Inside the main content before `Advanced state controls`, render:

```tsx
          <Section
            title="Story Progress"
            meta={`${storyProgress.length} progress items`}
            actions={selectedProgress && (
              <>
                <button type="button" onClick={() => void updateProgressStatus(selectedProgress, "accepted")} className={actionButtonClassName("approve")}>
                  <Check size={14} />
                  Save Progress
                </button>
                <button type="button" onClick={() => void updateProgressStatus(selectedProgress, "held")} className={actionButtonClassName("hold")}>
                  <PauseCircle size={14} />
                  Hold
                </button>
                <button type="button" onClick={() => void updateProgressStatus(selectedProgress, "discarded")} className={actionButtonClassName("reject")}>
                  <XCircle size={14} />
                  Discard
                </button>
              </>
            )}
          >
            {!selectedProgress && (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
                No story progress yet.
              </div>
            )}
            {selectedProgress && (
              <div className="space-y-3">
                <div className="text-sm leading-6 text-foreground">{selectedProgress.summary}</div>
                {selectedProgress.rationale.length > 0 && (
                  <div className="space-y-1 text-xs leading-5 text-muted-foreground">
                    {selectedProgress.rationale.map((line) => <div key={line}>{line}</div>)}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <Badge>{selectedProgress.status}</Badge>
                  <Badge>{selectedProgress.sceneWorthiness}</Badge>
                </div>
              </div>
            )}
          </Section>

          <Section title="Usable Material" meta={`${usableMaterial.length} available`}>
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(groupedMaterial).flatMap(([type, items]) => items.slice(0, 4).map((item) => (
                <div key={item.id} className="rounded-lg border border-border/55 bg-secondary/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge>{type}</Badge>
                    <Badge>{item.risk}</Badge>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-foreground">{item.text}</div>
                </div>
              )))}
              {usableMaterial.length === 0 && (
                <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
                  No usable material yet.
                </div>
              )}
            </div>
          </Section>

          <Section
            title="Scene Drafts"
            meta={`${sceneDrafts.length} drafts`}
            actions={(
              <button type="button" onClick={createSceneDraft} disabled={!canCreateSceneDraft(selectedProgress)} className={actionButtonClassName("approve")}>
                <FileText size={14} />
                Create Draft
              </button>
            )}
          >
            <div className="space-y-3">
              <label className="flex max-w-xs items-center gap-2 text-xs text-muted-foreground">
                Chapter
                <input type="number" min={1} value={draftChapter} onChange={(event) => setDraftChapter(event.target.value)} className={fieldClassName("h-9")} />
              </label>
              {sceneDrafts.length === 0 && <div className="text-sm text-muted-foreground">No scene drafts.</div>}
              {sceneDrafts.map((draft) => (
                <div key={draft.id} className="rounded-lg border border-border/55 bg-secondary/20 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{draft.title ?? draft.id}</span>
                        <Badge>{draft.status}</Badge>
                      </div>
                      <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-sm leading-6 text-foreground">{draft.prose}</pre>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button type="button" onClick={() => void updateSceneDraftStatus(draft, "accepted")} className={actionButtonClassName("approve")}>
                        <Check size={14} />
                        Accept
                      </button>
                      <button type="button" onClick={() => void compileSceneDraft(draft)} disabled={draft.status !== "accepted" || compileBusyId === draft.id} className={actionButtonClassName("neutral")}>
                        {compileBusyId === draft.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles size={14} />}
                        Compile
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
```

- [ ] **Step 9: Move movement candidates under debug-only copy**

Change the movement candidates `Section` title from `"Movement Candidates"` to `"Debug Movement Candidates"` and keep it inside the collapsed Planning Queue. This keeps the old tools available while preventing them from reading as the main workflow.

- [ ] **Step 10: Run UI source regression test to verify pass**

Run:

```bash
pnpm --filter @actalk/inkos-studio exec vitest run src/App.test.ts -t "progress-first"
```

Expected: PASS.

- [ ] **Step 11: Run full targeted Studio UI tests**

Run:

```bash
pnpm --filter @actalk/inkos-studio exec vitest run src/pages/story-world-state.test.ts src/App.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit UI refactor**

Run:

```bash
git add packages/studio/src/pages/StoryWorldLab.tsx packages/studio/src/App.test.ts
git commit -m "feat(studio): make story world lab progress first"
```

---

## Task 8: Final Verification

**Files:**
- No code edits unless verification finds a defect.

- [ ] **Step 1: Run core tests**

Run:

```bash
pnpm --filter @actalk/inkos-core exec vitest run src/__tests__/story-world-lab.test.ts src/__tests__/story-progress-console.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run Studio API tests**

Run:

```bash
pnpm --filter @actalk/inkos-studio exec vitest run src/api/server.test.ts -t "Story Progress Console|director turn|story progress|scene draft|Story World chat turns"
```

Expected: PASS. If the test name filter misses the exact test names, run the explicit file:

```bash
pnpm --filter @actalk/inkos-studio exec vitest run src/api/server.test.ts
```

Expected: PASS. If this command fails, stop and inspect the failure before continuing.

- [ ] **Step 3: Run Studio UI/state tests**

Run:

```bash
pnpm --filter @actalk/inkos-studio exec vitest run src/pages/story-world-state.test.ts src/App.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run builds and typechecks**

Run:

```bash
pnpm --filter @actalk/inkos-core build
pnpm --filter @actalk/inkos-studio typecheck
pnpm --filter @actalk/inkos-studio build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Manual API smoke test**

Start Studio API and Vite if they are not already running:

```bash
INKOS_STUDIO_PORT=4579 node --import ./packages/studio/node_modules/tsx/dist/loader.mjs packages/studio/src/api/index.ts /tmp/inkos-story-world-demo
pnpm --dir packages/studio exec vite --host 0.0.0.0 --port 4577
```

Then run:

```bash
curl -sS -X POST http://127.0.0.1:4577/api/books/story-world-demo/lab/director-turns \
  -H 'Content-Type: application/json' \
  --data '{"text":"주인공이 침묵하면 도시의 소문은 어떻게 움직일까?"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); console.log(JSON.stringify({reply:j.directorTurn.text, progress:j.storyProgress.summary, material:j.usableMaterial.length}, null, 2));});'
```

Expected output contains Korean `reply`, Korean `progress`, and `material` greater than 0.

- [ ] **Step 6: Manual UI smoke test**

Open:

```text
http://127.0.0.1:4577/?page=story-world&bookId=story-world-demo
```

Verify:

- The first workflow is Director Console and Story Progress.
- The console reply is high-level progress, not a prose scene draft.
- Usable Material appears as a working shelf.
- Scene Drafts appear separately and require explicit creation.
- Movement candidates are visible only as debug/planning material.

- [ ] **Step 7: Final commit if verification fixes were required**

If verification required edits to this feature's files, commit the exact feature files:

```bash
git add \
  packages/core/src/models/story-world-lab.ts \
  packages/core/src/agents/story-progress-console.ts \
  packages/core/src/index.ts \
  packages/core/src/__tests__/story-world-lab.test.ts \
  packages/core/src/__tests__/story-progress-console.test.ts \
  packages/studio/src/shared/contracts.ts \
  packages/studio/src/api/server.ts \
  packages/studio/src/api/server.test.ts \
  packages/studio/src/pages/story-world-state.ts \
  packages/studio/src/pages/story-world-state.test.ts \
  packages/studio/src/pages/StoryWorldLab.tsx \
  packages/studio/src/App.test.ts
git commit -m "fix(studio): stabilize story progress console"
```

Expected: no extra commit is needed if all verification passes without changes.

- [ ] **Step 8: Push branch**

Run:

```bash
git push
```

Expected: `feature/story-world-movement` pushes to origin.

## Self-Review Notes

- Spec coverage: Tasks 1-2 implement the progress/material/draft domain model, Tasks 3-6 expose the persistence and API gates, and Task 7 replaces the UI with a chat-first Director Console while keeping scene drafts separate.
- Canon safety: StoryProgress and UsableMaterial never compile directly into truth files; Task 6 requires an accepted SceneDraft to generate chapter intent.
- Placeholder scan: checked the writing-plans banned filler terms and old relaxed expected-output wording; no matches remained before commit.
- Type consistency: `StoryProgress`, `UsableMaterial`, and `SceneDraft` names are used consistently across schemas, contracts, state helpers, API routes, and UI snippets.
