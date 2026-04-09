import { Command } from "commander";
import { PipelineRunner } from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, log, logError } from "../utils.js";
import { formatRadarReportLines, formatRadarScanFailed, formatRadarScanStart, resolveCliLanguage } from "../localization.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export const radarCommand = new Command("radar")
  .description("Market intelligence");

radarCommand
.command("scan")
  .description("Scan market for opportunities")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    let language: ReturnType<typeof resolveCliLanguage> = "ko";
    try {
      const config = await loadConfig();
      const root = findProjectRoot();
      language = resolveCliLanguage(config.language);

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));

      if (!opts.json) log(formatRadarScanStart(language));

      const result = await pipeline.runRadar();

      // Save radar result
      const radarDir = join(root, "radar");
      await mkdir(radarDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filePath = join(radarDir, `scan-${timestamp}.json`);
      await writeFile(
        filePath,
        JSON.stringify(result, null, 2),
        "utf-8",
      );

      if (opts.json) {
        log(JSON.stringify({ ...result, savedTo: filePath }, null, 2));
      } else {
        for (const line of formatRadarReportLines(language, result, `radar/scan-${timestamp}.json`)) {
          log(line);
        }
      }
    } catch (e) {
      const message = formatRadarScanFailed(language, e);
      if (opts.json) {
        log(JSON.stringify({ error: message }));
      } else {
        logError(message);
      }
      process.exit(1);
    }
  });
