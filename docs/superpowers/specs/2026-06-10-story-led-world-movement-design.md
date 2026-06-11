# Story-Led World Movement Design

## Goal

Replace the character-chat Narrative Lab framing with a story-led World Director layer for InkOS. The new layer keeps the protagonist and current story question as the primary axis, while the user drives the world through a chat surface and the world continues to move as pressure, consequence, opportunity, and delayed fallout.

InkOS should not become a generic world simulator or a form-heavy tick editor. It should become a human-driven story compiler where the user acts as the final authority, the protagonist drives the camera, chat is the primary interaction, and world movement produces story-relevant candidates for approval.

## Core Position

The story is primary. The world is alive, but it is not the main output.

```text
Protagonist / story = camera, desire, question, choice
World simulation = pressure, reaction, consequence, opportunity
User = final authority over direction and canon
```

The system may propose natural consequences, offscreen movement, and continuity repairs, but it must not decide canon without user approval.

The chat transcript is the source of truth for lab interaction. Adaptive ticks, movement candidates, impact reports, and scene contracts are structured artifacts produced from that transcript.

## Product Model

The previous `Narrative Lab` concept centered on character chat and director notes. This design supersedes that framing for the main experience: it is not character chat, but it should still feel chat-driven. The user talks to the story-world/director surface; the system replies with world reaction plus structured candidate attachments.

The main experience should be a `Story World Lab` or equivalent work surface:

- `World Director Chat`: the primary transcript where the user tells the world what happens, what the protagonist tries, or how direction should change.
- `World Reply`: a natural-language response summarizing the immediate world/story reaction.
- `Movement Candidate Attachments`: proposed world/story consequences attached to world replies, with approve, hold, reject, and select controls inline.
- `Story Spine`: protagonist goal, current chapter question, emotional state, active choice. It may be bootstrapped from the first chat message and refined later.
- `World Pressure`: factions, locations, hooks, timers, offscreen actors, environmental pressures. These are advanced controls, not required before chat can start.
- `Adaptive Tick`: internal consequence generation based on protagonist action, inaction, user direction, or time passage inferred from chat.
- `Canonization Gate`: approve, hold, reject, or request repair before anything becomes scene-contract material.
- `Scene Contract`: protagonist-facing instructions for the existing InkOS writer.

Character chat can remain as an optional input source later, but it should not be the product's center. The product center is user-driven story-world direction through chat.

## Adaptive Tick Semantics

A tick is not a fixed time unit. A tick is the story/world reaction caused by protagonist action, protagonist inaction, explicit user direction, or meaningful time passage.

```text
User chat direction
-> Story Spine bootstrap or update
-> Adaptive Tick
-> World reply with candidate attachments
-> User approval / hold / reject / follow-up direction
-> Regenerated or reweighted candidates
-> User approval
-> Scene contract
-> InkOS writer
```

When the protagonist acts, the tick should primarily answer: "What changes because of this?"

When the protagonist does nothing, the tick should treat inaction as a real choice:

- hostile actors continue preparing,
- relationships cool or misunderstandings deepen,
- opportunities expire or mutate,
- rumors spread,
- delayed consequences surface.

World-only movement is allowed, but it is secondary. It should be filtered through story relevance before it reaches the user.

## Story Relevance Filter

World movement should become visible only when it matters to the story. Every movement candidate should answer at least one of these questions:

- Does this pressure the protagonist's current goal?
- Does this affect the current chapter or scene question?
- Does this move an active hook closer to payoff?
- Does this change a location the protagonist may enter soon?
- Does this create a clue, rumor, obstacle, opportunity, or consequence?
- Should the protagonist observe it now, later, indirectly, or not yet?

The output should be `story-relevant movement`, not a raw simulation log.

## User Direction Override

The user must be able to steer the story at candidate time.

Example:

```text
This is too passive. Keep the conflict, but make the protagonist choose a more active counter-move.
```

The override should not immediately mutate canon. It should change candidate generation and ranking:

```text
Existing candidates
-> Apply direction override
-> Reweight, regenerate, or discard candidates
-> Present revised candidates
-> Wait for approval
```

