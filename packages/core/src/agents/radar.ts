import { BaseAgent } from "./base.js";
import type { Platform, Genre } from "../models/book.js";
import { resolveWritingLanguage, type WritingLanguage } from "../models/language.js";
import type { RadarSource, PlatformRankings } from "./radar-source.js";
import { defaultRadarSourcesForLanguage } from "./radar-source.js";

export type RadarMode = "market-trends" | "idea-mining" | "fit-check";

export interface RadarResult {
  readonly recommendations: ReadonlyArray<RadarRecommendation>;
  readonly marketSummary: string;
  readonly timestamp: string;
}

export interface RadarRecommendation {
  readonly platform: Platform;
  readonly genre: Genre;
  readonly concept: string;
  readonly confidence: number;
  readonly reasoning: string;
  readonly benchmarkTitles: ReadonlyArray<string>;
}

function localizeRadarText(
  language: WritingLanguage,
  messages: { zh: string; en: string; ko?: string },
): string {
  if (language === "en") return messages.en;
  if (language === "ko") return messages.ko ?? messages.en;
  return messages.zh;
}

function formatRankingsForPrompt(
  rankings: ReadonlyArray<PlatformRankings>,
  language: WritingLanguage,
): string {
  const sections = rankings
    .filter((r) => r.entries.length > 0)
    .map((r) => {
      const lines = r.entries.map(
        (e) => `- ${e.title}${e.author ? ` (${e.author})` : ""}${e.category ? ` [${e.category}]` : ""} ${e.extra}`,
      );
      return `### ${r.platform}\n${lines.join("\n")}`;
    });

  return sections.length > 0
    ? sections.join("\n\n")
    : localizeRadarText(language, {
      zh: "（未能获取到实时排行数据，请基于你的知识分析）",
      en: "(No live ranking data was fetched. Analyze based on your knowledge and any available context.)",
      ko: "(실시간 랭킹 데이터를 가져오지 못했습니다. 사용 가능한 맥락과 모델의 지식을 바탕으로 분석하세요.)",
    });
}

