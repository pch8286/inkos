/**
 * Post-write rule-based validator.
 *
 * Deterministic, zero-LLM-cost checks that run after every chapter generation.
 * Catches violations that prompt-only rules cannot guarantee.
 */

import { analyzeChapterCadence } from "../utils/chapter-cadence.js";
import type { BookRules } from "../models/book-rules.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { WritingLanguage } from "../models/language.js";

export interface PostWriteViolation {
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly description: string;
  readonly suggestion: string;
}

interface ParagraphShape {
  readonly paragraphs: ReadonlyArray<string>;
  readonly shortThreshold: number;
  readonly shortParagraphs: ReadonlyArray<string>;
  readonly shortRatio: number;
  readonly averageLength: number;
  readonly maxConsecutiveShort: number;
}

// --- Marker word lists ---

/** AI转折/惊讶标记词 */
const SURPRISE_MARKERS = ["仿佛", "忽然", "竟然", "猛地", "猛然", "不禁", "宛如"];

/** 元叙事/编剧旁白模式 */
const META_NARRATION_PATTERNS = [
  /到这里[，,]?算是/,
  /接下来[，,]?(?:就是|将会|即将)/,
  /(?:后面|之后)[，,]?(?:会|将|还会)/,
  /(?:故事|剧情)(?:发展)?到了/,
  /读者[，,]?(?:可能|应该|也许)/,
  /我们[，,]?(?:可以|不妨|来看)/,
];

/** 分析报告式术语（禁止出现在正文中） */
const REPORT_TERMS = [
  "核心动机", "信息边界", "信息落差", "核心风险", "利益最大化",
  "当前处境", "行为约束", "性格过滤", "情绪外化", "锚定效应",
  "沉没成本", "认知共鸣",
];

/** 作者说教词 */
const SERMON_WORDS = ["显然", "毋庸置疑", "不言而喻", "众所周知", "不难看出"];

/** 全场震惊类集体反应 */
const COLLECTIVE_SHOCK_PATTERNS = [
  /(?:全场|众人|所有人|在场的人)[，,]?(?:都|全|齐齐|纷纷)?(?:震惊|惊呆|倒吸凉气|目瞪口呆|哗然|惊呼)/,
  /(?:全场|一片)[，,]?(?:寂静|哗然|沸腾|震动)/,
];

const KOREAN_DIRECT_EXCHANGE_VERBS = ["말", "묻", "답", "웃", "소리", "속삭", "쏘아붙", "내뱉"];
const KOREAN_DEPENDENT_CLAUSE_MARKERS = /(?:면서|며|다가|지만|는데|더니|고서|자마자|자|고)/g;
const KOREAN_VISUAL_LOAD_MARKERS = /(?:과|와|및|그리고)/g;
const KOREAN_THIRD_PERSON_SUBJECT_PATTERN = /(?:^|[\n.!?。！？,，]\s*)(그는|그가|그녀는|그녀가|자신은|자신이)(?=\s|[,，])/g;
const KOREAN_SENSORY_SUBJECT_OPENING_PATTERN = /(?:[가-힣]{1,8}\s+)?(?:냄새|악취|향|쇠맛|맛|소리|울림|감촉|냉기|한기|열기|빛|어둠|시야|천장|바닥|공기)(?:이|가|은|는)?\s*(?:먼저\s*)?(?:들어왔|밀려왔|느껴졌|들렸|보였|눈에\s+들어왔)/;
const KOREAN_SENSORY_CLICHE_OPENING_PATTERN = /(?:[가-힣]{1,8}\s+)?(?:냄새|악취|향|쇠맛|맛|소리|울림|감촉|냉기|한기|열기|빛|어둠|시야|천장|바닥|공기)(?:이|가|은|는)?\s*먼저\s*(?:들어왔|밀려왔|느껴졌|들렸|보였|눈에\s+들어왔)/;
const KOREAN_INVERTED_SENSORY_CLICHE_OPENING_PATTERN = /(?:먼저|처음)\s*(?:들어온|밀려온|느껴진|들린|보인)\s*(?:건|것은|것이)\s*[^.!?。！？\n]{0,50}(?:냄새|악취|향|쇠맛|맛|소리|울림|감촉|냉기|한기|열기|빛|어둠|시야|천장|바닥|공기|통증)/;
const KOREAN_STOCK_SENSORY_METAPHOR_PATTERNS = [
  /쇠\s*긁는\s*(?:소리|울림)/,
  /금속성\s*(?:소리|울림|마찰음)/,
  /공기가\s*(?:얼어붙|굳어지|무거워지|가라앉)/,
  /칼날\s*같은\s*(?:시선|눈빛|목소리|말투)/,
  /등골(?:이)?\s*서늘/,
  /짐승\s*같은\s*(?:웃음|울음|소리|숨소리)/,
];
const CHINESE_DEPENDENT_CLAUSE_MARKERS = /(?:然后|接着|随后|同时|而且|并且|却|才|再|又)/g;
const ENGLISH_DEPENDENT_CLAUSE_MARKERS = /\b(?:as|while|when|after|before|because|although|though|which|that)\b/gi;

// --- Validator ---