The default authority of a direction override is forward-only: it can change unapproved candidates, future scene contracts, and the next tick. It cannot rewrite published canon unless the user explicitly enters a retcon flow.

## Canon And Retcon Modes

InkOS should distinguish draft work from serialized work.

### Draft Mode

Draft mode is the default for new projects and unpublished chapters.

- Previous draft chapters may be rewritten.
- State, summaries, hooks, relationships, and world state may be recalculated.
- Cascade retcon is allowed after user approval.
- Impact reporting is still required when a change conflicts with existing material.

### Serialized Mode

Serialized mode applies to locked or published chapters.

- Published chapter text is immutable.
- Published canon becomes a hard constraint for future ticks.
- Changes should be handled through forward movement, hidden information, reinterpretation, new clues, or continuity patches.
- A true rewrite should be treated as a separate edition or explicit retcon plan, not an automatic mutation.

Chapter status should be explicit:

```text
draft
locked
published
```

The default project mode is `Draft Mode`. When the user locks or publishes a chapter, `Serialized Mode` rules apply to that chapter and all story state derived from it.

## Conflict Handling

The user can ask for any change. The system must not hide conflicts.

When a requested direction conflicts with existing story material, InkOS should produce an impact report before changing canon:

- affected chapters,
- affected state files,
- affected hooks,
- affected relationships,
- affected world assumptions,
- available repair strategies.

Repair options should include:

- `Forward Bend`: keep the past and change future direction.
- `Soft Reveal`: keep past text but reveal hidden motive, misunderstanding, or incomplete information.
- `Continuity Patch`: add a scene, line, clue, or consequence to bridge the conflict.
- `Local Rewrite`: rewrite specific draft scenes or chapters.
- `Cascade Retcon`: recalculate draft chapters, summaries, hooks, and state.
- `Edition Retcon`: plan a separate revised edition for published material.

The recommended default is:

```text
No conflict -> generate candidates normally
Small conflict -> prefer Forward Bend or Soft Reveal
Large conflict in draft -> ask for Local Rewrite or Cascade Retcon approval
Large conflict in serialized work -> prefer Continuity Patch or Edition Retcon plan
```

## Data Model Additions

The existing lab models should be revised or extended around story/world movement rather than character chat.

Suggested core records:

```ts
type ProjectStoryMode = "draft" | "serialized";
type ChapterPublicationStatus = "draft" | "locked" | "published";

type StorySpine = {
  protagonistId: string;
  currentGoal: string;
  currentQuestion: string;
  emotionalState: string[];
  activeChoices: string[];
  constraints: string[];
};

type WorldPressure = {
  id: string;
  type: "faction" | "character" | "location" | "hook" | "environment";
  label: string;
  currentMotion: string;
  pressureLevel: "low" | "medium" | "high";
  visibleToProtagonist: "yes" | "no" | "partial";
};

type AdaptiveTickInput = {
  protagonistAction?: string;
  protagonistInaction?: string;
  elapsedTime?: string;
  userDirection?: string;
  storySpine: StorySpine;
  worldPressures: WorldPressure[];
};

type LabChatTurn = {
  id: string;
  role: "user" | "world";
  text: string;
  chapter?: number;
  sourceTickId?: string;
  movementCandidateIds: string[];
  createdAt: string;
};

type MovementCandidate = {
  id: string;
  sourceTickId: string;
  text: string;
  relevance: "low" | "medium" | "high";
  visibility: "observed_now" | "rumor" | "hidden" | "delayed";
  risk: "low" | "medium" | "high";
  conflictLevel: "none" | "minor" | "major";
  status: "candidate" | "approved" | "rejected" | "hold";
  affectedChapters: number[];
  affectedStateKeys: string[];
};
```

`MovementCandidate` replaces the old candidate center of gravity. Approved candidates can still compile into scene contracts, but they should carry story relevance, visibility, and conflict impact.

## Persistence

Persist the layer under the existing book story directory:

