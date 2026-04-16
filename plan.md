# Cockpit Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor InkOS Studio Cockpit into a clearer conversation-first workbench, improve setup/binder/draft truthfulness, and harden responsive and accessibility behavior without breaking the existing API surface.

**Architecture:** Keep `Cockpit.tsx` as the orchestration shell, extract setup/conversation logic into focused hooks and helpers, and split the layout into presentational sections. Preserve current backend endpoints and existing cockpit derivation modules, but align UI state, labels, and gates with the actual workflow so the screen reflects what the actions truly do.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, existing `useApi` hooks, existing cockpit helper modules, global `index.css`

---

## File Structure

- `packages/studio/src/pages/Cockpit.tsx`
  - Keep as the page-level coordinator, but remove most parsing / session / rendering bulk.
- `packages/studio/src/pages/cockpit-parsing.ts`
  - New pure helper module for command parsing, conversation transcript formatting, and UI-facing formatting helpers now embedded in `Cockpit.tsx`.
- `packages/studio/src/pages/cockpit-parsing.test.ts`
  - New unit tests for the extracted parsing/formatting helpers.
- `packages/studio/src/pages/cockpit-shared.ts`
  - New shared cockpit primitive module for local page types, setup-session summaries, and page-level parsing helpers that are still trapped inside `Cockpit.tsx`.
- `packages/studio/src/pages/cockpit-shared.test.ts`
  - New unit tests for shared summary parsing and small pure helpers moved out of `Cockpit.tsx`.
- `packages/studio/src/pages/use-cockpit-conversation.ts`
  - New hook for thread/proposal mutation, binder/draft/discuss action handling, and target-summary derivation.
- `packages/studio/src/pages/use-cockpit-setup-session.ts`
  - New hook for setup draft state, readiness, proposal lifecycle, foundation preview, recovery, and create flow.
- `packages/studio/src/pages/cockpit/CockpitHeaderSection.tsx`
  - New presentational header/status shell.
- `packages/studio/src/pages/cockpit/CockpitLeftRail.tsx`
  - New left-rail component for book selection, mode switching, and contextual target lists.
- `packages/studio/src/pages/cockpit/CockpitWorkspace.tsx`
  - New center-pane component for conversation log, composer, and mode actions.
- `packages/studio/src/pages/cockpit/CockpitInspector.tsx`
  - New right-pane component for focus, pending changes, setup controls, and activity.
- `packages/studio/src/pages/cockpit-ui-state.ts`
  - Extend pure derivations so setup primary action, visible target, and rail behavior stay testable outside React.
- `packages/studio/src/pages/cockpit-status-strip.ts`
  - Keep this as the single source of truth for status-strip target derivation and expose a user-facing target label.
- `packages/studio/src/pages/cockpit-setup-state.ts`
  - Align setup gating and note summaries so “missing information” and “ready to propose” do not disagree, without assuming backend conversation persistence that does not exist today.
- `packages/studio/src/pages/cockpit-ui-state.test.ts`
  - Update/add tests for refined visible-target and guided setup behavior.
- `packages/studio/src/pages/cockpit-status-strip.test.ts`
  - Update/add tests for rendered target visibility and status precedence.
- `packages/studio/src/pages/cockpit-setup-state.test.ts`
  - Update/add tests for stricter setup readiness and resume/review semantics.
- `packages/studio/src/hooks/use-i18n.ts`
  - Add any new cockpit labels, helper text, target wording, and accessibility copy.
- `packages/studio/src/index.css`
  - Adjust cockpit-specific layout, responsive stacking, sticky behavior, and form/status presentation without destabilizing the rest of Studio.

### Task 1: Finish Cockpit Helper Cleanup

**Files:**
- Modify: `packages/studio/src/pages/cockpit-parsing.ts`
- Test: `packages/studio/src/pages/cockpit-parsing.test.ts`
- Modify: `packages/studio/src/pages/Cockpit.tsx`

- [ ] **Step 1: Write or extend failing helper tests for any pure helper still left inline**