function buildRadarSystemPrompt(
  rankingsText: string,
  language: WritingLanguage,
  mode: RadarMode,
  externalContext?: string,
): string {
  const contextHintKo = externalContext
    ? `\n\n현재 입력 방향:\n${externalContext}`
    : "";
  const contextHintEn = externalContext
    ? `\n\nCurrent concept:\n${externalContext}`
    : "";
  const contextHintZh = externalContext
    ? `\n\n当前方向:\n${externalContext}`
    : "";

  if (language === "ko") {
    if (mode === "idea-mining") {
      return `당신은 한국 웹소설 아이디어 스캐너입니다. 아래 실시간 랭킹 데이터는 검색 가능한 실제 데이터입니다. 시장에서 바로 시도 가능한 신작 아이디어를 찾아 제안하세요.

## 실시간 랭킹 데이터

${rankingsText}${contextHintKo}

요구사항:
1. 과포화된 영역에서 벗어나 차별화 포인트를 찾으세요.
2. 3~5개의 실행 가능한 시작 콘셉트를 제안합니다.
3. 각 콘셉트별 진입 훅, 비교작, 위험 요소를 reasoning에 담습니다.
4. 너무 추상적인 아이디어는 배제하고, 실제 랭킹 근거로 지지되는 제안만 남깁니다.

출력은 반드시 JSON입니다:
{
  "recommendations": [
    {
      "platform": "플랫폼명",
      "genre": "장르",
      "concept": "한 줄 콘셉트",
      "confidence": 0.0-1.0,
      "reasoning": "제안 이유(랭킹 근거 포함)",
      "benchmarkTitles": ["비교작1", "비교작2"]
    }
  ],
  "marketSummary": "아이디어 발굴 관점의 시장 요약"
}

추천 수는 3~5개이며 confidence 내림차순으로 정렬합니다.
모든 설명 문장과 요약은 한국어로 작성하세요. JSON 키 이름은 그대로 유지하세요.`;
    }

    if (mode === "fit-check") {
      return `당신은 한국 웹소설 시장 적합도 평가자입니다. 아래 실시간 랭킹 데이터로 현재 아이디어의 출시 적합도를 평가하세요.${contextHintKo}

## 실시간 랭킹 데이터

${rankingsText}

평가 기준:
1. 상위권 독자 반응이 강한 장르/태그와의 정렬 정도
2. 경쟁 밀도, 진입 리스크, 차별화 포인트
3. 현재 방향을 살리면서 강한 시장 접점을 만들 수 있는 조정안
4. 다음 단계에서 바로 적용 가능한 체크리스트를 제안

출력은 반드시 JSON입니다:
{
  "recommendations": [
    {
      "platform": "판단 근거 플랫폼",
      "genre": "적합성 점검 장르",
      "concept": "보완이 반영된 방향",
      "confidence": 0.0-1.0,
      "reasoning": "적합도 판단 근거(랭킹/독자 반응 관점)",
      "benchmarkTitles": ["비교작1", "비교작2"]
    }
  ],
  "marketSummary": "현재 작품/개념의 시장 적합도 요약"
}

추천 수는 1~3개로 제한하고 confidence 내림차순으로 정렬합니다.
모든 설명 문장과 요약은 한국어로 작성하세요. JSON 키 이름은 그대로 유지하세요.`;
    }

    return `당신은 전문 한국 웹소설 시장 분석가입니다. 아래는 한국 플랫폼에서 수집한 실시간 랭킹 데이터입니다. 현재 시장 흐름을 분석하세요.

## 실시간 랭킹 데이터

${rankingsText}${contextHintKo}

분석 기준:
1. 랭킹 데이터에서 현재 강세인 소재와 태그를 식별합니다.
2. 어떤 유형의 작품이 상위권을 차지하는지 설명합니다.
3. 시장 공백과 기회 포인트를 정리합니다.
4. 과포화된 소재와 진입 리스크도 함께 정리합니다.

출력은 반드시 JSON입니다:
{
  "recommendations": [
    {
      "platform": "플랫폼명",
      "genre": "장르",
      "concept": "한 줄 콘셉트",
      "confidence": 0.0-1.0,
      "reasoning": "추천 이유(구체적인 랭킹 근거 포함)",
      "benchmarkTitles": ["비교작1", "비교작2"]
    }
  ],
  "marketSummary": "실제 랭킹 데이터 기반 시장 요약"
}

추천 수는 3~5개이며 confidence 내림차순으로 정렬합니다.
모든 설명 문장과 요약은 한국어로 작성하세요. JSON 키 이름은 그대로 유지하세요.`;
  }

  if (language === "en") {
    if (mode === "idea-mining") {
      return `You are a web-fiction idea mining analyst. Using the live ranking data, identify launch-ready concepts that are distinct from current saturation.

## Live Ranking Data

${rankingsText}${contextHintEn}

Requirements:
1. Propose 3-5 concrete launch concepts with clear hooks.
2. Note why each concept has room in current charts.
3. Include feasibility and differentiation in reasoning.

Output must be valid JSON:
{
  "recommendations": [
    {
      "platform": "platform name",
      "genre": "genre",
      "concept": "one-line concept",
      "confidence": 0.0-1.0,
      "reasoning": "why it is promising (with chart evidence)",
      "benchmarkTitles": ["comp title 1", "comp title 2"]
    }
  ],
  "marketSummary": "market opportunities from current ranking trends"
}

Return 3-5 recommendations sorted by confidence descending.
Write all explanatory text in English while keeping JSON keys unchanged.`;
    }

    if (mode === "fit-check") {
      return `You are a launch-readiness reviewer for an existing concept. Use the live ranking data to assess market fit.${contextHintEn}

## Live Ranking Data

${rankingsText}

Evaluation:
1. Compare current concept with current high-performing themes.
2. Identify risks: crowding, weak hooks, or weak differentiation.
3. Suggest short action items to improve fit.

Output must be valid JSON:
{
  "recommendations": [
    {
      "platform": "reference platform",
      "genre": "fit-check target genre",
      "concept": "reframed concept",
      "confidence": 0.0-1.0,
      "reasoning": "fit assessment with ranking evidence",
      "benchmarkTitles": ["comp title 1", "comp title 2"]
    }
  ],
  "marketSummary": "market-fit diagnosis and adjustment notes"
}

Return 1-3 recommendations sorted by confidence descending.
Write all explanatory text in English while keeping JSON keys unchanged.`;
    }

    return `You are a professional web fiction market analyst. Below is live ranking data collected from multiple platforms. Analyze the current market using the real data.

## Live Ranking Data

${rankingsText}${contextHintEn}

Analysis requirements:
1. Identify the themes and tags that are currently winning on the rankings
2. Explain what kinds of titles are occupying the top slots
3. Find whitespace opportunities and underserved directions
4. Flag overcrowded themes or market risks

The output MUST be valid JSON:
{
  "recommendations": [
    {
      "platform": "platform name",
      "genre": "genre",
      "concept": "one-line concept",
      "confidence": 0.0-1.0,
      "reasoning": "why it fits, citing concrete ranking evidence",
      "benchmarkTitles": ["comp title 1", "comp title 2"]
    }
  ],
  "marketSummary": "overall market summary based on the real ranking data"
}

Return 3-5 recommendations sorted by confidence descending.
Write all explanatory text in English while keeping the JSON keys unchanged.`;
  }

  if (mode === "idea-mining") {
    return `你是网络小说点子挖掘分析师。以下是实时排行榜数据，请给出可落地的新题材方向。

## 实时排行榜数据

${rankingsText}${contextHintZh}

要求：
1. 提供 3~5 个可直接启动的独特方向
2. 每个方向给出差异点与可复制性
3. 在 reasoning 中写明为什么这个方向未过饱和并能切入

输出必须为 JSON：
{
  "recommendations": [
    {
      "platform": "平台名",
      "genre": "题材",
      "concept": "一句话概念",
      "confidence": 0.0-1.0,
      "reasoning": "为什么值得启动（结合榜单证据）",
      "benchmarkTitles": ["对标书1", "对标书2"]
    }
  ],
  "marketSummary": "机会点和可落地方向"
}

返回 3~5 个，按 confidence 降序排序。`;
  }

  if (mode === "fit-check") {
    return `你是作品市场适配评估师。请基于实时排行榜评估当前方向是否具备发布适配度。${contextHintZh}

## 实时排行榜数据

${rankingsText}

评估项：
1. 与主流高频方向的匹配程度
2. 竞争拥堵点和差异化缺口
3. 改进优先级和执行检查清单

输出必须为 JSON：
{
  "recommendations": [
    {
      "platform": "参考平台",
      "genre": "评估方向",
      "concept": "优化后方向",
      "confidence": 0.0-1.0,
      "reasoning": "适配度评估与榜单依据",
      "benchmarkTitles": ["对标书1", "对标书2"]
    }
  ],
  "marketSummary": "适配度结论与下一步动作"
}

返回 1~3 个，按 confidence 降序排序。`;
  }

  return `你是一个专业的网络小说市场分析师。下面是从各平台实时抓取的排行榜数据，请基于这些真实数据分析市场趋势。

## 实时排行榜数据

${rankingsText}${contextHintZh}

分析维度：
1. 从排行榜数据中识别当前热门题材和标签
2. 分析哪些类型的作品占据榜单高位
3. 发现市场空白和机会点
4. 风险提示

输出格式必须为 JSON：
{
  "recommendations": [
    {
      "platform": "平台名",
      "genre": "题材类型",
      "concept": "一句话概念描述",
      "confidence": 0.0-1.0,
      "reasoning": "推荐理由（引用具体榜单数据）",
      "benchmarkTitles": ["对标书1", "对标书2"]
    }
  ],
  "marketSummary": "整体市场概述（基于真实榜单数据）"
}

推荐数量：3~5个，按 confidence 降序排列。`;
}

