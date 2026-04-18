import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const schedulerStartMock = vi.fn<() => Promise<void>>();
const initBookMock = vi.fn();
const proposeBookMock = vi.fn();
const applyBookProposalMock = vi.fn();
const runRadarMock = vi.fn();
const writeNextChapterMock = vi.fn();
const writeDraftMock = vi.fn();
const rollbackToChapterMock = vi.fn();
const createLLMClientMock = vi.fn(() => ({}));
const chatCompletionMock = vi.fn();
const loadProjectConfigMock = vi.fn();
const serveMock = vi.fn();
const pipelineConfigs: unknown[] = [];
const globalEnvPath = join(tmpdir(), "inkos-global.env");
const readerSettingsSchemaMock = {
  safeParse(value: unknown): { success: true; data: unknown } | { success: false; error: Error } {
    const isReaderDeviceSettings = (settings: unknown): boolean => {
      if (typeof settings !== "object" || settings === null) {
        return false;
      }

      const record = settings as Record<string, unknown>;
      const fontSize = record.fontSize;
      const lineHeight = record.lineHeight;

      return (record.fontPreset === "sans" || record.fontPreset === "serif" || record.fontPreset === "myeongjo")
        && typeof fontSize === "number"
        && Number.isInteger(fontSize)
        && fontSize >= 12
        && fontSize <= 28
        && typeof lineHeight === "number"
        && lineHeight >= 1.3
        && lineHeight <= 2.2;
    };

    if (
      typeof value === "object"
      && value !== null
      && isReaderDeviceSettings((value as Record<string, unknown>).mobile)
      && isReaderDeviceSettings((value as Record<string, unknown>).desktop)
    ) {
      return { success: true, data: value };
    }

    return { success: false, error: new Error("Invalid reader settings") };
  },
};
const READER_SETTINGS_TEST_TIMEOUT_MS = 15000;

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

    async loadChapterIndex(id: string): Promise<unknown[]> {
      try {
        return JSON.parse(await readFile(join(this.bookDir(id), "chapters", "index.json"), "utf-8")) as unknown[];
      } catch {
        return [];
      }
    }

    async saveChapterIndex(id: string, index: ReadonlyArray<unknown>): Promise<void> {
      const chaptersDir = join(this.bookDir(id), "chapters");
      await mkdir(chaptersDir, { recursive: true });
      await writeFile(join(chaptersDir, "index.json"), JSON.stringify(index, null, 2), "utf-8");
    }

    async acquireBookLock(id: string): Promise<() => Promise<void>> {
      const bookDir = this.bookDir(id);
      await mkdir(bookDir, { recursive: true });
      const lockPath = join(bookDir, ".write.lock");
      try {
        await writeFile(lockPath, "locked", { encoding: "utf-8", flag: "wx" });
      } catch {
        throw new Error(`Book "${id}" is locked by another process`);
      }

      return async () => {
        await rm(lockPath, { force: true });
      };
    }

    async rollbackToChapter(id: string, targetChapter: number): Promise<number[]> {
      await rollbackToChapterMock(id, targetChapter);
      const chaptersDir = join(this.bookDir(id), "chapters");
      const index = await this.loadChapterIndex(id) as Array<{ number?: number }>;
      const kept = index.filter((entry) => (entry.number ?? 0) <= targetChapter);
      const deleted = index
        .map((entry) => entry.number)
        .filter((number): number is number => typeof number === "number" && number > targetChapter);

      try {
        const files = await readdir(chaptersDir);
        await Promise.all(files.map(async (file) => {
          const match = file.match(/^(\d+)_.*\.md$/);
          if (!match) return;
          const number = Number.parseInt(match[1] ?? "", 10);
          if (number > targetChapter) {
            await rm(join(chaptersDir, file), { force: true });
          }
        }));
      } catch {
        // ignore missing chapter dir in tests
      }

      await this.saveChapterIndex(id, kept);
      return deleted;
    }

    async getNextChapterNumber(id: string): Promise<number> {
      const index = await this.loadChapterIndex(id) as Array<{ number?: number }>;
      const maxChapter = index.reduce((max, entry) => (
        typeof entry.number === "number" && entry.number > max ? entry.number : max
      ), 0);
      return maxChapter + 1;
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
    proposeBook = proposeBookMock;
    applyBookProposal = applyBookProposalMock;
    runRadar = runRadarMock;
    writeNextChapter = writeNextChapterMock;
    writeDraft = writeDraftMock;
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
      ReaderSettingsSchema: readerSettingsSchemaMock,
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

vi.mock("@hono/node-server", () => ({
  serve: serveMock,
}));

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

function makeBookInitProposal(input: { id?: string; title?: string; genre?: string; language?: string; platform?: string; targetChapters?: number; chapterWordCount?: number } = {}) {
  return {
    book: {
      id: input.id ?? "proposal-book",
      title: input.title ?? "Proposal Book",
      genre: input.genre ?? "modern-fantasy",
      platform: input.platform ?? "naver-series",
      status: "outlining",
      targetChapters: input.targetChapters ?? 200,
      chapterWordCount: input.chapterWordCount ?? 3000,
      language: input.language ?? "ko",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    foundation: {
      storyBible: "# story_bible",
      volumeOutline: "# volume_outline",
      bookRules: "# book_rules",
      currentState: "# current_state",
      pendingHooks: "# pending_hooks",
    },
  };
}

const sampleReaderSettings = {
  mobile: { fontPreset: "myeongjo", fontSize: 16, lineHeight: 1.72 },
  desktop: { fontPreset: "serif", fontSize: 18, lineHeight: 1.85 },
} as const;

interface StudioAppLike {
  readonly request: (input: string, init?: RequestInit) => Response | Promise<Response>;
}

function setupRevisionBody(expectedRevision: number): { readonly expectedRevision: number } {
  return { expectedRevision };
}

function jsonHeaders(idempotencyKey?: string): HeadersInit {
  return idempotencyKey
    ? { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }
    : { "Content-Type": "application/json" };
}

function setupCreateBody(expectedRevision: number, expectedPreviewDigest?: string): { readonly expectedRevision: number; readonly expectedPreviewDigest?: string } {
  return expectedPreviewDigest
    ? { expectedRevision, expectedPreviewDigest }
    : { expectedRevision };
}

function requestHeaders(idempotencyKey?: string): Record<string, string> {
  return idempotencyKey
    ? { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }
    : { "Content-Type": "application/json" };
}

function quickCreateRequest(body: Record<string, unknown>, idempotencyKey?: string): RequestInit {
  return {
    method: "POST",
    headers: requestHeaders(idempotencyKey),
    body: JSON.stringify(body),
  };
}

async function approveSetupSession(app: StudioAppLike, sessionId: string, expectedRevision: number): Promise<Response> {
  return await Promise.resolve(app.request("http://localhost/api/book-setup/" + sessionId + "/approve", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(setupRevisionBody(expectedRevision)),
  }));
}

async function previewSetupSession(app: StudioAppLike, sessionId: string, expectedRevision: number): Promise<Response> {
  return await Promise.resolve(app.request("http://localhost/api/book-setup/" + sessionId + "/foundation-preview", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(setupRevisionBody(expectedRevision)),
  }));
}

async function saveSetupReviewThreads(
  app: StudioAppLike,
  sessionId: string,
  expectedRevision: number,
  reviewThreads: ReadonlyArray<Record<string, unknown>>,
): Promise<Response> {
  return await Promise.resolve(app.request("http://localhost/api/book-setup/" + sessionId + "/reviews", {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify({
      expectedRevision,
      reviewThreads,
    }),
  }));
}

async function createSetupSession(app: StudioAppLike, sessionId: string, expectedRevision: number, expectedPreviewDigest?: string, idempotencyKey?: string): Promise<Response> {
  return await Promise.resolve(app.request("http://localhost/api/book-setup/" + sessionId + "/create", {
    method: "POST",
    headers: jsonHeaders(idempotencyKey),
    body: JSON.stringify(setupCreateBody(expectedRevision, expectedPreviewDigest)),
  }));
}

async function createStaticServerRequest(
  root: string,
  staticDir: string,
): Promise<(path: string, init?: RequestInit) => Promise<Response>> {
  const { startStudioServer } = await import("./server.js");
  await startStudioServer(root, 4567, { staticDir });

  const served = serveMock.mock.calls.at(-1)?.[0] as { fetch?: (request: Request) => Response | Promise<Response> } | undefined;
  if (!served?.fetch) {
    throw new Error("Expected startStudioServer to register a fetch handler");
  }

  return async (path: string, init?: RequestInit) => {
    return await Promise.resolve(served.fetch!(new Request(`http://localhost${path}`, init)));
  };
}

const PROJECT_LLM_ENV_KEYS = [
  "INKOS_LLM_PROVIDER",
  "INKOS_LLM_BASE_URL",
  "INKOS_LLM_MODEL",
  "INKOS_LLM_REASONING_EFFORT",
  "INKOS_LLM_TEMPERATURE",
  "INKOS_LLM_MAX_TOKENS",
] as const;

type ProjectLlmEnvKey = (typeof PROJECT_LLM_ENV_KEYS)[number];