export function validatePostWrite(
  content: string,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
  languageOverride?: WritingLanguage,
): ReadonlyArray<PostWriteViolation> {
  const violations: PostWriteViolation[] = [];
  const resolvedLanguage = languageOverride ?? genreProfile.language;

  // Skip Chinese-specific rules for English content
  const isEnglish = resolvedLanguage === "en";
  if (isEnglish) {
    // For English, only run book-specific prohibitions and paragraph length check
    return validatePostWriteEnglish(content, genreProfile, bookRules);
  }

  // 1. 硬性禁令: "不是…而是…" 句式
  if (/不是[^，。！？\n]{0,30}[，,]?\s*而是/.test(content)) {
    violations.push({
      rule: "禁止句式",
      severity: "error",
      description: "出现了「不是……而是……」句式",
      suggestion: "改用直述句",
    });
  }

  // 2. 硬性禁令: 破折号
  if (content.includes("——")) {
    violations.push({
      rule: "禁止破折号",
      severity: "error",
      description: "出现了破折号「——」",
      suggestion: "用逗号或句号断句",
    });
  }

  // 3. 转折/惊讶标记词密度 ≤ 1次/3000字
  const markerCounts: Record<string, number> = {};
  let totalMarkerCount = 0;
  for (const word of SURPRISE_MARKERS) {
    const matches = content.match(new RegExp(word, "g"));
    const count = matches?.length ?? 0;
    if (count > 0) {
      markerCounts[word] = count;
      totalMarkerCount += count;
    }
  }
  const markerLimit = Math.max(1, Math.floor(content.length / 3000));
  if (totalMarkerCount > markerLimit) {
    const detail = Object.entries(markerCounts)
      .map(([w, c]) => `"${w}"×${c}`)
      .join("、");
    violations.push({
      rule: "转折词密度",
      severity: "warning",
      description: `转折/惊讶标记词共${totalMarkerCount}次（上限${markerLimit}次/${content.length}字），明细：${detail}`,
      suggestion: "改用具体动作或感官描写传递突然性",
    });
  }

  // 4. 高疲劳词检查（从 genreProfile 读取，单章每词 ≤ 1次）
  const fatigueWords = bookRules?.fatigueWordsOverride && bookRules.fatigueWordsOverride.length > 0
    ? bookRules.fatigueWordsOverride
    : genreProfile.fatigueWords;
  for (const word of fatigueWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = content.match(new RegExp(escaped, "g"));
    const count = matches?.length ?? 0;
    if (count > 1) {
      violations.push({
        rule: "高疲劳词",
        severity: "warning",
        description: `高疲劳词"${word}"出现${count}次（上限1次/章）`,
        suggestion: `替换多余的"${word}"为同义但不同形式的表达`,
      });
    }
  }

  // 5. 元叙事检查（编剧旁白）
  for (const pattern of META_NARRATION_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      violations.push({
        rule: "元叙事",
        severity: "warning",
        description: `出现编剧旁白式表述："${match[0]}"`,
        suggestion: "删除元叙事，让剧情自然展开",
      });
      break; // 报一次即可
    }
  }

  // 6. 分析报告式术语
  const foundTerms: string[] = [];
  for (const term of REPORT_TERMS) {
    if (content.includes(term)) {
      foundTerms.push(term);
    }
  }
  if (foundTerms.length > 0) {
    violations.push({
      rule: "报告术语",
      severity: "error",
      description: `正文中出现分析报告术语：${foundTerms.map(t => `"${t}"`).join("、")}`,
      suggestion: "这些术语只能用于 PRE_WRITE_CHECK 内部推理，正文中用口语化表达替代",
    });
  }

  // 7. 正文中的章节号指称（如"第33章"、"chapter 33"）
  const chapterRefPattern = /(?:第\s*\d+\s*章|[Cc]hapter\s+\d+)/g;
  const chapterRefs = content.match(chapterRefPattern);
  if (chapterRefs && chapterRefs.length > 0) {
    const unique = [...new Set(chapterRefs)];
    violations.push({
      rule: isEnglish ? "chapter-number-reference" : "章节号指称",
      severity: "error",
      description: isEnglish
        ? `Chapter text contains explicit chapter number references: ${unique.map(r => `"${r}"`).join(", ")}. Characters do not know they are in a numbered chapter.`
        : `正文中出现了章节号指称：${unique.map(r => `"${r}"`).join("、")}。角色不知道自己在第几章。`,
      suggestion: isEnglish
        ? "Replace with natural references: 'that night', 'when the warehouse burned', 'the incident at the dock'"
        : '改成自然表达："那天晚上"、"仓库出事那次"、"码头上的事"',
    });
  }

  // 8. 作者说教词
  const foundSermons: string[] = [];
  for (const word of SERMON_WORDS) {
    if (content.includes(word)) {
      foundSermons.push(word);
    }
  }
  if (foundSermons.length > 0) {
    violations.push({
      rule: "作者说教",
      severity: "warning",
      description: `出现说教词：${foundSermons.map(w => `"${w}"`).join("、")}`,
      suggestion: "删除说教词，让读者自己从情节中判断",
    });
  }

  // 8. 全场震惊类集体反应
  for (const pattern of COLLECTIVE_SHOCK_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      violations.push({
        rule: "集体反应",
        severity: "warning",
        description: `出现集体反应套话："${match[0]}"`,
        suggestion: "改写成1-2个具体角色的身体反应",
      });
      break;
    }
  }

  // 9. 连续"了"字检查（3句以上连续含"了"）
  const sentences = content
    .split(/[。！？]/)
    .map(s => s.trim())
    .filter(s => s.length > 2);

  let consecutiveLe = 0;
  let maxConsecutiveLe = 0;
  for (const sentence of sentences) {
    if (sentence.includes("了")) {
      consecutiveLe++;
      maxConsecutiveLe = Math.max(maxConsecutiveLe, consecutiveLe);
    } else {
      consecutiveLe = 0;
    }
  }
  if (maxConsecutiveLe >= 6) {
    violations.push({
      rule: "连续了字",
      severity: "warning",
      description: `检测到${maxConsecutiveLe}句连续包含"了"字，节奏拖沓`,
      suggestion: "保留最有力的一个「了」，其余改为无「了」句式",
    });
  }

  // 10. 段落长度检查（手机阅读适配：50-250字/段为宜）
  const paragraphs = content
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const longParagraphs = paragraphs.filter(p => p.length > 300);
  if (longParagraphs.length >= 2) {
    violations.push({
      rule: "段落过长",
      severity: "warning",
      description: `${longParagraphs.length}个段落超过300字，不适合手机阅读`,
      suggestion: "长段落拆分为3-5行的短段落，在动作切换或情绪节点处断开",
    });
  }

  violations.push(...detectParagraphShapeWarnings(content, resolvedLanguage));
  violations.push(...detectMobileReadabilityWarnings(content, resolvedLanguage));
  violations.push(...detectKoreanStylePatternWarnings(content, resolvedLanguage));

  const dialoguePressureViolation = detectDialoguePressureWarning(content, resolvedLanguage);
  if (dialoguePressureViolation) {
    violations.push(dialoguePressureViolation);
  }

  // 11. Book-level prohibitions
  // Short prohibitions (2-30 chars): exact substring match
  // Long prohibitions (>30 chars): skip — these are conceptual rules for prompt-level enforcement only
  if (bookRules?.prohibitions) {
    for (const prohibition of bookRules.prohibitions) {
      if (prohibition.length >= 2 && prohibition.length <= 30 && content.includes(prohibition)) {
        violations.push({
          rule: "本书禁忌",
          severity: "error",
          description: `出现了本书禁忌内容："${prohibition}"`,
          suggestion: "删除或改写该内容",
        });
      }
    }
  }

  return violations;
}

