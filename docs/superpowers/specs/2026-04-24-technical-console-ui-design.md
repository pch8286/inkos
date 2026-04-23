# Technical Console UI Design

## Context

The user selected the `Technical Console` direction for InkOS Cockpit and Studio after reviewing three visual options and a gpt-image reference mockup.

Generated reference:

- Preview path: `.superpowers/brainstorm/666718-1776985200/content/assets/technical-console-cockpit.png`
- Source path: `/home/chanho/.codex/generated_images/019dbc90-a684-7260-819e-1ad14e5a0b8d/ig_081ed561f0850af40169eaa507d9a88191ab7e45d7565c5f85.png`
- Intent: visual reference only. The generated text and exact layout are not source copy.

The repo already has ongoing uncommitted Cockpit entrypoint and layout work. Implementation must preserve existing behavior and avoid reverting user changes.

## Goal

Turn Cockpit into a compact command-console writing operations surface and align Studio's shared visual language with that direction.

The result should feel CLI-adjacent and data-dense, while still being a usable local web workbench for novel operations.

## Non-Goals

- Do not turn every Studio page into a raw terminal emulator.
- Do not replace existing API contracts or routing behavior.
- Do not rewrite Cockpit business logic unless required for presentation wiring.
- Do not use the generated mockup text as product copy.
- Do not introduce decorative gradients, orbs, or marketing hero sections.

## Visual Direction

Use a dark graphite console foundation:

- Backgrounds: deep graphite and charcoal surfaces.
- Borders: crisp 1px separators with restrained contrast.
- Accents: muted cyan/green for active, success, commands, and focus.
- Warnings: compact amber indicators.
- Destructive states: restrained red, mostly used inside diffs/errors.
- Typography: readable sans-serif for body text; monospace only for commands, logs, file paths, metadata, counters, and diff-like content.
- Density: compact but not cramped. Controls should keep stable dimensions and avoid text clipping in Korean and English.

## Cockpit Architecture

Cockpit becomes a five-part console shell:

1. Left navigation rail
   - Compact Studio navigation with active Cockpit emphasis.
   - Book/setup selection remains available, but should be visually secondary to the active work surface.

2. Top status strip
   - Active book, mode, provider/model, context budget, warnings, queue count, and latest save/run status.
   - This replaces the current atmospheric hero treatment.

3. Central work log
   - Main conversation/log timeline remains dominant.
   - Empty and quick-start states should look like operational prompts, not marketing panels.
   - Message bubbles become flatter console entries with role labels, timestamps, and compact content.

4. Bottom command composer
   - Fixed or visually anchored command input.
   - Slash-command chips for `/draft`, `/propose`, `/ask`, `/context`, `/binder`, `/queue`, `/diff`, `/log`, and `/help` where supported by existing actions.
   - Existing queue shortcuts and submit behavior stay intact.

5. Right inspector
   - Tabbed inspector for focus, setup, changes, and activity.
   - Pending binder/truth changes should read like a diff/review panel.
   - Truth file and activity sections should be compact lists with clear status tags.

## Studio-Wide Alignment

Shared Studio styling should move from the current parchment/literary palette toward the technical console palette:

- Update global theme tokens in `packages/studio/src/index.css`.
- Keep common component class names such as `studio-chip`, `studio-badge-*`, `studio-surface-*`, and button classes where possible.
- Sidebar, page chrome, command/status chips, and compact panels should adopt the same graphite/cyan/amber language.
- Existing functional pages should remain recognizable and usable; broad page rewrites are out of scope unless necessary for shared tokens.

## Components and Boundaries

Implementation should reuse and refine the current Cockpit split:

- `packages/studio/src/pages/Cockpit.tsx`
- `packages/studio/src/pages/cockpit/CockpitHeaderSection.tsx`
- `packages/studio/src/pages/cockpit/CockpitLeftRail.tsx`
- `packages/studio/src/pages/cockpit/CockpitMainConversation.tsx`
- `packages/studio/src/pages/cockpit/CockpitInspectorPanel.tsx`
- `packages/studio/src/components/Sidebar.tsx`
- `packages/studio/src/index.css`

Prefer presentation changes inside the Cockpit section components and global tokens. Keep hooks, persistence, routing, and API calls stable.

## Data Flow

Existing data flow stays unchanged:

- `Cockpit.tsx` owns orchestration state, selected book/mode, setup state, proposal state, queue state, and API responses.
- Presentational components receive derived props and render the console layout.
- `CockpitStandaloneApp.tsx` remains the dedicated `/cockpit/` shell.
- Studio routes continue to redirect legacy `?page=cockpit` routes to the standalone Cockpit entrypoint.

## Error Handling

Errors should be more visible in the console model:

- Inline API or action errors render as compact red/amber console notices near the composer or status strip.
- Latest SSE error state remains surfaced in the main workflow.
- Book creation errors in navigation/status areas should remain readable without expanding layout.
- No error state should rely only on color; preserve labels, icons, and text.

## Accessibility and Responsive Behavior

- Preserve semantic `role="log"` behavior in the main conversation.
- Keep form labels and `aria-describedby` wiring for the composer.
- Ensure keyboard submit and queue shortcuts remain tested.
- At mobile widths, stack left rail, main work log, and inspector without horizontal scrolling.
- Avoid text overlap and clipped Korean labels by using stable min/max widths, wrapping, and truncation only on non-critical metadata.

## Testing

Targeted tests should cover the changed surface without expanding unrelated suites:

- Existing Cockpit state/helper tests:
  - `src/pages/cockpit-ui-state.test.ts`
  - `src/pages/cockpit-status-strip.test.ts`
  - `src/pages/cockpit-queue-state.test.ts`
  - `src/pages/cockpit-parsing.test.ts`
- Component tests for affected Cockpit presentation:
  - `src/pages/cockpit/CockpitMainConversation.test.ts`
  - `src/pages/cockpit/CockpitLiveStatusStrip.test.ts`
  - existing `Cockpit.test.ts` and `CockpitStandaloneApp.test.ts` where route or shell assumptions are touched
- Run Studio typecheck after implementation.
- If a dev server is started, visually verify `/cockpit/` and the Studio shell at desktop and mobile widths.

## Acceptance Criteria

- Cockpit no longer presents an atmospheric hero; it opens as a compact technical console.
- The generated C-direction mockup is recognizably reflected in layout hierarchy, palette, and density.
- Studio shared chrome uses the same graphite/cyan/amber visual system.
- Existing Cockpit routing, setup recovery, queue behavior, and command submission continue to work.
- Tests and typecheck pass, or any unrelated pre-existing failures are documented with evidence.
