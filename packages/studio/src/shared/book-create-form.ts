import type { StudioLanguage } from "./language";

export interface PlatformOption {
  readonly value: string;
  readonly label: string;
}

const PLATFORMS_ZH: ReadonlyArray<PlatformOption> = [
  { value: "tomato", label: "番茄小说" },
  { value: "qidian", label: "起点中文网" },
  { value: "feilu", label: "飞卢" },
  { value: "other", label: "其他" },
];

const PLATFORMS_EN: ReadonlyArray<PlatformOption> = [
  { value: "royal-road", label: "Royal Road" },
  { value: "kindle-unlimited", label: "Kindle Unlimited" },
  { value: "scribble-hub", label: "Scribble Hub" },
  { value: "other", label: "Other" },
];

const PLATFORMS_KO: ReadonlyArray<PlatformOption> = [
  { value: "naver-series", label: "네이버 시리즈" },
  { value: "kakao-page", label: "카카오페이지" },
  { value: "munpia", label: "문피아" },
  { value: "novelpia", label: "노벨피아" },
  { value: "other", label: "기타" },
];

export function pickValidValue(current: string, available: ReadonlyArray<string>): string {
  if (current && available.includes(current)) {
    return current;
  }
  return available[0] ?? "";
}

export function defaultChapterWordsForLanguage(language: StudioLanguage): string {
  return language === "en" ? "2000" : "3000";
}

export function platformOptionsForLanguage(language: StudioLanguage): ReadonlyArray<PlatformOption> {
  if (language === "en") {
    return PLATFORMS_EN;
  }
  if (language === "ko") {
    return PLATFORMS_KO;
  }
  return PLATFORMS_ZH;
}

export function platformLabelForLanguage(language: StudioLanguage, platform: string): string {
  const options = platformOptionsForLanguage(language);
  return options.find((option) => option.value === platform)?.label ?? platform;
}
