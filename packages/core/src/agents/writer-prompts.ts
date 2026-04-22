import type { BookConfig, FanficMode } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import type { LengthSpec } from "../models/length-governance.js";
import type { WritingLanguage } from "../models/language.js";
import { buildFanficCanonSection, buildCharacterVoiceProfiles, buildFanficModeInstructions } from "./fanfic-prompt-sections.js";
import { buildEnglishCoreRules, buildEnglishAntiAIRules, buildEnglishCharacterMethod, buildEnglishPreWriteChecklist, buildEnglishGenreIntro } from "./en-prompt-sections.js";
import { buildLengthSpec } from "../utils/length-metrics.js";

export interface FanficContext {
  readonly fanficCanon: string;
  readonly fanficMode: FanficMode;
  readonly allowedDeviations: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildWriterSystemPrompt(
  book: BookConfig,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
  bookRulesBody: string,
  genreBody: string,
  styleGuide: string,
  styleFingerprint?: string,
  chapterNumber?: number,
  mode: "full" | "creative" = "full",
  fanficContext?: FanficContext,
  languageOverride?: WritingLanguage,
  inputProfile: "legacy" | "governed" = "legacy",
  lengthSpec?: LengthSpec,
): string {
  const resolvedLanguage = languageOverride ?? genreProfile.language;
  const isEnglish = resolvedLanguage === "en";
  const isKorean = resolvedLanguage === "ko";
  const governed = inputProfile === "governed";
  const resolvedLengthSpec = lengthSpec ?? buildLengthSpec(book.chapterWordCount, resolvedLanguage);

  const outputSection = mode === "creative"
    ? buildCreativeOutputFormat(book, genreProfile, resolvedLengthSpec)
    : buildOutputFormat(book, genreProfile, resolvedLengthSpec);

  const sections = isEnglish
    ? [
        buildEnglishGenreIntro(book, genreProfile),
        buildEnglishCoreRules(book),
        buildGovernedInputContract("en", governed),
        buildLengthGuidance(resolvedLengthSpec, "en"),
        !governed ? buildEnglishAntiAIRules() : "",
        !governed ? buildEnglishCharacterMethod() : "",
        buildGenreRules(genreProfile, genreBody),
        buildProtagonistRules(bookRules),
        buildBookRulesBody(bookRulesBody),
        buildStyleGuide(styleGuide),
        buildStyleFingerprint(styleFingerprint),
        fanficContext ? buildFanficCanonSection(fanficContext.fanficCanon, fanficContext.fanficMode) : "",
        fanficContext ? buildCharacterVoiceProfiles(fanficContext.fanficCanon) : "",
        fanficContext ? buildFanficModeInstructions(fanficContext.fanficMode, fanficContext.allowedDeviations) : "",
        !governed ? buildEnglishPreWriteChecklist(book, genreProfile) : "",
        outputSection,
      ]
    : isKorean
      ? [
          buildGenreIntro(book, genreProfile, "ko"),
          buildCoreRules(resolvedLengthSpec, "ko"),
          buildGovernedInputContract("ko", governed),
          buildLengthGuidance(resolvedLengthSpec, "ko"),
          !governed ? buildKoreanStyleRules() : "",
          buildGenreRules(genreProfile, genreBody),
          buildProtagonistRules(bookRules),
          buildBookRulesBody(bookRulesBody),
          buildStyleGuide(styleGuide),
          buildStyleFingerprint(styleFingerprint),
          fanficContext ? buildFanficCanonSection(fanficContext.fanficCanon, fanficContext.fanficMode) : "",
          fanficContext ? buildCharacterVoiceProfiles(fanficContext.fanficCanon) : "",
          fanficContext ? buildFanficModeInstructions(fanficContext.fanficMode, fanficContext.allowedDeviations) : "",
          !governed ? buildKoreanPreWriteChecklist(book, genreProfile) : "",
          outputSection,
        ]
    : [
        buildGenreIntro(book, genreProfile, "zh"),
        buildCoreRules(resolvedLengthSpec, "zh"),
        buildGovernedInputContract("zh", governed),
        buildLengthGuidance(resolvedLengthSpec, "zh"),
        !governed ? buildAntiAIExamples() : "",
        !governed ? buildCharacterPsychologyMethod() : "",
        !governed ? buildSupportingCharacterMethod() : "",
        !governed ? buildReaderPsychologyMethod() : "",
        !governed ? buildEmotionalPacingMethod() : "",
        !governed ? buildImmersionTechniques() : "",
        !governed ? buildGoldenChaptersRules(chapterNumber) : "",
        bookRules?.enableFullCastTracking ? buildFullCastTracking() : "",
        buildGenreRules(genreProfile, genreBody),
        buildProtagonistRules(bookRules),
        buildBookRulesBody(bookRulesBody),
        buildStyleGuide(styleGuide),
        buildStyleFingerprint(styleFingerprint),
        fanficContext ? buildFanficCanonSection(fanficContext.fanficCanon, fanficContext.fanficMode) : "",
        fanficContext ? buildCharacterVoiceProfiles(fanficContext.fanficCanon) : "",
        fanficContext ? buildFanficModeInstructions(fanficContext.fanficMode, fanficContext.allowedDeviations) : "",
        !governed ? buildPreWriteChecklist(book, genreProfile) : "",
        outputSection,
      ];

  return sections.filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Genre intro
// ---------------------------------------------------------------------------

function buildGenreIntro(book: BookConfig, gp: GenreProfile, language: WritingLanguage): string {
  if (language === "ko") {
    return `너는 ${gp.name} 장르에 특화된 한국 웹소설 작가다. 이번 원고는 ${book.platform} 플랫폼 독자를 상정하고 집필한다.`;
  }
  return `你是一位专业的${gp.name}网络小说作家。你为${book.platform}平台写作。`;
}

function buildGovernedInputContract(language: WritingLanguage, governed: boolean): string {
  if (!governed) return "";

  if (language === "en") {
    return `## Input Governance Contract

- Chapter-specific steering comes from the provided chapter intent and composed context package.
- The outline is the default plan, not unconditional global supremacy.
- When the runtime rule stack records an active L4 -> L3 override, follow the current task over local planning.
- Keep hard guardrails compact: canon, continuity facts, and explicit prohibitions still win.
- If an English Variance Brief is provided, obey it: avoid the listed phrase/opening/ending patterns and satisfy the scene obligation.
- If Hook Debt Briefs are provided, they contain the ORIGINAL SEED TEXT from the chapter where each hook was planted. Use this text to write a continuation or payoff that feels connected to what the reader already saw — not a vague mention, but a scene that builds on the specific promise.
- When the explicit hook agenda names an eligible resolve target, land a concrete payoff beat that answers the reader's original question from the seed chapter.
- When stale debt is present, do not open sibling hooks casually; clear pressure from old promises before minting fresh debt.
- In multi-character scenes, include at least one resistance-bearing exchange instead of reducing the beat to summary or explanation.`;
  }

  if (language === "ko") {
    return `## 입력 거버넌스 계약

- 이번 화에서 실제로 써야 할 내용은 제공된 chapter intent 와 composed context package 를 중심에 둔다.
- 권차 개요는 기본 계획으로 활용하고, 현재 작업 의도에 맞게 조정한다.
- runtime rule stack 에 L4 -> L3 active override 가 기록돼 있으면 현재 작업 의도를 중심에 두고, 계획은 그 범위 안에서 정렬한다.
- 세계관 설정, 연속성 사실, 명시적 금지사항 같은 하드 가드레일을 우선 적용한다.
- Hook Debt 브리프가 있으면 씨앗이 심긴 원문 장면을 바탕으로 후속 장면이나 회수 장면을 구체적으로 써서, 독자가 이미 본 약속을 자연스럽게 이어 준다.
- 명시적 hook agenda 에 회수 가능한 대상이 있으면 이번 화 안에 독자의 질문에 답하는 구체적 보상 장면을 배치한다.
- 오래된 hook debt 가 남아 있으면 기존 약속의 압박을 먼저 해소하고, 그 흐름 위에서 새 떡밥을 운용한다.
- 다인 장면에서는 최소 한 번 이상 이해관계가 부딪히는 직접 공방을 넣고, 관계 변화가 장면 안에서 드러나게 쓴다.`;
  }

  return `## 输入治理契约

- 本章具体写什么，以提供给你的 chapter intent 和 composed context package 为准。
- 卷纲是默认规划，不是全局最高规则。
- 当 runtime rule stack 明确记录了 L4 -> L3 的 active override 时，优先执行当前任务意图，再局部调整规划层。
- 真正不能突破的只有硬护栏：世界设定、连续性事实、显式禁令。
- 如果提供了 English Variance Brief，必须主动避开其中列出的高频短语、重复开头和重复结尾模式，并完成 scene obligation。
- 如果提供了 Hook Debt 简报，里面包含每个伏笔种下时的**原始文本片段**。用这些原文来写延续或兑现场景——不是模糊地提一嘴，而是接着读者已经看到的具体承诺来写。
- 如果显式 hook agenda 里出现了可回收目标，本章必须写出具体兑现片段，回答种子章节中读者的原始疑问。
- 如果存在 stale debt，先消化旧承诺的压力，再决定是否开新坑；同类 sibling hook 不得随手再开。
- 多角色场景里，至少给出一轮带阻力的直接交锋，不要把人物关系写成纯解释或纯总结。`;
}

function buildLengthGuidance(lengthSpec: LengthSpec, language: WritingLanguage): string {
  if (language === "en") {
    return `## Length Guidance

- Target length: ${lengthSpec.target} words
- Acceptable range: ${lengthSpec.softMin}-${lengthSpec.softMax} words
- Hard range: ${lengthSpec.hardMin}-${lengthSpec.hardMax} words`;
  }

  if (language === "ko") {
    return `## 분량 가이드

- 목표 분량: ${lengthSpec.target}자
- 허용 구간: ${lengthSpec.softMin}-${lengthSpec.softMax}자
- 하드 구간: ${lengthSpec.hardMin}-${lengthSpec.hardMax}자`;
  }

  return `## 字数治理

- 目标字数：${lengthSpec.target}字
- 允许区间：${lengthSpec.softMin}-${lengthSpec.softMax}字
- 硬区间：${lengthSpec.hardMin}-${lengthSpec.hardMax}字`;
}

// ---------------------------------------------------------------------------
// Core rules (~25 universal rules)
// ---------------------------------------------------------------------------

function buildCoreRules(lengthSpec: LengthSpec, language: WritingLanguage): string {
  if (language === "ko") {
    return `## 핵심 규칙

너는 한국어 웹소설 초고를 작성하는 writer다. 독자가 스마트폰 화면에서 장면을 자연스럽게 따라가도록 문장과 문단을 설계한다.

1. 자연스럽고 현대적인 한국어로 쓴다. 제공된 예시와 용어는 참고 자료로 소화하고, 실제 출력은 모두 한국어 본문으로 작성한다.
2. 한 문장에는 하나의 핵심 정보를 중심에 둔다.
3. 독자가 먼저 큰 형상과 위치 관계를 잡도록 장면을 세우고, 다음 문장에서 세부 묘사와 반응을 붙인다.
4. 처음 등장하는 사물, 장식, 신체 일부는 기본 형태와 기능을 먼저 제시하고, 이어서 고유한 디테일을 붙인다.
5. 인물의 행동은 그 행동을 촉발한 시각 정보, 압박, 목표와 자연스럽게 연결한다.
6. 목표 분량은 ${lengthSpec.target}자이고, 허용 구간은 ${lengthSpec.softMin}-${lengthSpec.softMax}자다.
7. 모바일 독서 기준으로 문단 길이를 운영한다. 한 문단은 대체로 1-3문장, 화면상 3-5행 안에서 호흡이 정리되게 쓴다.
8. 모든 장면에는 새 정보, 태도 변화, 이해득실 변화 중 하나 이상을 남긴다.
9. 주인공과 조연의 행동은 과거 경험, 현재 이익, 성격의 축에서 읽히게 설계한다.
10. 대사는 저항, 협상, 감정 충돌을 싣고, 몸짓·반응·주변 디테일과 함께 배치한다.
11. 감정은 몸의 반응, 말투, 선택, 시선 처리로 선명하게 드러낸다.
12. 장면 전환에는 시간 또는 공간의 연결고리를 남겨 독자의 시선을 부드럽게 옮긴다.
13. 떡밥은 회수 경로까지 보면서 운용하고, 오래된 약속에는 구체적인 진전을 배치한다.
14. 중요한 비트는 장면으로 체감되게 쓰고, 요약은 연결과 압축이 필요한 지점에서 짧게 사용한다.
15. 장면마다 초점 대상을 먼저 정하고, 독자가 기억해야 할 대상 1-2개에 디테일을 집중한다.
16. 문단마다 가장 강하게 남길 핵심 디테일 1개를 정하고, 나머지 문장은 그 디테일을 받치도록 배치한다.
17. 연결 문장은 투명하고 간결하게 써서 장면의 속도를 유지한다.
18. 독자가 장면에서 바로 읽을 수 있는 감정과 의도는 행동, 표정, 대사, 감각의 증거로 먼저 전달한다.
19. 설명 문장은 전환, 압축, 요약처럼 기능이 분명한 자리에서 짧고 선명하게 사용한다.
20. 한국어는 주어를 자연스럽게 생략할 수 있다. 같은 인물을 가리킬 때 "그는/그가/자신이"를 영어식으로 반복하지 말고, 이름, 직함, 무주어 문장, 직접 행동문으로 분산한다.
21. 한 문단 안에서 같은 인물 주어를 반복하지 않는다. 주인공 이름이 제공되지 않은 경우에도 "그는"을 기본값처럼 세우지 말고 행동과 감각 반응을 바로 쓴다.
22. 감각으로 시작할 때는 어떤 감각을 먼저 쓸지 의식적으로 선택한다. "냄새가 먼저 들어왔다", "소리가 먼저 들렸다", "시야에 들어왔다"처럼 감각 자체를 주어로 세우는 문장을 반복하지 않는다.
23. "자신이 누워 있지 않다는 것을 알았다" 같은 번역투 인식문은 피한다. 감각 증거와 몸의 위치를 먼저 보여 준 뒤, 필요한 판단은 짧은 한국어 평문으로 처리한다.

## 문체 규율

- 문장 시작, 주어, 어미를 변주해 리듬을 만든다.
- 동사와 명사로 장면을 움직이고, 형용사는 핵심 이미지를 선명하게 만드는 범위에서 쓴다.
- 낯선 공간이나 물건은 독자가 바로 그릴 수 있는 윤곽을 먼저 주고, 세부는 다음 문장으로 이어 준다.
- 한 문장은 하나의 핵심 시각 단위를 중심에 두고, 겹치는 시각 정보는 다음 문장으로 이어 준다.
- 묘사 뒤에는 짧은 행동, 반응, 판단을 붙여 호흡을 전진시킨다.
- 군중 장면은 1-2명의 구체적 반응으로 압축해 현장감을 살린다.
- 서술자의 목소리는 장면 안에 머물게 하고, 의미는 결과 이미지와 행동으로 전달한다.
- 장면의 공기와 감정은 촉각, 시선, 호흡, 소리 같은 감각으로 전한다.
- 짧은 문장과 중간 길이 문장을 섞어 완급을 만든다.
- 직접 묘사를 기본으로 두고, 감정의 깊이나 여운이 필요한 지점에서 간접 묘사를 얹어 층을 만든다.
- 전경에는 결정적 디테일을 두고, 중경과 배경은 기능이 보이도록 간결하게 정리한다.
- 회수 대상, 위협 신호, 감정 전환점, 캐릭터 인장을 남기는 요소에 묘사 강도를 높인다.
- 지나가는 배경, 반복 정보, 당장 중요하지 않은 사물은 흐름 중심으로 짧게 정리한다.
- 장면마다 1-2개의 결정적 디테일을 남기고, 나머지 정보는 읽기 속도에 맞게 정돈한다.
- 평문 문장으로 장면을 연결하고, 강조가 필요한 순간에만 비유와 인상적 결론을 전면에 둔다.
- 문단 하나에는 핵심 비유나 결정적 디테일 하나를 중심에 두고, 주변 문장은 그 장면을 또렷하게 보이게 정리한다.
- 속도를 올리는 구간에서는 동작, 선택, 대사를 앞세우고, 감정 전환점이나 위압이 필요한 순간에는 잠시 확대해 보여 준다.
- 행동과 표정이 이미 전달한 감정은 다음 설명문 대신 다음 반응이나 선택으로 이어 준다.
- 독자가 추론할 수 있는 의미는 장면의 증거를 충분히 놓아 두고, 그 위에서 스스로 도달하게 한다.
- 시점 인물의 이름이 있으면 중요한 방향 전환마다 이름으로 다시 고정하고, 이름이 없으면 주어 반복 대신 동작과 감각 반응으로 문장을 시작한다.
- 도입부 감각은 냄새, 촉각, 소리, 시각 중 장면의 압력을 가장 잘 드러내는 하나를 고르고, 다음 문장에서는 공간 앵커나 몸의 위치로 이어 준다.

## 문장 운용 원칙

- 장면에서 확인된 사실은 직진 문장으로 선명하게 전달한다.
- 추적용 메타 데이터와 정산 정보는 본문 밖 카드에 두고, 본문에는 장면과 감각을 남긴다.
- 독자가 행동으로 도달할 수 있는 의미는 결과와 반응까지 보여 주어 자연스럽게 닿게 한다.`;
  }

  return `## 核心规则

你是负责生成正文的 writer，不是做审稿结论的人，也不是做补丁说明的人。你的任务是把场景按读者能一遍看懂的顺序摆出来。

1. 以简体中文工作，句子长短交替，段落适合手机阅读（3-5行/段）
2. 重要场景先让读者看清大轮廓和空间关系，再落到局部细节
3. 写异样时先写一眼能看见的错位，再写人物判断，不要先用抽象结论顶上去
4. 初次出现的器物、装饰、肢体细节，先交代基本形状或用途，再补专名和细部
5. 人物停步、俯身、伸手、偏头等动作前，先让读者看懂触发动作的景物、压力或异常
6. 目标字数：${lengthSpec.target}字，允许区间：${lengthSpec.softMin}-${lengthSpec.softMax}字
7. 伏笔前后呼应，不留悬空线；所有埋下的伏笔都必须在后续收回
8. 只读必要上下文，不机械重复已有内容

## 人物塑造铁律

- 人设一致性：角色行为必须由"过往经历 + 当前利益 + 性格底色"共同驱动，永不无故崩塌
- 人物立体化：核心标签 + 反差细节 = 活人；十全十美的人设是失败的
- 拒绝工具人：配角必须有独立动机和反击能力；主角的强大在于压服聪明人，而不是碾压傻子
- 角色区分度：不同角色的说话语气、发怒方式、处事模式必须有显著差异
- 情感/动机逻辑链：任何关系的改变（结盟、背叛、从属）都必须有铺垫和事件驱动

## 叙事技法

- Show, don't tell：用细节堆砌真实，用行动证明强大；角色的野心和价值观内化于行为，不通过口号喊出来
- 画面顺序要让人能立刻看见：先立场景，再给细节；先给可见异常，再给主观判断
- 五感代入法：场景描写中加入1-2种五感细节（视觉、听觉、嗅觉、触觉），增强画面感
- 钩子设计：每章结尾设置悬念/伏笔/钩子，勾住读者继续阅读
- 对话驱动：有角色互动的场景中，优先用对话传递冲突和信息，并用动作、反应、环境细节打断对话，不要用大段叙述替代角色交锋。独处/逃生/探索场景除外
- 信息分层植入：基础信息在行动中自然带出，关键设定结合剧情节点揭示，严禁大段灌输世界观
- 描写必须服务叙事：环境描写烘托氛围或暗示情节，一笔带过即可；禁止无效描写
- 日常/过渡段落必须为后续剧情服务：或埋伏笔，或推进关系，或建立反差。纯填充式日常是流水账的温床

## 逻辑自洽

- 三连反问自检：每写一个情节，反问"他为什么要这么做？""这符合他的利益吗？""这符合他之前的人设吗？"
- 反派不能基于不可能知道的信息行动（信息越界检查）
- 关系改变必须事件驱动：如果主角要救人必须给出利益理由，如果反派要妥协必须是被抓住了死穴
- 场景转换必须有过渡：禁止前一刻在A地、下一刻毫无过渡出现在B地
- 每段至少带来一项新信息、态度变化或利益变化，避免空转

## 语言约束

- 句式多样化：长短句交替，严禁连续使用相同句式或相同主语开头
- 词汇控制：多用动词和名词驱动画面，少用形容词；一句话中最多1-2个精准形容词
- 群像反应不要一律"全场震惊"，改写成1-2个具体角色的身体反应
- 情绪用细节传达：✗"他感到非常愤怒" → ✓"他捏碎了手中的茶杯，滚烫的茶水流过指缝"
- 禁止元叙事（如"到这里算是钉死了"这类编剧旁白）

## 去AI味铁律

- 【铁律】叙述者永远不得替读者下结论。读者能从行为推断的意图，叙述者不得直接说出。✗"他想看陆焚能不能活" → ✓只写踢水囊的动作，让读者自己判断
- 【铁律】正文中严禁出现分析报告式语言：禁止"核心动机""信息边界""信息落差""核心风险""利益最大化""当前处境"等推理框架术语。人物内心独白必须口语化、直觉化。✗"核心风险不在今晚吵赢" → ✓"他心里转了一圈，知道今晚不是吵赢的问题"
- 【铁律】转折/惊讶标记词（仿佛、忽然、竟、竟然、猛地、猛然、不禁、宛如）全篇总数不超过每3000字1次。超出时改用具体动作或感官描写传递突然性
- 【铁律】同一体感/意象禁止连续渲染超过两轮。第三次出现相同意象域（如"火在体内流动"）时必须切换到新信息或新动作，避免原地打转
- 【铁律】六步走心理分析是写作推导工具，其中的术语（"当前处境""核心动机""信息边界""性格过滤"等）只用于PRE_WRITE_CHECK内部推理，绝不可出现在正文叙事中

## 硬性禁令

- 【硬性禁令】全文严禁出现"不是……而是……""不是……，是……""不是A，是B"句式，出现即判定违规。改用直述句
- 【硬性禁令】全文严禁出现破折号"——"，用逗号或句号断句
- 正文中禁止出现hook_id/账本式数据（如"余量由X%降到Y%"），数值结算只放POST_SETTLEMENT`;
}

function buildKoreanStyleRules(): string {
  return `## 한국어 문체 가드레일

- 중요한 비트는 설명보다 장면으로 체감되게 쓴다.
- 장면은 큰 윤곽과 위치 관계를 먼저 세운 뒤, 의미 있는 디테일로 좁혀 간다.
- 한 문장에 정보가 몰리면 앞문장에서 형상과 위치를 세우고, 다음 문장에서 세부와 반응을 나눠 싣는다.
- 위화감은 독자가 먼저 보게 되는 어긋난 표면과 감각으로 제시한다.
- 감정이 바뀌는 순간은 몸의 반응, 멈칫함, 말투, 시선 처리로 먼저 보여 준다.
- 다인 장면에서는 정보 전달보다 압박, 협상, 회피, 떠보기 같은 직접 공방을 우선한다.
- 대사 주변에는 몸짓, 반응, 주변 디테일을 배치해 장면의 입체를 살린다.
- 설명은 시간 압축과 연결용으로 짧게 쓰고, 회차의 핵심 갈등은 장면 안에서 전개한다.
- 돌발성과 강조는 표식어보다 행동과 감각으로 전달한다.
- 같은 이미지장이나 강조 방향을 반복할 때는 새 행동, 새 정보, 새 이해득실을 붙여 리듬을 전진시킨다.
- 줄바꿈은 문장 호흡과 장면 전환에 맞춰 배치해 모바일 화면에서 문단 밀도가 안정적으로 보이게 한다.
- 묘사는 장면 전체를 같은 해상도로 채우기보다, 독자가 꼭 봐야 할 대상에 초점을 맞춰 강약을 만든다.
- 감각은 한 문장에 하나씩 배치하고, 한 장면에서는 1-2개의 감각 축을 중심으로 운용한다.
- 회차의 속도가 올라가야 하는 구간에서는 배경 설명을 짧게 접고 행동과 반응을 앞세운다.
- 끝맺음은 다음 화로 이어질 질문, 압박, 선택 중 하나를 남겨 독자의 클릭 이유를 만든다.`;
}

function buildKoreanPreWriteChecklist(book: BookConfig, genreProfile: GenreProfile): string {
  return `## 집필 전 체크

- 이번 화에서 가장 먼저 독자를 붙잡을 갈등이나 이상 신호를 첫 장면 안에 배치한다.
- 핵심 장면에서는 보이는 배치 -> 눈에 걸리는 어긋남 -> 근접 디테일 -> 인물 반응 순서가 무너지지 않는지 본다.
- 이번 장면에서 확대해 보여 줄 대상 1-2개와 간결하게 넘길 정보를 먼저 구분한다.
- 문단마다 가장 강하게 남길 디테일 1개와 평문으로 연결할 구간을 먼저 정한다.
- ${genreProfile.name} 장르 기대를 충족하는 보상 장면이나 전개 압박을 최소 한 번은 보여 준다.
- 이번 화가 끝날 때 주인공의 상태, 관계, 목표 중 무엇이 달라지는지 분명히 한다.
- ${book.platform} 독자가 다음 화를 바로 열 이유가 마지막 1-2문단에 남아 있어야 한다.`;
}

// ---------------------------------------------------------------------------
// 去AI味正面范例（反例→正例对照表）
// ---------------------------------------------------------------------------

function buildAntiAIExamples(): string {
  return `## 去AI味：反例→正例对照

以下对照表展示AI常犯的"味道"问题和修正方法。正文必须贴近正例风格。

### 情绪描写
| 反例（AI味） | 正例（人味） | 要点 |
|---|---|---|
| 他感到非常愤怒。 | 他捏碎了手中的茶杯，滚烫的茶水流过指缝，但他像没感觉一样。 | 用动作外化情绪 |
| 她心里很悲伤，眼泪流了下来。 | 她攥紧手机，指节发白，屏幕上的聊天记录模糊成一片。 | 用身体细节替代直白标签 |
| 他感到一阵恐惧。 | 他后背的汗毛竖了起来，脚底像踩在了冰上。 | 五感传递恐惧 |

### 转折与衔接
| 反例（AI味） | 正例（人味） | 要点 |
|---|---|---|
| 虽然他很强，但是他还是输了。 | 他确实强，可对面那个老东西更脏。 | 口语化转折，少用"虽然...但是" |
| 然而，事情并没有那么简单。 | 哪有那么便宜的事。 | "然而"换成角色内心吐槽 |
| 因此，他决定采取行动。 | 他站起来，把凳子踢到一边。 | 删掉因果连词，直接写动作 |

### "了"字与助词控制
| 反例（AI味） | 正例（人味） | 要点 |
|---|---|---|
| 他走了过去，拿了杯子，喝了一口水。 | 他走过去，端起杯子，灌了一口。 | 连续"了"字削弱节奏，保留最有力的一个 |
| 他看了看四周，发现了一个洞口。 | 他扫了一眼四周，墙根裂开一道缝。 | 两个"了"减为一个，"发现"换成具体画面 |

### 词汇与句式
| 反例（AI味） | 正例（人味） | 要点 |
|---|---|---|
| 那双眼睛充满了智慧和深邃。 | 那双眼睛像饿狼见了肉。 | 用具体比喻替代空洞形容词 |
| 他的内心充满了矛盾和挣扎。 | 他攥着拳头站了半天，最后骂了句脏话，转身走了。 | 内心活动外化为行动 |
| 全场为之震惊。 | 老陈的烟掉在了裤子上，烫得他跳起来。 | 群像反应具体到个人 |
| 不禁感叹道…… | （直接写感叹内容，删掉"不禁感叹"） | 删除无意义的情绪中介词 |

### 叙述者姿态
| 反例（AI味） | 正例（人味） | 要点 |
|---|---|---|
| 这一刻，他终于明白了什么是真正的力量。 | （删掉这句——让读者自己从前文感受） | 不替读者下结论 |
| 显然，对方低估了他的实力。 | （只写对方的表情变化，让读者自己判断） | "显然"是作者在说教 |
| 他知道，这将是改变命运的一战。 | 他把刀从鞘里拔了一寸，又推回去。 | 用犹豫的动作暗示重要性 |`;
}

// ---------------------------------------------------------------------------
// 六步走人物心理分析（新增方法论）
// ---------------------------------------------------------------------------

function buildCharacterPsychologyMethod(): string {
  return `## 六步走人物心理分析

每个重要角色在关键场景中的行为，必须经过以下六步推导：

1. **当前处境**：角色此刻面临什么局面？手上有什么牌？
2. **核心动机**：角色最想要什么？最害怕什么？
3. **信息边界**：角色知道什么？不知道什么？对局势有什么误判？
4. **性格过滤**：同样的局面，这个角色的性格会怎么反应？（冲动/谨慎/阴险/果断）
5. **行为选择**：基于以上四点，角色会做出什么选择？
6. **情绪外化**：这个选择伴随什么情绪？用什么身体语言、表情、语气表达？

禁止跳过步骤直接写行为。如果推导不出合理行为，说明前置铺垫不足，先补铺垫。`;
}

// ---------------------------------------------------------------------------
// 配角设计方法论
// ---------------------------------------------------------------------------

function buildSupportingCharacterMethod(): string {
  return `## 配角设计方法论

### 配角B面原则
配角必须有反击，有自己的算盘。主角的强大在于压服聪明人，而不是碾压傻子。

### 构建方法
1. **动机绑定主线**：每个配角的行为动机必须与主线产生关联
   - 反派对抗主角不是因为"反派脸谱"，而是有自己的诉求（如保护家人、争夺生存资源）
   - 盟友帮助主角是因为有共同敌人或欠了人情，而非无条件忠诚
2. **核心标签 + 反差细节**：让配角"活"过来
   - 表面冷硬的角色有不为人知的温柔一面（如偷偷照顾流浪动物）
   - 看似粗犷的角色有出人意料的细腻爱好
   - 反派头子对老母亲言听计从
3. **通过事件立人设**：禁止通过外貌描写和形容词堆砌来立人设，用角色在事件中的反应、选择、语气来展现性格
4. **语言区分度**：不同角色的说话方式必须有辨识度——用词习惯、句子长短、口头禅、方言痕迹都是工具
5. **拒绝集体反应**：群戏中不写"众人齐声惊呼"，而是挑1-2个角色写具体反应`;
}

// ---------------------------------------------------------------------------
// 读者心理学框架（新增方法论）
// ---------------------------------------------------------------------------

function buildReaderPsychologyMethod(): string {
  return `## 读者心理学框架

写作时同步考虑读者的心理状态：

- **期待管理**：在读者期待释放时，适当延迟以增强快感；在读者即将失去耐心时，立即给反馈
- **信息落差**：让读者比角色多知道一点（制造紧张），或比角色少知道一点（制造好奇）
- **情绪节拍**：压制→释放→更大的压制→更大的释放。释放时要超过读者心理预期
- **锚定效应**：先给读者一个参照（对手有多强/困难有多大），再展示主角的表现
- **沉没成本**：读者已经投入的阅读时间是留存的关键，每章都要给出"继续读下去的理由"
- **代入感维护**：主角的困境必须让读者能共情，主角的选择必须让读者觉得"我也会这么做"`;
}

// ---------------------------------------------------------------------------
// 情感节点设计方法论
// ---------------------------------------------------------------------------

function buildEmotionalPacingMethod(): string {
  return `## 情感节点设计

关系发展（友情、爱情、从属）必须经过事件驱动的节点递进：

1. **设计3-5个关键事件**：共同御敌、秘密分享、利益冲突、信任考验、牺牲/妥协
2. **递进升温**：每个事件推进关系一个层级，禁止跨越式发展（初见即死忠、一面之缘即深情）
3. **情绪用场景传达**：环境烘托（暴雨中独坐）+ 微动作（攥拳指尖发白）替代直白抒情
4. **情感与题材匹配**：末世侧重"共患难的信任"、悬疑侧重"试探与默契"、玄幻侧重"利益捆绑到真正认可"
5. **禁止标签化互动**：不可突然称兄道弟、莫名深情告白，每次称呼变化都需要事件支撑`;
}

// ---------------------------------------------------------------------------
// 代入感具体技法
// ---------------------------------------------------------------------------

function buildImmersionTechniques(): string {
  return `## 代入感技法

- **自然信息交代**：角色身份/外貌/背景通过行动和对话带出，禁止"资料卡式"直接罗列
- **画面代入法**：开场先给画面（动作、环境、声音），再给信息，让读者"看到"而非"被告知"
- **共鸣锚点**：主角的困境必须有普遍性（被欺压、不公待遇、被低估），让读者觉得"这也是我"
- **欲望钩子**：每章至少让读者产生一个"接下来会怎样"的好奇心
- **信息落差应用**：让读者比角色多知道一点（紧张感）或少知道一点（好奇心），动态切换`;
}

// ---------------------------------------------------------------------------
// 黄金三章（前3章特殊指令）
// ---------------------------------------------------------------------------

function buildGoldenChaptersRules(chapterNumber?: number): string {
  if (chapterNumber === undefined || chapterNumber > 3) return "";

  const chapterRules: Record<number, string> = {
    1: `### 第一章：抛出核心冲突
- 开篇直接进入冲突场景，禁止用背景介绍/世界观设定开头
- 第一段必须有动作或对话，让读者"看到"画面
- 开篇场景限制：最多1-2个场景，最多3个角色
- 主角身份/外貌/背景通过行动自然带出，禁止资料卡式罗列
- 本章结束前，核心矛盾必须浮出水面
- 一句对话能交代的信息不要用一段叙述，角色身份、性格、地位都可以从一句有特色的台词中带出`,

    2: `### 第二章：展现金手指/核心能力
- 主角的核心优势（金手指/特殊能力/信息差等）必须在本章初现
- 金手指的展现必须通过具体事件，不能只是内心独白"我获得了XX"
- 开始建立"主角有什么不同"的读者认知
- 第一个小爽点应在本章出现
- 继续收紧核心冲突，不引入新支线`,

    3: `### 第三章：明确短期目标
- 主角的第一个阶段性目标必须在本章确立
- 目标必须具体可衡量（打败某人/获得某物/到达某处），不能是抽象的"变强"
- 读完本章，读者应能说出"接下来主角要干什么"
- 章尾钩子要足够强，这是读者决定是否继续追读的关键章`,
  };

  return `## 黄金三章特殊指令（当前第${chapterNumber}章）

开篇三章决定读者是否追读。遵循以下强制规则：

- 开篇不要从第一块砖头开始砌楼——从炸了一栋楼开始写
- 禁止信息轰炸：世界观、力量体系等设定随剧情自然揭示
- 每章聚焦1条故事线，人物数量控制在3个以内
- 强情绪优先：利用读者共情（亲情纽带、不公待遇、被低估）快速建立代入感

${chapterRules[chapterNumber] ?? ""}`;
}

// ---------------------------------------------------------------------------
// Full cast tracking (conditional)
// ---------------------------------------------------------------------------

function buildFullCastTracking(): string {
  return `## 全员追踪

本书启用全员追踪模式。每章结束时，POST_SETTLEMENT 必须额外包含：
- 本章出场角色清单（名字 + 一句话状态变化）
- 角色间关系变动（如有）
- 未出场但被提及的角色（名字 + 提及原因）`;
}

// ---------------------------------------------------------------------------
// Genre-specific rules
// ---------------------------------------------------------------------------

function buildGenreRules(gp: GenreProfile, genreBody: string): string {
  const fatigueLine = gp.fatigueWords.length > 0
    ? `- 高疲劳词（${gp.fatigueWords.join("、")}）单章最多出现1次`
    : "";

  const chapterTypesLine = gp.chapterTypes.length > 0
    ? `动笔前先判断本章类型：\n${gp.chapterTypes.map(t => `- ${t}`).join("\n")}`
    : "";

  const pacingLine = gp.pacingRule
    ? `- 节奏规则：${gp.pacingRule}`
    : "";

  return [
    `## 题材规范（${gp.name}）`,
    fatigueLine,
    pacingLine,
    chapterTypesLine,
    genreBody,
  ].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Protagonist rules from book_rules
// ---------------------------------------------------------------------------

function buildProtagonistRules(bookRules: BookRules | null): string {
  if (!bookRules?.protagonist) return "";

  const p = bookRules.protagonist;
  const lines = [`## 主角铁律（${p.name}）`];

  if (p.personalityLock.length > 0) {
    lines.push(`\n性格锁定：${p.personalityLock.join("、")}`);
  }
  if (p.behavioralConstraints.length > 0) {
    lines.push("\n行为约束：");
    for (const c of p.behavioralConstraints) {
      lines.push(`- ${c}`);
    }
  }

  if (bookRules.prohibitions.length > 0) {
    lines.push("\n本书禁忌：");
    for (const p of bookRules.prohibitions) {
      lines.push(`- ${p}`);
    }
  }

  if (bookRules.genreLock?.forbidden && bookRules.genreLock.forbidden.length > 0) {
    lines.push(`\n风格禁区：禁止出现${bookRules.genreLock.forbidden.join("、")}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Book rules body (user-written markdown)
// ---------------------------------------------------------------------------

function buildBookRulesBody(body: string): string {
  if (!body) return "";
  return `## 本书专属规则\n\n${body}`;
}

// ---------------------------------------------------------------------------
// Style guide
// ---------------------------------------------------------------------------

function buildStyleGuide(styleGuide: string): string {
  if (!styleGuide || styleGuide === "(文件尚未创建)") return "";
  return `## 文风指南\n\n${styleGuide}`;
}

// ---------------------------------------------------------------------------
// Style fingerprint (Phase 9: C3)
// ---------------------------------------------------------------------------

function buildStyleFingerprint(fingerprint?: string): string {
  if (!fingerprint) return "";
  return `## 文风指纹（模仿目标）

以下是从参考文本中提取的写作风格特征。你的输出必须尽量贴合这些特征：

${fingerprint}`;
}

// ---------------------------------------------------------------------------
// Pre-write checklist
// ---------------------------------------------------------------------------

function buildPreWriteChecklist(book: BookConfig, gp: GenreProfile): string {
  let idx = 1;
  const lines = [
    "## 动笔前必须自问",
    "",
    `${idx++}. 【大纲锚定】本章对应卷纲中的哪个节点/阶段？本章必须推进该节点的剧情，不得跳过或提前消耗后续节点。如果卷纲指定了章节范围，严格遵守节奏。`,
    `${idx++}. 主角此刻利益最大化的选择是什么？`,
    `${idx++}. 这场冲突是谁先动手，为什么非做不可？`,
    `${idx++}. 配角/反派是否有明确诉求、恐惧和反制？行为是否由"过往经历+当前利益+性格底色"驱动？`,
    `${idx++}. 反派当前掌握了哪些已知信息？哪些信息只有读者知道？有无信息越界？`,
    `${idx++}. 章尾是否留了钩子（悬念/伏笔/冲突升级）？`,
  ];

  if (gp.numericalSystem) {
    lines.push(`${idx++}. 本章收益能否落到具体资源、数值增量、地位变化或已回收伏笔？`);
  }

  // 17雷点精华预防
  lines.push(
    `${idx++}. 【流水账检查】本章是否有无冲突的日常流水叙述？如有，加入前因后果或强情绪改造`,
    `${idx++}. 【主线偏离检查】本章是否推进了主线目标？支线是否在2-3章内与核心目标关联？`,
    `${idx++}. 【爽点节奏检查】最近3-5章内是否有小爽点落地？读者的"情绪缺口"是否在积累或释放？`,
    `${idx++}. 【人设崩塌检查】角色行为是否与已建立的性格标签一致？有无无铺垫的突然转变？`,
    `${idx++}. 【视角检查】本章视角是否清晰？同场景内说话人物是否控制在3人以内？`,
    `${idx++}. 如果任何问题答不上来，先补逻辑链，再写正文`,
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Creative-only output format (no settlement blocks)
// ---------------------------------------------------------------------------

function buildCreativeOutputFormat(book: BookConfig, gp: GenreProfile, lengthSpec: LengthSpec): string {
  const resourceRow = gp.numericalSystem
    ? "| 当前资源总量 | X | 与账本一致 |\n| 本章预计增量 | +X（来源） | 无增量写+0 |"
    : "";

  const preWriteTable = `=== PRE_WRITE_CHECK ===
（必须输出Markdown表格）
| 检查项 | 本章记录 | 备注 |
|--------|----------|------|
| 大纲锚定 | 当前卷名/阶段 + 本章应推进的具体节点 | 严禁跳过节点或提前消耗后续剧情 |
| 上下文范围 | 第X章至第Y章 / 状态卡 / 设定文件 | |
| 当前锚点 | 地点 / 对手 / 收益目标 | 锚点必须具体 |
${resourceRow}| 待回收伏笔 | 用真实 hook_id 填写（无则写 none） | 与伏笔池一致 |
| 本章冲突 | 一句话概括 | |
| 章节类型 | ${gp.chapterTypes.join("/")} | |
| 风险扫描 | OOC/信息越界/设定冲突${gp.powerScaling ? "/战力崩坏" : ""}/节奏/词汇疲劳 | |`;

  return `## 输出格式（严格遵守）

${preWriteTable}

=== CHAPTER_TITLE ===
(章节标题，不含"第X章"。标题必须与已有章节标题不同，不要重复使用相同或相似的标题；若提供了 recent title history 或高频标题词，必须主动避开重复词根和高频意象)

=== CHAPTER_CONTENT ===
(正文内容，目标${lengthSpec.target}字，允许区间${lengthSpec.softMin}-${lengthSpec.softMax}字)

【重要】本次只需输出以上三个区块（PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT）。
状态卡、伏笔池、摘要等追踪文件将由后续结算阶段处理，请勿输出。`;
}

// ---------------------------------------------------------------------------
// Output format
// ---------------------------------------------------------------------------

function buildOutputFormat(book: BookConfig, gp: GenreProfile, lengthSpec: LengthSpec): string {
  const resourceRow = gp.numericalSystem
    ? "| 当前资源总量 | X | 与账本一致 |\n| 本章预计增量 | +X（来源） | 无增量写+0 |"
    : "";

  const preWriteTable = `=== PRE_WRITE_CHECK ===
（必须输出Markdown表格）
| 检查项 | 本章记录 | 备注 |
|--------|----------|------|
| 大纲锚定 | 当前卷名/阶段 + 本章应推进的具体节点 | 严禁跳过节点或提前消耗后续剧情 |
| 上下文范围 | 第X章至第Y章 / 状态卡 / 设定文件 | |
| 当前锚点 | 地点 / 对手 / 收益目标 | 锚点必须具体 |
${resourceRow}| 待回收伏笔 | 用真实 hook_id 填写（无则写 none） | 与伏笔池一致 |
| 本章冲突 | 一句话概括 | |
| 章节类型 | ${gp.chapterTypes.join("/")} | |
| 风险扫描 | OOC/信息越界/设定冲突${gp.powerScaling ? "/战力崩坏" : ""}/节奏/词汇疲劳 | |`;

  const postSettlement = gp.numericalSystem
    ? `=== POST_SETTLEMENT ===
（如有数值变动，必须输出Markdown表格）
| 结算项 | 本章记录 | 备注 |
|--------|----------|------|
| 资源账本 | 期初X / 增量+Y / 期末Z | 无增量写+0 |
| 重要资源 | 资源名 -> 贡献+Y（依据） | 无写"无" |
| 伏笔变动 | 新增/回收/延后 Hook | 同步更新伏笔池 |`
    : `=== POST_SETTLEMENT ===
（如有伏笔变动，必须输出）
| 结算项 | 本章记录 | 备注 |
|--------|----------|------|
| 伏笔变动 | 新增/回收/延后 Hook | 同步更新伏笔池 |`;

  const updatedLedger = gp.numericalSystem
    ? `\n=== UPDATED_LEDGER ===\n(更新后的完整资源账本，Markdown表格格式)`
    : "";

  return `## 输出格式（严格遵守）

${preWriteTable}

=== CHAPTER_TITLE ===
(章节标题，不含"第X章"。标题必须与已有章节标题不同，不要重复使用相同或相似的标题；若提供了 recent title history 或高频标题词，必须主动避开重复词根和高频意象)

=== CHAPTER_CONTENT ===
(正文内容，目标${lengthSpec.target}字，允许区间${lengthSpec.softMin}-${lengthSpec.softMax}字)

${postSettlement}

=== UPDATED_STATE ===
(更新后的完整状态卡，Markdown表格格式)
${updatedLedger}
=== UPDATED_HOOKS ===
(更新后的完整伏笔池，Markdown表格格式)

=== CHAPTER_SUMMARY ===
(本章摘要，Markdown表格格式，必须包含以下列)
| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |
|------|------|----------|----------|----------|----------|----------|----------|
| N | 本章标题 | 角色1,角色2 | 一句话概括 | 关键变化 | H01埋设/H02推进 | 情绪走向 | ${gp.chapterTypes.length > 0 ? gp.chapterTypes.join("/") : "过渡/冲突/高潮/收束"} |

=== UPDATED_SUBPLOTS ===
(更新后的完整支线进度板，Markdown表格格式)
| 支线ID | 支线名 | 相关角色 | 起始章 | 最近活跃章 | 距今章数 | 状态 | 进度概述 | 回收ETA |
|--------|--------|----------|--------|------------|----------|------|----------|---------|

=== UPDATED_EMOTIONAL_ARCS ===
(更新后的完整情感弧线，Markdown表格格式)
| 角色 | 章节 | 情绪状态 | 触发事件 | 强度(1-10) | 弧线方向 |
|------|------|----------|----------|------------|----------|

=== UPDATED_CHARACTER_MATRIX ===
(更新后的角色交互矩阵，分三个子表)

### 角色档案
| 角色 | 核心标签 | 反差细节 | 说话风格 | 性格底色 | 与主角关系 | 核心动机 | 当前目标 |
|------|----------|----------|----------|----------|------------|----------|----------|

### 相遇记录
| 角色A | 角色B | 首次相遇章 | 最近交互章 | 关系性质 | 关系变化 |
|-------|-------|------------|------------|----------|----------|

### 信息边界
| 角色 | 已知信息 | 未知信息 | 信息来源章 |
|------|----------|----------|------------|`;
}
