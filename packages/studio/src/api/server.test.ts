import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const schedulerStartMock = vi.fn<() => Promise<void>>();
const initBookMock = vi.fn();
const runRadarMock = vi.fn();
const createLLMClientMock = vi.fn(() => ({}));
const chatCompletionMock = vi.fn();
const loadProjectConfigMock = vi.fn();
const pipelineConfigs: unknown[] = [];
const globalEnvPath = join(tmpdir(), "inkos-global.env");

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@actalk/inkos-core", () => {
  class MockStateManager {
    constructor(private readonly root: string) {}

    async listBooks(): Promise<string[]> {
      try {
        const entries = await readdir(join(this.root, "books"));
        const books: string[] = [];
        for (const entry of entries) {
          try {
            await access(join(this.root, "books", entry, "book.json"));
            books.push(entry);
          } catch {
            // Ignore non-book directories.
          }
        }
        return books;
      } catch {
        return [];
      }
    }

    async loadBookConfig(id: string): Promise<Record<string, unknown>> {
      return JSON.parse(await readFile(join(this.root, "books", id, "book.json"), "utf-8")) as Record<string, unknown>;
    }

    async saveBookConfig(id: string, config: unknown): Promise<void> {
      const bookDir = join(this.root, "books", id);
      await mkdir(bookDir, { recursive: true });
      await writeFile(join(bookDir, "book.json"), JSON.stringify(config, null, 2), "utf-8");
    }

    async loadChapterIndex(): Promise<[]> {
      return [];
    }

    async getNextChapterNumber(): Promise<number> {
      return 1;
    }

    bookDir(id: string): string {
      return join(this.root, "books", id);
    }
  }

  class MockPipelineRunner {
    constructor(config: unknown) {
      pipelineConfigs.push(config);
    }

    initBook = initBookMock;
    runRadar = runRadarMock;
  }

  class MockScheduler {
    private running = false;

    constructor(_config: unknown) {}

    async start(): Promise<void> {
      this.running = true;
      await schedulerStartMock();
    }

    stop(): void {
      this.running = false;
    }

    get isRunning(): boolean {
      return this.running;
    }
  }

  return {
    StateManager: MockStateManager,
    PipelineRunner: MockPipelineRunner,
    Scheduler: MockScheduler,
    createLLMClient: createLLMClientMock,
    createLogger: vi.fn((options?: { tag?: string; sinks?: Array<{ write: (entry: { level: string; tag: string; message: string; timestamp: string }) => void }> }) => {
      const tag = options?.tag ?? "studio";
      const sinks = options?.sinks ?? [];
      const emit = (level: "info" | "warn" | "error", message: string) => {
        logger[level](message);
        for (const sink of sinks) {
          sink.write({
            level,
            tag,
            message,
            timestamp: new Date().toISOString(),
          });
        }
      };
      return {
        child: () => logger,
        info: vi.fn((message: string) => emit("info", message)),
        warn: vi.fn((message: string) => emit("warn", message)),
        error: vi.fn((message: string) => emit("error", message)),
      };
    }),
    computeAnalytics: vi.fn(() => ({})),
    chatCompletion: chatCompletionMock,
    loadProjectConfig: loadProjectConfigMock,
    GLOBAL_CONFIG_DIR: tmpdir(),
    GLOBAL_ENV_PATH: globalEnvPath,
  };
});

  const projectConfig = {
  name: "studio-test",
  version: "0.1.0",
  language: "zh",
  llm: {
    provider: "openai",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-5.4",
    temperature: 0.7,
    maxTokens: 4096,
    stream: false,
  },
  daemon: {
    schedule: {
      radarCron: "0 */6 * * *",
      writeCron: "*/15 * * * *",
    },
    maxConcurrentBooks: 1,
    chaptersPerCycle: 1,
    retryDelayMs: 30000,
    cooldownAfterChapterMs: 0,
    maxChaptersPerDay: 50,
  },
  modelOverrides: {},
  notify: [],
} as const;

function cloneProjectConfig() {
  return structuredClone(projectConfig);
}

