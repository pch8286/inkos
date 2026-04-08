import { describe, expect, it } from "vitest";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";

describe("FoundationReviewerAgent", () => {
  it("parses Korean review blocks", () => {
    const agent = new FoundationReviewerAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          maxTokensCap: null,
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    } as never);

    const result = (agent as any).parseReviewResult(
      [
        "=== DIMENSION: 1 ===",
        "점수: 82",
        "의견: 초반 갈등이 빠르게 드러난다.",
        "",
        "=== DIMENSION: 2 ===",
        "점수: 76",
        "의견: 세계관 설명은 조금 더 압축하는 편이 좋다.",
        "",
        "=== OVERALL ===",
        "총점: 79",
        "통과: 아니오",
        "총평: 흡입력은 좋지만 초반 정보량을 조금 더 다듬어야 한다.",
      ].join("\n"),
      ["핵심 갈등", "세계관 일관성"],
    );

    expect(result.passed).toBe(false);
    expect(result.totalScore).toBe(79);
    expect(result.dimensions).toHaveLength(2);
    expect(result.dimensions[0]).toMatchObject({
      name: "핵심 갈등",
      score: 82,
    });
    expect(result.overallFeedback).toContain("흡입력은 좋지만");
  });
});
