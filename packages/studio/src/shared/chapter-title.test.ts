import { describe, expect, it } from "vitest";
import { defaultLocalizedChapterTitle, localizeChapterTitle } from "./chapter-title";

describe("chapter-title", () => {
  it("localizes Chinese-style chapter prefixes into Korean", () => {
    expect(localizeChapterTitle("第1章 각성의 날", 1, "ko")).toBe("제1장 각성의 날");
    expect(localizeChapterTitle("第2章", 2, "ko")).toBe("제2장");
  });

  it("keeps custom titles untouched", () => {
    expect(localizeChapterTitle("붉은 계약", 3, "ko")).toBe("붉은 계약");
  });

  it("returns localized defaults when the title is missing", () => {
    expect(defaultLocalizedChapterTitle(4, "ko")).toBe("제4장");
    expect(defaultLocalizedChapterTitle(4, "en")).toBe("Chapter 4");
    expect(defaultLocalizedChapterTitle(4, "zh")).toBe("第4章");
  });
});
