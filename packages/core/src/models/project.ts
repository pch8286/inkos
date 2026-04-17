import { z } from "zod";
import { WritingLanguageSchema } from "./language.js";

export const LLMConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai", "custom", "gemini-cli", "codex-cli"]),
  baseUrl: z.string().url(),
  apiKey: z.string().default(""),
  model: z.string().min(1),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(1).default(8192),
  thinkingBudget: z.number().int().min(0).default(0),
  extra: z.record(z.unknown()).optional(),
  headers: z.record(z.string()).optional(),
  apiFormat: z.enum(["chat", "responses"]).default("chat"),
  stream: z.boolean().default(true),
});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;

export const NotifyChannelSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("telegram"),
    botToken: z.string().min(1),
    chatId: z.string().min(1),
  }),
  z.object({
    type: z.literal("wechat-work"),
    webhookUrl: z.string().url(),
  }),
  z.object({
    type: z.literal("feishu"),
    webhookUrl: z.string().url(),
  }),
  z.object({
    type: z.literal("webhook"),
    url: z.string().url(),
    secret: z.string().optional(),
    events: z.array(z.string()).default([]),
  }),
]);

export type NotifyChannel = z.infer<typeof NotifyChannelSchema>;

export const DetectionConfigSchema = z.object({
  provider: z.enum(["gptzero", "originality", "custom"]).default("custom"),
  apiUrl: z.string().url(),
  apiKeyEnv: z.string().min(1),
  threshold: z.number().min(0).max(1).default(0.5),
  enabled: z.boolean().default(false),
  autoRewrite: z.boolean().default(false),
  maxRetries: z.number().int().min(1).max(10).default(3),
});

export type DetectionConfig = z.infer<typeof DetectionConfigSchema>;

export const QualityGatesSchema = z.object({
  maxAuditRetries: z.number().int().min(0).max(10).default(2),
  pauseAfterConsecutiveFailures: z.number().int().min(1).default(3),
  retryTemperatureStep: z.number().min(0).max(0.5).default(0.1),
});

export type QualityGates = z.infer<typeof QualityGatesSchema>;

export const AgentLLMOverrideSchema = z.object({
  model: z.string().min(1),
  provider: z.enum(["anthropic", "openai", "custom", "gemini-cli", "codex-cli"]).optional(),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().optional(),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  stream: z.boolean().optional(),
});

export type AgentLLMOverride = z.infer<typeof AgentLLMOverrideSchema>;

export const InputGovernanceModeSchema = z.enum(["legacy", "v2"]);
export type InputGovernanceMode = z.infer<typeof InputGovernanceModeSchema>;

const ModelOverrideValueSchema = z.union([z.string(), AgentLLMOverrideSchema]);
export type ModelOverrideValue = z.infer<typeof ModelOverrideValueSchema>;

export const DEFAULT_GEMINI_CLI_MODEL = "auto-gemini-3";

const MODEL_OVERRIDE_PROVIDERS = new Set(["anthropic", "openai", "custom", "gemini-cli", "codex-cli"]);
const MODEL_OVERRIDE_REASONING = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

export function sanitizeModelOverrides(input: unknown): Record<string, ModelOverrideValue> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const sanitized: Record<string, ModelOverrideValue> = {};

  for (const [agent, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") {
      const model = value.trim();
      if (model) sanitized[agent] = model;
      continue;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const candidate = value as Record<string, unknown>;
    const model = typeof candidate.model === "string" ? candidate.model.trim() : "";
    if (!model) continue;

    const provider = typeof candidate.provider === "string" && MODEL_OVERRIDE_PROVIDERS.has(candidate.provider)
      ? candidate.provider as AgentLLMOverride["provider"]
      : undefined;
    const baseUrl = typeof candidate.baseUrl === "string" && candidate.baseUrl.trim().length > 0
      ? candidate.baseUrl.trim()
      : undefined;
    const apiKeyEnv = typeof candidate.apiKeyEnv === "string" && candidate.apiKeyEnv.trim().length > 0
      ? candidate.apiKeyEnv.trim()
      : undefined;
    const reasoningEffort = typeof candidate.reasoningEffort === "string" && MODEL_OVERRIDE_REASONING.has(candidate.reasoningEffort)
      ? candidate.reasoningEffort as AgentLLMOverride["reasoningEffort"]
      : undefined;
    const stream = typeof candidate.stream === "boolean" ? candidate.stream : undefined;

    sanitized[agent] = {
      model,
      ...(provider ? { provider } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiKeyEnv ? { apiKeyEnv } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(stream !== undefined ? { stream } : {}),
    };
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  version: z.literal("0.1.0"),
  language: WritingLanguageSchema.default("ko"),
  llm: LLMConfigSchema,
  notify: z.array(NotifyChannelSchema).default([]),
  detection: DetectionConfigSchema.optional(),
  modelOverrides: z.record(z.string(), ModelOverrideValueSchema).optional(),
  inputGovernanceMode: InputGovernanceModeSchema.default("v2"),
  daemon: z.object({
    schedule: z.object({
      radarCron: z.string().default("0 */6 * * *"),
      writeCron: z.string().default("*/15 * * * *"),
    }),
    maxConcurrentBooks: z.number().int().min(1).default(3),
    chaptersPerCycle: z.number().int().min(1).max(20).default(1),
    retryDelayMs: z.number().int().min(0).default(30_000),
    cooldownAfterChapterMs: z.number().int().min(0).default(10_000),
    maxChaptersPerDay: z.number().int().min(1).default(50),
    qualityGates: QualityGatesSchema.default({
      maxAuditRetries: 2,
      pauseAfterConsecutiveFailures: 3,
      retryTemperatureStep: 0.1,
    }),
  }).default({
    schedule: {
      radarCron: "0 */6 * * *",
      writeCron: "*/15 * * * *",
    },
    maxConcurrentBooks: 3,
    chaptersPerCycle: 1,
    retryDelayMs: 30_000,
    cooldownAfterChapterMs: 10_000,
    maxChaptersPerDay: 50,
    qualityGates: {
      maxAuditRetries: 2,
      pauseAfterConsecutiveFailures: 3,
      retryTemperatureStep: 0.1,
    },
  }),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
