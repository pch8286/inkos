import { BaseAgent } from "./base.js";
import type { ArchitectOutput } from "./architect.js";
import type { WritingLanguage } from "../models/language.js";

export interface FoundationReviewResult {
  readonly passed: boolean;
  readonly totalScore: number;
  readonly dimensions: ReadonlyArray<{
    readonly name: string;
    readonly score: number;
    readonly feedback: string;
  }>;
  readonly overallFeedback: string;
}

const PASS_THRESHOLD = 80;
const DIMENSION_FLOOR = 60;

export class FoundationReviewerAgent extends BaseAgent {
  get name(): string {
    return "foundation-reviewer";
  }

  async review(params: {
    readonly foundation: ArchitectOutput;
    readonly mode: "original" | "fanfic" | "series";
    readonly sourceCanon?: string;
    readonly styleGuide?: string;
    readonly language: WritingLanguage;
  }): Promise<FoundationReviewResult> {
    const canonHeading = params.language === "en"
      ? "## Source Canon Reference"
      : params.language === "ko"
        ? "## 원작 정전 참조"
        : "## 原作正典参照";
    const styleHeading = params.language === "en"
      ? "## Source Style Reference"
      : params.language === "ko"
        ? "## 원작 문체 참조"
        : "## 原作风格参照";
    const canonBlock = params.sourceCanon
      ? `\n${canonHeading}\n${params.sourceCanon.slice(0, 8000)}\n`
      : "";
    const styleBlock = params.styleGuide
      ? `\n${styleHeading}\n${params.styleGuide.slice(0, 2000)}\n`
      : "";

    const dimensions = params.mode === "original"
      ? this.originalDimensions(params.language)
      : this.derivativeDimensions(params.language, params.mode);

    const systemPrompt = params.language === "en"
      ? this.buildEnglishReviewPrompt(dimensions, canonBlock, styleBlock)
      : params.language === "ko"
        ? this.buildKoreanReviewPrompt(dimensions, canonBlock, styleBlock)
        : this.buildChineseReviewPrompt(dimensions, canonBlock, styleBlock);

    const userPrompt = this.buildFoundationExcerpt(params.foundation, params.language);

    const response = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], { maxTokens: 4096, temperature: 0.3 });

    return this.parseReviewResult(response.content, dimensions);
  }

  private originalDimensions(language: WritingLanguage): ReadonlyArray<string> {
    if (language === "en") {
      return [
        "Core Conflict (Is there a clear, compelling central conflict that can sustain 40 chapters?)",
        "Opening Momentum (Can the first 5 chapters create a page-turning hook?)",
        "World Coherence (Is the worldbuilding internally consistent and specific?)",
        "Character Differentiation (Are the main characters distinct in voice and motivation?)",
        "Pacing Feasibility (Does the volume outline have enough variety — not the same beat for 10 chapters?)",
      ];
    }

    if (language === "ko") {
      return [
        "핵심 갈등 (40화 이상 끌고 갈 수 있을 만큼 선명하고 강한 중심 갈등이 있는가?)",
        "초반 흡입력 (첫 5화 안에 다음 화를 누르게 만드는 추진력이 있는가?)",
        "세계관 일관성 (설정이 구체적이고 내부 논리가 맞는가?)",
        "인물 구분도 (주요 인물의 말투, 욕망, 행동 방식이 충분히 구분되는가?)",
        "전개 지속 가능성 (권차 개요가 한 리듬만 반복하지 않고 변주를 낼 수 있는가?)",
      ];
    }

    return [
      "核心冲突（是否有清晰且有足够张力的核心冲突支撑40章？）",
      "开篇节奏（前5章能否形成翻页驱动力？）",
      "世界一致性（世界观是否内洽且具体？）",
      "角色区分度（主要角色的声音和动机是否各不相同？）",
      "节奏可行性（卷纲是否有足够变化——不会连续10章同一种节拍？）",
    ];
  }

  private derivativeDimensions(language: WritingLanguage, mode: "fanfic" | "series"): ReadonlyArray<string> {
    const modeLabel = mode === "fanfic"
      ? (language === "en" ? "Fan Fiction" : language === "ko" ? "동인" : "同人")
      : (language === "en" ? "Series" : language === "ko" ? "시리즈" : "系列");

    if (language === "en") {
      return [
        `Source DNA Preservation (Does the ${modeLabel} respect the original's world rules, character personalities, and established facts?)`,
        `New Narrative Space (Is there a clear divergence point or new territory that gives the story room to be ORIGINAL, not a retelling?)`,
        "Core Conflict (Is the new story's central conflict compelling and distinct from the original?)",
        "Opening Momentum (Can the first 5 chapters create a page-turning hook without requiring 3 chapters of setup?)",
        `Pacing Feasibility (Does the outline avoid the trap of re-walking the original's plot beats?)`,
      ];
    }

    if (language === "ko") {
      return [
        `원작 DNA 보존 (${modeLabel} 기획이 원작의 세계관 규칙, 인물 성격, 확정 사실을 존중하는가?)`,
        "새 서사 공간 (단순 재현이 아니라, 새로운 긴장과 전개 공간을 확보했는가?)",
        "핵심 갈등 (새 이야기의 중심 갈등이 원작과 구분되면서도 충분한 추진력을 갖는가?)",
        "초반 흡입력 (첫 5화 안에 별도 3화짜리 준비운동 없이 바로 끌어당길 수 있는가?)",
        "전개 지속 가능성 (개요가 원작 주요 이벤트를 답습하는 함정 없이 독자적 리듬을 유지하는가?)",
      ];
    }

    return [
      `原作DNA保留（${modeLabel}是否尊重原作的世界规则、角色性格、已确立事实？）`,
      `新叙事空间（是否有明确的分岔点或新领域，让故事有原创空间，而非复述原作？）`,
      "核心冲突（新故事的核心冲突是否有足够张力且区别于原作？）",
      "开篇节奏（前5章能否形成翻页驱动力，不需要3章铺垫？）",
      `节奏可行性（卷纲是否避免了重走原作剧情节拍的陷阱？）`,
    ];
  }

  private buildChineseReviewPrompt(
    dimensions: ReadonlyArray<string>,
    canonBlock: string,
    styleBlock: string,
  ): string {
    return `你是一位资深小说编辑，正在审核一本新书的基础设定（世界观 + 大纲 + 规则）。

你需要从以下维度逐项打分（0-100），并给出具体意见：

${dimensions.map((dim, i) => `${i + 1}. ${dim}`).join("\n")}

## 评分标准
- 80+ 通过，可以开始写作
- 60-79 有明显问题，需要修改
- <60 方向性错误，需要重新设计

## 输出格式（严格遵守）
=== DIMENSION: 1 ===
分数：{0-100}
意见：{具体反馈}

=== DIMENSION: 2 ===
分数：{0-100}
意见：{具体反馈}

...（每个维度一个 block）

=== OVERALL ===
总分：{加权平均}
通过：{是/否}
总评：{1-2段总结，指出最大的问题和最值得保留的优点}
${canonBlock}${styleBlock}

审核时要严格。不要因为"还行"就给高分。80分意味着"可以直接开写，不需要改"。`;
  }

  private buildEnglishReviewPrompt(
    dimensions: ReadonlyArray<string>,
    canonBlock: string,
    styleBlock: string,
  ): string {
    return `You are a senior fiction editor reviewing a new book's foundation (worldbuilding + outline + rules).

Score each dimension (0-100) with specific feedback:

${dimensions.map((dim, i) => `${i + 1}. ${dim}`).join("\n")}

## Scoring
- 80+ Pass — ready to write
- 60-79 Needs revision
- <60 Fundamental direction problem

## Output format (strict)
=== DIMENSION: 1 ===
Score: {0-100}
Feedback: {specific feedback}

=== DIMENSION: 2 ===
Score: {0-100}
Feedback: {specific feedback}

...

=== OVERALL ===
Total: {weighted average}
Passed: {yes/no}
Summary: {1-2 paragraphs — biggest problem and best quality}
${canonBlock}${styleBlock}

Be strict. 80 means "ready to write without changes."`;
  }

  private buildKoreanReviewPrompt(
    dimensions: ReadonlyArray<string>,
    canonBlock: string,
    styleBlock: string,
  ): string {
    return `너는 신작의 기초 설계(세계관 + 개요 + 규칙)를 검토하는 시니어 웹소설 편집자다.

아래 항목을 각각 0-100점으로 채점하고, 구체적인 피드백을 남겨라.

${dimensions.map((dim, i) => `${i + 1}. ${dim}`).join("\n")}

## 채점 기준
- 80점 이상: 통과, 바로 집필 가능
- 60-79점: 보강 필요
- 60점 미만: 방향 재설계 필요

## 출력 형식 (엄수)
=== DIMENSION: 1 ===
점수: {0-100}
의견: {구체적인 피드백}

=== DIMENSION: 2 ===
점수: {0-100}
의견: {구체적인 피드백}

...

=== OVERALL ===
총점: {가중 평균}
통과: {예/아니오}
총평: {가장 큰 문제와 가장 좋은 강점을 1-2문단으로 정리}
${canonBlock}${styleBlock}

채점은 엄격하게 한다. 80점은 "수정 없이 바로 연재를 시작해도 된다"는 뜻이다.`;
  }

  private buildFoundationExcerpt(foundation: ArchitectOutput, language: WritingLanguage): string {
    if (language === "en") {
      return `## Story Bible\n${foundation.storyBible.slice(0, 3000)}\n\n## Volume Outline\n${foundation.volumeOutline.slice(0, 3000)}\n\n## Book Rules\n${foundation.bookRules.slice(0, 1500)}\n\n## Initial State\n${foundation.currentState.slice(0, 1000)}\n\n## Initial Hooks\n${foundation.pendingHooks.slice(0, 1000)}`;
    }
    if (language === "ko") {
      return `## 세계관\n${foundation.storyBible.slice(0, 3000)}\n\n## 권차 개요\n${foundation.volumeOutline.slice(0, 3000)}\n\n## 책 규칙\n${foundation.bookRules.slice(0, 1500)}\n\n## 초기 상태\n${foundation.currentState.slice(0, 1000)}\n\n## 초기 떡밥\n${foundation.pendingHooks.slice(0, 1000)}`;
    }
    return `## 世界设定\n${foundation.storyBible.slice(0, 3000)}\n\n## 卷纲\n${foundation.volumeOutline.slice(0, 3000)}\n\n## 规则\n${foundation.bookRules.slice(0, 1500)}\n\n## 初始状态\n${foundation.currentState.slice(0, 1000)}\n\n## 初始伏笔\n${foundation.pendingHooks.slice(0, 1000)}`;
  }

  private parseReviewResult(
    content: string,
    dimensions: ReadonlyArray<string>,
  ): FoundationReviewResult {
    const parsedDimensions: Array<{ readonly name: string; readonly score: number; readonly feedback: string }> = [];

    for (let i = 0; i < dimensions.length; i++) {
      const regex = new RegExp(
        `=== DIMENSION: ${i + 1} ===\\s*[\\s\\S]*?(?:分数|Score|점수)[：:]\\s*(\\d+)[\\s\\S]*?(?:意见|Feedback|의견)[：:]\\s*([\\s\\S]*?)(?==== |$)`,
      );
      const match = content.match(regex);
      parsedDimensions.push({
        name: dimensions[i]!,
        score: match ? parseInt(match[1]!, 10) : 50,
        feedback: match ? match[2]!.trim() : "(parse failed)",
      });
    }

    const totalScore = parsedDimensions.length > 0
      ? Math.round(parsedDimensions.reduce((sum, d) => sum + d.score, 0) / parsedDimensions.length)
      : 0;
    const anyBelowFloor = parsedDimensions.some((d) => d.score < DIMENSION_FLOOR);
    const passed = totalScore >= PASS_THRESHOLD && !anyBelowFloor;

    const overallMatch = content.match(
      /=== OVERALL ===[\s\S]*?(?:总评|Summary|총평)[：:]\s*([\s\S]*?)$/,
    );
    const overallFeedback = overallMatch ? overallMatch[1]!.trim() : "(parse failed)";

    return { passed, totalScore, dimensions: parsedDimensions, overallFeedback };
  }
}