function detectKoreanStylePatternWarnings(
  content: string,
  language: WritingLanguage,
): ReadonlyArray<PostWriteViolation> {
  if (language !== "ko") return [];

  const violations: PostWriteViolation[] = [];
  const thirdPersonSubjects = [...content.matchAll(KOREAN_THIRD_PERSON_SUBJECT_PATTERN)].map((match) => match[1] ?? "");
  const uniqueThirdPersonSubjects = [...new Set(thirdPersonSubjects)];
  const openingThirdPersonSubjects = [
    ...extractNarrativeSentences(content).slice(0, 8).join(". ").matchAll(KOREAN_THIRD_PERSON_SUBJECT_PATTERN),
  ].map((match) => match[1] ?? "");
  if (thirdPersonSubjects.length >= 3 || openingThirdPersonSubjects.length >= 2 || (thirdPersonSubjects.length >= 2 && content.length <= 1500)) {
    violations.push({
      rule: "대명사 주어 반복",
      severity: "warning",
      description: `3인칭 대명사 주어가 ${thirdPersonSubjects.length}회 반복되어 영어 번역투처럼 보일 수 있습니다: ${uniqueThirdPersonSubjects.join(", ")}`,
      suggestion: "주인공 이름이나 직함이 있으면 다시 고정하고, 없으면 주어를 생략한 행동문, 손끝이나 시선의 변화, 직접 판단문으로 분산하세요.",
    });
  }

  const openingSentences = extractNarrativeSentences(content).slice(0, 5);
  const sensoryClicheOpening = openingSentences.slice(0, 3).find((sentence) =>
    KOREAN_SENSORY_CLICHE_OPENING_PATTERN.test(sentence)
    || KOREAN_INVERTED_SENSORY_CLICHE_OPENING_PATTERN.test(sentence)
  );
  if (sensoryClicheOpening) {
    violations.push({
      rule: "감각 도입 클리셰",
      severity: "warning",
      description: `첫머리가 감각 자체를 주어로 세우는 익숙한 패턴입니다: "${summarizeSentenceSample(sensoryClicheOpening)}"`,
      suggestion: "시점 인물의 자세, 공간의 큰 윤곽, 감각을 일으킨 원인을 먼저 세우고 감각은 다음 행동 비트에 붙이세요.",
    });
  }

  const sensoryOpenings = openingSentences.filter((sentence) => KOREAN_SENSORY_SUBJECT_OPENING_PATTERN.test(sentence));
  if (sensoryOpenings.length >= 2 && !sensoryClicheOpening) {
    violations.push({
      rule: "감각 스타팅 반복",
      severity: "warning",
      description: `도입부에서 감각 자체를 주어로 세우는 문장이 반복됩니다: "${summarizeSentenceSample(sensoryOpenings.join(" / "))}"`,
      suggestion: "시점 인물의 자세, 닿은 면, 눈에 보이는 원인을 먼저 세우고 감각은 그 뒤에 붙이세요.",
    });
  }

  const stockSensoryMetaphor = extractNarrativeSentences(content).find((sentence) =>
    KOREAN_STOCK_SENSORY_METAPHOR_PATTERNS.some((pattern) => pattern.test(sentence))
  );
  if (stockSensoryMetaphor) {
    violations.push({
      rule: "상투적 감각 비유",
      severity: "warning",
      description: `장면 안 원인 없이 떠 있는 상투적 감각 비유처럼 보입니다: "${summarizeSentenceSample(stockSensoryMetaphor)}"`,
      suggestion: "비유를 더 예쁘게 바꾸지 말고, 장면 안 원인, 물리적 변화, 시점 인물의 반응 순서로 감각을 다시 고정하세요.",
    });
  }

  return violations;
}

function detectDialoguePressureWarning(
  content: string,
  language: WritingLanguage,
): PostWriteViolation | undefined {
  if (language === "en") {
    return undefined;
  }

  if (language !== "ko") {
    return undefined;
  }

  const dialogueMarkers = content.match(/[“"'「『][^”"'」』]+[”"'」』]/g) ?? [];
  const KoreanNameLikeTokens = [...new Set(
    (content.match(/[가-힣]{2,4}/g) ?? [])
      .filter((token) => !KOREAN_DIRECT_EXCHANGE_VERBS.some((needle) => token.includes(needle))),
  )];

  if (KoreanNameLikeTokens.length >= 2 && dialogueMarkers.length < 2 && content.length >= 60) {
    return {
      rule: "대사 압력",
      severity: "warning",
      description: "다인 장면이 직접 공방 없이 설명 위주로 지나갑니다.",
      suggestion: "짧은 대사 한두 번이라도 넣어 서로의 압박, 회피, 협상, 떠보기를 직접 드러내세요.",
    };
  }

  return undefined;
}