async function seedFitCheckBook(
  rootPath: string,
  id: string,
  title: string,
  files: ReadonlyArray<{ readonly file: string; readonly content: string }>,
): Promise<void> {
  const bookDir = join(rootPath, "books", id);
  const storyDir = join(bookDir, "story");
  await mkdir(storyDir, { recursive: true });
  await writeFile(
    join(bookDir, "book.json"),
    JSON.stringify({
      id,
      title,
      platform: "naver-webnovel",
      genre: "korean-fantasy",
      status: "outlining",
      targetChapters: 30,
      chapterWordCount: 3000,
      language: "ko",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }, null, 2),
    "utf-8",
  );
  await Promise.all(files.map(async ({ file, content }) => {
    await writeFile(join(storyDir, file), content, "utf-8");
  }));
}

describe("createStudioServer daemon lifecycle", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-server-"));
    await writeFile(join(root, "inkos.json"), JSON.stringify(projectConfig, null, 2), "utf-8");
    logger.info.mockReset();
    logger.warn.mockReset();
    logger.error.mockReset();
    schedulerStartMock.mockReset();
    initBookMock.mockReset();
    initBookMock.mockResolvedValue(undefined);
    runRadarMock.mockReset();
    runRadarMock.mockResolvedValue({
      marketSummary: "Fresh market summary",
      recommendations: [],
    });
    createLLMClientMock.mockReset();
    createLLMClientMock.mockReturnValue({});
    chatCompletionMock.mockReset();
    chatCompletionMock.mockResolvedValue({
      content: "pong",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    loadProjectConfigMock.mockReset();
    loadProjectConfigMock.mockImplementation(async () => {
      const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8")) as Record<string, unknown>;
      return {
        ...cloneProjectConfig(),
        ...raw,
        llm: {
          ...cloneProjectConfig().llm,
          ...((raw.llm ?? {}) as Record<string, unknown>),
        },
        daemon: {
          ...cloneProjectConfig().daemon,
          ...((raw.daemon ?? {}) as Record<string, unknown>),
        },
        modelOverrides: (raw.modelOverrides ?? {}) as Record<string, unknown>,
        notify: (raw.notify ?? []) as unknown[],
      };
    });
    pipelineConfigs.length = 0;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(globalEnvPath, { force: true });
  });

  it("returns from /api/daemon/start before the first write cycle finishes", async () => {
    let resolveStart: (() => void) | undefined;
    schedulerStartMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve;
        }),
    );

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const responseOrTimeout = await Promise.race([
      app.request("http://localhost/api/daemon/start", { method: "POST" }),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 120)),
    ]);

    expect(responseOrTimeout).not.toBe("timeout");

    const response = responseOrTimeout as Response;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, running: true });

    const status = await app.request("http://localhost/api/daemon");
    await expect(status.json()).resolves.toEqual({ running: true });

    resolveStart?.();
  });

  it("rejects book routes with path traversal ids", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/..%2Fetc%2Fpasswd", {
      method: "GET",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_BOOK_ID",
        message: 'Invalid book ID: "../etc/passwd"',
      },
    });
  });

  it("reflects project edits immediately without restarting the studio server", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const save = await app.request("http://localhost/api/project", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "codex-cli",
        model: "gpt-5.3-codex-spark",
        reasoningEffort: "xhigh",
        baseUrl: "",
        language: "en",
        temperature: 0.2,
        maxTokens: 2048,
        stream: true,
      }),
    });

    expect(save.status).toBe(200);

    const project = await app.request("http://localhost/api/project");
    await expect(project.json()).resolves.toMatchObject({
      provider: "codex-cli",
      model: "gpt-5.3-codex-spark",
      reasoningEffort: "xhigh",
      baseUrl: "",
      language: "en",
      temperature: 0.2,
      maxTokens: 2048,
      stream: true,
    });
  });

  it("reloads latest llm config for doctor checks without restarting the studio server", async () => {
    const startupConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "stale-model",
        baseUrl: "https://stale.example.com/v1",
      },
    };

    const freshConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "fresh-model",
        baseUrl: "https://fresh.example.com/v1",
      },
    };
    loadProjectConfigMock.mockResolvedValue(freshConfig);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(startupConfig as never, root);

    const response = await app.request("http://localhost/api/doctor");

    expect(response.status).toBe(200);
    expect(createLLMClientMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "fresh-model",
      baseUrl: "https://fresh.example.com/v1",
    }));
    expect(chatCompletionMock).toHaveBeenCalledWith(
      expect.anything(),
      "fresh-model",
      expect.any(Array),
      expect.objectContaining({ maxTokens: 5 }),
    );
  });

  it("reloads latest llm config for radar scans without restarting the studio server", async () => {
    const startupConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "stale-model",
        baseUrl: "https://stale.example.com/v1",
      },
    };

    const freshConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "fresh-model",
        baseUrl: "https://fresh.example.com/v1",
      },
    };
    loadProjectConfigMock.mockResolvedValue(freshConfig);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(startupConfig as never, root);

    const response = await app.request("http://localhost/api/radar/scan", {
      method: "POST",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() => {
      expect(runRadarMock).toHaveBeenCalledTimes(1);
    });
    expect(pipelineConfigs.at(-1)).toMatchObject({
      model: "fresh-model",
      language: "zh",
      defaultLLMConfig: expect.objectContaining({
        model: "fresh-model",
        baseUrl: "https://fresh.example.com/v1",
      }),
    });
  });

  it("passes radar mode from request body to pipeline runner", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/radar/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "idea-mining" }),
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() => {
      expect(runRadarMock).toHaveBeenCalledTimes(1);
    });
    expect(runRadarMock).toHaveBeenCalledWith("idea-mining", undefined);
  });

  it("builds fit-check context from selected book and stores metadata", async () => {
    await seedFitCheckBook(root, "fit-check-book", "전생했더니-lv1-마왕", [
      { file: "author_intent.md", content: "# 작가 의도\n\n오래 살아남는 방식으로 세계 권력과 협상한다." },
      { file: "current_focus.md", content: "# 현재 포커스\n\n회귀 후의 제1분기 확장 동력과 신분 상승 루트 구축." },
      { file: "story_bible.md", content: "# story_bible\n\n주인공은 야수형 인간으로 각성한다." },
      { file: "volume_outline.md", content: "# volume_outline\n\n1권: 생존기획." },
      { file: "book_rules.md", content: "# book_rules\n\n금지사항: 비현실적한 개입 금지." },
      { file: "current_state.md", content: "# current_state\n\n현재 2화 완료." },
      { file: "pending_hooks.md", content: "# pending_hooks\n\n새로운 봉인 장치의 단서 존재." },
    ]);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);
    const response = await app.request("http://localhost/api/radar/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "fit-check",
        bookId: "fit-check-book",
        context: "유저 노트: 초반부는 체력 시스템을 강조해야 함.",
      }),
    });

    expect(response.status).toBe(202);

    await vi.waitFor(async () => {
      expect(runRadarMock).toHaveBeenCalledTimes(1);
      const [mode, context] = runRadarMock.mock.calls[0] as [string, string | undefined];
      expect(mode).toBe("fit-check");
      expect(context).toContain("## author_intent.md");
      expect(context).toContain("오래 살아남는 방식");
      expect(context).toContain("유저 노트: 초반부는 체력 시스템을 강조해야 함.");
      const historyResponse = await app.request("http://localhost/api/radar/history");
      const body = await historyResponse.json() as { scans: Array<{ fitCheckMetadata?: { bookId: string; bookTitle: string; sourceFiles: string[]; note: string | null; contextLength: number; contextPreview: string } }> };
      expect(body.scans[0]).toMatchObject({
        mode: "fit-check",
        fitCheckMetadata: {
          bookId: "fit-check-book",
          bookTitle: "전생했더니-lv1-마왕",
          note: "유저 노트: 초반부는 체력 시스템을 강조해야 함.",
          sourceFiles: [
            "author_intent.md",
            "current_focus.md",
            "story_bible.md",
            "volume_outline.md",
            "book_rules.md",
            "current_state.md",
            "pending_hooks.md",
          ],
        },
      });
    });
  });

  it("previews fit-check context payload for selected book", async () => {
    await seedFitCheckBook(root, "fit-check-book", "전생했더니-lv1-마왕", [
      { file: "author_intent.md", content: "# 작가 의도\n\n오래 살아남는 방식으로 세계 권력과 협상한다." },
      { file: "current_focus.md", content: "# 현재 포커스\n\n회귀 후의 제1분기 확장 동력과 신분 상승 루트 구축." },
    ]);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);
    const response = await app.request("http://localhost/api/radar/fit-check/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "fit-check",
        bookId: "fit-check-book",
        context: "유저 노트: 3화 훅 강화",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      mode: string;
      context?: string;
      metadata?: {
        bookId: string;
        sourceFiles: string[];
        note: string | null;
        contextPreview: string;
      };
    };
    expect(body).toMatchObject({
      mode: "fit-check",
      metadata: {
        bookId: "fit-check-book",
        sourceFiles: ["author_intent.md", "current_focus.md"],
      },
    });
    expect(body.context).toContain("## author_intent.md");
    expect(body.context).toContain("유저 노트: 3화 훅 강화");
  });

  it("limits truth list output to the supported truth file whitelist", async () => {
    await seedFitCheckBook(root, "view-book", "진실 파일 조회", [
      { file: "author_intent.md", content: "# 작가 의도\n\n의도 1." },
      { file: "current_focus.md", content: "# 현재 포커스\n\n집중 대상 1." },
      { file: "style_guide.md", content: "# 스타일 가이드\n\n문체는 간결하게 유지." },
      { file: "story_bible.md", content: "# story_bible\n\n세계관 요약." },
    ]);
    await writeFile(join(root, "books", "view-book", "story", "notes.md"), "# notes\n\n임시 메모.", "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/view-book/truth");
    expect(response.status).toBe(200);

    const body = await response.json() as { files: ReadonlyArray<{ name: string; exists: boolean; section: string; preview: string }> };
    const names = body.files.map((f) => f.name);
    expect(names).toContain("author_intent.md");
    expect(names).toContain("current_focus.md");
    expect(names).toContain("book_rules.md");
    expect(names).not.toContain("notes.md");
    expect(names).not.toContain("book.json");
    expect(body.files.find((f) => f.name === "author_intent.md")).toMatchObject({
      exists: true,
      section: "planning",
    });
    expect(body.files.find((f) => f.name === "book_rules.md")).toMatchObject({
      exists: false,
      section: "planning",
    });
    expect(body.files.find((f) => f.name === "book_rules.md")?.preview).toContain("version:");
  });

  it("can read and update whitelisted truth files by name", async () => {
    await seedFitCheckBook(root, "editable-book", "작성 권한 검증", [
      { file: "author_intent.md", content: "# 작가 의도\n\n의도 원본." },
      { file: "story_bible.md", content: "# story_bible\n\n원본 설정." },
    ]);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const readResponse = await app.request("http://localhost/api/books/editable-book/truth/author_intent.md");
    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({
      file: "author_intent.md",
      content: "# 작가 의도\n\n의도 원본.",
    });

    const saveResponse = await app.request("http://localhost/api/books/editable-book/truth/author_intent.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# 작가 의도\n\n수정된 의도." }),
    });
    expect(saveResponse.status).toBe(200);
    await expect(saveResponse.json()).resolves.toMatchObject({ ok: true });

    const updated = await readFile(join(root, "books", "editable-book", "story", "author_intent.md"), "utf-8");
    expect(updated).toBe("# 작가 의도\n\n수정된 의도.");

    const invalidRead = await app.request("http://localhost/api/books/editable-book/truth/notes.md");
    expect(invalidRead.status).toBe(400);
    await expect(invalidRead.json()).resolves.toMatchObject({ error: "Invalid truth file" });

    const invalidSave = await app.request("http://localhost/api/books/editable-book/truth/notes.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# ignore" }),
    });
    expect(invalidSave.status).toBe(400);
    await expect(invalidSave.json()).resolves.toMatchObject({ error: "Invalid truth file" });
  });

  it("returns a localized starter skeleton for missing truth files", async () => {
    await seedFitCheckBook(root, "skeleton-book", "스켈레톤 검증", [
      { file: "author_intent.md", content: "# 작가 의도\n\n기존 의도." },
    ]);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/skeleton-book/truth/book_rules.md");
    expect(response.status).toBe(200);
    const body = await response.json() as { name: string; exists: boolean; section: string; label: string; content: string };
    expect(body).toMatchObject({
      name: "book_rules.md",
      exists: false,
      section: "planning",
      label: "작품 규칙",
    });
    expect(body.content).toContain("version: \"1.0\"");
    expect(body.content).toContain("## 서사 시점");
  });

  it("returns an AI-generated truth-file proposal without saving", async () => {
    await seedFitCheckBook(root, "assist-book", "제안 테스트", [
      { file: "author_intent.md", content: "# 작가 의도\n\n왕권과 제도의 충돌을 다룬다.\n" },
      { file: "story_bible.md", content: "# 스토리 바이블\n\n- 마왕성은 움직이지 않는다.\n" },
    ]);
    chatCompletionMock.mockResolvedValueOnce({
      content: "# 작가 의도\n\n장기적으로 마왕국의 통치 질서와 정당성을 추적한다.\n",
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/assist-book/truth/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "author_intent.md", instruction: "통치와 정당성 축을 더 선명하게" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { content: string; changes: ReadonlyArray<{ fileName: string; content: string }> };
    expect(body.content).toContain("마왕국의 통치 질서");
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0]).toMatchObject({ fileName: "author_intent.md" });
    expect(chatCompletionMock).toHaveBeenCalledTimes(1);

    const persisted = await readFile(join(root, "books", "assist-book", "story", "author_intent.md"), "utf-8");
    expect(persisted).toContain("왕권과 제도의 충돌");
  });

  it("returns bundled truth-file proposals and keeps files untouched until saved", async () => {
    await seedFitCheckBook(root, "assist-bundle-book", "묶음 제안 테스트", [
      { file: "author_intent.md", content: "# 작가 의도\n\n제도와 권력을 다룬다.\n" },
      { file: "book_rules.md", content: "# 작품 규칙\n\n- 잔혹함은 제한적으로만 사용한다.\n" },
      { file: "story_bible.md", content: "# 스토리 바이블\n\n- 마왕국은 아직 미완성 체제다.\n" },
    ]);
    chatCompletionMock
      .mockResolvedValueOnce({
        content: "# 작가 의도\n\n제도와 통치 정당성의 충돌을 장기적으로 추적한다.\n",
        usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
      })
      .mockResolvedValueOnce({
        content: "# 작품 규칙\n\n- 통치 비용과 제도 균열을 반드시 드러낸다.\n",
        usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
      });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/assist-bundle-book/truth/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileNames: ["author_intent.md", "book_rules.md"],
        instruction: "통치 질서와 제도 비용이 더 잘 보이게 둘 다 조정해줘",
        conversation: [{ role: "user", content: "이번에는 작품의 냉정함을 더 살리고 싶어." }],
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      content: string;
      changes: ReadonlyArray<{ fileName: string; label: string; content: string }>;
    };
    expect(body.content).toContain("통치 정당성");
    expect(body.changes).toHaveLength(2);
    expect(body.changes[0]).toMatchObject({ fileName: "author_intent.md", label: "작가 의도" });
    expect(body.changes[1]).toMatchObject({ fileName: "book_rules.md", label: "작품 규칙" });
    expect(chatCompletionMock).toHaveBeenCalledTimes(2);

    const persistedIntent = await readFile(join(root, "books", "assist-bundle-book", "story", "author_intent.md"), "utf-8");
    const persistedRules = await readFile(join(root, "books", "assist-bundle-book", "story", "book_rules.md"), "utf-8");
    expect(persistedIntent).toContain("제도와 권력을 다룬다");
    expect(persistedRules).toContain("잔혹함은 제한적으로만 사용한다");
  });

  it("keeps radar scan status after the start request returns", async () => {
    let resolveScan: ((value: { marketSummary: string; recommendations: [] }) => void) | undefined;
    runRadarMock.mockImplementation(() => new Promise((resolve) => {
      resolveScan = resolve as typeof resolveScan;
    }));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const start = await app.request("http://localhost/api/radar/scan", { method: "POST" });
    expect(start.status).toBe(202);
    await expect(start.json()).resolves.toMatchObject({ status: "running" });

    const running = await app.request("http://localhost/api/radar/status");
    await expect(running.json()).resolves.toMatchObject({ status: "running" });

    await vi.waitFor(() => {
      expect(runRadarMock).toHaveBeenCalledTimes(1);
      expect(resolveScan).toBeTypeOf("function");
    });
    resolveScan?.({ marketSummary: "done", recommendations: [] });
    await vi.waitFor(async () => {
      const finished = await app.request("http://localhost/api/radar/status");
      await expect(finished.json()).resolves.toMatchObject({
        status: "succeeded",
        result: { marketSummary: "done", recommendations: [] },
      });
    });
  });

  it("persists completed radar scans and exposes them in history", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const start = await app.request("http://localhost/api/radar/scan", { method: "POST" });
    expect(start.status).toBe(202);

    await vi.waitFor(async () => {
      const historyResponse = await app.request("http://localhost/api/radar/history");
      await expect(historyResponse.json()).resolves.toMatchObject({
        scans: [
          {
            status: "succeeded",
            provider: "openai",
            model: "gpt-5.4",
            mode: "market-trends",
            result: { marketSummary: "Fresh market summary", recommendations: [] },
          },
        ],
      });
    });

    const files = await readdir(join(root, "radar"));
    const savedFile = files.find((file) => /^scan-.*\.json$/.test(file));
    expect(savedFile).toBeTruthy();

    const persisted = JSON.parse(await readFile(join(root, "radar", savedFile ?? ""), "utf-8")) as Record<string, unknown>;
    expect(persisted).toMatchObject({
      kind: "inkos-radar-scan",
      version: 1,
      status: "succeeded",
      provider: "openai",
      model: "gpt-5.4",
      mode: "market-trends",
      result: { marketSummary: "Fresh market summary", recommendations: [] },
    });
  });

  it("hydrates latest radar status from saved scan history", async () => {
    await mkdir(join(root, "radar"), { recursive: true });
    await writeFile(join(root, "radar", "scan-2026-04-09T00-00-00-000Z.json"), JSON.stringify({
      marketSummary: "Legacy saved market summary",
      recommendations: [],
    }, null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const statusResponse = await app.request("http://localhost/api/radar/status");
    await expect(statusResponse.json()).resolves.toMatchObject({
      status: "succeeded",
      result: { marketSummary: "Legacy saved market summary", recommendations: [] },
    });

    const historyResponse = await app.request("http://localhost/api/radar/history");
    await expect(historyResponse.json()).resolves.toMatchObject({
      scans: [
        {
          status: "succeeded",
          provider: null,
          model: null,
          mode: "market-trends",
          result: { marketSummary: "Legacy saved market summary", recommendations: [] },
        },
      ],
    });
  });

  it("persists and exposes chosen radar mode in scan history", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/radar/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "fit-check" }),
    });

    expect(response.status).toBe(202);

    await vi.waitFor(async () => {
      const historyResponse = await app.request("http://localhost/api/radar/history");
      const body = await historyResponse.json() as { scans: Array<{ mode: string }> };
      expect(body.scans[0]?.mode).toBe("fit-check");
    });

    const statusResponse = await app.request("http://localhost/api/radar/status");
    await expect(statusResponse.json()).resolves.toMatchObject({
      mode: "fit-check",
      status: "succeeded",
      result: { marketSummary: "Fresh market summary", recommendations: [] },
    });
  });

  it("updates the first-run language immediately after the language selector saves", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const save = await app.request("http://localhost/api/project/language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en" }),
    });

    expect(save.status).toBe(200);

    const project = await app.request("http://localhost/api/project");
    await expect(project.json()).resolves.toMatchObject({
      language: "en",
      languageExplicit: true,
    });
  });

  it("supports bootstrap mode before inkos.json exists", async () => {
    await rm(join(root, "inkos.json"), { force: true });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(null, root);

    const bootstrapResponse = await app.request("http://localhost/api/bootstrap");
    expect(bootstrapResponse.status).toBe(200);
    await expect(bootstrapResponse.json()).resolves.toMatchObject({
      projectInitialized: false,
      suggestedProjectName: expect.any(String),
      globalConfig: {
        exists: false,
        provider: "",
      },
    });

    const projectResponse = await app.request("http://localhost/api/project");
    expect(projectResponse.status).toBe(200);
    await expect(projectResponse.json()).resolves.toMatchObject({
      initialized: false,
      projectRoot: root,
      suggestedProjectName: expect.any(String),
      languageExplicit: false,
    });
  });

  it("initializes a project from the bootstrap endpoint", async () => {
    await rm(join(root, "inkos.json"), { force: true });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(null, root);

    const initResponse = await app.request("http://localhost/api/project/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "studio-init", language: "ko" }),
    });
    expect(initResponse.status).toBe(200);

    const rawConfig = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    expect(rawConfig.name).toBe("studio-init");
    expect(rawConfig.language).toBe("ko");

    const envContent = await readFile(join(root, ".env"), "utf-8");
    expect(envContent).toContain("# INKOS_LLM_PROVIDER=openai");

    const bootstrapResponse = await app.request("http://localhost/api/bootstrap");
    await expect(bootstrapResponse.json()).resolves.toMatchObject({
      projectInitialized: true,
    });
  });

  it("edits global config through the studio API", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const saveResponse = await app.request("http://localhost/api/global-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: "ko",
        provider: "codex-cli",
        model: "gpt-5.4",
        reasoningEffort: "xhigh",
      }),
    });
    expect(saveResponse.status).toBe(200);

    const savedEnv = await readFile(globalEnvPath, "utf-8");
    expect(savedEnv).toContain("INKOS_LLM_PROVIDER=codex-cli");
    expect(savedEnv).toContain("INKOS_LLM_MODEL=gpt-5.4");
    expect(savedEnv).toContain("INKOS_LLM_REASONING_EFFORT=xhigh");
    expect(savedEnv).toContain("INKOS_DEFAULT_LANGUAGE=ko");

    const fetchResponse = await app.request("http://localhost/api/global-config");
    await expect(fetchResponse.json()).resolves.toMatchObject({
      exists: true,
      language: "ko",
      provider: "codex-cli",
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
      apiKeySet: false,
    });
  });

  it("propagates global reasoning effort to project defaults via the global-config path", async () => {
    await rm(join(root, "inkos.json"), { force: true });
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(null, root);

    const saveResponse = await app.request("http://localhost/api/global-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: "ko",
        provider: "codex-cli",
        model: "gpt-5.4",
        reasoningEffort: "xhigh",
      }),
    });
    expect(saveResponse.status).toBe(200);

    const projectResponse = await app.request("http://localhost/api/project");
    await expect(projectResponse.json()).resolves.toMatchObject({
      reasoningEffort: "xhigh",
      provider: "codex-cli",
      model: "gpt-5.4",
      language: "ko",
    });
  });

  it("preserves the stored api key when updating the same provider with a blank apiKey", async () => {
    await writeFile(globalEnvPath, [
      "INKOS_LLM_PROVIDER=openai",
      "INKOS_LLM_BASE_URL=https://api.example.com/v1",
      "INKOS_LLM_API_KEY=sk-existing",
      "INKOS_LLM_MODEL=gpt-5.4",
      "INKOS_DEFAULT_LANGUAGE=ko",
    ].join("\n"), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const saveResponse = await app.request("http://localhost/api/global-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: "ko",
        provider: "openai",
        model: "gpt-5.4-mini",
        baseUrl: "https://api.example.com/v1",
        apiKey: "",
      }),
    });
    expect(saveResponse.status).toBe(200);

    const savedEnv = await readFile(globalEnvPath, "utf-8");
    expect(savedEnv).toContain("INKOS_LLM_API_KEY=sk-existing");
    expect(savedEnv).toContain("INKOS_LLM_MODEL=gpt-5.4-mini");
  });

  it("initializes a project with the saved global provider and model", async () => {
    await rm(join(root, "inkos.json"), { force: true });
    await writeFile(globalEnvPath, [
      "INKOS_LLM_PROVIDER=gemini-cli",
      "INKOS_LLM_MODEL=gemini-2.5-pro",
      "INKOS_DEFAULT_LANGUAGE=ko",
    ].join("\n"), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(null, root);

    const initResponse = await app.request("http://localhost/api/project/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "global-defaults", language: "ko" }),
    });
    expect(initResponse.status).toBe(200);

    const rawConfig = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8")) as {
      llm: { provider: string; model: string; baseUrl: string };
    };
    expect(rawConfig.llm.provider).toBe("gemini-cli");
    expect(rawConfig.llm.model).toBe("gemini-2.5-pro");
    expect(rawConfig.llm.baseUrl).toBe("");
  });

  it("accepts korean language through the first-run language endpoint", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const save = await app.request("http://localhost/api/project/language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "ko" }),
    });

    expect(save.status).toBe(200);

    const project = await app.request("http://localhost/api/project");
    await expect(project.json()).resolves.toMatchObject({
      language: "ko",
      languageExplicit: true,
    });
  });

  it("creates Korean books with Korean platform and genre through the API", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "korean-smoke-book",
        genre: "modern-fantasy",
        platform: "naver-series",
        language: "ko",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "creating",
      bookId: "korean-smoke-book",
    });

    await Promise.resolve();
    expect(initBookMock).toHaveBeenCalledTimes(1);
    expect(initBookMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "korean-smoke-book",
        language: "ko",
        genre: "modern-fantasy",
        platform: "naver-series",
      }),
    );
  });

  it("rejects create requests when a complete book with the same id already exists", async () => {
    await mkdir(join(root, "books", "existing-book", "story"), { recursive: true });
    await writeFile(join(root, "books", "existing-book", "book.json"), JSON.stringify({ id: "existing-book" }), "utf-8");
    await writeFile(join(root, "books", "existing-book", "story", "story_bible.md"), "# existing", "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Existing Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Book "existing-book" already exists'),
    });
    expect(initBookMock).not.toHaveBeenCalled();
    await expect(access(join(root, "books", "existing-book", "story", "story_bible.md"))).resolves.toBeUndefined();
  });

  it("reports async create failures through the create-status endpoint", async () => {
    initBookMock.mockRejectedValueOnce(new Error("INKOS_LLM_API_KEY not set"));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Broken Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(200);
    await Promise.resolve();

    const status = await app.request("http://localhost/api/books/broken-book/create-status");
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      bookId: "broken-book",
      title: "Broken Book",
      status: "error",
      error: "INKOS_LLM_API_KEY not set",
    });
  });

  it("tracks background book creation progress across the global create-status list", async () => {
    let resolveInit: (() => void) | undefined;
    initBookMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveInit = resolve;
    }));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Queued Book",
        genre: "modern-fantasy",
        platform: "naver-series",
        language: "ko",
      }),
    });

    expect(response.status).toBe(200);

    const config = pipelineConfigs.at(-1) as { logger?: { info: (message: string) => void } };
    config.logger?.info("단계: 기초 설정 생성");
    config.logger?.info("기초 설정 초안을 검토 중입니다.");

    const list = await app.request("http://localhost/api/book-create-status");
    await expect(list.json()).resolves.toMatchObject({
      entries: [
        {
          bookId: "queued-book",
          status: "creating",
          title: "Queued Book",
          history: expect.arrayContaining([
            expect.objectContaining({
              kind: "start",
              label: "book creation queued",
            }),
            expect.objectContaining({
              kind: "stage",
              label: "기초 설정 생성",
            }),
            expect.objectContaining({
              kind: "info",
              label: "기초 설정 초안을 검토 중입니다.",
            }),
          ]),
        },
      ],
    });

    resolveInit?.();
    await vi.waitFor(async () => {
      const next = await app.request("http://localhost/api/book-create-status");
      await expect(next.json()).resolves.toEqual({ entries: [] });
    });
  });

  it("updates an existing book platform through the API", async () => {
    await mkdir(join(root, "books", "legacy-book"), { recursive: true });
    await writeFile(join(root, "books", "legacy-book", "book.json"), JSON.stringify({
      id: "legacy-book",
      title: "Legacy Book",
      genre: "modern-fantasy",
      platform: "tomato",
      status: "active",
      targetChapters: 200,
      chapterWordCount: 3000,
      language: "ko",
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
    }, null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/legacy-book", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "munpia" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      book: expect.objectContaining({
        id: "legacy-book",
        platform: "munpia",
      }),
    });

    const saved = JSON.parse(await readFile(join(root, "books", "legacy-book", "book.json"), "utf-8")) as Record<string, unknown>;
    expect(saved.platform).toBe("munpia");
  });
});
