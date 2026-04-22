import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import { resolveWritingLanguage, type WritingLanguage } from "../models/language.js";
import { parseBookRules } from "../models/book-rules.js";
import { ChapterIntentSchema, type ChapterConflict, type ChapterIntent } from "../models/input-governance.js";
import {
  parseChapterSummariesMarkdown,
  renderHookSnapshot,
  renderSummarySnapshot,
  retrieveMemorySelection,
} from "../utils/memory-retrieval.js";
import { analyzeChapterCadence } from "../utils/chapter-cadence.js";
import { buildPlannerHookAgenda } from "../utils/hook-agenda.js";

export interface PlanChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly externalContext?: string;
}

export interface PlanChapterOutput {
  readonly intent: ChapterIntent;
  readonly intentMarkdown: string;
  readonly plannerInputs: ReadonlyArray<string>;
  readonly runtimePath: string;
}

export class PlannerAgent extends BaseAgent {
  get name(): string {
    return "planner";
  }

  async planChapter(input: PlanChapterInput): Promise<PlanChapterOutput> {
    const storyDir = join(input.bookDir, "story");
    const runtimeDir = join(storyDir, "runtime");
    await mkdir(runtimeDir, { recursive: true });

    const sourcePaths = {
      authorIntent: join(storyDir, "author_intent.md"),
      currentFocus: join(storyDir, "current_focus.md"),
      storyBible: join(storyDir, "story_bible.md"),
      volumeOutline: join(storyDir, "volume_outline.md"),
      chapterSummaries: join(storyDir, "chapter_summaries.md"),
      bookRules: join(storyDir, "book_rules.md"),
      currentState: join(storyDir, "current_state.md"),
    } as const;

    const [
      authorIntent,
      currentFocus,
      storyBible,
      volumeOutline,
      chapterSummaries,
      bookRulesRaw,
      currentState,
    ] = await Promise.all([
      this.readFileOrDefault(sourcePaths.authorIntent),
      this.readFileOrDefault(sourcePaths.currentFocus),
      this.readFileOrDefault(sourcePaths.storyBible),
      this.readFileOrDefault(sourcePaths.volumeOutline),
      this.readFileOrDefault(sourcePaths.chapterSummaries),
      this.readFileOrDefault(sourcePaths.bookRules),
      this.readFileOrDefault(sourcePaths.currentState),
    ]);

    const outlineNode = this.findOutlineNode(volumeOutline, input.chapterNumber);
    const matchedOutlineAnchor = this.hasMatchedOutlineAnchor(volumeOutline, input.chapterNumber);
    const goal = this.deriveGoal(input.externalContext, currentFocus, authorIntent, outlineNode, input.chapterNumber);
    const parsedRules = parseBookRules(bookRulesRaw);
    const mustKeep = this.collectMustKeep(currentState, storyBible);
    const mustAvoid = this.collectMustAvoid(currentFocus, parsedRules.rules.prohibitions);
    const styleEmphasis = this.collectStyleEmphasis(authorIntent, currentFocus);
    const conflicts = this.collectConflicts(input.externalContext, currentFocus, outlineNode, volumeOutline);
    const planningAnchor = conflicts.length > 0 ? undefined : outlineNode;
    const memorySelection = await retrieveMemorySelection({
      bookDir: input.bookDir,
      chapterNumber: input.chapterNumber,
      goal,
      outlineNode: planningAnchor,
      mustKeep,
    });
    const activeHookCount = memorySelection.activeHooks.filter(
      (hook) => hook.status !== "resolved" && hook.status !== "deferred",
    ).length;
    const resolvedLanguage = resolveWritingLanguage(input.book.language);
    const hookAgenda = buildPlannerHookAgenda({
      hooks: memorySelection.activeHooks,
      chapterNumber: input.chapterNumber,
      targetChapters: input.book.targetChapters,
      language: resolvedLanguage,
    });
    const directives = this.buildStructuredDirectives({
      chapterNumber: input.chapterNumber,
      language: input.book.language,
      authorIntent,
      currentFocus,
      volumeOutline,
      outlineNode,
      matchedOutlineAnchor,
      chapterSummaries,
    });

    const intent = ChapterIntentSchema.parse({
      chapter: input.chapterNumber,
      goal,
      outlineNode,
      ...directives,
      mustKeep,
      mustAvoid,
      styleEmphasis,
      conflicts,
      hookAgenda,
    });

    const runtimePath = join(runtimeDir, `chapter-${String(input.chapterNumber).padStart(4, "0")}.intent.md`);
    const intentMarkdown = this.renderIntentMarkdown(
      intent,
      resolvedLanguage,
      renderHookSnapshot(memorySelection.hooks, resolvedLanguage),
      renderSummarySnapshot(memorySelection.summaries, resolvedLanguage),
      activeHookCount,
    );
    await writeFile(runtimePath, intentMarkdown, "utf-8");

    return {
      intent,
      intentMarkdown,
      plannerInputs: [
        ...Object.values(sourcePaths),
        join(storyDir, "pending_hooks.md"),
        ...(memorySelection.dbPath ? [memorySelection.dbPath] : []),
      ],
      runtimePath,
    };
  }

