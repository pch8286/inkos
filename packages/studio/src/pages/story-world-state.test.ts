import { describe, expect, it } from "vitest";
import {
  buildDefaultStorySpine,
  buildTickRequest,
  canCompileSceneContract,
  groupMovementCandidates,
  statusLabelForChapter,
} from "./story-world-state";
import type { MovementCandidatePayload, StorySpinePayload } from "../shared/contracts";

const spine: StorySpinePayload = {
  protagonistId: "sera",
  currentGoal: "expose the alibi",
  currentQuestion: "Can Sera move first?",
  emotionalState: ["focused"],
  activeChoices: ["accuse publicly"],
  constraints: ["guild pressure"],
};

const candidate = (id: string, status: MovementCandidatePayload["status"]): MovementCandidatePayload => ({
  id,
  sourceTickId: "tick-1",
  text: `candidate ${id}`,
  relevance: "high",
  visibility: "observed_now",
  risk: "medium",
  conflictLevel: "none",
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
        actionText: "Sera confronts the guild master.",
        storySpine: spine,
      }),
    ).toEqual({
      chapter: 7,
      kind: "protagonist_action",
      protagonistAction: "Sera confronts the guild master.",
    });
  });

  it("requires an approved candidate before compile", () => {
    expect(canCompileSceneContract([candidate("a", "candidate")], ["a"])).toBe(false);
    expect(canCompileSceneContract([candidate("a", "approved")], ["a"])).toBe(true);
  });

  it("labels chapter statuses", () => {
    expect(statusLabelForChapter("draft")).toBe("Draft");
    expect(statusLabelForChapter("locked")).toBe("Locked");
    expect(statusLabelForChapter("published")).toBe("Published");
  });
});
