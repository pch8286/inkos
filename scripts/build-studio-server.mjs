import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "..");
const studioRoot = resolve(workspaceRoot, "packages", "studio");

async function main() {
  execFileSync(process.execPath, [
    join(__dirname, "build-typescript-package.mjs"),
    "--cache-name",
    "studio-server",
    "--config",
    "tsconfig.server.json",
    "--src",
    "src/api",
    "--src",
    "src/shared",
    "--required",
    "dist/api/index.js",
    "--required",
    "dist/api/server.js",
    "--required",
    "dist/api/index.d.ts",
  ], {
    cwd: studioRoot,
    stdio: "inherit",
  });
}

await main();
