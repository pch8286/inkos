import { z } from "zod";
import yaml from "js-yaml";
import { detectWritingLanguageFromText, WritingLanguageSchema } from "./language.js";

export const GenreProfileSchema = z.object({
  name: z.string(),
  id: z.string(),
  language: WritingLanguageSchema.default("ko"),
  chapterTypes: z.array(z.string()),
  fatigueWords: z.array(z.string()),
  numericalSystem: z.boolean().default(false),
  powerScaling: z.boolean().default(false),
  eraResearch: z.boolean().default(false),
  pacingRule: z.string().default(""),
  satisfactionTypes: z.array(z.string()).default([]),
  auditDimensions: z.array(z.number()).default([]),
});

export type GenreProfile = z.infer<typeof GenreProfileSchema>;

export interface ParsedGenreProfile {
  readonly profile: GenreProfile;
  readonly body: string;
}

export function parseGenreProfile(raw: string): ParsedGenreProfile {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error("Genre profile missing YAML frontmatter (--- ... ---)");
  }

  const frontmatter = yaml.load(fmMatch[1]) as Record<string, unknown>;
  const body = fmMatch[2].trim();
  const inferredLanguage = detectWritingLanguageFromText(
    [String(frontmatter.name ?? ""), body].filter(Boolean).join("\n"),
  );
  const profile = GenreProfileSchema.parse(frontmatter);

  return {
    profile: {
      ...profile,
      language: typeof frontmatter.language === "string" ? profile.language : inferredLanguage,
    },
    body,
  };
}
