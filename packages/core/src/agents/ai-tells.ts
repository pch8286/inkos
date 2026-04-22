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

const KOREAN_ADVERB_PATTERN =
  /(?:갑자기|문득|천천히|빠르게|조용히|조심스럽게|분명히|확실히|완전히|바로|크게|작게|심하게|가볍게|무겁게|강하게|약하게|몹시|매우|아주|너무|정말|굉장히|무척)/g;

const KOREAN_RETROSPECTIVE_CLOSING_PATTERN =
  /(?:그리고\s*)?(?:나는|우리는|그는|그녀는|이제)\s*(?:방금|마침내|드디어)?[\s,]*(?:[^.!?\n]{0,18})?(?:이름으로|첫\s*수|첫걸음|막을\s*올렸|시작(?:했|이었다)|판(?:을)?\s*움직였|수를\s*두었|수\s*를\s*두었)/;
const KOREAN_STOCK_SENSORY_METAPHOR_PATTERNS = [
  /쇠\s*긁는\s*(?:소리|울림)/,
  /금속성\s*(?:소리|울림|마찰음)/,
  /공기가\s*(?:얼어붙|굳어지|무거워지|가라앉)/,
  /칼날\s*같은\s*(?:시선|눈빛|목소리|말투)/,
  /등골(?:이)?\s*서늘/,
  /짐승\s*같은\s*(?:웃음|울음|소리|숨소리)/,
];
const KOREAN_PROP_MEANING_EXPOSITION_PATTERNS = [
  /(?:훈련장|협회|군용|보급|지급)\s*(?:지급품|보급품|장비)(?:이었|였)다/,
  /(?:베기보다|싸우기보다|죽이기보다|막기보다)[^.!?。！？\n]{0,60}(?:보이게|느끼게|만드는)\s*(?:물건|도구|장비|장치)/,
  /(?:헌터|기사|군인|마법사|영웅)처럼\s*보이게\s*만드는\s*(?:물건|도구|장비|장치)/,
];

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

  const narrativeParagraphs = paragraphs.filter((p) => !/^[“"'「『].+[”"'」』]$/.test(p));
  const shortThreshold = isEnglish ? 45 : isKorean ? 35 : 25;
  const shortParagraphs = narrativeParagraphs.filter((p) => p.length < shortThreshold);
  if (
    paragraphs.length >= 6
    && shortParagraphs.length >= 4
    && shortParagraphs.length / Math.max(1, narrativeParagraphs.length) >= 0.6
  ) {
    issues.push({
      severity: "warning",
      category: isEnglish ? "Paragraph fragmentation" : isKorean ? "문단 과분할" : "段落过碎",
      description: isEnglish
        ? `${shortParagraphs.length} of ${paragraphs.length} paragraphs are very short, creating a one-beat-per-paragraph cadence.`
        : isKorean
          ? `${paragraphs.length}개 문단 중 ${shortParagraphs.length}개가 ${shortThreshold}자 미만이라 한 비트마다 줄을 끊는 리듬으로 보입니다.`
          : `${paragraphs.length}个段落里有${shortParagraphs.length}个过短，形成一句一段的机械节奏。`,
      suggestion: isEnglish
        ? "Reserve short paragraphs for impact beats; merge adjacent action-observation-reaction beats into fuller paragraphs."
        : isKorean
          ? "짧은 문단은 결정타와 전환에 남기고, 인접한 행동-관찰-반응은 한 문단으로 묶어 리듬을 회복하세요."
          : "短段落留给重击和转折；相邻的动作-观察-反应合并成更完整的段落。",
    });
  }

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
        suggestion: "감정 이름을 줄이고 손이 멈추는지, 말끝이 흐려지는지, 시선이 피하는지 같은 장면 증거로 바꾸세요.",
      });
    }

    const koreanLines = content
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const sceneNoteFragments = koreanLines.filter((line) => {
      const normalized = line.replace(/[.!?。！？]/g, "").trim();
      return /^(몸|장소|주변\s*반응|적대\s*여부|상태|목표|갈등|정보)$/.test(normalized);
    });
    if (new Set(sceneNoteFragments).size >= 3) {
      issues.push({
        severity: "warning",
        category: "메모식 장면 체크리스트",
        description: `작법 메모처럼 보이는 짧은 명사 파편이 본문에 섞였습니다: ${sceneNoteFragments.slice(0, 4).join(" / ")}`,
        suggestion: "작법 메모처럼 나누지 말고 손이 닿는 표면, 눈앞 구조, 상대가 물러서거나 무기를 잡는 행동처럼 장면 안 사건으로 흡수하세요.",
      });
    }

    const koreanAdverbs = [...content.matchAll(KOREAN_ADVERB_PATTERN)].map((match) => match[0]);
    const uniqueAdverbs = [...new Set(koreanAdverbs)];
    const adverbDensity = koreanAdverbs.length / Math.max(1, content.length / 1000);
    if (koreanAdverbs.length >= 6 || (koreanAdverbs.length >= 4 && adverbDensity >= 8)) {
      issues.push({
        severity: "warning",
        category: "부사 과밀",
        description: `부사가 짧은 구간에 몰려 동사와 장면 비트가 약해 보입니다: ${uniqueAdverbs.slice(0, 8).join(", ")}`,
        suggestion: "부사를 먼저 지우고, 걷다/비틀거리다/멈춰 서다처럼 동사를 바꾸거나 행동 결과로 속도와 감정을 보여 주세요.",
      });
    }

    const closingSentences = content
      .split(/[.!?。！？\n]/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0)
      .slice(-4);
    const retrospectiveClosing = closingSentences.find((sentence) =>
      KOREAN_RETROSPECTIVE_CLOSING_PATTERN.test(sentence)
    );
    if (retrospectiveClosing) {
      issues.push({
        severity: "warning",
        category: "선언형 클로징",
        description: `회차 끝이 장면 결과보다 회고형 선언이나 판세 비유로 닫힙니다: ${retrospectiveClosing}`,
        suggestion: "마지막 행동, 되돌릴 수 없는 결과, 상대가 보인 즉각 반응 중 하나로 닫아 다음 화의 압력을 장면 안에 남기세요.",
      });
    }

    const koreanSentences = content
      .split(/[.!?。！？\n]/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);
    const stockSensoryMetaphor = koreanSentences.find((sentence) =>
      KOREAN_STOCK_SENSORY_METAPHOR_PATTERNS.some((pattern) => pattern.test(sentence))
    );
    if (stockSensoryMetaphor) {
      issues.push({
        severity: "warning",
        category: "AI식 감각 비유",
        description: `장면 안 원인 없이 떠 있는 상투적 감각 비유처럼 보입니다: ${stockSensoryMetaphor}`,
        suggestion: "비유를 더 예쁘게 바꾸지 말고, 장면 안 원인, 물리적 변화, 시점 인물의 반응 순서로 감각을 다시 고정하세요.",
      });
    }

    const propMeaningExposition = koreanSentences.find((sentence) =>
      KOREAN_PROP_MEANING_EXPOSITION_PATTERNS.some((pattern) => pattern.test(sentence))
    );
    if (propMeaningExposition) {
      issues.push({
        severity: "warning",
        category: "소품 의미 해설",
        description: `소품의 설정이나 의미를 장면 밖에서 바로 해설하는 문장처럼 보입니다: ${propMeaningExposition}`,
        suggestion: "소품의 의미를 설명하지 말고 사용 방식, 실패, 손에 익은 정도, 상대 반응으로 독자가 기능과 위상을 추론하게 하세요.",
      });
    }

    const abstractTriadLines = koreanLines.filter((line) => {
      const normalized = line.replace(/[.!?。！？]/g, "");
      const parts = normalized.split(/[，,]/).map((part) => part.trim()).filter(Boolean);
      if (parts.length !== 3) return false;
      const optionTriad = parts.every((part) => /^[가-힣]{1,10}거나$/.test(part));
      const terseNounTriad = parts.every((part) => /^[가-힣]{1,4}$/.test(part));
      return optionTriad || terseNounTriad;
    });
    const resolvesTriadAsPrinciple = /그\s*세\s*가지|세\s*가지가|세\s*가지로/.test(content);
    if (abstractTriadLines.length >= 2 || (abstractTriadLines.length >= 1 && resolvesTriadAsPrinciple)) {
      issues.push({
        severity: "warning",
        category: "추상 삼단 리듬",
        description: `짧은 추상어 또는 선택지 3개를 독립 리듬으로 세우는 문단이 감지됐습니다: ${abstractTriadLines.slice(0, 2).join(" / ")}`,
        suggestion: "세 요소를 따로 선언하지 말고 인물의 행동, 상대가 받아치는 움직임, 그 결과 생긴 선택 안에 묻어 두세요.",
      });
    }

    const negativeAbstractions = koreanSentences.filter((sentence) =>
      /(?:은|는|이|가|그건|그것은|이건|이것은)\s*(?:그냥\s*)?[가-힣\s]{1,18}(?:이|가)?\s*아니(?:다|었다)/.test(sentence)
      || /아니라\s*[가-힣\s]{1,18}(?:이었)?다/.test(sentence)
    );
    if (negativeAbstractions.length >= 2) {
      issues.push({
        severity: "warning",
        category: "부정 병렬 추상화",
        description: `부정형 판정문이 짧은 구간에 반복됩니다: ${negativeAbstractions.slice(0, 2).join(" / ")}`,
        suggestion: "아니라고 선언하기보다 눈에 보이는 차이, 실패한 행동, 타인의 반응으로 무엇이 달라졌는지 먼저 보여 주세요.",
      });
    }
  }

  // dim 23: List-like structure (consecutive sentences with same prefix pattern)
  const sentences = content
    .split(isEnglish || isKorean ? /[.!?。！？\n]/ : /[。！？\n]/)
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
