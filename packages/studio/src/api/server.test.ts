import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      return [];
    }

    async loadBookConfig(): Promise<never> {
      throw new Error("not implemented");
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
    createLogger: vi.fn(() => logger),
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

describe("createStudioServer daemon lifecycle", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-server-"));
    await writeFile(join(root, "inkos.json"), JSON.stringify(projectConfig, null, 2), "utf-8");
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

    expect(response.status).toBe(200);
    expect(runRadarMock).toHaveBeenCalledTimes(1);
    expect(pipelineConfigs.at(-1)).toMatchObject({
      model: "fresh-model",
      defaultLLMConfig: expect.objectContaining({
        model: "fresh-model",
        baseUrl: "https://fresh.example.com/v1",
      }),
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
      }),
    });
    expect(saveResponse.status).toBe(200);

    const savedEnv = await readFile(globalEnvPath, "utf-8");
    expect(savedEnv).toContain("INKOS_LLM_PROVIDER=codex-cli");
    expect(savedEnv).toContain("INKOS_LLM_MODEL=gpt-5.4");
    expect(savedEnv).toContain("INKOS_DEFAULT_LANGUAGE=ko");

    const fetchResponse = await app.request("http://localhost/api/global-config");
    await expect(fetchResponse.json()).resolves.toMatchObject({
      exists: true,
      language: "ko",
      provider: "codex-cli",
      model: "gpt-5.4",
      apiKeySet: false,
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
      status: "error",
      error: "INKOS_LLM_API_KEY not set",
    });
  });
});
