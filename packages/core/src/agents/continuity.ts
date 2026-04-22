import { BaseAgent } from "./base.js";
import type { WritingLanguage } from "../models/language.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import type { FanficMode } from "../models/book.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import { readGenreProfile, readBookLanguage, readBookRules } from "./rules-reader.js";
import { getFanficDimensionConfig, FANFIC_DIMENSIONS } from "./fanfic-dimensions.js";
import { readFile, readdir } from "node:fs/promises";
import { filterHooks, filterSummaries, filterSubplots, filterEmotionalArcs, filterCharacterMatrix } from "../utils/context-filter.js";
import { buildGovernedMemoryEvidenceBlocks } from "../utils/governed-context.js";
import { join } from "node:path";

export interface AuditResult {
  readonly passed: boolean;
  readonly issues: ReadonlyArray<AuditIssue>;
  readonly summary: string;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export interface AuditIssue {
  readonly severity: "critical" | "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

type PromptLanguage = WritingLanguage;

const DIMENSION_LABELS: Record<number, { readonly zh: string; readonly en: string; readonly ko: string }> = {
  1: { zh: "OOC检查", en: "OOC Check", ko: "캐릭터 붕괴 검사" },
  2: { zh: "时间线检查", en: "Timeline Check", ko: "타임라인 검사" },
  3: { zh: "设定冲突", en: "Lore Conflict Check", ko: "설정 충돌 검사" },
  4: { zh: "战力崩坏", en: "Power Scaling Check", ko: "전력 밸런스 붕괴 검사" },
  5: { zh: "数值检查", en: "Numerical Consistency Check", ko: "수치 일관성 검사" },
  6: { zh: "伏笔检查", en: "Hook Check", ko: "복선 검사" },
  7: { zh: "节奏检查", en: "Pacing Check", ko: "전개 리듬 검사" },
  8: { zh: "文风检查", en: "Style Check", ko: "문체 검사" },
  9: { zh: "信息越界", en: "Information Boundary Check", ko: "정보 경계 검사" },
  10: { zh: "词汇疲劳", en: "Lexical Fatigue Check", ko: "어휘 피로도 검사" },
  11: { zh: "利益链断裂", en: "Incentive Chain Check", ko: "이해관계 연쇄 검사" },
  12: { zh: "年代考据", en: "Era Accuracy Check", ko: "시대 고증 검사" },
  13: { zh: "配角降智", en: "Side Character Competence Check", ko: "조연 지능 저하 검사" },
  14: { zh: "配角工具人化", en: "Side Character Instrumentalization Check", ko: "조연 도구화 검사" },
  15: { zh: "爽点虚化", en: "Payoff Dilution Check", ko: "카타르시스 희석 검사" },
  16: { zh: "台词失真", en: "Dialogue Authenticity Check", ko: "대사 진정성 검사" },
  17: { zh: "流水账", en: "Chronicle Drift Check", ko: "나열식 전개 검사" },
  18: { zh: "知识库污染", en: "Knowledge Base Pollution Check", ko: "지식 오염 검사" },
  19: { zh: "视角一致性", en: "POV Consistency Check", ko: "시점 일관성 검사" },
  20: { zh: "段落等长", en: "Paragraph Uniformity Check", ko: "문단 길이 획일화 검사" },
  21: { zh: "套话密度", en: "Cliche Density Check", ko: "클리셰 밀도 검사" },
  22: { zh: "公式化转折", en: "Formulaic Twist Check", ko: "공식적 반전 검사" },
  23: { zh: "列表式结构", en: "List-like Structure Check", ko: "목록형 구조 검사" },
  24: { zh: "支线停滞", en: "Subplot Stagnation Check", ko: "서브플롯 정체 검사" },
  25: { zh: "弧线平坦", en: "Arc Flatline Check", ko: "감정선 평탄화 검사" },
  26: { zh: "节奏单调", en: "Pacing Monotony Check", ko: "전개 단조로움 검사" },
  27: { zh: "敏感词检查", en: "Sensitive Content Check", ko: "민감어 검사" },
  28: { zh: "正传事件冲突", en: "Mainline Canon Event Conflict", ko: "본편 사건 충돌 검사" },
  29: { zh: "未来信息泄露", en: "Future Knowledge Leak Check", ko: "미래 정보 유출 검사" },
  30: { zh: "世界规则跨书一致性", en: "Cross-Book World Rule Check", ko: "작품 간 세계관 규칙 검사" },
  31: { zh: "番外伏笔隔离", en: "Spinoff Hook Isolation Check", ko: "외전 복선 분리 검사" },
  32: { zh: "读者期待管理", en: "Reader Expectation Check", ko: "독자 기대 관리 검사" },
  33: { zh: "大纲偏离检测", en: "Outline Drift Check", ko: "아웃라인 이탈 검사" },
  34: { zh: "角色还原度", en: "Character Fidelity Check", ko: "캐릭터 재현도 검사" },
  35: { zh: "世界规则遵守", en: "World Rule Compliance Check", ko: "세계관 규칙 준수 검사" },
  36: { zh: "关系动态", en: "Relationship Dynamics Check", ko: "관계 변화 검사" },
  37: { zh: "正典事件一致性", en: "Canon Event Consistency Check", ko: "정전 사건 일관성 검사" },
};

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/u.test(text);
}

function fallbackCategoryFor(language: PromptLanguage): string {
  return language === "en" ? "Uncategorized" : language === "ko" ? "미분류" : "未分类";
}

function systemErrorCategory(language: PromptLanguage): string {
  return language === "en" ? "System Error" : language === "ko" ? "시스템 오류" : "系统错误";
}

function parseFailureDescription(language: PromptLanguage): string {
  return language === "en"
    ? "Audit output format was invalid and could not be parsed as JSON."
    : language === "ko"
      ? "감사 출력 형식이 유효한 JSON이 아니어서 파싱할 수 없습니다."
      : "审稿输出格式异常，无法解析为 JSON";
}

function parseFailureSuggestion(language: PromptLanguage): string {
  return language === "en"
    ? "The model may not support reliable structured output. Try a stronger model or inspect the API response format."
    : language === "ko"
      ? "모델이 구조화 출력이 불안정할 수 있습니다. 더 강한 모델을 사용하거나 API 응답 형식을 점검하세요."
      : "可能是模型不支持结构化输出。尝试换一个更大的模型，或检查 API 返回格式。";
}

function parseFailureSummary(language: PromptLanguage): string {
  return language === "en"
    ? "Audit output parsing failed"
    : language === "ko"
      ? "감사 출력 파싱 실패"
      : "审稿输出解析失败";
}

function joinLocalized(items: ReadonlyArray<string>, language: PromptLanguage): string {
  return items.join(language === "en" || language === "ko" ? ", " : "、");
}

function formatDimensionNote(language: PromptLanguage, note: string): string {
  return language === "en" ? ` (${note})` : language === "zh" ? `（${note}）` : ` (${note})`;
}

function fanficSeverityNote(language: PromptLanguage, severity: "critical" | "warning" | "info"): string {
  if (language === "en") {
    return severity === "critical"
      ? "Strict check."
      : severity === "info"
        ? "Log only; do not fail the chapter."
        : "Warning level.";
  }

  if (language === "ko") {
    return severity === "critical"
      ? "엄격 점검."
      : severity === "info"
        ? "기록 전용, 챕터 실패 처리 안 함."
        : "경고 단계.";
  }

  return severity === "critical"
    ? "（严格检查）"
    : severity === "info"
      ? "（仅记录，不判定失败）"
      : "（警告级别）";
}

const FANFIC_NOTES_KO: Readonly<Record<number, string>> = {
  34: "캐릭터의 말투, 발화 스타일, 행동 패턴이 fanfic_canon.md의 캐릭터 아카이브와 일치하는지 점검하세요.",
  35: "현재 챕터가 fanfic_canon.md에 기록된 세계 규칙(지리, 전력 체계, 진영 관계)을 위반하지 않는지 점검하세요.",
  36: "주요 관계의 호흡이 합리적인지, 혹은 fanfic_canon.md의 핵심 관계 설정과 의미 있게 이어지는지 점검하세요.",
  37: "현재 챕터가 fanfic_canon.md의 핵심 사건 타임라인과 충돌하지 않는지 점검하세요.",
};

const FANFIC_NOTES_EN: Readonly<Record<number, string>> = {
  34: "Check whether dialogue tics, speaking style, and behavior remain consistent with the character dossiers in fanfic_canon.md. Deviations need clear situational motivation.",
  35: "Check whether the chapter violates world rules documented in fanfic_canon.md (geography, power system, faction relations).",
  36: "Check whether relationship beats remain plausible and aligned with, or meaningfully develop from, the key relationships documented in fanfic_canon.md.",
  37: "Check whether the chapter contradicts the key event timeline in fanfic_canon.md.",
};

function resolveGenreLabel(genreId: string, profileName: string, language: PromptLanguage): string {
  if (language === "zh" || language === "en") {
    return profileName;
  }

  if (language === "ko" && containsChinese(profileName)) {
    return genreId.replace(/[_-]+/g, " ");
  }

  if (genreId === "other") {
    return language === "ko" ? "일반" : "general";
  }

  return genreId.replace(/[_-]+/g, " ");
}

function dimensionName(id: number, language: PromptLanguage): string | undefined {
  return DIMENSION_LABELS[id]?.[language];
}

function formatFanficSeverityNote(
  severity: "critical" | "warning" | "info",
  language: PromptLanguage,
): string {
  return fanficSeverityNote(language, severity);
}

function buildDimensionNote(
  id: number,
  language: PromptLanguage,
  gp: GenreProfile,
  bookRules: BookRules | null,
  fanficMode: FanficMode | undefined,
  fanficConfig: ReturnType<typeof getFanficDimensionConfig> | undefined,
): string {
  const words = bookRules?.fatigueWordsOverride && bookRules.fatigueWordsOverride.length > 0
    ? bookRules.fatigueWordsOverride
    : gp.fatigueWords;

  if (fanficConfig?.notes.has(id)) {
    if (language === "en") {
      return fanficConfig.notes.get(id)!;
    }

    if (language === "ko") {
      return id in FANFIC_NOTES_KO
        ? `${FANFIC_NOTES_KO[id]} ${formatFanficSeverityNote(fanficConfig.severityOverrides.get(id) ?? "warning", language)}`
        : fanficConfig.notes.get(id)!
          ? `${fanficConfig.notes.get(id)!} ${formatFanficSeverityNote(fanficConfig.severityOverrides.get(id) ?? "warning", language)}`
          : "";
    }

    return fanficConfig.notes.get(id)!;
  }

  if (id === 1 && fanficMode === "ooc") {
    return language === "en"
      ? "In OOC mode, personality drift can be intentional; record only, do not fail. Evaluate against the character dossiers in fanfic_canon.md."
      : language === "ko"
        ? "OOC 모드에서는 성격 이탈이 의도적일 수 있으니 기록만 남기고 실패 처리하지 않습니다. fanfic_canon.md 캐릭터 아카이브를 기준으로 이탈 정도를 평가하세요."
        : "OOC模式下角色可偏离性格底色，此维度仅记录不判定失败。参照 fanfic_canon.md 角色档案评估偏离程度。";
  }

  if (id === 1 && fanficMode === "canon") {
    return language === "en"
      ? "Canon-faithful fanfic: characters must stay close to their original personality core. Evaluate against fanfic_canon.md character dossiers."
      : language === "ko"
        ? "원작 팬픽의 경우 캐릭터는 성격 핵심을 엄격히 지켜야 합니다. fanfic_canon.md 캐릭터 아카이브의 성격 핵심과 행동 패턴을 기반으로 평가하세요."
        : "原作向同人：角色必须严格遵守性格底色。参照 fanfic_canon.md 角色档案中的性格底色和行为模式。";
  }

  if (id === 10 && words.length > 0) {
    return language === "en"
      ? `Fatigue words: ${words.join(", ")}. Also check AI tell markers (仿佛/不禁/宛如/竟然/忽然/猛地); warn when any appears more than once per 3,000 words.`
      : language === "ko"
        ? `피로도 단어: ${words.join(", ")}. AI 추문표현(仿佛/不禁/宛如/竟然/忽然/猛地)도 함께 확인해 3000자당 1회 초과 시 경고하세요.`
        : `高疲劳词：${words.join("、")}。同时检查AI标记词（仿佛/不禁/宛如/竟然/忽然/猛地）密度，每3000字超过1次即warning`;
  }

  if (id === 15 && gp.satisfactionTypes.length > 0) {
    return language === "en"
      ? `Payoff types: ${gp.satisfactionTypes.join(", ")}`
      : language === "ko"
        ? `카타르시스 타입: ${gp.satisfactionTypes.join(", ")}`
        : `爽点类型：${gp.satisfactionTypes.join("、")}`;
  }

  if (id === 12 && bookRules?.eraConstraints) {
    const era = bookRules.eraConstraints;
    const parts = [era.period, era.region].filter(Boolean);
    if (parts.length > 0) {
      return language === "en"
        ? `Era: ${parts.join(", ")}`
        : language === "ko"
          ? `시대: ${parts.join(", ")}`
          : `年代：${parts.join("，")}`;
    }
  }

  switch (id) {
    case 8:
      return language === "en"
        ? "Audit as a diagnostic reader, not a rewriter: identify where the prose becomes hard to picture or parse on first read. Check whether key emotional, relational, and payoff beats are dramatized in scene instead of only being reported after the fact. Flag chapters where the narrator explains motives, stakes, or meaning that the scene already makes inferable. Also flag paragraphs that jump to isolated micro-detail or abstract verdict before the reader can picture the physical setup."
        : language === "ko"
          ? "리뷰어 시점으로 읽고, 독자가 한 번에 그림을 잡는지 확인하세요. 핵심 감정 변화, 관계 변화, 카타르시스 비트가 장면 안에서 드러나는지 보고, 행동·표정·대사·감각의 증거만으로도 감정과 의도가 읽히는지 살피세요. 공간과 형상이 먼저 세워지고 그 위에 세부 디테일과 판단이 놓이는지, 묘사가 핵심 대상에 집중되며 강약을 가지는지, 그리고 평문 연결 문장이 읽기 속도를 안정적으로 받치는지도 함께 점검하세요. 그는/그녀는 같은 3인칭 대명사 주어가 영어 번역투처럼 반복되는지, 감각 자체가 주어가 되는 도입문이 반복되는지, 비문처럼 걸리는 인식 문장이 감각 증거 없이 결론만 말하는지도 표시하세요."
          : "用诊断型读者视角审阅，指出哪些地方读者无法一遍看清、需要回读。检查关键情绪、关系变化和回收段落是否只是事后摘要；如果场景已经足够明显，就不要再让叙述者重复解释动机、风险或意义。同时标记那些在读者还没看清空间与轮廓前，就先跳到孤立细节或抽象判断的段落。";
    case 19:
      return language === "en"
        ? "Check whether POV shifts are signaled clearly and stay consistent with the configured viewpoint."
        : language === "ko"
          ? "시점 전환이 명확한 징표와 함께 이루어지고, 설정된 관점과 일치하는지 확인하세요."
          : "检查视角切换是否有过渡、是否与设定视角一致";
    case 16:
      return language === "en"
        ? "In multi-character scenes, check whether dialogue carries resistance, bargaining, concealment, or pressure rather than leaving the beat in narrated summary instead of direct pressure or exchange. When useful, the exchange should be broken with gesture, reaction, or setting detail instead of reading like disembodied lines."
        : language === "ko"
          ? "다인 장면에서는 대사가 저항, 협상, 은폐, 압박을 실제로 싣는지 확인하세요. 직접 공방이 장면 중심으로 살아 있고, 몸짓, 반응, 주변 디테일이 대사와 함께 배치되는지도 함께 점검하세요."
          : "多角色场景里，检查对话是否承载阻力、试探、隐瞒或施压，而不是被说明性摘要取代。必要时也检查对话有没有被动作、反应、环境细节打断，而不是像脱离场景的台词串。";
    case 17:
      return language === "en"
        ? "Flag chapters that compress important emotional, relational, or payoff beats into chronicle summary instead of scene. Also flag action beats whose trigger is missing, so characters kneel, reach, pause, or inspect before the reader knows what drew them there."
        : language === "ko"
          ? "중요한 감정 변화, 관계 이동, 카타르시스 비트가 장면으로 충분히 펼쳐지는지 점검하세요. 인물의 멈춤, 손짓, 시선, 접근 같은 행동도 그 행동을 부른 자극과 함께 읽히는지 확인하세요. 장면마다 강조해야 할 디테일과 빠르게 넘어갈 정보가 구분되어 읽기 속도가 유지되는지, 문단마다 핵심 디테일이 선명하게 남는지, 설명 문장이 전환과 압축의 역할을 분명하게 맡는지도 함께 보세요."
          : "检查重要情绪变化、关系推进或回收段落是否被压成流水账式摘要而没有真正落成场景。同时标记那些角色先停步、伸手、俯身、查看，但读者还不知道动作缘由的句段。";
    case 24:
      return language === "en"
        ? "Cross-check subplot_board and chapter_summaries: flag any subplot that stays dormant long enough to feel abandoned, or a recent run where every subplot is only restated instead of genuinely moving."
        : language === "ko"
          ? "subplot_board와 chapter_summaries를 대조해, 오래 묵혀져 방치된 서브플롯이나 최근 여러 회차 동안 실제 진전 없이 반복만 되는 서브플롯을 표시하세요."
          : "对照 subplot_board 和 chapter_summaries：标记那些沉寂到接近被遗忘的支线，或近期连续只被重复提及、没有真实推进的支线。";
    case 25:
      return language === "en"
        ? "Cross-check emotional_arcs and chapter_summaries: flag any major character whose emotional line holds one pressure shape across a run instead of taking new pressure, release, reversal, or reinterpretation. Distinguish unchanged circumstances from unchanged inner movement."
        : language === "ko"
          ? "emotional_arcs와 chapter_summaries를 대조해, 주요 인물이 여러 회차 동안 감정 곡선이 한 형태로 정지해 새 압박/해소/반전/재해석이 없는 상태를 표시하세요. 외형 상황 변화와 내면 변화의 정체를 구분하세요."
          : "对照 emotional_arcs 和 chapter_summaries：标记主要角色在一段时间内始终停留在同一种情绪压力形态、没有新压力、释放、转折或重估的情况。注意区分'处境未变'和'内心未变'。";
    case 26:
      return language === "en"
        ? "Cross-check chapter_summaries for chapter-type distribution: warn when the recent sequence stays in the same mode long enough to flatten rhythm, or when payoff / release beats disappear for too long. Explicitly list the recent type sequence."
        : language === "ko"
          ? "chapter_summaries에서 챕터 타입 분포를 점검해, 최근 회차가 같은 모드에 과도하게 머물러 리듬이 평평해지거나 회수/해소/클라이맥스 비트가 장기적으로 사라지면 경고하세요. 최근 타입 시퀀스를 명시적으로 나열하세요."
          : "对照 chapter_summaries 的章节类型分布：当近期章节长时间停留在同一种模式、把节奏压平，或回收/释放/高潮章节缺席过久时给出 warning。请明确列出最近章节的类型序列。";
    case 28:
      return language === "en"
        ? "Check whether spinoff events contradict the mainline canon constraints."
        : language === "ko"
          ? "스핀오프 사건이 본편 정전 제약과 충돌하지 않는지 확인하세요."
          : "检查番外事件是否与正典约束表矛盾";
    case 29:
      return language === "en"
        ? "Check whether characters reference information that should only be revealed after the divergence point (see the information-boundary table)."
        : language === "ko"
          ? "등장인물이 분기점 이후에만 공개되어야 할 정보를 참조하지 않았는지 확인하세요(정보 경계표 참고)."
          : "检查角色是否引用了分歧点之后才揭示的信息（参照信息边界表）";
    case 30:
      return language === "en"
        ? "Check whether the spinoff violates mainline world rules (power system, geography, factions)."
        : language === "ko"
          ? "스핀오프가 본편 세계 규칙(능력 체계, 지리, 진영)과 충돌하는지 점검하세요."
          : "检查番外是否违反正传世界规则（力量体系、地理、阵营）";
    case 31:
      return language === "en"
        ? "Check whether the spinoff resolves mainline hooks without authorization (warning level)."
        : language === "ko"
          ? "스핀오프가 권한 없이 본편 복선을 회수했는지(경고 레벨) 점검하세요."
          : "检查番外是否越权回收正传伏笔（warning级别）";
    case 32:
      return language === "en"
        ? "Check whether the ending renews curiosity, whether promised payoffs are landing on the cadence their hooks imply, whether pressure gets any release, and whether reader expectation gaps are accumulating faster than they are being satisfied."
        : language === "ko"
          ? "클로징이 독자 호기심을 다시 자극하는지, 약속한 카타르시스가 후크의 템포대로 회수되는지, 압박이 해소되는지, 독자 기대 간극이 누적되는지 확인하세요."
          : "检查：章尾是否重新点燃好奇心，已经承诺的回收是否按伏笔自身节奏落地，压力是否得到释放，读者期待缺口是在持续累积还是在被满足。";
    case 33:
      return language === "en"
        ? "Cross-check volume_outline: does this chapter match the planned beat for the current chapter range? Did it skip planned nodes or consume later nodes too early? Does actual pacing match the planned chapter span? If a beat planned for N chapters is consumed in 1-2 chapters -> critical."
        : language === "ko"
          ? "volume_outline를 대조해 이 챕터가 현재 분량 구간의 플롯 노드에 맞는지 확인하세요. 계획된 노드를 건너뛰었는지, 이후 노드를 앞서 소모했는지, 실제 리듬이 계획 구간과 맞는지 점검하세요. 계획이 N장 분량인데 1~2장으로 끝나면 critical 처리합니다."
          : "对照 volume_outline：本章内容是否对应卷纲中当前章节范围的剧情节点？是否跳过了节点或提前消耗了后续节点？剧情推进速度是否与卷纲规划的章节跨度匹配？如果卷纲规划某段剧情跨N章但实际1-2章就讲完→critical";
    case 34:
    case 35:
    case 36:
    case 37: {
      if (!fanficConfig) return "";
      const severity = fanficConfig.severityOverrides.get(id) ?? "warning";
      const baseNote = language === "en"
        ? FANFIC_NOTES_EN[id]
        : language === "ko"
          ? FANFIC_NOTES_KO[id]
          : FANFIC_DIMENSIONS.find((dimension) => dimension.id === id)?.baseNote;

      return baseNote
        ? `${baseNote} ${formatFanficSeverityNote(severity, language)}`
        : "";
    }
    default:
      return "";
  }
}

function buildDimensionList(
  gp: GenreProfile,
  bookRules: BookRules | null,
  language: PromptLanguage,
  hasParentCanon = false,
  fanficMode?: FanficMode,
): ReadonlyArray<{ readonly id: number; readonly name: string; readonly note: string }> {
  const activeIds = new Set(gp.auditDimensions);

  // Add book-level additional dimensions (supports both numeric IDs and name strings)
  if (bookRules?.additionalAuditDimensions) {
    // Build reverse lookup: name → id
    const nameToId = new Map<string, number>();
    for (const [id, labels] of Object.entries(DIMENSION_LABELS)) {
      nameToId.set(labels.ko, Number(id));
      nameToId.set(labels.zh, Number(id));
      nameToId.set(labels.en, Number(id));
    }

    for (const d of bookRules.additionalAuditDimensions) {
      if (typeof d === "number") {
        activeIds.add(d);
      } else if (typeof d === "string") {
        // Try exact match first, then substring match
        const exactId = nameToId.get(d);
        if (exactId !== undefined) {
          activeIds.add(exactId);
        } else {
          // Fuzzy: find dimension whose name contains the string
          for (const [name, id] of nameToId) {
            if (name.includes(d) || d.includes(name)) {
              activeIds.add(id);
              break;
            }
          }
        }
      }
    }
  }

  // Always-active dimensions
  activeIds.add(32); // 读者期待管理 — universal
  activeIds.add(33); // 大纲偏离检测 — universal

  // Conditional overrides
  if (gp.eraResearch || bookRules?.eraConstraints?.enabled) {
    activeIds.add(12);
  }

  // Spinoff dimensions — activated when parent_canon.md exists (but NOT in fanfic mode)
  if (hasParentCanon && !fanficMode) {
    activeIds.add(28); // 正传事件冲突
    activeIds.add(29); // 未来信息泄露
    activeIds.add(30); // 世界规则跨书一致性
    activeIds.add(31); // 番外伏笔隔离
  }

  // Fanfic dimensions — replace spinoff dims with fanfic-specific checks
  let fanficConfig: ReturnType<typeof getFanficDimensionConfig> | undefined;
  if (fanficMode) {
    fanficConfig = getFanficDimensionConfig(fanficMode, bookRules?.allowedDeviations);
    for (const id of fanficConfig.activeIds) {
      activeIds.add(id);
    }
    for (const id of fanficConfig.deactivatedIds) {
      activeIds.delete(id);
    }
  }

  const dims: Array<{ id: number; name: string; note: string }> = [];

  for (const id of [...activeIds].sort((a, b) => a - b)) {
    const name = dimensionName(id, language);
    if (!name) continue;

    const note = buildDimensionNote(id, language, gp, bookRules, fanficMode, fanficConfig);

    dims.push({ id, name, note });
  }

  return dims;
}

export class ContinuityAuditor extends BaseAgent {
  get name(): string {
    return "continuity-auditor";
  }

