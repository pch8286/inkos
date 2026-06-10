# Narrative Lab UI Design

## Goal

Add a human-driven Narrative Lab layer before the existing InkOS writer. The first UI slice lives inside Studio and lets the user talk through character voice and director intent, extract canon candidates from those conversations, approve or reject them, and compile approved material into a scene contract that strengthens the existing `story/runtime/chapter-XXXX.intent.md` flow.

## Scope

The MVP includes a Studio page and matching API/data contracts for:

- Book-scoped lab sessions.
- Two conversation modes: `character-chat` and `director-notes`.
- Candidate extraction from saved lab sessions.
- Human decisions on each candidate: `approved`, `rejected`, or `hold`.
- Scene contract creation from approved candidates.
- Compile action that writes an intermediate scene contract and can generate/update the next chapter intent artifact.

The MVP does not replace `WriterAgent`, `PlannerAgent`, `ComposerAgent`, audit, revise, or state settlement. It also does not directly write canonical truth files from chat messages.

## Architecture

Create a small Narrative Lab domain in `@actalk/inkos-core`:

- `models/narrative-lab.ts` defines Zod schemas for `LabSession`, `ChatTurn`, `CanonCandidate`, `CanonDecision`, and `SceneContract`.
- `agents/canon-candidate-extractor.ts` turns one or more lab sessions into candidate cards.
- `agents/scene-contract-builder.ts` turns approved candidates into a scene contract.
- `agents/session-compiler.ts` maps a scene contract into a `ChapterIntent`-compatible markdown artifact.

Persist lab data under each book:

```text
books/<bookId>/story/lab/
  sessions/
  candidates.json
  rejected.json
  approved.json
  scene_contracts/
  chat_summaries/
```

Studio talks to server endpoints backed by the same core models. CLI support can use the same service layer, but the UI slice is prioritized first.

## Studio UI

Add a global Studio route:

```text
?page=lab&bookId=<bookId>
```

The page layout is a dense work surface:

- Left rail: book selector, session list, new session button, mode selector.
- Main pane: tabbed conversation area with `Character Chat` and `Director Notes`.
- Right pane: candidate cards, decision controls, and scene contract status.
- Bottom or header actions: `Extract candidates`, `Build scene contract`, `Compile`.

`Character Chat` is for roleplay/interview with a character. `Director Notes` is for user-as-author planning talk. Both produce the same `LabSession` structure and can feed candidate extraction.

Candidate cards show type, text, evidence, risk, source session, and status. The user can edit candidate text before approving. `approved` candidates are the only candidate records allowed into scene contracts.

## Data Rules

Chat turns are always raw working material. They cannot mutate:

- `story_bible.md`
- `current_state.md`
- `character_matrix.md`
- `pending_hooks.md`

Candidates are non-canonical until approved. Rejected candidates stay in `rejected.json` for auditability. Held candidates stay visible but are excluded from compile.

Scene contracts may reference candidate ids and evidence, but canonical truth files are updated only through existing explicit truth-file/editor flows or post-write state settlement.

## Compile Flow

The UI compile action:

1. Loads approved candidates selected for the target chapter.
2. Builds a `SceneContract`.
3. Saves it under `story/lab/scene_contracts/scene-XXXX.json`.
4. Renders a chapter intent markdown block compatible with `loadPersistedPlan`.
5. Writes or updates `story/runtime/chapter-XXXX.intent.md`.

Existing `PipelineRunner.writeDraft()` can then reuse the persisted intent when no external context is supplied. This preserves the current writer/audit/revise pipeline.

## Image Generation Extension

Character or scene image generation is not part of the first required path. The UI should leave room for a later `Generate visual` action on character/session/scene panels. That action should route through the authenticated provider layer, including OAuth-backed image generation when available, rather than making the Narrative Lab own provider credentials.

## API Shape

Add server endpoints under `/books/:bookId/lab`:

- `GET /sessions`
- `POST /sessions`
- `GET /sessions/:sessionId`
- `POST /sessions/:sessionId/turns`
- `POST /sessions/:sessionId/extract`
- `GET /candidates`
- `PATCH /candidates/:candidateId`
- `POST /scene-contracts`
- `POST /scene-contracts/:sceneContractId/compile`

All route inputs validate with shared contracts or core Zod schemas before touching disk.

## Testing

Use TDD for the implementation:

- Core model tests validate schema defaults, invalid statuses, and compile-safe candidate filtering.
- Core service/agent tests verify chat sessions never mutate truth files.
- Compiler tests verify approved candidates render into `ChapterIntent` sections and held/rejected candidates are excluded.
- Studio API tests cover CRUD, extraction persistence, candidate decisions, and compile artifact paths.
- Studio UI tests cover route parsing, tab switching, candidate decisions, and disabled compile states when no approved candidates exist.

## Non-Goals

- No standalone Cockpit-style Lab app in the first slice.
- No automatic canonical truth-file mutation from chat or candidates.
- No WriterAgent rewrite.
- No production image-generation implementation in the first UI slice.