function buildRadarUserPrompt(
  language: WritingLanguage,
  mode: RadarMode,
  externalContext?: string,
): string {
  if (mode === "fit-check") {
    const suffix = externalContext
      ? localizeRadarText(language, {
        zh: `\\n\\n当前方向:\\n${externalContext}`,
        en: `\\n\\nCurrent direction:\\n${externalContext}`,
        ko: `\\n\\n현재 방향:\\n${externalContext}`,
      })
      : "";
    return localizeRadarText(language, {
      zh: `请按 fit-check 模式给出结果。`,
      en: "Run this as a fit-check mode.",
      ko: "fit-check 모드로 결과를 출력하세요.",
    }) + suffix;
  }

  if (mode === "idea-mining") {
    return localizeRadarText(language, {
      zh: "请按 idea-mining 模式给出新选题建议。",
      en: "Run this as an idea-mining mode.",
      ko: "idea-mining 모드로 아이디어 중심 추천을 생성하세요.",
    });
  }

  return localizeRadarText(language, {
    zh: "请按 market-trends 模式给出市场趋势报告。",
    en: "Run this as a market-trends mode.",
    ko: "market-trends 모드로 시장 트렌드 리포트를 생성하세요.",
  });
}

function formatRadarParseError(language: WritingLanguage, message: string): string {
  if (language === "ko") {
    return `레이더 응답 JSON 파싱 오류: ${message}`;
  }

  return message;
}

export class RadarAgent extends BaseAgent {
  private readonly sources: ReadonlyArray<RadarSource>;
  private readonly language: WritingLanguage;

  constructor(
    ctx: ConstructorParameters<typeof BaseAgent>[0],
    languageOrSources?: WritingLanguage | ReadonlyArray<RadarSource>,
    sources?: ReadonlyArray<RadarSource>,
  ) {
    super(ctx);
    if (Array.isArray(languageOrSources)) {
      this.language = "ko";
      this.sources = languageOrSources;
      return;
    }

    const language = typeof languageOrSources === "string" ? languageOrSources : undefined;
    this.language = resolveWritingLanguage(language);
    this.sources = sources ?? defaultRadarSourcesForLanguage(this.language);
  }

  get name(): string {
    return "radar";
  }

  async scan(
    mode: RadarMode = "market-trends",
    externalContext?: string,
  ): Promise<RadarResult> {
    const rankings = await Promise.all(this.sources.map((s) => s.fetch()));
    const rankingsText = formatRankingsForPrompt(rankings, this.language);
    const systemPrompt = buildRadarSystemPrompt(rankingsText, this.language, mode, externalContext);

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: buildRadarUserPrompt(this.language, mode, externalContext),
        },
      ],
      { temperature: 0.6, maxTokens: 4096 },
    );

    return this.parseResult(response.content);
  }

  private parseResult(content: string): RadarResult {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(formatRadarParseError(this.language, "Radar output format error: no JSON object was found in response."));
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        recommendations: parsed.recommendations ?? [],
        marketSummary: parsed.marketSummary ?? "",
        timestamp: new Date().toISOString(),
      };
    } catch (e) {
      throw new Error(formatRadarParseError(this.language, `Radar JSON parse error: ${e}`));
    }
  }
}