```ts
import { describe, expect, it } from "vitest";
import {
  defaultActionForMode,
  formatReasoningEffortLabel,
  parseComposerCommand,
} from "./cockpit-parsing";

describe("parseComposerCommand", () => {
  it("parses /write-next payloads", () => {
    expect(parseComposerCommand("/write-next 3200 words")).toEqual({
      action: "write-next",
      text: "3200 words",
    });
  });
});

describe("defaultActionForMode", () => {
  it("maps binder mode to ask", () => {
    expect(defaultActionForMode("binder")).toBe("ask");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @actalk/inkos-studio test -- src/pages/cockpit-parsing.test.ts`
Expected: FAIL only if there are still unextracted helper behaviors not covered yet

- [ ] **Step 3: Move any remaining pure helper behavior into `cockpit-parsing.ts`**

```ts
// Keep this file limited to pure parsing / formatting helpers.
```

- [ ] **Step 4: Remove the now-redundant inline helper code from `Cockpit.tsx`**

```ts
// Cockpit.tsx should import the helpers and stop owning duplicate pure logic.
```

- [ ] **Step 5: Replace inline helper usage in `Cockpit.tsx`**

Run: `pnpm --filter @actalk/inkos-studio test -- src/pages/cockpit-parsing.test.ts src/pages/cockpit-ui-state.test.ts src/pages/cockpit-status-strip.test.ts src/pages/cockpit-setup-state.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/pages/Cockpit.tsx \
  packages/studio/src/pages/cockpit-parsing.ts \
  packages/studio/src/pages/cockpit-parsing.test.ts
git commit -m "refactor: finish cockpit helper cleanup"
```

### Task 2: Extract Shared Cockpit Primitives Before Hook Splits

**Files:**
- Create: `packages/studio/src/pages/cockpit-shared.ts`
- Test: `packages/studio/src/pages/cockpit-shared.test.ts`
- Modify: `packages/studio/src/pages/Cockpit.tsx`

- [ ] **Step 1: Write failing tests for setup-session summary parsing and shared cockpit primitives**

```ts
it("parses and sorts recent setup sessions by updated timestamp", () => {
  expect(parseSetupSessions(...)).toEqual([...]);
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `pnpm --filter @actalk/inkos-studio test -- src/pages/cockpit-shared.test.ts`
Expected: FAIL because the shared primitive module does not exist yet

- [ ] **Step 3: Move page-local shared primitives out of `Cockpit.tsx`**

```ts
export interface CockpitMessage { ... }
export interface ProposalState { ... }
export interface BookSetupSessionSummary { ... }
export function parseSetupSessions(value: unknown): ReadonlyArray<BookSetupSessionSummary> { ... }
```

- [ ] **Step 4: Rewire `Cockpit.tsx` to import those primitives**

```ts
// This task should reduce local type/helper bulk before hook extraction starts.
```

- [ ] **Step 5: Re-run the focused tests**

Run: `pnpm --filter @actalk/inkos-studio test -- src/pages/cockpit-shared.test.ts src/pages/cockpit-parsing.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/pages/Cockpit.tsx \
  packages/studio/src/pages/cockpit-shared.ts \
  packages/studio/src/pages/cockpit-shared.test.ts
git commit -m "refactor: extract shared cockpit primitives"
```

### Task 3: Extract Conversation Workflow State And Make Targets Truthful

**Files:**
- Create: `packages/studio/src/pages/use-cockpit-conversation.ts`
- Modify: `packages/studio/src/pages/Cockpit.tsx`
- Modify: `packages/studio/src/pages/cockpit-status-strip.ts`
- Modify: `packages/studio/src/pages/cockpit-status-strip.test.ts`
- Modify: `packages/studio/src/hooks/use-i18n.ts`
- Modify: `packages/studio/src/index.css`

- [ ] **Step 1: Write failing tests for visible target and target-label rendering support**

```ts
it("returns a user-facing target label for new setup instead of a raw sentinel", () => {
  expect(deriveCockpitStatusStrip(...).targetLabel).toBe("New Setup");
});
```

- [ ] **Step 2: Run the targeted status tests to verify they fail**

Run: `pnpm --filter @actalk/inkos-studio test -- src/pages/cockpit-status-strip.test.ts`
Expected: FAIL because target labels are not yet user-facing

- [ ] **Step 3: Extract conversation/thread/proposal state into `use-cockpit-conversation.ts`**

```ts
export function useCockpitConversation(input: UseCockpitConversationInput) {
  return {
    threads,
    activeMessages,
    activeProposal,
    hasPendingChanges,
    sendDiscussPrompt,
    sendBinderPrompt,
    triggerDraftAction,
    handleApplyChange,
    handleApplyAll,
  };
}
```

- [ ] **Step 4: Keep target derivation in one place**

```ts
// `cockpit-status-strip.ts` remains the single source of truth for active target labels.
// Render that target in the workspace status strip and any matching scope chip.
// In draft mode, make the UI copy clearly communicate that actions queue the next draft/write step at book scope.
```

- [ ] **Step 5: Re-run the focused tests**

Run: `pnpm --filter @actalk/inkos-studio test -- src/pages/cockpit-status-strip.test.ts src/pages/cockpit-parsing.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/pages/Cockpit.tsx \
  packages/studio/src/pages/use-cockpit-conversation.ts \
  packages/studio/src/pages/cockpit-status-strip.ts \
  packages/studio/src/pages/cockpit-status-strip.test.ts \
  packages/studio/src/hooks/use-i18n.ts \
  packages/studio/src/index.css
