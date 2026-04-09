import { describe, expect, it } from "vitest";
import {
  defaultModelForProvider,
  modelSuggestionsForProvider,
  normalizeReasoningEffortForProvider,
  reasoningEffortsForProvider,
  type LlmCapabilitiesSummary,
} from "./llm";

const capabilities: LlmCapabilitiesSummary = {
  providers: {
    openai: {
      models: ["gpt-5.4"],
      defaultModel: "gpt-5.4",
      reasoningEfforts: ["low", "medium", "high"],
      modelSource: "fallback",
      reasoningSource: "fallback",
    },
    anthropic: {
      models: ["claude-sonnet-4-0"],
      defaultModel: "claude-sonnet-4-0",
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
      models: ["auto-gemini-3", "gemini-2.5-pro"],
      defaultModel: "auto-gemini-3",
      reasoningEfforts: [],
      modelSource: "installed",
      reasoningSource: "fallback",
    },
    "codex-cli": {
      models: ["gpt-5.5-codex-preview"],
      defaultModel: "gpt-5.5-codex-preview",
      reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"],
      modelSource: "config",
      reasoningSource: "installed",
    },
  },
};

describe("llm capability helpers", () => {
  it("prefers discovered model lists over fallback suggestions", () => {
    expect(modelSuggestionsForProvider("codex-cli", capabilities)).toEqual(["gpt-5.5-codex-preview"]);
    expect(defaultModelForProvider("codex-cli", capabilities)).toBe("gpt-5.5-codex-preview");
  });

  it("prefers discovered reasoning efforts over fallback suggestions", () => {
    expect(reasoningEffortsForProvider("codex-cli", capabilities)).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("normalizes reasoning effort against provider support", () => {
    expect(normalizeReasoningEffortForProvider("xhigh", "openai", capabilities)).toBe("");
    expect(normalizeReasoningEffortForProvider("xhigh", "codex-cli", capabilities)).toBe("xhigh");
  });
});
