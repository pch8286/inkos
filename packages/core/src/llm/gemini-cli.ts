import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { LLMConfig } from "../models/project.js";
import type {
  AgentMessage,
  ChatWithToolsResult,
  LLMClient,
  LLMMessage,
  LLMResponse,
  OnStreamProgress,
  ToolDefinition,
} from "./provider.js";

const GEMINI_CLI_DEFAULT_MODEL = "auto-gemini-3";
const GEMINI_CLI_DEFAULT_COMMAND = "gemini";

interface GeminiCliRuntimeOptions {
  readonly includeTools: boolean;
  readonly tools?: ReadonlyArray<ToolDefinition>;
  readonly projectRoot?: string;
}

interface GeminiCliEvent {
  readonly type?: string;
  readonly role?: string;
  readonly content?: string;
  readonly delta?: boolean;
  readonly status?: string;
  readonly stats?: {
    readonly total_tokens?: number;
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
  readonly error?: {
    readonly message?: string;
  };
}

interface GeminiCliRunResult {
  readonly content: string;
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

interface GeminiCliContextFile {
  readonly projectRoot: string;
  readonly tools: ReadonlyArray<ToolDefinition>;
  readonly llm?: LLMConfig;
}

function getExtraString(client: LLMClient, key: string): string | undefined {
  const value = client.defaults.extra[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getGeminiCliCommand(client: LLMClient): string {
  return getExtraString(client, "geminiCliCommand")
    ?? process.env.INKOS_GEMINI_CLI_COMMAND
    ?? GEMINI_CLI_DEFAULT_COMMAND;
}

function getGeminiCliModel(model: string): string {
  return model.trim().length > 0 ? model : GEMINI_CLI_DEFAULT_MODEL;
}

function getGeminiCliSourceHome(client: LLMClient): string {
  return process.env.INKOS_GEMINI_CLI_SOURCE_HOME
    ?? getExtraString(client, "geminiCliSourceHome")
    ?? process.env.GEMINI_CLI_HOME
    ?? homedir();
}

function getGeminiCliOauthSource(client: LLMClient): string {
  return process.env.INKOS_GEMINI_CLI_OAUTH_SOURCE
    ?? getExtraString(client, "geminiCliOauthSource")
    ?? join(getGeminiCliSourceHome(client), ".gemini", "oauth_creds.json");
}

function getGeminiCliAccountsSource(client: LLMClient): string {
  return process.env.INKOS_GEMINI_CLI_ACCOUNTS_SOURCE
    ?? getExtraString(client, "geminiCliAccountsSource")
    ?? join(getGeminiCliSourceHome(client), ".gemini", "google_accounts.json");
}

function getGeminiCliIsolatedBaseDir(client: LLMClient): string {
  return process.env.INKOS_GEMINI_CLI_ISOLATED_HOME_BASE
    ?? getExtraString(client, "geminiCliIsolatedHomeBase")
    ?? join(tmpdir(), "inkos-gemini-cli");
}

function getGeminiCliHashSeed(client: LLMClient): string {
  return JSON.stringify({
    command: getGeminiCliCommand(client),
    oauthSource: getGeminiCliOauthSource(client),
    sourceHome: getGeminiCliSourceHome(client),
  });
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function syncIfPresent(sourcePath: string, targetPath: string): Promise<void> {
  if (!(await pathExists(sourcePath))) return;

  const sourceStat = await stat(sourcePath);
  const targetStat = await stat(targetPath).catch(() => null);

  if (!targetStat || sourceStat.mtimeMs > targetStat.mtimeMs || sourceStat.size !== targetStat.size) {
    await copyFile(sourcePath, targetPath);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2), "utf-8");
}

async function ensureGeminiCliHome(
  client: LLMClient,
  model: string,
  options: GeminiCliRuntimeOptions,
): Promise<{ readonly homeDir: string; readonly workspaceDir: string }> {
  const hash = hashValue(getGeminiCliHashSeed(client));
  const homeDir = join(getGeminiCliIsolatedBaseDir(client), hash);
  const geminiDir = join(homeDir, ".gemini");
  const workspaceDir = await mkdtemp(join(tmpdir(), "inkos-gemini-workspace-"));

  await mkdir(geminiDir, { recursive: true });
  await syncIfPresent(getGeminiCliOauthSource(client), join(geminiDir, "oauth_creds.json"));
  await syncIfPresent(getGeminiCliAccountsSource(client), join(geminiDir, "google_accounts.json"));
  const registryPath = join(geminiDir, "projects.json");
  if (!(await pathExists(registryPath))) {
    await writeJson(registryPath, { projects: {} });
  }

  const settings: Record<string, unknown> = {
    general: {
      devtools: false,
      enableAutoUpdate: false,
      enableAutoUpdateNotification: false,
    },
    admin: {
      extensions: { enabled: false },
      mcp: { enabled: false },
      skills: { enabled: false },
    },
    security: {
      folderTrust: { enabled: false },
      auth: { selectedType: "oauth-personal" },
    },
    hooksConfig: {
      enabled: false,
      notifications: false,
    },
    skills: {
      enabled: false,
      disabled: [],
    },
    experimental: {
      enableAgents: false,
      extensionReloading: false,
    },
    tools: {
      sandbox: false,
      core: [],
    },
    telemetry: {
      enabled: false,
    },
  };

  if (options.includeTools) {
    if (!options.projectRoot || !options.tools) {
      throw new Error("Gemini CLI tool bridge requires both projectRoot and tools.");
    }

    const bridgeContextPath = join(workspaceDir, "bridge-context.json");
    await writeJson(bridgeContextPath, {
      projectRoot: options.projectRoot,
      tools: options.tools,
      llm: {
        provider: "gemini-cli",
        baseUrl: "https://gemini-cli.invalid",
        apiKey: "",
        model: getGeminiCliModel(model),
        temperature: client.defaults.temperature,
        maxTokens: client.defaults.maxTokens,
        thinkingBudget: client.defaults.thinkingBudget,
        apiFormat: client.apiFormat,
        stream: client.stream,
        extra: { ...client.defaults.extra, projectRoot: options.projectRoot },
      },
    } satisfies GeminiCliContextFile);

    const bridgeModuleUrl = new URL("./gemini-cli-bridge.js", import.meta.url).href;
    const discoverPath = join(workspaceDir, "inkos-gemini-discover.mjs");
    const callPath = join(workspaceDir, "inkos-gemini-call.mjs");

    const discoverWrapper = `#!/usr/bin/env node
import { runGeminiCliBridge } from ${JSON.stringify(bridgeModuleUrl)};
await runGeminiCliBridge(${JSON.stringify(bridgeContextPath)}, "discover", process.argv.slice(2));
`;
    const callWrapper = `#!/usr/bin/env node
import { runGeminiCliBridge } from ${JSON.stringify(bridgeModuleUrl)};
await runGeminiCliBridge(${JSON.stringify(bridgeContextPath)}, "call", process.argv.slice(2));
`;

    await writeFile(discoverPath, discoverWrapper, "utf-8");
    await writeFile(callPath, callWrapper, "utf-8");
    await chmod(discoverPath, 0o755);
    await chmod(callPath, 0o755);

    (settings.tools as Record<string, unknown>).discoveryCommand = discoverPath;
    (settings.tools as Record<string, unknown>).callCommand = callPath;
  }

  await writeJson(join(geminiDir, "settings.json"), settings);

  return { homeDir, workspaceDir };
}

function renderGeminiCliPrompt(messages: ReadonlyArray<LLMMessage | AgentMessage>, toolMode: boolean): string {
  const systemBlocks: string[] = [];
  const conversationBlocks: string[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemBlocks.push(message.content);
      continue;
    }

    if (message.role === "assistant") {
      const parts: string[] = [];
      if (message.content) parts.push(message.content);
      if ("toolCalls" in message && message.toolCalls && message.toolCalls.length > 0) {
        for (const toolCall of message.toolCalls) {
          parts.push(`Tool call ${toolCall.name}: ${toolCall.arguments}`);
        }
      }
      if (parts.length > 0) {
        conversationBlocks.push(`Assistant:\n${parts.join("\n")}`);
      }
      continue;
    }

    if (message.role === "tool") {
      conversationBlocks.push(`Tool result (${message.toolCallId}):\n${message.content}`);
      continue;
    }

    conversationBlocks.push(`${message.role === "user" ? "User" : "Assistant"}:\n${message.content}`);
  }

  const prompt: string[] = [
    "You are running inside InkOS through Gemini CLI.",
  ];

  if (systemBlocks.length > 0) {
    prompt.push("## System Instructions");
    prompt.push(systemBlocks.join("\n\n"));
  }

  prompt.push("## Conversation");
  prompt.push(conversationBlocks.join("\n\n"));

  if (toolMode) {
    prompt.push("## Tool Use Rules");
    prompt.push("Use the available discovered tools whenever they are necessary.");
    prompt.push("Continue tool use until the workflow is actually complete.");
    prompt.push("After tool use, always end with a brief final assistant message.");
  } else {
    prompt.push("## Response Rule");
    prompt.push("Write only the assistant's next reply to the most recent user message.");
  }

  return prompt.join("\n\n").trim();
}

async function runGeminiCliStream(
  client: LLMClient,
  model: string,
  prompt: string,
  options: GeminiCliRuntimeOptions,
  onStreamProgress?: OnStreamProgress,
): Promise<GeminiCliRunResult> {
  const oauthSource = getGeminiCliOauthSource(client);
  if (!existsSync(oauthSource)) {
    throw new Error(
      `Gemini CLI OAuth credentials not found at ${oauthSource}. Run 'gemini' once and sign in before using provider=gemini-cli.`,
    );
  }

  const { homeDir, workspaceDir } = await ensureGeminiCliHome(client, model, options);
  const command = getGeminiCliCommand(client);
  const args = [
    "--output-format",
    "stream-json",
    "--extensions",
    "none",
    "--prompt",
    "",
  ];

  if (options.includeTools) {
    args.push("--approval-mode", "yolo");
  }

  const resolvedModel = getGeminiCliModel(model);
  if (resolvedModel) {
    args.push("--model", resolvedModel);
  }

  const monitor = onStreamProgress
    ? {
      totalChars: 0,
      chineseChars: 0,
      startedAt: Date.now(),
    }
    : null;

  let assistantContent = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let bufferedStdout = "";
  let stderr = "";
  let eventErrorMessage: string | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: workspaceDir,
        env: {
          ...process.env,
          GEMINI_CLI_HOME: homeDir,
          GEMINI_CLI_NO_RELAUNCH: "true",
          GEMINI_CLI_ACTIVITY_LOG_TARGET: "",
          NO_BROWSER: process.env.NO_BROWSER ?? "true",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const handleChunk = (chunk: string): void => {
        bufferedStdout += chunk;
        while (true) {
          const newlineIndex = bufferedStdout.indexOf("\n");
          if (newlineIndex === -1) break;
          const line = bufferedStdout.slice(0, newlineIndex).trim();
          bufferedStdout = bufferedStdout.slice(newlineIndex + 1);
          if (!line) continue;

          let event: GeminiCliEvent;
          try {
            event = JSON.parse(line) as GeminiCliEvent;
          } catch {
            continue;
          }

          if (event.type === "message" && event.role === "assistant" && typeof event.content === "string") {
            assistantContent += event.content;
            if (monitor) {
              monitor.totalChars += event.content.length;
              monitor.chineseChars += (event.content.match(/[\u4e00-\u9fff]/g) || []).length;
              onStreamProgress?.({
                elapsedMs: Date.now() - monitor.startedAt,
                totalChars: monitor.totalChars,
                chineseChars: monitor.chineseChars,
                status: "streaming",
              });
            }
          }

          if (event.type === "result") {
            promptTokens = event.stats?.input_tokens ?? 0;
            completionTokens = event.stats?.output_tokens ?? 0;
            totalTokens = event.stats?.total_tokens ?? (promptTokens + completionTokens);
          }

          if (event.type === "error") {
            eventErrorMessage = event.error?.message ?? event.content ?? "Gemini CLI returned an error event.";
          }
        }
      };

      child.stdout.on("data", (chunk) => handleChunk(chunk.toString()));
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        const maybeNodeError = error as NodeJS.ErrnoException;
        if (maybeNodeError.code === "ENOENT") {
          reject(new Error(`Gemini CLI command not found: ${command}`));
          return;
        }
        reject(error);
      });
      child.on("close", (code) => {
        if (bufferedStdout.trim()) {
          handleChunk(`${bufferedStdout}\n`);
        }

        if (code !== 0) {
          reject(new Error(stderr.trim() || `Gemini CLI exited with code ${code}`));
          return;
        }

        if (eventErrorMessage) {
          reject(new Error(eventErrorMessage));
          return;
        }

        resolve();
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  } finally {
    if (monitor) {
      onStreamProgress?.({
        elapsedMs: Date.now() - monitor.startedAt,
        totalChars: monitor.totalChars,
        chineseChars: monitor.chineseChars,
        status: "done",
      });
    }

    await rm(workspaceDir, { recursive: true, force: true });
  }

  if (!assistantContent.trim()) {
    throw new Error("Gemini CLI returned empty assistant content.");
  }

  return {
    content: assistantContent,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens,
    },
  };
}

export async function chatCompletionGeminiCli(
  client: LLMClient,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  onStreamProgress?: OnStreamProgress,
): Promise<LLMResponse> {
  return runGeminiCliStream(
    client,
    model,
    renderGeminiCliPrompt(messages, false),
    { includeTools: false },
    onStreamProgress,
  );
}

export async function chatWithToolsGeminiCli(
  client: LLMClient,
  model: string,
  messages: ReadonlyArray<AgentMessage>,
  tools: ReadonlyArray<ToolDefinition>,
  projectRoot?: string,
): Promise<ChatWithToolsResult> {
  if (!projectRoot) {
    throw new Error("Gemini CLI tool mode requires a projectRoot.");
  }

  const result = await runGeminiCliStream(
    client,
    model,
    renderGeminiCliPrompt(messages, true),
    {
      includeTools: true,
      tools,
      projectRoot,
    },
  );

  return {
    content: result.content,
    toolCalls: [],
  };
}

export function getGeminiCliBridgeModulePath(): string {
  return fileURLToPath(new URL("./gemini-cli-bridge.js", import.meta.url));
}