git commit -m "refactor: clarify cockpit conversation targets"
```

### Task 4: Extract Setup Session State And Turn Setup Into A Guided Progression

**Files:**
- Create: `packages/studio/src/pages/use-cockpit-setup-session.ts`
- Modify: `packages/studio/src/pages/Cockpit.tsx`
- Modify: `packages/studio/src/pages/cockpit-setup-state.ts`
- Test: `packages/studio/src/pages/cockpit-setup-state.test.ts`
- Modify: `packages/studio/src/hooks/use-i18n.ts`

- [ ] **Step 1: Write failing tests for stricter setup readiness**

```ts
it("requires brief and discussion before proposal preparation is allowed", () => {
  expect(canPrepareSetupProposal({
    discussionState: "ready",
    title: "Demo",
    genre: "modern-fantasy",
    brief: "",
    hasDiscussion: false,
  })).toBe(false);
});
```

- [ ] **Step 2: Run the setup-state tests to verify they fail**

Run: `pnpm --filter @actalk/inkos-studio test -- src/pages/cockpit-setup-state.test.ts`
Expected: FAIL because the current gate only checks title, genre, and fingerprint readiness

- [ ] **Step 3: Extract setup/session lifecycle into `use-cockpit-setup-session.ts`**

```ts
export function useCockpitSetupSession(input: UseCockpitSetupSessionInput) {
  return {
    setupTitle,
    setupGenre,
    setupPlatform,
    setupBrief,
    setupSession,
    setupPrimaryAction,
    handlePrepareSetupProposal,
    handleApproveSetup,
    handlePrepareFoundationPreview,
    handleCreateSetup,
    handleResumeSetupSession,
  };
}
```

- [ ] **Step 4: Align gates, notes, and frontend-only resume behavior**

```ts
// Make the setup notes and setup gate agree on required information.
// Do not assume backend-persisted conversation exists.
// Resume means restoring proposal/foundation/session state accurately, not reconstructing missing chat history.
// Render one primary next-step action first, not six equally weighted actions.
```

- [ ] **Step 5: Re-run the focused setup tests**

Run: `pnpm --filter @actalk/inkos-studio test -- src/pages/cockpit-setup-state.test.ts src/pages/cockpit-ui-state.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/pages/Cockpit.tsx \
  packages/studio/src/pages/use-cockpit-setup-session.ts \
  packages/studio/src/pages/cockpit-setup-state.ts \
  packages/studio/src/pages/cockpit-setup-state.test.ts \
  packages/studio/src/hooks/use-i18n.ts
