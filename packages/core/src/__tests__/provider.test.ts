import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { chatCompletion, chatWithTools, type LLMClient } from "../llm/provider.js";

const ZERO_USAGE = {
  prompt_tokens: 11,
  completion_tokens: 7,
  total_tokens: 18,
} as const;

async function captureError(task: Promise<unknown>): Promise<Error> {
  try {
    await task;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected promise to reject");
}

const tempDirs: string[] = [];

async function createFakeGeminiCliFixture(): Promise<{
  readonly commandPath: string;
  readonly oauthPath: string;
  readonly isolatedHomeBase: string;
  readonly sourceHome: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "inkos-fake-gemini-cli-"));
  tempDirs.push(root);

  const sourceHome = join(root, "source-home");
  const sourceGeminiDir = join(sourceHome, ".gemini");
  const isolatedHomeBase = join(root, "isolated-home");
  const oauthPath = join(sourceGeminiDir, "oauth_creds.json");
  const sourceSettingsPath = join(sourceGeminiDir, "settings.json");
  const commandPath = join(root, "fake-gemini.mjs");

  await mkdir(sourceGeminiDir, { recursive: true });
  await writeFile(oauthPath, JSON.stringify({ test: true }), "utf-8");
  await writeFile(sourceSettingsPath, JSON.stringify({
    general: {
      previewFeatures: true,
    },
    security: {
      auth: {
        selectedType: "oauth-personal",
      },
    },
    tools: {
      autoAccept: true,
    },
  }, null, 2), "utf-8");

  const script = `#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const stdin = await new Promise((resolve, reject) => {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  process.stdin.on("error", reject);
});

const modelIndex = args.indexOf("--model");
const model = modelIndex >= 0 ? args[modelIndex + 1] : "auto-gemini-3";
const settingsPath = join(process.env.GEMINI_CLI_HOME, ".gemini", "settings.json");
const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
const toolMode = args.includes("--approval-mode");

console.log(JSON.stringify({ type: "init", session_id: "fake-session", model }));
console.log(JSON.stringify({ type: "message", role: "user", content: stdin.trim() }));

if (toolMode) {
  const discoveryCommand = settings.tools?.discoveryCommand;
  const callCommand = settings.tools?.callCommand;
  const commandsReady = typeof discoveryCommand === "string"
    && typeof callCommand === "string"
    && existsSync(discoveryCommand)
    && existsSync(callCommand)
    && (statSync(discoveryCommand).mode & 0o111) !== 0
    && (statSync(callCommand).mode & 0o111) !== 0;
  console.log(JSON.stringify({ type: "message", role: "assistant", content: commandsReady ? "TOOLS_READY" : "TOOLS_MISSING", delta: true }));
} else {
  const content = stdin.includes("ping")
    ? "FAKE_OK"
    : stdin.includes("settings snapshot")
      ? JSON.stringify({
        previewFeatures: settings.general?.previewFeatures ?? null,
        selectedType: settings.security?.auth?.selectedType ?? null,
        toolsCore: settings.tools?.core ?? null,
        autoAccept: settings.tools?.autoAccept ?? null,
      })
    : stdin.includes("which model")
      ? model
      : "UNEXPECTED_PROMPT";
  console.log(JSON.stringify({ type: "message", role: "assistant", content, delta: true }));
}

console.log(JSON.stringify({
  type: "result",
  status: "success",
  stats: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
}));
`;

  await writeFile(commandPath, script, "utf-8");
  await chmod(commandPath, 0o755);

  return { commandPath, oauthPath, isolatedHomeBase, sourceHome };
}

