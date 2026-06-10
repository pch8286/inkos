# Narrative Lab UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Studio Narrative Lab UI slice with saved character/director sessions, human canon candidate decisions, and scene-contract compile output for the existing chapter intent flow.

**Architecture:** Add a small `narrative-lab` domain to core, expose it through Studio server endpoints, and render it as a global Studio page. The Lab writes only `story/lab/*` and `story/runtime/chapter-XXXX.intent.md`; it does not mutate canonical truth files.

**Tech Stack:** TypeScript, Zod, Node fs/promises, Hono, React, Vitest, React Testing Library, lucide-react.

---

## File Structure

- Create `packages/core/src/models/narrative-lab.ts` for shared Zod schemas and types.
- Create `packages/core/src/agents/session-compiler.ts` for approved-candidate filtering and intent markdown rendering.
- Modify `packages/core/src/index.ts` to export Narrative Lab types and compiler helpers.
- Create `packages/core/src/__tests__/narrative-lab.test.ts` for schema and compiler behavior.
- Modify `packages/studio/src/shared/contracts.ts` to mirror Lab API payload contracts.
- Modify `packages/studio/src/api/server.ts` to add persisted Lab endpoints under `/api/books/:bookId/lab`.
- Add Studio API tests to `packages/studio/src/api/server.test.ts`.
- Create `packages/studio/src/pages/NarrativeLab.tsx` for the work surface.
- Create `packages/studio/src/pages/narrative-lab-state.test.ts` for pure UI state helpers.
- Modify `packages/studio/src/App.tsx` and `packages/studio/src/components/Sidebar.tsx` to route to the Lab page.
- Add route tests to `packages/studio/src/pages/entrypoint-routing.test.ts` or `packages/studio/src/App.test.ts`.

## Task 1: Core Schemas and Compiler

**Files:**
- Create: `packages/core/src/models/narrative-lab.ts`
- Create: `packages/core/src/agents/session-compiler.ts`
- Create: `packages/core/src/__tests__/narrative-lab.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests that parse a `LabSession`, reject an invalid candidate status, and prove rejected/held candidates are excluded from compile.

Run: `pnpm --filter @actalk/inkos-core test -- narrative-lab.test.ts`

Expected: FAIL because the new modules do not exist.

- [ ] **Step 2: Add Zod schemas**

Define:

```ts
export const LabSessionModeSchema = z.enum(["character-chat", "director-notes"]);
export const ChatTurnRoleSchema = z.enum(["user", "assistant", "character", "system"]);
export const CanonCandidateStatusSchema = z.enum(["candidate", "approved", "rejected", "hold"]);
export const CanonCandidateTypeSchema = z.enum([
  "character_voice",
  "relationship",
  "world_fact",
  "scene_idea",
  "plot_hook",
  "style_preference",
]);
export const CanonCandidateRiskSchema = z.enum(["low", "medium", "high"]);
```

`LabSessionSchema` must include `id`, `bookId`, `mode`, optional `characterId`, `title`, `turns`, `createdAt`, and `updatedAt`.

`CanonCandidateSchema` must include `id`, `sourceSessionId`, `type`, `text`, `evidence`, `risk`, `status`, optional `reason`, `createdAt`, and `updatedAt`.

`SceneContractSchema` must include `id`, `chapter`, `sourceSessionIds`, `pov`, `location`, `sceneGoal`, `mustInclude`, `mustAvoid`, `characterBeats`, `endingState`, `approvedCandidateIds`, `createdAt`, and `updatedAt`.

- [ ] **Step 3: Add compiler helpers**

Implement `filterApprovedCandidates(candidates)` and `renderSceneContractIntentMarkdown(contract, candidates)`.

The rendered markdown must include these sections because `loadPersistedPlan()` already parses them:

```text
## Goal
## Outline Node
## Must Keep
## Must Avoid
## Style Emphasis
## Conflicts
```

Use approved candidate text in `Must Keep`; use `mustAvoid` in `Must Avoid`; include scene goal, POV, location, and ending state in the goal/outline text.

- [ ] **Step 4: Export types and helpers**

Export schemas, inferred types, and compiler helpers from `packages/core/src/index.ts`.

- [ ] **Step 5: Verify core tests**

Run: `pnpm --filter @actalk/inkos-core test -- narrative-lab.test.ts`

Expected: PASS.

## Task 2: Studio Contracts and API Persistence

**Files:**
- Modify: `packages/studio/src/shared/contracts.ts`
- Modify: `packages/studio/src/api/server.ts`
- Modify: `packages/studio/src/api/server.test.ts`

- [ ] **Step 1: Write failing API tests**

Add tests that:

- `POST /api/books/:bookId/lab/sessions` creates `story/lab/sessions/<id>.json`.
- `POST /api/books/:bookId/lab/sessions/:sessionId/turns` appends a turn.
- `PATCH /api/books/:bookId/lab/candidates/:candidateId` changes status and text.
- `POST /api/books/:bookId/lab/scene-contracts/:sceneContractId/compile` writes `story/runtime/chapter-XXXX.intent.md`.
- Chat/session endpoints do not write `story_bible.md`, `current_state.md`, `character_matrix.md`, or `pending_hooks.md`.

Run: `pnpm --filter @actalk/inkos-studio test -- server.test.ts`

Expected: FAIL because the endpoints do not exist.

- [ ] **Step 2: Add shared payload interfaces**

Add Lab interfaces to `contracts.ts` matching the core schemas:

```ts
export type LabSessionMode = "character-chat" | "director-notes";
export type ChatTurnRole = "user" | "assistant" | "character" | "system";
export type CanonCandidateType =
  | "character_voice"
  | "relationship"
  | "world_fact"
  | "scene_idea"
  | "plot_hook"
  | "style_preference";
