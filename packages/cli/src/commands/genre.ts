import { Command } from "commander";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { listAvailableGenres, readGenreProfile, getBuiltinGenresDir } from "@actalk/inkos-core";
import { findProjectRoot, log, logError } from "../utils.js";
import { parseGenreBatchMarkdown, renderGenreProfileMarkdown } from "./genre-batch.js";

export const genreCommand = new Command("genre")
  .description("Manage genre profiles");

genreCommand
  .command("list")
  .description("List all available genre profiles (built-in + project)")
  .action(async () => {
    try {
      const root = findProjectRoot();
      const genres = await listAvailableGenres(root);

      if (genres.length === 0) {
        log("No genre profiles found.");
        return;
      }

      log("Available genres:\n");
      for (const g of genres) {
        const tag = g.source === "project" ? "[project]" : "[builtin]";
        log(`  ${g.id.padEnd(12)} ${g.name.padEnd(8)} ${tag}`);
      }
      log(`\nTotal: ${genres.length} genre(s)`);
    } catch (e) {
      logError(`Failed to list genres: ${e}`);
      process.exit(1);
    }
  });

genreCommand
  .command("show")
  .description("Display a genre profile")
  .argument("<id>", "Genre ID (e.g. modern-fantasy, murim, xuanhuan)")
  .action(async (id: string) => {
    try {
      const root = findProjectRoot();
      const genres = await listAvailableGenres(root);
      const exactMatch = genres.some(g => g.id === id);
      if (!exactMatch) {
        logError(`Genre "${id}" not found. Available: ${genres.map(g => g.id).join(", ")}`);
        process.exit(1);
      }
      const { profile, body } = await readGenreProfile(root, id);

      log(`Genre: ${profile.name} (${profile.id})\n`);
      log(`  Chapter types:      ${profile.chapterTypes.join(", ")}`);
      log(`  Fatigue words:      ${profile.fatigueWords.join(", ")}`);
      log(`  Numerical system:   ${profile.numericalSystem}`);
      log(`  Power scaling:      ${profile.powerScaling}`);
      log(`  Era research:       ${profile.eraResearch}`);
      log(`  Pacing rule:        ${profile.pacingRule}`);
      log(`  Satisfaction types: ${profile.satisfactionTypes.join(", ")}`);
      log(`  Audit dimensions:   ${profile.auditDimensions.join(", ")}`);

      if (body) {
        log(`\n--- Body ---\n${body}`);
      }
    } catch (e) {
      logError(`Failed to show genre: ${e}`);
      process.exit(1);
    }
  });

genreCommand
  .command("create")
  .description("Scaffold a new genre profile in the project genres/ directory")
  .argument("<id>", "Genre ID (e.g. scifi, wuxia, romance)")
  .option("--name <name>", "Genre display name", "")
  .option("--lang <language>", "Genre language: ko, zh, or en", "ko")
  .option("--numerical", "Enable numerical system", false)
  .option("--power", "Enable power scaling", false)
  .option("--era", "Enable era research", false)
  .action(async (id: string, opts) => {
    try {
      const root = findProjectRoot();
      const genresDir = join(root, "genres");
      const filePath = join(genresDir, `${id}.md`);

      // Check if already exists
      try {
        await readFile(filePath, "utf-8");
        logError(`Genre profile already exists: ${filePath}`);
        process.exit(1);
      } catch { /* file doesn't exist, good */ }

      await mkdir(genresDir, { recursive: true });

      const name = opts.name || id;
      const template = buildGenreTemplate({
        id,
        name,
        language: opts.lang,
        numericalSystem: opts.numerical,
        powerScaling: opts.power,
        eraResearch: opts.era,
      });

      await writeFile(filePath, template, "utf-8");
      log(`Created genre profile: ${filePath}`);
      log(`Edit the file to customize chapter types, fatigue words, rules, etc.`);
    } catch (e) {
      logError(`Failed to create genre: ${e}`);
      process.exit(1);
    }
  });

genreCommand
  .command("copy")
  .description("Copy a built-in genre profile to project for customization")
  .argument("<id>", "Genre ID to copy (e.g. modern-fantasy, murim, xuanhuan)")
  .action(async (id: string) => {
    try {
      const root = findProjectRoot();
      const builtinDir = getBuiltinGenresDir();
      const srcPath = join(builtinDir, `${id}.md`);
      const genresDir = join(root, "genres");
      const destPath = join(genresDir, `${id}.md`);

      // Check if project override already exists
      try {
        await readFile(destPath, "utf-8");
        logError(`Project genre profile already exists: ${destPath}`);
        process.exit(1);
      } catch { /* doesn't exist, good */ }

      let content: string;
      try {
        content = await readFile(srcPath, "utf-8");
      } catch {
        logError(`Built-in genre "${id}" not found. Use 'inkos genre list' to see available genres.`);
        process.exit(1);
        return;
      }

      await mkdir(genresDir, { recursive: true });
      await writeFile(destPath, content, "utf-8");
      log(`Copied to: ${destPath}`);
      log(`This project-level copy will override the built-in profile.`);
    } catch (e) {
      logError(`Failed to copy genre: ${e}`);
      process.exit(1);
    }
  });

