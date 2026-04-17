import { Command } from "commander";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { log, logError, GLOBAL_ENV_PATH } from "../utils.js";

const DEFAULT_GEMINI_CLI_MODEL = "auto-gemini-3";

async function hasGlobalConfig(): Promise<boolean> {
  try {
    const content = await readFile(GLOBAL_ENV_PATH, "utf-8");
    const provider = content.match(/^INKOS_LLM_PROVIDER=(.+)$/m)?.[1]?.trim();
    if (provider === "gemini-cli" || provider === "codex-cli") {
      return true;
    }
    return content.includes("INKOS_LLM_API_KEY=") && !content.includes("your-api-key-here");
  } catch {
    return false;
  }
}

export const initCommand = new Command("init")
  .description("Initialize an InkOS project (current directory by default)")
  .argument("[name]", "Project name (creates subdirectory). Omit to init current directory.")
  .option("--lang <language>", "Default writing language: ko (Korean), zh (Chinese), or en (English)", "ko")
  .action(async (name: string | undefined, opts: { lang?: string }) => {
    const projectDir = name ? resolve(process.cwd(), name) : process.cwd();
    const projectName = basename(projectDir);

    try {
      await mkdir(projectDir, { recursive: true });

      // Check if inkos.json already exists
      const configPath = join(projectDir, "inkos.json");
      try {
        await access(configPath);
        throw new Error(`inkos.json already exists in ${projectDir}. Use a different directory or delete the existing project.`);
      } catch (e) {
        if (e instanceof Error && e.message.includes("already exists")) throw e;
        // File doesn't exist, good
      }

      await mkdir(join(projectDir, "books"), { recursive: true });
      await mkdir(join(projectDir, "radar"), { recursive: true });

      const config = {
        name: projectName,
        version: "0.1.0",
        language: opts.lang ?? "ko",
        llm: {
          provider: process.env.INKOS_LLM_PROVIDER ?? "openai",
          baseUrl: process.env.INKOS_LLM_BASE_URL ?? "",
          model: process.env.INKOS_LLM_MODEL ?? "",
        },
        notify: [],
        daemon: {
          schedule: {
            radarCron: "0 */6 * * *",
            writeCron: "*/15 * * * *",
          },
          maxConcurrentBooks: 3,
        },
      };

      await writeFile(
        join(projectDir, "inkos.json"),
        JSON.stringify(config, null, 2),
        "utf-8",
      );
      await Promise.all([
        writeFile(join(projectDir, ".nvmrc"), "22\n", "utf-8"),
        writeFile(join(projectDir, ".node-version"), "22\n", "utf-8"),
      ]);

      const global = await hasGlobalConfig();

      if (global) {
        await writeFile(
          join(projectDir, ".env"),
          [
            "# Project-level LLM overrides (optional)",
            "# Global config at ~/.inkos/.env will be used by default.",
            "# Uncomment below to override for this project only:",
            "# INKOS_LLM_PROVIDER=openai          # or gemini-cli / codex-cli",
            "# INKOS_LLM_BASE_URL=",
            "# INKOS_LLM_API_KEY=",
            "# INKOS_LLM_MODEL=",
            "",
            "# Web search (optional):",
            "# TAVILY_API_KEY=tvly-xxxxx",
          ].join("\n"),
          "utf-8",
        );
      } else {
        await writeFile(
          join(projectDir, ".env"),
          [
            "# LLM Configuration",
            "# Tip: Run 'inkos config set-global' to set once for all projects.",
            "# Provider: openai (OpenAI / compatible proxy), anthropic (Anthropic native), gemini-cli (Gemini CLI OAuth), codex-cli (Codex CLI OAuth)",
            "# Uncomment the lines below to use project-specific overrides instead of global config:",
            "# INKOS_LLM_PROVIDER=openai",
            "# INKOS_LLM_BASE_URL=",
            "# INKOS_LLM_API_KEY=",
            "# INKOS_LLM_MODEL=",
            "",
            "# Optional parameters (defaults shown):",
            "# INKOS_LLM_TEMPERATURE=0.7",
            "# INKOS_LLM_MAX_TOKENS=8192",
            "# INKOS_LLM_THINKING_BUDGET=0          # Anthropic extended thinking budget",
            "# INKOS_LLM_API_FORMAT=chat             # chat (default) or responses (OpenAI Responses API)",
            "",
            "# Web search (optional, for auditor era-research):",
            "# TAVILY_API_KEY=tvly-xxxxx              # Free at tavily.com (1000 searches/month)",
            "",
            "# Anthropic example:",
            "# INKOS_LLM_PROVIDER=anthropic",
            "# INKOS_LLM_BASE_URL=",
            "# INKOS_LLM_MODEL=",
            "",
            "# Gemini CLI OAuth example:",
            "# INKOS_LLM_PROVIDER=gemini-cli",
            `# INKOS_LLM_MODEL=${DEFAULT_GEMINI_CLI_MODEL}`,
            "",
            "# Codex CLI OAuth example:",
            "# INKOS_LLM_PROVIDER=codex-cli",
            "# INKOS_LLM_MODEL=gpt-5.4",
          ].join("\n"),
          "utf-8",
        );
      }

      await writeFile(
        join(projectDir, ".gitignore"),
        [".env", "node_modules/", ".DS_Store"].join("\n"),
        "utf-8",
      );

      log(`Project initialized at ${projectDir}`);
      log("");
      const language = opts.lang ?? "ko";
      const exampleCreate = language === "en"
        ? "  inkos book create --title 'My Novel' --genre progression --platform royalroad --lang en"
        : language === "zh"
          ? "  inkos book create --title '我的小说' --genre xuanhuan --platform tomato --lang zh"
          : "  inkos book create --title '내 소설' --genre modern-fantasy --platform naver-series --lang ko";
      if (global) {
        log("Global LLM config detected. Ready to go!");
        log("");
        log("Next steps:");
        if (name) log(`  cd ${name}`);
        log(exampleCreate);
      } else {
        log("Next steps:");
        if (name) log(`  cd ${name}`);
        log("  # Option 1: Set global config (recommended, one-time):");
        log("  inkos config set-global --provider openai --base-url <your-api-url> --api-key <your-key> --model <your-model>");
        log("  #           or Gemini CLI OAuth:");
        log(`  inkos config set-global --provider gemini-cli --model ${DEFAULT_GEMINI_CLI_MODEL}`);
        log("  #           or Codex CLI OAuth:");
        log("  inkos config set-global --provider codex-cli --model gpt-5.4");
        log("  # Option 2: Edit .env for this project only");
        log("");
        log(exampleCreate);
      }
      log("  inkos write next <book-id>");
    } catch (e) {
      logError(`Failed to initialize project: ${e}`);
      process.exit(1);
    }
  });
