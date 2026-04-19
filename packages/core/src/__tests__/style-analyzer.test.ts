import { describe, it, expect } from "vitest";
import { analyzeStyle } from "../agents/style-analyzer.js";

describe("analyzeStyle", () => {
  const sampleText = [
    "陈风一脚踩碎了脚下的石板。碎石飞溅，打在旁边的墙壁上发出清脆的声响。他低头看了一眼，嘴角微微上扬。",
    "",
    "\"谁？\"他低喝一声，手已经按上了腰间的刀柄。指尖触到冰凉的金属，心跳稍微稳了一些。",
    "",
    "黑暗中，一双眼睛正盯着他。那目光冰冷得像冬夜的寒风，带着审视和一丝不易察觉的警惕。来者不善。但陈风并不怕。他经历过比这更恶劣的处境。比这更危险的对手。他攥紧了刀柄，朝着那双眼睛走了过去。脚步声在空旷的巷子里回荡。",
  ].join("\n");

  it("calculates sentence length statistics", () => {
    const profile = analyzeStyle(sampleText);
    expect(profile.avgSentenceLength).toBeGreaterThan(0);
    expect(profile.sentenceLengthStdDev).toBeGreaterThan(0);
  });

  it("calculates paragraph length statistics", () => {
    const profile = analyzeStyle(sampleText);
    expect(profile.avgParagraphLength).toBeGreaterThan(0);
    expect(profile.paragraphLengthRange.min).toBeGreaterThan(0);
    expect(profile.paragraphLengthRange.max).toBeGreaterThanOrEqual(profile.paragraphLengthRange.min);
  });

  it("calculates vocabulary diversity", () => {
    const profile = analyzeStyle(sampleText);
    expect(profile.vocabularyDiversity).toBeGreaterThan(0);
    expect(profile.vocabularyDiversity).toBeLessThanOrEqual(1);
  });

  it("includes source name when provided", () => {
    const profile = analyzeStyle(sampleText, "测试来源");
    expect(profile.sourceName).toBe("测试来源");
  });

  it("includes analyzed timestamp", () => {
    const profile = analyzeStyle(sampleText);
    expect(profile.analyzedAt).toBeDefined();
  });

  it("handles empty text", () => {
    const profile = analyzeStyle("");
    expect(profile.avgSentenceLength).toBe(0);
    expect(profile.avgParagraphLength).toBe(0);
    expect(profile.vocabularyDiversity).toBe(0);
  });

  it("detects top patterns from repeated sentence openings", () => {
    const repetitiveText = [
      "他看着远方。他看着山峰。他看着大海。他看着天空。",
      "",
      "风在吹。雨在下。",
    ].join("\n");

    const profile = analyzeStyle(repetitiveText);
    // "他看" should be detected as a top pattern
    const hasHeKan = profile.topPatterns.some((p) => p.includes("他看"));
    expect(hasHeKan).toBe(true);
  });

  it("classifies short-cutting rhythm for tightly segmented prose", () => {
    const text = [
      "문이 열렸다. 그는 멈췄다. 먼저 안을 봤다.",
      "",
      "발밑 그림자가 짧게 떨렸다. 그는 바로 칼자루를 잡았다.",
    ].join("\n");

    const profile = analyzeStyle(text);

    expect(profile.rhythmPreference).toBe("short-cutting");
  });

  it("classifies flowing rhythm for longer, continuous prose", () => {
    const text = [
      "사람 손으로는 닿지 않을 만큼 높은 아치가 검은 돌결 사이로 겹겹이 올라가 있었고, 그 사이를 메운 붉은 유리창에는 해가 아니라 잔불 같은 빛이 걸려 있었다. 시선이 아래로 내려오자 왕좌실의 윤곽이 늦게 잡혔다.",
      "",
      "넓은 계단 아래 반원으로 선 무장들 너머로, 오래된 피가 닦이다 만 바닥이 느리게 드러났고, 그 위를 스치는 바람조차 무겁게 가라앉아 있었다.",
    ].join("\n");

    const profile = analyzeStyle(text);

    expect(profile.rhythmPreference).toBe("flowing");
  });
});
