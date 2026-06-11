# Story Progress Console Design

## Goal

Reframe Story World Lab from a world-reaction candidate board into a high-level story progress console.

The user should be able to guide the story naturally, like talking to an editor or director, without asking for immediate prose every turn. The system should respond with the next plausible story movement, usable material from the current context, and clear options for saving or drafting scenes.

Default behavior is not prose generation. Default behavior is story progression.

```text
User high-level direction
-> Director Console response
-> Proposed story progress
-> Usable material shelf
-> Optional scene draft
-> Approved scene contract
-> Existing InkOS writer/audit/revise/state settlement
```

## Product Position

The best-practice workflow is:

```text
story bible / setting reference
+ current story progress
+ user direction
-> high-level next movement
-> scene-worthy beat
-> scene draft only on request
-> canonical write only after approval
```

This keeps the console flexible while preventing the model from turning every message into premature first-draft prose.

## Layer Boundaries

### 1. Director Console

The Director Console is the primary chat surface.

It accepts high-level user input such as:

- "주인공이 침묵하면 도시가 어떻게 흔들릴까?"
- "이건 너무 수동적인데 주인공 선택이 더 강했으면 좋겠어."
- "다음 진행은 소문이 되돌아오는 쪽이 자연스러운가?"

The default assistant reply should include:

- a short story-progress proposal,
- why it follows from the current context,
- usable material that can be carried forward,
- whether it is scene-worthy,
- available next actions.

It should not automatically write a full prose scene unless the user asks for one.

### 2. Story Progress Layer

Story Progress is the high-level record of what has happened or what the user has accepted as the next direction.

It is not prose and not canon by itself. It is a structured planning layer.

Example:

```text
주인공의 침묵은 도시의 불안을 키운다. 소문은 공식 통제에서 벗어나기 시작하고, 다음 장면에서 주인공에게 되돌아올 압박을 만든다.
```

Story Progress entries can be:

- proposed,
- accepted,
- held,
- revised,
- discarded,
- promoted into a scene draft.

### 3. Usable Material Shelf

The Usable Material Shelf is a console-side inventory of material that can be used in upcoming scenes.

It should collect story-relevant items from:

- accepted progress,
- existing story bible / setting notes,
- current state,
- pending hooks,
- character matrix,
- previous chapter summaries,
- user chat turns,
- approved movement candidates.

Material types:

- character pressure,
- relationship tension,
- world fact,
- active hook,
- location detail,
- emotional state,
- clue or rumor,
- scene seed,
- style or tone note.

The shelf is not canon. It is a "currently usable" working set.

### 4. Scene Draft Layer

Scene Drafts are optional prose drafts generated from accepted progress or selected usable material.

They are separate from Story Progress.

Scene Drafts can have multiple versions and should not mutate chapter text or truth files.

Statuses:

- draft,
- saved,
- accepted,
- rejected,
- superseded.

Only accepted scene drafts may be compiled toward the existing InkOS write flow.

### 5. Canon / Writer Layer

The existing InkOS writer pipeline remains the canonical prose path.

Approved scene material should compile into a scene contract or runtime chapter intent, then go through:

```text
InkOS Writer
-> audit
-> revise
-> state settlement
-> post-write validation
```

Director Console output, Story Progress, Usable Material, and Scene Drafts must not directly mutate:

- `story_bible.md`
- `current_state.md`
- `character_matrix.md`
- `pending_hooks.md`
- published chapter text.

## Default Console Response Shape

The assistant response in the console should favor this shape:

```text
진행 제안:
주인공의 침묵은 도시의 불안을 키우고, 소문은 주인공이 통제하지 못하는 방향으로 번진다.

왜 자연스러운가:
현재 축이 "주인공이 행동하지 않을 때 세계가 어떻게 압박하는가"이기 때문이다.

사용 가능 재료:
- 도시의 소문
- 주인공의 침묵
- 공식 발표와 실제 민심의 어긋남
- 다음 장면에서 주인공에게 되돌아오는 압박

소설화 가능성:
가능. "소문이 주인공에게 되돌아오는 장면"으로 잡는 것이 좋다.

다음 액션:
- 이 진행 저장
- 방향 수정
- 장면 초안 생성
- 폐기
```

The UI can render these as structured cards, but the underlying model should keep them as separate records.

## Data Model

Suggested initial models:

