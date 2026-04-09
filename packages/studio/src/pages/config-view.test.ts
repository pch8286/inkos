import { describe, expect, it, vi } from "vitest";
import { applyRoutingProviderChange, normalizeOverridesDraft, saveProjectConfig, serializeOverridesDraft } from "./ConfigView";

type RoutingAgentOverride = Parameters<typeof applyRoutingProviderChange>[0];

const capabilities = {
  providers: {
    openai: {
      models: ["gpt-5.4"],
      defaultModel: "gpt-5.4",
      reasoningEfforts: ["low", "medium", "high"],
      modelSource: "fallback",
      reasoningSource: "fallback",
    },
    anthropic: {
      models: ["claude-3-7-sonnet"],
      defaultModel: "claude-3-7-sonnet",
      reasoningEfforts: [],
      modelSource: "fallback",
      reasoningSource: "fallback",
    },
    custom: {
      models: ["gpt-5.4"],
      defaultModel: "gpt-5.4",
      reasoningEfforts: ["low", "medium", "high"],
      modelSource: "fallback",
      reasoningSource: "fallback",
    },
    "gemini-cli": {
      models: ["auto-gemini-3"],
      defaultModel: "auto-gemini-3",
      reasoningEfforts: [],
      modelSource: "fallback",
      reasoningSource: "fallback",
    },
    "codex-cli": {
      models: ["gpt-5.4"],
      defaultModel: "gpt-5.4",
      reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"],
      modelSource: "fallback",
      reasoningSource: "fallback",
    },
  },
} as const;

type PutApiLike = <T>(path: string, body?: unknown) => Promise<T>;

describe("saveProjectConfig", () => {
  it("persists project settings through putApi so project listeners invalidate immediately", async () => {
    const putApiMock = vi.fn(async () => undefined);
    const draft = {
      provider: "codex-cli",
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
      baseUrl: "",
      language: "en",
      temperature: 0.2,
      maxTokens: 2048,
      stream: true,
    };

    await saveProjectConfig(draft, { putApiImpl: putApiMock as PutApiLike });

    expect(putApiMock).toHaveBeenCalledWith("/project", draft);
  });
});

describe("model override helpers", () => {
  it("normalizes both string and object override payloads for the Studio editor", () => {
    const normalized = normalizeOverridesDraft({
      overrides: {
        writer: "gpt-5.4",
        reviser: {
          model: "gpt-5.3-codex",
          provider: "codex-cli",
          reasoningEffort: "xhigh",
        },
      },
    });

    expect(normalized.writer).toEqual({
      model: "gpt-5.4",
      provider: "",
      baseUrl: "",
      reasoningEffort: "",
    });
    expect(normalized.reviser).toEqual({
      model: "gpt-5.3-codex",
      provider: "codex-cli",
      baseUrl: "",
      reasoningEffort: "xhigh",
    });
  });

  it("serializes empty strings away before saving overrides", () => {
    expect(serializeOverridesDraft({
      writer: { model: "gpt-5.4", provider: "", baseUrl: "", reasoningEffort: "" },
      reviser: { model: "gpt-5.3-codex", provider: "codex-cli", baseUrl: "", reasoningEffort: "xhigh" },
      auditor: { model: "", provider: "openai", baseUrl: "", reasoningEffort: "" },
    })).toEqual({
      writer: "gpt-5.4",
      reviser: {
        model: "gpt-5.3-codex",
        provider: "codex-cli",
        reasoningEffort: "xhigh",
      },
    });
  });

  it("moves provider selection first and keeps custom models when routing changes", () => {
    expect(applyRoutingProviderChange(
      { model: "gpt-5.4", provider: "", baseUrl: "", reasoningEffort: "" },
      "codex-cli",
      "openai",
      capabilities,
    )).toEqual({
      model: "gpt-5.4",
      provider: "codex-cli",
      baseUrl: "",
      reasoningEffort: "",
    });

    expect(applyRoutingProviderChange(
      { model: "custom-reasoner", provider: "openai", baseUrl: "", reasoningEffort: "high" },
      "gemini-cli",
      "openai",
      capabilities,
    )).toEqual({
      model: "custom-reasoner",
      provider: "gemini-cli",
      baseUrl: "",
      reasoningEffort: "",
    });

    expect(applyRoutingProviderChange(
      { model: "writer", provider: "codex-cli", baseUrl: "", reasoningEffort: "xhigh" },
      "openai",
      "codex-cli",
      capabilities,
    )).toEqual({
      model: "writer",
      provider: "openai",
      baseUrl: "",
      reasoningEffort: "",
    });

    expect(applyRoutingProviderChange(
      {
        model: "gpt-5.4",
        provider: "codex-cli",
        baseUrl: "",
        reasoningEffort: "foo" as RoutingAgentOverride["reasoningEffort"],
      },
      "codex-cli",
      "openai",
      capabilities,
    )).toEqual({
      model: "gpt-5.4",
      provider: "codex-cli",
      baseUrl: "",
      reasoningEffort: "",
    });
  });
});
