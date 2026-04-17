# Positive Scene Guidance Design

## Goal

Strengthen both `write next` and manual `revise` so InkOS nudges chapters toward scene-based, concrete, reader-visible prose through positive guidance instead of mostly negative bans.

## Problem

InkOS already contains useful anti-AI and continuity checks, but the current chain is uneven:

- the writer prompt contains some strong craft guidance, but it is inconsistent across languages
- the auditor does not explicitly evaluate scene-vs-summary, explained emotion, or narrator over-conclusion as first-class style concerns
- the reviser mostly reacts to generic audit issues and only the dedicated `anti-detect` mode clearly pushes concrete reactions, sensory detail, and scene experience
- the default `write next` auto-revision loop is still mostly driven by critical issues, so many style-quality warnings survive unchanged
- several prompt sections lean on prohibitions, which helps block obvious failures but does not consistently teach the model what a good replacement looks like

The result is that chapters can pass continuity checks while still feeling over-explained, summarized, or flattened at the scene level.

## Best-Practice Basis

This design follows a shared pattern from writing craft references:

- "show" means specific, concrete, sensory, image-producing detail rather than abstract labels
- important story beats should appear as scenes in lived time, while exposition should connect scenes instead of replacing them
- dialogue is strongest when it carries conflict, pressure, or subtext and is broken up with gesture, reaction, and setting detail
- writers should avoid narrator-side moralizing or verdict language that tells the reader what to think

Research used for this design:

- Vanderbilt Writing Studio: specificity, illustration, and sensory detail as core showing tools
- Purdue OWL creative-writing tutor guide: important interactions belong in scene, dialogue should be broken with gesture/detail, and beginners overuse summary
- Center for Fiction workshop description: scene and exposition both matter, but scenes carry immersive conflict while exposition links and reflects
- MasterClass exposition article: action, sensory detail, dialogue, and indirect characterization are the main practical showing tools

## Design Decision

Shift InkOS from a "ban the bad sentence" posture to a "coach the stronger scene move" posture while keeping a small internal safety net of deterministic bans for format-breaking or obviously synthetic failures.

The system should reinforce the same craft model in four places:

1. `WriterAgent` should describe what strong scene writing looks like in positive terms.
2. `ContinuityAuditor` should explicitly inspect whether key beats are dramatized instead of summarized away.
3. `ReviserAgent` should receive concrete rewrite patterns that convert flat summary into scene-level evidence without demanding full rewrites.
4. The chapter review loop should allow one bounded auto-fix pass for selected actionable style warnings, not only critical continuity failures.

## Scope

Included:

- positive-guidance rewrite of the relevant writer and reviser prompt sections
- stronger auditor instructions for scene-vs-summary, dialogue pressure, emotional externalization, and narrator over-conclusion
- low-risk deterministic warning checks for over-explained prose patterns where false positives are manageable
- one bounded auto-fix path in `write next` for selected style warnings
- manual `inkos revise` alignment with the same guidance model
- regression tests for prompt content, validators, and review-loop behavior

Deferred:

- adding a brand-new numbered audit dimension
- full semantic classification of every exposition block
- LLM scoring rubrics or second-pass specialist judges
- broad hard bans against general explanation language

## Positive Guidance Model

The preferred model should be consistent across `ko`, `zh`, and `en`, adjusted for language-specific examples:

- put the reader inside important beats through action, choice, reaction, and sensory grounding
- let dialogue carry conflict, withholding, bargaining, testing, or pressure when multiple characters share a scene
- express emotion through body, timing, fixation, interruption, avoidance, and changed speech texture before naming the emotion directly
- use exposition as connective tissue: orient, compress time, bridge logistics, or reflect after the important beat, but do not let it replace the beat itself
- when replacing weak prose, prefer concrete substitutions over generic "remove this" orders

This is intentionally not an absolute "never tell" doctrine. Summary and exposition remain valid for transitions, pacing control, and long-span compression. The standard is: key conflict, reversal, payoff, and relationship movement should not be flattened into summary if the chapter is depending on that beat for reader impact.

## Prompt Changes

### Writer

Update the writer prompt so the main craft guidance is framed as preferred moves rather than mainly prohibitions.

Key changes:

- rewrite the Korean guidance to match the stronger scene-oriented specificity already present in Chinese
- replace negative-only wording such as "do not explain relationships only through narration" with positive alternatives such as "when relationships shift, show the shift through direct pressure, hesitation, gesture, or changed speech"
- add explicit guidance that exposition should bridge or position a scene, not consume the emotional center of the scene
- keep a small number of hidden/internal hard bans only where deterministic enforcement is still valuable