genreCommand
  .command("import-batch")
  .description("Import multiple genre profiles from a markdown spec file into the project genres/ directory")
  .argument("<path>", "Path to the markdown spec file, or - to read from stdin")
  .option("--force", "Overwrite existing project genre files", false)
  .action(async (path: string, opts) => {
    try {
      const root = findProjectRoot();
      const genresDir = join(root, "genres");
      const raw = path === "-"
        ? await readStdinText()
        : await readFile(path, "utf-8");

      const profiles = parseGenreBatchMarkdown(raw);
      await mkdir(genresDir, { recursive: true });

      const created: string[] = [];
      const skipped: string[] = [];

      for (const profile of profiles) {
        const filePath = join(genresDir, `${profile.id}.md`);
        const nextContent = renderGenreProfileMarkdown(profile);

        if (!opts.force) {
          try {
            await readFile(filePath, "utf-8");
            skipped.push(profile.id);
            continue;
          } catch {
            // File does not exist yet.
          }
        }

        await writeFile(filePath, nextContent, "utf-8");
        created.push(profile.id);
      }

      if (created.length > 0) {
        log(`Imported ${created.length} genre profile(s): ${created.join(", ")}`);
      }
      if (skipped.length > 0) {
        log(`Skipped existing profiles: ${skipped.join(", ")}`);
        log("Re-run with --force to overwrite them.");
      }
      if (created.length === 0 && skipped.length === 0) {
        log("No genre profiles were imported.");
      }
    } catch (e) {
      logError(`Failed to import genres: ${e}`);
      process.exit(1);
    }
  });

function buildGenreTemplate(params: {
  readonly id: string;
  readonly name: string;
  readonly language: string;
  readonly numericalSystem: boolean;
  readonly powerScaling: boolean;
  readonly eraResearch: boolean;
}): string {
  if (params.language === "en") {
    return `---
name: ${params.name}
id: ${params.id}
language: en
chapterTypes: ["progress", "setup", "transition", "payoff"]
fatigueWords: ["suddenly", "somehow", "couldn't believe", "it felt like"]
numericalSystem: ${params.numericalSystem}
powerScaling: ${params.powerScaling}
eraResearch: ${params.eraResearch}
pacingRule: "Deliver a clear turn, gain, or reveal every 2-3 chapters"
satisfactionTypes: ["goal achieved", "obstacle cleared", "truth revealed"]
auditDimensions: [1,2,3,6,7,8,9,10,13,14,15,16,17,18,19]
---

## Genre Pitfalls

- (Add genre-specific pitfalls)

## Narrative Guidance

(Describe pacing, tone, and reader expectations for this genre)
`;
  }

  if (params.language === "zh") {
    return `---
name: ${params.name}
id: ${params.id}
language: zh
chapterTypes: ["推进章", "布局章", "过渡章", "回收章"]
fatigueWords: ["震惊", "不可思议", "难以置信"]
numericalSystem: ${params.numericalSystem}
powerScaling: ${params.powerScaling}
eraResearch: ${params.eraResearch}
pacingRule: "每2-3章有一个明确的进展或反馈"
satisfactionTypes: ["目标达成", "困难克服", "真相揭示"]
auditDimensions: [1,2,3,6,7,8,9,10,13,14,15,16,17,18,19]
---

## 题材禁忌

- (根据题材添加禁忌)

## 叙事指导

(根据题材描述叙事重心和风格要求)
`;
  }

  return `---
name: ${params.name}
id: ${params.id}
language: ko
chapterTypes: ["전개화", "설치화", "전환화", "회수화"]
fatigueWords: ["충격", "믿기 어려웠다", "순간", "왠지"]
numericalSystem: ${params.numericalSystem}
powerScaling: ${params.powerScaling}
eraResearch: ${params.eraResearch}
pacingRule: "2-3화마다 분명한 진전, 보상, 반전 중 하나는 보여준다"
satisfactionTypes: ["목표 달성", "장애 극복", "진실 공개"]
auditDimensions: [1,2,3,6,7,8,9,10,13,14,15,16,17,18,19]
---

## 장르 금기

- (장르별 금기를 추가)

## 서사 가이드

(이 장르에서 중요한 전개 리듬, 문체, 독자 기대를 적기)
`;
}

async function readStdinText(): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf-8"));
  }
  return chunks.join("");
}