/**
 * Cross-chapter repetition check.
 * Detects phrases from the current chapter that also appeared in recent chapters.
 */
export function detectCrossChapterRepetition(
  currentContent: string,
  recentChaptersContent: string,
  language: WritingLanguage = "ko",
): ReadonlyArray<PostWriteViolation> {
  if (!recentChaptersContent || recentChaptersContent.length < 100) return [];

  const violations: PostWriteViolation[] = [];
  const isEnglish = language === "en";

  if (isEnglish) {
    // Extract 3-word phrases from current chapter
    const words = currentContent.toLowerCase().replace(/[^\w\s']/g, "").split(/\s+/).filter(w => w.length > 2);
    const phraseCounts = new Map<string, number>();
    for (let i = 0; i < words.length - 2; i++) {
      const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
    }
    // Check which repeated phrases (2+ in current) also appear in recent chapters
    const recentLower = recentChaptersContent.toLowerCase();
    const crossRepeats: string[] = [];
    for (const [phrase, count] of phraseCounts) {
      if (count >= 2 && recentLower.includes(phrase)) {
        crossRepeats.push(`"${phrase}" (×${count})`);
      }
    }
    if (crossRepeats.length >= 3) {
      violations.push({
        rule: "Cross-chapter repetition",
        severity: "warning",
        description: `${crossRepeats.length} repeated phrases also found in recent chapters: ${crossRepeats.slice(0, 5).join(", ")}`,
        suggestion: "Vary action verbs and descriptive phrases to avoid cross-chapter repetition",
      });
    }
  } else {
    // Chinese: 6-char ngrams
    const chars = currentContent.replace(/[\s\n\r]/g, "");
    const phraseCounts = new Map<string, number>();
    for (let i = 0; i < chars.length - 5; i++) {
      const phrase = chars.slice(i, i + 6);
      if (/^[\u4e00-\u9fff]{6}$/.test(phrase)) {
        phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
      }
    }
    const recentClean = recentChaptersContent.replace(/[\s\n\r]/g, "");
    const crossRepeats: string[] = [];
    for (const [phrase, count] of phraseCounts) {
      if (count >= 2 && recentClean.includes(phrase)) {
        crossRepeats.push(`"${phrase}"(×${count})`);
      }
    }
    if (crossRepeats.length >= 3) {
      violations.push({
        rule: "跨章重复",
        severity: "warning",
        description: `${crossRepeats.length}个重复短语在近期章节中也出现过：${crossRepeats.slice(0, 5).join("、")}`,
        suggestion: "变换动作描写和场景用语，避免跨章节机械重复",
      });
    }
  }

  return violations;
}

export function detectParagraphLengthDrift(
  currentContent: string,
  recentChaptersContent: string,
  language: WritingLanguage = "ko",
): ReadonlyArray<PostWriteViolation> {
  if (!recentChaptersContent || recentChaptersContent.trim().length === 0) return [];

  const current = analyzeParagraphShape(currentContent, language);
  const recent = analyzeParagraphShape(recentChaptersContent, language);

  if (current.paragraphs.length < 4 || recent.paragraphs.length < 4) return [];
  if (recent.averageLength <= 0 || current.averageLength <= 0) return [];

  const shrinkRatio = current.averageLength / recent.averageLength;
  const shortRatioDelta = current.shortRatio - recent.shortRatio;

  if (shrinkRatio >= 0.6 || current.shortRatio < 0.5 || shortRatioDelta < 0.25) {
    return [];
  }

  const dropPercent = Math.round((1 - shrinkRatio) * 100);

  return [
    localizeParagraphDensityDriftWarning(
      language,
      Math.round(recent.averageLength),
      Math.round(current.averageLength),
      dropPercent,
    ),
  ];
}

function localizeParagraphDensityDriftWarning(
  language: WritingLanguage,
  recentAverage: number,
  currentAverage: number,
  dropPercent: number,
): PostWriteViolation {
  if (language === "en") {
    return {
      rule: "Paragraph density drift",
      severity: "warning",
      description: `Average paragraph length dropped from ${recentAverage} to ${currentAverage} characters (${dropPercent}% shorter) compared with recent chapters.`,
      suggestion: "Let action, observation, and reaction share paragraphs more often instead of cutting every beat into a single short line.",
    };
  }

  if (language === "ko") {
    return {
      rule: "문단 밀도 변화",
      severity: "warning",
      description: `현재 장의 평균 문단 길이가 최근 장의 ${recentAverage}자에서 ${currentAverage}자로 줄었습니다(${dropPercent}% 감소).`,
      suggestion: "모든 동작을 짧은 문단으로 끊기보다, 연결된 행동과 관찰, 반응을 한 문단 안에서 함께 처리해 문단의 층위를 회복하세요.",
    };
  }

  return {
    rule: "段落密度漂移",
    severity: "warning",
    description: `当前章平均段长从近期章节的${recentAverage}字降到${currentAverage}字，缩短了${dropPercent}%。`,
    suggestion: "不要把每个动作都切成单独短句；适当把动作、观察和反应并入同一段，恢复段落层次。",
  };
}

/** English-specific post-write validation rules. */
function validatePostWriteEnglish(
  content: string,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
): ReadonlyArray<PostWriteViolation> {
  const violations: PostWriteViolation[] = [];

  // 1. AI-tell word density (from en-prompt-sections IRON LAW 3)
  const aiTellWords = ["delve", "tapestry", "testament", "intricate", "pivotal", "vibrant", "embark", "comprehensive", "nuanced"];
  for (const word of aiTellWords) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    const matches = content.match(regex);
    if (matches && matches.length > Math.ceil(content.length / 3000)) {
      violations.push({
        rule: "AI-tell word density",
        severity: "warning",
        description: `"${word}" appears ${matches.length} times (limit: 1 per 3000 chars)`,
        suggestion: `Replace with a more specific word`,
      });
    }
  }

  // 2. Paragraph overflow (same rule applies to English)
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const longParagraphs = paragraphs.filter((p) => p.length > 500);
  if (longParagraphs.length >= 2) {
    violations.push({
      rule: "Paragraph length",
      severity: "warning",
      description: `${longParagraphs.length} paragraphs exceed 500 characters`,
      suggestion: "Break into shorter paragraphs for readability",
    });
  }

  violations.push(...detectParagraphShapeWarnings(content, "en"));
  violations.push(...detectMobileReadabilityWarnings(content, "en"));

  // 2.5. Multi-character scene with almost no direct exchange
  const quotedLines = content.match(/"[^"]+"/g) ?? [];
  const englishNames = [...new Set(
    (content.match(/\b[A-Z][a-z]{2,}\b/g) ?? [])
      .filter((name) => !ENGLISH_NAME_STOP_WORDS.has(name)),
  )];
  if (englishNames.length >= 2 && quotedLines.length < 2 && content.length >= 120) {
    violations.push({
      rule: "Dialogue pressure",
      severity: "warning",
      description: `Multi-character scene appears to rely on narration with almost no direct exchange (${englishNames.slice(0, 3).join(", ")}).`,
      suggestion: "Add at least one resistance-bearing exchange so characters push back, withhold, or pressure each other directly.",
    });
  }

  // 3. Book-specific prohibitions
  if (bookRules?.prohibitions) {
    for (const prohibition of bookRules.prohibitions) {
      if (prohibition.length >= 2 && prohibition.length <= 50 && content.toLowerCase().includes(prohibition.toLowerCase())) {
        violations.push({
          rule: "Book prohibition",
          severity: "error",
          description: `Found banned content: "${prohibition}"`,
          suggestion: "Remove or rewrite this content",
        });
      }
    }
  }

  // 4. Genre fatigue words
  const fatigueWords = bookRules?.fatigueWordsOverride && bookRules.fatigueWordsOverride.length > 0
    ? bookRules.fatigueWordsOverride
    : genreProfile.fatigueWords;
  for (const word of fatigueWords) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    const matches = content.match(regex);
    if (matches && matches.length > 1) {
      violations.push({
        rule: "Fatigue word",
        severity: "warning",
        description: `"${word}" appears ${matches.length} times (max 1 per chapter)`,
        suggestion: "Vary the vocabulary",
      });
    }
  }

  return violations;
}

