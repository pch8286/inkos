import { describe, expect, it } from "vitest";
import {
  formatBookCreateCreating,
  formatBookCreateCreated,
  formatBookCreateNextStep,
  formatImportCanonComplete,
  formatImportCanonStart,
  formatImportChaptersComplete,
  formatImportChaptersDiscovery,
  formatImportChaptersResume,
  formatWriteNextComplete,
  formatWriteNextProgress,
  formatWriteNextResultLines,
  resolveCliLanguage,
} from "../localization.js";

describe("CLI localization", () => {
  it("formats book-create summaries in all languages", () => {
    expect(formatBookCreateCreating("zh", "山河", "xuanhuan", "tomato"))
      .toBe('创建书籍 "山河"（xuanhuan / tomato）...');
    expect(formatBookCreateCreated("zh", "shan-he")).toBe("已创建书籍：shan-he");
    expect(formatBookCreateNextStep("zh", "shan-he")).toBe("下一步：inkos write next shan-he");

    expect(formatBookCreateCreating("en", "Harbor", "other", "other"))
      .toBe('Creating book "Harbor" (other / other)...');
    expect(formatBookCreateCreated("en", "harbor")).toBe("Book created: harbor");
    expect(formatBookCreateNextStep("en", "harbor")).toBe("Next: inkos write next harbor");

    expect(formatBookCreateCreating("ko", "내 이야기", "modern-fantasy", "naver-series"))
      .toBe('책 "내 이야기" (modern-fantasy / naver-series) 생성 중...');
    expect(formatBookCreateCreated("ko", "k-story")).toBe("책 생성 완료: k-story");
    expect(formatBookCreateNextStep("ko", "k-story")).toBe("다음 단계: inkos write next k-story");
  });

  it("formats write-next progress and result summaries in all languages", () => {
    expect(formatWriteNextProgress("zh", 1, 2, "shan-he"))
      .toBe('[1/2] 为「shan-he」撰写章节...');
    expect(formatWriteNextComplete("zh")).toBe("完成。");
    expect(formatWriteNextResultLines("zh", {
      chapterNumber: 3,
      title: "风雪夜",
      wordCount: 3200,
      status: "ready-for-review",
      revised: true,
      issues: [],
      auditPassed: true,
    })).toEqual([
      "  第3章：风雪夜",
      "  字数：3200字",
      "  审计：通过",
      "  自动修正：已执行（已修复关键问题）",
      "  状态：ready-for-review",
    ]);

    expect(formatWriteNextProgress("en", 2, 3, "harbor"))
      .toBe('[2/3] Writing chapter for "harbor"...');
    expect(formatWriteNextComplete("en")).toBe("Done.");
    expect(formatWriteNextResultLines("en", {
      chapterNumber: 4,
      title: "Cold Harbor",
      wordCount: 2200,
      status: "audit-failed",
      revised: false,
      issues: [{ severity: "critical", category: "continuity", description: "Mismatch" }],
      auditPassed: false,
    })).toEqual([
      "  Chapter 4: Cold Harbor",
      "  Length: 2200 words",
      "  Audit: NEEDS REVIEW",
      "  Status: audit-failed",
      "  Issues:",
      "    [critical] continuity: Mismatch",
    ]);

    expect(formatWriteNextProgress("ko", 2, 3, "k-story"))
      .toBe('[2/3] "k-story" 다음 화 집필 중...');
    expect(formatWriteNextResultLines("ko", {
      chapterNumber: 2,
      title: "첫 번째 화",
      wordCount: 1300,
      status: "approved",
      revised: false,
      issues: [],
      auditPassed: true,
    })).toEqual([
      "  2화: 첫 번째 화",
      "  분량: 1300자",
      "  감사: 통과",
      "  상태: approved",
    ]);
  });

  it("formats import summaries with language-specific units and action hints", () => {
    expect(formatImportChaptersDiscovery("zh", 12, "shan-he"))
      .toBe('发现 12 章，准备导入到「shan-he」。');
    expect(formatImportChaptersResume("zh", 5)).toBe("从第 5 章继续导入。");
    expect(formatImportChaptersComplete("zh", {
      importedCount: 8,
      totalWords: 45678,
      nextChapter: 13,
      continueBookId: "shan-he",
    })).toEqual([
      "导入完成：",
      "  已导入章节：8",
      "  总长度：45678字",
      "  下一章编号：13",
      "",
      '运行 "inkos write next shan-he" 继续写作。',
    ]);

    expect(formatImportChaptersDiscovery("en", 10, "harbor"))
      .toBe('Found 10 chapters to import into "harbor".');
    expect(formatImportChaptersResume("en", 6)).toBe("Resuming from chapter 6.");
    expect(formatImportChaptersComplete("en", {
      importedCount: 10,
      totalWords: 18342,
      nextChapter: 11,
      continueBookId: "harbor",
    })).toEqual([
      "Import complete:",
      "  Chapters imported: 10",
      "  Total length: 18342 words",
      "  Next chapter number: 11",
      "",
      'Run "inkos write next harbor" to continue writing.',
    ]);

    expect(formatImportChaptersDiscovery("ko", 8, "k-story"))
      .toBe('8화를 발견했습니다. "k-story"에 가져올 준비를 합니다.');
    expect(formatImportChaptersResume("ko", 4)).toBe("4화부터 다시 가져옵니다.");
    expect(formatImportChaptersComplete("ko", {
      importedCount: 8,
      totalWords: 10234,
      nextChapter: 9,
      continueBookId: "k-story",
    })).toEqual([
      "가져오기 완료:",
      "  가져온 화수: 8",
      "  총 분량: 10234자",
      "  다음 화 번호: 9",
      "",
      '"inkos write next k-story"를 실행해 이어서 집필하세요.',
    ]);
  });

  it("formats import-canon prompts in both languages", () => {
    expect(formatImportCanonStart("zh", "parent-book", "target-book"))
      .toBe('把 "parent-book" 的正典导入到 "target-book"...');
    expect(formatImportCanonComplete("zh")).toEqual([
      "正典已导入：story/parent_canon.md",
      "Writer 和 auditor 会在番外模式下自动识别这个文件。",
    ]);

    expect(formatImportCanonStart("en", "parent-book", "target-book"))
      .toBe('Importing canon from "parent-book" into "target-book"...');
    expect(formatImportCanonComplete("en")).toEqual([
      "Canon imported: story/parent_canon.md",
      "Writer and auditor will auto-detect this file for spinoff mode.",
    ]);
  });

  it("defaults to Korean for unknown language inputs", () => {
    expect(resolveCliLanguage(undefined)).toBe("ko");
    expect(resolveCliLanguage("unknown")).toBe("ko");
  });
});
