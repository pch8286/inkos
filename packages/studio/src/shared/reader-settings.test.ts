import { describe, expect, it } from "vitest";
import {
  buildReaderSettingsDiff,
  normalizeReaderSettings,
  resolveReaderBodyStyle,
} from "./reader-settings";

describe("normalizeReaderSettings", () => {
  it("fills missing top-level and device settings with durable defaults", () => {
    expect(normalizeReaderSettings(undefined)).toEqual({
      mobile: { fontPreset: "myeongjo", fontSize: 16, lineHeight: 1.72 },
      desktop: { fontPreset: "myeongjo", fontSize: 18, lineHeight: 1.82 },
    });

    expect(normalizeReaderSettings({
      mobile: { fontPreset: "sans" },
    })).toEqual({
      mobile: { fontPreset: "sans", fontSize: 16, lineHeight: 1.72 },
      desktop: { fontPreset: "myeongjo", fontSize: 18, lineHeight: 1.82 },
    });
  });

  it("replaces invalid fields with the device defaults", () => {
    expect(normalizeReaderSettings({
      mobile: { fontPreset: "comic-sans", fontSize: 13.5, lineHeight: 3 },
      desktop: { fontPreset: "serif", fontSize: 30, lineHeight: "bad" },
    })).toEqual({
      mobile: { fontPreset: "myeongjo", fontSize: 16, lineHeight: 1.72 },
      desktop: { fontPreset: "serif", fontSize: 18, lineHeight: 1.82 },
    });
  });
});

describe("buildReaderSettingsDiff", () => {
  it("returns stable saved-vs-draft diffs without equal values", () => {
    expect(buildReaderSettingsDiff(
      {
        mobile: { fontPreset: "myeongjo", fontSize: 16, lineHeight: 1.72 },
        desktop: { fontPreset: "serif", fontSize: 18, lineHeight: 1.85 },
      },
      {
        mobile: { fontPreset: "sans", fontSize: 17, lineHeight: 1.72 },
        desktop: { fontPreset: "serif", fontSize: 18, lineHeight: 1.9 },
      },
    )).toEqual([
      {
        device: "mobile",
        field: "fontPreset",
        savedValue: "myeongjo",
        draftValue: "sans",
      },
      {
        device: "mobile",
        field: "fontSize",
        savedValue: 16,
        draftValue: 17,
      },
      {
        device: "desktop",
        field: "lineHeight",
        savedValue: 1.85,
        draftValue: 1.9,
      },
    ]);
  });

  it("returns no diff items when the normalized settings match", () => {
    expect(buildReaderSettingsDiff(
      {
        mobile: { fontPreset: "myeongjo", fontSize: 16, lineHeight: 1.72 },
        desktop: { fontPreset: "myeongjo", fontSize: 18, lineHeight: 1.82 },
      },
      {
        mobile: { fontPreset: "myeongjo", fontSize: 16, lineHeight: 1.72 },
        desktop: { fontPreset: "myeongjo", fontSize: 18, lineHeight: 1.82 },
      },
    )).toEqual([]);
  });
});

describe("resolveReaderBodyStyle", () => {
  it("returns inline body styles that distinguish all presets", () => {
    const sans = resolveReaderBodyStyle("mobile", {
      mobile: { fontPreset: "sans", fontSize: 16, lineHeight: 1.72 },
      desktop: { fontPreset: "myeongjo", fontSize: 18, lineHeight: 1.82 },
    });
    const serif = resolveReaderBodyStyle("mobile", {
      mobile: { fontPreset: "serif", fontSize: 16, lineHeight: 1.72 },
      desktop: { fontPreset: "myeongjo", fontSize: 18, lineHeight: 1.82 },
    });
    const myeongjo = resolveReaderBodyStyle("mobile", {
      mobile: { fontPreset: "myeongjo", fontSize: 16, lineHeight: 1.72 },
      desktop: { fontPreset: "myeongjo", fontSize: 18, lineHeight: 1.82 },
    });

    expect(sans).toEqual({
      fontFamily: "var(--font-sans)",
      fontSize: 16,
      lineHeight: 1.72,
    });
    expect(serif).toEqual({
      fontFamily: "var(--font-serif)",
      fontSize: 16,
      lineHeight: 1.72,
    });
    expect(myeongjo).toEqual({
      fontFamily: "'Nanum Myeongjo', 'Noto Serif KR', Georgia, serif",
      fontSize: 16,
      lineHeight: 1.72,
    });
  });
});
