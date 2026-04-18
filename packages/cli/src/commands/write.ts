import { Command } from "commander";
import { PipelineRunner, StateManager, StructuralGateResultSchema } from "@actalk/inkos-core";
import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig, buildPipelineConfig, findProjectRoot, getLegacyMigrationHint, resolveContext, resolveBookId, log, logError } from "../utils.js";
import { formatWriteNextComplete, formatWriteNextProgress, formatWriteNextResultLines, formatWriteStructuralGateNoticeLines, resolveCliLanguage } from "../localization.js";

type StructuralGateFinding = {
  readonly code: string;
  readonly message: string;
  readonly evidence?: string;
  readonly location?: string;
};

type StructuralGateSnapshot = {
  readonly passed: boolean;
  readonly summary: string;
  readonly criticalFindings: ReadonlyArray<StructuralGateFinding>;
  readonly softFindings: ReadonlyArray<StructuralGateFinding>;
};

type StructuralGateRuntimeArtifact = {
  readonly firstPass: StructuralGateSnapshot;
  readonly secondPass?: StructuralGateSnapshot;
  readonly reviserInvoked: boolean;
  readonly finalBlockingStatus: "passed" | "blocked";
};

function getStructuralGateArtifactPath(root: string, bookId: string, chapterNumber: number): string {
  return join(
    root,
    "books",
    bookId,
    "story",
    "runtime",
    `chapter-${String(chapterNumber).padStart(4, "0")}.structural-gate.json`,
  );
}

function normalizeStructuralGateSnapshot(value: unknown): StructuralGateSnapshot | null {
  const parsed = StructuralGateResultSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return {
    passed: parsed.data.passed,
    summary: parsed.data.summary,
    criticalFindings: parsed.data.criticalFindings.map((finding) => ({
      code: finding.code,
      message: finding.message,
      ...(finding.evidence ? { evidence: finding.evidence } : {}),
      ...(finding.location ? { location: finding.location } : {}),
    })),
    softFindings: parsed.data.softFindings.map((finding) => ({
      code: finding.code,
      message: finding.message,
      ...(finding.evidence ? { evidence: finding.evidence } : {}),
      ...(finding.location ? { location: finding.location } : {}),
    })),
  };
}

function parseStructuralGateRuntimeArtifact(raw: string): StructuralGateRuntimeArtifact | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const finalBlockingStatus = record.finalBlockingStatus;
  if (finalBlockingStatus !== "passed" && finalBlockingStatus !== "blocked") {
    return null;
  }

  const firstPass = normalizeStructuralGateSnapshot(record.firstPass);
  if (!firstPass) {
    return null;
  }

  const secondPass = record.secondPass === undefined
    ? undefined
    : normalizeStructuralGateSnapshot(record.secondPass);
  if (record.secondPass !== undefined && !secondPass) {
    return null;
  }

  return {
    firstPass,
    ...(secondPass ? { secondPass } : {}),
    reviserInvoked: Boolean(record.reviserInvoked),
    finalBlockingStatus,
  };
}

function selectStructuralGateSnapshot(artifact: StructuralGateRuntimeArtifact): StructuralGateSnapshot {
  if (artifact.finalBlockingStatus === "blocked") {
    return artifact.secondPass ?? artifact.firstPass;
  }

  return artifact.secondPass ?? artifact.firstPass;
}

async function readStructuralGateRuntimeArtifact(
  root: string,
  bookId: string,
  chapterNumber: number,
): Promise<{ readonly artifact: StructuralGateRuntimeArtifact; readonly path: string } | null> {
  const path = getStructuralGateArtifactPath(root, bookId, chapterNumber);
  try {
    const raw = await readFile(path, "utf-8");
    const artifact = parseStructuralGateRuntimeArtifact(raw);
    if (!artifact) {
      return null;
    }
    return { artifact, path };
  } catch {
    return null;
  }
}