### Reviser

Move the reviser prompt toward concrete transformation patterns:

- summary emotion -> physical reaction, sensory cue, interrupted action, or altered line delivery
- crowd summary -> 1-2 specific observed reactions
- relationship explanation -> one short resistance-bearing exchange plus reaction beat
- narrator verdict -> observable consequence or loaded image
- exposition block in a key beat -> compress the setup and dramatize the pivotal moment

The reviser should be told to preserve chapter facts and rhythm while upgrading local vividness, not to inflate every paragraph into lush description.

## Auditor Changes

Strengthen the style-facing audit instructions in `ContinuityAuditor` without changing the public dimension count.

The audit should explicitly examine:

- whether key emotional or relational turns are only reported after the fact
- whether multi-character scenes rely on narrated summary instead of direct pressure or exchange
- whether exposition blocks stop forward motion at moments that should be dramatized
- whether the narrator repeatedly explains motives, stakes, or meaning that the scene already makes inferable

These should surface through existing style-related categories such as `Style Check`, `Dialogue Authenticity Check`, `Chronicle Drift Check`, and `Payoff Dilution Check`, instead of introducing a new dimension ID.

## Deterministic Checks

Add low-risk warning-level rules only. The validator should help locate likely weak spots, not pretend to solve literary judgment deterministically.

Candidate checks:

- Korean and Chinese equivalents of the existing English "multi-character scene with almost no direct exchange" warning
- repeated direct emotion-label constructions in short proximity, where a scene is likely naming emotion instead of externalizing it
- repeated narrator-verdict language patterns that conclude what a moment "meant" instead of showing its consequence

Rules that remain purely ban-based should stay internal and minimal:

- format-breaking output problems
- report-like meta terminology in chapter body
- explicit synthetic markers already covered by existing validators

## Review-Loop Behavior

`write next` should remain conservative, but it should no longer ignore every style warning unless a critical issue exists.

New rule:

- if post-audit results contain selected actionable style warnings, the pipeline may trigger one bounded `spot-fix` pass
- eligible warnings are limited to style-quality issues that can be locally improved without restructuring the chapter
- the revised result is kept only if merged audit quality does not worsen and at least one selected style signal improves

This keeps the auto-fix loop from becoming a broad stylistic rewrite engine while still letting the default path benefit from the new guidance.

Manual `inkos revise` should use the same positive guidance model across `spot-fix`, `rewrite`, and `anti-detect`, with `anti-detect` remaining the most aggressive scene-upgrade mode.

## File Areas Affected

- `packages/core/src/agents/writer-prompts.ts`
- `packages/core/src/agents/continuity.ts`
- `packages/core/src/agents/reviser.ts`
- `packages/core/src/agents/ai-tells.ts`
- `packages/core/src/agents/post-write-validator.ts`
- `packages/core/src/pipeline/chapter-review-cycle.ts`
- `packages/core/src/pipeline/runner.ts`
- `packages/core/src/__tests__/continuity.test.ts`
- `packages/core/src/__tests__/reviser.test.ts`
- `packages/core/src/__tests__/post-write-validator.test.ts`
- `packages/core/src/__tests__/chapter-review-cycle.test.ts`
- `packages/core/src/__tests__/pipeline-runner.test.ts`

## Risks

- if the new guidance is too broad, the reviser may over-ornament prose or bloat chapters
- if deterministic rules are too eager, they will punish legitimate summary and interior narration
- if auto-fix eligibility is too loose, `write next` may start making style edits that feel unstable or surprising
- if language-specific examples drift apart, Korean may again end up weaker than Chinese

## Guardrails

- keep deterministic checks at `warning` or `info` unless they already map to an established hard rule
- limit automatic style repair to one bounded pass
- prefer local rewrites over chapter-wide rewrites in default paths
- explicitly state that exposition is allowed when it bridges time, context, or logistics
- keep examples concrete and replacement-oriented

## Acceptance Criteria

- writer prompts in supported languages describe strong scene-writing moves in positive terms, with Korean no longer materially weaker than Chinese on this topic
- auditor prompts explicitly evaluate scene-vs-summary, dialogue pressure, externalized emotion, and narrator over-conclusion within existing style-related dimensions
- reviser prompts provide concrete local upgrade patterns for turning summary-heavy prose into more scene-based prose
- deterministic validators add only bounded warning-level checks for likely over-explained patterns
- `write next` can perform one bounded auto-fix pass for selected actionable style warnings and keeps the original when quality does not improve
- manual `revise` uses the same positive-guidance craft model
- regression tests cover prompt changes, validator behavior, and the revised review-loop trigger rules