function detectMobileReadabilityWarnings(
  content: string,
  language: WritingLanguage,
): ReadonlyArray<PostWriteViolation> {
  const violations: PostWriteViolation[] = [];
  const sentences = extractNarrativeSentences(content);
  if (sentences.length === 0) return violations;

  const denseSentence = sentences.find((sentence) => isDenseSentence(sentence, language));
  if (denseSentence) {
    violations.push(localizeReadabilityViolation(
      language,
      "dense",
      summarizeSentenceSample(denseSentence),
    ));
  }

  const chainedClauseSentence = sentences.find((sentence) => hasChainedDependentClauses(sentence, language));
  if (chainedClauseSentence) {
    violations.push(localizeReadabilityViolation(
      language,
      "chained",
      summarizeSentenceSample(chainedClauseSentence),
    ));
  }

  const delayedAnchorSample = detectDelayedSceneAnchor(sentences, language);
  if (delayedAnchorSample) {
    violations.push(localizeReadabilityViolation(language, "anchor", delayedAnchorSample));
  }

  return violations;
}

function localizeReadabilityViolation(
  language: WritingLanguage,
  kind: "dense" | "chained" | "anchor",
  sample: string,
): PostWriteViolation {
  if (language === "en") {
    if (kind === "dense") {
      return {
        rule: "Sentence density",
        severity: "warning",
        description: `One sentence carries too many visual or action units to parse comfortably on a phone: "${sample}"`,
        suggestion: "Let the first sentence establish the main shape or action, then move detail or reaction into the next sentence.",
      };
    }

    if (kind === "chained") {
      return {
        rule: "Dependent clause chain",
        severity: "warning",
        description: `A sentence stacks too many linked subordinate beats in one breath: "${sample}"`,
        suggestion: "Split the chain into two readable beats so the reader can land one action before the next clause arrives.",
      };
    }

    return {
      rule: "Scene anchor delay",
      severity: "warning",
      description: `Detail arrives before the reader gets a stable scene anchor: "${sample}"`,
      suggestion: "Set the room, distance, or overall shape first, then narrow into the striking detail.",
    };
  }

  if (language === "ko") {
    if (kind === "dense") {
      return {
        rule: "문장 과밀",
        severity: "warning",
        description: `형상, 세부, 반응이 한 문장에 겹쳐 모바일에서 한 번에 잡히기 어렵습니다: "${sample}"`,
        suggestion: "첫 문장에 큰 형상이나 핵심 행동을 세우고, 세부나 반응은 다음 문장으로 넘겨 두 호흡으로 나누세요.",
      };
    }

    if (kind === "chained") {
      return {
        rule: "연속 종속절",
        severity: "warning",
        description: `연결 절이 한 호흡에 연달아 붙어 독자가 중간 비트를 놓치기 쉽습니다: "${sample}"`,
        suggestion: "앞비트와 뒷비트를 나눠, 독자가 첫 동작을 잡은 뒤 다음 절로 넘어가게 정리하세요.",
      };
    }

    return {
      rule: "세부 선행",
      severity: "warning",
      description: `세부 이미지가 먼저 나오고 큰 윤곽이 뒤늦게 잡힙니다: "${sample}"`,
      suggestion: "첫 문장에서 공간 윤곽이나 전체 배치를 세운 뒤, 다음 문장에서 눈에 걸리는 디테일로 좁혀 가세요.",
    };
  }

  if (kind === "dense") {
    return {
      rule: "句子过密",
      severity: "warning",
      description: `一个句子里同时装下了太多形状、细节和反应，手机上不容易一眼看清：\"${sample}\"`,
      suggestion: "先用一句话立住大形状或核心动作，再把细节或反应移到下一句。",
    };
  }

  if (kind === "chained") {
    return {
      rule: "连锁从句",
      severity: "warning",
      description: `多个连接从句挤在同一口气里，读者容易漏掉中间节拍：\"${sample}\"`,
      suggestion: "把前后两个节拍拆开，让读者先落住第一个动作，再进入下一层从句。",
    };
  }

  return {
    rule: "细节先行",
    severity: "warning",
    description: `细节先出现，整体空间锚点却来得太晚：\"${sample}\"`,
    suggestion: "先交代空间轮廓或整体布局，再落到最醒目的细节。",
  };
}