function buildStructuralGateErrorJson(
  error: unknown,
  bookId: string,
  chapterNumber: number | undefined,
  artifactInfo: { readonly artifact: StructuralGateRuntimeArtifact; readonly path: string } | null,
): Record<string, unknown> {
  const baseError = error instanceof Error ? error.message : String(error);
  if (!artifactInfo) {
    return {
      error: baseError,
      bookId,
      ...(chapterNumber !== undefined ? { chapterNumber } : {}),
    };
  }

  const snapshot = selectStructuralGateSnapshot(artifactInfo.artifact);
  return {
    error: baseError,
    bookId,
    ...(chapterNumber !== undefined ? { chapterNumber } : {}),
    structuralGate: {
      artifactPath: artifactInfo.path,
      summary: snapshot.summary,
      finalBlockingStatus: artifactInfo.artifact.finalBlockingStatus,
      reviserInvoked: artifactInfo.artifact.reviserInvoked,
      criticalFindings: snapshot.criticalFindings,
      softFindings: snapshot.softFindings,
    },
  };
}

function buildStructuralGateSuccessJson<T extends object>(
  result: T,
  artifactInfo: { readonly artifact: StructuralGateRuntimeArtifact; readonly path: string } | null,
): T & { structuralGate?: Record<string, unknown> } {
  if (!artifactInfo) {
    return result;
  }

  const snapshot = selectStructuralGateSnapshot(artifactInfo.artifact);
  return {
    ...result,
    structuralGate: {
      artifactPath: artifactInfo.path,
      summary: snapshot.summary,
      finalBlockingStatus: artifactInfo.artifact.finalBlockingStatus,
      reviserInvoked: artifactInfo.artifact.reviserInvoked,
      criticalFindings: snapshot.criticalFindings,
      softFindings: snapshot.softFindings,
    },
  };
}

async function logStructuralGateRuntimeArtifact(
  language: ReturnType<typeof resolveCliLanguage>,
  artifactInfo: { readonly artifact: StructuralGateRuntimeArtifact; readonly path: string } | null,
  status: "blocked" | "passed",
  emit: (message: string) => void,
): Promise<void> {
  if (!artifactInfo) {
    return;
  }

  const snapshot = selectStructuralGateSnapshot(artifactInfo.artifact);
  for (const line of formatWriteStructuralGateNoticeLines(language, snapshot, status)) {
    emit(line);
  }
}

export const writeCommand = new Command("write")
  .description("Write chapters");

writeCommand
  .command("next")
  .description("Write the next chapter for a book")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--count <n>", "Number of chapters to write", "1")
  .option("--words <n>", "Words per chapter (overrides book config)")
  .option("--context <text>", "Creative guidance (natural language)")
  .option("--context-file <path>", "Read guidance from file")
  .option("--json", "Output JSON")
  .option("-q, --quiet", "Suppress console output")
  .action(async (bookIdArg: string | undefined, opts) => {
    const root = findProjectRoot();
    let bookId: string | undefined;
    let language: ReturnType<typeof resolveCliLanguage> = "ko";
    try {
      bookId = await resolveBookId(bookIdArg, root);
      const context = await resolveContext(opts);
      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      language = resolveCliLanguage(book.language);
      const migrationHint = await getLegacyMigrationHint(root, bookId);
      if (migrationHint && !opts.json) {
        log(`[migration] ${migrationHint}`);
      }
      const config = await loadConfig();

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, { externalContext: context, quiet: opts.quiet }));

      const count = parseInt(opts.count, 10);
      const wordCount = opts.words ? parseInt(opts.words, 10) : undefined;

      const results = [];
      for (let i = 0; i < count; i++) {
        if (!opts.json) log(formatWriteNextProgress(language, i + 1, count, bookId));

        const result = await pipeline.writeNextChapter(bookId, wordCount);
        results.push(result);
        const artifactInfo = await readStructuralGateRuntimeArtifact(root, bookId, result.chapterNumber);

        if (!opts.json) {
          for (const line of formatWriteNextResultLines(language, {
            chapterNumber: result.chapterNumber,
            title: result.title,
            wordCount: result.wordCount,
            auditPassed: result.auditResult.passed,
            revised: result.revised,
            status: result.status,
            issues: result.auditResult.issues,
          })) {
            log(line);
          }
          await logStructuralGateRuntimeArtifact(language, artifactInfo, "passed", log);
          log("");
        }

        if (result.status === "state-degraded") {
          if (!opts.json) {
            log(language === "en"
              ? "State repair required before continuing. Stopping batch."
              : "需要先修复 state，已停止后续连写。");
          }
          break;
        }
      }

      if (opts.json) {
        const jsonResults = await Promise.all(results.map(async (result) => (
          buildStructuralGateSuccessJson(
            result,
            await readStructuralGateRuntimeArtifact(root, bookId!, result.chapterNumber),
          )
        )));
        log(JSON.stringify(jsonResults, null, 2));
      } else {
        log(formatWriteNextComplete(language));
      }
    } catch (e) {
      const structuralGateChapter = typeof e === "object" && e !== null && "chapterNumber" in e
        ? Number((e as { readonly chapterNumber?: unknown }).chapterNumber)
        : undefined;
      const artifactInfo = bookId && structuralGateChapter && !Number.isNaN(structuralGateChapter)
        ? await readStructuralGateRuntimeArtifact(root, bookId, structuralGateChapter)
        : null;
      if (opts.json) {
        log(JSON.stringify(buildStructuralGateErrorJson(e, bookId ?? "(unknown)", structuralGateChapter, artifactInfo), null, 2));
      } else {
        if (artifactInfo) {
          for (const line of formatWriteStructuralGateNoticeLines(
            language,
            selectStructuralGateSnapshot(artifactInfo.artifact),
            "blocked",
          )) {
            logError(line);
          }
        }
        logError(`Failed to write chapter: ${e}`);
      }
      process.exit(1);
    }
  });