git commit -m "refactor: guide cockpit setup progression"
```

### Task 5: Split The Cockpit Layout Into Presentational Sections

**Files:**
- Create: `packages/studio/src/pages/cockpit/CockpitHeaderSection.tsx`
- Create: `packages/studio/src/pages/cockpit/CockpitLeftRail.tsx`
- Create: `packages/studio/src/pages/cockpit/CockpitWorkspace.tsx`
- Create: `packages/studio/src/pages/cockpit/CockpitInspector.tsx`
- Modify: `packages/studio/src/pages/Cockpit.tsx`

- [ ] **Step 1: Move the header and left rail into presentational components**

```tsx
export function CockpitHeaderSection(props: CockpitHeaderSectionProps) {
  return <section>...</section>;
}
```

- [ ] **Step 2: Move the workspace and inspector into presentational components**

```tsx
export function CockpitWorkspace(props: CockpitWorkspaceProps) {
  return <main aria-label="Cockpit workspace">...</main>;
}
```

- [ ] **Step 3: Keep the extracted components presentational**

```tsx
// Keep business logic in hooks/page coordinator and pass plain props into the sections.
```

- [ ] **Step 4: Verify the page still renders the same flows after the split**

Run: `pnpm --filter @actalk/inkos-studio test -- src/pages/cockpit-parsing.test.ts src/pages/cockpit-status-strip.test.ts src/pages/cockpit-setup-state.test.ts src/pages/cockpit-ui-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/studio/src/pages/Cockpit.tsx \
  packages/studio/src/pages/cockpit/CockpitHeaderSection.tsx \
  packages/studio/src/pages/cockpit/CockpitLeftRail.tsx \
  packages/studio/src/pages/cockpit/CockpitWorkspace.tsx \
  packages/studio/src/pages/cockpit/CockpitInspector.tsx
git commit -m "refactor: split cockpit presentation"
```

### Task 6: Improve Responsive And Accessibility Behavior

**Files:**
- Modify: `packages/studio/src/pages/Cockpit.tsx`
- Modify: `packages/studio/src/pages/cockpit/CockpitWorkspace.tsx`
- Modify: `packages/studio/src/pages/cockpit/CockpitInspector.tsx`
- Modify: `packages/studio/src/index.css`
- Modify: `packages/studio/src/hooks/use-i18n.ts`

- [ ] **Step 1: Add explicit labels, helper text bindings, and live/status semantics**

```tsx
<label htmlFor="cockpit-composer">...</label>
<textarea id="cockpit-composer" aria-describedby="cockpit-composer-help" ... />
<div id="cockpit-composer-help">...</div>
<div role="status" aria-live="polite">...</div>
<div role="log" aria-live="polite" aria-relevant="additions text">...</div>
```

- [ ] **Step 2: Give the inspector tab bar real tab semantics and keyboard support**

```tsx
<div role="tablist">...</div>
<button role="tab" aria-selected=... aria-controls=...>...</button>
<section role="tabpanel" id=...>...</section>
```

- [ ] **Step 3: Tighten responsive behavior with concrete acceptance criteria**

Acceptance criteria:
- Below `1280px`, the center workspace remains visually primary.
- Below `1024px`, tertiary chrome must not rely on sticky positioning that steals viewport height.
- No horizontal scrolling in cockpit at `320px` width or `400%` zoom for the main workflow.

- [ ] **Step 4: Verify targeted cockpit tests**

Run: `pnpm --filter @actalk/inkos-studio test -- src/pages/cockpit-parsing.test.ts src/pages/cockpit-status-strip.test.ts src/pages/cockpit-setup-state.test.ts src/pages/cockpit-ui-state.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck and record baseline issues explicitly**

Run: `pnpm --filter @actalk/inkos-studio typecheck`
Expected: if FAIL, only known baseline workspace errors unrelated to cockpit changes

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/pages/Cockpit.tsx \
  packages/studio/src/pages/cockpit/CockpitWorkspace.tsx \
  packages/studio/src/pages/cockpit/CockpitInspector.tsx \
  packages/studio/src/index.css \
  packages/studio/src/hooks/use-i18n.ts
git commit -m "feat: improve cockpit accessibility and responsiveness"
```

### Task 7: Final Verification

**Files:**
- Verify only

- [ ] **Step 1: Re-read the plan and compare implemented behavior against each task**

Checklist:
- helpers extracted from `Cockpit.tsx`
- shared cockpit primitives extracted from `Cockpit.tsx`
- conversation/setup hooks extracted
- active target rendered truthfully
- setup progression guided by one primary next step
- labels / live regions / tab semantics added
- responsive cockpit rails improved

- [ ] **Step 2: Run the complete Studio verification suite**

Run: `pnpm --filter @actalk/inkos-studio typecheck && pnpm --filter @actalk/inkos-studio test`
Expected: PASS with zero failing tests

- [ ] **Step 3: Spot-check the cockpit entry build**

Run: `pnpm --filter @actalk/inkos-studio build`
Expected: PASS and both Studio + Cockpit entries build successfully

- [ ] **Step 4: Summarize any residual risk**

```txt
If component-level interaction tests are still absent, call that out explicitly.
```
