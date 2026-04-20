import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "..");
const studioRoot = resolve(workspaceRoot, "packages", "studio");
const buildInfoPath = join(studioRoot, "tsconfig.server.tsbuildinfo");
const requiredOutputs = [
  join(studioRoot, "dist", "api", "index.js"),
  join(studioRoot, "dist", "api", "server.js"),
  join(studioRoot, "dist", "api", "index.d.ts"),
];

function hasRequiredOutputs() {
  return requiredOutputs.every((filePath) => existsSync(filePath));
}

async function main() {
  if (!hasRequiredOutputs() && existsSync(buildInfoPath)) {
    await rm(buildInfoPath, { force: true });
  }

  execSync("npx tsc -p tsconfig.server.json", {
    cwd: studioRoot,
    stdio: "inherit",
  });

  if (!hasRequiredOutputs()) {
    throw new Error("Studio server build completed without required runtime outputs");
  }
}

await main();
