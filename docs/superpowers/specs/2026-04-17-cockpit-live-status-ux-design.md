# Cockpit Live Status UX Design

## Goal

Make Cockpit clearly feel "alive" during long-running work by upgrading the existing status strip into a compact live status pattern with small motion, a thin progress bar, and better stage messaging.

## Why This Slice

Cockpit already exposes status in multiple places, but the current experience is too static:

- stage text changes are easy to miss
- users cannot quickly tell whether the system is still working or stalled
- setup/create states are more structured than binder/draft work, but the UI does not reflect that difference
- the existing status strip is present but underused as a real-time signal

The requested improvement is not a full workflow redesign. It is a UX correction: make active work visibly active without adding a large new panel or consuming much more space.

## Scope

Included in this slice:

- upgrade the existing Cockpit status strip into a compact live status strip
- add a shared live-status model derived from Cockpit state
- show a small animated `LIVE` badge when work is active
- show a thin determinate progress bar for setup/create stages with clear order
- show a thin indeterminate progress bar for long-running work without trustworthy percentages
- keep the layout compact and reuse the existing strip placement
- preserve latest-event and error signaling inside the upgraded strip
- add regression tests for live-status derivation and strip rendering
- respect `prefers-reduced-motion`

Explicitly deferred:

- a new floating overlay or separate activity panel for live work
- Dashboard and legacy Book Create alignment in this slice
- Playwright setup and end-to-end browser automation for this specific change
- exact numeric progress sourced from backend execution internals
- richer event timelines or per-file live feeds
- SSE protocol changes solely for this UX update

## User Decisions Captured

The design is locked to the choices validated during brainstorming:

- visual direction: minimal motion
- motion tolerance: thin progress bar is acceptable if it stays compact
- placement: upgrade the existing status strip instead of adding a new block
- scope: use a common live-status pattern across Cockpit modes, not only setup/create

## User Experience

### Default State

When no meaningful work is active, Cockpit keeps the current compact status-strip behavior:

- status pills remain visible
- latest event stays visible when present
- no animated badge or progress bar is shown

### Live State

When work is active, the current status strip becomes a live strip:

- a small `LIVE` badge appears with subtle motion
- the current stage label is shown in one short line
- a thin progress bar appears below or beside the live line depending on available width
- supporting detail uses a single compact line, usually derived from `latestEvent` or the active stage message

The strip must remain visually compact enough that it feels like a status line, not a new panel.

### Determinate vs Indeterminate Progress

Some Cockpit work has a reliable sequence of stages. That should use determinate progress:

- `preparing-proposal` = 20%
- `approving-proposal` = 40%
- `previewing-foundation` = 65%
- `creating` = 85%

These values do not claim exact backend completion. They communicate ordered progress through a known setup/create funnel.

Other work does not have trustworthy percent completion and must use indeterminate progress:

- generic `working`
- `queued`
- long binder work
- long draft work
- long discuss actions without structured stage boundaries

This avoids fake precision.

### Error Priority

If the latest meaningful signal is an error, the strip should prioritize the error view over the live animation:

- error text remains dominant
- live styling is suppressed or visually de-emphasized
- the user should not interpret an error state as healthy progress

## Design Summary

Keep the current Cockpit layout and upgrade only the existing status strip behavior.

The main change is architectural, not visual sprawl:

1. Derive a shared live-status view model in `cockpit-status-strip.ts`.
2. Render the upgraded strip in `CockpitMainConversation.tsx`.
3. Style the live strip in the existing Cockpit CSS surface without adding a new major layout region.
4. Reuse the same pattern for setup/create and for generic long-running Cockpit work.

This gives users a stronger "still running" signal while keeping the interface stable.

## State Model

Extend the current `CockpitStatusStrip` shape with explicit live-state fields:

```ts
export interface CockpitStatusStrip {
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly reasoningLabel: string | null;
  readonly stage: CockpitStatusStage;
  readonly targetLabel: string;
  readonly latestEvent: string | null;
  readonly isLive: boolean;
  readonly liveLabel: string | null;
  readonly liveDetail: string | null;
  readonly progressMode: "none" | "determinate" | "indeterminate";
  readonly progressValue: number | null;
}
```

### Derivation Rules

`isLive` is true when the strip is representing active work, not merely readiness:

