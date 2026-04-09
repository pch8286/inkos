export interface ImportedGenreProfile {
  readonly id: string;
  readonly name: string;
  readonly language: "ko";
  readonly chapterTypes: ReadonlyArray<string>;
  readonly fatigueWords: ReadonlyArray<string>;
  readonly numericalSystem: boolean;
  readonly powerScaling: boolean;
  readonly eraResearch: boolean;
  readonly pacingRule: string;
  readonly satisfactionTypes: ReadonlyArray<string>;
  readonly auditDimensions: ReadonlyArray<number>;
  readonly body: string;
}

const BASE_AUDIT_DIMENSIONS = [1, 2, 3, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 18, 19, 24, 25, 26] as const;
const POWER_AUDIT_DIMENSIONS = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 24, 25, 26] as const;

export function normalizeImportedGenreId(rawId: string): string {
  const normalized = rawId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) {
    throw new Error(`Invalid genre ID: "${rawId}"`);
  }

  return normalized;
}

export function parseGenreBatchMarkdown(raw: string): ReadonlyArray<ImportedGenreProfile> {
  const sections = splitGenreSections(raw);
  if (sections.length === 0) {
    throw new Error("No genre sections found. Expected blocks starting with `##`.");
  }

  return sections.map((section) => parseGenreSection(section));
}

export function renderGenreProfileMarkdown(profile: ImportedGenreProfile): string {
  return [
    "---",
    `name: ${profile.name}`,
    `id: ${profile.id}`,
    `language: ${profile.language}`,
    `chapterTypes: ${JSON.stringify(profile.chapterTypes)}`,
    `fatigueWords: ${JSON.stringify(profile.fatigueWords)}`,
    `numericalSystem: ${profile.numericalSystem}`,
    `powerScaling: ${profile.powerScaling}`,
    `eraResearch: ${profile.eraResearch}`,
    `pacingRule: "${escapeYamlDoubleQuoted(profile.pacingRule)}"`,
    `satisfactionTypes: ${JSON.stringify(profile.satisfactionTypes)}`,
    `auditDimensions: ${JSON.stringify(profile.auditDimensions)}`,
    "---",
    "",
    profile.body.trim(),
    "",
  ].join("\n");
}

function parseGenreSection(section: string): ImportedGenreProfile {
  const id = normalizeImportedGenreId(readField(section, "ID"));
  const name = readField(section, "이름");
  const chapterTypes = splitCommaSeparated(readField(section, "Chapter Types \\(comma-separated\\)"));
  const fatigueWords = splitCommaSeparated(readField(section, "Fatigue Words \\(comma-separated\\)"));
  const numericalRaw = readField(section, "Numerical 사용여부");
  const powerRaw = readField(section, "Power scaling 사용여부");
  const eraRaw = readField(section, "Era Research 사용여부");
  const pacingRule = readField(section, "Pacing Rule");
  const rulesMarkdown = readRulesBody(section);

  const notes = buildUsageNotes(numericalRaw, powerRaw, eraRaw);
  const body = notes.length > 0
    ? `## 메타 설정\n\n${notes.join("\n")}\n\n${rulesMarkdown}`
    : rulesMarkdown;

  const numericalSystem = parseNumericalUsage(numericalRaw);
  const powerScaling = parsePowerUsage(powerRaw);
  const eraResearch = parseEraUsage(eraRaw);

  return {
    id,
    name,
    language: "ko",
    chapterTypes,
    fatigueWords,
    numericalSystem,
    powerScaling,
    eraResearch,
    pacingRule,
    satisfactionTypes: [],
    auditDimensions: powerScaling ? [...POWER_AUDIT_DIMENSIONS] : [...BASE_AUDIT_DIMENSIONS],
    body,
  };
}

function splitGenreSections(raw: string): string[] {
  const sections: string[] = [];
  const lines = raw.split(/\r?\n/);
  let current: string[] | null = null;

  for (const line of lines) {
    if (/^##\s+\S+\s*$/.test(line.trim())) {
      if (current) {
        sections.push(current.join("\n").trim());
      }
      current = [];
      continue;
    }

    if (current) {
      current.push(line);
    }
  }

  if (current) {
    sections.push(current.join("\n").trim());
  }

  return sections.filter(Boolean);
}

function readField(section: string, label: string): string {
  const pattern = new RegExp(`^\\*\\*${label}\\*\\*:\\s*(.+)$`, "m");
  const match = section.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Missing required field: ${label}`);
  }
  return match[1].trim();
}

function readRulesBody(section: string): string {
  const match = section.match(/\*\*Rules \(Markdown\)\*\*:\s*([\s\S]*)$/);
  if (!match?.[1]) {
    throw new Error("Missing required field: Rules (Markdown)");
  }
  return match[1].replace(/\n---\s*$/m, "").trim();
}

function splitCommaSeparated(value: string): ReadonlyArray<string> {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeUsage(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

function parseNumericalUsage(value: string): boolean {
  const normalized = normalizeUsage(value);
  if (normalized === "사용") return true;
  if (normalized === "제한적사용") return false;
  return false;
}

function parsePowerUsage(value: string): boolean {
  const normalized = normalizeUsage(value);
  return normalized === "사용" || normalized === "제한적사용";
}

function parseEraUsage(value: string): boolean {
  return normalizeUsage(value) === "사용";
}

function buildUsageNotes(numerical: string, power: string, era: string): string[] {
  const notes: string[] = [];
  const numericalNormalized = normalizeUsage(numerical);
  const powerNormalized = normalizeUsage(power);
  const eraNormalized = normalizeUsage(era);

  if (numericalNormalized === "제한적사용") {
    notes.push("- 수치 시스템: 제한적으로 사용한다. 전면적인 상태창/자원 장부 중심 운영은 피한다.");
  }
  if (powerNormalized === "제한적사용") {
    notes.push("- 전투력 스케일: 존재는 하지만 서사의 중심 엔진으로 과도하게 부풀리지 않는다.");
  }
  if (eraNormalized === "설정의존") {
    notes.push("- 시대 조사: 배경 설정이 역사/근현대 참조를 요구할 때만 활성화한다.");
  }

  return notes;
}

function escapeYamlDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
