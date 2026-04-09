import { describe, expect, it } from "vitest";
import { extractCodexConfigModel, parseCodexReasoningEfforts } from "./llm-capabilities";

describe("parseCodexReasoningEfforts", () => {
  it("extracts supported reasoning levels from Codex config parser errors", () => {
    const error = [
      "Error loading config.toml: unknown variant `__inkos_probe__`, expected one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`",
      "in `model_reasoning_effort`",
    ].join("\n");

    expect(parseCodexReasoningEfforts(error)).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });
});

describe("extractCodexConfigModel", () => {
  it("reads the current Codex model from config.toml", () => {
    expect(extractCodexConfigModel([
      'model = "gpt-5.4"',
      'model_reasoning_effort = "xhigh"',
      "",
      "[notice.model_migrations]",
      '"gpt-5.3-codex" = "gpt-5.4"',
    ].join("\n"))).toEqual(["gpt-5.4"]);
  });
});