export type CanonCandidateStatus = "candidate" | "approved" | "rejected" | "hold";
export type CanonCandidateRisk = "low" | "medium" | "high";

export interface ChatTurnPayload {
  readonly id: string;
  readonly role: ChatTurnRole;
  readonly content: string;
  readonly createdAt: string;
}

export interface LabSessionPayload {
  readonly id: string;
  readonly bookId: string;
  readonly mode: LabSessionMode;
  readonly characterId?: string | null;
  readonly title: string;
  readonly turns: ReadonlyArray<ChatTurnPayload>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CanonCandidatePayload {
  readonly id: string;
  readonly sourceSessionId: string;
  readonly type: CanonCandidateType;
  readonly text: string;
  readonly evidence: ReadonlyArray<string>;
  readonly risk: CanonCandidateRisk;
  readonly status: CanonCandidateStatus;
  readonly reason?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SceneContractCharacterBeatPayload {
  readonly characterId: string;
  readonly beat: string;
  readonly voiceNotes?: ReadonlyArray<string>;
}

export interface SceneContractPayload {
  readonly id: string;
  readonly chapter: number;
  readonly sourceSessionIds: ReadonlyArray<string>;
  readonly pov: string;
  readonly location: string;
  readonly sceneGoal: ReadonlyArray<string>;
  readonly mustInclude: ReadonlyArray<string>;
  readonly mustAvoid: ReadonlyArray<string>;
  readonly characterBeats: ReadonlyArray<SceneContractCharacterBeatPayload>;
  readonly endingState: ReadonlyArray<string>;
  readonly approvedCandidateIds: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

- [ ] **Step 3: Add safe persistence helpers**

In `server.ts`, create helpers near other persisted Studio state helpers:

- `getLabDir(bookId)`
- `readLabSessions(bookId)`
- `writeLabSession(bookId, session)`
- `readLabCandidates(bookId)`
- `writeLabCandidates(bookId, candidates)`
- `readSceneContracts(bookId)`
- `writeSceneContract(bookId, contract)`

All helpers must use `isSafeBookId(bookId)` and `join(projectRoot, "books", bookId, "story", "lab")`.

- [ ] **Step 4: Add endpoints**

Implement:

```text
GET /api/books/:bookId/lab/sessions
POST /api/books/:bookId/lab/sessions
GET /api/books/:bookId/lab/sessions/:sessionId
POST /api/books/:bookId/lab/sessions/:sessionId/turns
POST /api/books/:bookId/lab/sessions/:sessionId/extract
GET /api/books/:bookId/lab/candidates
PATCH /api/books/:bookId/lab/candidates/:candidateId
POST /api/books/:bookId/lab/scene-contracts
POST /api/books/:bookId/lab/scene-contracts/:sceneContractId/compile
```

For MVP extraction, create deterministic candidate suggestions from recent user/character/director turns. The extractor can create one `scene_idea` candidate from the latest non-empty user turn and one `character_voice` candidate when a character turn exists. This keeps the UI usable without adding a new LLM call in this slice.

- [ ] **Step 5: Verify API tests**

Run: `pnpm --filter @actalk/inkos-studio test -- server.test.ts`

Expected: PASS for new Lab cases and existing server tests.

## Task 3: Studio Route and Navigation

**Files:**
- Modify: `packages/studio/src/App.tsx`
- Modify: `packages/studio/src/components/Sidebar.tsx`
- Modify: `packages/studio/src/pages/entrypoint-routing.test.ts` or `packages/studio/src/App.test.ts`

- [ ] **Step 1: Write failing route tests**

Add expectations:

```ts
expect(parseRouteFromSearch("?page=lab&bookId=demo")).toEqual({ page: "lab", bookId: "demo" });
expect(buildRouteSearch({ page: "lab", bookId: "demo" })).toBe("?page=lab&bookId=demo");
expect(deriveActiveBookId({ page: "lab", bookId: "demo" })).toBe("demo");
```

Run: `pnpm --filter @actalk/inkos-studio test -- App.test.ts`

Expected: FAIL because `lab` is not a route.

- [ ] **Step 2: Add route type and URL parsing**

Add `{ page: "lab"; bookId?: string }` to `Route`, parse/build `?page=lab`, and include `lab` in active book id resolution.

- [ ] **Step 3: Add navigation entry**

Add `toLab(bookId?: string)` to Studio nav and Sidebar props. Add a `FlaskConical` or `MessageCircleMore` icon item labelled `Narrative Lab` under Tools or Books.

- [ ] **Step 4: Verify route tests**

Run: `pnpm --filter @actalk/inkos-studio test -- App.test.ts`

Expected: PASS.

## Task 4: Narrative Lab Page UI

**Files:**
- Create: `packages/studio/src/pages/NarrativeLab.tsx`
- Create: `packages/studio/src/pages/narrative-lab-state.test.ts`
- Modify: `packages/studio/src/App.tsx`

- [ ] **Step 1: Write failing state tests**

Test pure helpers:

- `selectDefaultLabBook()` chooses the route book if present, otherwise the first available book.
- `groupCandidatesByStatus()` returns candidate/count groups for `candidate`, `approved`, `hold`, and `rejected`.
- `canCompileSceneContract()` is false with no approved candidates and true with at least one approved candidate plus a positive chapter.

Run: `pnpm --filter @actalk/inkos-studio test -- narrative-lab-state.test.ts`

Expected: FAIL because helpers do not exist.

- [ ] **Step 2: Implement page state helpers**

Export the helper functions from `NarrativeLab.tsx` or a small adjacent state file if the component grows too large.

- [ ] **Step 3: Build the page surface**

Render:

- Breadcrumb and `Narrative Lab` title.
- Book selector using `/api/books`.
- Mode tabs for `Character Chat` and `Director Notes`.
- Session list and create session button.
- Conversation log and turn composer.
- Candidate panel with edit/status controls.
- Scene contract controls for chapter, POV, location, scene goal, must-avoid, ending state, build, and compile.

Use existing Studio classes (`studio-chip`, `studio-surface-active`, `border-border`, `bg-secondary/30`) and lucide icons. Do not add a hero section.

- [ ] **Step 4: Wire API calls**

Use `useApi`, `fetchJson`, and `postApi` for GET/POST. Use `fetchJson` with `PATCH` for candidate updates. Refetch sessions/candidates/contracts after mutations.

- [ ] **Step 5: Add empty/loading/error states**

Show dense, utilitarian empty states:

- No books: ask user to create/import a book.
- No sessions: show create session action.
- No candidates: show extract action after at least one turn.
- No approved candidates: disable compile and explain via button title/adjacent status text.

- [ ] **Step 6: Verify page tests**

Run: `pnpm --filter @actalk/inkos-studio test -- narrative-lab-state.test.ts`

Expected: PASS.

## Task 5: Integration Verification

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 2: Run targeted package tests**

Run:

```bash
pnpm --filter @actalk/inkos-core test -- narrative-lab.test.ts
pnpm --filter @actalk/inkos-studio test -- App.test.ts narrative-lab-state.test.ts server.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full test suite if targeted tests pass**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 4: Final git check**

Run: `git status --short`

Expected: only intended Narrative Lab files plus pre-existing untracked image files remain.
