import { describe, expect, it } from "vitest";
import {
  buildChatTickRequest,
  buildDefaultStorySpine,
  buildDefaultStorySpineFromDirection,
  buildTickRequest,
  buildWorldDirectorTranscript,
  canCompileSceneContract,
  groupMovementCandidates,
  hasSelectedConflictRisk,
  linesValue,
  parseLines,
  statusLabelForChapter,
} from "./story-world-state";
import type { AdaptiveTickPayload, MovementCandidatePayload } from "../shared/contracts";

const candidate = (
  id: string,
  status: MovementCandidatePayload["status"],
  conflictLevel: MovementCandidatePayload["conflictLevel"] = "none",
): MovementCandidatePayload => ({
  id,
  sourceTickId: "tick-1",
  text: `candidate ${id}`,
  relevance: "high",
  visibility: "observed_now",
  risk: "medium",
  conflictLevel,
  status,
  affectedChapters: [3],
  affectedStateKeys: ["story_spine.currentQuestion"],
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
});

const tick = (
  candidates: ReadonlyArray<MovementCandidatePayload>,
  overrides: Partial<AdaptiveTickPayload> = {},
): AdaptiveTickPayload => ({
  id: "tick-1",
  bookId: "demo",
  chapter: 3,
  kind: "direction_override",
  userDirection: "Reveal pressure through a public mistake.",
  storySpine: {
    protagonistId: "sera",
    currentGoal: "pressure the guild",
    currentQuestion: "How does the world answer?",
    emotionalState: [],
    activeChoices: [],
    constraints: [],
  },
  worldPressures: [],
  createdAt: "2026-06-10T00:00:00.000Z",
  candidates,
  ...overrides,
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
    expect(
      groupMovementCandidates([
        candidate("a", "candidate"),
        candidate("b", "approved"),
        candidate("c", "rejected"),
        candidate("d", "hold"),
      ]),
    ).toEqual({
      candidate: [candidate("a", "candidate")],
      approved: [candidate("b", "approved")],
      hold: [candidate("d", "hold")],
      rejected: [candidate("c", "rejected")],
    });
  });

  it("builds a protagonist action tick request", () => {
    expect(
      buildTickRequest({
        chapter: 7,
        kind: "protagonist_action",
        actionText: "  Sera confronts the guild master.  ",
      }),
    ).toEqual({
      chapter: 7,
      kind: "protagonist_action",
      protagonistAction: "Sera confronts the guild master.",
    });
  });

  it("builds other tick request kinds", () => {
    expect(
      buildTickRequest({
        chapter: 8,
        kind: "protagonist_inaction",
        actionText: "Sera waits for the guild to reveal itself.",
      }),
    ).toEqual({
      chapter: 8,
      kind: "protagonist_inaction",
      protagonistInaction: "Sera waits for the guild to reveal itself.",
    });

    expect(
      buildTickRequest({
        chapter: 9,
        kind: "elapsed_time",
        actionText: "Three nights pass.",
      }),
    ).toEqual({
      chapter: 9,
      kind: "elapsed_time",
      elapsedTime: "Three nights pass.",
    });

    expect(
      buildTickRequest({
        chapter: 10,
        kind: "direction_override",
        actionText: "Reveal the hidden ledger.",
      }),
    ).toEqual({
      chapter: 10,
      kind: "direction_override",
      userDirection: "Reveal the hidden ledger.",
    });
  });

  it("builds a chat tick request as a direction override", () => {
    expect(
      buildChatTickRequest({
        chapter: 3,
        text: "  Let the city react quietly.  ",
      }),
    ).toEqual({
      chapter: 3,
      kind: "direction_override",
      userDirection: "Let the city react quietly.",
    });
  });

  it("bootstraps a Story Spine from the first chat direction", () => {
    expect(buildDefaultStorySpineFromDirection("  Make the witness force Sera to choose.  ")).toEqual({
      protagonistId: "Protagonist",
      currentGoal: "Make the witness force Sera to choose.",
      currentQuestion: "How does the world respond now?",
      emotionalState: [],
      activeChoices: [],
      constraints: [],
    });
  });

  it("builds a World Director transcript from adaptive ticks", () => {
    const transcript = buildWorldDirectorTranscript([
      tick([
        {
          ...candidate("a", "candidate"),
          text: "The guild makes a visible mistake.",
        },
        {
          ...candidate("b", "hold"),
          text: "A rival clerk notices the opening.",
        },
      ]),
    ]);

    expect(transcript).toEqual([
      {
        id: "tick-1-user",
        role: "user",
        chapter: 3,
        text: "Reveal pressure through a public mistake.",
        createdAt: "2026-06-10T00:00:00.000Z",
        tags: ["Direction"],
      },
      {
        id: "tick-1-world",
        role: "world",
        chapter: 3,
        text: "The guild makes a visible mistake.\nA rival clerk notices the opening.",
        createdAt: "2026-06-10T00:00:00.000Z",
        candidateIds: ["a", "b"],
        tags: ["2 candidates"],
      },
    ]);
  });

  it("parses and formats line values", () => {
    expect(parseLines(" focused \n\n uneasy\n\tcommitted ")).toEqual(["focused", "uneasy", "committed"]);
    expect(linesValue(["focused", "uneasy", "committed"])).toBe("focused\nuneasy\ncommitted");
  });

  it("preflights selected candidate approvals before compile", () => {
    expect(canCompileSceneContract([candidate("a", "candidate")], [])).toBe(true);
    expect(canCompileSceneContract([candidate("a", "candidate")], ["a"])).toBe(false);
    expect(canCompileSceneContract([candidate("a", "approved")], ["a"])).toBe(true);
    expect(canCompileSceneContract([candidate("a", "approved")], ["missing"])).toBe(false);
    expect(canCompileSceneContract([candidate("a", "approved"), candidate("b", "hold")], ["a", "b"])).toBe(false);
  });

  it("flags selected candidate conflict risk without blocking compile", () => {
    expect(
      hasSelectedConflictRisk([candidate("a", "approved", "none"), candidate("b", "approved", "minor")], ["a"]),
    ).toBe(false);
    expect(
      hasSelectedConflictRisk([candidate("a", "approved", "none"), candidate("b", "approved", "minor")], ["b"]),
    ).toBe(true);
    expect(hasSelectedConflictRisk([candidate("a", "approved", "major")], [])).toBe(false);
    expect(hasSelectedConflictRisk([candidate("a", "approved", "major")], ["missing"])).toBe(false);
  });

  it("labels chapter statuses", () => {
    expect(statusLabelForChapter("draft")).toBe("Draft");
    expect(statusLabelForChapter("locked")).toBe("Locked");
    expect(statusLabelForChapter("published")).toBe("Published");
  });
});
