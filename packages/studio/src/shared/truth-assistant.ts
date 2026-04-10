export type BinderMode = "overview" | "workspace";

export interface TruthAssistantFile {
  readonly name: string;
  readonly label: string;
  readonly exists: boolean;
  readonly path: string;
}

export interface TruthAlignmentContext {
  readonly knownFacts: ReadonlyArray<string>;
  readonly unknowns: ReadonlyArray<string>;
  readonly mustDecide: string;
  readonly askFirst: string;
}

export interface TruthAssistantContext {
  readonly kind: "truth";
  readonly bookId: string;
  readonly mode: BinderMode;
  readonly detailFile: string | null;
  readonly workspaceTargetFile: string;
  readonly files: ReadonlyArray<TruthAssistantFile>;
  readonly alignment: TruthAlignmentContext | null;
  readonly currentContents: Readonly<Record<string, string>>;
  readonly applySuggestion: (fileName: string, proposalMarkdown: string) => void;
  readonly applyInterviewAnswer: (question: string, answer: string) => void;
  readonly openDetail: (fileName: string) => void;
  readonly setWorkspaceTargetFile: (fileName: string) => void;
}

export interface DiffLine {
  readonly type: "context" | "add" | "remove" | "skip";
  readonly text: string;
  readonly beforeLine: number | null;
  readonly afterLine: number | null;
}

export interface TruthTargetResolved {
  readonly status: "resolved";
  readonly fileNames: ReadonlyArray<string>;
  readonly reason: "detail-lock" | "bundle" | "single" | "workspace-default";
}

export interface TruthTargetClarify {
  readonly status: "clarify";
  readonly suggestedFileNames: ReadonlyArray<string>;
}

export type TruthTargetInference = TruthTargetResolved | TruthTargetClarify;

interface TruthTargetRule {
  readonly fileName: string;
  readonly keywords: ReadonlyArray<string>;
}

const TARGET_RULES: ReadonlyArray<TruthTargetRule> = [
  {
    fileName: "author_intent.md",
    keywords: ["작가 의도", "author intent", "장기 방향", "장기 목표", "핵심 주제", "주제", "의도", "정체성", "컨셉", "방향성"],
  },
  {
    fileName: "current_focus.md",
    keywords: ["current focus", "현재 초점", "다음 화", "다음 3화", "다음 세 화", "단기", "최근 전개", "당장", "이번 화", "이번 장"],
  },
  {
    fileName: "story_bible.md",
    keywords: ["story bible", "세계관", "배경", "설정", "세력", "종족", "법칙", "룰", "국가", "지리"],
  },
  {
    fileName: "volume_outline.md",
    keywords: ["volume outline", "볼륨", "아크", "권별", "장기 전개", "전개표", "큰 흐름", "구간 설계"],
  },
  {
    fileName: "book_rules.md",
    keywords: ["book rules", "규칙", "원칙", "금기", "톤", "지켜야", "하지 말", "문체 룰"],
  },
  {
    fileName: "current_state.md",
    keywords: ["current state", "현재 상태", "현재 상황", "관계", "진행 상태", "지금 어디", "누가 뭘 알고"],
  },
  {
    fileName: "pending_hooks.md",
    keywords: ["pending hooks", "복선", "떡밥", "회수", "떡밥 회수", "미회수", "후크"],
  },
  {
    fileName: "character_matrix.md",
    keywords: ["character matrix", "캐릭터 관계", "인물 관계", "대화 톤", "관계도", "상호작용"],
  },
  {
    fileName: "emotional_arcs.md",
    keywords: ["감정선", "감정 아크", "emotional arcs", "정서 흐름", "감정 변화"],
  },
  {
    fileName: "subplot_board.md",
    keywords: ["subplot", "서브플롯", "보조 플롯", "병행 전개", "가지 이야기"],
  },
];

const BUNDLE_HINTS = ["전체", "전반", "한꺼번에", "묶어서", "여러 문서", "여러 파일", "모아서", "설정집 전체", "전부", "모두"];
const WORKSPACE_DEFAULT_HINTS = ["이 문서", "이번 문서", "현재 문서", "여기", "지금 문서", "현재 편집"];
const DEFAULT_BUNDLE_FILES = [
  "author_intent.md",
  "current_focus.md",
  "story_bible.md",
  "volume_outline.md",
  "book_rules.md",
] as const;

export function normalizeTruthText(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}

export function makeTruthPreview(text: string, limit = 220): string {
  const safeText = normalizeTruthText(text);
  if (safeText.length <= limit) {
    return safeText;
  }
  return `${safeText.slice(0, Math.max(0, limit - 1))}…`;
}

function splitLines(value: string): ReadonlyArray<string> {
  const normalized = value.replace(/\r\n/g, "\n");
  if (!normalized.length) return [];
  return normalized.split("\n");
}

