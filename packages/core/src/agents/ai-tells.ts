import { detectWritingLanguageFromText, type WritingLanguage } from "../models/language.js";

/**
 * Structural AI-tell detection — pure rule-based analysis (no LLM).
 *
 * Detects patterns common in AI-generated Chinese text:
 * - dim 20: Paragraph length uniformity (low variance)
 * - dim 21: Filler/hedge word density
 * - dim 22: Formulaic transition patterns
 * - dim 23: List-like structure (consecutive same-prefix sentences)
 */

export interface AITellIssue {
  readonly severity: "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

export interface AITellResult {
  readonly issues: ReadonlyArray<AITellIssue>;
}

type AITellLanguage = WritingLanguage;

const HEDGE_WORDS: Record<AITellLanguage, ReadonlyArray<string>> = {
  ko: ["왠지", "어쩐지", "아마", "어쩌면", "마치", "왠만하면", "어떤 의미에서"],
  zh: ["似乎", "可能", "或许", "大概", "某种程度上", "一定程度上", "在某种意义上"],
  en: ["seems", "seemed", "perhaps", "maybe", "apparently", "in some ways", "to some extent"],
};

const TRANSITION_WORDS: Record<AITellLanguage, ReadonlyArray<string>> = {
  ko: ["하지만", "그러나", "한편", "동시에", "그럼에도", "그 와중에"],
  zh: ["然而", "不过", "与此同时", "另一方面", "尽管如此", "话虽如此", "但值得注意的是"],
  en: ["however", "meanwhile", "on the other hand", "nevertheless", "even so", "still"],
};

const EMOTION_LABEL_PATTERNS: Record<AITellLanguage, ReadonlyArray<RegExp>> = {
  ko: [/(?:분노|두려움|불안(?:함)?|슬픔|절망|안도)(?:을|를)?\s+(?:느꼈다|느끼고 있었다)/g],
  zh: [],
  en: [],
};

/**
 * Analyze text content for structural AI-tell patterns.
 * Returns issues that can be merged into audit results.
 */
export function analyzeAITells(content: string, language?: AITellLanguage): AITellResult {
  const resolvedLanguage = language ?? detectWritingLanguageFromText(content);
  const issues: AITellIssue[] = [];
  const isEnglish = resolvedLanguage === "en";
  const isKorean = resolvedLanguage === "ko";
  const joiner = isEnglish ? ", " : isKorean ? ", " : "、";

  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // dim 20: Paragraph length uniformity (needs ≥3 paragraphs)
  if (paragraphs.length >= 3) {
    const paragraphLengths = paragraphs.map((p) => p.length);
    const mean = paragraphLengths.reduce((a, b) => a + b, 0) / paragraphLengths.length;
    if (mean > 0) {
      const variance = paragraphLengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / paragraphLengths.length;
      const stdDev = Math.sqrt(variance);
      const cv = stdDev / mean;
      if (cv < 0.15) {
        issues.push({
          severity: "warning",
          category: isEnglish ? "Paragraph uniformity" : isKorean ? "문단 길이 획일화" : "段落等长",
          description: isEnglish
            ? `Paragraph-length coefficient of variation is only ${cv.toFixed(3)} (threshold <0.15), which suggests unnaturally uniform paragraph sizing`
            : isKorean
              ? `문단 길이 변동계수가 ${cv.toFixed(3)}로 매우 낮습니다(임계값 <0.15). 문단 길이가 지나치게 균일해 AI 생성 문체처럼 보일 수 있습니다`
            : `段落长度变异系数仅${cv.toFixed(3)}（阈值<0.15），段落长度过于均匀，呈现AI生成特征`,
          suggestion: isEnglish
            ? "Increase paragraph-length contrast: use shorter beats for impact and longer blocks for immersive detail"
            : isKorean
              ? "짧은 문단과 긴 문단의 대비를 키워 리듬을 벌리세요. 임팩트 장면은 짧게, 몰입 묘사는 길게 가져가는 편이 좋습니다"
            : "增加段落长度差异：短段落用于节奏加速或冲击，长段落用于沉浸描写",
        });
      }
    }
  }

  // dim 21: Hedge word density
  const totalChars = content.length;
  if (totalChars > 0) {
    let hedgeCount = 0;
    for (const word of HEDGE_WORDS[resolvedLanguage]) {
      const regex = new RegExp(word, isEnglish ? "gi" : "g");
      const matches = content.match(regex);
      hedgeCount += matches?.length ?? 0;
    }
    const hedgeDensity = hedgeCount / (totalChars / 1000);
    if (hedgeDensity > 3) {
      issues.push({
        severity: "warning",
        category: isEnglish ? "Hedge density" : isKorean ? "완곡어 밀도" : "套话密度",
        description: isEnglish
          ? `Hedge-word density is ${hedgeDensity.toFixed(1)} per 1k characters (threshold >3), making the prose sound overly tentative`
          : isKorean
            ? `완곡어 밀도가 1,000자당 ${hedgeDensity.toFixed(1)}회입니다(임계값 >3). 서술이 지나치게 머뭇거려 보일 수 있습니다`
          : `套话词（似乎/可能/或许等）密度为${hedgeDensity.toFixed(1)}次/千字（阈值>3），语气过于模糊犹豫`,
        suggestion: isEnglish
          ? "Replace hedges with firmer narration: remove vague qualifiers and use concrete detail instead"
          : isKorean
            ? "애매한 추측 표현을 줄이고, 모호한 서술 대신 구체적인 행동과 디테일로 상태를 드러내세요"
          : "用确定性叙述替代模糊表达：去掉「似乎」直接描述状态，用具体细节替代「可能」",
      });
    }
  }

  // dim 22: Formulaic transition repetition
  const transitionCounts: Record<string, number> = {};
  for (const word of TRANSITION_WORDS[resolvedLanguage]) {
    const regex = new RegExp(word, isEnglish ? "gi" : "g");
    const matches = content.match(regex);
    const count = matches?.length ?? 0;
    if (count > 0) {
      transitionCounts[isEnglish ? word.toLowerCase() : word] = count;
    }
  }
  const repeatedTransitions = Object.entries(transitionCounts)
    .filter(([, count]) => count >= 3);
  if (repeatedTransitions.length > 0) {
    const detail = repeatedTransitions
      .map(([word, count]) => `"${word}"×${count}`)
      .join(joiner);
    issues.push({
      severity: "warning",
      category: isEnglish ? "Formulaic transitions" : isKorean ? "공식화된 전환어" : "公式化转折",
      description: isEnglish
        ? `Transition words repeat too often: ${detail}. Reusing the same transition pattern 3+ times creates a formulaic AI texture`
        : isKorean
          ? `전환어가 과하게 반복됩니다: ${detail}. 같은 전환 패턴이 3회 이상 반복되면 기계적인 문체로 보이기 쉽습니다`
        : `转折词重复使用：${detail}。同一转折模式≥3次暴露AI生成痕迹`,
      suggestion: isEnglish
        ? "Let scenes pivot through action, timing, or viewpoint shifts instead of repeating the same transitions"
        : isKorean
          ? "전환어를 반복하기보다 행동, 시점 전환, 시간 점프 같은 장면 변화로 흐름을 넘기세요"
        : "用情节自然转折替代转折词，或换用不同的过渡手法（动作切入、时间跳跃、视角切换）",
    });
  }

  if (resolvedLanguage === "ko") {
    let directEmotionLabels = 0;
    for (const pattern of EMOTION_LABEL_PATTERNS.ko) {
      const matches = content.match(pattern);
      directEmotionLabels += matches?.length ?? 0;
    }
    if (directEmotionLabels >= 3) {
      issues.push({
        severity: "warning",
        category: "감정 직설",
        description: "감정 이름을 직접 붙이는 문장이 짧은 구간에 반복됩니다.",
        suggestion: "감정 이름을 줄이고 몸의 반응, 멈칫함, 말투, 시선 변화 같은 장면 증거로 바꾸세요.",
      });
    }
  }

  // dim 23: List-like structure (consecutive sentences with same prefix pattern)
  const sentences = content
    .split(isEnglish ? /[.!?\n]/ : /[。！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

  if (sentences.length >= 3) {
    let consecutiveSamePrefix = 1;
    let maxConsecutive = 1;
    for (let i = 1; i < sentences.length; i++) {
      const prevPrefix = isEnglish
        ? sentences[i - 1]!.split(/\s+/)[0]?.toLowerCase() ?? ""
        : sentences[i - 1]!.slice(0, 2);
      const currPrefix = isEnglish
        ? sentences[i]!.split(/\s+/)[0]?.toLowerCase() ?? ""
        : sentences[i]!.slice(0, 2);
      if (prevPrefix === currPrefix) {
        consecutiveSamePrefix++;
        maxConsecutive = Math.max(maxConsecutive, consecutiveSamePrefix);
      } else {
        consecutiveSamePrefix = 1;
      }
    }
    if (maxConsecutive >= 3) {
        issues.push({
          severity: "info",
          category: isEnglish ? "List-like structure" : isKorean ? "목록형 문장 구조" : "列表式结构",
          description: isEnglish
            ? `Detected ${maxConsecutive} consecutive sentences with the same opening pattern, creating a list-like generated cadence`
            : isKorean
              ? `같은 시작 패턴으로 출발하는 문장이 ${maxConsecutive}개 연속 감지됐습니다. 열거형 AI 문장 리듬처럼 보일 수 있습니다`
            : `检测到${maxConsecutive}句连续以相同开头的句子，呈现列表式AI生成结构`,
          suggestion: isEnglish
            ? "Vary how sentences open: change subject, timing, or action entry to break the list effect"
            : isKorean
              ? "문장 첫머리를 다양하게 바꾸세요. 주어, 시간어, 행동 진입점을 바꿔 목록형 리듬을 끊는 편이 좋습니다"
            : "变换句式开头：用不同主语、时间词、动作词开头，打破列表感",
        });
    }
  }

  return { issues };
}