  private buildStructuredDirectives(input: {
    readonly chapterNumber: number;
    readonly language?: string;
    readonly authorIntent: string;
    readonly currentFocus: string;
    readonly volumeOutline: string;
    readonly outlineNode: string | undefined;
    readonly matchedOutlineAnchor: boolean;
    readonly chapterSummaries: string;
  }): Pick<ChapterIntent, "sceneDirective" | "arcDirective" | "moodDirective" | "titleDirective" | "engineDirectives"> {
    const recentSummaries = parseChapterSummariesMarkdown(input.chapterSummaries)
      .filter((summary) => summary.chapter < input.chapterNumber)
      .sort((left, right) => left.chapter - right.chapter)
      .slice(-4);
    const resolvedLanguage = resolveWritingLanguage(input.language);
    const cadence = analyzeChapterCadence({
      language: resolvedLanguage,
      rows: recentSummaries.map((summary) => ({
        chapter: summary.chapter,
        title: summary.title,
        mood: summary.mood,
        chapterType: summary.chapterType,
      })),
    });
    const openingDirective = this.buildOpeningDirective(
      input.language,
      input.chapterNumber,
      input.authorIntent,
      input.currentFocus,
    );
    const toneDirective = this.buildToneDirective(
      input.language,
      input.authorIntent,
      input.currentFocus,
    );

    return {
      arcDirective: this.buildArcDirective(
        input.language,
        input.volumeOutline,
        input.outlineNode,
        input.matchedOutlineAnchor,
      ),
      sceneDirective: this.mergeDirectives(
        this.buildSceneDirective(input.language, cadence),
        openingDirective,
      ),
      moodDirective: this.mergeDirectives(
        this.buildMoodDirective(input.language, cadence),
        toneDirective,
      ),
      titleDirective: this.buildTitleDirective(input.language, cadence),
      engineDirectives: this.collectNarrativeEngine(
        input.authorIntent,
        input.currentFocus,
      ),
    };
  }

  private deriveGoal(
    externalContext: string | undefined,
    currentFocus: string,
    authorIntent: string,
    outlineNode: string | undefined,
    chapterNumber: number,
  ): string {
    const first = this.extractFirstDirective(externalContext);
    if (first) return first;
    const localOverride = this.extractLocalOverrideGoal(currentFocus);
    if (localOverride) return localOverride;
    const outline = this.extractFirstDirective(outlineNode);
    if (outline) return outline;
    const focus = this.extractFocusGoal(currentFocus);
    if (focus) return focus;
    const author = this.extractFirstDirective(authorIntent);
    if (author) return author;
    return `Advance chapter ${chapterNumber} with clear narrative focus.`;
  }

  private collectMustKeep(currentState: string, storyBible: string): string[] {
    return this.unique([
      ...this.extractListItems(currentState, 2),
      ...this.extractListItems(storyBible, 2),
    ]).slice(0, 4);
  }

  private collectMustAvoid(currentFocus: string, prohibitions: ReadonlyArray<string>): string[] {
    const avoidSection = this.extractSection(currentFocus, [
      "avoid",
      "must avoid",
      "禁止",
      "避免",
      "避雷",
      "피할 것",
      "금지",
      "하지 말 것",
      "주의",
    ]);
    const focusAvoids = avoidSection
      ? this.extractListItems(avoidSection, 10)
      : currentFocus
        .split("\n")
        .map((line) => line.trim())
        .filter((line) =>
          line.startsWith("-") &&
          /avoid|don't|do not|不要|别|禁止|피하|하지 말|금지|쓰지 않|시작하지 않/i.test(line),
        )
        .map((line) => this.cleanListItem(line))
        .filter((line): line is string => Boolean(line));

    return this.unique([...focusAvoids, ...prohibitions]).slice(0, 6);
  }

  private collectStyleEmphasis(authorIntent: string, currentFocus: string): string[] {
    return this.unique([
      ...this.extractFocusStyleItems(currentFocus),
      ...this.extractListItems(authorIntent, 2),
      ...this.extractPrioritySentences(
        currentFocus,
        /(tone|톤|블랙코미디|black comedy|serious|진지|착각|오해|misunderstanding|컨셉 플레이|role ?play)/i,
        2,
      ),
      ...this.extractPrioritySentences(
        authorIntent,
        /(tone|톤|블랙코미디|black comedy|serious|진지|착각|오해|misunderstanding|컨셉 플레이|role ?play)/i,
        3,
      ),
    ]).slice(0, 4);
  }

  private collectNarrativeEngine(authorIntent: string, currentFocus: string): string[] {
    return this.unique([
      ...this.extractPrioritySentences(
        currentFocus,
        /(engine|핵심 엔진|서사 엔진|착각|오해|misunderstanding|misread|과잉 해석|컨셉 플레이|role ?play|잠입|infiltrat|정체|권위|persona)/i,
        2,
      ),
      ...this.extractPrioritySentences(
        authorIntent,
        /(engine|핵심 엔진|서사 엔진|착각|오해|misunderstanding|misread|과잉 해석|컨셉 플레이|role ?play|잠입|infiltrat|정체|권위|persona)/i,
        4,
      ),
    ]).slice(0, 4);
  }

  private collectConflicts(
    externalContext: string | undefined,
    currentFocus: string,
    outlineNode: string | undefined,
    volumeOutline: string,
  ): ChapterConflict[] {
    const outlineText = outlineNode ?? volumeOutline;
    if (!outlineText || outlineText === "(文件尚未创建)") return [];
    if (externalContext) {
      const indicatesOverride = /ignore|skip|defer|instead|不要|别|先别|暂停|무시|건너뛰|미루|대신|하지 말|중단|보류/i.test(externalContext);
      if (!indicatesOverride && this.hasKeywordOverlap(externalContext, outlineText)) return [];

      return [
        {
          type: "outline_vs_request",
          resolution: "allow local outline deferral",
        },
      ];
    }

    const localOverride = this.extractLocalOverrideGoal(currentFocus);
    if (!localOverride || !outlineNode) {
      return [];
    }

    return [
      {
        type: "outline_vs_current_focus",
        resolution: "allow explicit current focus override",
        detail: localOverride,
      },
    ];
  }

