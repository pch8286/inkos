import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectConfig } from "../utils/config-loader.js";

const ENV_KEYS = [
  "INKOS_LLM_PROVIDER",
  "INKOS_LLM_BASE_URL",
  "INKOS_LLM_MODEL",
  "INKOS_LLM_REASONING_EFFORT",
  "INKOS_LLM_API_KEY",
  "INKOS_LLM_TEMPERATURE",
  "INKOS_LLM_MAX_TOKENS",
  "INKOS_LLM_THINKING_BUDGET",
  "INKOS_LLM_API_FORMAT",
] as const;

describe("loadProjectConfig local provider auth", () => {
  let root = "";
  const previousEnv = new Map<string, string | undefined>();

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      const previous = previousEnv.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    previousEnv.clear();

    if (root) {
      await rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("allows missing API keys for localhost OpenAI-compatible endpoints", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-local-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = "";
    }

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "local-project",
      version: "0.1.0",
      llm: {
        provider: "openai",
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "gpt-oss:20b",
      },
    }, null, 2), "utf-8");
    await writeFile(join(root, ".env"), "", "utf-8");

    const config = await loadProjectConfig(root);

    expect(config.llm.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(config.llm.model).toBe("gpt-oss:20b");
    expect(config.llm.apiKey).toBe("");
  });

  it("still requires API keys for remote hosted endpoints", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-remote-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = "";
    }

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "remote-project",
      version: "0.1.0",
      llm: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4",
      },
    }, null, 2), "utf-8");
    await writeFile(join(root, ".env"), "", "utf-8");
    await expect(loadProjectConfig(root)).rejects.toThrow(/INKOS_LLM_API_KEY not set/i);
  });

  it("allows gemini-cli provider without api key and fills defaults", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-gemini-cli-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = "";
    }

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "gemini-cli-project",
      version: "0.1.0",
      llm: {
        provider: "gemini-cli",
      },
    }, null, 2), "utf-8");
    await writeFile(join(root, ".env"), "", "utf-8");

    const config = await loadProjectConfig(root);

    expect(config.llm.provider).toBe("gemini-cli");
    expect(config.llm.baseUrl).toBe("https://gemini-cli.invalid");
    expect(config.llm.model).toBe("auto-gemini-3");
    expect(config.llm.apiKey).toBe("");
  });

  it("allows codex-cli provider without api key and fills defaults", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-codex-cli-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = "";
    }

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "codex-cli-project",
      version: "0.1.0",
      llm: {
        provider: "codex-cli",
      },
    }, null, 2), "utf-8");
    await writeFile(join(root, ".env"), "", "utf-8");

    const config = await loadProjectConfig(root);

    expect(config.llm.provider).toBe("codex-cli");
    expect(config.llm.baseUrl).toBe("https://codex-cli.invalid");
    expect(config.llm.model).toBe("gpt-5.4");
    expect(config.llm.apiKey).toBe("");
  });

  it("loads reasoning effort from env overrides", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-reasoning-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      delete process.env[key];
    }

    process.env.INKOS_LLM_REASONING_EFFORT = "xhigh";

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "reasoning-project",
      version: "0.1.0",
      llm: {
        provider: "codex-cli",
        model: "gpt-5.4",
      },
    }, null, 2), "utf-8");
    await writeFile(join(root, ".env"), "", "utf-8");

    const config = await loadProjectConfig(root);

    expect(config.llm.reasoningEffort).toBe("xhigh");
  });

  it("ignores untouched scaffold project env when a global OAuth provider is set", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-scaffold-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      delete process.env[key];
    }

    process.env.INKOS_LLM_PROVIDER = "codex-cli";
    process.env.INKOS_LLM_MODEL = "gpt-5.4";

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "scaffold-project",
      version: "0.1.0",
      llm: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
      },
    }, null, 2), "utf-8");
    await writeFile(join(root, ".env"), [
      "INKOS_LLM_PROVIDER=openai",
      "INKOS_LLM_BASE_URL=",
      "INKOS_LLM_API_KEY=",
      "INKOS_LLM_MODEL=",
      "",
    ].join("\n"), "utf-8");

    const config = await loadProjectConfig(root);

    expect(config.llm.provider).toBe("codex-cli");
    expect(config.llm.baseUrl).toBe("https://codex-cli.invalid");
    expect(config.llm.model).toBe("gpt-5.4");
    expect(config.llm.apiKey).toBe("");
  });

  it("drops invalid empty model overrides saved by older Studio builds", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-overrides-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = "";
    }

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "override-project",
      version: "0.1.0",
      llm: {
        provider: "codex-cli",
        model: "gpt-5.4",
      },
      modelOverrides: {
        writer: {
          model: "",
          provider: "gemini-cli",
          baseUrl: "",
        },
        reviser: {
          model: "gpt-5.3-codex",
          provider: "codex-cli",
          reasoningEffort: "xhigh",
        },
      },
    }, null, 2), "utf-8");
    await writeFile(join(root, ".env"), "", "utf-8");

    const config = await loadProjectConfig(root);

    expect(config.modelOverrides).toEqual({
      reviser: {
        model: "gpt-5.3-codex",
        provider: "codex-cli",
        reasoningEffort: "xhigh",
      },
    });
  });
});
