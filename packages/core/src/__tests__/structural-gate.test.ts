import { afterEach, describe, expect, it, vi } from "vitest";
import { StructuralGateAgent, parseStructuralGateResult } from "../agents/structural-gate.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

function createAgent(): StructuralGateAgent {
  return new StructuralGateAgent({
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 4096,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {},
      },
    },
    model: "test-model",
    projectRoot: process.cwd(),
  } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseStructuralGateResult", () => {
  it("parses a valid payload", () => {
    const result = parseStructuralGateResult(
      JSON.stringify({
        passed: true,
        summary: "The draft is structurally sound.",
        criticalFindings: [],
        softFindings: [
          {
            severity: "soft",
            code: "clarity-gap",
            message: "The opening beat could name the protagonist earlier.",
            evidence: "The first paragraph delays the lead name.",
          },
        ],
      }),
    );

    expect(result.passed).toBe(true);
    expect(result.summary).toContain("structurally sound");
    expect(result.criticalFindings).toHaveLength(0);
    expect(result.softFindings).toHaveLength(1);
    expect(result.softFindings[0]).toMatchObject({
      severity: "soft",
      code: "clarity-gap",
    });
  });

  it("enforces that passed tracks whether critical findings exist", () => {
    expect(() =>
      parseStructuralGateResult(
        JSON.stringify({
          passed: true,
          summary: "Critical findings should force failure.",
          criticalFindings: [
            {
              severity: "critical",
              code: "missing-foundation-requirement",
              message: "The opening does not establish the premise.",
            },
          ],
          softFindings: [],
        }),
      ),
    ).toThrow();
  });

  it("rejects an invalid payload", () => {
    expect(() =>
      parseStructuralGateResult(
        JSON.stringify({
          passed: true,
          summary: "Bad shape should fail.",
          criticalFindings: [],
          softFindings: [
            {
              severity: "soft",
              code: "extra-field",
              message: "This payload carries an unsupported property.",
              evidence: "extra field should not be accepted",
              unexpected: "nope",
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it("recovers from a wrapped response with a short preamble and trailing note", () => {
    const result = parseStructuralGateResult([
      "Here is the structural judgment:",
      JSON.stringify({
        passed: true,
        summary: "Only soft notes remain.",
        criticalFindings: [],
        softFindings: [
          {
            severity: "soft",
            code: "clarity-gap",
            message: "Name the protagonist sooner.",
          },
        ],
      }),
      "Trailing note: the draft is basically usable.",
    ].join("\n"));

    expect(result.passed).toBe(true);
    expect(result.softFindings).toHaveLength(1);
  });

  it("recovers from a fenced JSON response", () => {
    const result = parseStructuralGateResult([
      "Preflight note before the fenced block.",
      "```json",
      JSON.stringify({
        passed: true,
        summary: "Only soft concerns remain.",
        criticalFindings: [],
        softFindings: [
          {
            severity: "soft",
            code: "clarity-gap",
            message: "Name the protagonist sooner.",
          },
        ],
      }, null, 2),
      "```",
      "Trailing note after the fenced block.",
    ].join("\n"));

    expect(result.passed).toBe(true);
    expect(result.softFindings).toHaveLength(1);
  });

  it("keeps critical findings separate from soft findings", () => {
    const result = parseStructuralGateResult(
      JSON.stringify({
        passed: false,
        summary: "The draft has a structural failure and one minor polish issue.",
        criticalFindings: [
          {
            severity: "critical",
            code: "missing-foundation-requirement",
            message: "Chapter 1 never establishes the core premise.",
            evidence: "The draft opens with scenery and no narrative contract.",
          },
        ],
        softFindings: [
          {
            severity: "soft",
            code: "scene-order",
            message: "The opening could ground the protagonist sooner.",
          },
        ],
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.criticalFindings).toHaveLength(1);
    expect(result.softFindings).toHaveLength(1);
    expect(result.criticalFindings[0]).toMatchObject({
      severity: "critical",
      code: "missing-foundation-requirement",
    });
    expect(result.softFindings[0]).toMatchObject({
      severity: "soft",
      code: "scene-order",
    });
  });

  it("passes a soft-only findings payload", () => {
    const result = parseStructuralGateResult(
      JSON.stringify({
        passed: true,
        summary: "Only soft concerns remain.",
        criticalFindings: [],
        softFindings: [
          {
            severity: "soft",
            code: "tighten-hook",
            message: "The hook could be a little sharper.",
          },
        ],
      }),
    );

    expect(result.passed).toBe(true);
    expect(result.criticalFindings).toHaveLength(0);
    expect(result.softFindings).toHaveLength(1);
  });
});

describe("StructuralGateAgent", () => {
  it("builds a governed prompt and parses a chapter-one foundation failure", async () => {
    const agent = createAgent();
    const chatSpy = vi.spyOn(StructuralGateAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: JSON.stringify({
        passed: false,
        summary: "Chapter 1 misses the story's foundation requirement.",
        criticalFindings: [
          {
            severity: "critical",
            code: "missing-foundation-requirement",
            message: "Chapter 1 must establish the core premise and immediate pressure.",
            evidence: "The draft only opens with marketplace texture and no central conflict.",
          },
        ],
        softFindings: [
          {
            severity: "soft",
            code: "clarity-gap",
            message: "The protagonist could be named earlier.",
          },
        ],
      }),
      usage: ZERO_USAGE,
    });

    const result = await agent.evaluateStructuralGate({
      chapterNumber: 1,
      chapterTitle: "Prelude",
      chapterIntent: "Open with the first irreversible pressure.",
      contextPackage: {
        chapter: 1,
        selectedContext: [
          {
            source: "story/pending_hooks.md#mentor-debt",
            reason: "The mentor debt needs to stay visible.",
            excerpt: "mentor debt",
          },
        ],
      },
      ruleStack: {
        layers: [
          {
            id: "book",
            name: "Book Rules",
            precedence: 0,
            scope: "book",
          },
        ],
        sections: {
          hard: ["Chapter 1 must establish the premise."],
          soft: ["Keep the opening direct."],
          diagnostic: ["Avoid too much setup."],
        },
        overrideEdges: [
          {
            from: "book",
            to: "local",
            allowed: true,
            scope: "chapter-1",
          },
        ],
        activeOverrides: [
          {
            from: "book",
            to: "local",
            target: "Chapter 1 opening pressure",
            reason: "The first chapter needs immediate conflict even if later chapters may slow down.",
          },
        ],
      },
      storyBible: "## Foundation\nThe lead must encounter the central problem immediately.",
      volumeOutline: "## Chapter 1\nOpen with the core premise.",
      bookRules: "Chapter 1 must establish the premise before anything else.",
      currentState: "# Current State\n- The central problem is still hidden.",
      pendingHooks: "# Pending Hooks\n- mentor-debt",
      draftContent: "A market scene unfolds. People talk. The actual premise never appears.",
    });

    const messages = chatSpy.mock.calls[0]?.[0] as ReadonlyArray<{ content: string }> | undefined;
    expect(messages?.[0]?.content).toContain("Chapter 1");
    expect(messages?.[0]?.content).toContain("foundation requirement");
    expect(messages?.[1]?.content).toContain("A market scene unfolds");
    expect(messages?.[1]?.content).toContain("story/pending_hooks.md#mentor-debt");
    expect(messages?.[1]?.content).toContain("Chapter 1 must establish the premise");
    expect(messages?.[1]?.content).toContain("## Governed Rule Stack");
    expect(messages?.[1]?.content).toContain("### Layers");
    expect(messages?.[1]?.content).toContain("### Override Edges");
    expect(messages?.[1]?.content).toContain("### Active Overrides");
    expect(messages?.[1]?.content).toContain("id: book");
    expect(messages?.[1]?.content).toContain("precedence: 0");
    expect(messages?.[1]?.content).toContain("from: book");
    expect(messages?.[1]?.content).toContain("to: local");
    expect(messages?.[1]?.content).toContain("allowed: true");
    expect(messages?.[1]?.content).toContain("scope: chapter-1");
    expect(messages?.[1]?.content).toContain("target: Chapter 1 opening pressure");
    expect(messages?.[1]?.content).toContain("reason: The first chapter needs immediate conflict");
    expect(result.passed).toBe(false);
    expect(result.criticalFindings[0]?.code).toBe("missing-foundation-requirement");
  });
});