  async auditChapter(
    bookDir: string,
    chapterContent: string,
    chapterNumber: number,
    genre?: string,
    options?: {
      temperature?: number;
      chapterIntent?: string;
      contextPackage?: ContextPackage;
      ruleStack?: RuleStack;
      truthFileOverrides?: {
        currentState?: string;
        ledger?: string;
        hooks?: string;
      };
    },
  ): Promise<AuditResult> {
    const [diskCurrentState, diskLedger, diskHooks, styleGuideRaw, subplotBoard, emotionalArcs, characterMatrix, chapterSummaries, parentCanon, fanficCanon, volumeOutline] =
      await Promise.all([
        this.readFileSafe(join(bookDir, "story/current_state.md")),
        this.readFileSafe(join(bookDir, "story/particle_ledger.md")),
        this.readFileSafe(join(bookDir, "story/pending_hooks.md")),
        this.readFileSafe(join(bookDir, "story/style_guide.md")),
        this.readFileSafe(join(bookDir, "story/subplot_board.md")),
        this.readFileSafe(join(bookDir, "story/emotional_arcs.md")),
        this.readFileSafe(join(bookDir, "story/character_matrix.md")),
        this.readFileSafe(join(bookDir, "story/chapter_summaries.md")),
        this.readFileSafe(join(bookDir, "story/parent_canon.md")),
        this.readFileSafe(join(bookDir, "story/fanfic_canon.md")),
        this.readFileSafe(join(bookDir, "story/volume_outline.md")),
      ]);
    const currentState = options?.truthFileOverrides?.currentState ?? diskCurrentState;
    const ledger = options?.truthFileOverrides?.ledger ?? diskLedger;
    const hooks = options?.truthFileOverrides?.hooks ?? diskHooks;

    const hasParentCanon = parentCanon !== "(文件不存在)";
    const hasFanficCanon = fanficCanon !== "(文件不存在)";

    // Load last chapter full text for fine-grained continuity checking
    const previousChapter = await this.loadPreviousChapter(bookDir, chapterNumber);

    // Load genre profile and book rules
    const genreId = genre ?? "other";
    const [{ profile: gp }, bookLanguage] = await Promise.all([
      readGenreProfile(this.ctx.projectRoot, genreId),
      readBookLanguage(bookDir),
    ]);
    const parsedRules = await readBookRules(bookDir);
    const bookRules = parsedRules?.rules ?? null;

    // Fallback: use book_rules body when style_guide.md doesn't exist
    const styleGuide = styleGuideRaw !== "(文件不存在)"
      ? styleGuideRaw
      : (parsedRules?.body ?? "(无文风指南)");

    const resolvedLanguage = bookLanguage ?? gp.language;
    const isEnglish = resolvedLanguage === "en";
    const fanficMode = hasFanficCanon ? (bookRules?.fanficMode as FanficMode | undefined) : undefined;
    const dimensions = buildDimensionList(gp, bookRules, resolvedLanguage, hasParentCanon, fanficMode);
    const dimList = dimensions
      .map((d) => `${d.id}. ${d.name}${d.note ? formatDimensionNote(resolvedLanguage, d.note) : ""}`)
      .join("\n");
    const genreLabel = resolveGenreLabel(genreId, gp.name, resolvedLanguage);

    const protagonistBlock = bookRules?.protagonist
      ? isEnglish
        ? `\n\nProtagonist lock: ${bookRules.protagonist.name}; personality locks: ${joinLocalized(bookRules.protagonist.personalityLock, resolvedLanguage)}; behavioral constraints: ${joinLocalized(bookRules.protagonist.behavioralConstraints, resolvedLanguage)}.`
        : resolvedLanguage === "zh"
          ? `\n主角人设锁定：${bookRules.protagonist.name}，${bookRules.protagonist.personalityLock.join("、")}，行为约束：${bookRules.protagonist.behavioralConstraints.join("、")}`
          : `\n주인공 락: ${bookRules.protagonist.name}; 성격 락: ${joinLocalized(bookRules.protagonist.personalityLock, resolvedLanguage)}; 행위 제약: ${joinLocalized(bookRules.protagonist.behavioralConstraints, resolvedLanguage)}.`
      : "";

    const searchNote = gp.eraResearch
      ? isEnglish
        ? "\n\nYou have web-search capability (search_web / fetch_url). For real-world eras, people, events, geography, or policies, you must verify with search_web instead of relying on memory. Cross-check at least 2 sources."
        : resolvedLanguage === "zh"
          ? "\n\n你有联网搜索能力（search_web / fetch_url）。对于涉及真实年代、人物、事件、地理、政策的内容，你必须用search_web核实，不可凭记忆判断。至少对比2个来源交叉验证。"
          : "\n\n현실의 시대·인물·사건·지리·정책 관련 내용은 반드시 search_web로 검증하세요. 메모리에 의존해 판단하지 마십시오. 최소 2개 소스를 비교 검증해야 합니다."
      : "";

    const systemPrompt = isEnglish
      ? `You are a strict ${genreLabel} web fiction editor. Audit the chapter for continuity, consistency, and quality. ALL OUTPUT MUST BE IN ENGLISH.${protagonistBlock}${searchNote}

Audit dimensions:
${dimList}

Output format MUST be JSON:
{
  "passed": true/false,
  "issues": [
    {
      "severity": "critical|warning|info",
      "category": "dimension name",
      "description": "specific issue description",
      "suggestion": "fix suggestion"
    }
  ],
  "summary": "one-sentence audit conclusion"
}

passed is false ONLY when critical-severity issues exist.`
      : resolvedLanguage === "zh"
        ? `你是一位严格的${gp.name}网络小说审稿编辑。你的任务是对章节进行连续性、一致性和质量审查。${protagonistBlock}${searchNote}

审查维度：
${dimList}

输出格式必须为 JSON：
{
  "passed": true/false,
  "issues": [
    {
      "severity": "critical|warning|info",
      "category": "审查维度名称",
      "description": "具体问题描述",
      "suggestion": "修改建议"
    }
  ],
  "summary": "一句话总结审查结论"
}
\n\n只有当存在 critical 级别问题时，passed 才为 false。`
        : `당신은 ${genreLabel} 웹소설 원고를 검토하는 auditor agent입니다. 모바일 가독성, 문체 보존, 묘사 강약, 문장 연결 리듬의 균형을 기준으로, 리뷰어처럼 원고의 장점을 보존하면서 연속성, 일관성, 품질을 점검하세요. 모든 출력은 한국어로 작성하세요.${protagonistBlock}${searchNote}

검토 차원:
${dimList}

출력 형식은 반드시 JSON:
{
  "passed": true/false,
  "issues": [
    {
      "severity": "critical|warning|info",
      "category": "검토 항목명",
      "description": "독서 흐름이 흔들리는 지점, 묘사 밀도, 장면 초점, 문장 연결 리듬에 대한 근거를 담은 설명",
      "suggestion": "문장 분리, 압축, 재배치, 묘사 축소, 핵심 디테일 집중, 평문 연결 강화, 보존 우선 중 맞는 최소 수정 제안"
    }
  ],
  "summary": "한 줄 검토 결론"
}

critical 이슈가 있을 때만 passed가 false가 됩니다.`;

    const ledgerBlock = gp.numericalSystem
      ? resolvedLanguage === "en"
        ? `\n## Resource Ledger\n${ledger}`
        : resolvedLanguage === "zh"
          ? `\n## 资源账本\n${ledger}`
          : `\n## 자원 장부\n${ledger}`
      : "";

    // Smart context filtering for auditor — same logic as writer
    const bookRulesForFilter = parsedRules?.rules ?? null;
    const filteredSubplots = filterSubplots(subplotBoard);
    const filteredArcs = filterEmotionalArcs(emotionalArcs, chapterNumber);
    const filteredMatrix = filterCharacterMatrix(characterMatrix, volumeOutline, bookRulesForFilter?.protagonist?.name);
    const filteredSummaries = filterSummaries(chapterSummaries, chapterNumber);
    const filteredHooks = filterHooks(hooks);

    const governedMemoryBlocks = options?.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(options.contextPackage, resolvedLanguage)
      : undefined;

    const hooksBlock = governedMemoryBlocks?.hooksBlock
      ?? (filteredHooks !== "(文件不存在)"
        ? resolvedLanguage === "en"
          ? `\n## Pending Hooks\n${filteredHooks}\n`
          : resolvedLanguage === "zh"
            ? `\n## 伏笔池\n${filteredHooks}\n`
            : `\n## 복선 풀\n${filteredHooks}\n`
        : "");
    const subplotBlock = filteredSubplots !== "(文件不存在)"
      ? resolvedLanguage === "en"
        ? `\n## Subplot Board\n${filteredSubplots}\n`
        : resolvedLanguage === "zh"
          ? `\n## 支线进度板\n${filteredSubplots}\n`
          : `\n## 서브플롯 보드\n${filteredSubplots}\n`
      : "";
    const emotionalBlock = filteredArcs !== "(文件不存在)"
      ? resolvedLanguage === "en"
        ? `\n## Emotional Arcs\n${filteredArcs}\n`
        : resolvedLanguage === "zh"
          ? `\n## 情感弧线\n${filteredArcs}\n`
          : `\n## 감정선\n${filteredArcs}\n`
      : "";
    const matrixBlock = filteredMatrix !== "(文件不存在)"
      ? resolvedLanguage === "en"
        ? `\n## Character Interaction Matrix\n${filteredMatrix}\n`
        : resolvedLanguage === "zh"
          ? `\n## 角色交互矩阵\n${filteredMatrix}\n`
          : `\n## 캐릭터 상호작용 매트릭스\n${filteredMatrix}\n`
      : "";
    const summariesBlock = governedMemoryBlocks?.summariesBlock
      ?? (filteredSummaries !== "(文件不存在)"
        ? resolvedLanguage === "en"
          ? `\n## Chapter Summaries (for pacing checks)\n${filteredSummaries}\n`
          : resolvedLanguage === "zh"
            ? `\n## 章节摘要（用于节奏检查）\n${filteredSummaries}\n`
            : `\n## 챕터 요약 (리듬 검사용)\n${filteredSummaries}\n`
        : "");
    const volumeSummariesBlock = governedMemoryBlocks?.volumeSummariesBlock ?? "";

    const canonBlock = hasParentCanon
      ? resolvedLanguage === "en"
        ? `\n## Mainline Canon Reference (for spinoff audit)\n${parentCanon}\n`
        : resolvedLanguage === "zh"
          ? `\n## 正传正典参照（番外审查专用）\n${parentCanon}\n`
          : `\n## 메인 정전 참조(스핀오프 감사)\n${parentCanon}\n`
      : "";

    const fanficCanonBlock = hasFanficCanon
      ? resolvedLanguage === "en"
        ? `\n## Fanfic Canon Reference (for fanfic audit)\n${fanficCanon}\n`
        : resolvedLanguage === "zh"
          ? `\n## 同人正典参照（同人审查专用）\n${fanficCanon}\n`
          : `\n## 팬픽 정전 참조(팬픽 감사)\n${fanficCanon}\n`
      : "";

    const outlineBlock = volumeOutline !== "(文件不存在)"
      ? resolvedLanguage === "en"
        ? `\n## Volume Outline (for outline drift checks)\n${volumeOutline}\n`
        : resolvedLanguage === "zh"
          ? `\n## 卷纲（用于大纲偏离检测）\n${volumeOutline}\n`
          : `\n## 볼륨 아웃라인 (아웃라인 이탈 점검)\n${volumeOutline}\n`
      : "";
    const reducedControlBlock = options?.chapterIntent && options.contextPackage && options.ruleStack
      ? this.buildReducedControlBlock(options.chapterIntent, options.contextPackage, options.ruleStack, resolvedLanguage)
      : "";
    const styleGuideBlock = reducedControlBlock.length === 0
      ? resolvedLanguage === "en"
        ? `\n## Style Guide\n${styleGuide}`
        : resolvedLanguage === "zh"
          ? `\n## 文风指南\n${styleGuide}`
          : `\n## 문체 가이드\n${styleGuide}`
      : "";

    const prevChapterBlock = previousChapter
      ? resolvedLanguage === "en"
        ? `\n## Previous Chapter Full Text (for transition checks)\n${previousChapter}\n`
        : resolvedLanguage === "zh"
          ? `\n## 上一章全文（用于衔接检查）\n${previousChapter}\n`
          : `\n## 이전 챕터 원문 (전환 점검)\n${previousChapter}\n`
      : "";

    const userPrompt = resolvedLanguage === "en"
      ? `Review chapter ${chapterNumber}.

## Current State Card
${currentState}
${ledgerBlock}
${hooksBlock}${volumeSummariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${summariesBlock}${canonBlock}${fanficCanonBlock}${reducedControlBlock || outlineBlock}${prevChapterBlock}${styleGuideBlock}

## Chapter Content Under Review
${chapterContent}`
      : resolvedLanguage === "zh"
        ? `请审查第${chapterNumber}章。

## 当前状态卡
${currentState}
${ledgerBlock}
${hooksBlock}${volumeSummariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${summariesBlock}${canonBlock}${fanficCanonBlock}${reducedControlBlock || outlineBlock}${prevChapterBlock}${styleGuideBlock}

## 待审章节内容
${chapterContent}`
        : `제${chapterNumber}화를 리뷰하세요.

## 현재 상태 카드
${currentState}
${ledgerBlock}
${hooksBlock}${volumeSummariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${summariesBlock}${canonBlock}${fanficCanonBlock}${reducedControlBlock || outlineBlock}${prevChapterBlock}${styleGuideBlock}

## 검토 대상 챕터 내용
${chapterContent}`;

    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ];
    const chatOptions = { temperature: options?.temperature ?? 0.3, maxTokens: 8192 };