function extractNarrativeSentences(content: string): string[] {
  return content
    .split(/[。！？.!?\n]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function isDenseSentence(sentence: string, language: WritingLanguage): boolean {
  const lengthThreshold = language === "en" ? 220 : 90;
  const branchThreshold = language === "en" ? 4 : 4;
  if (sentence.length < lengthThreshold) return false;

  const clauseCount = countBranchMarkers(sentence, language);
  return clauseCount >= branchThreshold;
}

function hasChainedDependentClauses(sentence: string, language: WritingLanguage): boolean {
  const dependentCount = countDependentClauseMarkers(sentence, language);
  if (language === "en") return dependentCount >= 4;
  return dependentCount >= 3;
}

function detectDelayedSceneAnchor(
  sentences: ReadonlyArray<string>,
  language: WritingLanguage,
): string | null {
  if (sentences.length < 2) return null;

  const secondSentence = sentences[1]!;
  if (language === "ko" && /(그제야|뒤늦게|그때서야)/.test(secondSentence) && /(윤곽|형체|전체|전경|모습|배치)/.test(secondSentence)) {
    return summarizeSentenceSample(`${sentences[0]} ${secondSentence}`);
  }

  if (language === "zh" && /(这才|直到这时|这时候才)/.test(secondSentence) && /(轮廓|全貌|整体|布局)/.test(secondSentence)) {
    return summarizeSentenceSample(`${sentences[0]} ${secondSentence}`);
  }

  if (language === "en" && /\b(only then|not until then)\b/i.test(secondSentence) && /\b(outline|full shape|whole room|entire space)\b/i.test(secondSentence)) {
    return summarizeSentenceSample(`${sentences[0]} ${secondSentence}`);
  }

  return null;
}

function countBranchMarkers(sentence: string, language: WritingLanguage): number {
  const punctuationSeparators = (sentence.match(/[,:;，、；]/g) ?? []).length;

  if (language === "ko") {
    return punctuationSeparators
      + (sentence.match(KOREAN_DEPENDENT_CLAUSE_MARKERS) ?? []).length
      + (sentence.match(KOREAN_VISUAL_LOAD_MARKERS) ?? []).length;
  }

  if (language === "zh") {
    return punctuationSeparators + (sentence.match(CHINESE_DEPENDENT_CLAUSE_MARKERS) ?? []).length;
  }

  return punctuationSeparators + (sentence.match(ENGLISH_DEPENDENT_CLAUSE_MARKERS) ?? []).length;
}

function countDependentClauseMarkers(sentence: string, language: WritingLanguage): number {
  if (language === "ko") {
    return (sentence.match(KOREAN_DEPENDENT_CLAUSE_MARKERS) ?? []).length;
  }

  if (language === "zh") {
    return (sentence.match(CHINESE_DEPENDENT_CLAUSE_MARKERS) ?? []).length + (sentence.match(/[，；]/g) ?? []).length;
  }

  return (sentence.match(ENGLISH_DEPENDENT_CLAUSE_MARKERS) ?? []).length;
}

function summarizeSentenceSample(sentence: string): string {
  const trimmed = sentence.trim();
  if (trimmed.length <= 72) return trimmed;
  return `${trimmed.slice(0, 69)}...`;
}

function appendParagraphShapeWarnings(
  violations: PostWriteViolation[],
  content: string,
  language: WritingLanguage,
): void {
  const shape = analyzeParagraphShape(content, language);
  if (shape.paragraphs.length < 4) return;

  if (shape.shortParagraphs.length >= 4 && shape.shortRatio >= 0.6) {
    violations.push(localizeParagraphFragmentationWarning(language, shape));
  }

  if (shape.maxConsecutiveShort >= 3) {
    violations.push(localizeConsecutiveShortParagraphWarning(language, shape));
  }
}

function localizeParagraphFragmentationWarning(
  language: WritingLanguage,
  shape: ParagraphShape,
): PostWriteViolation {
  if (language === "en") {
    return {
      rule: "Paragraph fragmentation",
      severity: "warning",
      description: `${shape.shortParagraphs.length} of ${shape.paragraphs.length} paragraphs are shorter than ${shape.shortThreshold} characters.`,
      suggestion: "Merge adjacent action, observation, and reaction beats so the chapter does not collapse into one-line paragraphs.",
    };
  }

  if (language === "ko") {
    return {
      rule: "문단 과분할",
      severity: "warning",
      description: `${shape.paragraphs.length}개 문단 중 ${shape.shortParagraphs.length}개가 ${shape.shortThreshold}자 미만이라 문단이 지나치게 잘게 끊겼습니다.`,
      suggestion: "인접한 행동, 관찰, 반응은 적절히 한 문단으로 묶어 모든 문장이 따로 떨어지지 않게 하세요.",
    };
  }

  return {
    rule: "段落过碎",
    severity: "warning",
    description: `${shape.paragraphs.length}个段落里有${shape.shortParagraphs.length}个不足${shape.shortThreshold}字，段落被切得过碎。`,
    suggestion: "把相邻的动作、观察、反应适当并段，不要每句话都单独起段。",
  };
}

function localizeConsecutiveShortParagraphWarning(
  language: WritingLanguage,
  shape: ParagraphShape,
): PostWriteViolation {
  if (language === "en") {
    return {
      rule: "Consecutive short paragraphs",
      severity: "warning",
      description: `${shape.maxConsecutiveShort} short paragraphs appear back to back.`,
      suggestion: "Break the one-beat-per-paragraph rhythm by folding connected beats into fuller paragraphs.",
    };
  }

  if (language === "ko") {
    return {
      rule: "연속 짧은 문단",
      severity: "warning",
      description: `${shape.shortThreshold}자 미만의 짧은 문단이 연속으로 ${shape.maxConsecutiveShort}개 나와 짧은 문장만 쌓인 느낌을 줄 수 있습니다.`,
      suggestion: "이어지는 잘게 끊긴 동작을 다시 묶어, 적어도 한 문단은 완성된 행동 흐름이나 감정 진행을 담게 하세요.",
    };
  }

  return {
    rule: "连续短段",
    severity: "warning",
    description: `连续出现${shape.maxConsecutiveShort}个不足${shape.shortThreshold}字的短段，容易形成短句堆砌。`,
    suggestion: "把连续的碎动作重新编组，至少让一个段落承载完整的动作链或情绪推进。",
  };
}

export function detectParagraphShapeWarnings(
  content: string,
  language: WritingLanguage = "ko",
): ReadonlyArray<PostWriteViolation> {
  const violations: PostWriteViolation[] = [];
  appendParagraphShapeWarnings(violations, content, language);
  return violations;
}

function isDialogueParagraph(paragraph: string): boolean {
  const trimmed = paragraph.trim();
  return /^[""「『'《]/.test(trimmed) || /^[""]/.test(trimmed) || /^——/.test(trimmed);
}

function analyzeParagraphShape(content: string, language: WritingLanguage): ParagraphShape {
  const paragraphs = extractParagraphs(content);
  // Exclude dialogue lines from short paragraph counting — dialogue is naturally short
  const narrativeParagraphs = paragraphs.filter((p) => !isDialogueParagraph(p));
  const shortThreshold = language === "en" ? 120 : 35;
  const shortParagraphs = narrativeParagraphs.filter((paragraph) => paragraph.length < shortThreshold);
  const averageLength = paragraphs.length > 0
    ? paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0) / paragraphs.length
    : 0;

  let maxConsecutiveShort = 0;
  let currentConsecutive = 0;
  for (const paragraph of narrativeParagraphs) {
    if (paragraph.length < shortThreshold) {
      currentConsecutive++;
      maxConsecutiveShort = Math.max(maxConsecutiveShort, currentConsecutive);
    } else {
      currentConsecutive = 0;
    }
  }

  return {
    paragraphs,
    shortThreshold,
    shortParagraphs,
    shortRatio: narrativeParagraphs.length > 0 ? shortParagraphs.length / narrativeParagraphs.length : 0,
    averageLength,
    maxConsecutiveShort,
  };
}

function extractParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .filter((paragraph) => paragraph !== "---")
    .filter((paragraph) => !paragraph.startsWith("#"));
}

const ENGLISH_NAME_STOP_WORDS = new Set([
  "The",
  "And",
  "But",
  "When",
  "While",
  "After",
  "Before",
  "Even",
  "Then",
  "They",
]);

const CHINESE_TITLE_STOP_WORDS = new Set([
  "这次",
  "正文",
  "标题",
  "重复",
  "不同",
  "完全",
  "只是",
  "碰巧",
  "没有",
  "回头",
]);

const CHINESE_TITLE_STOP_CHARS = new Set(["的", "了", "着", "一", "只", "从", "在", "和", "与", "把", "被", "有", "没", "里", "又", "才"]);

/**
 * Detect duplicate or near-duplicate chapter titles.
 * Compares the new title against existing chapter titles from index.
 */
export function detectDuplicateTitle(
  newTitle: string,
  existingTitles: ReadonlyArray<string>,
): ReadonlyArray<PostWriteViolation> {
  if (!newTitle.trim()) return [];

  const normalized = newTitle.trim().toLowerCase();
  const violations: PostWriteViolation[] = [];

  for (const existing of existingTitles) {
    const existingNorm = existing.trim().toLowerCase();
    if (!existingNorm) continue;

    // Exact match
    if (normalized === existingNorm) {
      violations.push({
        rule: "duplicate-title",
        severity: "warning",
        description: `章节标题"${newTitle}"与已有章节标题完全相同`,
        suggestion: "更换一个不同的章节标题",
      });
      break;
    }

    // Near-duplicate: one is substring of the other, or only differs by punctuation/numbers
    const stripPunct = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");
    if (stripPunct(normalized) === stripPunct(existingNorm)) {
      violations.push({
        rule: "near-duplicate-title",
        severity: "warning",
        description: `章节标题"${newTitle}"与已有标题"${existing}"高度相似`,
        suggestion: "避免使用相似的章节标题",
      });
      break;
    }
  }

  return violations;
}

export function resolveDuplicateTitle(
  newTitle: string,
  existingTitles: ReadonlyArray<string>,
  language: WritingLanguage = "ko",
  options?: {
    readonly content?: string;
  },
): {
  readonly title: string;
  readonly issues: ReadonlyArray<PostWriteViolation>;
} {
  const trimmed = newTitle.trim();
  if (!trimmed) {
    return { title: newTitle, issues: [] };
  }

  const duplicateIssues = detectDuplicateTitle(trimmed, existingTitles);
  if (duplicateIssues.length > 0) {
    const regenerated = regenerateDuplicateTitle(trimmed, existingTitles, language, options?.content);
    if (regenerated && detectDuplicateTitle(regenerated, existingTitles).length === 0) {
      return { title: regenerated, issues: duplicateIssues };
    }

    let counter = 2;
    while (counter < 100) {
      const candidate = language === "en"
        ? `${trimmed} (${counter})`
        : `${trimmed}（${counter}）`;
      if (detectDuplicateTitle(candidate, existingTitles).length === 0) {
        return { title: candidate, issues: duplicateIssues };
      }
      counter++;
    }

    return { title: trimmed, issues: duplicateIssues };
  }

  const collapseIssues = detectTitleCollapse(trimmed, existingTitles, language);
  if (collapseIssues.length === 0) {
    return { title: trimmed, issues: [] };
  }

  const regenerated = regenerateCollapsedTitle(trimmed, existingTitles, language, options?.content);
  if (
    regenerated
    && detectDuplicateTitle(regenerated, existingTitles).length === 0
    && detectTitleCollapse(regenerated, existingTitles, language).length === 0
  ) {
    return { title: regenerated, issues: collapseIssues };
  }

  return { title: trimmed, issues: collapseIssues };
}

function detectTitleCollapse(
  newTitle: string,
  existingTitles: ReadonlyArray<string>,
  language: WritingLanguage,
): ReadonlyArray<PostWriteViolation> {
  const recentTitles = existingTitles
    .map((title) => title.trim())
    .filter(Boolean)
    .slice(-3);
  if (recentTitles.length < 3) {
    return [];
  }

  const cadence = analyzeChapterCadence({
    language,
    rows: [...recentTitles, newTitle].map((title, index) => ({
      chapter: index + 1,
      title,
      mood: "",
      chapterType: "",
    })),
  });
  const titlePressure = cadence.titlePressure;
  if (!titlePressure || titlePressure.pressure !== "high") {
    return [];
  }
  if (!newTitle.includes(titlePressure.repeatedToken)) {
    return [];
  }

  return [
    language === "en"
      ? {
          rule: "title-collapse",
          severity: "warning",
          description: `Chapter title "${newTitle}" keeps leaning on the recent "${titlePressure.repeatedToken}" title shell.`,
          suggestion: "Rename the chapter around a new image, action, consequence, or character focus.",
        }
      : {
          rule: "title-collapse",
          severity: "warning",
          description: `章节标题"${newTitle}"仍在沿用近期围绕“${titlePressure.repeatedToken}”的命名壳。`,
          suggestion: "换一个新的意象、动作、后果或人物焦点来命名。",
        },
  ];
}

function regenerateDuplicateTitle(
  baseTitle: string,
  existingTitles: ReadonlyArray<string>,
  language: WritingLanguage,
  content?: string,
): string | undefined {
  if (!content || !content.trim()) {
    return undefined;
  }

  const qualifier = language === "en"
    ? extractEnglishTitleQualifier(baseTitle, existingTitles, content)
    : extractChineseTitleQualifier(baseTitle, existingTitles, content);
  if (!qualifier) {
    return undefined;
  }

  return language === "en"
    ? `${baseTitle}: ${qualifier}`
    : `${baseTitle}：${qualifier}`;
}

function regenerateCollapsedTitle(
  baseTitle: string,
  existingTitles: ReadonlyArray<string>,
  language: WritingLanguage,
  content?: string,
): string | undefined {
  if (!content || !content.trim()) {
    return undefined;
  }

  const fresh = language === "en"
    ? extractEnglishTitleQualifier(baseTitle, existingTitles, content)
    : extractChineseTitleQualifier(baseTitle, existingTitles, content);
  if (!fresh) {
    return undefined;
  }

  return fresh === baseTitle ? undefined : fresh;
}

function extractEnglishTitleQualifier(
  baseTitle: string,
  existingTitles: ReadonlyArray<string>,
  content: string,
): string | undefined {
  const blocked = new Set(extractEnglishTitleTerms([baseTitle, ...existingTitles].join(" ")));
  const words = (content.match(/[A-Za-z]{4,}/g) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => !ENGLISH_NAME_STOP_WORDS.has(capitalize(word)))
    .filter((word) => !blocked.has(word));
  const first = words[0];
  if (!first) {
    return undefined;
  }

  const second = words.find((word) => word !== first && !blocked.has(word));
  return second
    ? `${capitalize(first)} ${capitalize(second)}`
    : capitalize(first);
}

function extractChineseTitleQualifier(
  baseTitle: string,
  existingTitles: ReadonlyArray<string>,
  content: string,
): string | undefined {
  const blocked = new Set(extractChineseTitleTerms([baseTitle, ...existingTitles].join("")));
  const segments = content.match(/[\u4e00-\u9fff]+/g) ?? [];

  for (const segment of segments) {
    for (let start = 0; start < segment.length; start += 1) {
      for (let size = 2; size <= 4; size += 1) {
        const candidate = segment.slice(start, start + size).trim();
        if (candidate.length < 2) continue;
        if (CHINESE_TITLE_STOP_WORDS.has(candidate)) continue;
        if ([...candidate].some((char) => CHINESE_TITLE_STOP_CHARS.has(char))) continue;
        if (blocked.has(candidate)) continue;
        return candidate;
      }
    }
  }

  return undefined;
}

function extractEnglishTitleTerms(text: string): string[] {
  return [...new Set((text.match(/[A-Za-z]{4,}/g) ?? []).map((word) => word.toLowerCase()))];
}

function extractChineseTitleTerms(text: string): string[] {
  const terms = new Set<string>();
  const segments = text.match(/[\u4e00-\u9fff]+/g) ?? [];

  for (const segment of segments) {
    for (let start = 0; start < segment.length; start += 1) {
      for (let size = 2; size <= 4; size += 1) {
        const candidate = segment.slice(start, start + size).trim();
        if (candidate.length < 2) continue;
        if ([...candidate].some((char) => CHINESE_TITLE_STOP_CHARS.has(char))) continue;
        terms.add(candidate);
      }
    }
  }

  return [...terms];
}

function capitalize(word: string): string {
  return word.length === 0 ? word : `${word[0]!.toUpperCase()}${word.slice(1)}`;
}