async function createFakeCodexCliFixture(options?: {
  readonly errorMessage?: string;
  readonly stderrMessage?: string;
}): Promise<{
  readonly commandPath: string;
  readonly authPath: string;
  readonly isolatedHomeBase: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "inkos-fake-codex-cli-"));
  tempDirs.push(root);

  const sourceHome = join(root, "source-home");
  const isolatedHomeBase = join(root, "isolated-home");
  const authPath = join(sourceHome, "auth.json");
  const commandPath = join(root, "fake-codex.mjs");

  await mkdir(sourceHome, { recursive: true });
  await writeFile(authPath, JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "token" } }), "utf-8");

  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const stdin = await new Promise((resolve, reject) => {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  process.stdin.on("error", reject);
});

const errorMessage = ${JSON.stringify(options?.errorMessage ?? "")};
const stderrMessage = ${JSON.stringify(options?.stderrMessage ?? "")};

const modelIndex = args.indexOf("--model");
const model = modelIndex >= 0 ? args[modelIndex + 1] : "gpt-5.4";
console.log(JSON.stringify({ type: "thread.started", thread_id: "fake-thread" }));
console.log(JSON.stringify({ type: "turn.started" }));

if (errorMessage) {
  console.log(JSON.stringify({ type: "error", message: errorMessage }));
  if (stderrMessage) process.stderr.write(stderrMessage);
  process.exit(1);
}

let text = "FAKE_CODEX_OK";
if (stdin.includes("Return exactly one JSON object")) {
  text = JSON.stringify({ type: "tool", name: "list_books", arguments: { limit: 1 } });
}
if (stdin.includes("Return a final JSON object")) {
  text = JSON.stringify({ type: "final", content: "DONE" });
}
if (stdin.includes("check reasoning flag")) {
  text = args.join(" ");
}