```ts
type StoryProgressStatus =
  | "proposed"
  | "accepted"
  | "held"
  | "revised"
  | "discarded";

type StoryProgress = {
  id: string;
  sourceTurnIds: string[];
  summary: string;
  rationale: string[];
  currentQuestion?: string;
  protagonistState?: string;
  pressureChange?: string;
  usableMaterialIds: string[];
  sceneWorthiness: "none" | "possible" | "strong";
  status: StoryProgressStatus;
  createdAt: string;
  updatedAt: string;
};

type UsableMaterialType =
  | "character_pressure"
  | "relationship_tension"
  | "world_fact"
  | "active_hook"
  | "location_detail"
  | "emotional_state"
  | "clue_or_rumor"
  | "scene_seed"
  | "style_note";

type UsableMaterial = {
  id: string;
  type: UsableMaterialType;
  text: string;
  sourceIds: string[];
  usableFor: string[];
  risk: "low" | "medium" | "high";
  status: "available" | "used" | "held" | "discarded";
  createdAt: string;
  updatedAt: string;
};

type SceneDraftStatus =
  | "draft"
  | "saved"
  | "accepted"
  | "rejected"
  | "superseded";

type SceneDraft = {
  id: string;
  progressIds: string[];
  materialIds: string[];
  title?: string;
  sceneGoal: string[];
  prose: string;
  status: SceneDraftStatus;
  createdAt: string;
  updatedAt: string;
};
```

Existing `LabChatTurn`, `MovementCandidate`, and `SceneContract` remain useful, but they should no longer be the center of the product.

`MovementCandidate` becomes a debug/analysis artifact.

`StoryProgress` becomes the main accepted planning artifact.

`SceneDraft` becomes the prose sandbox.

## Persistence

Persist this layer under:

```text
books/<bookId>/story/lab/
  chat_turns.json
  story_progress.json
  usable_material.json
  scene_drafts/
  scene_contracts/
  movement_candidates.json
  ticks/
```

`story_progress.json` should store high-level accepted and proposed movements.

`usable_material.json` should store the shelf of reusable story material.

`scene_drafts/` should store prose drafts separately from chapter files.

## UI Direction

The first viewport should be:

- Director Console transcript,
- composer,
- latest story progress proposal,
- compact usable material shelf,
- clear action buttons.

Primary actions:

- `진행 저장`
- `방향 수정`
- `소설화`
- `장면으로 저장`
- `폐기`

Secondary/debug actions:

- view movement candidates,
- view ticks,
- edit Story Spine,
- edit World Pressures,
- compile scene contract.

Scene drafting should be an explicit action. The console should not produce a full scene draft by default.

## API Direction

Proposed new endpoints:

```text
POST /api/books/:id/lab/director-turns
POST /api/books/:id/lab/story-progress
PATCH /api/books/:id/lab/story-progress/:progressId
GET /api/books/:id/lab/usable-material
POST /api/books/:id/lab/scene-drafts
PATCH /api/books/:id/lab/scene-drafts/:draftId
POST /api/books/:id/lab/scene-drafts/:draftId/compile
```

`POST /lab/director-turns` should return:

- persisted user turn,
- assistant/director turn,
- proposed StoryProgress,
- extracted UsableMaterial,
- optional debug MovementCandidates.

The existing `/lab/chat-turns` endpoint can remain temporarily, but the product-level flow should move toward `director-turns` because the output is not just a world reply; it is a structured story-progress proposal.

## Error Handling And Guardrails

- Empty user input should be rejected.
- Console output should not directly write canonical truth files.
- Scene draft generation should require either accepted progress or explicit user confirmation.
- Compiling a scene draft should require accepted status.
- Published chapters remain immutable unless the user enters an explicit retcon or edition flow.
- If a proposed progress conflicts with existing canon, produce a conflict note and keep the progress in `proposed` or `held` state.

## Testing

Core tests should cover:

- StoryProgress schema parsing,
- UsableMaterial schema parsing,
- SceneDraft schema parsing,
- accepted progress can feed scene draft creation,
- discarded progress cannot compile,
- accepted scene draft can compile to scene contract,
- StoryProgress cannot compile directly into the writer flow,
- movement candidates are not required for normal story progress.

Studio API tests should cover:

- director turn creates proposed StoryProgress,
- Korean default response does not mix English fallback text,
- accepting progress persists it without mutating truth files,
- scene draft generation writes only `scene_drafts/`,
- compile requires accepted scene draft,
- compile writes runtime intent but not chapter text.

UI tests should cover:

- console defaults to progress proposal, not prose draft,
- usable material shelf appears as a working set,
- scene draft action is explicit,
- debug movement candidates are not the primary UI.

## Non-Goals

- No automatic first-draft prose on every chat turn.
- No automatic story bible mutation from console chat.
- No generic world simulator dashboard as the primary experience.
- No replacement of the existing InkOS WriterAgent.
- No Studio image generation in this slice.