export function buildTruthLineDiff(before: string, after: string): ReadonlyArray<DiffLine> {
  const left = splitLines(before);
  const right = splitLines(after);
  const dp = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      if (left[i] === right[j]) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let beforeLine = 1;
  let afterLine = 1;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      lines.push({ type: "context", text: left[i]!, beforeLine, afterLine });
      i += 1;
      j += 1;
      beforeLine += 1;
      afterLine += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      lines.push({ type: "remove", text: left[i]!, beforeLine, afterLine: null });
      i += 1;
      beforeLine += 1;
    } else {
      lines.push({ type: "add", text: right[j]!, beforeLine: null, afterLine });
      j += 1;
      afterLine += 1;
    }
  }

  while (i < left.length) {
    lines.push({ type: "remove", text: left[i]!, beforeLine, afterLine: null });
    i += 1;
    beforeLine += 1;
  }

  while (j < right.length) {
    lines.push({ type: "add", text: right[j]!, beforeLine: null, afterLine });
    j += 1;
    afterLine += 1;
  }

  const collapsed: DiffLine[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    if (lines[cursor]!.type !== "context") {
      collapsed.push(lines[cursor]!);
      cursor += 1;
      continue;
    }

    let end = cursor;
    while (end < lines.length && lines[end]!.type === "context") {
      end += 1;
    }
    const count = end - cursor;
    if (count <= 6) {
      collapsed.push(...lines.slice(cursor, end));
    } else {
      collapsed.push(...lines.slice(cursor, cursor + 2));
      collapsed.push({
        type: "skip",
        text: `… ${count - 4} lines unchanged …`,
        beforeLine: null,
        afterLine: null,
      });
      collapsed.push(...lines.slice(end - 2, end));
    }
    cursor = end;
  }

  return collapsed;
}

export function summarizeTruthDiff(lines: ReadonlyArray<DiffLine>): { added: number; removed: number } {
  return {
    added: lines.filter((line) => line.type === "add").length,
    removed: lines.filter((line) => line.type === "remove").length,
  };
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function inferTruthTargets(
  instruction: string,
  context: Pick<TruthAssistantContext, "detailFile" | "workspaceTargetFile" | "files">,
): TruthTargetInference {
  if (context.detailFile && context.files.some((file) => file.name === context.detailFile)) {
    return {
      status: "resolved",
      fileNames: [context.detailFile],
      reason: "detail-lock",
    };
  }

  const normalized = normalizeSearchText(instruction);
  const available = new Set(context.files.map((file) => file.name));
  const broadBundle = BUNDLE_HINTS.some((hint) => normalized.includes(normalizeSearchText(hint)));

  if (broadBundle) {
    const bundle = DEFAULT_BUNDLE_FILES.filter((fileName) => available.has(fileName));
    if (bundle.length > 0) {
      return {
        status: "resolved",
        fileNames: bundle,
        reason: "bundle",
      };
    }
  }

  const scores = context.files.map((file) => {
    let score = 0;
    const baseName = file.name.replace(/\.md$/i, "");
    const normalizedLabel = normalizeSearchText(file.label);
    if (normalized.includes(normalizeSearchText(baseName))) {
      score += 4;
    }
    if (normalizedLabel && normalized.includes(normalizedLabel)) {
      score += 4;
    }
    const rule = TARGET_RULES.find((entry) => entry.fileName === file.name);
    for (const keyword of rule?.keywords ?? []) {
      if (normalized.includes(normalizeSearchText(keyword))) {
        score += 2;
      }
    }
    return { fileName: file.name, score };
  }).filter((entry) => entry.score > 0).sort((left, right) => right.score - left.score);

  if (scores.length === 0) {
    const prefersCurrentDocument = WORKSPACE_DEFAULT_HINTS.some((hint) => normalized.includes(normalizeSearchText(hint)));
    if (prefersCurrentDocument && context.workspaceTargetFile && available.has(context.workspaceTargetFile)) {
      return {
        status: "resolved",
        fileNames: [context.workspaceTargetFile],
        reason: "workspace-default",
      };
    }
    return {
      status: "clarify",
      suggestedFileNames: context.files.slice(0, 3).map((file) => file.name),
    };
  }

  if (scores.length === 1 || scores[0]!.score >= (scores[1]?.score ?? 0) + 2) {
    return {
      status: "resolved",
      fileNames: [scores[0]!.fileName],
      reason: "single",
    };
  }

  if (broadBundle) {
    return {
      status: "resolved",
      fileNames: scores.slice(0, 3).map((entry) => entry.fileName),
      reason: "bundle",
    };
  }

  return {
    status: "clarify",
    suggestedFileNames: scores.slice(0, 3).map((entry) => entry.fileName),
  };
}

export function truthThreadKey(context: Pick<TruthAssistantContext, "bookId" | "mode" | "detailFile">): string {
  return context.detailFile
    ? `truth:${context.bookId}:${context.mode}:detail:${context.detailFile}`
    : `truth:${context.bookId}:${context.mode}`;
}