  private extractFirstDirective(content?: string): string | undefined {
    if (!content) return undefined;
    return content
      .split("\n")
      .map((line) => line.trim())
      .find((line) =>
        line.length > 0
        && !line.startsWith("#")
        && !line.startsWith("-")
        && !line.startsWith(">")
        && !this.isTemplatePlaceholder(line),
      );
  }

  private extractListItems(content: string, limit: number): string[] {
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => this.cleanListItem(line))
      .filter((line): line is string => Boolean(line))
      .slice(0, limit);
  }

  private extractFocusGoal(currentFocus: string): string | undefined {
    const focusSection = this.extractSection(currentFocus, [
      "active focus",
      "focus",
      "当前聚焦",
      "当前焦点",
      "近期聚焦",
      "현재 중점",
      "현재 초점",
      "이번 화 방향성",
      "이번 화 중점",
    ]) ?? currentFocus;
    const directives = this.extractFocusStyleItems(focusSection, 3);
    if (directives.length === 0) {
      return this.extractFirstDirective(focusSection);
    }
    return directives.join(this.containsChinese(focusSection) ? "；" : "; ");
  }

  private extractLocalOverrideGoal(currentFocus: string): string | undefined {
    const overrideSection = this.extractSection(currentFocus, [
      "local override",
      "explicit override",
      "chapter override",
      "local task override",
      "局部覆盖",
      "本章覆盖",
      "临时覆盖",
      "当前覆盖",
      "로컬 오버라이드",
      "명시적 오버라이드",
      "이번 화 오버라이드",
      "이번 화 예외",
    ]);
    if (!overrideSection) {
      return undefined;
    }

    const directives = this.extractListItems(overrideSection, 3);
    if (directives.length > 0) {
      return directives.join(this.containsChinese(overrideSection) ? "；" : "; ");
    }

    return this.extractFirstDirective(overrideSection);
  }

  private extractFocusStyleItems(currentFocus: string, limit = 3): string[] {
    const focusSection = this.extractSection(currentFocus, [
      "active focus",
      "focus",
      "当前聚焦",
      "当前焦点",
      "近期聚焦",
      "현재 중점",
      "현재 초점",
      "이번 화 방향성",
      "이번 화 중점",
    ]) ?? currentFocus;
    return this.extractListItems(focusSection, limit);
  }

  private buildArcDirective(
    language: string | undefined,
    volumeOutline: string,
    outlineNode: string | undefined,
    matchedOutlineAnchor: boolean,
  ): string | undefined {
    if (matchedOutlineAnchor || !outlineNode || volumeOutline === "(文件尚未创建)") {
      return undefined;
    }

    const resolvedLanguage = resolveWritingLanguage(language);
    if (resolvedLanguage === "ko") {
      return "볼륨 아웃라인의 fallback 문장에 계속 기대지 말고, 이번 화는 새로운 아크 비트나 장소 변화까지 분명히 밀어붙여라.";
    }
    return resolvedLanguage === "zh"
      ? "不要继续依赖卷纲的 fallback 指令，必须把本章推进到新的弧线节点或地点变化。"
      : "Do not keep leaning on the outline fallback. Force this chapter toward a fresh arc beat or location change.";
  }

  private buildSceneDirective(
    language: string | undefined,
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): string | undefined {
    if (cadence.scenePressure?.pressure !== "high") {
      return undefined;
    }
    const repeatedType = cadence.scenePressure.repeatedType;

    const resolvedLanguage = resolveWritingLanguage(language);
    if (resolvedLanguage === "ko") {
      return `최근 회차가 계속 "${repeatedType}" 패턴에 머물렀다. 이번 화는 장면 그릇, 장소, 행동 방식 중 하나를 분명히 바꿔라.`;
    }
    return resolvedLanguage === "zh"
      ? `最近章节连续停留在“${repeatedType}”，本章必须更换场景容器、地点或行动方式。`
      : `Recent chapters are stuck in repeated ${repeatedType} beats. Change the scene container, location, or action pattern this chapter.`;
  }

  private buildMoodDirective(
    language: string | undefined,
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): string | undefined {
    if (cadence.moodPressure?.pressure !== "high") {
      return undefined;
    }
    const moods = cadence.moodPressure.recentMoods;

    const resolvedLanguage = resolveWritingLanguage(language);
    if (resolvedLanguage === "ko") {
      return `최근 ${moods.length}화가 계속 고압 감정선(${moods.slice(0, 3).join(", ")})에 묶여 있다. 이번 화는 일상, 숨 고르기, 온기, 유머 중 하나를 넣어 독자가 숨 돌릴 틈을 만들어라.`;
    }
    return resolvedLanguage === "zh"
      ? `最近${moods.length}章情绪持续高压（${moods.slice(0, 3).join("、")}），本章必须降调——安排日常/喘息/温情/幽默场景，让读者呼吸。`
      : `The last ${moods.length} chapters have been relentlessly tense (${moods.slice(0, 3).join(", ")}). This chapter must downshift — write a quieter scene with warmth, humor, or breathing room.`;
  }

  private buildTitleDirective(
    language: string | undefined,
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): string | undefined {
    if (cadence.titlePressure?.pressure !== "high") {
      return undefined;
    }
    const repeatedToken = cadence.titlePressure.repeatedToken;

    const resolvedLanguage = resolveWritingLanguage(language);
    if (resolvedLanguage === "ko") {
      return `제목을 또 "${repeatedToken}" 중심으로 반복하지 말고, 이번에는 다른 이미지나 행동 초점으로 제목을 잡아라.`;
    }
    return resolvedLanguage === "zh"
      ? `标题不要再围绕“${repeatedToken}”重复命名，换一个新的意象或动作焦点。`
      : `Avoid another ${repeatedToken}-centric title. Pick a new image or action focus for this chapter title.`;
  }

  private buildOpeningDirective(
    language: string | undefined,
    chapterNumber: number,
    authorIntent: string,
    currentFocus: string,
  ): string | undefined {
    if (chapterNumber !== 1) {
      return undefined;
    }

    const hints = this.unique([
      ...this.extractPrioritySentences(
        currentFocus,
        /(opening|first chapter|chapter 1|chapter one|오프닝|첫 장면|첫 화|1화|초반)/i,
        2,
      ),
      ...this.extractPrioritySentences(
        authorIntent,
        /(opening|first chapter|chapter 1|chapter one|오프닝|첫 장면|첫 화|1화|초반)/i,
        3,
      ),
      ...this.extractPrioritySentences(
        currentFocus,
        /(빙의|왕좌|잠입)/i,
        2,
      ),
      ...this.extractPrioritySentences(
        authorIntent,
        /(빙의|왕좌|잠입)/i,
        3,
      ),
    ]).slice(0, 2);

    if (hints.length === 0) {
      return undefined;
    }

    const resolvedLanguage = resolveWritingLanguage(language);
    const joined = hints.join(resolvedLanguage === "en" ? " / " : " / ");
    if (resolvedLanguage === "ko") {
      return `오프닝은 다음 요구를 직접 장면화해야 한다: ${joined}`;
    }
    return resolvedLanguage === "zh"
      ? `开篇必须把以下要求直接落成场景：${joined}`
      : `The opening must dramatize the following requirements directly: ${joined}`;
  }

  private buildToneDirective(
    language: string | undefined,
    authorIntent: string,
    currentFocus: string,
  ): string | undefined {
    const hints = this.unique([
      ...this.extractPrioritySentences(
        currentFocus,
        /(tone|톤|블랙코미디|black comedy|serious|진지|웃음|유머|comedy|dark fantasy|다크 판타지)/i,
        2,
      ),
      ...this.extractPrioritySentences(
        authorIntent,
        /(tone|톤|블랙코미디|black comedy|serious|진지|웃음|유머|comedy|dark fantasy|다크 판타지)/i,
        2,
      ),
    ]).slice(0, 2);

    if (hints.length === 0) {
      return undefined;
    }

    const resolvedLanguage = resolveWritingLanguage(language);
    const joined = hints.join(resolvedLanguage === "en" ? " / " : " / ");
    if (resolvedLanguage === "ko") {
      return `톤 운용: ${joined}`;
    }
    return resolvedLanguage === "zh"
      ? `本章语气：${joined}`
      : `Tone handling: ${joined}`;
  }

  private mergeDirectives(primary?: string, secondary?: string): string | undefined {
    if (primary && secondary) {
      return `${primary} ${secondary}`;
    }
    return primary ?? secondary;
  }

  private renderHookBudget(activeCount: number, language: WritingLanguage): string {
    const cap = 12;
    if (activeCount < 10) {
      return language === "en"
        ? `### Hook Budget\n- ${activeCount} active hooks (capacity: ${cap})`
        : language === "ko"
          ? `### 떡밥 예산\n- 현재 활성 떡밥 ${activeCount}개 (한도: ${cap})`
        : `### 伏笔预算\n- 当前 ${activeCount} 条活跃伏笔（容量：${cap}）`;
    }
    const remaining = Math.max(0, cap - activeCount);
    return language === "en"
      ? `### Hook Budget\n- ${activeCount} active hooks — approaching capacity (${cap}). Only ${remaining} new hook(s) allowed. Prioritize resolving existing debt over opening new threads.`
      : language === "ko"
        ? `### 떡밥 예산\n- 현재 활성 떡밥 ${activeCount}개로 한도(${cap})에 가깝습니다. 새 떡밥은 ${remaining}개까지만 허용하고, 새 줄을 열기보다 기존 떡밥 회수를 우선하세요.`
      : `### 伏笔预算\n- 当前 ${activeCount} 条活跃伏笔——接近容量上限（${cap}）。仅剩 ${remaining} 个新坑位。优先回收旧债，不要轻易开新线。`;
  }

  private renderEpisodeContract(language: WritingLanguage): string {
    if (language === "en") {
      return [
        "## Episode Contract",
        "- Close at least one small reward: answer, win, cost paid, relationship movement, or concrete progress.",
        "- Open one next-episode question: reveal, threat, decision, deadline, or unresolved pressure.",
        "- Give the protagonist one active choice that changes the situation.",
        "- Attach a cost to that choice: lost option, exposed secret, new enemy, debt, injury, or harder constraint.",
      ].join("\n");
    }

    if (language === "ko") {
      return [
        "## 회차 계약",
        "- 작은 보상 1개를 닫는다: 답, 승리, 대가 지불, 관계 이동, 구체적 진전 중 하나.",
        "- 다음 화를 여는 질문 1개를 남긴다: 폭로, 위협, 선택, 마감, 미해결 압박 중 하나.",
        "- 주인공의 능동적 선택이 상황을 바꾸게 한다.",
        "- 선택의 대가를 붙인다: 선택지 상실, 비밀 노출, 새 적, 빚, 부상, 더 좁아진 제약 중 하나.",
      ].join("\n");
    }

    return [
      "## 单章契约",
      "- 收束 1 个小回报：答案、胜利、付出代价、关系推进或具体进展。",
      "- 留下 1 个下一章问题：揭示、威胁、选择、期限或未解压力。",
      "- 让主角做出 1 个主动选择，并改变局面。",
      "- 给这个选择附上代价：失去选项、秘密暴露、新敌人、债务、受伤或更窄的限制。",
    ].join("\n");
  }

  private renderSceneDesignContract(language: WritingLanguage): string {
    if (language === "en") {
      return [
        "## Scene Design Contract",
        "- Each major scene must show want / action / shift.",
        "- Before drafting a scene, know the immediate goal / obstacle / turn.",
        "- Dialogue should work as pressure, evasion, bargaining, concealment, or challenge before it works as exposition.",
        "- Do not summarize decisive emotional, relational, or payoff beats when they need to be felt as scene.",
      ].join("\n");
    }

    if (language === "ko") {
      return [
        "## 장면 설계 계약",
        "- 주요 장면은 욕망 / 행동 / 변화가 보이게 설계한다.",
        "- 장면에 들어가기 전 즉시 목표 / 방해 / 전환을 분명히 한다.",
        "- 대사는 설명보다 압박, 회피, 협상, 은폐, 도전의 행위로 먼저 작동해야 한다.",
        "- 감정, 관계, 회수의 결정적 비트는 요약으로 넘기지 말고 장면으로 체감되게 한다.",
      ].join("\n");
    }

    return [
      "## 场景设计契约",
      "- 主要场景必须具备 欲望 / 行动 / 变化。",
      "- 写场景前先明确 即时目标 / 阻碍 / 转折。",
      "- 对话先承担施压、回避、谈判、隐瞒或挑战，再承担说明信息。",
      "- 情绪、关系和回收的关键拍不要压成摘要，必须落成可感场景。",
    ].join("\n");
  }

  private renderNarrativeManagementContract(language: WritingLanguage): string {
    if (language === "en") {
      return [
        "## Narrative Management Contract",
        "- Meaning/arc: make the episode test a belief or value through choice; leave traces in consequences, not moral commentary.",
        "- Scene causality: each scene ending must feed the next scene. Transitions should move cause -> reaction -> new situation.",
        "- Reveal budget: distinguish new information, recontextualization, and unresolved questions; reveal only what the scene needs now.",
        "- Subplot/relationship lines: move only 1-2 live lines this episode and mark the rest as maintain, defer, or compress.",
        "- Sequence pressure: narrow or raise the cost of one axis: goal, clock, information asymmetry, space, or power balance.",
        "- Desire/misbelief: separate the protagonist's surface desire from the deeper misbelief or lack, and make choices test that misbelief.",
        "- Promise-progress-payoff ladder: every promise needs visible progress, and payoff should settle that progress rather than merely close a hook.",
        "- Sequel beat: after each major scene, leave a reaction-reflection-decision beat before moving into the next push.",
        "- Cliffhanger integrity: do not create a final hook by hiding an answer that is already settled; carry over a real option, cost, or conflict.",
        "- Milestones: each volume arc and short arc should leave one checkable state-changing milestone.",
        "- Scene spine: lock each major scene into one sentence first: who wants what, what blocks it, and what choice ends it.",
        "- Stakes clock: show one shrinking clock inside the scene: time, opportunity, stamina, trust, or pursuit.",
        "- Conversion beat: use the last 1-2 paragraphs as the paid-episode conversion zone, leaving one reward and one reason to continue.",
        "- Title promise: prove the emotion, event, or cost promised by the title in an actual scene.",
        "- Novelty rotation: in long serialization, rotate place, relationship, reveal shape, combat shape, and reward shape.",
        "- Chapter-scale causality: an episode is not a list of scenes; it must close from starting state -> accumulated pressure -> irreversible new state.",
        "- Moral pressure: create pressure through a collision between two defensible choices, not a simple good/evil split.",
        "- Relational triangle: important relationships should gain a third pressure axis that twists leverage, jealousy, or misreadings.",
        "- Midpoint reversal: the midpoint should change the direction of the question rather than merely add a bigger obstacle.",
        "- Objective layers: separate the scene objective from the superobjective behind it.",
        "- Episodic micro-goals: each scene should carry a smaller goal than the episode goal and close one micro-reward.",
      ].join("\n");
    }

    if (language === "ko") {
      return [
        "## 서사 운용 계약",
        "- 의미/아크: 이번 화의 사건은 인물이 어떤 믿음이나 가치를 선택으로 시험받는지 남긴다. 교훈문이 아니라 선택이 남긴 흔적으로 처리한다.",
        "- 장면 사이 인과: 각 장면 끝은 다음 장면의 입력값을 남긴다. 컷은 원인 -> 반응 -> 새 상황으로 이어진다.",
        "- 정보 공개 예산: 새 정보, 재맥락화, 미해결 질문을 구분하고 지금 알아야 할 것만 장면 안에서 공개한다.",
        "- 서브플롯/관계선: 이번 화에서 실제로 움직일 선은 1-2개로 제한하고, 나머지는 유지/보류/압축한다.",
        "- 시퀀스 압력: 목표 축소, 시간 압박, 정보 비대칭, 공간 제약, 권력 균형 중 하나가 더 좁아지거나 비싸져야 한다.",
        "- 심리 엔진: 주인공의 표면적 욕망과 그 아래의 미신념/결핍을 분리해 설계하고, 선택은 그 미신념을 시험하게 한다.",
        "- 약속-진전-회수의 사다리: 새 약속은 구체적 진전으로 보이고, 회수는 그 진전을 결산한다.",
        "- 후속 비트: 각 장면 뒤에는 반응-성찰-결정의 후속 비트를 남기고 다음 장면으로 넘긴다.",
        "- 마지막 훅은 이미 답이 정해진 질문을 숨기는 방식으로 만들지 않는다. 다음 화로 넘길 압력은 실제로 남은 선택지, 대가, 충돌에서 나온다.",
        "- 권과 소호흡마다 확인 가능한 마일스톤 하나를 세운다. 상태 변화가 남는 사건을 마일스톤으로 삼고, 같은 기능의 장면을 여러 번 소모하지 않는다.",
        "- 장면의 척추를 한 문장으로 먼저 고정한다: 누가 무엇을 원하고, 무엇이 막고, 어떤 선택으로 끝나는지.",
        "- 장면 안에는 줄어드는 시계가 보여야 한다: 시간, 기회, 체력, 신뢰, 추적 중 하나가 한 칸씩 깎인다.",
        "- 마지막 1-2문단은 결제 전환 구간으로 쓰고, 보상 1개와 다음 화 이유 1개를 동시에 남긴다.",
        "- 제목이 약속한 감정, 사건, 대가는 본문에서 실제 장면으로 증명한다.",
        "- 장기 연재에서는 장소, 관계, 정보 공개, 전투 방식, 보상의 형태를 번갈아 바꾸고, 같은 감정과 같은 장면 그릇을 연속으로 쓰지 않는다.",
        "- 한 화는 장면들의 나열이 아니라 시작 상태 -> 압력 누적 -> 되돌릴 수 없는 새 상태로 닫혀야 한다.",
        "- 도덕적 압박은 선악이 아니라 둘 다 옳아 보이는 선택의 충돌로 만든다.",
        "- 중요한 관계는 둘만 붙여 두지 말고, 반드시 세 번째 압력축을 세워 긴장을 비틀어라.",
        "- 중반 전환은 답이 아니라 질문의 방향을 바꾸는 지점이다.",
        "- 장면 목표와 슈퍼목표를 분리한다. 지금 장면에서 얻으려는 것과 긴 호흡에서 원하는 것을 따로 적는다.",
        "- 장면마다 회차 목표보다 더 작은 미세 목표를 하나 세우고, 장면마다 1개의 미세 목표와 1개의 미세 보상을 닫는다.",
      ].join("\n");
    }

    return [
      "## 叙事运营契约",
      "- 意义/弧线：本章事件必须通过选择检验人物的信念或价值，不写成说教，而是留下后果痕迹。",
      "- 场景因果：每个场景结尾都要成为下一场景的输入。转场按原因 -> 反应 -> 新局面推进。",
      "- 信息公开预算：区分新信息、重新语境化和未解问题，只公开当前场景必须知道的内容。",
      "- 支线/关系线：本章实际推进 1-2 条线，其余标记为维持、延后或压缩。",
      "- 序列压力：目标、时间、信息差、空间限制、权力平衡中至少一项要变得更窄或更昂贵。",
      "- 心理引擎：区分主角表层欲望和更深层的错误信念/缺失，让选择去检验这个错误信念。",
      "- 承诺-进展-回收阶梯：新承诺必须带来可见进展，回收要结算这份进展。",
      "- 后续拍：每个主要场景之后留下反应-反思-决定，再推入下一场景。",
      "- 结尾钩子不能靠隐藏已经确定的答案制造，必须来自真实剩余的选项、代价或冲突。",
      "- 每个卷线和小弧线都要留下一个可检查的状态变化里程碑，避免重复消耗同一功能的场景。",
      "- 场景脊柱：先用一句话锁定谁想要什么、什么阻挡、以什么选择结束。",
      "- 利害倒计时：场景内必须看见时间、机会、体力、信任或追踪至少一项在减少。",
      "- 付费转化拍：最后 1-2 段同时留下一个回报和一个继续读下一章的理由。",
      "- 标题承诺：标题承诺的情绪、事件或代价必须在正文场景中兑现。",
      "- 长线新鲜度：长篇连载要轮换地点、关系、信息公开方式、战斗形态和回报形态。",
      "- 单章因果：单章不是场景罗列，必须从起始状态 -> 压力累积 -> 不可逆新状态收束。",
      "- 道德压力：用两个看似都成立的选择相撞，而不是简单善恶对立。",
      "- 关系三角：重要关系必须加入第三个压力轴，扭转筹码、嫉妒或误读。",
      "- 中点转向：中段转折不是给答案，而是改变问题的方向。",
      "- 目标层级：区分场景目标和背后的超目标。",
      "- 微目标：每个场景都要有比单章目标更小的微目标，并收束一个微回报。",
    ].join("\n");
  }

  private extractSection(content: string, headings: ReadonlyArray<string>): string | undefined {
    const targets = headings.map((heading) => this.normalizeHeading(heading));
    const lines = content.split("\n");
    let buffer: string[] | null = null;
    let sectionLevel = 0;

    for (const line of lines) {
      const headingMatch = line.match(/^(#+)\s*(.+?)\s*$/);
      if (headingMatch) {
        const level = headingMatch[1]!.length;
        const heading = this.normalizeHeading(headingMatch[2]!);

        if (buffer && level <= sectionLevel) {
          break;
        }

        if (targets.includes(heading)) {
          buffer = [];
          sectionLevel = level;
          continue;
        }
      }

      if (buffer) {
        buffer.push(line);
      }
    }

    const section = buffer?.join("\n").trim();
    return section && section.length > 0 ? section : undefined;
  }

  private normalizeHeading(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[*_`:#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private cleanListItem(line: string): string | undefined {
    const cleaned = line.replace(/^-\s*/, "").trim();
    if (cleaned.length === 0) return undefined;
    if (/^[-|]+$/.test(cleaned)) return undefined;
    if (this.isTemplatePlaceholder(cleaned)) return undefined;
    return cleaned;
  }

  private isTemplatePlaceholder(line: string): boolean {
    const normalized = line.trim();
    if (!normalized) return false;

    return (
      /^\((describe|briefly describe|write)\b[\s\S]*\)$/i.test(normalized)
      || /^\((?:앞으로|여기에|여기서|이번 화|이 장면|적는다|작성한다)[\s\S]*\)$/u.test(normalized)
      || /^\(비어 있음\)$/u.test(normalized)
      || /^（(?:在这里描述|描述|填写|写下)[\s\S]*）$/u.test(normalized)
    );
  }

  private containsChinese(content: string): boolean {
    return /[\u4e00-\u9fff]/.test(content);
  }

  private findOutlineNode(volumeOutline: string, chapterNumber: number): string | undefined {
    const lines = volumeOutline.split("\n").map((line) => line.trim()).filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const match = this.matchExactOutlineLine(line, chapterNumber);
      if (!match) continue;

      const inlineContent = this.cleanOutlineContent(match[1]);
      if (inlineContent) {
        return inlineContent;
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const match = this.matchRangeOutlineLine(line, chapterNumber);
      if (!match) continue;

      const inlineContent = this.cleanOutlineContent(match[3]);
      if (inlineContent) {
        return inlineContent;
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!this.isOutlineAnchorLine(line)) continue;

      const exactMatch = this.matchAnyExactOutlineLine(line);
      if (exactMatch) {
        const inlineContent = this.cleanOutlineContent(exactMatch[1]);
        if (inlineContent) {
          return inlineContent;
        }
      }

      const rangeMatch = this.matchAnyRangeOutlineLine(line);
      if (rangeMatch) {
        const inlineContent = this.cleanOutlineContent(rangeMatch[3]);
        if (inlineContent) {
          return inlineContent;
        }
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }

      break;
    }

    return this.extractFirstDirective(volumeOutline);
  }

  private cleanOutlineContent(content?: string): string | undefined {
    const cleaned = content?.trim();
    if (!cleaned) return undefined;
    if (/^[*_`~:：-]+$/.test(cleaned)) return undefined;
    return cleaned;
  }

  private findNextOutlineContent(lines: ReadonlyArray<string>, startIndex: number): string | undefined {
    for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!line) {
        continue;
      }

      if (this.isOutlineAnchorLine(line)) {
        return undefined;
      }

      if (line.startsWith("#")) {
        continue;
      }

      const cleaned = this.cleanOutlineContent(line);
      if (cleaned) {
        return cleaned;
      }
    }

    return undefined;
  }

  private hasMatchedOutlineAnchor(volumeOutline: string, chapterNumber: number): boolean {
    const lines = volumeOutline.split("\n").map((line) => line.trim()).filter(Boolean);
    return lines.some((line) =>
      this.matchExactOutlineLine(line, chapterNumber) !== undefined
      || this.matchRangeOutlineLine(line, chapterNumber) !== undefined,
    );
  }

  private matchExactOutlineLine(line: string, chapterNumber: number): RegExpMatchArray | undefined {
    const patterns = [
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?Chapter\\s*${chapterNumber}(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`, "i"),
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?第\\s*${chapterNumber}\\s*章(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`),
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?(?:제\\s*)?${chapterNumber}\\s*화(?!\\d|\\s*[-~–—]\\s*\\d)(?:\\*\\*)?(?:[:：-])?\\s*(.*)$`),
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?(?:제\\s*)?${chapterNumber}\\s*장(?!\\d|\\s*[-~–—]\\s*\\d)(?:\\*\\*)?(?:[:：-])?\\s*(.*)$`),
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private matchAnyExactOutlineLine(line: string): RegExpMatchArray | undefined {
    const patterns = [
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chapter\s*\d+(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?第\s*\d+\s*章(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?(?:제\s*)?\d+\s*화(?!\s*[-~–—]\s*\d)(?:\*\*)?(?:[:：-])?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?(?:제\s*)?\d+\s*장(?!\s*[-~–—]\s*\d)(?:\*\*)?(?:[:：-])?\s*(.*)$/i,
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private matchRangeOutlineLine(line: string, chapterNumber: number): RegExpMatchArray | undefined {
    const match = this.matchAnyRangeOutlineLine(line);
    if (!match) return undefined;
    if (this.isChapterWithinRange(match[1], match[2], chapterNumber)) {
      return match;
    }

    return undefined;
  }

  private matchAnyRangeOutlineLine(line: string): RegExpMatchArray | undefined {
    const patterns = [
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chapter\s*(\d+)\s*[-~–—]\s*(\d+)\b(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?第\s*(\d+)\s*[-~–—]\s*(\d+)\s*章(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?(?:제\s*)?(\d+)\s*[-~–—]\s*(\d+)\s*화(?:\*\*)?(?:[:：-])?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?(?:제\s*)?(\d+)\s*[-~–—]\s*(\d+)\s*장(?:\*\*)?(?:[:：-])?\s*(.*)$/i,
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private isOutlineAnchorLine(line: string): boolean {
    return this.matchAnyExactOutlineLine(line) !== undefined
      || this.matchAnyRangeOutlineLine(line) !== undefined;
  }

  private isChapterWithinRange(startText: string | undefined, endText: string | undefined, chapterNumber: number): boolean {
    const start = Number.parseInt(startText ?? "", 10);
    const end = Number.parseInt(endText ?? "", 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    return chapterNumber >= lower && chapterNumber <= upper;
  }

  private hasKeywordOverlap(left: string, right: string): boolean {
    const keywords = this.extractKeywords(left);
    if (keywords.length === 0) return false;
    const normalizedRight = right.toLowerCase();
    return keywords.some((keyword) => normalizedRight.includes(keyword.toLowerCase()));
  }

  private extractKeywords(content: string): string[] {
    const english = content.match(/[a-z]{4,}/gi) ?? [];
    const chinese = content.match(/[\u4e00-\u9fff]{2,4}/g) ?? [];
    const korean = content.match(/[가-힣]{2,}/g) ?? [];
    return this.unique([...english, ...chinese, ...korean]);
  }

  private renderIntentMarkdown(
    intent: ChapterIntent,
    language: WritingLanguage,
    pendingHooks: string,
    chapterSummaries: string,
    activeHookCount: number,
  ): string {
    const conflictLines = intent.conflicts.length > 0
      ? intent.conflicts.map((conflict) => `- ${conflict.type}: ${conflict.resolution}`).join("\n")
      : "- none";

    const mustKeep = intent.mustKeep.length > 0
      ? intent.mustKeep.map((item) => `- ${item}`).join("\n")
      : "- none";

    const mustAvoid = intent.mustAvoid.length > 0
      ? intent.mustAvoid.map((item) => `- ${item}`).join("\n")
      : "- none";

    const styleEmphasis = intent.styleEmphasis.length > 0
      ? intent.styleEmphasis.map((item) => `- ${item}`).join("\n")
      : "- none";
    const engineDirectives = intent.engineDirectives.length > 0
      ? intent.engineDirectives.map((item) => `- ${item}`).join("\n")
      : "- none";
    const directives = [
      intent.arcDirective ? `- arc: ${intent.arcDirective}` : undefined,
      intent.sceneDirective ? `- scene: ${intent.sceneDirective}` : undefined,
      intent.moodDirective ? `- mood: ${intent.moodDirective}` : undefined,
      intent.titleDirective ? `- title: ${intent.titleDirective}` : undefined,
    ].filter(Boolean).join("\n") || "- none";
    const hookAgenda = [
      "### Must Advance",
      intent.hookAgenda.mustAdvance.length > 0
        ? intent.hookAgenda.mustAdvance.map((item) => `- ${item}`).join("\n")
        : "- none",
      "",
      "### Eligible Resolve",
      intent.hookAgenda.eligibleResolve.length > 0
        ? intent.hookAgenda.eligibleResolve.map((item) => `- ${item}`).join("\n")
        : "- none",
      "",
      "### Stale Debt",
      intent.hookAgenda.staleDebt.length > 0
        ? intent.hookAgenda.staleDebt.map((item) => `- ${item}`).join("\n")
        : "- none",
      "",
      "### Avoid New Hook Families",
      intent.hookAgenda.avoidNewHookFamilies.length > 0
        ? intent.hookAgenda.avoidNewHookFamilies.map((item) => `- ${item}`).join("\n")
        : "- none",
      "",
      this.renderHookBudget(activeHookCount, language),
    ].join("\n");

    return [
      "# Chapter Intent",
      "",
      "## Goal",
      intent.goal,
      "",
      "## Narrative Engine",
      engineDirectives,
      "",
      this.renderEpisodeContract(language),
      "",
      this.renderSceneDesignContract(language),
      "",
      this.renderNarrativeManagementContract(language),
      "",
      "## Outline Node",
      intent.outlineNode ?? "(not found)",
      "",
      "## Must Keep",
      mustKeep,
      "",
      "## Must Avoid",
      mustAvoid,
      "",
      "## Style Emphasis",
      styleEmphasis,
      "",
      "## Structured Directives",
      directives,
      "",
      "## Hook Agenda",
      hookAgenda,
      "",
      "## Conflicts",
      conflictLines,
      "",
      "## Pending Hooks Snapshot",
      pendingHooks,
      "",
      "## Chapter Summaries Snapshot",
      chapterSummaries,
      "",
    ].join("\n");
  }

  private unique(values: ReadonlyArray<string>): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private extractPrioritySentences(content: string | undefined, matcher: RegExp, limit: number): string[] {
    const units = this.splitIntentUnits(content);
    return units
      .filter((unit) => matcher.test(unit))
      .slice(0, limit);
  }

  private splitIntentUnits(content: string | undefined): string[] {
    if (!content) {
      return [];
    }

    const meaningfulLines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) =>
        line.length > 0
        && !line.startsWith("#")
        && !this.isTemplatePlaceholder(line)
        && !/^[-|]+$/.test(line),
      )
      .map((line) => line.startsWith("-") ? this.cleanListItem(line) ?? "" : line)
      .filter(Boolean);

    const units = meaningfulLines.flatMap((line) =>
      line
        .split(/(?<=[.!?。！？])\s+|\s*;\s*|\s*；\s*/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    );

    return this.unique(units);
  }

  private isChineseLanguage(language: string | undefined): boolean {
    return resolveWritingLanguage(language) === "zh";
  }

  private async readFileOrDefault(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件尚未创建)";
    }
  }
}
