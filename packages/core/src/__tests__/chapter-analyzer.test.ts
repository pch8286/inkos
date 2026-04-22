import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChapterAnalyzerAgent } from "../agents/chapter-analyzer.js";
import type { BookConfig } from "../models/book.js";
import { countChapterLength } from "../utils/length-metrics.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

describe("ChapterAnalyzerAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts English chapter content using words instead of characters", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-chapter-analyzer-"));
    const englishContent = "He looked at the sky and waited.";
    const agent = new ChapterAnalyzerAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "english-book",
      title: "English Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 2200,
      language: "en",
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== CHAPTER_TITLE ===",
          "A Quiet Sky",
          "",
          "=== CHAPTER_CONTENT ===",
          englishContent,
          "",
          "=== PRE_WRITE_CHECK ===",
          "",
          "=== POST_SETTLEMENT ===",
          "",
          "=== UPDATED_STATE ===",
          "| Field | Value |",
          "| --- | --- |",
          "| Chapter | 1 |",
          "",
          "=== UPDATED_LEDGER ===",
          "",
          "=== UPDATED_HOOKS ===",
          "| hook_id | status |",
          "| --- | --- |",
          "| h1 | open |",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 1 | A Quiet Sky |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      const output = await agent.analyzeChapter({
        book,
        bookDir,
        chapterNumber: 1,
        chapterContent: englishContent,
      });

      expect(output.wordCount).toBe(countChapterLength(englishContent, "en_words"));
      expect(output.wordCount).toBe(7);
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });

  it("uses English prompts when analyzing imported English chapters", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-chapter-analyzer-en-"));
    const englishContent = "He looked at the sky and waited.";
    const agent = new ChapterAnalyzerAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "english-book",
      title: "English Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 2200,
      language: "en",
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== CHAPTER_TITLE ===",
          "A Quiet Sky",
          "",
          "=== CHAPTER_CONTENT ===",
          englishContent,
          "",
          "=== PRE_WRITE_CHECK ===",
          "",
          "=== POST_SETTLEMENT ===",
          "",
          "=== UPDATED_STATE ===",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 1 |",
          "",
          "=== UPDATED_LEDGER ===",
          "",
          "=== UPDATED_HOOKS ===",
          "| hook_id | status |",
          "| --- | --- |",
          "| h1 | open |",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 1 | A Quiet Sky |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      await agent.analyzeChapter({
        book,
        bookDir,
        chapterNumber: 1,
        chapterContent: englishContent,
        chapterTitle: "A Quiet Sky",
      });

      const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
      expect(messages[0]?.content).toContain("ALL output MUST be in English");
      expect(messages[1]?.content).toContain("Analyze chapter 1");
      expect(messages[1]?.content).toContain("## Chapter Content");
      expect(messages[1]?.content).toContain("## Current State");
      expect(messages[1]?.content).not.toContain("请分析第1章正文");
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });

  it("uses Korean prompts for Korean-language analysis", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-chapter-analyzer-ko-"));
    const koreanContent = "하늘은 먹구름으로 가득했고, 그는 천천히 문을 열었다.";
    const agent = new ChapterAnalyzerAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "korean-book",
      title: "한국 웹소설",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 1800,
      language: "ko" as const,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== CHAPTER_TITLE ===",
          "구름 아래의 결심",
          "",
          "=== CHAPTER_CONTENT ===",
          koreanContent,
          "",
          "=== PRE_WRITE_CHECK ===",
          "",
          "=== POST_SETTLEMENT ===",
          "",
          "=== UPDATED_STATE ===",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 1 |",
          "",
          "=== UPDATED_LEDGER ===",
          "",
          "=== UPDATED_HOOKS ===",
          "| hook_id | status |",
          "| --- | --- |",
          "| h1 | open |",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 1 | 구름 아래의 결심 |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      await agent.analyzeChapter({
        book,
        bookDir,
        chapterNumber: 1,
        chapterContent: koreanContent,
        chapterTitle: "구름 아래의 결심",
      });

      const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
      const systemPrompt = messages[0]?.content ?? "";
      const userPrompt = messages[1]?.content ?? "";

      expect(systemPrompt).toContain("한국어로");
      expect(systemPrompt).toContain("본문에 명시된 사실과 추정한 동기를 구분");
      expect(systemPrompt).toContain("가능성이나 암시는 확정 사실이 아니라");
      expect(systemPrompt).toContain("상태 카드에 보충하지 마세요");
      expect(systemPrompt).not.toContain("请分析");
      expect(userPrompt).toContain("제1화를 분석해 추적 파일을 갱신하세요.");
      expect(userPrompt).toContain("## 챕터 본문");
      expect(userPrompt).toContain("## 현재 상태 카드");
      expect(userPrompt).not.toContain("请严格按照 === TAG === 格式输出分析结果");
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });

  it("keeps the supplied Korean chapter title instead of accepting an inferred title", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-chapter-analyzer-ko-title-"));
    const koreanContent = "그는 문 앞에서 멈췄다.";
    const agent = new ChapterAnalyzerAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "korean-book",
      title: "한국 웹소설",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 1800,
      language: "ko" as const,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== CHAPTER_TITLE ===",
          "모델이 새로 붙인 제목",
          "",
          "=== CHAPTER_CONTENT ===",
          koreanContent,
          "",
          "=== PRE_WRITE_CHECK ===",
          "",
          "=== POST_SETTLEMENT ===",
          "",
          "=== UPDATED_STATE ===",
          "",
          "=== UPDATED_LEDGER ===",
          "",
          "=== UPDATED_HOOKS ===",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 1 | 모델이 새로 붙인 제목 |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      const output = await agent.analyzeChapter({
        book,
        bookDir,
        chapterNumber: 1,
        chapterContent: koreanContent,
        chapterTitle: "원본 제목",
      });

      expect(output.title).toBe("원본 제목");
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });

  it("uses Korean placeholders, headings, and chapter titles", () => {
    const agent = new ChapterAnalyzerAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const analyzer = agent as unknown as {
      missingFilePlaceholder: (language: string) => string;
      defaultChapterTitle: (chapter: number, language: string) => string;
      renderSummarySnapshot: (
        summaries: ReadonlyArray<{
          chapter: number;
          title: string;
          characters: string;
          events: string;
          stateChanges: string;
          hookActivity: string;
          mood: string;
          chapterType: string;
        }>,
        language: string,
      ) => string;
      findOutlineNode: (outline: string, chapter: number, language: string) => string | undefined;
      buildReducedControlBlock: (
        chapterIntent: string,
        contextPackage: {
          readonly selectedContext: ReadonlyArray<{
            source: string;
            reason: string;
            excerpt?: string;
          }>;
          readonly selectedContextScore?: number;
          readonly selectedHookIds?: ReadonlyArray<string>;
        },
        ruleStack: {
          readonly sections: {
            hard: ReadonlyArray<string>;
            soft: ReadonlyArray<string>;
            diagnostic: ReadonlyArray<string>;
          };
          readonly activeOverrides: ReadonlyArray<{
            from: string;
            to: string;
            reason: string;
            target: string;
          }>;
        } & { readonly layers?: ReadonlyArray<unknown>; readonly overrideEdges?: ReadonlyArray<unknown> },
        language: string,
      ) => string;
    };

    expect(analyzer.missingFilePlaceholder("ko")).toBe("(파일이 아직 생성되지 않았습니다)");
    expect(analyzer.defaultChapterTitle(3, "ko")).toBe("제3화");
    expect(analyzer.renderSummarySnapshot([], "ko")).toBe("(파일이 아직 생성되지 않았습니다)");
    expect(analyzer.renderSummarySnapshot([{
      chapter: 1,
      title: "첫 장면",
      characters: "주인공",
      events: "도시를 벗어남",
      stateChanges: "정신이 맑아짐",
      hookActivity: "비밀 단서 확보",
      mood: "긴장",
      chapterType: "전개",
    }], "ko")).toContain("| 화 | 제목 | 등장인물 | 핵심 사건 | 상태 변화 | 훅 활동 | 분위기 | 챕터 타입 |");
    expect(analyzer.findOutlineNode("# 볼륨 아웃라인\n\n## 제1화\n오프닝은 도시를 떠난다", 1, "ko")).toBe("오프닝은 도시를 떠난다");

    expect(analyzer.findOutlineNode("# 卷纲\n\n## 第1章\n오프닝은 도시를 떠난다", 1, "en")).toBe("오프닝은 도시를 떠난다");
    expect(analyzer.findOutlineNode("# 卷纲\n\n## 第1章\n오프닝은 도시를 떠난다", 1, "zh")).toBe("오프닝은 도시를 떠난다");
    expect(analyzer.findOutlineNode("", 1, "ko")).toBeUndefined();

    expect(analyzer.buildReducedControlBlock(
      "# Chapter Intent\n\n- 권선책을 유지한다.",
      {
        selectedContext: [
          {
            source: "story/current_state.md",
            reason: "주요 진행 상태",
          },
        ],
      },
      {
        sections: {
          hard: ["story_bible"],
          soft: ["author_intent"],
          diagnostic: ["clarity"],
        },
        activeOverrides: [
          {
            from: "brief",
            to: "current_focus",
            reason: "긴장 유지",
            target: "focus",
          },
        ],
      } as never,
      "ko",
    )).toContain("본문 제어 입력");
  });

  it("uses a retrieved summary snapshot instead of full long-history chapter summaries", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-chapter-analyzer-memory-"));
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| Chapter | Title | Characters | Key Events | State Changes | Hook Activity | Mood | Chapter Type |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Guild Trail | Lin Yue | Merchant guild flees west | Route clues only | guild-route seeded | tense | action |",
          "| 99 | Mentor Oath | Lin Yue, Mentor Shen | Mentor left without explanation | Oath token matters again | mentor-oath advanced | aching | fallout |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| guild-route | 1 | mystery | open | 2 | 6 | Merchant guild trail |",
          "| mentor-oath | 8 | relationship | open | 99 | 101 | Mentor oath debt |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still carries the oath token.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 100\nReturn to the mentor oath conflict.\n", "utf-8"),
    ]);

    const agent = new ChapterAnalyzerAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== CHAPTER_TITLE ===",
          "Mentor Oath Returns",
          "",
          "=== CHAPTER_CONTENT ===",
          "Lin Yue returned to the mentor oath and the missing explanation.",
          "",
          "=== PRE_WRITE_CHECK ===",
          "",
          "=== POST_SETTLEMENT ===",
          "",
          "=== UPDATED_STATE ===",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 100 |",
          "",
          "=== UPDATED_LEDGER ===",
          "",
          "=== UPDATED_HOOKS ===",
          "| hook_id | status |",
          "| --- | --- |",
          "| h1 | open |",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 100 | Mentor Oath Returns |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const book: BookConfig = {
      id: "english-book",
      title: "English Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 120,
      chapterWordCount: 2200,
      language: "en",
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    try {
      await agent.analyzeChapter({
        book,
        bookDir,
        chapterNumber: 100,
        chapterTitle: "Mentor Oath Returns",
        chapterContent: "Lin Yue returned to the mentor oath and the missing explanation.",
      });

      const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
      const userPrompt = messages[1]?.content ?? "";

      expect(userPrompt).toContain("| 99 | Mentor Oath |");
      expect(userPrompt).not.toContain("| 1 | Guild Trail |");
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });

  it("preserves the supplied chapter content when the model omits CHAPTER_CONTENT", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-chapter-analyzer-fallback-"));
    const chapterContent = "Lin Yue stepped into the archive and kept the real ledger hidden inside his sleeve.";
    const agent = new ChapterAnalyzerAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "english-book",
      title: "English Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 2200,
      language: "en",
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== CHAPTER_TITLE ===",
          "Archive Entry",
          "",
          "=== PRE_WRITE_CHECK ===",
          "",
          "=== POST_SETTLEMENT ===",
          "",
          "=== UPDATED_STATE ===",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 1 |",
          "",
          "=== UPDATED_LEDGER ===",
          "",
          "=== UPDATED_HOOKS ===",
          "| hook_id | status |",
          "| --- | --- |",
          "| h1 | open |",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 1 | Archive Entry |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      const output = await agent.analyzeChapter({
        book,
        bookDir,
        chapterNumber: 1,
        chapterTitle: "Archive Entry",
        chapterContent,
      });

      expect(output.content).toBe(chapterContent);
      expect(output.wordCount).toBe(countChapterLength(chapterContent, "en_words"));
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });

  it("uses governed control inputs instead of old broad truth-file blocks when provided", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-chapter-analyzer-governed-"));
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- Full bible should stay out of governed analyzer prompts.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 100\nReturn to the mentor oath conflict.\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still carries the oath token.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), [
        "# Pending Hooks",
        "",
        "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| guild-route | 1 | mystery | open | 2 | 6 | Merchant guild trail |",
        "| mentor-oath | 8 | relationship | open | 99 | 101 | Mentor oath debt |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), [
        "# Subplot Board",
        "",
        "| subplot | status | last_update | notes |",
        "| --- | --- | --- | --- |",
        "| Guild trail | open | 99 | Still active |",
        "| Harbor tax | resolved | 40 | Closed long ago |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), [
        "# Emotional Arcs",
        "",
        "| chapter | character | emotion | trigger | direction |",
        "| --- | --- | --- | --- | --- |",
        "| 95 | Lin Yue | grief | mentor silence | down |",
        "| 100 | Lin Yue | resolve | oath token | up |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), [
        "# Character Matrix",
        "",
        "### Character Profiles",
        "| character | role | status | notes |",
        "| --- | --- | --- | --- |",
        "| Lin Yue | protagonist | active | carries oath token |",
        "| Mentor Shen | mentor | missing | tied to oath debt |",
        "| Harbor Clerk | clerk | inactive | old tax subplot |",
        "",
      ].join("\n"), "utf-8"),
    ]);

    const agent = new ChapterAnalyzerAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== CHAPTER_TITLE ===",
          "Mentor Oath Returns",
          "",
          "=== CHAPTER_CONTENT ===",
          "Lin Yue returned to the mentor oath and the missing explanation.",
          "",
          "=== PRE_WRITE_CHECK ===",
          "",
          "=== POST_SETTLEMENT ===",
          "",
          "=== UPDATED_STATE ===",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 100 |",
          "",
          "=== UPDATED_LEDGER ===",
          "",
          "=== UPDATED_HOOKS ===",
          "| hook_id | status |",
          "| --- | --- |",
          "| h1 | open |",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 100 | Mentor Oath Returns |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const book: BookConfig = {
      id: "english-book",
      title: "English Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 120,
      chapterWordCount: 2200,
      language: "en",
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    try {
      await agent.analyzeChapter({
        book,
        bookDir,
        chapterNumber: 100,
        chapterTitle: "Mentor Oath Returns",
        chapterContent: "Lin Yue returned to the mentor oath and the missing explanation.",
        chapterIntent: "# Chapter Intent\n\n## Goal\nBring the focus back to the mentor oath conflict.\n",
        contextPackage: {
          chapter: 100,
          selectedContext: [
            {
              source: "story/pending_hooks.md#mentor-oath",
              reason: "Primary hook for this chapter",
              excerpt: "mentor-oath remains unresolved",
            },
            {
              source: "story/chapter_summaries.md#99",
              reason: "Closest relevant summary",
              excerpt: "Mentor oath debt sharpened",
            },
          ],
        },
        ruleStack: {
          layers: [
            { id: "L1", name: "Global", precedence: 1, scope: "global" },
            { id: "L2", name: "Book", precedence: 2, scope: "book" },
          ],
          sections: {
            hard: ["story_bible"],
            soft: ["author_intent"],
            diagnostic: ["anti_ai_checks"],
          },
          overrideEdges: [],
          activeOverrides: [
            {
              from: "brief",
              to: "current_focus",
              reason: "Keep the chapter on the oath debt",
              target: "focus",
            },
          ],
        },
      });

      const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
      const userPrompt = messages[1]?.content ?? "";

      expect(userPrompt).toContain("## Chapter Control Inputs (compiled by Planner/Composer)");
      expect(userPrompt).toContain("story/pending_hooks.md#mentor-oath");
      expect(userPrompt).toContain("Selected Hook Evidence");
      expect(userPrompt).not.toContain("## Story Bible");
      expect(userPrompt).not.toContain("Full bible should stay out of governed analyzer prompts");
      expect(userPrompt).not.toContain("guild-route");
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });
});
