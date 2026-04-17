import type { ReaderDeviceSettings, ReaderSettings } from "./contracts";

export type ReaderDeviceScope = "mobile" | "desktop";
export type ReaderSettingField = "fontPreset" | "fontSize" | "lineHeight";

export interface ReaderSettingsDiffItem {
  readonly device: ReaderDeviceScope;
  readonly field: ReaderSettingField;
  readonly savedValue: ReaderDeviceSettings[ReaderSettingField];
  readonly draftValue: ReaderDeviceSettings[ReaderSettingField];
}

export interface ReaderBodyStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly lineHeight: number;
}

const READER_DEVICE_ORDER: ReadonlyArray<ReaderDeviceScope> = ["mobile", "desktop"];
const READER_FIELD_ORDER: ReadonlyArray<ReaderSettingField> = ["fontPreset", "fontSize", "lineHeight"];
const VALID_FONT_PRESETS: ReadonlyArray<ReaderDeviceSettings["fontPreset"]> = ["sans", "serif", "myeongjo"];
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 28;
const MIN_LINE_HEIGHT = 1.3;
const MAX_LINE_HEIGHT = 2.2;

export const DEFAULT_READER_SETTINGS: Readonly<ReaderSettings> = {
  mobile: { fontPreset: "myeongjo", fontSize: 16, lineHeight: 1.72 },
  desktop: { fontPreset: "myeongjo", fontSize: 18, lineHeight: 1.82 },
} as const;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFontPreset(value: unknown): value is ReaderDeviceSettings["fontPreset"] {
  return typeof value === "string" && VALID_FONT_PRESETS.includes(value as ReaderDeviceSettings["fontPreset"]);
}

function normalizeFontSize(value: unknown, fallback: number): number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= MIN_FONT_SIZE
    && value <= MAX_FONT_SIZE
    ? value
    : fallback;
}

function normalizeLineHeight(value: unknown, fallback: number): number {
  return typeof value === "number"
    && value >= MIN_LINE_HEIGHT
    && value <= MAX_LINE_HEIGHT
    ? value
    : fallback;
}

function normalizeDeviceSettings(value: unknown, fallback: ReaderDeviceSettings): ReaderDeviceSettings {
  if (!isObjectRecord(value)) {
    return { ...fallback };
  }

  return {
    fontPreset: isFontPreset(value.fontPreset) ? value.fontPreset : fallback.fontPreset,
    fontSize: normalizeFontSize(value.fontSize, fallback.fontSize),
    lineHeight: normalizeLineHeight(value.lineHeight, fallback.lineHeight),
  };
}

export function normalizeReaderSettings(value: unknown): ReaderSettings {
  const settings = isObjectRecord(value) ? value : {};

  return {
    mobile: normalizeDeviceSettings(settings.mobile, DEFAULT_READER_SETTINGS.mobile),
    desktop: normalizeDeviceSettings(settings.desktop, DEFAULT_READER_SETTINGS.desktop),
  };
}

export function buildReaderSettingsDiff(
  savedSettings: unknown,
  draftSettings: unknown,
): ReadonlyArray<ReaderSettingsDiffItem> {
  const saved = normalizeReaderSettings(savedSettings);
  const draft = normalizeReaderSettings(draftSettings);
  const diff: ReaderSettingsDiffItem[] = [];

  for (const device of READER_DEVICE_ORDER) {
    for (const field of READER_FIELD_ORDER) {
      const savedValue = saved[device][field];
      const draftValue = draft[device][field];
      if (savedValue !== draftValue) {
        diff.push({
          device,
          field,
          savedValue,
          draftValue,
        });
      }
    }
  }

  return diff;
}

function fontFamilyForPreset(fontPreset: ReaderDeviceSettings["fontPreset"]): string {
  if (fontPreset === "sans") {
    return "var(--font-sans)";
  }
  if (fontPreset === "serif") {
    return "var(--font-serif)";
  }
  return "'Nanum Myeongjo', 'Noto Serif KR', Georgia, serif";
}

export function resolveReaderBodyStyle(
  device: ReaderDeviceScope,
  settings: unknown,
): ReaderBodyStyle {
  const normalized = normalizeReaderSettings(settings);
  const deviceSettings = normalized[device];

  return {
    fontFamily: fontFamilyForPreset(deviceSettings.fontPreset),
    fontSize: deviceSettings.fontSize,
    lineHeight: deviceSettings.lineHeight,
  };
}
