import type { StudioLanguage } from "./language.js";

const CHAPTER_PREFIX_PATTERN = /^(?:제\s*\d+\s*(?:장|화)|第\s*[零〇○Ｏ０一二三四五六七八九十百千万\d]+\s*(?:章|回)|Chapter\s+(?:\d+|[IVXLCDM]+))(?:[:：.\-]\s*|\s+)?/i;

export function defaultLocalizedChapterTitle(
  chapterNumber: number,
  language: StudioLanguage | null | undefined,
): string {
  if (language === "en") return `Chapter ${chapterNumber}`;
  if (language === "ko") return `제${chapterNumber}장`;
  return `第${chapterNumber}章`;
}

export function localizeChapterTitle(
  rawTitle: string | null | undefined,
  chapterNumber: number,
  language: StudioLanguage | null | undefined,
): string {
  const title = String(rawTitle ?? "").trim().replace(/^#\s*/, "");
  const fallback = defaultLocalizedChapterTitle(chapterNumber, language);

  if (!title) return fallback;
  if (!CHAPTER_PREFIX_PATTERN.test(title)) return title;

  const suffix = title.replace(CHAPTER_PREFIX_PATTERN, "").trim();
  return suffix ? `${fallback} ${suffix}` : fallback;
}