- true for `preparing-proposal`
- true for `approving-proposal`
- true for `previewing-foundation`
- true for `creating`
- true for `working`
- true for `queued`
- false for `idle`
- false for `ready`

`progressMode` rules:

- `determinate` for `preparing-proposal`, `approving-proposal`, `previewing-foundation`, `creating`
- `indeterminate` for `working`, `queued`
- `none` for `idle`, `ready`

`progressValue` rules:

- `20` for `preparing-proposal`
- `40` for `approving-proposal`
- `65` for `previewing-foundation`
- `85` for `creating`
- `null` otherwise

`liveLabel` rules:

- prefer a localized stage label derived from `stage`
- keep it short and stable
- do not expose raw backend noise directly as the primary label

`liveDetail` rules:

- prefer the latest meaningful event summary when it adds context
- otherwise fall back to the stage detail or target label
- trim to one compact line in the rendered UI

## Rendering Plan

Render the upgraded strip in the existing status-strip area inside `CockpitMainConversation.tsx`.

The live strip should contain:

- current status pills, still visible for context
- a small `LIVE` badge when `isLive` is true
- the primary live label
- a thin progress bar
- the current detail line

Layout rules:

- no new standalone panel
- minimal vertical growth relative to the current strip
- on narrow widths, allow the live line and progress bar to wrap cleanly
- keep the strip readable even when the latest event text is long

## Accessibility and Motion

Animation should be subtle and informative, not decorative.

Requirements:

- use CSS-only animation for the `LIVE` badge and indeterminate bar
- preserve sufficient contrast for live and error states
- support `prefers-reduced-motion: reduce`

When reduced motion is requested:

- stop pulsing the live badge
- stop sweeping the indeterminate bar
- keep the determinate bar static
- retain all textual status information

## Data and API Impact

No API contract changes are required for this slice.

This design must work with the current sources already available to Cockpit:

- local busy flags
- setup flow flags
- create-job entries
- recent activity summaries

The UX change is intentionally derived from existing data rather than requiring new backend progress instrumentation.

## Implementation Targets

Expected files for this slice:

- `packages/studio/src/pages/cockpit-status-strip.ts`
- `packages/studio/src/pages/cockpit-status-strip.test.ts`
- `packages/studio/src/pages/cockpit/CockpitMainConversation.tsx`
- `packages/studio/src/pages/Cockpit.test.ts`
- `packages/studio/src/index.css`

No broad refactor is needed outside the Cockpit status-strip path.

## Testing Strategy

### Derivation Tests

Extend `cockpit-status-strip.test.ts` to verify:

- setup proposal work produces `isLive=true`, `progressMode=determinate`, expected percent
- `creating` wins over lower-priority work and still produces determinate progress
- `working` produces `indeterminate`
- `queued` produces `indeterminate`
- `ready` and `idle` produce `isLive=false` and no progress
- `latestEvent` still summarizes correctly

### Rendering Tests

Extend `Cockpit.test.ts` to verify:

- the `LIVE` badge appears during active work
- the thin progress bar appears during determinate and indeterminate states
- error messaging takes precedence over live messaging
- when work ends, the strip returns to the static non-live presentation

### Why Not Playwright in This Slice

The repository currently uses Vitest-based UI coverage for this area and does not have Playwright set up.

Adding Playwright here would expand the scope into:

- new tooling
- new configuration
- browser test bootstrapping
- CI/runtime decisions unrelated to the core UX correction

That is a reasonable future slice if broader Cockpit interaction coverage becomes necessary, but it is not required to ship this live-status improvement safely.

## Risks and Guardrails

### Risk: Fake Precision

Determinate progress values could be mistaken for exact backend completion.

Guardrail:

- use determinate values only for known ordered setup/create phases
- never claim exact percent completion in text

### Risk: Visual Noise

Adding motion can make Cockpit feel busy or cheap.

Guardrail:

- keep animation subtle
- keep the strip compact
- avoid adding multiple simultaneously animated regions

### Risk: Mixed Signals Between Error and Progress

Users may misread a still-animated strip as success during failure.

Guardrail:

- error state overrides live styling
- error text stays primary when present

## Success Criteria

This slice is successful when:

- users can immediately tell that Cockpit is actively working
- the interface still feels compact
- setup/create phases feel more legible without overstating precision
- binder/draft/discuss long-running work uses the same live pattern
- tests cover both derivation and rendered behavior
