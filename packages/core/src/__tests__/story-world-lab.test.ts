import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AdaptiveTickInputSchema,
  MovementCandidateSchema,
  SceneContractSchema,
  createAdaptiveTick,
  filterApprovedMovementCandidates,
  renderStoryWorldIntentMarkdown,
  validateSceneContractAgainstChapterStatus,
} from "../index.js";
import { loadPersistedPlan } from "../pipeline/persisted-governed-plan.js";

const now = "2026-06-10T12:00:00.000Z";

describe("story world lab", () => {
  it("parses a protagonist-led tick input", () => {
    const parsed = AdaptiveTickInputSchema.parse({
      id: "tick-1",
      bookId: "demo",
      chapter: 4,
      kind: "protagonist_action",
      protagonistAction: "Sera exposes the false alibi in front of the guild.",
      storySpine: {
        protagonistId: "sera",
        currentGoal: "prove the alibi was manufactured",
        currentQuestion: "Can Sera act before the guild closes ranks?",
        emotionalState: ["angry but controlled"],
        activeChoices: ["public accusation", "private bargain"],
        constraints: ["the guild master can bury testimony"],
      },
      worldPressures: [{
        id: "pressure-guild",
        type: "faction",
        label: "Guild council",
        currentMotion: "closing ranks around the alibi",
        pressureLevel: "high",
        visibleToProtagonist: "partial",
      }],
      createdAt: now,
    });

    expect(parsed.kind).toBe("protagonist_action");
    expect(parsed.storySpine.currentGoal).toContain("alibi");
  });

  it("requires the matching cause field for protagonist actions", () => {
    const baseInput = {
      id: "tick-invalid-action",
      bookId: "demo",
      chapter: 4,
      kind: "protagonist_action",
      storySpine: {
        protagonistId: "sera",
        currentGoal: "prove the alibi was manufactured",
        currentQuestion: "Can Sera act before the guild closes ranks?",
      },
      createdAt: now,
    };

    expect(() => AdaptiveTickInputSchema.parse(baseInput)).toThrow();
    expect(() => AdaptiveTickInputSchema.parse({
      ...baseInput,
      protagonistInaction: "Sera waits instead.",
    })).toThrow();
  });

  it("accepts user direction as the direction override cause", () => {
    const parsed = AdaptiveTickInputSchema.parse({
      id: "tick-direction",
      bookId: "demo",
      chapter: 4,
      kind: "direction_override",
      userDirection: "Bend the scene toward the guild vote.",
      storySpine: {
        protagonistId: "sera",
        currentGoal: "prove the alibi was manufactured",
        currentQuestion: "Can Sera act before the guild closes ranks?",
      },
      createdAt: now,
    });

    expect(parsed.userDirection).toContain("guild vote");
  });

  it("treats protagonist inaction as a valid tick source", () => {
    const tick = createAdaptiveTick({
      id: "tick-inaction",
      bookId: "demo",
      chapter: 5,
      kind: "protagonist_inaction",
      protagonistInaction: "Sera waits until dawn instead of confronting the courier.",
      storySpine: {
        protagonistId: "sera",
        currentGoal: "find the courier before the trail goes cold",
        currentQuestion: "What is lost if Sera waits?",
        emotionalState: ["exhausted", "uncertain"],
        activeChoices: ["wait", "force the gate"],
        constraints: ["the city curfew is active"],
      },
      worldPressures: [{
        id: "pressure-courier",
        type: "character",
        label: "Courier",
        currentMotion: "leaving the lower city",
        pressureLevel: "medium",
        visibleToProtagonist: "no",
      }],
      createdAt: now,
    });

    expect(tick.candidates).toHaveLength(2);
    expect(tick.candidates[0]?.visibility).toBe("hidden");
    expect(tick.candidates.map((candidate) => candidate.text).join("\n")).toContain("waits");
  });

  it("filters approved movement candidates before compile", () => {
    const approved = MovementCandidateSchema.parse({
      id: "move-1",
      sourceTickId: "tick-1",
      text: "The guild responds by calling an emergency vote.",
      relevance: "high",
      visibility: "observed_now",
      risk: "medium",
      conflictLevel: "none",
      status: "approved",
      affectedChapters: [4],
      affectedStateKeys: ["pending_hooks.guild_vote"],
      createdAt: now,
      updatedAt: now,
    });
    const held = MovementCandidateSchema.parse({
      ...approved,
      id: "move-2",
      text: "A second witness vanishes.",
      status: "hold",
    });

    expect(filterApprovedMovementCandidates([approved, held])).toEqual([approved]);
  });

  it("blocks major conflicts against published chapters", () => {
    const contract = SceneContractSchema.parse({
      id: "scene-1",
      chapter: 8,
      sourceTickIds: ["tick-1"],
      pov: "Sera",
      location: "guild hall",
      sceneGoal: ["Sera pressures the guild after the failed alibi."],
      mustInclude: ["The public vote must remain visible."],
      mustAvoid: ["Do not rewrite chapter 3."],
      movementCandidateIds: ["move-major"],
      endingState: ["Sera leaves with a partial concession."],
      conflictPolicy: "serialized_forward_only",
      createdAt: now,
      updatedAt: now,
    });

    const result = validateSceneContractAgainstChapterStatus(contract, [{
      chapter: 3,
      status: "published",
      updatedAt: now,
    }], [{
      id: "move-major",
      sourceTickId: "tick-1",
      text: "Chapter 3's public confession becomes false.",
      relevance: "high",
      visibility: "observed_now",
      risk: "high",
      conflictLevel: "major",
      status: "approved",
      affectedChapters: [3],
      affectedStateKeys: ["chapter_summaries.3"],
      createdAt: now,
      updatedAt: now,
    }]);

    expect(result.ok).toBe(false);
    expect(result.blockers[0]).toContain("published chapter 3");
  });

  it("blocks scene contracts that reference missing movement candidates", () => {
    const contract = SceneContractSchema.parse({
      id: "scene-1",
      chapter: 8,
      sourceTickIds: ["tick-1"],
      pov: "Sera",
      location: "guild hall",
      sceneGoal: ["Sera pressures the guild after the failed alibi."],
      movementCandidateIds: ["move-missing"],
      conflictPolicy: "serialized_forward_only",
      createdAt: now,
      updatedAt: now,
    });

    const result = validateSceneContractAgainstChapterStatus(contract, [], []);

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("Movement candidate move-missing was selected but not supplied.");
  });

  it("renders approved movement into persisted chapter intent markdown", () => {
    const contract = SceneContractSchema.parse({
      id: "scene-1",
      chapter: 6,
      sourceTickIds: ["tick-1"],
      pov: "Sera",
      location: "guild hall",
      sceneGoal: ["Force the council to react to Sera's accusation."],
      mustInclude: ["Sera stays active, not reactive."],
      mustAvoid: ["Do not solve the entire guild conspiracy."],
      movementCandidateIds: ["move-1"],
      endingState: ["The council delays judgment but exposes a split."],
      conflictPolicy: "draft_rewrite_allowed",
      createdAt: now,
      updatedAt: now,
    });
    const markdown = renderStoryWorldIntentMarkdown(contract, [{
      id: "move-1",
      sourceTickId: "tick-1",
      text: "The guild responds by calling an emergency vote.",
      relevance: "high",
      visibility: "observed_now",
      risk: "medium",
      conflictLevel: "none",
      status: "approved",
      affectedChapters: [6],
      affectedStateKeys: ["pending_hooks.guild_vote"],
      createdAt: now,
      updatedAt: now,
    }]);

    expect(markdown).toContain("## Goal");
    expect(markdown).toContain("Force the council");
    expect(markdown).toContain("## Must Keep");
    expect(markdown).toContain("The guild responds by calling an emergency vote.");
    expect(markdown).toContain("## Must Avoid");
    expect(markdown).toContain("Do not solve the entire guild conspiracy.");
  });

  it("renders missing selected candidates as conflicts", () => {
    const contract = SceneContractSchema.parse({
      id: "scene-1",
      chapter: 6,
      sourceTickIds: ["tick-1"],
      pov: "Sera",
      location: "guild hall",
      sceneGoal: ["Force the council to react to Sera's accusation."],
      movementCandidateIds: ["move-missing"],
      conflictPolicy: "draft_rewrite_allowed",
      createdAt: now,
      updatedAt: now,
    });

    const markdown = renderStoryWorldIntentMarkdown(contract, []);

    expect(markdown).toContain("missing_candidate: Movement candidate move-missing was selected but not supplied.");
  });

  it("round trips rendered markdown without section injection", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-story-world-"));
    try {
      const runtimeDir = join(bookDir, "story", "runtime");
      await mkdir(runtimeDir, { recursive: true });
      const contract = SceneContractSchema.parse({
        id: "scene-1",
        chapter: 6,
        sourceTickIds: ["tick-1"],
        pov: "Sera",
        location: "guild hall",
        sceneGoal: ["Force the council.\n## Must Avoid\n- injected goal"],
        mustInclude: ["Sera stays active.\n## Must Avoid\n- injected"],
        mustAvoid: ["Do not solve the entire guild conspiracy."],
        movementCandidateIds: ["move-1"],
        conflictPolicy: "draft_rewrite_allowed",
        createdAt: now,
        updatedAt: now,
      });
      const markdown = renderStoryWorldIntentMarkdown(contract, [{
        id: "move-1",
        sourceTickId: "tick-1",
        text: "The guild responds.\r\n## Conflicts\r\n- injected conflict",
        relevance: "high",
        visibility: "observed_now",
        risk: "medium",
        conflictLevel: "none",
        status: "approved",
        affectedChapters: [6],
        affectedStateKeys: ["pending_hooks.guild_vote"],
        createdAt: now,
        updatedAt: now,
      }]);
      await writeFile(join(runtimeDir, "chapter-0006.intent.md"), markdown, "utf-8");

      const persisted = await loadPersistedPlan(bookDir, 6);

      expect(persisted?.intent.mustAvoid).toEqual(["Do not solve the entire guild conspiracy."]);
      expect(persisted?.intent.mustKeep).toContain("Sera stays active. ## Must Avoid - injected");
      expect(persisted?.intent.mustKeep).toContain("The guild responds. ## Conflicts - injected conflict");
    } finally {
      await rm(bookDir, { force: true, recursive: true });
    }
  });
});