    // Use web search for fact verification when eraResearch is enabled
    const response = gp.eraResearch
      ? await this.chatWithSearch(chatMessages, chatOptions)
      : await this.chat(chatMessages, chatOptions);

    const result = this.parseAuditResult(response.content, resolvedLanguage);
    return { ...result, tokenUsage: response.usage };
  }

  private parseAuditResult(content: string, language: PromptLanguage): AuditResult {
    // Try multiple JSON extraction strategies (handles small/local models)

    // Strategy 1: Find balanced JSON object (not greedy)
    const balanced = this.extractBalancedJson(content);
    if (balanced) {
      const result = this.tryParseAuditJson(balanced, language);
      if (result) return result;
    }

    // Strategy 2: Try the whole content as JSON (some models output pure JSON)
    const trimmed = content.trim();
    if (trimmed.startsWith("{")) {
      const result = this.tryParseAuditJson(trimmed, language);
      if (result) return result;
    }

    // Strategy 3: Look for ```json code blocks
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      const result = this.tryParseAuditJson(codeBlockMatch[1]!.trim(), language);
      if (result) return result;
    }

    // Strategy 4: Try to extract individual fields via regex (last resort fallback)
    const passedMatch = content.match(/"passed"\s*:\s*(true|false)/);
    const issuesMatch = content.match(/"issues"\s*:\s*\[([\s\S]*?)\]/);
    const summaryMatch = content.match(/"summary"\s*:\s*"([^"]*)"/);
    if (passedMatch) {
      const issues: AuditIssue[] = [];
      if (issuesMatch) {
        // Try to parse individual issue objects
        const issuePattern = /\{[^{}]*"severity"\s*:\s*"[^"]*"[^{}]*\}/g;
        let match: RegExpExecArray | null;
        while ((match = issuePattern.exec(issuesMatch[1]!)) !== null) {
          try {
            const issue = JSON.parse(match[0]);
            issues.push({
              severity: issue.severity ?? "warning",
              category: issue.category ?? fallbackCategoryFor(language),
              description: issue.description ?? "",
              suggestion: issue.suggestion ?? "",
            });
          } catch {
            // skip malformed individual issue
          }
        }
      }
      return {
        passed: passedMatch[1] === "true",
        issues,
        summary: summaryMatch?.[1] ?? "",
      };
    }

    return {
      passed: false,
      issues: [{
        severity: "critical",
        category: systemErrorCategory(language),
        description: parseFailureDescription(language),
        suggestion: parseFailureSuggestion(language),
      }],
      summary: parseFailureSummary(language),
    };
  }

  private buildReducedControlBlock(
    chapterIntent: string,
    contextPackage: ContextPackage,
    ruleStack: RuleStack,
    language: PromptLanguage,
  ): string {
    const selectedContext = contextPackage.selectedContext
      .map((entry) => `- ${entry.source}: ${entry.reason}${entry.excerpt ? ` | ${entry.excerpt}` : ""}`)
      .join("\n");
    const overrides = ruleStack.activeOverrides.length > 0
      ? ruleStack.activeOverrides
        .map((override) => `- ${override.from} -> ${override.to}: ${override.reason} (${override.target})`)
        .join("\n")
      : language === "en"
        ? "- none"
        : language === "ko"
          ? "- 없음"
          : "- (无)";

    return language === "en"
      ? `\n## Chapter Control Inputs (compiled by Planner/Composer)
${chapterIntent}

### Selected Context
${selectedContext || "- none"}

### Rule Stack
- Hard guardrails: ${ruleStack.sections.hard.join(", ") || "(none)"}
- Soft constraints: ${ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic rules: ${ruleStack.sections.diagnostic.join(", ") || "(none)"}

### Active Overrides
${overrides}\n`
      : language === "ko"
        ? `\n## 본문 통제 입력 (Planner/Composer 작성)
${chapterIntent}

### 선택된 근거
${selectedContext || "- 없음"}

### 규칙 스택
- 하드 가드레일: ${ruleStack.sections.hard.join(", ") || "(없음)"}
- 소프트 제약: ${ruleStack.sections.soft.join(", ") || "(없음)"}
- 진단 규칙: ${ruleStack.sections.diagnostic.join(", ") || "(없음)"}

### 현재 적용 오버라이드
${overrides}\n`
      : `\n## 本章控制输入（由 Planner/Composer 编译）
${chapterIntent}

### 已选上下文
${selectedContext || "- none"}

### 规则栈
- 硬护栏：${ruleStack.sections.hard.join("、") || "(无)"}
- 软约束：${ruleStack.sections.soft.join("、") || "(无)"}
- 诊断规则：${ruleStack.sections.diagnostic.join("、") || "(无)"}

### 当前覆盖
${overrides}\n`;
  }

  private extractBalancedJson(text: string): string | null {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}") depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
    return null;
  }

  private tryParseAuditJson(json: string, language: PromptLanguage = "ko"): AuditResult | null {
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed.passed !== "boolean" && parsed.passed !== undefined) return null;
      return {
        passed: Boolean(parsed.passed ?? false),
        issues: Array.isArray(parsed.issues)
          ? parsed.issues.map((i: Record<string, unknown>) => ({
              severity: (i.severity as string) ?? "warning",
              category: (i.category as string) ?? fallbackCategoryFor(language),
              description: (i.description as string) ?? "",
              suggestion: (i.suggestion as string) ?? "",
            }))
          : [],
        summary: String(parsed.summary ?? ""),
      };
    } catch {
      return null;
    }
  }

  private async loadPreviousChapter(bookDir: string, currentChapter: number): Promise<string> {
    if (currentChapter <= 1) return "";
    const chaptersDir = join(bookDir, "chapters");
    try {
      const files = await readdir(chaptersDir);
      const paddedPrev = String(currentChapter - 1).padStart(4, "0");
      const prevFile = files.find((f) => f.startsWith(paddedPrev) && f.endsWith(".md"));
      if (!prevFile) return "";
      return await readFile(join(chaptersDir, prevFile), "utf-8");
    } catch {
      return "";
    }
  }

  private async readFileSafe(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件不存在)";
    }
  }
}