console.log(JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 21, output_tokens: 9, model } }));
`;

  await writeFile(commandPath, script, "utf-8");
  await chmod(commandPath, 0o755);

  return { commandPath, authPath, isolatedHomeBase };
}

describe("chatCompletion stream fallback", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("falls back to sync chat completion when streamed chat returns no chunks", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        async *[Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
          return;
        },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "fallback content" } }],
        usage: ZERO_USAGE,
      });

    const client: LLMClient = {
      provider: "openai",
      apiFormat: "chat",
      stream: true,
      _openai: {
        chat: {
          completions: {
            create,
          },
        },
      } as unknown as OpenAI,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0, maxTokensCap: null,
        extra: {},
      },
    };

    const result = await chatCompletion(client, "test-model", [
      { role: "user", content: "ping" },
    ]);

    expect(result.content).toBe("fallback content");
    expect(result.usage).toEqual({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ stream: true });
    expect(create.mock.calls[1]?.[0]).toMatchObject({ stream: false });
  });

  it("does not blindly suggest stream false for generic 400 errors", async () => {
    const create = vi.fn().mockRejectedValue(new Error("400 Bad Request"));

    const client: LLMClient = {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      _openai: {
        chat: {
          completions: {
            create,
          },
        },
      } as unknown as OpenAI,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0, maxTokensCap: null,
        extra: {},
      },
    };

    const error = await captureError(chatCompletion(client, "test-model", [
      { role: "user", content: "ping" },
    ]));

    expect(error.message).toContain("API returned 400");
    expect(error.message).not.toContain("\"stream\": false");
    expect(error.message).toContain("check the provider docs");
  });

  it("passes reasoning effort through OpenAI chat requests when configured", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "reasoned" } }],
      usage: ZERO_USAGE,
    });

    const client: LLMClient = {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      _openai: {
        chat: {
          completions: {
            create,
          },
        },
      } as unknown as OpenAI,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0,
        reasoningEffort: "high",
        maxTokensCap: null,
        extra: {},
      },
    };

    await chatCompletion(client, "gpt-5.4", [
      { role: "user", content: "ping" },
    ]);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      reasoning_effort: "high",
    }));
  });

  it("reports when sync fallback is rejected because provider requires streaming", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        async *[Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
          return;
        },
      })
      .mockRejectedValueOnce(new Error("400 {\"detail\":\"Stream must be set to true\"}"));

    const client: LLMClient = {
      provider: "openai",
      apiFormat: "chat",
      stream: true,
      _openai: {
        chat: {
          completions: {
            create,
          },
        },
      } as unknown as OpenAI,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0, maxTokensCap: null,
        extra: {},
      },
    };

    const error = await captureError(chatCompletion(client, "test-model", [
      { role: "user", content: "ping" },
    ]));

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ stream: true });
    expect(create.mock.calls[1]?.[0]).toMatchObject({ stream: false });
    expect(error.message).toContain("stream:true");
    expect(error.message).not.toContain("\"stream\": false");
  });

  it("treats missing extra defaults as an empty object", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
      usage: ZERO_USAGE,
    });

    const client = {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      _openai: {
        chat: {
          completions: {
            create,
          },
        },
      } as unknown as OpenAI,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0,
        maxTokensCap: null,
      },
    } as LLMClient;

    const result = await chatCompletion(client, "test-model", [
      { role: "user", content: "ping" },
    ]);

    expect(result.content).toBe("ok");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "test-model",
      stream: false,
    }));
  });

  it("dispatches gemini-cli provider to local CLI runtime", async () => {
    const client: LLMClient = {
      provider: "gemini-cli",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0, maxTokensCap: null,
        extra: {
          geminiCliCommand: "inkos-nonexistent-gemini-cli-command",
          geminiCliOauthSource: "/tmp/inkos-missing-oauth-creds.json",
        },
      },
    };

    const error = await captureError(chatCompletion(client, "auto-gemini-3", [
      { role: "user", content: "ping" },
    ]));

    expect(error.message).toContain("Gemini CLI OAuth credentials not found");
  });

  it("requires projectRoot when gemini-cli tool mode is used", async () => {
    const client: LLMClient = {
      provider: "gemini-cli",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0, maxTokensCap: null,
        extra: {},
      },
    };

    const error = await captureError(chatWithTools(
      client,
      "auto-gemini-3",
      [{ role: "user", content: "list books" }],
      [],
    ));

    expect(error.message).toContain("projectRoot");
  });

  it("streams assistant content through the gemini-cli runtime", async () => {
    const fixture = await createFakeGeminiCliFixture();
    const client: LLMClient = {
      provider: "gemini-cli",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {
          geminiCliCommand: fixture.commandPath,
          geminiCliOauthSource: fixture.oauthPath,
          geminiCliIsolatedHomeBase: fixture.isolatedHomeBase,
        },
      },
    };

    const result = await chatCompletion(client, "auto-gemini-3", [
      { role: "user", content: "ping" },
    ]);

    expect(result.content).toBe("FAKE_OK");
    expect(result.usage).toEqual({
      promptTokens: 12,
      completionTokens: 3,
      totalTokens: 15,
    });
  });

  it("uses auto-gemini-3 when the gemini-cli model is blank", async () => {
    const fixture = await createFakeGeminiCliFixture();
    const client: LLMClient = {
      provider: "gemini-cli",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {
          geminiCliCommand: fixture.commandPath,
          geminiCliOauthSource: fixture.oauthPath,
          geminiCliIsolatedHomeBase: fixture.isolatedHomeBase,
        },
      },
    };

    const result = await chatCompletion(client, "", [
      { role: "user", content: "which model" },
    ]);

    expect(result.content).toBe("auto-gemini-3");
  });

  it("preserves previewFeatures and omits empty core tool config in isolated Gemini settings", async () => {
    const fixture = await createFakeGeminiCliFixture();
    const client: LLMClient = {
      provider: "gemini-cli",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {
          geminiCliCommand: fixture.commandPath,
          geminiCliOauthSource: fixture.oauthPath,
          geminiCliSourceHome: fixture.sourceHome,
          geminiCliIsolatedHomeBase: fixture.isolatedHomeBase,
        },
      },
    };

    const result = await chatCompletion(client, "", [
      { role: "user", content: "settings snapshot" },
    ]);

    expect(JSON.parse(result.content)).toEqual({
      previewFeatures: true,
      selectedType: "oauth-personal",
      toolsCore: null,
      autoAccept: true,
    });
  });

  it("writes executable discovery and call commands for gemini-cli tool mode", async () => {
    const fixture = await createFakeGeminiCliFixture();
    const client: LLMClient = {
      provider: "gemini-cli",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {
          geminiCliCommand: fixture.commandPath,
          geminiCliOauthSource: fixture.oauthPath,
          geminiCliIsolatedHomeBase: fixture.isolatedHomeBase,
          projectRoot: "/tmp/inkos-test-project",
        },
      },
    };

    const result = await chatWithTools(
      client,
      "auto-gemini-3",
      [{ role: "user", content: "inspect tool bridge setup" }],
      [{
        name: "list_books",
        description: "List books in the project",
        parameters: {
          type: "object",
          properties: {},
        },
      }],
    );

    expect(result.content).toBe("TOOLS_READY");
    expect(result.toolCalls).toEqual([]);
  });

  it("streams assistant content through the codex-cli runtime", async () => {
    const fixture = await createFakeCodexCliFixture();
    const client: LLMClient = {
      provider: "codex-cli",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {
          codexCliCommand: fixture.commandPath,
          codexCliAuthSource: fixture.authPath,
          codexCliIsolatedHomeBase: fixture.isolatedHomeBase,
        },
      },
    };

    const result = await chatCompletion(client, "gpt-5.4", [
      { role: "user", content: "ping" },
    ]);

    expect(result.content).toBe("FAKE_CODEX_OK");
    expect(result.usage).toEqual({
      promptTokens: 21,
      completionTokens: 9,
      totalTokens: 30,
    });
  });

  it("passes reasoning effort through the codex-cli runtime", async () => {
    const fixture = await createFakeCodexCliFixture();
    const client: LLMClient = {
      provider: "codex-cli",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0,
        reasoningEffort: "xhigh",
        maxTokensCap: null,
        extra: {
          codexCliCommand: fixture.commandPath,
          codexCliAuthSource: fixture.authPath,
          codexCliIsolatedHomeBase: fixture.isolatedHomeBase,
        },
      },
    };

    const result = await chatCompletion(client, "gpt-5.4", [
      { role: "user", content: "check reasoning flag" },
    ]);

    expect(result.content).toContain("model_reasoning_effort=xhigh");
  });

  it("parses structured tool output from the codex-cli runtime", async () => {
    const fixture = await createFakeCodexCliFixture();
    const client: LLMClient = {
      provider: "codex-cli",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {
          codexCliCommand: fixture.commandPath,
          codexCliAuthSource: fixture.authPath,
          codexCliIsolatedHomeBase: fixture.isolatedHomeBase,
        },
      },
    };

    const result = await chatWithTools(
      client,
      "gpt-5.4",
      [{ role: "user", content: "Need a tool" }],
      [{
        name: "list_books",
        description: "List books in the project",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number" },
          },
        },
      }],
    );

    expect(result.content).toBe("");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe("list_books");
    expect(JSON.parse(result.toolCalls[0]!.arguments)).toEqual({ limit: 1 });
  });

  it("surfaces codex-cli refresh token failures as re-login guidance", async () => {
    const fixture = await createFakeCodexCliFixture({
      errorMessage: "Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.",
      stderrMessage: "401 Unauthorized: {\"error\":{\"code\":\"refresh_token_reused\"}}",
    });
    const client: LLMClient = {
      provider: "codex-cli",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {
          codexCliCommand: fixture.commandPath,
          codexCliAuthSource: fixture.authPath,
          codexCliIsolatedHomeBase: fixture.isolatedHomeBase,
        },
      },
    };

    const error = await captureError(chatCompletion(client, "gpt-5.4", [
      { role: "user", content: "ping" },
    ]));

    expect(error.message).toContain("codex login");
    expect(error.message).not.toContain("INKOS_LLM_API_KEY");
  });
});
