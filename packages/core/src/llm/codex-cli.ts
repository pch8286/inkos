import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  AgentMessage,
  ChatWithToolsResult,
  LLMClient,
  LLMMessage,
  LLMResponse,
  OnStreamProgress,
  ToolDefinition,
  ToolCall,
} from "./provider.js";

const CODEX_CLI_DEFAULT_COMMAND = "codex";
const CODEX_CLI_DEFAULT_MODEL = "gpt-5.4";

interface CodexCliEvent {
  readonly type?: string;
  readonly message?: string;
  readonly thread_id?: string;
  readonly item?: {
    readonly id?: string;
    readonly type?: string;
    readonly text?: string;
  };
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
}

interface CodexCliRunResult {
  readonly content: string;
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

interface CodexCliToolEnvelope {
  readonly type: "tool" | "final";
  readonly name?: string;
  readonly arguments?: unknown;
  readonly content?: string;
}

function getExtraString(client: LLMClient, key: string): string | undefined {
  const value = client.defaults.extra[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function expandHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return resolve(path);
}

function getCodexCliCommand(client: LLMClient): string {
  return getExtraString(client, "codexCliCommand")
    ?? process.env.INKOS_CODEX_CLI_COMMAND
    ?? CODEX_CLI_DEFAULT_COMMAND;
}

function getCodexCliModel(model: string): string {
  return model.trim().length > 0 ? model : CODEX_CLI_DEFAULT_MODEL;
}

function getCodexCliSourceHome(client: LLMClient): string {
  const configured = process.env.INKOS_CODEX_CLI_SOURCE_HOME
    ?? getExtraString(client, "codexCliSourceHome")
    ?? process.env.CODEX_HOME
    ?? join(homedir(), ".codex");
  return expandHomePath(configured);
}

function getCodexCliAuthSource(client: LLMClient): string {
  const configured = process.env.INKOS_CODEX_CLI_AUTH_SOURCE
    ?? getExtraString(client, "codexCliAuthSource");
  return configured
    ? expandHomePath(configured)
    : join(getCodexCliSourceHome(client), "auth.json");
}

function getCodexCliIsolatedBaseDir(client: LLMClient): string {
  const configured = process.env.INKOS_CODEX_CLI_ISOLATED_HOME_BASE
    ?? getExtraString(client, "codexCliIsolatedHomeBase")
    ?? join(homedir(), ".cache", "inkos-codex-cli");
  return expandHomePath(configured);
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

async function ensureCodexCliHome(client: LLMClient): Promise<{ readonly homeDir: string; readonly workspaceDir: string }> {
  const authSource = getCodexCliAuthSource(client);
  if (!existsSync(authSource)) {
    throw new Error(
      `Codex CLI auth.json not found at ${authSource}. Run 'codex login' before using provider=codex-cli.`,
    );
  }

  const hash = hashValue(JSON.stringify({
    command: getCodexCliCommand(client),
    authSource,
    sourceHome: getCodexCliSourceHome(client),
  }));
  const homeDir = join(getCodexCliIsolatedBaseDir(client), hash);
  const workspaceDir = await mkdtemp(join(tmpdir(), "inkos-codex-workspace-"));

  await mkdir(homeDir, { recursive: true });
  await syncIfPresent(authSource, join(homeDir, "auth.json"));

  return { homeDir, workspaceDir };
}

function renderCodexCliPrompt(messages: ReadonlyArray<LLMMessage | AgentMessage>): string {
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

    conversationBlocks.push(`User:\n${message.content}`);
  }

  const prompt: string[] = [
    "You are running inside InkOS through Codex CLI.",
    "Act as a plain language model, not as a coding agent.",
    "Do not inspect the filesystem, do not run shell commands, and do not use any built-in tools.",
    "Answer only from the supplied instructions and conversation.",
  ];

  if (systemBlocks.length > 0) {
    prompt.push("## System Instructions");
    prompt.push(systemBlocks.join("\n\n"));
  }

  prompt.push("## Conversation");
  prompt.push(conversationBlocks.join("\n\n"));
  prompt.push("## Response Rule");
  prompt.push("Write only the assistant's next reply to the most recent user message.");

  return prompt.join("\n\n").trim();
}

function renderCodexCliToolPrompt(
  messages: ReadonlyArray<AgentMessage>,
  tools: ReadonlyArray<ToolDefinition>,
): string {
  const prompt = renderCodexCliPrompt(messages);
  const toolBlocks = tools.map((tool) => [
    `### ${tool.name}`,
    tool.description,
    "JSON Schema:",
    JSON.stringify(tool.parameters, null, 2),
  ].join("\n"));

  return [
    prompt,
    "## Available InkOS Tools",
    toolBlocks.join("\n\n"),
    "## Output Contract",
    "Return exactly one JSON object and nothing else.",
    "If a tool is needed, return:",
    '{"type":"tool","name":"<tool name>","arguments":{}}',
    "If the task is complete, return:",
    '{"type":"final","content":"<assistant reply>"}',
    "Only choose one tool at a time.",
    "Do not wrap the JSON in markdown fences.",
  ].join("\n\n");
}

async function runCodexCliJson(
  client: LLMClient,
  model: string,
  prompt: string,
  onStreamProgress?: OnStreamProgress,
): Promise<CodexCliRunResult> {
  const { homeDir, workspaceDir } = await ensureCodexCliHome(client);
  const resolvedModel = getCodexCliModel(model);
  const command = getCodexCliCommand(client);
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--color",
    "never",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-C",
    workspaceDir,
  ];

  if (resolvedModel) {
    args.push("--model", resolvedModel);
  }
  args.push("-");

  let bufferedStdout = "";
  let stderr = "";
  const assistantMessages: string[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let totalChars = 0;
  let chineseChars = 0;
  const startedAt = Date.now();
  const eventErrors: string[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: workspaceDir,
        env: {
          ...process.env,
          CODEX_HOME: homeDir,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const handleLine = (line: string): void => {
        let event: CodexCliEvent;
        try {
          event = JSON.parse(line) as CodexCliEvent;
        } catch {
          return;
        }

        if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
          assistantMessages.push(event.item.text);
          totalChars += event.item.text.length;
          chineseChars += (event.item.text.match(/[\u4e00-\u9fff]/g) || []).length;
          onStreamProgress?.({
            elapsedMs: Date.now() - startedAt,
            totalChars,
            chineseChars,
            status: "streaming",
          });
        }

        if (event.type === "turn.completed") {
          promptTokens = event.usage?.input_tokens ?? 0;
          completionTokens = event.usage?.output_tokens ?? 0;
        }

        if (event.type === "error" && typeof event.message === "string") {
          eventErrors.push(event.message);
        }
      };

      child.stdout.on("data", (chunk) => {
        bufferedStdout += chunk.toString();
        while (true) {
          const newlineIndex = bufferedStdout.indexOf("\n");
          if (newlineIndex === -1) break;
          const line = bufferedStdout.slice(0, newlineIndex).trim();
          bufferedStdout = bufferedStdout.slice(newlineIndex + 1);
          if (line) handleLine(line);
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        const maybeNodeError = error as NodeJS.ErrnoException;
        if (maybeNodeError.code === "ENOENT") {
          reject(new Error(`Codex CLI command not found: ${command}`));
          return;
        }
        reject(error);
      });
      child.on("close", (code) => {
        const remainder = bufferedStdout.trim();
        if (remainder) handleLine(remainder);

        if (code !== 0) {
          reject(new Error(stderr.trim() || eventErrors[eventErrors.length - 1] || `Codex CLI exited with code ${code}`));
          return;
        }
        resolve();
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  } finally {
    onStreamProgress?.({
      elapsedMs: Date.now() - startedAt,
      totalChars,
      chineseChars,
      status: "done",
    });
    await rm(workspaceDir, { recursive: true, force: true });
  }

  const content = assistantMessages.join("\n\n").trim();
  if (!content) {
    throw new Error(eventErrors[eventErrors.length - 1] ?? "Codex CLI returned empty assistant content.");
  }

  return {
    content,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
  };
}

function tryParseCodexCliToolEnvelope(text: string): CodexCliToolEnvelope | null {
  const candidates = [text.trim()];
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) candidates.push(fencedMatch[1].trim());
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1).trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as CodexCliToolEnvelope;
      if (parsed?.type === "tool" || parsed?.type === "final") {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function chatCompletionCodexCli(
  client: LLMClient,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  onStreamProgress?: OnStreamProgress,
): Promise<LLMResponse> {
  return await runCodexCliJson(client, model, renderCodexCliPrompt(messages), onStreamProgress);
}

export async function chatWithToolsCodexCli(
  client: LLMClient,
  model: string,
  messages: ReadonlyArray<AgentMessage>,
  tools: ReadonlyArray<ToolDefinition>,
): Promise<ChatWithToolsResult> {
  const result = await runCodexCliJson(client, model, renderCodexCliToolPrompt(messages, tools));
  const envelope = tryParseCodexCliToolEnvelope(result.content);

  if (!envelope) {
    return {
      content: result.content,
      toolCalls: [],
    };
  }

  if (envelope.type === "final") {
    return {
      content: typeof envelope.content === "string" ? envelope.content : result.content,
      toolCalls: [],
    };
  }

  if (typeof envelope.name !== "string" || envelope.name.trim().length === 0) {
    return {
      content: result.content,
      toolCalls: [],
    };
  }

  const toolCall: ToolCall = {
    id: `codex-cli-${Date.now().toString(36)}`,
    name: envelope.name,
    arguments: JSON.stringify(
      envelope.arguments && typeof envelope.arguments === "object" && !Array.isArray(envelope.arguments)
        ? envelope.arguments
        : {},
    ),
  };

  return {
    content: "",
    toolCalls: [toolCall],
  };
}
