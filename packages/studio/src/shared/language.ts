export type StudioLanguage = "ko" | "zh" | "en";

export const STUDIO_LANGUAGES = ["ko", "zh", "en"] as const;

export function isStudioLanguage(value: string | null | undefined): value is StudioLanguage {
  return value === "ko" || value === "zh" || value === "en";
}

export function resolveStudioLanguage(value: string | null | undefined): StudioLanguage {
  return isStudioLanguage(value) ? value : "ko";
}

export function languageBadgeLabel(language: StudioLanguage): string {
  return language.toUpperCase();
}