writeCommand
  .command("rewrite")
  .description("Re-generate a specific chapter: rewrite [book-id] <chapter>")
  .argument("<args...>", "Book ID (optional) and chapter number")
  .option("--force", "Skip confirmation prompt")
  .option("--words <n>", "Words per chapter (overrides book config)")
  .option("--json", "Output JSON")
  .action(async (args: ReadonlyArray<string>, opts) => {
    const root = findProjectRoot();
    let bookId: string | undefined;
    let chapter: number | undefined;
    let language: ReturnType<typeof resolveCliLanguage> = "ko";
    try {
      if (args.length === 1) {
        chapter = parseInt(args[0]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[0]}"`);
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        chapter = parseInt(args[1]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[1]}"`);
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error("Usage: inkos write rewrite [book-id] <chapter>");
      }

      const resolvedBookId = bookId;
      const chapterNumber = chapter;
      if (!resolvedBookId || chapterNumber === undefined) {
        throw new Error("Usage: inkos write rewrite [book-id] <chapter>");
      }

      if (!opts.force) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Rewrite chapter ${chapterNumber} of "${resolvedBookId}"? This will delete chapter ${chapterNumber} and all later chapters. (y/N) `, resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== "y") {
          log("Cancelled.");
          return;
        }
      }

      const state = new StateManager(root);
      const bookDir = state.bookDir(resolvedBookId);
      const chaptersDir = join(bookDir, "chapters");
      const migrationHint = await getLegacyMigrationHint(root, resolvedBookId);
      if (migrationHint && !opts.json) {
        log(`[migration] ${migrationHint}`);
      }

      // Remove existing chapter file
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNumber).padStart(4, "0");
      const existing = files.filter((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      for (const f of existing) {
        await unlink(join(chaptersDir, f));
        if (!opts.json) log(`Removed: ${f}`);
      }

      // Remove from index (and all chapters after it)
      const index = await state.loadChapterIndex(resolvedBookId);
      const trimmed = index.filter((ch) => ch.number < chapterNumber);
      await state.saveChapterIndex(resolvedBookId, trimmed);

      // Also remove later chapter files since state will be rolled back
      const laterFiles = files.filter((f) => {
        const num = parseInt(f.slice(0, 4), 10);
        return num > chapterNumber && f.endsWith(".md");
      });
      for (const f of laterFiles) {
        await unlink(join(chaptersDir, f));
        if (!opts.json) log(`Removed later chapter: ${f}`);
      }

      // Restore state to previous chapter's end-state (chapter 1 uses snapshot-0 from initBook)
      const restoreFrom = chapterNumber - 1;
      const restored = await state.restoreState(resolvedBookId, restoreFrom);
      if (restored) {
        if (!opts.json) log(`State restored from chapter ${restoreFrom} snapshot.`);
      } else {
        if (!opts.json) log(`Warning: no snapshot for chapter ${restoreFrom}. Using current state.`);
      }

      if (!opts.json) log(`Regenerating chapter ${chapterNumber}...`);

      const wordCount = opts.words ? parseInt(opts.words, 10) : undefined;

      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));

      const result = await pipeline.writeNextChapter(resolvedBookId, wordCount);
      const book = await state.loadBookConfig(resolvedBookId);
      language = resolveCliLanguage(book.language);
      const artifactInfo = await readStructuralGateRuntimeArtifact(root, resolvedBookId, result.chapterNumber);

      if (opts.json) {
        log(JSON.stringify(buildStructuralGateSuccessJson(result, artifactInfo), null, 2));
      } else {
        for (const line of formatWriteNextResultLines(language, {
          chapterNumber: result.chapterNumber,
          title: result.title,
          wordCount: result.wordCount,
          auditPassed: result.auditResult.passed,
          revised: result.revised,
          status: result.status,
          issues: result.auditResult.issues,
        })) {
          log(line);
        }
        await logStructuralGateRuntimeArtifact(language, artifactInfo, "passed", log);
      }
    } catch (e) {
      const structuralGateChapter = typeof e === "object" && e !== null && "chapterNumber" in e
        ? Number((e as { readonly chapterNumber?: unknown }).chapterNumber)
        : undefined;
      const artifactInfo = bookId && structuralGateChapter && !Number.isNaN(structuralGateChapter)
        ? await readStructuralGateRuntimeArtifact(root, bookId, structuralGateChapter)
        : null;
      if (opts.json) {
        log(JSON.stringify(buildStructuralGateErrorJson(e, bookId ?? "(unknown)", structuralGateChapter, artifactInfo), null, 2));
      } else {
        if (artifactInfo) {
          for (const line of formatWriteStructuralGateNoticeLines(
            language,
            selectStructuralGateSnapshot(artifactInfo.artifact),
            "blocked",
          )) {
            logError(line);
          }
        }
        logError(`Failed to rewrite chapter: ${e}`);
      }
      process.exit(1);
    }
  });

writeCommand
  .command("repair-state")
  .description("Rebuild truth files for a persisted state-degraded chapter without rewriting body text")
  .argument("<args...>", "Book ID (optional) and chapter number")
  .option("--json", "Output JSON")
  .action(async (args: ReadonlyArray<string>, opts) => {
    const root = findProjectRoot();
    let bookId: string | undefined;
    let chapter: number | undefined;
    let language: ReturnType<typeof resolveCliLanguage> = "ko";
    try {
      if (args.length === 1) {
        chapter = parseInt(args[0]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[0]}"`);
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        chapter = parseInt(args[1]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[1]}"`);
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error("Usage: inkos write repair-state [book-id] <chapter>");
      }

      const resolvedBookId = bookId;
      const chapterNumber = chapter;
      if (!resolvedBookId || chapterNumber === undefined) {
        throw new Error("Usage: inkos write repair-state [book-id] <chapter>");
      }

      const state = new StateManager(root);
      const book = await state.loadBookConfig(resolvedBookId);
      language = resolveCliLanguage(book.language);
      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));
      const result = await pipeline.repairChapterState(resolvedBookId, chapterNumber);
      const artifactInfo = await readStructuralGateRuntimeArtifact(root, resolvedBookId, result.chapterNumber);

      if (opts.json) {
        log(JSON.stringify(buildStructuralGateSuccessJson(result, artifactInfo), null, 2));
      } else {
        for (const line of formatWriteNextResultLines(language, {
          chapterNumber: result.chapterNumber,
          title: result.title,
          wordCount: result.wordCount,
          auditPassed: result.auditResult.passed,
          revised: result.revised,
          status: result.status,
          issues: result.auditResult.issues,
        })) {
          log(line);
        }
        await logStructuralGateRuntimeArtifact(language, artifactInfo, "passed", log);
      }
    } catch (e) {
      const structuralGateChapter = typeof e === "object" && e !== null && "chapterNumber" in e
        ? Number((e as { readonly chapterNumber?: unknown }).chapterNumber)
        : undefined;
      const artifactInfo = bookId && structuralGateChapter && !Number.isNaN(structuralGateChapter)
        ? await readStructuralGateRuntimeArtifact(root, bookId, structuralGateChapter)
        : null;
      if (opts.json) {
        log(JSON.stringify(buildStructuralGateErrorJson(e, bookId ?? "(unknown)", structuralGateChapter, artifactInfo), null, 2));
      } else {
        if (artifactInfo) {
          for (const line of formatWriteStructuralGateNoticeLines(
            language,
            selectStructuralGateSnapshot(artifactInfo.artifact),
            "blocked",
          )) {
            logError(line);
          }
        }
        logError(`Failed to repair chapter state: ${e}`);
      }
      process.exit(1);
    }
  });
