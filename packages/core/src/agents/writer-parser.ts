import type { GenreProfile } from "../models/genre-profile.js";
import type { LengthCountingMode } from "../models/length-governance.js";
import { detectWritingLanguageFromText } from "../models/language.js";
import type { WriteChapterOutput } from "./writer.js";
import { countChapterLength, resolveLengthCountingMode } from "../utils/length-metrics.js";

export interface CreativeOutput {
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
  readonly preWriteCheck: string;
}

export function parseCreativeOutput(
  chapterNumber: number,
  content: string,
  countingMode?: LengthCountingMode,
): CreativeOutput {
  const resolvedCountingMode = countingMode ?? resolveLengthCountingMode(detectWritingLanguageFromText(content));
  const extract = (tag: string): string => {
    const regex = new RegExp(
      `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
    );
    const match = content.match(regex);
    return match?.[1]?.trim() ?? "";
  };

  let chapterContent = extract("CHAPTER_CONTENT");

  // Fallback: if === TAG === parsing fails (common with local/small models),
  // try to extract usable content from the raw output
  if (!chapterContent) {
    chapterContent = fallbackExtractContent(content, resolvedCountingMode);
  }

  let title = extract("CHAPTER_TITLE");
  if (!title) {
    title = fallbackExtractTitle(content, chapterNumber, resolvedCountingMode);
  }

  return {
    title,
    content: chapterContent,
    wordCount: countChapterLength(chapterContent, resolvedCountingMode),
    preWriteCheck: extract("PRE_WRITE_CHECK"),
  };
}

/**
 * Fallback content extraction when === CHAPTER_CONTENT === tag is missing.
 * Tries common patterns from local/small models, then falls back to
 * stripping metadata and returning the longest prose block.
 */
function fallbackExtractContent(raw: string, countingMode: LengthCountingMode): string {
  // Try markdown heading: # 第N章 ... followed by content
  const headingMatch = raw.match(/^#\s*第\d+章[^\n]*\n+([\s\S]+)/m);
  if (headingMatch) {
    return headingMatch[1]!.trim();
  }
  const koreanHeadingMatch = raw.match(/^#\s*제\s*\d+\s*장[^\n]*\n+([\s\S]+)/m);
  if (koreanHeadingMatch) {
    return koreanHeadingMatch[1]!.trim();
  }

  if (countingMode === "en_words") {
    const englishHeadingMatch = raw.match(/^#\s*Chapter\s+\d+(?::|\s+)([^\n]*)\n+([\s\S]+)/im);
    if (englishHeadingMatch) {
      return englishHeadingMatch[2]!.trim();
    }
  }

  // Try "正文" or "内容" labeled section
  const labelMatch = raw.match(/(?:본문|正文|内容|章节内容)[：:]\s*\n+([\s\S]+)/);
  if (labelMatch) {
    return labelMatch[1]!.trim();
  }

  if (countingMode === "en_words") {
    const englishLabelMatch = raw.match(/(?:content|chapter content)[：:]\s*\n+([\s\S]+)/i);
    if (englishLabelMatch) {
      return englishLabelMatch[1]!.trim();
    }
  }

  // Last resort: strip lines that look like metadata/tags, keep the rest
  const lines = raw.split("\n");
  const proseLines = lines.filter((line) => {
    const trimmed = line.trim();
    // Skip tag-like lines, empty lines at boundaries, and short key-value lines
    if (/^===\s*[A-Z_]+\s*===/.test(trimmed)) return false;
    if (/^(PRE_WRITE_CHECK|CHAPTER_TITLE|章节标题|写作自检)[：:]/.test(trimmed)) return false;
    return true;
  });
  const result = proseLines.join("\n").trim();
  // Only use fallback if we got meaningful content (>100 chars)
  return result.length > 100 ? result : "";
}

/**
 * Fallback title extraction when === CHAPTER_TITLE === tag is missing.
 */
function fallbackExtractTitle(
  raw: string,
  chapterNumber: number,
  countingMode: LengthCountingMode,
): string {
  // Try: # 第N章 Title
  const headingMatch = raw.match(/^#\s*第\d+章\s*(.+)/m);
  if (headingMatch) {
    return headingMatch[1]!.trim();
  }
  const koreanHeadingMatch = raw.match(/^#\s*제\s*\d+\s*장\s*(.+)/m);
  if (koreanHeadingMatch) {
    return koreanHeadingMatch[1]!.trim();
  }
  if (countingMode === "en_words") {
    const englishHeadingMatch = raw.match(/^#\s*Chapter\s+\d+(?::|\s+)\s*(.+)/im);
    if (englishHeadingMatch) {
      return englishHeadingMatch[1]!.trim();
    }
  }
  // Try: 章节标题：Title or CHAPTER_TITLE: Title (without === delimiters)
  const labelMatch = raw.match(/(?:챕터 제목|장 제목|章节标题|CHAPTER_TITLE)[：:]\s*(.+)/);
  if (labelMatch) {
    return labelMatch[1]!.trim();
  }
  return defaultChapterTitle(chapterNumber, countingMode);
}

export type ParsedWriterOutput = Omit<WriteChapterOutput, "postWriteErrors" | "postWriteWarnings">;

/**
 * Parse LLM output that uses === TAG === delimiters into structured chapter data.
 * Shared by WriterAgent (writing new chapters) and ChapterAnalyzerAgent (analyzing existing chapters).
 */
export function parseWriterOutput(
  chapterNumber: number,
  content: string,
  genreProfile: GenreProfile,
  countingMode?: LengthCountingMode,
): ParsedWriterOutput {
  const resolvedCountingMode = countingMode ?? resolveLengthCountingMode(genreProfile.language);
  const extract = (tag: string): string => {
    const regex = new RegExp(
      `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
    );
    const match = content.match(regex);
    return match?.[1]?.trim() ?? "";
  };

  const chapterContent = extract("CHAPTER_CONTENT");

  return {
    chapterNumber,
    title: extract("CHAPTER_TITLE") || defaultChapterTitle(chapterNumber, resolvedCountingMode),
    content: chapterContent,
    wordCount: countChapterLength(chapterContent, resolvedCountingMode),
    preWriteCheck: extract("PRE_WRITE_CHECK"),
    postSettlement: extract("POST_SETTLEMENT"),
    updatedState: extract("UPDATED_STATE") || defaultStatePlaceholder(resolvedCountingMode),
    updatedLedger: genreProfile.numericalSystem
      ? (extract("UPDATED_LEDGER") || defaultLedgerPlaceholder(resolvedCountingMode))
      : "",
    updatedHooks: extract("UPDATED_HOOKS") || defaultHooksPlaceholder(resolvedCountingMode),
    chapterSummary: extract("CHAPTER_SUMMARY"),
    updatedSubplots: extract("UPDATED_SUBPLOTS"),
    updatedEmotionalArcs: extract("UPDATED_EMOTIONAL_ARCS"),
    updatedCharacterMatrix: extract("UPDATED_CHARACTER_MATRIX"),
  };
}

function defaultChapterTitle(
  chapterNumber: number,
  countingMode: LengthCountingMode,
): string {
  if (countingMode === "en_words") return `Chapter ${chapterNumber}`;
  if (countingMode === "ko_chars") return `제${chapterNumber}장`;
  return `第${chapterNumber}章`;
}

function defaultStatePlaceholder(countingMode: LengthCountingMode): string {
  if (countingMode === "en_words") return "(state card not updated)";
  if (countingMode === "ko_chars") return "(상태 카드가 아직 갱신되지 않음)";
  return "(状态卡未更新)";
}

function defaultLedgerPlaceholder(countingMode: LengthCountingMode): string {
  if (countingMode === "en_words") return "(ledger not updated)";
  if (countingMode === "ko_chars") return "(원장 정보가 아직 갱신되지 않음)";
  return "(账本未更新)";
}

function defaultHooksPlaceholder(countingMode: LengthCountingMode): string {
  if (countingMode === "en_words") return "(hooks pool not updated)";
  if (countingMode === "ko_chars") return "(떡밥 풀이 아직 갱신되지 않음)";
  return "(伏笔池未更新)";
}