```text
books/<bookId>/story/lab/
  chat_turns.json
  story_spine.json
  project_mode.json
  chapter_status.json
  world_pressures.json
  ticks/
  movement_candidates.json
  direction_overrides.json
  impact_reports/
  scene_contracts/
```

The layer must not directly mutate these canonical files without an explicit approved flow:

- `story_bible.md`
- `current_state.md`
- `character_matrix.md`
- `pending_hooks.md`
- published chapter text

## UI Direction

The Studio page should be organized around a chat-first World Director surface. It should not ask for chapter, tick kind, protagonist action, and world state before the user can begin.

Recommended layout:

- Main: World Director chat transcript and composer.
- Inline with world replies: movement candidate attachments with approve, hold, reject, and select controls.
- Collapsed planning queue: candidate groups, scene contract form, compile output.
- Collapsed debug board: latest tick, impact reports, chapter status, selected candidate internals.
- Collapsed advanced state controls: Story Spine and World Pressure editors.

Primary actions:

- `Send` a world/story direction in chat.
- `Approve`, `Hold`, or `Reject` movement candidates directly under a world reply.
- `Select` approved candidates for scene contract material.
- `Build scene contract`
- `Compile intent`
- `Lock chapter`

Chat submit should create or update lab artifacts, but character/world chat must not directly mutate canonical truth files. Only approved candidate material may flow into scene contracts and then the existing InkOS write pipeline.
- `Publish chapter`

### 2026-06-11 Chat-First Revision

The first Studio slice made the model visible, but it also made the user fill too many fields before the world could respond. The revised surface should feel like a director room: the main interaction is a chat composer where the user tells the world what the protagonist does, leaves undone, or wants to bend toward.

`Story Spine` and `World Pressure` remain part of the model, but they move behind progressive controls. If no Story Spine exists, the first chat message should bootstrap a minimal valid spine instead of forcing the user to fill a form. Candidate movement, conflict reports, and scene-contract fields stay visible, but primarily as a right-side debug and approval board.

Revised layout:

- Center: `World Director` transcript, latest user direction, world response summary, and composer.
- Composer: chapter picker, optional tick kind, freeform direction text, send action.
- Right: debug board with latest world reaction, movement candidates, selected approved candidates, scene intent, scene contract preview, and compile actions.
- Advanced controls: collapsible Story Spine and World Pressure editors for repair and debugging, not mandatory first-run input.

This revision keeps the core rule unchanged: chat output and world reactions are candidates until the user approves them. The chat surface may create ticks and scene-contract drafts, but it must not directly mutate canonical story files or published chapter text.

## Integration With Existing InkOS Writer

The existing writer/audit/revise/state-settlement pipeline should remain intact.

The new layer should compile approved movement into the same kind of runtime intent artifact used by the writer:

```text
Story Spine
+ Approved Movement Candidates
+ User Direction
+ Conflict/repair constraints
-> Scene Contract
-> story/runtime/chapter-XXXX.intent.md
-> existing plan/compose/write/audit/revise flow
```

WriterAgent should not be rewritten for this design. The pre-writing layer should produce stronger `ChapterIntent` material and constraints.

## Testing

Core tests should cover:

- tick input parsing,
- inaction tick behavior,
- story relevance filtering,
- direction override reweighting,
- approved-only scene contract compile,
- draft versus serialized conflict policy,
- published chapters being immutable by default.

Studio API tests should cover:

- story spine persistence,
- world pressure persistence,
- tick creation,
- movement candidate decisions,
- conflict impact report generation,
- serialized mode blocking direct published chapter mutation,
- compile writing only runtime intent and lab artifacts.

Studio UI tests should cover:

- editing story spine,
- submitting protagonist action,
- applying direction override,
- building a chat transcript from adaptive ticks,
- bootstrapping a minimal Story Spine from the first user direction,
- approving and rejecting movement candidates,
- viewing impact reports,
- disabled rewrite actions for published chapters,
- scene contract compile availability.

## Non-Goals

- No generic always-on simulation log in the main UI.
- No automatic canon mutation from tick output.
- No published chapter rewrite without explicit edition or retcon flow.
- No WriterAgent replacement.
- No image generation in this design slice.
