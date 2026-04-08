import { describe, it, expect } from "vitest";
import {
  buildLengthSpec,
  chooseNormalizeMode,
  countChapterLength,
  resolveLengthCountingMode,
  formatLengthCount,
  isOutsideHardRange,
  isOutsideSoftRange,
} from "../utils/length-metrics.js";

describe("length metrics", () => {
  it("counts Chinese chapter length using zh_chars", () => {
    expect(countChapterLength("他抬头看天。", "zh_chars")).toBe(6);
  });

  it("counts Korean chapter length using ko_chars", () => {
    const content = "안녕하세요 반갑습니다.";
    expect(countChapterLength(content, "ko_chars")).toBe("안녕하세요반갑습니다.".length);
  });

  it("counts English chapter length using en_words", () => {
    expect(countChapterLength("He looked at the sky.", "en_words")).toBe(5);
  });

  it("resolves length counting mode for Korean", () => {
    expect(resolveLengthCountingMode("ko")).toBe("ko_chars");
  });

  it("formats Korean length counts", () => {
    expect(formatLengthCount(2000, "ko_chars")).toBe("2000자");
    expect(formatLengthCount(1800, "en_words")).toBe("1800 words");
    expect(formatLengthCount(2100, "zh_chars")).toBe("2100字");
  });

  it("builds a conservative length spec for Korean chapters", () => {
    const spec = buildLengthSpec(2200, "ko");
    expect(spec.countingMode).toBe("ko_chars");
    expect(spec.softMin).toBe(1900);
    expect(spec.softMax).toBe(2500);
    expect(spec.hardMin).toBe(1600);
    expect(spec.hardMax).toBe(2800);
  });

  it("counts prose only for markdown-shaped Chinese chapters", () => {
    const markdownChapter = [
      "---",
      "title: 第1章 归来",
      "---",
      "",
      "# 第1章 归来",
      "",
      "陈风抬头看天。",
    ].join("\n");

    expect(countChapterLength(markdownChapter, "zh_chars")).toBe("陈风抬头看天。".length);
  });

  it("builds a conservative length spec for Chinese chapters", () => {
    const spec = buildLengthSpec(2200, "zh");

    expect(spec).toEqual({
      target: 2200,
      softMin: 1900,
      softMax: 2500,
      hardMin: 1600,
      hardMax: 2800,
      countingMode: "zh_chars",
      normalizeMode: "none",
    });
  });

  it("builds a conservative length spec for English chapters", () => {
    const spec = buildLengthSpec(2200, "en");

    expect(spec.countingMode).toBe("en_words");
    expect(spec.softMin).toBe(1900);
    expect(spec.softMax).toBe(2500);
    expect(spec.hardMin).toBe(1600);
    expect(spec.hardMax).toBe(2800);
  });

  it("scales the conservative bands for smaller targets", () => {
    const spec = buildLengthSpec(220, "zh");

    expect(spec.softMin).toBe(190);
    expect(spec.softMax).toBe(250);
    expect(spec.hardMin).toBe(160);
    expect(spec.hardMax).toBe(280);
  });

  it("detects soft and hard range drift", () => {
    const spec = buildLengthSpec(2200, "zh");

    expect(isOutsideSoftRange(1800, spec)).toBe(true);
    expect(isOutsideSoftRange(2200, spec)).toBe(false);
    expect(isOutsideHardRange(1500, spec)).toBe(true);
    expect(isOutsideHardRange(2200, spec)).toBe(false);
  });

  it("chooses normalization direction from the measured length", () => {
    const spec = buildLengthSpec(2200, "zh");

    expect(chooseNormalizeMode(1800, spec)).toBe("expand");
    expect(chooseNormalizeMode(2200, spec)).toBe("none");
    expect(chooseNormalizeMode(2600, spec)).toBe("compress");
  });
});