function applyMockLlmEnvOverrides<T extends {
  readonly llm: {
    readonly provider: string;
    readonly baseUrl: string;
    readonly model: string;
    readonly reasoningEffort?: string;
    readonly temperature?: number;
    readonly maxTokens?: number;
  };
}>(config: T): T {
  const llm = { ...config.llm };

  if (process.env.INKOS_LLM_PROVIDER) llm.provider = process.env.INKOS_LLM_PROVIDER;
  if (process.env.INKOS_LLM_BASE_URL !== undefined) llm.baseUrl = process.env.INKOS_LLM_BASE_URL;
  if (process.env.INKOS_LLM_MODEL) llm.model = process.env.INKOS_LLM_MODEL;
  if (process.env.INKOS_LLM_REASONING_EFFORT) llm.reasoningEffort = process.env.INKOS_LLM_REASONING_EFFORT;
  if (process.env.INKOS_LLM_TEMPERATURE) llm.temperature = Number(process.env.INKOS_LLM_TEMPERATURE);
  if (process.env.INKOS_LLM_MAX_TOKENS) llm.maxTokens = Number(process.env.INKOS_LLM_MAX_TOKENS);

  return {
    ...config,
    llm,
  };
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
  let llmEnvSnapshot: Partial<Record<ProjectLlmEnvKey, string | undefined>>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-server-"));
    await writeFile(join(root, "inkos.json"), JSON.stringify(projectConfig, null, 2), "utf-8");
    llmEnvSnapshot = Object.fromEntries(PROJECT_LLM_ENV_KEYS.map((key) => [key, process.env[key]])) as Partial<Record<
      ProjectLlmEnvKey,
      string | undefined
    >>;
    for (const key of PROJECT_LLM_ENV_KEYS) {
      delete process.env[key];
    }
    logger.info.mockReset();
    logger.warn.mockReset();
    logger.error.mockReset();
    schedulerStartMock.mockReset();
    initBookMock.mockReset();
    initBookMock.mockResolvedValue(undefined);
    proposeBookMock.mockReset();
    proposeBookMock.mockImplementation(async (book) => makeBookInitProposal({
      id: (book as { id?: string }).id,
      title: (book as { title?: string }).title,
      genre: (book as { genre?: string }).genre,
      language: (book as { language?: string }).language,
      platform: (book as { platform?: string }).platform,
      targetChapters: (book as { targetChapters?: number }).targetChapters,
      chapterWordCount: (book as { chapterWordCount?: number }).chapterWordCount,
    }));
    applyBookProposalMock.mockReset();
    applyBookProposalMock.mockResolvedValue(undefined);
    runRadarMock.mockReset();
    runRadarMock.mockResolvedValue({
      marketSummary: "Fresh market summary",
      recommendations: [],
    });
    writeNextChapterMock.mockReset();
    writeNextChapterMock.mockResolvedValue({
      chapterNumber: 1,
      title: "Rewritten chapter",
      wordCount: 1200,
    });
    writeDraftMock.mockReset();
    writeDraftMock.mockResolvedValue({
      chapterNumber: 1,
      title: "Drafted chapter",
      wordCount: 1200,
      filePath: join(root, "books", "draft-book", "chapters", "0001_Drafted_chapter.md"),
    });
    rollbackToChapterMock.mockReset();
    rollbackToChapterMock.mockResolvedValue(undefined);
    createLLMClientMock.mockReset();
    createLLMClientMock.mockReturnValue({});
    chatCompletionMock.mockReset();
    chatCompletionMock.mockResolvedValue({
      content: "pong",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    loadProjectConfigMock.mockReset();
    serveMock.mockReset();
    loadProjectConfigMock.mockImplementation(async () => {
      const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8")) as Record<string, unknown>;
      return applyMockLlmEnvOverrides({
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
      });
    });
    pipelineConfigs.length = 0;
  });

  afterEach(async () => {
    for (const key of PROJECT_LLM_ENV_KEYS) {
      const value = llmEnvSnapshot[key];
      if (typeof value === "string") process.env[key] = value;
      else delete process.env[key];
    }
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

  it("marks a running draft as cancelling and rolls back after completion", async () => {
    await mkdir(join(root, "books", "draft-book", "chapters"), { recursive: true });
    await writeFile(join(root, "books", "draft-book", "book.json"), JSON.stringify({
      id: "draft-book",
      title: "Draft Book",
      genre: "modern-fantasy",
      platform: "naver-series",
      status: "active",
      targetChapters: 50,
      chapterWordCount: 2500,
      language: "ko",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }, null, 2), "utf-8");
    await writeFile(join(root, "books", "draft-book", "chapters", "index.json"), JSON.stringify([
      {
        number: 1,
        title: "Chapter 1",
        status: "drafted",
        wordCount: 1200,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        auditIssues: [],
      },
    ], null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    let resolveDraft!: (value: {
      chapterNumber: number;
      title: string;
      wordCount: number;
      filePath: string;
    }) => void;
    const draftPromise = new Promise<{
      chapterNumber: number;
      title: string;
      wordCount: number;
      filePath: string;
    }>((resolve) => {
      resolveDraft = resolve;
    });
    writeDraftMock.mockReturnValueOnce(draftPromise);
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const startResponse = await app.request("http://localhost/api/books/draft-book/draft", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(startResponse.status).toBe(200);
    await expect(startResponse.json()).resolves.toMatchObject({ status: "drafting", bookId: "draft-book" });

    const cancelResponse = await app.request("http://localhost/api/books/draft-book/draft", {
      method: "DELETE",
    });
    expect(cancelResponse.status).toBe(200);
    await expect(cancelResponse.json()).resolves.toMatchObject({ status: "cancelling", bookId: "draft-book" });
    expect(rollbackToChapterMock).not.toHaveBeenCalled();

    resolveDraft({
      chapterNumber: 2,
      title: "Drafted chapter",
      wordCount: 1600,
      filePath: join(root, "books", "draft-book", "chapters", "0002_Drafted_chapter.md"),
    });
    await draftPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rollbackToChapterMock).toHaveBeenCalledWith("draft-book", 1);
  });

  it("rejects cancelling when no draft is running", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/draft-book/draft", {
      method: "DELETE",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "Draft is not running" });
  });

  it("reflects project edits immediately without restarting the studio server", async () => {
    process.env.INKOS_LLM_PROVIDER = "openai";
    process.env.INKOS_LLM_BASE_URL = "https://stale.example.com/v1";
    process.env.INKOS_LLM_MODEL = "stale-model";
    process.env.INKOS_LLM_REASONING_EFFORT = "low";
    process.env.INKOS_LLM_TEMPERATURE = "0.95";
    process.env.INKOS_LLM_MAX_TOKENS = "8192";

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const beforeSave = await app.request("http://localhost/api/project");
    await expect(beforeSave.json()).resolves.toMatchObject({
      provider: "openai",
      baseUrl: "https://stale.example.com/v1",
      model: "stale-model",
      reasoningEffort: "low",
      temperature: 0.95,
      maxTokens: 8192,
    });

    const save = await app.request("http://localhost/api/project", {
      method: "PUT",
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
      body: JSON.stringify({
        content: "# 작가 의도\n\n수정된 의도.",
        scope: { kind: "file", fileName: "author_intent.md" },
      }),
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
      headers: jsonHeaders(),
      body: JSON.stringify({ content: "# ignore" }),
    });
    expect(invalidSave.status).toBe(400);
    await expect(invalidSave.json()).resolves.toMatchObject({ error: "Invalid truth file" });
  });

  it("rejects truth saves without explicit file scope", async () => {
    await seedFitCheckBook(root, "editable-scope-book", "작성 권한 검증", [
      { file: "author_intent.md", content: "# 작가 의도\n\n의도 원본." },
    ]);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/editable-scope-book/truth/author_intent.md", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ content: "# 작가 의도\n\n수정된 의도." }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "TRUTH_SCOPE_REQUIRED" });
  });

  it("rejects truth saves in read-only scope", async () => {
    await seedFitCheckBook(root, "editable-readonly-book", "작성 권한 검증", [
      { file: "author_intent.md", content: "# 작가 의도\n\n의도 원본." },
    ]);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/editable-readonly-book/truth/author_intent.md", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({
        content: "# 작가 의도\n\n수정된 의도.",
        scope: { kind: "read-only" },
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "TRUTH_SCOPE_READ_ONLY" });
  });

  it("rejects truth saves when file scope does not match the route file", async () => {
    await seedFitCheckBook(root, "editable-mismatch-book", "작성 권한 검증", [
      { file: "author_intent.md", content: "# 작가 의도\n\n의도 원본." },
      { file: "book_rules.md", content: "# 작품 규칙\n\n- 원본 규칙." },
    ]);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/editable-mismatch-book/truth/author_intent.md", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({
        content: "# 작가 의도\n\n수정된 의도.",
        scope: { kind: "file", fileName: "book_rules.md" },
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "TRUTH_SCOPE_FILE_MISMATCH" });
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
      headers: jsonHeaders(),
      body: JSON.stringify({
        fileName: "author_intent.md",
        instruction: "통치와 정당성 축을 더 선명하게",
        scope: { kind: "file", fileName: "author_intent.md" },
        alignment: {
          knownFacts: ["왕권과 제도의 충돌을 다룬다."],
          unknowns: ["주인공의 통치 원칙은 아직 정리되지 않았다."],
          mustDecide: "이번 편집의 끝에서 통치 정당성 기준이 일관되게 남아야 한다.",
          askFirst: "현재 통치 원칙의 정당화 근거가 무엇인가?",
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { content: string; changes: ReadonlyArray<{ fileName: string; content: string }> };
    expect(body.content).toContain("마왕국의 통치 질서");
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0]).toMatchObject({ fileName: "author_intent.md" });
    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    const proposalCall = chatCompletionMock.mock.calls[0] as [
      unknown,
      unknown,
      ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>,
    ];
    const proposalPrompt = proposalCall[2]?.map((message) => message.content).join("\n") ?? "";
    expect(proposalPrompt).toContain("왕권과 제도의 충돌을 다룬다.");
    expect(proposalPrompt).toContain("주인공의 통치 원칙은 아직 정리되지 않았다.");
    expect(proposalPrompt).toContain("이번 편집의 끝에서 통치 정당성 기준이 일관되게 남아야 한다.");
    expect(proposalPrompt).toContain("현재 통치 원칙의 정당화 근거가 무엇인가?");
    expect(proposalPrompt).toContain("정렬 제약:");

    const persisted = await readFile(join(root, "books", "assist-book", "story", "author_intent.md"), "utf-8");
    expect(persisted).toContain("왕권과 제도의 충돌");
  });

  it("rejects proposal mode without explicit truth write scope", async () => {
    await seedFitCheckBook(root, "assist-scope-book", "scope 테스트", [
      { file: "author_intent.md", content: "# 작가 의도\n\n왕권과 제도의 충돌을 다룬다.\n" },
    ]);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/assist-scope-book/truth/assist", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        fileName: "author_intent.md",
        mode: "proposal",
        instruction: "통치와 정당성 축을 더 선명하게",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "TRUTH_SCOPE_REQUIRED" });
  });

  it("rejects proposal mode when the scope is read-only", async () => {
    await seedFitCheckBook(root, "assist-readonly-book", "scope readonly 테스트", [
      { file: "author_intent.md", content: "# 작가 의도\n\n왕권과 제도의 충돌을 다룬다.\n" },
    ]);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/assist-readonly-book/truth/assist", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        fileName: "author_intent.md",
        mode: "proposal",
        instruction: "통치와 정당성 축을 더 선명하게",
        scope: { kind: "read-only" },
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "TRUTH_SCOPE_READ_ONLY" });
  });

  it("rejects proposal mode when the file scope does not match the target file", async () => {
    await seedFitCheckBook(root, "assist-mismatch-book", "scope mismatch 테스트", [
      { file: "author_intent.md", content: "# 작가 의도\n\n왕권과 제도의 충돌을 다룬다.\n" },
      { file: "book_rules.md", content: "# 작품 규칙\n\n- 원본 규칙.\n" },
    ]);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/assist-mismatch-book/truth/assist", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        fileName: "author_intent.md",
        mode: "proposal",
        instruction: "통치와 정당성 축을 더 선명하게",
        scope: { kind: "file", fileName: "book_rules.md" },
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "TRUTH_SCOPE_FILE_MISMATCH" });
  });

  it("returns bundled truth-file proposals when the bundle scope matches the targets", async () => {
    chatCompletionMock.mockClear();
    await seedFitCheckBook(root, "assist-bundle-scope-book", "bundle scope 테스트", [
      { file: "author_intent.md", content: "# 작가 의도\n\n왕권과 제도의 충돌을 다룬다.\n" },
      { file: "book_rules.md", content: "# 작품 규칙\n\n- 권력 균형은 쉽게 무너지지 않는다.\n" },
      { file: "story_bible.md", content: "# 스토리 바이블\n\n- 수도는 이동하지 않는다.\n" },
    ]);
    chatCompletionMock
      .mockResolvedValueOnce({
        content: "# 작가 의도\n\n통치 정당성의 기준을 더 선명하게 유지한다.\n",
        usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
      })
      .mockResolvedValueOnce({
        content: "# 작품 규칙\n\n- 권력 투쟁은 제도적 결과를 남겨야 한다.\n",
        usage: { promptTokens: 6, completionTokens: 8, totalTokens: 14 },
      });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/assist-bundle-scope-book/truth/assist", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        fileNames: ["author_intent.md", "book_rules.md"],
        mode: "proposal",
        instruction: "통치 정당성과 권력 규칙을 함께 정리해줘",
        scope: { kind: "bundle", fileNames: ["author_intent.md", "book_rules.md"] },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { changes: ReadonlyArray<{ fileName: string; content: string }> };
    expect(body.changes).toHaveLength(2);
    expect(body.changes.map((change) => change.fileName)).toEqual(["author_intent.md", "book_rules.md"]);
    expect(chatCompletionMock).toHaveBeenCalledTimes(2);
  }, 15000);

  it("returns a single alignment question before drafting when question mode is requested", async () => {
    await seedFitCheckBook(root, "assist-question-book", "질문 테스트", [
      { file: "author_intent.md", content: "# 작가 의도\n\n왕권과 제도의 충돌을 다룬다.\n" },
      { file: "current_focus.md", content: "# 현재 초점\n\n- 이번 권은 귀족 의회와 충돌한다.\n" },
    ]);
    chatCompletionMock.mockResolvedValueOnce({
      content: JSON.stringify({
        question: "이번 문서에서 절대 바뀌면 안 되는 통치 원칙은 무엇인가?",
        rationale: "이 원칙이 확정돼야 후속 문단이 자의적으로 흩어지지 않는다.",
      }),
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/assist-question-book/truth/assist", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        fileName: "author_intent.md",
        mode: "question",
        alignment: {
          knownFacts: ["왕권과 제도의 충돌을 다룬다."],
          unknowns: ["주인공이 지키려는 통치 원칙이 아직 흐리다."],
          mustDecide: "이번 편집에서 통치 정당성의 기준을 남긴다.",
          askFirst: "주요 통치 규칙은 무엇이어야 하나요?",
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      mode: string;
      content: string;
      question: string;
      rationale: string;
      changes: ReadonlyArray<unknown>;
    };
    expect(body).toMatchObject({
      mode: "question",
      question: "이번 문서에서 절대 바뀌면 안 되는 통치 원칙은 무엇인가?",
      rationale: "이 원칙이 확정돼야 후속 문단이 자의적으로 흩어지지 않는다.",
      changes: [],
    });
    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    const interviewCall = chatCompletionMock.mock.calls[0] as [
      unknown,
      unknown,
      ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>,
    ];
    const interviewPrompt = interviewCall[2]?.map((message) => message.content).join("\n") ?? "";
    expect(interviewPrompt).toContain("주요 통치 규칙은 무엇이어야 하나요?");
    expect(interviewPrompt).toContain("왕권과 제도의 충돌을 다룬다.");
    expect(interviewPrompt).toContain("주인공이 지키려는 통치 원칙이 아직 흐리다.");
    expect(interviewPrompt).toContain("이번 편집에서 통치 정당성의 기준을 남긴다.");
    expect(interviewPrompt).toContain("정렬 인터뷰어 제약:");

    const persisted = await readFile(join(root, "books", "assist-question-book", "story", "author_intent.md"), "utf-8");
    expect(persisted).toContain("왕권과 제도의 충돌");
  });

  it("falls back to the raw interview content when the model returns a plain-text question", async () => {
    await seedFitCheckBook(root, "assist-question-fallback-book", "질문 fallback 테스트", [
      { file: "author_intent.md", content: "# 작가 의도\n\n왕권과 제도의 충돌을 다룬다.\n" },
    ]);
    chatCompletionMock.mockResolvedValueOnce({
      content: "이번 문서에서 통치 정당성의 기준이 이미 확정돼 있나요?",
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/assist-question-fallback-book/truth/assist", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        fileName: "author_intent.md",
        mode: "question",
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      mode: string;
      content: string;
      question: string;
      changes: ReadonlyArray<unknown>;
    };
    expect(body).toMatchObject({
      mode: "question",
      content: "이번 문서에서 통치 정당성의 기준이 이미 확정돼 있나요?",
      question: "이번 문서에서 통치 정당성의 기준이 이미 확정돼 있나요?",
      changes: [],
    });
  });

  it("rejects file-scoped multi-target truth-file proposals", async () => {
    chatCompletionMock.mockClear();
    await seedFitCheckBook(root, "assist-bundle-book", "묶음 제안 테스트", [
      { file: "author_intent.md", content: "# 작가 의도\n\n제도와 권력을 다룬다.\n" },
      { file: "book_rules.md", content: "# 작품 규칙\n\n- 잔혹함은 제한적으로만 사용한다.\n" },
      { file: "story_bible.md", content: "# 스토리 바이블\n\n- 마왕국은 아직 미완성 체제다.\n" },
    ]);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/assist-bundle-book/truth/assist", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        fileNames: ["author_intent.md", "book_rules.md"],
        instruction: "통치 질서와 제도 비용이 더 잘 보이게 둘 다 조정해줘",
        conversation: [{ role: "user", content: "이번에는 작품의 냉정함을 더 살리고 싶어." }],
        scope: { kind: "file", fileName: "author_intent.md" },
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "TRUTH_SCOPE_MULTI_FILE_UNSUPPORTED" });
    expect(chatCompletionMock).not.toHaveBeenCalled();

    const persistedIntent = await readFile(join(root, "books", "assist-bundle-book", "story", "author_intent.md"), "utf-8");
    const persistedRules = await readFile(join(root, "books", "assist-bundle-book", "story", "book_rules.md"), "utf-8");
    expect(persistedIntent).toContain("제도와 권력을 다룬다");
    expect(persistedRules).toContain("잔혹함은 제한적으로만 사용한다");
  });

  it("rejects proposal mode when the request names mixed valid and invalid targets", async () => {
    await seedFitCheckBook(root, "assist-mixed-bundle-book", "혼합 묶음 제안 테스트", [
      { file: "author_intent.md", content: "# 작가 의도\n\n제도와 권력을 다룬다.\n" },
    ]);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/assist-mixed-bundle-book/truth/assist", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        fileNames: ["author_intent.md", "notes.md"],
        mode: "proposal",
        instruction: "통치 질서에 대한 의도를 더 선명하게 조정해줘",
        scope: { kind: "file", fileName: "author_intent.md" },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "TRUTH_SCOPE_MULTI_FILE_UNSUPPORTED" });
    expect(chatCompletionMock).not.toHaveBeenCalled();

    const persistedIntent = await readFile(join(root, "books", "assist-mixed-bundle-book", "story", "author_intent.md"), "utf-8");
    expect(persistedIntent).toContain("제도와 권력을 다룬다");
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
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
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

  it("rejects duplicate quick-create requests for the same book while creation is in flight", async () => {
    let resolveInit: (() => void) | undefined;
    initBookMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveInit = resolve;
    }));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);
    const request = {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Concurrent Create Book",
        genre: "modern-fantasy",
        platform: "naver-series",
        language: "ko",
      }),
    } satisfies RequestInit;

    const responses = await Promise.all([
      app.request("http://localhost/api/books/create", request),
      app.request("http://localhost/api/books/create", request),
    ]);

    expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([200, 409]);
    const accepted = responses.find((response) => response.status === 200);
    const rejected = responses.find((response) => response.status === 409);
    expect(accepted).toBeDefined();
    expect(rejected).toBeDefined();
    await expect(accepted!.json()).resolves.toMatchObject({
      status: "creating",
      bookId: "concurrent-create-book",
    });
    await expect(rejected!.json()).resolves.toMatchObject({
      error: {
        code: "BOOK_CREATE_ALREADY_IN_PROGRESS",
        message: expect.stringContaining('already being created'),
      },
    });
    expect(initBookMock).toHaveBeenCalledTimes(1);

    resolveInit?.();
    await Promise.resolve();
  });


  it("replays quick-create requests with the same idempotency key and payload", async () => {
    let resolveInit: (() => void) | undefined;
    initBookMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveInit = resolve;
    }));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);
    const request = {
      method: "POST",
      headers: jsonHeaders("quick-create-replay"),
      body: JSON.stringify({
        title: "Idempotent Create Book",
        genre: "modern-fantasy",
        platform: "naver-series",
        language: "ko",
      }),
    } satisfies RequestInit;

    const first = await app.request("http://localhost/api/books/create", request);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      status: "creating",
      bookId: "idempotent-create-book",
    });

    const replay = await app.request("http://localhost/api/books/create", request);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      status: "creating",
      bookId: "idempotent-create-book",
    });

    expect(initBookMock).toHaveBeenCalledTimes(1);
    resolveInit?.();
    await Promise.resolve();
  });

  it("replays quick-create idempotency keys after a server restart", async () => {
    let resolveInit: (() => void) | undefined;
    initBookMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveInit = resolve;
    }));

    const { createStudioServer } = await import("./server.js");
    const firstApp = createStudioServer(cloneProjectConfig() as never, root);
    const request = quickCreateRequest({
      title: "Durable Idempotent Create Book",
      genre: "modern-fantasy",
      platform: "naver-series",
      language: "ko",
    }, "quick-create-restart");

    const first = await firstApp.request("http://localhost/api/books/create", request);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      status: "creating",
      bookId: "durable-idempotent-create-book",
    });

    const restartedApp = createStudioServer(cloneProjectConfig() as never, root);
    const replay = await restartedApp.request("http://localhost/api/books/create", request);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      status: "creating",
      bookId: "durable-idempotent-create-book",
    });

    expect(initBookMock).toHaveBeenCalledTimes(1);
    resolveInit?.();
    await Promise.resolve();
  });

  it("rejects reused idempotency keys when the quick-create payload changes", async () => {
    let resolveInit: (() => void) | undefined;
    initBookMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveInit = resolve;
    }));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const first = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: jsonHeaders("quick-create-conflict"),
      body: JSON.stringify({
        title: "Idempotency Conflict Book",
        genre: "modern-fantasy",
        platform: "naver-series",
        language: "ko",
      }),
    });
    expect(first.status).toBe(200);

    const conflict = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: jsonHeaders("quick-create-conflict"),
      body: JSON.stringify({
        title: "Different Conflict Book",
        genre: "modern-fantasy",
        platform: "naver-series",
        language: "ko",
      }),
    });
    expect(conflict.status).toBe(422);
    await expect(conflict.json()).resolves.toMatchObject({
      error: {
        code: "IDEMPOTENCY_KEY_REUSED",
        message: expect.stringContaining('already used'),
      },
    });

    expect(initBookMock).toHaveBeenCalledTimes(1);
    resolveInit?.();
    await Promise.resolve();
  });

  it("rejects concurrent quick-create retries while the same idempotency key is in flight", async () => {
    let resolveConfig: ((value: unknown) => void) | undefined;
    loadProjectConfigMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveConfig = resolve;
    }));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(null, root);
    const request = quickCreateRequest({
      title: "In Flight Idempotent Create",
      genre: "modern-fantasy",
      platform: "naver-series",
      language: "ko",
    }, "quick-create-in-flight");

    const firstPromise = Promise.resolve(app.request("http://localhost/api/books/create", request));
    for (let attempt = 0; attempt < 40 && !resolveConfig; attempt += 1) {
      await Promise.resolve();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    expect(loadProjectConfigMock).toHaveBeenCalledTimes(1);
    expect(resolveConfig).toBeTypeOf("function");

    const conflict = await app.request("http://localhost/api/books/create", request);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: {
        code: "IDEMPOTENCY_KEY_IN_FLIGHT",
        message: expect.stringContaining('still in progress'),
      },
    });

    resolveConfig?.(cloneProjectConfig());
    const first = await firstPromise;
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      status: "creating",
      bookId: "in-flight-idempotent-create",
    });
    expect(initBookMock).toHaveBeenCalledTimes(1);
  });

  it("creates a book setup proposal without queuing book creation", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Grounded political fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Setup Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- How harsh should the family politics be?",
        "",
        "## Approved Creative Brief",
        "Keep the setup politically grounded and focus on inheritance pressure.",
        "",
        "## Why This Shape",
        "It keeps the premise narrow enough for clean alignment.",
      ].join("\n"),
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Setup Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
        brief: "A succession struggle inside a declining guild family.",
        conversation: [
          { role: "user", content: "Keep it politically grounded." },
          { role: "assistant", content: "Understood. We will avoid flashy late-stage lore." },
        ],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "proposed",
      bookId: "setup-book",
      title: "Setup Book",
      proposal: {
        content: expect.stringContaining("## Approved Creative Brief"),
      },
    });
    expect(initBookMock).not.toHaveBeenCalled();
  });

  it("revises a setup proposal in place and exposes the previous proposal", async () => {
    chatCompletionMock
      .mockResolvedValueOnce({
        content: [
          "# Setup Proposal",
          "## Alignment Summary",
          "Grounded succession fantasy.",
          "",
          "## Chosen Parameters",
          "- Title: Revision Setup Book",
          "- Genre: modern-fantasy",
          "",
          "## Open Questions",
          "- How visible should the family debt be?",
          "",
          "## Approved Creative Brief",
          "Keep the setup politically grounded and focus on inheritance pressure.",
          "",
          "## Why This Shape",
          "It keeps the premise narrow enough for clean alignment.",
        ].join("\n"),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      })
      .mockResolvedValueOnce({
        content: [
          "# Setup Proposal",
          "## Alignment Summary",
          "Sharper succession fantasy with financial pressure.",
          "",
          "## Chosen Parameters",
          "- Title: Revision Setup Book",
          "- Genre: modern-fantasy",
          "",
          "## Open Questions",
          "- Which faction benefits most from the debt?",
          "",
          "## Approved Creative Brief",
          "Lean harder into debt leverage and succession brinkmanship.",
          "",
          "## Why This Shape",
          "It gives the revision a clearer source of pressure.",
        ].join("\n"),
        usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
      });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const initialResponse = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Revision Setup Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
        brief: "Keep the first pass conservative.",
      }),
    });
    expect(initialResponse.status).toBe(200);
    const initialSession = await initialResponse.json() as {
      id: string;
      revision: number;
      proposal: { content: string; revision: number };
    };

    const reviseResponse = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        sessionId: initialSession.id,
        expectedRevision: initialSession.revision,
        title: "Revision Setup Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
        brief: "Push the revision toward debt politics.",
      }),
    });

    expect(reviseResponse.status).toBe(200);
    await expect(reviseResponse.json()).resolves.toMatchObject({
      id: initialSession.id,
      revision: 2,
      status: "proposed",
      proposal: {
        revision: 2,
        content: expect.stringContaining("debt leverage"),
      },
      previousProposal: {
        revision: 1,
        content: initialSession.proposal.content,
      },
    });

    const restored = await app.request("http://localhost/api/book-setup/" + initialSession.id);
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      id: initialSession.id,
      revision: 2,
      previousProposal: {
        content: initialSession.proposal.content,
      },
    });
  });

  it("clears the exact foundation preview state when revising a setup proposal", async () => {
    chatCompletionMock
      .mockResolvedValueOnce({
        content: [
          "# Setup Proposal",
          "## Alignment Summary",
          "Focused family succession fantasy.",
          "",
          "## Chosen Parameters",
          "- Title: Reset Preview Book",
          "- Genre: modern-fantasy",
          "",
          "## Open Questions",
          "- None for the MVP proposal.",
          "",
          "## Approved Creative Brief",
          "Keep the foundation tightly scoped around inheritance politics.",
          "",
          "## Why This Shape",
          "It stays reviewable before any write.",
        ].join("\n"),
        usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
      })
      .mockResolvedValueOnce({
        content: [
          "# Setup Proposal",
          "## Alignment Summary",
          "Refocused inheritance fantasy with stricter political cost.",
          "",
          "## Chosen Parameters",
          "- Title: Reset Preview Book",
          "- Genre: modern-fantasy",
          "",
          "## Open Questions",
          "- Which family ally breaks first?",
          "",
          "## Approved Creative Brief",
          "Reframe the setup around brittle alliances and visible succession costs.",
          "",
          "## Why This Shape",
          "The revision should force a fresh exact preview.",
        ].join("\n"),
        usage: { promptTokens: 12, completionTokens: 22, totalTokens: 34 },
      });
    proposeBookMock.mockResolvedValueOnce(makeBookInitProposal({
      id: "reset-preview-book",
      title: "Reset Preview Book",
      genre: "modern-fantasy",
      platform: "naver-series",
      language: "ko",
      targetChapters: 200,
      chapterWordCount: 3000,
    }));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Reset Preview Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number; proposal: { content: string } };

    expect((await approveSetupSession(app, session.id, session.revision)).status).toBe(200);
    const preview = await previewSetupSession(app, session.id, 2);
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({
      foundationPreview: {
        revision: 3,
      },
    });

    const revise = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        sessionId: session.id,
        expectedRevision: 3,
        title: "Reset Preview Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
        brief: "Make the faction collapse more brittle.",
      }),
    });

    expect(revise.status).toBe(200);
    const revisedPayload = await revise.json() as {
      id: string;
      revision: number;
      status: string;
      proposal: { content: string; revision: number };
      previousProposal: { content: string; revision: number };
      foundationPreview?: { revision: number };
    };
    expect(revisedPayload).toMatchObject({
      id: session.id,
      revision: 4,
      status: "proposed",
      proposal: {
        revision: 4,
        content: expect.stringContaining("brittle alliances"),
      },
      previousProposal: {
        revision: 1,
        content: session.proposal.content,
      },
    });
    expect(revisedPayload).not.toHaveProperty("foundationPreview");

    const persistedRaw = await readFile(join(root, ".inkos", "studio", "book-setup", session.id + ".json"), "utf-8");
    const persisted = JSON.parse(persistedRaw) as { session: Record<string, unknown> };
    expect(persisted.session).toMatchObject({
      id: session.id,
      revision: 4,
      status: "proposed",
      previousProposal: {
        content: session.proposal.content,
      },
    });
    expect(persisted.session).not.toHaveProperty("foundationPreview");
    expect(persisted.session).not.toHaveProperty("exactProposal");

    const restored = await app.request("http://localhost/api/book-setup/" + session.id);
    expect(restored.status).toBe(200);
    const restoredPayload = await restored.json() as Record<string, unknown>;
    expect(restoredPayload).toMatchObject({
      id: session.id,
      revision: 4,
      status: "proposed",
      previousProposal: {
        content: session.proposal.content,
      },
    });
    expect(restoredPayload).not.toHaveProperty("foundationPreview");
  });

  it("rejects stale expected revisions when revising a setup proposal", async () => {
    chatCompletionMock
      .mockResolvedValueOnce({
        content: [
          "# Setup Proposal",
          "## Alignment Summary",
          "Focused family succession fantasy.",
          "",
          "## Chosen Parameters",
          "- Title: Stale Proposal Revision Book",
          "- Genre: modern-fantasy",
          "",
          "## Open Questions",
          "- None for the MVP proposal.",
          "",
          "## Approved Creative Brief",
          "Keep the setup tightly scoped around inheritance politics.",
          "",
          "## Why This Shape",
          "It stays reviewable before any write.",
        ].join("\n"),
        usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
      })
      .mockResolvedValueOnce({
        content: [
          "# Setup Proposal",
          "## Alignment Summary",
          "A revised take with clearer factional pressure.",
          "",
          "## Chosen Parameters",
          "- Title: Stale Proposal Revision Book",
          "- Genre: modern-fantasy",
          "",
          "## Open Questions",
          "- Which sibling breaks first?",
          "",
          "## Approved Creative Brief",
          "Dial the revision toward brittle alliances and debt pressure.",
          "",
          "## Why This Shape",
          "It sharpens the conflict without widening scope.",
        ].join("\n"),
        usage: { promptTokens: 12, completionTokens: 22, totalTokens: 34 },
      });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Stale Proposal Revision Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    const firstRevision = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        sessionId: session.id,
        expectedRevision: session.revision,
        title: "Stale Proposal Revision Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
        brief: "Make the second pass sharper.",
      }),
    });
    expect(firstRevision.status).toBe(200);

    const staleRevision = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        sessionId: session.id,
        expectedRevision: session.revision,
        title: "Stale Proposal Revision Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
        brief: "Try to revise again from stale data.",
      }),
    });

    expect(staleRevision.status).toBe(412);
    await expect(staleRevision.json()).resolves.toMatchObject({
      error: {
        code: "BOOK_SETUP_REVISION_MISMATCH",
        message: expect.stringContaining("changed while you were reviewing it"),
      },
    });
  });

  it("approves a setup proposal without queuing book creation", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Focused family succession fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Brief Locked Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- None for the MVP proposal.",
        "",
        "## Approved Creative Brief",
        "Write a grounded inheritance struggle with strict family rules and visible political costs.",
        "Keep the scope narrow and avoid surprise mythology dumps.",
        "",
        "## Why This Shape",
        "This preserves clarity before any file write.",
      ].join("\n"),
      usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Brief Locked Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });

    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    const approve = await approveSetupSession(app, session.id, session.revision);

    expect(approve.status).toBe(200);
    await expect(approve.json()).resolves.toMatchObject({
      id: session.id,
      revision: 2,
      bookId: "brief-locked-book",
      status: "approved",
      proposal: {
        content: expect.stringContaining("## Approved Creative Brief"),
      },
    });

    await Promise.resolve();
    expect(initBookMock).not.toHaveBeenCalled();
  });

  it("prepares an exact foundation preview without writing book files", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Focused family succession fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Exact Preview Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- None for the MVP proposal.",
        "",
        "## Approved Creative Brief",
        "Keep the foundation tightly scoped around inheritance politics.",
        "",
        "## Why This Shape",
        "It stays reviewable before any write.",
      ].join("\n"),
      usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
    });
    proposeBookMock.mockResolvedValueOnce(makeBookInitProposal({
      id: "exact-preview-book",
      title: "Exact Preview Book",
      genre: "modern-fantasy",
      platform: "naver-series",
      language: "ko",
      targetChapters: 200,
      chapterWordCount: 3000,
    }));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Exact Preview Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    const approve = await approveSetupSession(app, session.id, session.revision);
    expect(approve.status).toBe(200);

    const preview = await previewSetupSession(app, session.id, 2);

    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({
      id: session.id,
      revision: 3,
      status: "approved",
      foundationPreview: {
        revision: 3,
        storyBible: "# story_bible",
        volumeOutline: "# volume_outline",
        bookRules: "# book_rules",
        currentState: "# current_state",
        pendingHooks: "# pending_hooks",
      },
    });
    expect(proposeBookMock).toHaveBeenCalledTimes(1);
    expect(applyBookProposalMock).not.toHaveBeenCalled();
    expect(initBookMock).not.toHaveBeenCalled();
  });

  it("creates a book from an exact foundation preview without regenerating it", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Focused family succession fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Exact Apply Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- None for the MVP proposal.",
        "",
        "## Approved Creative Brief",
        "Keep the foundation tightly scoped around inheritance politics.",
        "",
        "## Why This Shape",
        "It stays reviewable before any write.",
      ].join("\n"),
      usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
    });
    const exactProposal = makeBookInitProposal({
      id: "exact-apply-book",
      title: "Exact Apply Book",
      genre: "modern-fantasy",
      platform: "naver-series",
      language: "ko",
      targetChapters: 200,
      chapterWordCount: 3000,
    });
    proposeBookMock.mockResolvedValueOnce(exactProposal);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Exact Apply Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    const approve = await approveSetupSession(app, session.id, session.revision);
    expect(approve.status).toBe(200);

    const preview = await previewSetupSession(app, session.id, 2);
    expect(preview.status).toBe(200);
    const previewPayload = await preview.json() as { foundationPreview: { digest: string } };
    expect(previewPayload.foundationPreview.digest).toMatch(/^sha256:/);

    const create = await createSetupSession(app, session.id, 3, previewPayload.foundationPreview.digest);

    expect(create.status).toBe(200);
    await expect(create.json()).resolves.toMatchObject({
      bookId: "exact-apply-book",
      session: {
        id: session.id,
        revision: 4,
        status: "creating",
        foundationPreview: {
          storyBible: "# story_bible",
        },
      },
    });

    await Promise.resolve();
    expect(proposeBookMock).toHaveBeenCalledTimes(1);
    expect(applyBookProposalMock).toHaveBeenCalledTimes(1);
    expect(applyBookProposalMock).toHaveBeenCalledWith(exactProposal);
    expect(initBookMock).not.toHaveBeenCalled();
    expect(pipelineConfigs.at(-1)).toMatchObject({
      externalContext: "Keep the foundation tightly scoped around inheritance politics.",
    });
  });

  it("replays setup create requests with the same idempotency key and payload", async () => {
    let resolveApply: (() => void) | undefined;
    applyBookProposalMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveApply = resolve;
    }));

    const exactProposal = makeBookInitProposal({
      id: "setup-idempotent-book",
      title: "Setup Idempotent Book",
      genre: "modern-fantasy",
      language: "ko",
      platform: "naver-series",
    });
    proposeBookMock.mockResolvedValueOnce(exactProposal);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Setup Idempotent Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
        chapterWordCount: 3000,
        targetChapters: 180,
        brief: "Replay setup create while the first request is still active.",
      }),
    });
    const session = await propose.json() as { id: string; revision: number };

    expect((await approveSetupSession(app, session.id, session.revision)).status).toBe(200);
    const preview = await previewSetupSession(app, session.id, 2);
    expect(preview.status).toBe(200);
    const previewPayload = await preview.json() as { foundationPreview: { digest: string } };

    const first = await createSetupSession(app, session.id, 3, previewPayload.foundationPreview.digest, "setup-create-replay");
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      bookId: "setup-idempotent-book",
      session: {
        status: "creating",
      },
    });

    const replay = await createSetupSession(app, session.id, 3, previewPayload.foundationPreview.digest, "setup-create-replay");
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      bookId: "setup-idempotent-book",
      session: {
        status: "creating",
      },
    });

    expect(applyBookProposalMock).toHaveBeenCalledTimes(1);
    resolveApply?.();
    await Promise.resolve();
  });

  it("replays setup create idempotency keys after a server restart", async () => {
    let resolveApply: (() => void) | undefined;
    applyBookProposalMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveApply = resolve;
    }));

    const exactProposal = makeBookInitProposal({
      id: "setup-idempotent-restart-book",
      title: "Setup Idempotent Restart Book",
      genre: "modern-fantasy",
      language: "ko",
      platform: "naver-series",
    });
    proposeBookMock.mockResolvedValueOnce(exactProposal);

    const { createStudioServer } = await import("./server.js");
    const firstApp = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await firstApp.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Setup Idempotent Restart Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    const session = await propose.json() as { id: string; revision: number };

    expect((await approveSetupSession(firstApp, session.id, session.revision)).status).toBe(200);
    const preview = await previewSetupSession(firstApp, session.id, 2);
    expect(preview.status).toBe(200);
    const previewPayload = await preview.json() as { foundationPreview: { digest: string } };

    const first = await createSetupSession(firstApp, session.id, 3, previewPayload.foundationPreview.digest, "setup-create-restart");
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      bookId: "setup-idempotent-restart-book",
      session: {
        status: "creating",
      },
    });

    const restartedApp = createStudioServer(cloneProjectConfig() as never, root);
    const replay = await createSetupSession(restartedApp, session.id, 3, previewPayload.foundationPreview.digest, "setup-create-restart");
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      bookId: "setup-idempotent-restart-book",
      session: {
        status: "creating",
      },
    });

    expect(applyBookProposalMock).toHaveBeenCalledTimes(1);
    resolveApply?.();
    await Promise.resolve();
  });

  it("recovers persisted exact-review sessions after a server restart", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Focused family succession fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Restart Preview Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- None for the MVP proposal.",
        "",
        "## Approved Creative Brief",
        "Keep the foundation tightly scoped around inheritance politics.",
        "",
        "## Why This Shape",
        "It stays reviewable before any write.",
      ].join("\n"),
      usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
    });
    const exactProposal = makeBookInitProposal({
      id: "restart-preview-book",
      title: "Restart Preview Book",
      genre: "modern-fantasy",
      platform: "naver-series",
      language: "ko",
      targetChapters: 200,
      chapterWordCount: 3000,
    });
    proposeBookMock.mockResolvedValueOnce(exactProposal);

    const { createStudioServer } = await import("./server.js");
    const firstApp = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await firstApp.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Restart Preview Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    expect((await approveSetupSession(firstApp, session.id, session.revision)).status).toBe(200);
    const preview = await previewSetupSession(firstApp, session.id, 2);
    expect(preview.status).toBe(200);
    const previewPayload = await preview.json() as { foundationPreview: { digest: string } };
    expect(previewPayload.foundationPreview.digest).toMatch(/^sha256:/);

    const persisted = await readFile(join(root, ".inkos", "studio", "book-setup", `${session.id}.json`), "utf-8");
    expect(persisted).toContain("\"exactProposal\"");

    const restartedApp = createStudioServer(cloneProjectConfig() as never, root);

    const restored = await restartedApp.request(`http://localhost/api/book-setup/${session.id}`);
    expect(restored.status).toBe(200);
    const restoredPayload = await restored.json() as { foundationPreview: { digest: string } };
    expect(restoredPayload).toMatchObject({
      id: session.id,
      status: "approved",
      bookId: "restart-preview-book",
      foundationPreview: {
        storyBible: "# story_bible",
      },
    });
    expect(restoredPayload.foundationPreview.digest).toMatch(/^sha256:/);

    const create = await createSetupSession(restartedApp, session.id, 3, restoredPayload.foundationPreview.digest);
    expect(create.status).toBe(200);
    await expect(create.json()).resolves.toMatchObject({
      bookId: "restart-preview-book",
      session: {
        id: session.id,
        status: "creating",
        foundationPreview: {
          storyBible: "# story_bible",
        },
      },
    });

    await Promise.resolve();
    expect(proposeBookMock).toHaveBeenCalledTimes(1);
    expect(applyBookProposalMock).toHaveBeenCalledTimes(1);
    expect(applyBookProposalMock).toHaveBeenCalledWith(exactProposal);
  });

  it("lists recent persisted book setup sessions after a server restart", async () => {
    const { createStudioServer } = await import("./server.js");
    const firstApp = createStudioServer(cloneProjectConfig() as never, root);

    const firstResponse = await firstApp.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Restart Session One",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(firstResponse.status).toBe(200);
    const firstSession = await firstResponse.json() as { id: string; revision: number };

    const secondResponse = await firstApp.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Restart Session Two",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(secondResponse.status).toBe(200);
    const secondSession = await secondResponse.json() as { id: string; revision: number };

    expect((await approveSetupSession(firstApp, firstSession.id, 1)).status).toBe(200);

    const restartedApp = createStudioServer(cloneProjectConfig() as never, root);

    const list = await restartedApp.request("http://localhost/api/book-setup");
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      sessions: [
        {
          id: firstSession.id,
          status: "approved",
          bookId: "restart-session-one",
        },
        {
          id: secondSession.id,
          status: "proposed",
          bookId: "restart-session-two",
        },
      ],
    });
  });

  it("trims persisted book setup sessions alongside the recent-session limit", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    for (let index = 0; index < 26; index += 1) {
      const response = await app.request("http://localhost/api/book-setup/propose", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          title: `Trim Session ${index}`,
          genre: "modern-fantasy",
          language: "ko",
          platform: "naver-series",
        }),
      });
      expect(response.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const storedFiles = (await readdir(join(root, ".inkos", "studio", "book-setup")))
      .filter((fileName) => fileName.endsWith(".json"));
    expect(storedFiles).toHaveLength(24);

    const restartedApp = createStudioServer(cloneProjectConfig() as never, root);
    const list = await restartedApp.request("http://localhost/api/book-setup");
    expect(list.status).toBe(200);
    const payload = await list.json() as { sessions: Array<{ bookId: string }> };
    expect(payload.sessions).toHaveLength(24);
    expect(payload.sessions.map((session) => session.bookId)).not.toContain("trim-session-0");
    expect(payload.sessions.map((session) => session.bookId)).not.toContain("trim-session-1");
    expect(payload.sessions.map((session) => session.bookId)).toContain("trim-session-25");
  });

  it("persists setup sessions to disk and rehydrates them after restart", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Focused family succession fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Persisted Setup Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- None for the MVP proposal.",
        "",
        "## Approved Creative Brief",
        "Keep the foundation tightly scoped around inheritance politics.",
        "",
        "## Why This Shape",
        "It stays reviewable before any write.",
      ].join("\n"),
      usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
    });
    const exactProposal = makeBookInitProposal({
      id: "persisted-setup-book",
      title: "Persisted Setup Book",
      genre: "modern-fantasy",
      platform: "naver-series",
      language: "ko",
      targetChapters: 200,
      chapterWordCount: 3000,
    });
    proposeBookMock.mockResolvedValueOnce(exactProposal);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Persisted Setup Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    const approve = await approveSetupSession(app, session.id, session.revision);
    expect(approve.status).toBe(200);

    const preview = await previewSetupSession(app, session.id, 2);
    expect(preview.status).toBe(200);

    const persistedRaw = await readFile(join(root, ".inkos", "studio", "book-setup", session.id + ".json"), "utf-8");
    expect(JSON.parse(persistedRaw)).toMatchObject({
      kind: "inkos-book-setup-session",
      version: 1,
      session: {
        id: session.id,
        revision: 3,
        status: "approved",
        foundationPreview: {
          storyBible: "# story_bible",
        },
      },
    });

    const restarted = createStudioServer(cloneProjectConfig() as never, root);

    const list = await restarted.request("http://localhost/api/book-setup");
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      sessions: [
        expect.objectContaining({
          id: session.id,
          title: "Persisted Setup Book",
          status: "approved",
        }),
      ],
    });

    const restored = await restarted.request("http://localhost/api/book-setup/" + session.id);
    expect(restored.status).toBe(200);
    const restoredPayload = await restored.json() as { foundationPreview: { digest: string } };
    expect(restoredPayload).toMatchObject({
      id: session.id,
      revision: 3,
      status: "approved",
      foundationPreview: {
        revision: 3,
        storyBible: "# story_bible",
        volumeOutline: "# volume_outline",
      },
    });
    expect(restoredPayload.foundationPreview.digest).toMatch(/^sha256:/);

    const create = await createSetupSession(restarted, session.id, 3, restoredPayload.foundationPreview.digest);
    expect(create.status).toBe(200);
    await expect(create.json()).resolves.toMatchObject({
      bookId: "persisted-setup-book",
      session: {
        id: session.id,
        revision: 4,
        status: "creating",
      },
    });

    await Promise.resolve();
    expect(proposeBookMock).toHaveBeenCalledTimes(1);
    expect(applyBookProposalMock).toHaveBeenCalledTimes(1);
    expect(applyBookProposalMock).toHaveBeenCalledWith(exactProposal);
  });

  it("rejects setup creation until the exact foundation preview is prepared", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Focused family succession fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Brief Locked Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- None for the MVP proposal.",
        "",
        "## Approved Creative Brief",
        "Write a grounded inheritance struggle with strict family rules and visible political costs.",
        "Keep the scope narrow and avoid surprise mythology dumps.",
        "",
        "## Why This Shape",
        "This preserves clarity before any file write.",
      ].join("\n"),
      usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Brief Locked Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });

    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    const approve = await approveSetupSession(app, session.id, session.revision);
    expect(approve.status).toBe(200);

    const create = await createSetupSession(app, session.id, 2);

    expect(create.status).toBe(409);
    await expect(create.json()).resolves.toMatchObject({
      error: {
        code: "BOOK_SETUP_FOUNDATION_PREVIEW_REQUIRED",
        message: expect.stringContaining("exact foundation preview"),
      },
    });

    await Promise.resolve();
    expect(initBookMock).not.toHaveBeenCalled();
    expect(applyBookProposalMock).not.toHaveBeenCalled();
  });
  it("requires setup revision preconditions for approval", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Focused family succession fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Revision Guard Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- None for the MVP proposal.",
        "",
        "## Approved Creative Brief",
        "Keep the setup tightly scoped around inheritance politics.",
        "",
        "## Why This Shape",
        "It stays reviewable before any write.",
      ].join("\n"),
      usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Revision Guard Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    const approve = await app.request("http://localhost/api/book-setup/" + session.id + "/approve", {
      method: "POST",
    });
    expect(approve.status).toBe(428);
    await expect(approve.json()).resolves.toMatchObject({
      error: {
        code: "BOOK_SETUP_PRECONDITION_REQUIRED",
        message: expect.stringContaining("expected revision"),
      },
    });
  });

  it("blocks approval while proposal review threads still request changes", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Focused family succession fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Review Gate Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- None for the MVP proposal.",
        "",
        "## Approved Creative Brief",
        "Keep the setup tightly scoped around inheritance politics.",
        "",
        "## Why This Shape",
        "It stays reviewable before any write.",
      ].join("\n"),
      usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Review Gate Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    const saveReviews = await saveSetupReviewThreads(app, session.id, session.revision, [{
      id: "proposal-thread-1",
      targetId: "proposal",
      targetLabel: "Setup Proposal",
      startLine: 2,
      endLine: 4,
      decision: "request-change",
      status: "open",
      note: "Tighten the inheritance conflict.",
      quote: "Focused family succession fantasy.",
      createdAt: "2026-04-17T00:00:05.000Z",
      resolvedAt: null,
    }]);
    expect(saveReviews.status).toBe(200);
    const reviewed = await saveReviews.json() as { revision: number; status: string; reviewThreads: unknown[]; foundationPreview?: unknown };
    expect(reviewed.status).toBe("proposed");
    expect(reviewed.reviewThreads).toHaveLength(1);
    expect(reviewed.foundationPreview).toBeUndefined();

    const approve = await approveSetupSession(app, session.id, reviewed.revision);
    expect(approve.status).toBe(409);
    await expect(approve.json()).resolves.toMatchObject({
      error: {
        code: "BOOK_SETUP_REVIEW_CHANGES_PENDING",
        message: expect.stringContaining("requested changes"),
      },
    });
  });

  it("rejects stale setup approval revisions", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Focused family succession fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Stale Approval Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- None for the MVP proposal.",
        "",
        "## Approved Creative Brief",
        "Keep the setup tightly scoped around inheritance politics.",
        "",
        "## Why This Shape",
        "It stays reviewable before any write.",
      ].join("\n"),
      usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Stale Approval Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    expect((await approveSetupSession(app, session.id, session.revision)).status).toBe(200);

    const staleApprove = await approveSetupSession(app, session.id, session.revision);
    expect(staleApprove.status).toBe(412);
    await expect(staleApprove.json()).resolves.toMatchObject({
      error: {
        code: "BOOK_SETUP_REVISION_MISMATCH",
        message: expect.stringContaining("changed while you were reviewing it"),
      },
    });
  });

  it("rejects stale setup create revisions after preview review moved forward", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Focused family succession fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Stale Create Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- None for the MVP proposal.",
        "",
        "## Approved Creative Brief",
        "Keep the foundation tightly scoped around inheritance politics.",
        "",
        "## Why This Shape",
        "It stays reviewable before any write.",
      ].join("\n"),
      usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
    });
    proposeBookMock.mockResolvedValueOnce(makeBookInitProposal({
      id: "stale-create-book",
      title: "Stale Create Book",
      genre: "modern-fantasy",
      platform: "naver-series",
      language: "ko",
      targetChapters: 200,
      chapterWordCount: 3000,
    }));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Stale Create Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    expect((await approveSetupSession(app, session.id, session.revision)).status).toBe(200);
    expect((await previewSetupSession(app, session.id, 2)).status).toBe(200);

    const staleCreate = await createSetupSession(app, session.id, 2);
    expect(staleCreate.status).toBe(412);
    await expect(staleCreate.json()).resolves.toMatchObject({
      error: {
        code: "BOOK_SETUP_REVISION_MISMATCH",
        message: expect.stringContaining("changed while you were reviewing it"),
      },
    });
  });

  it("blocks create while foundation review threads still request changes", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Focused family succession fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Foundation Review Gate Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- None for the MVP proposal.",
        "",
        "## Approved Creative Brief",
        "Keep the foundation tightly scoped around inheritance politics.",
        "",
        "## Why This Shape",
        "It stays reviewable before any write.",
      ].join("\n"),
      usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
    });
    proposeBookMock.mockResolvedValueOnce(makeBookInitProposal({
      id: "foundation-review-gate-book",
      title: "Foundation Review Gate Book",
      genre: "modern-fantasy",
      platform: "naver-series",
      language: "ko",
      targetChapters: 200,
      chapterWordCount: 3000,
    }));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Foundation Review Gate Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    const approve = await approveSetupSession(app, session.id, session.revision);
    expect(approve.status).toBe(200);

    const preview = await previewSetupSession(app, session.id, 2);
    expect(preview.status).toBe(200);
    const previewed = await preview.json() as { revision: number; foundationPreview: { digest: string } };

    const saveReviews = await saveSetupReviewThreads(app, session.id, previewed.revision, [{
      id: "foundation-thread-1",
      targetId: "foundation:storyBible",
      targetLabel: "Story Bible",
      startLine: 1,
      endLine: 2,
      decision: "request-change",
      status: "open",
      note: "Clarify the succession law.",
      quote: "# story_bible",
      createdAt: "2026-04-17T00:00:08.000Z",
      resolvedAt: null,
    }]);
    expect(saveReviews.status).toBe(200);
    const reviewed = await saveReviews.json() as { revision: number; reviewThreads: unknown[]; foundationPreview: { digest: string } };
    expect(reviewed.reviewThreads).toHaveLength(1);
    expect(reviewed.foundationPreview.digest).toBe(previewed.foundationPreview.digest);

    const create = await createSetupSession(app, session.id, reviewed.revision, previewed.foundationPreview.digest);
    expect(create.status).toBe(409);
    await expect(create.json()).resolves.toMatchObject({
      error: {
        code: "BOOK_SETUP_REVIEW_CHANGES_PENDING",
        message: expect.stringContaining("requested changes"),
      },
    });
  });

  it("refreshes the foundation preview when a foundation review request is resolved", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Focused family succession fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Refresh Preview Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- None for the MVP proposal.",
        "",
        "## Approved Creative Brief",
        "Keep the foundation tightly scoped around inheritance politics.",
        "",
        "## Why This Shape",
        "It stays reviewable before any write.",
      ].join("\n"),
      usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
    });
    proposeBookMock.mockResolvedValueOnce(makeBookInitProposal({
      id: "refresh-preview-book",
      title: "Refresh Preview Book",
      genre: "modern-fantasy",
      platform: "naver-series",
      language: "ko",
    }));
    proposeBookMock.mockResolvedValueOnce({
      ...makeBookInitProposal({
        id: "refresh-preview-book",
        title: "Refresh Preview Book",
        genre: "modern-fantasy",
        platform: "naver-series",
        language: "ko",
      }),
      foundation: {
        storyBible: "# refreshed_story_bible",
        volumeOutline: "# refreshed_volume_outline",
        bookRules: "# refreshed_book_rules",
        currentState: "# refreshed_current_state",
        pendingHooks: "# refreshed_pending_hooks",
      },
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Refresh Preview Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    expect((await approveSetupSession(app, session.id, session.revision)).status).toBe(200);
    const preview = await previewSetupSession(app, session.id, 2);
    expect(preview.status).toBe(200);
    const previewed = await preview.json() as { revision: number; foundationPreview: { storyBible: string } };
    expect(previewed.foundationPreview.storyBible).toBe("# story_bible");

    const openReview = await saveSetupReviewThreads(app, session.id, previewed.revision, [{
      id: "foundation-thread-refresh",
      targetId: "foundation:storyBible",
      targetLabel: "Story Bible",
      startLine: 1,
      endLine: 2,
      decision: "request-change",
      status: "open",
      note: "Clarify the succession law.",
      quote: "# story_bible",
      createdAt: "2026-04-17T00:00:09.000Z",
      resolvedAt: null,
    }]);
    expect(openReview.status).toBe(200);
    const opened = await openReview.json() as { revision: number; foundationPreview: { storyBible: string } };
    expect(opened.foundationPreview.storyBible).toBe("# story_bible");

    const resolvedReview = await app.request(`http://localhost/api/book-setup/${session.id}/reviews`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({
        expectedRevision: opened.revision,
        refreshPreviewOnResolve: true,
        reviewThreads: [{
          id: "foundation-thread-refresh",
          targetId: "foundation:storyBible",
          targetLabel: "Story Bible",
          startLine: 1,
          endLine: 2,
          decision: "request-change",
          status: "resolved",
          note: "Clarify the succession law.",
          quote: "# story_bible",
          createdAt: "2026-04-17T00:00:09.000Z",
          resolvedAt: "2026-04-17T00:00:10.000Z",
        }],
      }),
    });
    expect(resolvedReview.status).toBe(200);
    const resolved = await resolvedReview.json() as {
      revision: number;
      foundationPreview: { storyBible: string; volumeOutline: string };
      reviewThreads: Array<{ status: string; resolvedAt?: string | null }>;
    };
    expect(resolved.revision).toBe(opened.revision + 1);
    expect(resolved.foundationPreview.storyBible).toBe("# refreshed_story_bible");
    expect(resolved.foundationPreview.volumeOutline).toBe("# refreshed_volume_outline");
    expect(resolved.reviewThreads[0]).toMatchObject({
      status: "resolved",
      resolvedAt: "2026-04-17T00:00:10.000Z",
    });
  });

  it("requires preview digests when creating from an exact foundation preview", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Focused family succession fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Digest Guard Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- None for the MVP proposal.",
        "",
        "## Approved Creative Brief",
        "Keep the foundation tightly scoped around inheritance politics.",
        "",
        "## Why This Shape",
        "It stays reviewable before any write.",
      ].join("\n"),
      usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
    });
    proposeBookMock.mockResolvedValueOnce(makeBookInitProposal({
      id: "digest-guard-book",
      title: "Digest Guard Book",
      genre: "modern-fantasy",
      platform: "naver-series",
      language: "ko",
      targetChapters: 200,
      chapterWordCount: 3000,
    }));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Digest Guard Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    expect((await approveSetupSession(app, session.id, session.revision)).status).toBe(200);
    expect((await previewSetupSession(app, session.id, 2)).status).toBe(200);

    const create = await createSetupSession(app, session.id, 3);
    expect(create.status).toBe(428);
    await expect(create.json()).resolves.toMatchObject({
      error: {
        code: "BOOK_SETUP_PRECONDITION_REQUIRED",
        message: expect.stringContaining("expected preview digest"),
      },
    });
  });

  it("rejects stale preview digests when creating from an exact foundation preview", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Setup Proposal",
        "## Alignment Summary",
        "Focused family succession fantasy.",
        "",
        "## Chosen Parameters",
        "- Title: Digest Drift Book",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- None for the MVP proposal.",
        "",
        "## Approved Creative Brief",
        "Keep the foundation tightly scoped around inheritance politics.",
        "",
        "## Why This Shape",
        "It stays reviewable before any write.",
      ].join("\n"),
      usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
    });
    proposeBookMock.mockResolvedValueOnce(makeBookInitProposal({
      id: "digest-drift-book",
      title: "Digest Drift Book",
      genre: "modern-fantasy",
      platform: "naver-series",
      language: "ko",
      targetChapters: 200,
      chapterWordCount: 3000,
    }));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const propose = await app.request("http://localhost/api/book-setup/propose", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Digest Drift Book",
        genre: "modern-fantasy",
        language: "ko",
        platform: "naver-series",
      }),
    });
    expect(propose.status).toBe(200);
    const session = await propose.json() as { id: string; revision: number };

    expect((await approveSetupSession(app, session.id, session.revision)).status).toBe(200);
    const preview = await previewSetupSession(app, session.id, 2);
    expect(preview.status).toBe(200);
    const previewPayload = await preview.json() as { foundationPreview: { digest: string } };
    expect(previewPayload.foundationPreview.digest).toMatch(/^sha256:/);

    const staleCreate = await createSetupSession(app, session.id, 3, previewPayload.foundationPreview.digest + "-stale");
    expect(staleCreate.status).toBe(412);
    await expect(staleCreate.json()).resolves.toMatchObject({
      error: {
        code: "BOOK_SETUP_PREVIEW_DIGEST_MISMATCH",
        message: expect.stringContaining("changed while you were reviewing it"),
      },
    });
  });

  it("rejects create requests when a complete book with the same id already exists", async () => {
    await mkdir(join(root, "books", "existing-book", "story"), { recursive: true });
    await writeFile(join(root, "books", "existing-book", "book.json"), JSON.stringify({ id: "existing-book" }), "utf-8");
    await writeFile(join(root, "books", "existing-book", "story", "story_bible.md"), "# existing", "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Existing Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining('Book "existing-book" already exists'),
      },
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
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
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
      headers: jsonHeaders(),
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

  it("returns reader settings in the book detail payload", async () => {
    await mkdir(join(root, "books", "reader-settings-book"), { recursive: true });
    await writeFile(join(root, "books", "reader-settings-book", "book.json"), JSON.stringify({
      id: "reader-settings-book",
      title: "Reader Settings Book",
      genre: "modern-fantasy",
      platform: "munpia",
      status: "active",
      targetChapters: 120,
      chapterWordCount: 2800,
      language: "ko",
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
      readerSettings: sampleReaderSettings,
    }, null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/reader-settings-book");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      book: expect.objectContaining({
        id: "reader-settings-book",
        readerSettings: sampleReaderSettings,
      }),
    });
  }, READER_SETTINGS_TEST_TIMEOUT_MS);

  it("returns structural gate summaries for saved chapters and a pending blocked next chapter", async () => {
    await mkdir(join(root, "books", "structural-gate-book", "chapters"), { recursive: true });
    await mkdir(join(root, "books", "structural-gate-book", "story", "runtime"), { recursive: true });
    await writeFile(join(root, "books", "structural-gate-book", "book.json"), JSON.stringify({
      id: "structural-gate-book",
      title: "Structural Gate Book",
      genre: "modern-fantasy",
      platform: "munpia",
      status: "active",
      targetChapters: 40,
      chapterWordCount: 2400,
      language: "ko",
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    }, null, 2), "utf-8");
    await writeFile(join(root, "books", "structural-gate-book", "chapters", "index.json"), JSON.stringify([
      {
        number: 1,
        title: "1화",
        status: "ready-for-review",
        wordCount: 1200,
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
    ], null, 2), "utf-8");
    await writeFile(
      join(root, "books", "structural-gate-book", "story", "runtime", "chapter-0001.structural-gate.json"),
      JSON.stringify({
        firstPass: {
          passed: true,
          summary: "soft only",
          criticalFindings: [],
          softFindings: [
            {
              severity: "soft",
              code: "clarity-gap",
              message: "Scene geography is vague.",
              evidence: "The bridge layout is unclear.",
              location: "scene break",
            },
          ],
        },
        reviserInvoked: false,
        finalBlockingStatus: "passed",
      }, null, 2),
      "utf-8",
    );
    await writeFile(
      join(root, "books", "structural-gate-book", "story", "runtime", "chapter-0002.structural-gate.json"),
      JSON.stringify({
        firstPass: {
          passed: false,
          summary: "missing foundation",
          criticalFindings: [
            {
              severity: "critical",
              code: "missing-foundation",
              message: "Opening contract is missing.",
              location: "opening",
            },
          ],
          softFindings: [],
        },
        secondPass: {
          passed: false,
          summary: "still missing foundation",
          criticalFindings: [
            {
              severity: "critical",
              code: "missing-foundation",
              message: "Opening contract is still missing.",
              location: "opening",
            },
          ],
          softFindings: [],
        },
        reviserInvoked: true,
        finalBlockingStatus: "blocked",
      }, null, 2),
      "utf-8",
    );

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/structural-gate-book");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      nextChapter: 2,
      chapters: [
        expect.objectContaining({
          number: 1,
          structuralGate: expect.objectContaining({
            chapterNumber: 1,
            finalBlockingStatus: "passed",
            softFindings: [
              expect.objectContaining({
                code: "clarity-gap",
                message: "Scene geography is vague.",
              }),
            ],
          }),
        }),
      ],
      pendingStructuralGate: expect.objectContaining({
        chapterNumber: 2,
        finalBlockingStatus: "blocked",
        summary: "still missing foundation",
        criticalFindings: [
          expect.objectContaining({
            code: "missing-foundation",
          }),
        ],
      }),
    });
  });

  it("returns reader settings in the chapter detail payload", async () => {
    await mkdir(join(root, "books", "reader-settings-chapter-book", "chapters"), { recursive: true });
    await writeFile(join(root, "books", "reader-settings-chapter-book", "book.json"), JSON.stringify({
      id: "reader-settings-chapter-book",
      title: "Reader Settings Chapter Book",
      genre: "modern-fantasy",
      platform: "munpia",
      status: "active",
      targetChapters: 120,
      chapterWordCount: 2800,
      language: "ko",
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
      readerSettings: sampleReaderSettings,
    }, null, 2), "utf-8");
    await writeFile(join(root, "books", "reader-settings-chapter-book", "chapters", "0001-intro.md"), "# 1화\n\n본문.", "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/reader-settings-chapter-book/chapters/1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      chapterNumber: 1,
      readerSettings: sampleReaderSettings,
    });
  }, READER_SETTINGS_TEST_TIMEOUT_MS);

  it("deletes the selected chapter and later chapters from a book", async () => {
    await mkdir(join(root, "books", "chapter-delete-book", "chapters"), { recursive: true });
    await writeFile(join(root, "books", "chapter-delete-book", "book.json"), JSON.stringify({
      id: "chapter-delete-book",
      title: "Chapter Delete Book",
      genre: "modern-fantasy",
      platform: "munpia",
      status: "active",
      targetChapters: 40,
      chapterWordCount: 2400,
      language: "ko",
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z",
    }, null, 2), "utf-8");
    await writeFile(join(root, "books", "chapter-delete-book", "chapters", "0001_start.md"), "# 1화\n\n첫 화.", "utf-8");
    await writeFile(join(root, "books", "chapter-delete-book", "chapters", "0002_middle.md"), "# 2화\n\n둘째 화.", "utf-8");
    await writeFile(join(root, "books", "chapter-delete-book", "chapters", "0003_end.md"), "# 3화\n\n셋째 화.", "utf-8");
    await writeFile(join(root, "books", "chapter-delete-book", "chapters", "index.json"), JSON.stringify([
      {
        number: 1,
        title: "1화",
        status: "approved",
        wordCount: 900,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "2화",
        status: "ready-for-review",
        wordCount: 950,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 3,
        title: "3화",
        status: "drafted",
        wordCount: 980,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
    ], null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/chapter-delete-book/chapters/2", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      chapterNumber: 2,
      deletedChapterNumbers: [2, 3],
    });

    const persistedIndex = JSON.parse(
      await readFile(join(root, "books", "chapter-delete-book", "chapters", "index.json"), "utf-8"),
    ) as Array<{ number: number }>;
    const remainingFiles = await readdir(join(root, "books", "chapter-delete-book", "chapters"));

    expect(persistedIndex).toEqual([
      expect.objectContaining({ number: 1 }),
    ]);
    expect(remainingFiles).toEqual(expect.arrayContaining(["0001_start.md", "index.json"]));
    expect(remainingFiles).not.toContain("0002_middle.md");
    expect(remainingFiles).not.toContain("0003_end.md");
  });

  it("rejects chapter deletion while a book write lock is held", async () => {
    await mkdir(join(root, "books", "chapter-delete-locked-book", "chapters"), { recursive: true });
    await writeFile(join(root, "books", "chapter-delete-locked-book", "book.json"), JSON.stringify({
      id: "chapter-delete-locked-book",
      title: "Locked Delete Book",
      genre: "modern-fantasy",
      platform: "munpia",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 2000,
      language: "ko",
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z",
    }, null, 2), "utf-8");
    await writeFile(join(root, "books", "chapter-delete-locked-book", "chapters", "0001_locked.md"), "# 1화\n\n본문.", "utf-8");
    await writeFile(join(root, "books", "chapter-delete-locked-book", "chapters", "index.json"), JSON.stringify([
      {
        number: 1,
        title: "1화",
        status: "drafted",
        wordCount: 800,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
    ], null, 2), "utf-8");
    await writeFile(join(root, "books", "chapter-delete-locked-book", ".write.lock"), "locked", "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/chapter-delete-locked-book/chapters/1", {
      method: "DELETE",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "BOOK_BUSY",
      },
    });
  });

  it("rejects book deletion while a book write lock is held", async () => {
    await mkdir(join(root, "books", "book-delete-locked-book"), { recursive: true });
    await writeFile(join(root, "books", "book-delete-locked-book", "book.json"), JSON.stringify({
      id: "book-delete-locked-book",
      title: "Locked Book Delete",
      genre: "modern-fantasy",
      platform: "munpia",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 2000,
      language: "ko",
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z",
    }, null, 2), "utf-8");
    await writeFile(join(root, "books", "book-delete-locked-book", ".write.lock"), "locked", "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/book-delete-locked-book", {
      method: "DELETE",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "BOOK_BUSY",
      },
    });
  });

  it("returns persisted chapter inline review threads in the chapter detail payload", async () => {
    await mkdir(join(root, "books", "chapter-inline-review-book", "chapters"), { recursive: true });
    await writeFile(join(root, "books", "chapter-inline-review-book", "book.json"), JSON.stringify({
      id: "chapter-inline-review-book",
      title: "Chapter Inline Review Book",
      genre: "modern-fantasy",
      platform: "munpia",
      status: "active",
      targetChapters: 40,
      chapterWordCount: 2400,
      language: "ko",
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z",
    }, null, 2), "utf-8");
    await writeFile(join(root, "books", "chapter-inline-review-book", "chapters", "0001-inline.md"), "# 1장\n\n본문.", "utf-8");
    await writeFile(join(root, "books", "chapter-inline-review-book", "chapters", "index.json"), JSON.stringify([
      {
        number: 1,
        title: "1장",
        status: "ready-for-review",
        wordCount: 1200,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
        reviewNote: JSON.stringify({
          kind: "chapter-inline-review",
          version: 1,
          threads: [
            {
              id: "chapter-thread-1",
              startLine: 2,
              endLine: 2,
              decision: "request-change",
              note: "장면 전환이 갑작스럽습니다.",
              quote: "본문.",
              createdAt: "2026-04-17T00:00:01.000Z",
            },
          ],
        }),
      },
    ], null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/chapter-inline-review-book/chapters/1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      chapterNumber: 1,
      status: "ready-for-review",
      reviewThreads: [
        {
          id: "chapter-thread-1",
          startLine: 2,
          endLine: 2,
          decision: "request-change",
          note: "장면 전환이 갑작스럽습니다.",
        },
      ],
    });
  });

  it("persists chapter inline review threads when saving and rejecting a chapter", async () => {
    await mkdir(join(root, "books", "chapter-inline-review-save-book", "chapters"), { recursive: true });
    await writeFile(join(root, "books", "chapter-inline-review-save-book", "book.json"), JSON.stringify({
      id: "chapter-inline-review-save-book",
      title: "Chapter Inline Review Save Book",
      genre: "modern-fantasy",
      platform: "munpia",
      status: "active",
      targetChapters: 40,
      chapterWordCount: 2400,
      language: "ko",
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z",
    }, null, 2), "utf-8");
    await writeFile(join(root, "books", "chapter-inline-review-save-book", "chapters", "0001-inline.md"), "# 1장\n\n기존 본문.", "utf-8");
    await writeFile(join(root, "books", "chapter-inline-review-save-book", "chapters", "index.json"), JSON.stringify([
      {
        number: 1,
        title: "1장",
        status: "ready-for-review",
        wordCount: 1200,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
    ], null, 2), "utf-8");

    const reviewThreads = [
      {
        id: "chapter-thread-save-1",
        startLine: 2,
        endLine: 2,
        decision: "request-change",
        note: "문장 톤을 다시 맞춰주세요.",
        quote: "기존 본문.",
        createdAt: "2026-04-17T00:00:02.000Z",
      },
    ];

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const saveResponse = await app.request("http://localhost/api/books/chapter-inline-review-save-book/chapters/1", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({
        content: "# 1장\n\n수정된 본문.",
        reviewThreads,
      }),
    });
    expect(saveResponse.status).toBe(200);

    const rejectResponse = await app.request("http://localhost/api/books/chapter-inline-review-save-book/chapters/1/reject", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ reviewThreads }),
    });
    expect(rejectResponse.status).toBe(200);

    const savedIndex = JSON.parse(
      await readFile(join(root, "books", "chapter-inline-review-save-book", "chapters", "index.json"), "utf-8"),
    ) as Array<{ status: string; reviewNote?: string }>;
    const parsedReviewNote = JSON.parse(savedIndex[0]?.reviewNote ?? "{}") as {
      kind?: string;
      version?: number;
      threads?: Array<{ id: string; note: string }>;
    };

    expect(savedIndex[0]?.status).toBe("rejected");
    expect(parsedReviewNote).toMatchObject({
      kind: "chapter-inline-review",
      version: 1,
      threads: [
        {
          id: "chapter-thread-save-1",
          note: "문장 톤을 다시 맞춰주세요.",
        },
      ],
    });
  });

  it("rewrites a chapter by rolling back to the previous chapter state first", async () => {
    await mkdir(join(root, "books", "rewrite-inline-feedback-book", "chapters"), { recursive: true });
    await writeFile(join(root, "books", "rewrite-inline-feedback-book", "book.json"), JSON.stringify({
      id: "rewrite-inline-feedback-book",
      title: "Rewrite Inline Feedback Book",
      genre: "modern-fantasy",
      platform: "munpia",
      status: "active",
      targetChapters: 40,
      chapterWordCount: 2400,
      language: "ko",
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z",
    }, null, 2), "utf-8");
    await writeFile(join(root, "books", "rewrite-inline-feedback-book", "chapters", "0001-first.md"), "# 1장\n\n첫 장.", "utf-8");
    await writeFile(join(root, "books", "rewrite-inline-feedback-book", "chapters", "0002-second.md"), "# 2장\n\n둘째 장.", "utf-8");
    await writeFile(join(root, "books", "rewrite-inline-feedback-book", "chapters", "0003-third.md"), "# 3장\n\n셋째 장.", "utf-8");
    await writeFile(join(root, "books", "rewrite-inline-feedback-book", "chapters", "index.json"), JSON.stringify([
      {
        number: 1,
        title: "1장",
        status: "approved",
        wordCount: 1200,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "2장",
        status: "rejected",
        wordCount: 1200,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 3,
        title: "3장",
        status: "approved",
        wordCount: 1200,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
    ], null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/rewrite-inline-feedback-book/rewrite/2", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "rewriting",
      bookId: "rewrite-inline-feedback-book",
      chapter: 2,
    });
    expect(rollbackToChapterMock).toHaveBeenCalledWith("rewrite-inline-feedback-book", 1);
    expect(writeNextChapterMock).toHaveBeenCalledWith("rewrite-inline-feedback-book");

    await expect(readFile(join(root, "books", "rewrite-inline-feedback-book", "chapters", "index.json"), "utf-8")).resolves.toContain('"number": 1');
    await expect(readFile(join(root, "books", "rewrite-inline-feedback-book", "chapters", "index.json"), "utf-8")).resolves.not.toContain('"number": 2');
    await expect(readFile(join(root, "books", "rewrite-inline-feedback-book", "chapters", "index.json"), "utf-8")).resolves.not.toContain('"number": 3');
  });

  it("updates an existing book title through the API", async () => {
    await mkdir(join(root, "books", "rename-book"), { recursive: true });
    await writeFile(join(root, "books", "rename-book", "book.json"), JSON.stringify({
      id: "rename-book",
      title: "Before Rename",
      genre: "modern-fantasy",
      platform: "munpia",
      status: "active",
      targetChapters: 120,
      chapterWordCount: 2800,
      language: "ko",
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
    }, null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/rename-book", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "After Rename" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      book: expect.objectContaining({
        id: "rename-book",
        title: "After Rename",
      }),
    });

    const saved = JSON.parse(await readFile(join(root, "books", "rename-book", "book.json"), "utf-8")) as Record<string, unknown>;
    expect(saved.title).toBe("After Rename");
  });

  it("persists reader settings when updating an existing book through the API", async () => {
    await mkdir(join(root, "books", "reader-settings-write-book"), { recursive: true });
    await writeFile(join(root, "books", "reader-settings-write-book", "book.json"), JSON.stringify({
      id: "reader-settings-write-book",
      title: "Before Reader Settings",
      genre: "modern-fantasy",
      platform: "munpia",
      status: "active",
      targetChapters: 120,
      chapterWordCount: 2800,
      language: "ko",
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
    }, null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/reader-settings-write-book", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({
        readerSettings: sampleReaderSettings,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      book: expect.objectContaining({
        id: "reader-settings-write-book",
        readerSettings: sampleReaderSettings,
      }),
    });

    const saved = JSON.parse(await readFile(join(root, "books", "reader-settings-write-book", "book.json"), "utf-8")) as Record<string, unknown>;
    expect(saved.readerSettings).toEqual(sampleReaderSettings);
  }, READER_SETTINGS_TEST_TIMEOUT_MS);

  it("rejects malformed reader settings when updating a book through the API", async () => {
    await mkdir(join(root, "books", "reader-settings-invalid-book"), { recursive: true });
    await writeFile(join(root, "books", "reader-settings-invalid-book", "book.json"), JSON.stringify({
      id: "reader-settings-invalid-book",
      title: "Before Invalid Reader Settings",
      genre: "modern-fantasy",
      platform: "munpia",
      status: "active",
      targetChapters: 120,
      chapterWordCount: 2800,
      language: "ko",
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
    }, null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/reader-settings-invalid-book", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({
        readerSettings: {
          mobile: { fontPreset: "sans", fontSize: 10, lineHeight: "bad" },
          desktop: { fontPreset: "serif", fontSize: 18, lineHeight: 1.85 },
        },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid readerSettings" });

    const saved = JSON.parse(await readFile(join(root, "books", "reader-settings-invalid-book", "book.json"), "utf-8")) as Record<string, unknown>;
    expect(saved.readerSettings).toBeUndefined();
  }, READER_SETTINGS_TEST_TIMEOUT_MS);

  it("rejects blank book titles through the API", async () => {
    await mkdir(join(root, "books", "rename-book"), { recursive: true });
    await writeFile(join(root, "books", "rename-book", "book.json"), JSON.stringify({
      id: "rename-book",
      title: "Before Rename",
      genre: "modern-fantasy",
      platform: "munpia",
      status: "active",
      targetChapters: 120,
      chapterWordCount: 2800,
      language: "ko",
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
    }, null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/rename-book", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "   " }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Book title cannot be empty" });

    const saved = JSON.parse(await readFile(join(root, "books", "rename-book", "book.json"), "utf-8")) as Record<string, unknown>;
    expect(saved.title).toBe("Before Rename");
  });

  it("serves the cockpit shell on /cockpit and keeps the root shell for compatibility routes", async () => {
    const staticDir = join(root, "studio-dist");
    await mkdir(join(staticDir, "cockpit"), { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<html><body>studio-root-shell</body></html>", "utf-8");
    await writeFile(join(staticDir, "cockpit", "index.html"), "<html><body>cockpit-shell</body></html>", "utf-8");

    const request = await createStaticServerRequest(root, staticDir);

    const rootResponse = await request("/");
    expect(rootResponse.status).toBe(200);
    await expect(rootResponse.text()).resolves.toContain("studio-root-shell");

    const compatibilityResponse = await request("/?page=cockpit&bookId=alpha");
    expect(compatibilityResponse.status).toBe(200);
    await expect(compatibilityResponse.text()).resolves.toContain("studio-root-shell");

    const cockpitResponse = await request("/cockpit");
    expect(cockpitResponse.status).toBe(200);
    await expect(cockpitResponse.text()).resolves.toContain("cockpit-shell");

    const cockpitTrailingSlashResponse = await request("/cockpit/");
    expect(cockpitTrailingSlashResponse.status).toBe(200);
    await expect(cockpitTrailingSlashResponse.text()).resolves.toContain("cockpit-shell");

    const apiRootResponse = await request("/api");
    expect(apiRootResponse.status).toBe(404);
  });

  it("continues serving static assets from /assets while the cockpit shell is enabled", async () => {
    const staticDir = join(root, "studio-dist");
    await mkdir(join(staticDir, "assets"), { recursive: true });
    await mkdir(join(staticDir, "cockpit"), { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<html><body>studio-root-shell</body></html>", "utf-8");
    await writeFile(join(staticDir, "cockpit", "index.html"), "<html><body>cockpit-shell</body></html>", "utf-8");
    await writeFile(join(staticDir, "assets", "app.js"), "console.log('asset-ok');", "utf-8");

    const request = await createStaticServerRequest(root, staticDir);

    const response = await request("/assets/app.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/javascript");
    await expect(response.text()).resolves.toContain("asset-ok");
  });
});
