import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "..");
const studioRoot = resolve(workspaceRoot, "packages", "studio");
const cachePath = join(studioRoot, "node_modules", ".cache", "inkos-studio-client-build.json");
const requiredOutputs = [
  join(studioRoot, "dist", "index.html"),
  join(studioRoot, "dist", "cockpit", "index.html"),
];
const fingerprintInputs = [
  join(workspaceRoot, "pnpm-lock.yaml"),
  join(studioRoot, "package.json"),
  join(studioRoot, "vite.config.ts"),
  join(studioRoot, "tsconfig.json"),
  join(studioRoot, "index.html"),
  join(studioRoot, "cockpit", "index.html"),
];

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function shouldHashFile(filePath) {
  const studioRelativePath = relative(studioRoot, filePath).replaceAll("\\", "/");
  if (studioRelativePath.startsWith("src/api/")) {
    return false;
  }

  return !/\.test\.[^/]+$/u.test(studioRelativePath);
}

async function computeFingerprint() {
  const hash = createHash("sha256");
  const srcFiles = (await collectFiles(join(studioRoot, "src"))).filter(shouldHashFile);

  for (const filePath of [...fingerprintInputs, ...srcFiles]) {
    hash.update(`${relative(workspaceRoot, filePath)}\n`);
    hash.update(await readFile(filePath));
    hash.update("\n");
  }

  return hash.digest("hex");
}

async function readCachedFingerprint() {
  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const raw = await readFile(cachePath, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed.fingerprint === "string" ? parsed.fingerprint : null;
  } catch {
    return null;
  }
}

function hasRequiredOutputs() {
  return requiredOutputs.every((filePath) => existsSync(filePath));
}

async function writeCache(fingerprint) {
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify({ fingerprint }, null, 2)}\n`, "utf-8");
}

async function main() {
  const fingerprint = await computeFingerprint();
  const cachedFingerprint = await readCachedFingerprint();

  if (cachedFingerprint === fingerprint && hasRequiredOutputs()) {
    console.log("vite build skipped (studio client unchanged)");
    return;
  }

  execSync("npx vite build", {
    cwd: studioRoot,
    stdio: "inherit",
  });

  if (!hasRequiredOutputs()) {
    throw new Error("Studio client build completed without required HTML shells");
  }

  await writeCache(fingerprint);
}

await main();
