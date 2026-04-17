import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TFunction } from "../hooks/use-i18n";
import { ChapterReader, ChapterReaderPreviewFrame, ReaderSettingsDiffSummary } from "./ChapterReader";

const useApiMock = vi.fn();
const fetchJsonMock = vi.fn();
const postApiMock = vi.fn();

vi.mock("../hooks/use-api", () => ({
  useApi: (...args: ReadonlyArray<unknown>) => useApiMock(...args),
  fetchJson: (...args: ReadonlyArray<unknown>) => fetchJsonMock(...args),
  postApi: (...args: ReadonlyArray<unknown>) => postApiMock(...args),
}));

const t = ((key: string) => key) as TFunction;

const nav = {
  toBook: vi.fn(),
  toDashboard: vi.fn(),
};

const sampleReaderSettings = {
  mobile: { fontPreset: "myeongjo", fontSize: 16, lineHeight: 1.72 },
  desktop: { fontPreset: "sans", fontSize: 19, lineHeight: 1.9 },
} as const;

const sampleChapter = {
  chapterNumber: 1,
  filename: "0001-chapter.md",
  content: "# 제1장\n\n첫 번째 문단입니다.\n\n두 번째 문단입니다.",
  language: "ko" as const,
};

describe("ChapterReader", () => {
  beforeEach(() => {
    useApiMock.mockReset();
    fetchJsonMock.mockReset();
    postApiMock.mockReset();
    nav.toBook.mockReset();
    nav.toDashboard.mockReset();
  });

  it("opens in mobile view and falls back to default reader settings", () => {
    useApiMock.mockReturnValue({
      data: sampleChapter,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderToStaticMarkup(
      createElement(ChapterReader, {
        bookId: "demo",
        chapterNumber: 1,
        nav,
        theme: "light",
        t,
      }),
    );

    expect(html).toContain('data-reader-view="mobile"');
    expect(html).toContain("max-w-[28rem]");
    expect(html).toContain("font-size:16px");
    expect(html).toContain("line-height:1.72");
    expect(html).toContain("Nanum Myeongjo");
    expect(html).not.toContain("first-letter:");
  });
});

describe("ChapterReaderPreviewFrame", () => {
  it("renders desktop mode with wider layout and desktop typography", () => {
    const html = renderToStaticMarkup(
      createElement(ChapterReaderPreviewFrame, {
        chapter: { ...sampleChapter, readerSettings: sampleReaderSettings },
        viewMode: "desktop",
        showReaderSettings: false,
        t,
      }),
    );

    expect(html).toContain('data-reader-view="desktop"');
    expect(html).toContain("max-w-4xl");
    expect(html).toContain("font-size:19px");
    expect(html).toContain("line-height:1.9");
    expect(html).toContain("var(--font-sans)");
  });

  it("uses draft settings for the live reading surface while reader settings are open", () => {
    const html = renderToStaticMarkup(
      createElement(ChapterReaderPreviewFrame, {
        chapter: { ...sampleChapter, readerSettings: sampleReaderSettings },
        viewMode: "mobile",
        showReaderSettings: true,
        draftReaderSettings: {
          mobile: { fontPreset: "sans", fontSize: 17, lineHeight: 1.78 },
          desktop: sampleReaderSettings.desktop,
        },
        t,
      }),
    );

    expect(html).toContain("font-size:17px");
    expect(html).toContain("line-height:1.78");
    expect(html).toContain("var(--font-sans)");
  });
});

describe("ReaderSettingsDiffSummary", () => {
  it("renders a diff summary only when the draft differs from saved settings", () => {
    const diffHtml = renderToStaticMarkup(
      createElement(ReaderSettingsDiffSummary, {
        savedSettings: sampleReaderSettings,
        draftSettings: {
          mobile: { fontPreset: "sans", fontSize: 17, lineHeight: 1.72 },
          desktop: sampleReaderSettings.desktop,
        },
        t,
      }),
    );

    const sameHtml = renderToStaticMarkup(
      createElement(ReaderSettingsDiffSummary, {
        savedSettings: sampleReaderSettings,
        draftSettings: sampleReaderSettings,
        t,
      }),
    );

    expect(diffHtml).toContain("reader.readerChanges");
    expect(diffHtml).toContain("reader.savedValue");
    expect(diffHtml).toContain("reader.draftValue");
    expect(diffHtml).toContain("reader.mobile");
    expect(diffHtml).toContain("reader.font");
    expect(sameHtml).toBe("");
  });
});
