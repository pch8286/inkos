import { describe, expect, it } from "vitest";
import {
  formatImportCompletionLines,
  formatImportDiscoveryLine,
  formatImportResumeLine,
  formatWriteCompletionLines,
  formatWriteDoneLine,
  formatWriteStartLine,
} from "../progress-text.js";

describe("CLI progress text", () => {
  it("formats Chinese write progress lines", () => {
    expect(formatWriteStartLine("zh", 1, 3, "demo-book")).toBe('[1/3] 为「demo-book」撰写章节...');
    expect(formatWriteCompletionLines("zh", {
      chapterNumber: 7,
      title: "潮声夜渡",
      wordCount: 2345,
      passedAudit: false,
      revised: true,
      status: "audit-failed",
      issues: [
        { severity: "warning", category: "continuity", description: "时间线略有跳变" },
      ],
    })).toEqual([
      "  第7章：潮声夜渡",
      "  字数：2345字",
      "  审计：需复核",
      "  自动修正：已执行（已修复关键问题）",
      "  状态：audit-failed",
      "  问题：",
      "    [warning] continuity: 时间线略有跳变",
      "",
    ]);
    expect(formatWriteDoneLine("zh")).toBe("完成。");
  });

  it("formats English write progress lines", () => {
    expect(formatWriteStartLine("en", 2, 5, "demo-book")).toBe('[2/5] Writing chapter for "demo-book"...');
    expect(formatWriteCompletionLines("en", {
      chapterNumber: 7,
      title: "Harbor Wake",
      wordCount: 2310,
      passedAudit: true,
      revised: false,
      status: "ready-for-review",
      issues: [],
    })).toEqual([
      "  Chapter 7: Harbor Wake",
      "  Length: 2310 words",
      "  Audit: PASSED",
      "  Status: ready-for-review",
      "",
    ]);
    expect(formatWriteDoneLine("en")).toBe("Done.");
  });

  it("formats Korean write progress lines", () => {
    expect(formatWriteStartLine("ko", 3, 5, "demo-book")).toBe('[3/5] "demo-book" 다음 화 집필 중...');
    expect(formatWriteCompletionLines("ko", {
      chapterNumber: 7,
      title: "겨울 항구",
      wordCount: 3120,
      passedAudit: true,
      revised: true,
      status: "ready-for-review",
      issues: [],
    })).toEqual([
      "  7화: 겨울 항구",
      "  분량: 3120자",
      "  감사: 통과",
      "  자동 수정: 실행됨 (치명 이슈 수정 완료)",
      "  상태: ready-for-review",
      "",
    ]);
    expect(formatWriteDoneLine("ko")).toBe("완료.");
  });

  it("formats Chinese import progress lines", () => {
    expect(formatImportDiscoveryLine("zh", 12, "demo-book")).toBe('发现 12 章，准备导入到「demo-book」。');
    expect(formatImportResumeLine("zh", 8)).toBe("从第 8 章继续导入。");
    expect(formatImportCompletionLines("zh", {
      importedCount: 12,
      totalCountLabel: "24000字",
      nextChapter: 13,
      bookId: "demo-book",
    })).toEqual([
      "导入完成：",
      "  已导入章节：12",
      "  总长度：24000字",
      "  下一章编号：13",
      '',
      '运行 "inkos write next demo-book" 继续写作。',
    ]);
  });

  it("formats English import progress lines", () => {
    expect(formatImportDiscoveryLine("en", 12, "demo-book")).toBe('Found 12 chapters to import into "demo-book".');
    expect(formatImportResumeLine("en", 8)).toBe("Resuming from chapter 8.");
    expect(formatImportCompletionLines("en", {
      importedCount: 12,
      totalCountLabel: "24000 words",
      nextChapter: 13,
      bookId: "demo-book",
    })).toEqual([
      "Import complete:",
      "  Chapters imported: 12",
      "  Total length: 24000 words",
      "  Next chapter number: 13",
      '',
      'Run "inkos write next demo-book" to continue writing.',
    ]);
  });

  it("formats Korean import progress lines", () => {
    expect(formatImportDiscoveryLine("ko", 6, "demo-book")).toBe('6화를 발견했습니다. "demo-book"에 가져올 준비를 합니다.');
    expect(formatImportResumeLine("ko", 2)).toBe("2화부터 다시 가져옵니다.");
    expect(formatImportCompletionLines("ko", {
      importedCount: 6,
      totalCountLabel: "18000자",
      nextChapter: 7,
      bookId: "demo-book",
    })).toEqual([
      "가져오기 완료:",
      "  가져온 화수: 6",
      "  총 분량: 18000자",
      "  다음 화 번호: 7",
      "",
      '"inkos write next demo-book"를 실행해 이어서 집필하세요.',
    ]);
  });
});
