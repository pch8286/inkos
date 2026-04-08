import { z } from "zod";

export const WritingLanguageSchema = z.enum(["ko", "zh", "en"]);
export type WritingLanguage = z.infer<typeof WritingLanguageSchema>;

export function isWritingLanguage(value: string | null | undefined): value is WritingLanguage {
  return value === "ko" || value === "zh" || value === "en";
}

export function resolveWritingLanguage(
  value: string | null | undefined,
  fallback: WritingLanguage = "ko",
): WritingLanguage {
  return isWritingLanguage(value) ? value : fallback;
}

export function isEnglishLanguage(language: string | null | undefined): language is "en" {
  return language === "en";
}

export function isChineseLanguage(language: string | null | undefined): language is "zh" {
  return language === "zh";
}

export function isKoreanLanguage(language: string | null | undefined): language is "ko" {
  return language === "ko";
}

export function isCjkWritingLanguage(
  language: string | null | undefined,
): language is "ko" | "zh" {
  return language === "ko" || language === "zh";
}

export function detectWritingLanguageFromText(
  text: string,
  fallback: WritingLanguage = "ko",
): WritingLanguage {
  const sample = text.trim();
  if (!sample) return fallback;
  if (/[가-힣]/u.test(sample)) return "ko";
  if (/[\u4e00-\u9fff]/u.test(sample)) return "zh";
  if (/[A-Za-z]/.test(sample)) return "en";
  return fallback;
}
