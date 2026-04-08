import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { executeAgentTool } from "../pipeline/agent.js";
import { PipelineRunner, type PipelineConfig } from "../pipeline/runner.js";
import { StateManager } from "../state/manager.js";
import { createLLMClient, type ToolDefinition } from "./provider.js";
import { loadProjectConfig } from "../utils/config-loader.js";
import type { LLMConfig } from "../models/project.js";

interface GeminiCliContextFile {
  readonly projectRoot: string;
  readonly tools: ReadonlyArray<ToolDefinition>;
  readonly llm?: LLMConfig;
}

async function readStdin(): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    process.stdin.on("error", reject);
  });
}

async function loadContext(contextPath: string): Promise<GeminiCliContextFile> {
  const raw = await readFile(contextPath, "utf-8");
  return JSON.parse(raw) as GeminiCliContextFile;
}

async function buildPipelineConfig(context: GeminiCliContextFile): Promise<PipelineConfig> {
  const project = await loadProjectConfig(context.projectRoot, { requireApiKey: false });
  const effectiveLlm: LLMConfig = context.llm ?? project.llm;
  const clientConfig = {
    ...effectiveLlm,
    extra: {
      ...(effectiveLlm.extra ?? {}),
      projectRoot: context.projectRoot,
    },
  };
  return {
    client: createLLMClient(clientConfig),
    model: effectiveLlm.model,
    projectRoot: context.projectRoot,
    defaultLLMConfig: effectiveLlm,
    notifyChannels: project.notify,
    modelOverrides: project.modelOverrides,
    inputGovernanceMode: project.inputGovernanceMode,
  };
}

export async function runGeminiCliBridge(
  contextPath: string,
  mode: "discover" | "call",
  args: ReadonlyArray<string>,
): Promise<void> {
  const context = await loadContext(contextPath);

  if (mode === "discover") {
    const tools = context.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parametersJsonSchema: tool.parameters,
    }));
    process.stdout.write(JSON.stringify(tools));
    return;
  }

  const toolName = args[0];
  if (!toolName) {
    throw new Error("Gemini CLI tool bridge expected a tool name.");
  }

  const toolExists = context.tools.some((tool) => tool.name === toolName);
  if (!toolExists) {
    throw new Error(`Unknown InkOS tool requested by Gemini CLI: ${toolName}`);
  }

  const rawInput = await readStdin();
  const parsedArgs = rawInput.trim().length > 0 ? JSON.parse(rawInput) as Record<string, unknown> : {};
  const pipelineConfig = await buildPipelineConfig(context);
  const pipeline = new PipelineRunner(pipelineConfig);
  const state = new StateManager(context.projectRoot);
  const result = await executeAgentTool(pipeline, state, pipelineConfig, toolName, parsedArgs);
  process.stdout.write(result);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const contextPath = process.argv[2];
  const mode = process.argv[3];

  if (!contextPath || (mode !== "discover" && mode !== "call")) {
    process.stderr.write("Usage: gemini-cli-bridge <contextPath> <discover|call> [args...]\n");
    process.exit(1);
  }

  await runGeminiCliBridge(contextPath, mode, process.argv.slice(4));
}
