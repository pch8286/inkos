import { describe, expect, it } from "vitest";
import { defaultChapterWordsForLanguage, pickValidValue, platformLabelForLanguage, platformOptionsForLanguage } from "./book-create-form";

describe("pickValidValue", () => {
  it("keeps the current value when it is still available", () => {
    expect(pickValidValue("mystery", ["mystery", "romance"])).toBe("mystery");
  });

  it("falls back to the first available value when current is blank or invalid", () => {
    expect(pickValidValue("", ["mystery", "romance"])).toBe("mystery");
    expect(pickValidValue("invalid", ["mystery", "romance"])).toBe("mystery");
    expect(pickValidValue("", [])).toBe("");
  });
});

describe("defaultChapterWordsForLanguage", () => {
  it("uses 3000 for chinese and korean projects and 2000 for english projects", () => {
    expect(defaultChapterWordsForLanguage("zh")).toBe("3000");
    expect(defaultChapterWordsForLanguage("en")).toBe("2000");
    expect(defaultChapterWordsForLanguage("ko")).toBe("3000");
  });
});

describe("platformOptionsForLanguage", () => {
  it("uses stable, unique values for english platform choices", () => {
    const values = platformOptionsForLanguage("en").map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(["royal-road", "kindle-unlimited", "scribble-hub", "other"]);
  });

  it("adds korean platform presets including local services", () => {
    const values = platformOptionsForLanguage("ko").map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(["naver-series", "kakao-page", "munpia", "novelpia", "other"]);
  });

  it("defaults to chinese platform presets", () => {
    const values = platformOptionsForLanguage("zh").map((option) => option.value);
    expect(values).toEqual(["tomato", "qidian", "feilu", "other"]);
  });
});

describe("platformLabelForLanguage", () => {
  it("returns platform label when value is known", () => {
    expect(platformLabelForLanguage("en", "royal-road")).toBe("Royal Road");
  });

  it("falls back to raw platform value when unknown", () => {
    expect(platformLabelForLanguage("en", "unknown")).toBe("unknown");
  });
});
