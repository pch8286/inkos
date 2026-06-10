import { describe, expect, it } from "vitest";
import {
  buildDefaultStorySpine,
  buildTickRequest,
  canCompileSceneContract,
  groupMovementCandidates,
  hasSelectedConflictRisk,
  linesValue,
  parseLines,
  statusLabelForChapter,
} from "./story-world-state";
import type { MovementCandidatePayload } from "../shared/contracts";

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
