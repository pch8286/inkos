import { afterEach, describe, expect, it, vi } from "vitest";
import { RadarAgent } from "../agents/radar.js";
import type { RadarSource } from "../agents/radar-source.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

function createSource(entries: ReadonlyArray<{
  readonly title: string;
  readonly author?: string;
  readonly category?: string;
  readonly extra?: string;
}>): RadarSource {
  return {
    name: "test-source",
    async fetch() {
      return {
        platform: "테스트 플랫폼",
        entries: entries.map((entry) => ({
          title: entry.title,
          author: entry.author ?? "",
          category: entry.category ?? "",
          extra: entry.extra ?? "",
        })),
      };
    },
  };
}

describe("RadarAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses Korean prompts for Korean-language radar scans", async () => {
    const agent = new RadarAgent(
      {
        client: {
          provider: "openai",
          apiFormat: "chat",
          stream: false,
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            thinkingBudget: 0,
            maxTokensCap: null,
            extra: {},
          },
        },
        model: "test-model",
        projectRoot: process.cwd(),
      },
      "ko",
      [createSource([{ title: "회귀한 헌터", author: "작가A", category: "현대판타지", extra: "[인기]" }])],
    );

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: JSON.stringify({
          recommendations: [],
          marketSummary: "한국어 요약",
        }),
        usage: ZERO_USAGE,
      });

    const result = await agent.scan();

    const messages = chatSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("전문 한국 웹소설 시장 분석가");
    expect(messages[0]?.content).toContain("모든 설명 문장과 요약은 한국어로 작성하세요");
    expect(messages[0]?.content).not.toContain("你是一个专业的网络小说市场分析师");
    expect(result.marketSummary).toBe("한국어 요약");
  });

  it("uses an English fallback message when no ranking data is available", async () => {
    const agent = new RadarAgent(
      {
        client: {
          provider: "openai",
          apiFormat: "chat",
          stream: false,
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            thinkingBudget: 0,
            maxTokensCap: null,
            extra: {},
          },
        },
        model: "test-model",
        projectRoot: process.cwd(),
      },
      "en",
      [createSource([])],
    );

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: JSON.stringify({
          recommendations: [],
          marketSummary: "English summary",
        }),
        usage: ZERO_USAGE,
      });

    await agent.scan();

    const messages = chatSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("No live ranking data was fetched");
    expect(messages[0]?.content).toContain("Write all explanatory text in English");
    expect(messages[0]?.content).toContain("professional web fiction market analyst");
  });

  it("uses idea-mining prompts for idea-mining mode", async () => {
    const agent = new RadarAgent(
      {
        client: {
          provider: "openai",
          apiFormat: "chat",
          stream: false,
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            thinkingBudget: 0,
            maxTokensCap: null,
            extra: {},
          },
        },
        model: "test-model",
        projectRoot: process.cwd(),
      },
      "ko",
      [createSource([{ title: "아이디어 제목", author: "작가A", category: "현대판타지", extra: "[추천]" }])],
    );

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: JSON.stringify({
          recommendations: [],
          marketSummary: "아이디어 요약",
        }),
        usage: ZERO_USAGE,
      });

    await agent.scan("idea-mining");

    const messages = chatSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("아이디어 발굴 관점");
    expect(messages[0]?.content).toContain("아이디어 발굴");
    expect(messages[0]?.content).toContain("3~5");
  });

  it("uses fit-check prompts for fit-check mode", async () => {
    const agent = new RadarAgent(
      {
        client: {
          provider: "openai",
          apiFormat: "chat",
          stream: false,
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            thinkingBudget: 0,
            maxTokensCap: null,
            extra: {},
          },
        },
        model: "test-model",
        projectRoot: process.cwd(),
      },
      "en",
      [createSource([{ title: "Market title", author: "authorA", category: "Fantasy", extra: "[hot]" }])],
    );

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: JSON.stringify({
          recommendations: [],
          marketSummary: "fit-check summary",
        }),
        usage: ZERO_USAGE,
      });

    await agent.scan("fit-check", "A mage protagonist enters a modern world with no magic system.");

    const messages = chatSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("fit-check");
    expect(messages[1]?.content).toContain("Current direction:");
    expect(messages[0]?.content).toContain("Return 1-3 recommendations");
  });

  it("keeps supporting the legacy constructor that passes sources as the second argument", async () => {
    const agent = new RadarAgent(
      {
        client: {
          provider: "openai",
          apiFormat: "chat",
          stream: false,
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            thinkingBudget: 0,
            maxTokensCap: null,
            extra: {},
          },
        },
        model: "test-model",
        projectRoot: process.cwd(),
      },
      [createSource([{ title: "legacy-only-title", extra: "[legacy]" }])],
    );

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: JSON.stringify({
          recommendations: [],
          marketSummary: "legacy summary",
        }),
        usage: ZERO_USAGE,
      });

    await agent.scan();

    const messages = chatSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("legacy-only-title");
  });

  it("localizes parse errors for Korean radar scans", async () => {
    const agent = new RadarAgent(
      {
        client: {
          provider: "openai",
          apiFormat: "chat",
          stream: false,
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            thinkingBudget: 0,
            maxTokensCap: null,
            extra: {},
          },
        },
        model: "test-model",
        projectRoot: process.cwd(),
      },
      "ko",
      [createSource([])],
    );

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: "not-json",
        usage: ZERO_USAGE,
      });

    await expect(agent.scan()).rejects.toThrow("레이더 응답 JSON 파싱 오류");
  });
});
