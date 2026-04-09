import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  FALLBACK_MODEL_SUGGESTIONS,
  FALLBACK_REASONING_EFFORTS,
  defaultModelForProvider,
  type CapabilitySource,
  type LlmCapabilitiesSummary,
  type LlmProvider,
  type ProviderCapability,
  type SupportedReasoningEffort,
} from "../shared/llm.js";

const REASONING_PROBE_VALUE = "__inkos_probe__";
const CAPABILITY_CACHE_TTL_MS = 30_000;
const capabilityCache = new Map<string, { expiresAt: number; value: Promise<LlmCapabilitiesSummary> }>();

function uniqueStrings(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function globalNodeModulesCandidates(): string[] {
  const candidates = [
    process.env.npm_config_prefix ? join(process.env.npm_config_prefix, "lib", "node_modules") : "",
    process.env.NODE_PATH ?? "",
    join(dirname(dirname(process.execPath)), "lib", "node_modules"),
  ];
  return uniqueStrings(candidates);
}

async function importFirstExisting(paths: ReadonlyArray<string>): Promise<Record<string, unknown> | null> {
  for (const path of paths) {
    if (!(await pathExists(path))) continue;
    const mod = await import(pathToFileURL(path).href);
    return mod as Record<string, unknown>;
  }
  return null;
}

export async function discoverGeminiCliModels(): Promise<ReadonlyArray<string>> {
  const moduleCandidates = globalNodeModulesCandidates().map((root) =>
    join(root, "@google", "gemini-cli", "node_modules", "@google", "gemini-cli-core", "dist", "index.js"),
  );

  const mod = await importFirstExisting(moduleCandidates);
  if (!mod) return [];

  return uniqueStrings([
    typeof mod.PREVIEW_GEMINI_MODEL_AUTO === "string" ? mod.PREVIEW_GEMINI_MODEL_AUTO : "",
    typeof mod.DEFAULT_GEMINI_MODEL_AUTO === "string" ? mod.DEFAULT_GEMINI_MODEL_AUTO : "",
    typeof mod.DEFAULT_GEMINI_MODEL === "string" ? mod.DEFAULT_GEMINI_MODEL : "",
    typeof mod.DEFAULT_GEMINI_FLASH_MODEL === "string" ? mod.DEFAULT_GEMINI_FLASH_MODEL : "",
    typeof mod.DEFAULT_GEMINI_FLASH_LITE_MODEL === "string" ? mod.DEFAULT_GEMINI_FLASH_LITE_MODEL : "",
    typeof mod.PREVIEW_GEMINI_MODEL === "string" ? mod.PREVIEW_GEMINI_MODEL : "",
    typeof mod.PREVIEW_GEMINI_3_1_MODEL === "string" ? mod.PREVIEW_GEMINI_3_1_MODEL : "",
    typeof mod.PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL === "string" ? mod.PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL : "",
    typeof mod.PREVIEW_GEMINI_FLASH_MODEL === "string" ? mod.PREVIEW_GEMINI_FLASH_MODEL : "",
  ]);
}

function extractCodexConfigModel(configToml: string): string[] {
  const topLevelModel = configToml.match(/^model\s*=\s*"([^"]+)"/m)?.[1] ?? "";
  return uniqueStrings([topLevelModel]);
}

export async function discoverCodexCliModels(): Promise<ReadonlyArray<string>> {
  const sourceHome = process.env.INKOS_CODEX_CLI_SOURCE_HOME
    ?? process.env.CODEX_HOME
    ?? join(homedir(), ".codex");
  const configPath = join(sourceHome, "config.toml");
  if (!(await pathExists(configPath))) return [];
  const raw = await readFile(configPath, "utf-8");
  return extractCodexConfigModel(raw);
}

