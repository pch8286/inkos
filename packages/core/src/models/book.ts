import { z } from "zod";
import { WritingLanguageSchema } from "./language.js";

export const PlatformSchema = z.enum([
  "tomato",
  "feilu",
  "qidian",
  "naver-series",
  "kakao-page",
  "munpia",
  "novelpia",
  "other",
]);
export type Platform = z.infer<typeof PlatformSchema>;

export const GenreSchema = z.string().min(1);
export type Genre = z.infer<typeof GenreSchema>;

export const BookStatusSchema = z.enum([
  "incubating",
  "outlining",
  "active",
  "paused",
  "completed",
  "dropped",
]);
export type BookStatus = z.infer<typeof BookStatusSchema>;

export const FanficModeSchema = z.enum(["canon", "au", "ooc", "cp"]);
export type FanficMode = z.infer<typeof FanficModeSchema>;

export const ReaderFontPresetSchema = z.enum(["sans", "serif", "myeongjo"]);
export type ReaderFontPreset = z.infer<typeof ReaderFontPresetSchema>;

export const ReaderDeviceSettingsSchema = z.object({
  fontPreset: ReaderFontPresetSchema,
  fontSize: z.number().int().min(12).max(28),
  lineHeight: z.number().min(1.3).max(2.2),
});
export type ReaderDeviceSettings = z.infer<typeof ReaderDeviceSettingsSchema>;

export const ReaderSettingsSchema = z.object({
  mobile: ReaderDeviceSettingsSchema,
  desktop: ReaderDeviceSettingsSchema,
});
export type ReaderSettings = z.infer<typeof ReaderSettingsSchema>;

export const BookConfigSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  platform: PlatformSchema,
  genre: GenreSchema,
  status: BookStatusSchema,
  targetChapters: z.number().int().min(1).default(200),
  chapterWordCount: z.number().int().min(1000).default(3000),
  language: WritingLanguageSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  parentBookId: z.string().optional(),
  fanficMode: FanficModeSchema.optional(),
  readerSettings: ReaderSettingsSchema.optional(),
});

export type BookConfig = z.infer<typeof BookConfigSchema>;
