import {
  formatImportChaptersComplete,
  formatImportChaptersDiscovery,
  formatImportChaptersResume,
  formatWriteNextComplete,
  formatWriteNextProgress,
  formatWriteNextResultLines,
  type CliLanguage,
} from "./localization.js";

export { type CliLanguage };

export function formatWriteStartLine(
  language: CliLanguage,
  current: number,
  total: number,
  bookId: string,
): string {
  return formatWriteNextProgress(language, current, total, bookId);
}

export function formatWriteCompletionLines(
  language: CliLanguage,
  result: {
    readonly chapterNumber: number;
    readonly title: string;
    readonly wordCount: number;
    readonly passedAudit: boolean;
    readonly revised: boolean;
    readonly status: string;
    readonly issues: ReadonlyArray<{
      readonly severity: string;
      readonly category: string;
      readonly description: string;
    }>;
  },
): string[] {
  return [...formatWriteNextResultLines(language, result), ""];
}

export function formatWriteDoneLine(language: CliLanguage): string {
  return formatWriteNextComplete(language);
}

export function formatImportDiscoveryLine(
  language: CliLanguage,
  chapterCount: number,
  bookId: string,
): string {
  return formatImportChaptersDiscovery(language, chapterCount, bookId);
}

export function formatImportResumeLine(
  language: CliLanguage,
  resumeFrom: number,
): string {
  return formatImportChaptersResume(language, resumeFrom);
}

export function formatImportCompletionLines(
  language: CliLanguage,
  result: {
    readonly importedCount: number;
    readonly totalCountLabel: string;
    readonly nextChapter: number;
    readonly bookId: string;
  },
): string[] {
  return [
    language === "en" ? "Import complete:" : language === "zh" ? "导入完成：" : "가져오기 완료:",
    language === "en"
      ? `  Chapters imported: ${result.importedCount}`
      : language === "zh"
        ? `  已导入章节：${result.importedCount}`
        : `  가져온 화수: ${result.importedCount}`,
    language === "en"
      ? `  Total length: ${result.totalCountLabel}`
      : language === "zh"
        ? `  总长度：${result.totalCountLabel}`
        : `  총 분량: ${result.totalCountLabel}`,
    language === "en"
      ? `  Next chapter number: ${result.nextChapter}`
      : language === "zh"
        ? `  下一章编号：${result.nextChapter}`
        : `  다음 화 번호: ${result.nextChapter}`,
    "",
    language === "en"
      ? `Run "inkos write next ${result.bookId}" to continue writing.`
      : language === "zh"
        ? `运行 "inkos write next ${result.bookId}" 继续写作。`
        : `"inkos write next ${result.bookId}"를 실행해 이어서 집필하세요.`,
  ];
}