function parseCodexReasoningEfforts(raw: string): SupportedReasoningEffort[] {
  const match = raw.match(/expected one of ([^\n]+)\s+in `model_reasoning_effort`/);
  if (!match) return [];
  const values = [...match[1].matchAll(/`([^`]+)`/g)].map((entry) => entry[1]);
  return uniqueStrings(values) as SupportedReasoningEffort[];
}

async function runCommand(command: string, args: ReadonlyArray<string>): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      stderr += String(error);
      resolve({ stdout, stderr, code: 1 });
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

export async function discoverCodexCliReasoningEfforts(root: string): Promise<ReadonlyArray<SupportedReasoningEffort>> {
  const command = process.env.INKOS_CODEX_CLI_COMMAND ?? "codex";
  const result = await runCommand(command, [
    "-c",
    `model_reasoning_effort=${REASONING_PROBE_VALUE}`,
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-C",
    root,
    "",
  ]);
  return parseCodexReasoningEfforts(`${result.stdout}\n${result.stderr}`);
}

function buildCapability(
  provider: Exclude<LlmProvider, "">,
  options: {
    readonly models?: ReadonlyArray<string>;
    readonly reasoningEfforts?: ReadonlyArray<SupportedReasoningEffort>;
    readonly modelSource: CapabilitySource;
    readonly reasoningSource: CapabilitySource;
  },
): ProviderCapability {
  const fallbackModels = FALLBACK_MODEL_SUGGESTIONS[provider] ?? [];
  const fallbackReasoning = FALLBACK_REASONING_EFFORTS[provider] ?? [];
  const discoveredModels = uniqueStrings(options.models ?? []);
  const discoveredReasoning = uniqueStrings(options.reasoningEfforts ?? []) as SupportedReasoningEffort[];
  const models = discoveredModels.length > 0 ? discoveredModels : [...fallbackModels];
  const reasoningEfforts = discoveredReasoning.length > 0 ? discoveredReasoning : [...fallbackReasoning];

  return {
    models,
    defaultModel: models[0] ?? defaultModelForProvider(provider),
    reasoningEfforts,
    modelSource: options.modelSource,
    reasoningSource: options.reasoningSource,
  };
}

async function discoverFreshLlmCapabilities(root: string): Promise<LlmCapabilitiesSummary> {
  const [geminiModels, codexModels, codexReasoning] = await Promise.all([
    discoverGeminiCliModels().catch(() => []),
    discoverCodexCliModels().catch(() => []),
    discoverCodexCliReasoningEfforts(root).catch(() => []),
  ]);

  return {
    providers: {
      openai: buildCapability("openai", {
        models: [],
        reasoningEfforts: [],
        modelSource: "fallback",
        reasoningSource: "fallback",
      }),
      anthropic: buildCapability("anthropic", {
        models: [],
        reasoningEfforts: [],
        modelSource: "fallback",
        reasoningSource: "fallback",
      }),
      custom: buildCapability("custom", {
        models: [],
        reasoningEfforts: [],
        modelSource: "fallback",
        reasoningSource: "fallback",
      }),
      "gemini-cli": buildCapability("gemini-cli", {
        models: geminiModels,
        reasoningEfforts: [],
        modelSource: geminiModels.length > 0 ? "installed" : "fallback",
        reasoningSource: "fallback",
      }),
      "codex-cli": buildCapability("codex-cli", {
        models: codexModels,
        reasoningEfforts: codexReasoning,
        modelSource: codexModels.length > 0 ? "config" : "fallback",
        reasoningSource: codexReasoning.length > 0 ? "installed" : "fallback",
      }),
    },
  };
}

export async function discoverLlmCapabilities(root: string): Promise<LlmCapabilitiesSummary> {
  const now = Date.now();
  const cached = capabilityCache.get(root);
  if (cached && cached.expiresAt > now) {
    return await cached.value;
  }

  const value = discoverFreshLlmCapabilities(root).catch((error) => {
    capabilityCache.delete(root);
    throw error;
  });
  capabilityCache.set(root, {
    expiresAt: now + CAPABILITY_CACHE_TTL_MS,
    value,
  });
  return await value;
}

export { extractCodexConfigModel, parseCodexReasoningEfforts };
