import { BaseAgent } from "./base.js";
import type { BookConfig, FanficMode } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { resolveWritingLanguage, type WritingLanguage } from "../models/language.js";
import { readGenreProfile } from "./rules-reader.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { renderHookSnapshot } from "../utils/memory-retrieval.js";

export interface ArchitectOutput {
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
  readonly currentState: string;
  readonly pendingHooks: string;
}

export class ArchitectAgent extends BaseAgent {
  get name(): string {
    return "architect";
  }

  async generateFoundation(
    book: BookConfig,
    externalContext?: string,
    reviewFeedback?: string,
  ): Promise<ArchitectOutput> {
    const { profile: gp, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const resolvedLanguage = resolveWritingLanguage(book.language ?? gp.language);

    const contextBlock = externalContext
      ? resolvedLanguage === "en"
        ? `\n\n## External Instructions\nIntegrate the following instructions into the foundation.\n\n${externalContext}\n`
        : resolvedLanguage === "ko"
          ? `\n\n## 외부 지시\n다음 창작 지시를 기반 설정에 자연스럽게 반영하세요.\n\n${externalContext}\n`
          : `\n\n## 外部指令\n以下是来自外部系统的创作指令，请将其融入设定中：\n\n${externalContext}\n`
      : "";
    const reviewFeedbackBlock = this.buildReviewFeedbackBlock(reviewFeedback, resolvedLanguage);

    const numericalBlock = gp.numericalSystem
      ? resolvedLanguage === "en"
        ? `- The story uses a trackable numerical/resource system
- Define numericalSystemOverrides in book_rules (hardCap, resourceTypes)`
        : resolvedLanguage === "ko"
          ? `- 추적 가능한 수치/자원 체계를 설계한다
- book_rules에 numericalSystemOverrides(hardCap, resourceTypes)를 명시한다`
          : `- 有明确的数值/资源体系可追踪
- 在 book_rules 中定义 numericalSystemOverrides（hardCap、resourceTypes）`
      : resolvedLanguage === "en"
        ? "- This genre has no explicit numerical system and does not need a resource ledger"
        : resolvedLanguage === "ko"
          ? "- 이 장르는 별도의 수치 시스템이 없으므로 자원 장부가 필요 없다"
          : "- 本题材无数值系统，不需要资源账本";

    const powerBlock = gp.powerScaling
      ? resolvedLanguage === "en"
        ? "- The story has an explicit power-scaling ladder"
        : resolvedLanguage === "ko"
          ? "- 명확한 전투력 단계 체계를 갖춘다"
          : "- 有明确的战力等级体系"
      : "";

    const eraBlock = gp.eraResearch
      ? resolvedLanguage === "en"
        ? "- The story needs era/historical grounding (set eraConstraints in book_rules)"
        : resolvedLanguage === "ko"
          ? "- 시대/역사 고증이 필요하며, book_rules에 eraConstraints를 설정한다"
          : "- 需要年代考据支撑（在 book_rules 中设置 eraConstraints）"
      : "";

    const storyBiblePrompt = resolvedLanguage === "en"
      ? `Use structured second-level headings:
## 01_Worldview
World setting, historical-social frame, and core rules

## 02_Protagonist
Protagonist setup (identity / advantage / personality core / behavioral boundaries)

## 03_Factions_and_Characters
Major factions and important supporting characters (for each: name, identity, motivation, relationship to protagonist, independent goal)

## 04_Geography_and_Environment
Map / scene design and environmental traits

## 05_Title_and_Blurb
Title method:
- Keep the title clear, direct, and easy to understand
- Use a format that immediately signals genre and core appeal
- Avoid overly literary or misleading titles

Blurb method (within 300 words, choose one):
1. Open with conflict, then reveal the hook, then leave suspense
2. Summarize only the main line and keep a clear suspense gap
3. Use a miniature scene that captures the book's strongest pull

Core blurb principle:
- The blurb is product copy that must make readers want to click`
      : resolvedLanguage === "ko"
        ? `구조화된 2단계 제목으로 작성하세요:
## 01_세계관
세계관 설정, 역사/사회 프레임, 핵심 규칙

## 02_주인공
주인공 설정 (정체성 / 강점 / 성격 핵심 / 행동 경계)

## 03_세력과_인물
주요 세력과 핵심 조연 (각 인물마다 이름, 정체성, 동기, 주인공과의 관계, 독립 목표)

## 04_지리와_환경
지도/장면 설계와 환경 특성

## 05_제목과_소개
제목 원칙:
- 제목은 직관적이고 이해하기 쉬워야 한다
- 장르와 핵심 매력을 바로 전달하는 형식을 쓴다
- 과도하게 문예적이거나 실제 장르와 어긋난 제목은 피한다

소개글 원칙 (300단어 이내, 한 가지 선택):
1. 갈등으로 시작하고, 핵심 훅을 드러낸 뒤, 궁금증을 남긴다
2. 메인 라인만 압축하고, 분명한 궁금증을 남긴다
3. 작품의 가장 강한 장면을 미니 씬처럼 제시한다

핵심 원칙:
- 소개글은 독자가 바로 눌러 보고 싶게 만드는 작품 소개문이어야 한다`
      : `用结构化二级标题组织：
## 01_世界观
世界观设定、核心规则体系

## 02_主角
主角设定（身份/金手指/性格底色/行为边界）

## 03_势力与人物
势力分布、重要配角（每人：名字、身份、动机、与主角关系、独立目标）

## 04_地理与环境
地图/场景设定、环境特色

## 05_书名与简介
书名方法论：
- 书名必须简单扼要、通俗易懂，读者看到书名就能知道题材和主题
- 采用"题材+核心爽点+主角行为"的长书名格式，避免文艺化
- 融入平台当下热点词汇，吸引精准流量
- 禁止题材错位（都市文取玄幻书名会导致读者流失）
- 参考热榜书名风格：俏皮、通俗、有记忆点

简介方法论（300字内，三种写法任选其一）：
1. 冲突开篇法：第一句抛困境/冲突，第二句亮金手指/核心能力，第三句留悬念
2. 高度概括法：只挑主线概括（不是全篇概括），必须留悬念
3. 小剧场法：提炼故事中最经典的桥段，作为引子

简介核心原则：
- 简介 = 产品宣传语，必须让读者产生"我要点开看"的冲动
- 可以从剧情设定、人设、或某个精彩片段切入
- 必须有噱头（如"凡是被写在笔记本上的名字，最后都得死"）`;

    const volumeOutlinePrompt = resolvedLanguage === "en"
      ? `Volume plan. For each volume include: title, chapter range, core conflict, key turning points, and payoff goal

### Golden First Three Chapters Rule
- Chapter 1: throw the core conflict immediately; no large background dump
- Chapter 2: show the core edge / ability / leverage that answers Chapter 1's pressure
- Chapter 3: establish the first concrete short-term goal that gives readers a reason to continue`
      : resolvedLanguage === "ko"
        ? `권별 기획을 작성하세요. 각 권마다 다음을 포함합니다: 권 제목, 화수 범위, 핵심 갈등, 주요 전환점, 회수 목표.
각 주요 전환점은 인물의 욕망과 방해가 부딪히는 장면 단위로 적고, 그 장면 뒤에 달라지는 상태나 관계를 함께 명시하세요

### 초반 3화 설계 원칙
- 1화는 충돌: 핵심 갈등을 즉시 던지고, 긴 배경 설명은 미루세요
- 2화는 보상/레버리지: 1화의 압박에 대한 답으로 주인공의 핵심 강점, 능력, 관계상 이득, 새 선택지를 보여주세요
- 3화는 단기 목표와 시리즈를 계속 팔로우할 이유: 첫 번째 구체적 단기 목표를 세우고, 이후 여러 화를 따라갈 약속을 남기세요
- 초반 3화는 호기심, 능력/보상, 시리즈 약속이 서로 다른 추적 이유로 남아야 합니다`
      : `卷纲规划，每卷包含：卷名、章节范围、核心冲突、关键转折、收益目标

### 黄金三章法则（前三章必须遵循）
- 第1章：抛出核心冲突（主角立即面临困境/危机/选择），禁止大段背景灌输
- 第2章：展示金手指/核心能力（主角如何应对第1章的困境），让读者看到爽点预期
- 第3章：明确短期目标（主角确立第一个具体可达成的目标），给读者追读理由`;

    const bookRulesPrompt = resolvedLanguage === "en"
      ? `Generate book_rules.md as YAML frontmatter plus narrative guidance:
\`\`\`
---
version: "1.0"
protagonist:
  name: (protagonist name)
  personalityLock: [(3-5 personality keywords)]
  behavioralConstraints: [(3-5 behavioral constraints)]
genreLock:
  primary: ${book.genre}
  forbidden: [(2-3 forbidden style intrusions)]
${gp.numericalSystem ? `numericalSystemOverrides:
  hardCap: (decide from the setting)
  resourceTypes: [(core resource types)]` : ""}
prohibitions:
  - (3-5 book-specific prohibitions)
chapterTypesOverride: []
fatigueWordsOverride: []
additionalAuditDimensions: []
enableFullCastTracking: false
---

## Narrative Perspective
(Describe the narrative perspective and style)

## Core Conflict Driver
(Describe the book's core conflict and propulsion)
\`\`\``
      : resolvedLanguage === "ko"
        ? `book_rules.md용 YAML 프런트매터와 서사 지침을 작성하세요:
\`\`\`
---
version: "1.0"
protagonist:
  name: (주인공 이름)
  personalityLock: [(성격 키워드 3-5개)]
  behavioralConstraints: [(행동 제약 3-5개)]
genreLock:
  primary: ${book.genre}
  forbidden: [(섞이면 안 되는 문체/전개 2-3개)]
${gp.numericalSystem ? `numericalSystemOverrides:
  hardCap: (설정에 맞게 결정)
  resourceTypes: [(핵심 자원 유형 목록)]` : ""}
prohibitions:
  - (이 작품에 특화된 금기 3-5개)
chapterTypesOverride: []
fatigueWordsOverride: []
additionalAuditDimensions: []
enableFullCastTracking: false
---

## 서사 시점
(이 작품의 시점 운용, 정보 경계, 문체 방향)

## 핵심 갈등 구동력
(이 작품을 앞으로 밀고 가는 핵심 갈등과 추진력)
\`\`\``
      : `生成 book_rules.md 格式的 YAML frontmatter + 叙事指导，包含：
\`\`\`
---
version: "1.0"
protagonist:
  name: (主角名)
  personalityLock: [(3-5个性格关键词)]
  behavioralConstraints: [(3-5条行为约束)]
genreLock:
  primary: ${book.genre}
  forbidden: [(2-3种禁止混入的文风)]
${gp.numericalSystem ? `numericalSystemOverrides:
  hardCap: (根据设定确定)
  resourceTypes: [(核心资源类型列表)]` : ""}
prohibitions:
  - (3-5条本书禁忌)
chapterTypesOverride: []
fatigueWordsOverride: []
additionalAuditDimensions: []
enableFullCastTracking: false
---

## 叙事视角
(描述本书叙事视角和风格)

## 核心冲突驱动
(描述本书的核心矛盾和驱动力)
\`\`\``;

    const currentStatePrompt = resolvedLanguage === "en"
      ? `Initial state card (Chapter 0), include:
| Field | Value |
| --- | --- |
| Current Chapter | 0 |
| Current Location | (starting location) |
| Protagonist State | (initial condition) |
| Current Goal | (first goal) |
| Current Constraint | (initial constraint) |
| Current Alliances | (initial relationships) |
| Current Conflict | (first conflict) |`
      : resolvedLanguage === "ko"
        ? `초기 상태 카드(0화 시점)를 작성하세요:
| 항목 | 값 |
| --- | --- |
| 현재 화 | 0 |
| 현재 위치 | (시작 지점) |
| 주인공 상태 | (초기 상태) |
| 현재 목표 | (첫 번째 목표) |
| 현재 제약 | (초기 제약) |
| 현재 관계 구도 | (초기 협력/대립 관계) |
| 현재 갈등 | (첫 번째 갈등) |`
      : `初始状态卡（第0章），包含：
| 字段 | 值 |
|------|-----|
| 当前章节 | 0 |
| 当前位置 | (起始地点) |
| 主角状态 | (初始状态) |
| 当前目标 | (第一个目标) |
| 当前限制 | (初始限制) |
| 当前敌我 | (初始关系) |
| 当前冲突 | (第一个冲突) |`;

    const pendingHooksPrompt = resolvedLanguage === "en"
      ? `Initial hook pool (Markdown table):
| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | payoff_timing | notes |

Rules for the hook table:
- Column 5 must be a pure chapter number, never natural-language description
- During book creation, all planned hooks are still unapplied, so last_advanced_chapter = 0
- Column 7 must be one of: immediate / near-term / mid-arc / slow-burn / endgame
- If you want to describe the initial clue/signal, put it in notes instead of column 5`
      : resolvedLanguage === "ko"
        ? `초기 떡밥 풀을 Markdown 표로 작성하세요:
| hook_id | 시작 화수 | 유형 | 상태 | 최근 진전 | 예상 회수 | 회수 템포 | 비고 |

떡밥 표 규칙:
- 5번째 열은 자연어 설명이 아니라 순수한 숫자 화수만 적습니다
- 책 생성 단계에서는 모든 떡밥이 아직 본격적으로 진행되지 않았으므로 5번째 열은 모두 0입니다
- 7번째 열은 반드시 다음 중 하나를 사용합니다: 즉시 / 단기 / 중기 / 장기 / 종결
- 초기 단서나 첫 신호를 설명하고 싶다면 5번째 열이 아니라 비고에 적습니다`
      : `初始伏笔池（Markdown表格）：
| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 备注 |

伏笔表规则：
- 第5列必须是纯数字章节号，不能写自然语言描述
- 建书阶段所有伏笔都还没正式推进，所以第5列统一填 0
- 第7列必须填写：立即 / 近期 / 中程 / 慢烧 / 终局 之一
- 如果要说明“初始线索/最初信号”，写进备注，不要写进第5列`;

    const finalRequirementsPrompt = resolvedLanguage === "en"
      ? `Generated content must:
1. Fit the ${book.platform} platform taste
2. Fit the ${gp.name} genre traits
${numericalBlock}
${powerBlock}
${eraBlock}
3. Give the protagonist a clear personality and behavioral boundaries
4. Keep hooks and payoffs coherent
5. Make supporting characters independently motivated rather than pure tools`
      : resolvedLanguage === "ko"
        ? `생성 내용은 다음을 만족해야 합니다:
1. ${book.platform} 플랫폼 감각에 맞을 것
2. ${gp.name} 장르 특성을 살릴 것
${numericalBlock}
${powerBlock}
${eraBlock}
3. 주인공의 성격과 행동 경계를 분명하게 보여줄 것
4. 떡밥과 회수가 앞뒤로 맞물릴 것
5. 조연도 도구가 아니라 독립 동기와 계산을 가진 인물로 설계할 것`
      : `生成内容必须：
1. 符合${book.platform}平台口味
2. 符合${gp.name}题材特征
${numericalBlock}
${powerBlock}
${eraBlock}
3. 主角人设鲜明，有明确行为边界
4. 伏笔前后呼应，不留悬空线
5. 配角有独立动机，不是工具人`;

    const systemPrompt = resolvedLanguage === "en"
      ? `You are a professional web-fiction architect. Your task is to generate a complete foundation for a new ${gp.name} novel.${contextBlock}${reviewFeedbackBlock}

Requirements:
- Platform: ${book.platform}
- Genre: ${gp.name} (${book.genre})
- Target Chapters: ${book.targetChapters}
- Chapter Target Length: ${book.chapterWordCount}

## Genre Traits

${genreBody}

## Output Contract

Generate the following sections. Separate every section with === SECTION: <name> ===:

=== SECTION: story_bible ===
${storyBiblePrompt}

=== SECTION: volume_outline ===
${volumeOutlinePrompt}

=== SECTION: book_rules ===
${bookRulesPrompt}

=== SECTION: current_state ===
${currentStatePrompt}

=== SECTION: pending_hooks ===
${pendingHooksPrompt}

${finalRequirementsPrompt}`
      : resolvedLanguage === "ko"
        ? `당신은 전문 웹소설 아키텍트입니다. 새로운 ${gp.name} 소설을 위한 완전한 기반 설정을 설계하세요.${contextBlock}${reviewFeedbackBlock}

요구사항:
- 플랫폼: ${book.platform}
- 장르: ${gp.name} (${book.genre})
- 목표 화수: ${book.targetChapters}화
- 화당 목표 분량: ${book.chapterWordCount}자

## 장르 특성

${genreBody}

## 출력 계약

아래 섹션을 생성하고, 각 섹션은 === SECTION: <name> === 로 구분하세요:

=== SECTION: story_bible ===
${storyBiblePrompt}

=== SECTION: volume_outline ===
${volumeOutlinePrompt}

=== SECTION: book_rules ===
${bookRulesPrompt}

=== SECTION: current_state ===
${currentStatePrompt}

=== SECTION: pending_hooks ===
${pendingHooksPrompt}

${finalRequirementsPrompt}`
        : `你是一个专业的网络小说架构师。你的任务是为一本新的${gp.name}小说生成完整的基础设定。${contextBlock}${reviewFeedbackBlock}

要求：
- 平台：${book.platform}
- 题材：${gp.name}（${book.genre}）
- 目标章数：${book.targetChapters}章
- 每章字数：${book.chapterWordCount}字

## 题材特征

${genreBody}

## 生成要求

你需要生成以下内容，每个部分用 === SECTION: <name> === 分隔：

=== SECTION: story_bible ===
${storyBiblePrompt}

=== SECTION: volume_outline ===
${volumeOutlinePrompt}

=== SECTION: book_rules ===
${bookRulesPrompt}

=== SECTION: current_state ===
${currentStatePrompt}

=== SECTION: pending_hooks ===
${pendingHooksPrompt}

${finalRequirementsPrompt}`;

    const langPrefix = resolvedLanguage === "en"
      ? `【LANGUAGE OVERRIDE】ALL output (story_bible, volume_outline, book_rules, current_state, pending_hooks) MUST be written in English. Character names, place names, and all prose must be in English. The === SECTION: === tags remain unchanged.\n\n`
      : resolvedLanguage === "ko"
        ? `【LANGUAGE OVERRIDE】ALL output (story_bible, volume_outline, book_rules, current_state, pending_hooks) MUST be written in Korean. Use Korean headings, Korean table headers, and Korean explanatory prose throughout. Keep the === SECTION: === tags unchanged.\n\n`
        : "";
    const userMessage = resolvedLanguage === "en"
      ? `Generate the complete foundation for a ${gp.name} novel titled "${book.title}". Write everything in English.`
      : resolvedLanguage === "ko"
        ? `"${book.title}"라는 제목의 ${gp.name} 소설을 위한 전체 기반 설정을 생성하세요. 모든 출력은 한국어로 작성하세요.`
      : `请为标题为"${book.title}"的${gp.name}小说生成完整基础设定。`;

    const response = await this.chat([
      { role: "system", content: langPrefix + systemPrompt },
      { role: "user", content: userMessage },
    ], { maxTokens: 16384, temperature: 0.8 });

    return this.parseSections(response.content);
  }

  async writeFoundationFiles(
    bookDir: string,
    output: ArchitectOutput,
    numericalSystem: boolean = true,
    language: WritingLanguage = "ko",
  ): Promise<void> {
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    const writes: Array<Promise<void>> = [
      writeFile(join(storyDir, "story_bible.md"), output.storyBible, "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), output.volumeOutline, "utf-8"),
      writeFile(join(storyDir, "book_rules.md"), output.bookRules, "utf-8"),
      writeFile(join(storyDir, "current_state.md"), output.currentState, "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), output.pendingHooks, "utf-8"),
    ];

    if (numericalSystem) {
      writes.push(
        writeFile(
          join(storyDir, "particle_ledger.md"),
          this.renderParticleLedgerTemplate(language),
          "utf-8",
        ),
      );
    }

    // Initialize new truth files
    writes.push(
      writeFile(
        join(storyDir, "subplot_board.md"),
        this.renderSubplotBoardTemplate(language),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "emotional_arcs.md"),
        this.renderEmotionalArcsTemplate(language),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "character_matrix.md"),
        this.renderCharacterMatrixTemplate(language),
        "utf-8",
      ),
    );

    await Promise.all(writes);
  }

  private renderParticleLedgerTemplate(language: WritingLanguage): string {
    if (language === "en") {
      return "# Resource Ledger\n\n| Chapter | Opening Value | Source | Integrity | Delta | Closing Value | Evidence |\n| --- | --- | --- | --- | --- | --- | --- |\n| 0 | 0 | Initialization | - | 0 | 0 | Initial book state |\n";
    }

    if (language === "ko") {
      return "# 자원 장부\n\n| 회차 | 기초 수치 | 출처 | 완성도 | 증가분 | 마무리 수치 | 근거 |\n|---|---|---|---|---|---|---|\n| 0 | 0 | 초반 설정 | - | 0 | 0 | 초기 책 상태 |\n";
    }

    return "# 资源账本\n\n| 章节 | 期初值 | 来源 | 完整度 | 增量 | 期末值 | 依据 |\n|------|--------|------|--------|------|--------|------|\n| 0 | 0 | 初始化 | - | 0 | 0 | 开书初始 |\n";
  }

  private renderSubplotBoardTemplate(language: WritingLanguage): string {
    if (language === "en") {
      return "# Subplot Board\n\n| Subplot ID | Subplot | Related Characters | Start Chapter | Last Active Chapter | Chapters Since | Status | Progress Summary | Payoff ETA |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n";
    }

    if (language === "ko") {
      return "# 서브플롯 보드\n\n| 서브플롯 ID | 서브플롯 | 관련 인물 | 시작 화 | 최근 활동 화 | 경과 화수 | 상태 | 진행 요약 | 회수 ETA |\n|-------|--------|----------|--------|------------|----------|------|----------|---------|\n";
    }

    return "# 支线进度板\n\n| 支线ID | 支线名 | 相关角色 | 起始章 | 最近活跃章 | 距今章数 | 状态 | 进度概述 | 回收ETA |\n|--------|--------|----------|--------|------------|----------|------|----------|---------|\n";
  }

  private renderEmotionalArcsTemplate(language: WritingLanguage): string {
    if (language === "en") {
      return "# Emotional Arcs\n\n| Character | Chapter | Emotional State | Trigger Event | Intensity (1-10) | Arc Direction |\n| --- | --- | --- | --- | --- | --- |\n";
    }

    if (language === "ko") {
      return "# 감정 곡선\n\n| 캐릭터 | 회차 | 감정 상태 | 촉발 사건 | 강도(1-10) | 곡선 방향 |\n|------|------|----------|----------|------------|----------|\n";
    }

    return "# 情感弧线\n\n| 角色 | 章节 | 情绪状态 | 触发事件 | 强度(1-10) | 弧线方向 |\n|------|------|----------|----------|------------|----------|\n";
  }

  private renderCharacterMatrixTemplate(language: WritingLanguage): string {
    if (language === "en") {
      return "# Character Matrix\n\n### Character Profiles\n| Character | Core Tags | Contrast Detail | Speech Style | Personality Core | Relationship to Protagonist | Core Motivation | Current Goal |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n\n### Encounter Log\n| Character A | Character B | First Meeting Chapter | Latest Interaction Chapter | Relationship Type | Relationship Change |\n| --- | --- | --- | --- | --- | --- |\n\n### Information Boundaries\n| Character | Known Information | Unknown Information | Source Chapter |\n| --- | --- | --- | --- |\n";
    }

    if (language === "ko") {
      return "# 캐릭터 상호작용 매트릭스\n\n### 캐릭터 프로필\n| 캐릭터 | 핵심 태그 | 대비 포인트 | 말투 | 성격 핵심 | 주인공과의 관계 | 핵심 동기 | 현재 목표 |\n|------|----------|----------|----------|----------|------------|----------|----------|\n\n### 만남 로그\n| 캐릭터 A | 캐릭터 B | 최초 만남 화 | 최근 상호작용 화 | 관계 성격 | 관계 변화 |\n|-------|-------|------------|------------|----------|----------|\n\n### 정보 경계\n| 캐릭터 | 확인된 정보 | 미확인 정보 | 정보 출처 화 |\n|------|----------|----------|------------|\n";
    }

    return "# 角色交互矩阵\n\n### 角色档案\n| 角色 | 核心标签 | 反差细节 | 说话风格 | 性格底色 | 与主角关系 | 核心动机 | 当前目标 |\n|------|----------|----------|----------|----------|------------|----------|----------|\n\n### 相遇记录\n| 角色A | 角色B | 首次相遇章 | 最近交互章 | 关系性质 | 关系变化 |\n|-------|-------|------------|------------|----------|----------|\n\n### 信息边界\n| 角色 | 已知信息 | 未知信息 | 信息来源章 |\n|------|----------|----------|------------|\n";
  }

  /**
   * Reverse-engineer foundation from existing chapters.
   * Reads all chapters as a single text block and asks LLM to extract story_bible,
   * volume_outline, book_rules, current_state, and pending_hooks.
   */
  async generateFoundationFromImport(
    book: BookConfig,
    chaptersText: string,
    externalContext?: string,
    reviewFeedback?: string,
    options?: { readonly importMode?: "continuation" | "series" },
  ): Promise<ArchitectOutput> {
    const { profile: gp, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const resolvedLanguage = resolveWritingLanguage(book.language ?? gp.language);
    const reviewFeedbackBlock = this.buildReviewFeedbackBlock(reviewFeedback, resolvedLanguage);

    const contextBlock = externalContext
      ? (resolvedLanguage === "en"
          ? `\n\n## External Instructions\n${externalContext}\n`
          : resolvedLanguage === "ko"
            ? `\n\n## 외부 지시\n${externalContext}\n`
          : `\n\n## 外部指令\n${externalContext}\n`)
      : "";

    const numericalBlock = gp.numericalSystem
      ? (resolvedLanguage === "en"
          ? `- The story uses a trackable numerical/resource system
- Define numericalSystemOverrides in book_rules (hardCap, resourceTypes)`
          : resolvedLanguage === "ko"
            ? `- 추적 가능한 수치/자원 체계를 정리한다
- book_rules에 numericalSystemOverrides(hardCap, resourceTypes)를 명시한다`
            : `- 有明确的数值/资源体系可追踪
- 在 book_rules 中定义 numericalSystemOverrides（hardCap、resourceTypes）`)
      : (resolvedLanguage === "en"
          ? "- This genre has no explicit numerical system and does not need a resource ledger"
          : resolvedLanguage === "ko"
            ? "- 이 장르는 별도의 수치 시스템이 없으므로 자원 장부가 필요 없다"
            : "- 本题材无数值系统，不需要资源账本");

    const powerBlock = gp.powerScaling
      ? (resolvedLanguage === "en"
          ? "- The story has an explicit power-scaling ladder"
          : resolvedLanguage === "ko"
            ? "- 명확한 전투력 단계 체계를 정리한다"
            : "- 有明确的战力等级体系")
      : "";

    const eraBlock = gp.eraResearch
      ? (resolvedLanguage === "en"
          ? "- The story needs era/historical grounding (set eraConstraints in book_rules)"
          : resolvedLanguage === "ko"
            ? "- 시대/역사 고증이 필요하며, book_rules에 eraConstraints를 설정한다"
            : "- 需要年代考据支撑（在 book_rules 中设置 eraConstraints）")
      : "";

    const storyBiblePrompt = resolvedLanguage === "en"
      ? `Extract from the source text and organize with structured second-level headings:
## 01_Worldview
Extracted world setting, core rules, and frame

## 02_Protagonist
Inferred protagonist setup (identity / advantage / personality core / behavioral boundaries)

## 03_Factions_and_Characters
Factions and important supporting characters that appear in the source text

## 04_Geography_and_Environment
Locations, environments, and scene traits drawn from the source text

## 05_Title_and_Blurb
Keep the original title "${book.title}" and generate a matching blurb from the source text`
      : resolvedLanguage === "ko"
        ? `본문에서 추출한 내용을 구조화된 2단계 제목으로 정리하세요:
## 01_세계관
본문에서 드러난 세계관, 핵심 규칙, 시대적 프레임

## 02_주인공
본문에서 추론한 주인공 설정 (정체성 / 강점 / 성격 핵심 / 행동 경계)

## 03_세력과_인물
본문에 등장한 세력과 핵심 조연

## 04_지리와_환경
본문에서 확인되는 장소, 환경, 장면 특성

## 05_제목과_소개
원래 제목 "${book.title}"을 유지하고, 본문에 맞는 소개글을 새로 작성하세요`
      : `从正文中提取，用结构化二级标题组织：
## 01_世界观
从正文中提取的世界观设定、核心规则体系

## 02_主角
从正文中推断的主角设定（身份/金手指/性格底色/行为边界）

## 03_势力与人物
从正文中出现的势力分布、重要配角（每人：名字、身份、动机、与主角关系、独立目标）

## 04_地理与环境
从正文中出现的地图/场景设定、环境特色

## 05_书名与简介
保留原书名"${book.title}"，根据正文内容生成简介`;

    const volumeOutlinePrompt = resolvedLanguage === "en"
      ? `Infer the volume plan from existing text:
- Existing chapters: review the actual structure already present
- Future projection: predict later directions from active hooks and plot momentum
For each volume include: title, chapter range, core conflict, and key turning points`
      : resolvedLanguage === "ko"
        ? `기존 본문에서 권별 기획을 역추론하세요:
- 이미 진행된 구간: 실제 본문 구조를 요약합니다
- 이후 전개 예측: 현재 살아 있는 떡밥과 추진력을 바탕으로 이후 방향을 예측합니다
각 권마다 권명, 화수 범위, 핵심 갈등, 주요 전환점을 포함하세요.
주요 전환점은 인물의 욕망과 방해가 부딪히는 장면 단위로 쓰고, 본문에 이미 명시된 전환과 이후 예측을 구분하세요`
      : `基于已有正文反推卷纲：
- 已有章节部分：根据实际内容回顾每卷的结构
- 后续预测部分：基于已有伏笔和剧情走向预测未来方向
每卷包含：卷名、章节范围、核心冲突、关键转折`;

    const bookRulesPrompt = resolvedLanguage === "en"
      ? `Infer book_rules.md as YAML frontmatter plus narrative guidance from character behavior in the source text:
\`\`\`
---
version: "1.0"
protagonist:
  name: (extract protagonist name from the text)
  personalityLock: [(infer 3-5 personality keywords from behavior)]
  behavioralConstraints: [(infer 3-5 behavioral constraints from behavior)]
genreLock:
  primary: ${book.genre}
  forbidden: [(2-3 forbidden style intrusions)]
${gp.numericalSystem ? `numericalSystemOverrides:
  hardCap: (infer from the text)
  resourceTypes: [(extract core resource types from the text)]` : ""}
prohibitions:
  - (infer 3-5 book-specific prohibitions from the text)
chapterTypesOverride: []
fatigueWordsOverride: []
additionalAuditDimensions: []
enableFullCastTracking: false
---

## Narrative Perspective
(Infer the narrative perspective and style from the text)

## Core Conflict Driver
(Infer the book's core conflict and propulsion from the text)
\`\`\``
      : resolvedLanguage === "ko"
        ? `본문 속 인물의 행동을 바탕으로 book_rules.md용 YAML 프런트매터와 서사 지침을 역추론하세요:
\`\`\`
---
version: "1.0"
protagonist:
  name: (본문에서 주인공 이름 추출)
  personalityLock: [(행동을 바탕으로 성격 키워드 3-5개 추론)]
  behavioralConstraints: [(행동을 바탕으로 행동 제약 3-5개 추론)]
genreLock:
  primary: ${book.genre}
  forbidden: [(섞이면 안 되는 문체/전개 2-3개)]
${gp.numericalSystem ? `numericalSystemOverrides:
  hardCap: (본문을 기준으로 추론)
  resourceTypes: [(본문에서 확인되는 핵심 자원 유형)]` : ""}
prohibitions:
  - (이 작품에 특화된 금기 3-5개를 본문에서 추론)
chapterTypesOverride: []
fatigueWordsOverride: []
additionalAuditDimensions: []
enableFullCastTracking: false
---

## 서사 시점
(본문에서 추론한 시점 운용, 정보 경계, 문체)

## 핵심 갈등 구동력
(본문에서 추론한 핵심 갈등과 추진력)
\`\`\``
      : `从正文中角色行为反推 book_rules.md 格式的 YAML frontmatter + 叙事指导：
\`\`\`
---
version: "1.0"
protagonist:
  name: (从正文提取主角名)
  personalityLock: [(从行为推断3-5个性格关键词)]
  behavioralConstraints: [(从行为推断3-5条行为约束)]
genreLock:
  primary: ${book.genre}
  forbidden: [(2-3种禁止混入的文风)]
${gp.numericalSystem ? `numericalSystemOverrides:
  hardCap: (从正文推断)
  resourceTypes: [(从正文提取核心资源类型)]` : ""}
prohibitions:
  - (从正文推断3-5条本书禁忌)
chapterTypesOverride: []
fatigueWordsOverride: []
additionalAuditDimensions: []
enableFullCastTracking: false
---

## 叙事视角
(从正文推断本书叙事视角和风格)

## 核心冲突驱动
(从正文推断本书的核心矛盾和驱动力)
\`\`\``;

    const currentStatePrompt = resolvedLanguage === "en"
      ? `Reflect the state at the end of the latest chapter:
| Field | Value |
| --- | --- |
| Current Chapter | (latest chapter number) |
| Current Location | (location at the end of the latest chapter) |
| Protagonist State | (state at the end of the latest chapter) |
| Current Goal | (current goal) |
| Current Constraint | (current constraint) |
| Current Alliances | (current alliances / opposition) |
| Current Conflict | (current conflict) |`
      : resolvedLanguage === "ko"
        ? `가장 최근 화가 끝난 시점의 상태 카드를 작성하세요:
| 항목 | 값 |
| --- | --- |
| 현재 화 | (최신 화 번호) |
| 현재 위치 | (최신 화 마지막 시점의 위치) |
| 주인공 상태 | (최신 화 마지막 시점의 상태) |
| 현재 목표 | (현재 목표) |
| 현재 제약 | (현재 제약) |
| 현재 관계 구도 | (현재 협력/대립 관계) |
| 현재 갈등 | (현재 갈등) |`
      : `反映最后一章结束时的状态卡：
| 字段 | 值 |
|------|-----|
| 当前章节 | (最后一章章节号) |
| 当前位置 | (最后一章结束时的位置) |
| 主角状态 | (最后一章结束时的状态) |
| 当前目标 | (当前目标) |
| 当前限制 | (当前限制) |
| 当前敌我 | (当前敌我关系) |
| 当前冲突 | (当前冲突) |`;

    const pendingHooksPrompt = resolvedLanguage === "en"
      ? `Identify all active hooks from the source text (Markdown table):
| hook_id | start_chapter | type | status | latest_progress | expected_payoff | payoff_timing | notes |`
      : resolvedLanguage === "ko"
        ? `본문에 남아 있는 모든 활성 떡밥을 Markdown 표로 정리하세요:
| hook_id | 시작 화수 | 유형 | 상태 | 최근 진전 | 예상 회수 | 회수 템포 | 비고 |`
      : `从正文中识别的所有伏笔（Markdown表格）：
| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 备注 |`;

    const keyPrinciplesPrompt = resolvedLanguage === "en"
      ? `## Key Principles

1. Derive everything from the source text; do not invent unsupported settings
2. Hook extraction must be complete: unresolved clues, hints, and foreshadowing all count
3. Character inference must come from dialogue and behavior, not assumption
4. Accuracy first; detailed is better than missing crucial information
${numericalBlock}
${powerBlock}
${eraBlock}`
      : resolvedLanguage === "ko"
        ? `## 핵심 원칙

1. 모든 내용은 본문에서 출발하고, 근거 없는 설정은 새로 만들지 않습니다
2. 떡밥 추출은 빠짐없이 진행합니다. 미회수 단서, 암시, 예고를 모두 포함합니다
3. 인물 추론은 대사와 행동에 근거하고, 임의 추정은 줄입니다
4. 정확성을 우선하며, 중요한 정보를 빼먹기보다 충분히 정리합니다
5. 본문에 명시된 사실과 추론한 내용을 구분하고, 추론은 근거 장면을 함께 적습니다
${numericalBlock}
${powerBlock}
${eraBlock}`
      : `## 关键原则

1. 一切从正文出发，不要臆造正文中没有的设定
2. 伏笔识别要完整：悬而未决的线索、暗示、预告都算
3. 角色推断要准确：从对话和行为推断性格，不要想当然
4. 准确性优先，宁可详细也不要遗漏
${numericalBlock}
${powerBlock}
${eraBlock}`;

    const isSeries = options?.importMode === "series";
    const continuationDirectiveEn = isSeries
      ? `## Continuation Direction Requirements (Critical)
The continuation portion (chapters in volume_outline that have not happened yet) must open up **new narrative space**:
1. **New conflict dimension**: Do not merely stretch the imported conflict longer. Introduce at least one new conflict vector not yet covered by the source text (new character, new faction, new location, or new time horizon)
2. **Ignite within 5 chapters**: The first continuation volume must establish a fresh suspense engine within 5 chapters. Do not spend 3 chapters recapping known information
3. **Scene freshness**: At least 50% of key continuation scenes must happen in locations or situations not already used in the imported chapters
4. **No repeated meeting rooms**: If the imported chapters end on a meeting/discussion beat, the continuation must restart from action instead of opening another meeting`
      : `## Continuation Direction
The volume_outline should naturally extend the existing narrative arc. Continue from where the imported chapters left off — advance existing conflicts, pay off planted hooks, and introduce new complications that arise organically from the current situation. Do not recap known information.`;
    const continuationDirectiveZh = isSeries
      ? `## 续写方向要求（关键）
续写部分（volume_outline 中尚未发生的章节）必须设计**新的叙事空间**：
1. **新冲突维度**：续写不能只是把导入章节的冲突继续拉长。必须引入至少一个原文未涉及的新冲突方向（新角色、新势力、新地点、新时间跨度）
2. **5章内引爆**：续写的第一卷必须在前5章内建立新悬念，不允许用3章回顾已知信息
3. **场景新鲜度**：续写部分至少50%的关键场景发生在导入章节未出现的地点或情境中
4. **不重复会议**：如果导入章节以会议/讨论结束，续写必须从行动开始，不能再开一轮会`
      : `## 续写方向
卷纲应自然延续已有叙事弧线。从导入章节的结尾处接续——推进现有冲突、兑现已埋伏笔、引入从当前局势中有机产生的新变数。不要回顾已知信息。`;
    const continuationDirectiveKo = isSeries
      ? `## 후속 전개 설계 원칙(중요)
volume_outline에서 아직 일어나지 않은 구간은 반드시 새로운 서사 공간을 열어야 합니다:
1. 새로운 갈등 축을 최소 하나 도입합니다. 이미 나온 갈등만 늘이지 말고, 새로운 인물/세력/장소/시간축 중 하나를 포함합니다
2. 첫 후속 권은 5화 안에 새로운 궁금증 엔진을 세웁니다. 이미 아는 내용을 3화 이상 반복하지 않습니다
3. 후속 핵심 장면의 절반 이상은 기존 본문에 나오지 않은 장소나 상황에서 벌어지게 합니다
4. 본문이 회의/토론으로 끝났다면 후속 전개는 행동으로 다시 시작합니다`
      : `## 후속 전개 방향
volume_outline는 기존 서사 곡선을 자연스럽게 잇되, 이미 드러난 갈등을 밀어붙이고 심어 둔 떡밥을 회수하며 현재 상황에서 자연스럽게 파생되는 새 변수까지 연결해야 합니다. 이미 알려진 내용을 길게 복기하지 마세요.`;

    const workingModeEn = isSeries
      ? `## Working Mode

This is not a zero-to-one foundation pass. You must extract durable story truth from the imported chapters **and design a continuation path**. You need to:
1. Extract worldbuilding, factions, characters, and systems from the source text -> generate story_bible
2. Infer narrative structure and future arc direction -> generate volume_outline (review existing chapters + design a **new continuation direction**)
3. Infer protagonist lock, prohibitions, and narrative constraints from character behavior -> generate book_rules
4. Reflect the latest chapter state -> generate current_state
5. Extract all active hooks already planted in the text -> generate pending_hooks`
      : `## Working Mode

This is not a zero-to-one foundation pass. You must extract durable story truth from the imported chapters **and preserve a clean continuation path**. You need to:
1. Extract worldbuilding, factions, characters, and systems from the source text -> generate story_bible
2. Infer narrative structure and near-future arc direction -> generate volume_outline (review existing chapters + continue naturally from where the imported chapters stop)
3. Infer protagonist lock, prohibitions, and narrative constraints from character behavior -> generate book_rules
4. Reflect the latest chapter state -> generate current_state
5. Extract all active hooks already planted in the text -> generate pending_hooks`;
    const workingModeZh = isSeries
      ? `## 工作模式

这不是从零创建，而是从已有正文中提取和推导，**并设计续写方向**。你需要：
1. 从正文中提取世界观、势力、角色、力量体系 → 生成 story_bible
2. 从叙事结构推断卷纲 → 生成 volume_outline（已有章节的回顾 + **续写部分的新方向设计**）
3. 从角色行为推断主角锁定和禁忌 → 生成 book_rules
4. 从最新章节状态推断 current_state（反映最后一章结束时的状态）
5. 从正文中识别已埋伏笔 → 生成 pending_hooks`
      : `## 工作模式

这不是从零创建，而是从已有正文中提取和推导，**并为自然续写保留清晰延续路径**。你需要：
1. 从正文中提取世界观、势力、角色、力量体系 → 生成 story_bible
2. 从叙事结构推断卷纲 → 生成 volume_outline（回顾已有章节，并从导入章节结束处自然接续）
3. 从角色行为推断主角锁定和禁忌 → 生成 book_rules
4. 从最新章节状态推断 current_state（反映最后一章结束时的状态）
5. 从正文中识别已埋伏笔 → 生成 pending_hooks`;
    const workingModeKo = isSeries
      ? `## 작업 모드

이 작업은 처음부터 새로 만드는 단계가 아니라, 기존 본문에서 오래 유지될 이야기 사실을 추출하고 **후속 전개 방향까지 설계하는 단계**입니다. 해야 할 일은 다음과 같습니다:
1. 본문에서 세계관, 세력, 인물, 시스템을 추출해 story_bible을 만든다
2. 서사 구조와 이후 권의 방향을 추론해 volume_outline를 만든다 (기존 구간 요약 + **후속 전개의 새 방향 설계**)
3. 인물의 행동을 근거로 protagonist lock, prohibitions, narrative constraints를 추론해 book_rules를 만든다
4. 최신 화 종료 시점을 반영해 current_state를 만든다
5. 본문에 이미 심어진 활성 떡밥을 추출해 pending_hooks를 만든다`
      : `## 작업 모드

이 작업은 처음부터 새로 만드는 단계가 아니라, 기존 본문에서 오래 유지될 이야기 사실을 추출하고 **자연스러운 후속 집필 경로를 정리하는 단계**입니다. 해야 할 일은 다음과 같습니다:
1. 본문에서 세계관, 세력, 인물, 시스템을 추출해 story_bible을 만든다
2. 서사 구조와 가까운 미래의 방향을 추론해 volume_outline를 만든다 (기존 구간 검토 + 끊긴 지점에서 자연스럽게 이어가기)
3. 인물의 행동을 근거로 protagonist lock, prohibitions, narrative constraints를 추론해 book_rules를 만든다
4. 최신 화 종료 시점을 반영해 current_state를 만든다
5. 본문에 이미 심어진 활성 떡밥을 추출해 pending_hooks를 만든다`;

    const systemPrompt = resolvedLanguage === "en"
      ? `You are a professional web-fiction architect. Your task is to reverse-engineer a complete foundation from existing chapters.${contextBlock}

${workingModeEn}

All output sections — story_bible, volume_outline, book_rules, current_state, and pending_hooks — MUST be written in English. Keep the === SECTION: === tags unchanged.

${continuationDirectiveEn}
${reviewFeedbackBlock}
## Book Metadata

- Title: ${book.title}
- Platform: ${book.platform}
- Genre: ${gp.name} (${book.genre})
- Target Chapters: ${book.targetChapters}
- Chapter Target Length: ${book.chapterWordCount}

## Genre Profile

${genreBody}

## Output Contract

Generate the following sections. Separate every section with === SECTION: <name> ===:

=== SECTION: story_bible ===
${storyBiblePrompt}

=== SECTION: volume_outline ===
${volumeOutlinePrompt}

=== SECTION: book_rules ===
${bookRulesPrompt}

=== SECTION: current_state ===
${currentStatePrompt}

=== SECTION: pending_hooks ===
${pendingHooksPrompt}

${keyPrinciplesPrompt}`
      : resolvedLanguage === "ko"
        ? `당신은 전문 웹소설 아키텍트입니다. 기존 본문에서 완전한 기반 설정을 역추출하세요.${contextBlock}

${workingModeKo}

${continuationDirectiveKo}
${reviewFeedbackBlock}
## 작품 정보

- 제목: ${book.title}
- 플랫폼: ${book.platform}
- 장르: ${gp.name} (${book.genre})
- 목표 화수: ${book.targetChapters}화
- 화당 목표 분량: ${book.chapterWordCount}자

## 장르 프로필

${genreBody}

## 출력 계약

아래 섹션을 생성하고, 각 섹션은 === SECTION: <name> === 로 구분하세요:

=== SECTION: story_bible ===
${storyBiblePrompt}

=== SECTION: volume_outline ===
${volumeOutlinePrompt}

=== SECTION: book_rules ===
${bookRulesPrompt}

=== SECTION: current_state ===
${currentStatePrompt}

=== SECTION: pending_hooks ===
${pendingHooksPrompt}

${keyPrinciplesPrompt}`
      : `你是一个专业的网络小说架构师。你的任务是从已有的小说正文中反向推导完整的基础设定。${contextBlock}

${workingModeZh}

${continuationDirectiveZh}
${reviewFeedbackBlock}
## 书籍信息

- 标题：${book.title}
- 平台：${book.platform}
- 题材：${gp.name}（${book.genre}）
- 目标章数：${book.targetChapters}章
- 每章字数：${book.chapterWordCount}字

## 题材特征

${genreBody}

## 生成要求

你需要生成以下内容，每个部分用 === SECTION: <name> === 分隔：

=== SECTION: story_bible ===
${storyBiblePrompt}

=== SECTION: volume_outline ===
${volumeOutlinePrompt}

=== SECTION: book_rules ===
${bookRulesPrompt}

=== SECTION: current_state ===
${currentStatePrompt}

=== SECTION: pending_hooks ===
${pendingHooksPrompt}

${keyPrinciplesPrompt}`;
    const langPrefix = resolvedLanguage === "en"
      ? ""
      : resolvedLanguage === "ko"
        ? `【LANGUAGE OVERRIDE】ALL output sections — story_bible, volume_outline, book_rules, current_state, and pending_hooks — MUST be written in Korean. Use Korean headings, Korean table headers, and Korean explanatory prose throughout. Keep the === SECTION: === tags unchanged.\n\n`
        : "";
    const userMessage = resolvedLanguage === "en"
      ? `Generate the complete foundation for an imported ${gp.name} novel titled "${book.title}". Write everything in English.\n\n${chaptersText}`
      : resolvedLanguage === "ko"
        ? `아래는 "${book.title}"의 기존 본문 전체입니다. 이를 바탕으로 완전한 기반 설정을 한국어로 역설계하세요.\n\n${chaptersText}`
        : `以下是《${book.title}》的全部已有正文，请从中反向推导完整基础设定：\n\n${chaptersText}`;

    const response = await this.chat([
      { role: "system", content: langPrefix + systemPrompt },
      {
        role: "user",
        content: userMessage,
      },
    ], { maxTokens: 16384, temperature: 0.5 });

    return this.parseSections(response.content);
  }

  async generateFanficFoundation(
    book: BookConfig,
    fanficCanon: string,
    fanficMode: FanficMode,
    reviewFeedback?: string,
  ): Promise<ArchitectOutput> {
    const { profile: gp, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const reviewFeedbackBlock = this.buildReviewFeedbackBlock(
      reviewFeedback,
      resolveWritingLanguage(book.language ?? gp.language),
    );

    const MODE_INSTRUCTIONS: Record<FanficMode, string> = {
      canon: "剧情发生在原作空白期或未详述的角度。不可改变原作已确立的事实。",
      au: "标注AU设定与原作的关键分歧点，分歧后的世界线自由发展。保留角色核心性格。",
      ooc: "标注角色性格偏离的起点和驱动事件。偏离必须有逻辑驱动。",
      cp: "以配对角色的关系线为主线规划卷纲。每卷必须有关系推进节点。",
    };

    const systemPrompt = `你是一个专业的同人小说架构师。你的任务是基于原作正典为同人小说生成基础设定。

## 同人模式：${fanficMode}
${MODE_INSTRUCTIONS[fanficMode]}

## 新时空要求（关键）
你必须为这本同人设计一个**原创的叙事空间**，而不是复述原作剧情。具体要求：
1. **明确分岔点**：story_bible 必须标注"本作从原作的哪个节点分岔"，或"本作发生在原作未涉及的什么时空"
2. **独立核心冲突**：volume_outline 的核心冲突必须是原创的，不是原作情节的翻版。原作角色可以出现，但他们面对的是新问题
3. **5章内引爆**：volume_outline 的第1卷必须在前5章内建立核心悬念，不允许用3章做铺垫才到引爆点
4. **场景新鲜度**：至少50%的关键场景发生在原作未出现的地点或情境中

${reviewFeedbackBlock}

## 原作正典
${fanficCanon}

## 题材特征
${genreBody}

## 关键原则
1. **不发明主要角色** — 主要角色必须来自原作正典的角色档案
2. 可以添加原创配角，但必须在 story_bible 中标注为"原创角色"
3. story_bible 保留原作世界观，标注同人的改动/扩展部分，并明确写出**分岔点**和**新时空设定**
4. volume_outline 不得复述原作剧情节拍。每卷的核心事件必须是原创的，标注"原创"
5. book_rules 的 fanficMode 必须设为 "${fanficMode}"
6. 主角设定来自原作角色档案中的第一个角色（或用户在标题中暗示的角色）

你需要生成以下内容，每个部分用 === SECTION: <name> === 分隔：

=== SECTION: story_bible ===
世界观（基于原作正典）+ 角色列表（原作角色标注来源，原创角色标注"原创"）

=== SECTION: volume_outline ===
卷纲规划。每卷标注：卷名、章节范围、核心事件（标注原作/原创）、关系发展节点

=== SECTION: book_rules ===
\`\`\`
---
version: "1.0"
protagonist:
  name: (从原作角色中选择)
  personalityLock: [(从正典角色档案提取)]
  behavioralConstraints: [(基于原作行为模式)]
genreLock:
  primary: ${book.genre}
  forbidden: []
fanficMode: "${fanficMode}"
allowedDeviations: []
prohibitions:
  - (3-5条同人特有禁忌)
---
(叙事视角和风格指导)
\`\`\`

=== SECTION: current_state ===
初始状态卡（基于正典起始点）

=== SECTION: pending_hooks ===
初始伏笔池（从正典关键事件和关系中提取）`;

    const response = await this.chat([
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `请为标题为"${book.title}"的${fanficMode}模式同人小说生成基础设定。目标${book.targetChapters}章，每章${book.chapterWordCount}字。`,
      },
    ], { maxTokens: 16384, temperature: 0.7 });

    return this.parseSections(response.content);
  }

  private buildReviewFeedbackBlock(
    reviewFeedback: string | undefined,
    language: WritingLanguage,
  ): string {
    const trimmed = reviewFeedback?.trim();
    if (!trimmed) return "";

    if (language === "en") {
      return `\n\n## Previous Review Feedback
The previous foundation draft was rejected. You must explicitly fix the following issues in this regeneration instead of paraphrasing the same design:

${trimmed}\n`;
    }

    if (language === "ko") {
      return `\n\n## 이전 검토 피드백
이전 기반 설정 초안은 반려되었습니다. 이번 재생성에서는 아래 문제를 실제로 수정해야 하며, 같은 설계를 말만 바꿔 반복하면 안 됩니다.

${trimmed}\n`;
    }

    return `\n\n## 上一轮审核反馈
上一轮基础设定未通过审核。你必须在这次重生中明确修复以下问题，不能只换措辞重写同一套方案：

${trimmed}\n`;
  }

  private parseSections(content: string): ArchitectOutput {
    const parsedSections = new Map<string, string>();
    const sectionPattern = /^\s*===\s*SECTION\s*[：:]\s*([^\n=]+?)\s*===\s*$/gim;
    const matches = [...content.matchAll(sectionPattern)];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      const rawName = match[1] ?? "";
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[i + 1]?.index ?? content.length;
      const normalizedName = this.normalizeSectionName(rawName);
      parsedSections.set(normalizedName, content.slice(start, end).trim());
    }

    const extract = (name: string): string => {
      const section = parsedSections.get(this.normalizeSectionName(name));
      if (!section) {
        throw new Error(`Architect output missing required section: ${name}`);
      }
      if (name !== "pending_hooks") {
        return section;
      }
      return this.normalizePendingHooksSection(this.stripTrailingAssistantCoda(section));
    };

    return {
      storyBible: extract("story_bible"),
      volumeOutline: extract("volume_outline"),
      bookRules: extract("book_rules"),
      currentState: extract("current_state"),
      pendingHooks: extract("pending_hooks"),
    };
  }

  private normalizeSectionName(name: string): string {
    return name
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[`"'*_]/g, " ")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  private stripTrailingAssistantCoda(section: string): string {
    const lines = section.split("\n");
    const cutoff = lines.findIndex((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      return /^(如果(?:你愿意|需要|想要|希望)|If (?:you(?:'d)? like|you want|needed)|I can (?:continue|next))/i.test(trimmed);
    });

    if (cutoff < 0) {
      return section;
    }

    return lines.slice(0, cutoff).join("\n").trimEnd();
  }

  private normalizePendingHooksSection(section: string): string {
    const rows = section
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|"))
      .filter((line) => !line.includes("---"))
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
      .filter((cells) => cells.some(Boolean));

    if (rows.length === 0) {
      return section;
    }

    const dataRows = rows.filter((row) => (row[0] ?? "").toLowerCase() !== "hook_id");
    if (dataRows.length === 0) {
      return section;
    }

    const language: WritingLanguage = /[가-힣]/u.test(section)
      ? "ko"
      : /[\u4e00-\u9fff]/u.test(section)
        ? "zh"
        : "en";
    const normalizedHooks = dataRows.map((row, index) => {
      const rawProgress = row[4] ?? "";
      const normalizedProgress = this.parseHookChapterNumber(rawProgress);
      const seedNote = normalizedProgress === 0 && this.hasNarrativeProgress(rawProgress)
        ? language === "zh"
          ? `初始线索：${rawProgress}`
          : language === "ko"
            ? `초기 단서: ${rawProgress}`
            : `initial signal: ${rawProgress}`
        : "";
      const notes = this.mergeHookNotes(row[6] ?? "", seedNote, language);

      return {
        hookId: row[0] || `hook-${index + 1}`,
        startChapter: this.parseHookChapterNumber(row[1]),
        type: row[2] ?? "",
        status: row[3] ?? "open",
        lastAdvancedChapter: normalizedProgress,
        expectedPayoff: row[5] ?? "",
        payoffTiming: row.length >= 8 ? row[6] ?? "" : "",
        notes: row.length >= 8 ? this.mergeHookNotes(row[7] ?? "", seedNote, language) : notes,
      };
    });

    return renderHookSnapshot(normalizedHooks, language);
  }

  private parseHookChapterNumber(value: string | undefined): number {
    if (!value) return 0;
    const match = value.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }

  private hasNarrativeProgress(value: string | undefined): boolean {
    const normalized = (value ?? "").trim().toLowerCase();
    if (!normalized) return false;
    return !["0", "none", "n/a", "na", "-", "无", "未推进"].includes(normalized);
  }

  private mergeHookNotes(notes: string, seedNote: string, language: WritingLanguage): string {
    const trimmedNotes = notes.trim();
    const trimmedSeed = seedNote.trim();
    if (!trimmedSeed) {
      return trimmedNotes;
    }
    if (!trimmedNotes) {
      return trimmedSeed;
    }
    return language === "zh"
      ? `${trimmedNotes}（${trimmedSeed}）`
      : `${trimmedNotes} (${trimmedSeed})`;
  }
}
