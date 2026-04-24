import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "..");
const packageRoot = process.cwd();
const packageRequire = createRequire(join(packageRoot, "package.json"));

function parseArgs(argv) {
  const options = {
    cacheName: null,
    chmod: [],
    config: "tsconfig.json",
    required: [],
    src: ["src"],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--cache-name") {
      options.cacheName = value;
    } else if (arg === "--chmod") {
      options.chmod.push(value);
    } else if (arg === "--config") {
      options.config = value;
    } else if (arg === "--required") {
      options.required.push(value);
    } else if (arg === "--src") {
      if (options.src.length === 1 && options.src[0] === "src") {
        options.src = [];
      }
      options.src.push(value);
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
    i += 1;
  }

  if (options.required.length === 0) {
    throw new Error("At least one --required output is needed");
  }

  return options;
}

async function collectFiles(dir, shouldInclude) {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath, shouldInclude));
      continue;
    }

    if (entry.isFile() && shouldInclude(fullPath)) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function shouldHashSourceFile(filePath) {
  const packageRelativePath = relative(packageRoot, filePath).replaceAll("\\", "/");
  if (packageRelativePath.includes("/__tests__/")) {
    return false;
  }
  return !/\.test\.[^/]+$/u.test(packageRelativePath);
}

function shouldHashDeclaration(filePath) {
  return filePath.endsWith(".d.ts");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf-8"));
}

async function findWorkspacePackages() {
  const packagesRoot = join(workspaceRoot, "packages");
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const packages = new Map();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = join(packagesRoot, entry.name, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = await readJson(packageJsonPath);
    if (typeof packageJson.name === "string") {
      packages.set(packageJson.name, dirname(packageJsonPath));
    }
  }

  return packages;
}

async function collectWorkspaceDependencyInputs(packageJson) {
  const workspacePackages = await findWorkspacePackages();
  const dependencyEntries = Object.entries({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies,
  });
  const inputs = [];

  for (const [name, version] of dependencyEntries) {
    if (typeof version !== "string" || !version.startsWith("workspace:")) {
      continue;
    }

    const dependencyRoot = workspacePackages.get(name);
    if (!dependencyRoot || dependencyRoot === packageRoot) {
      continue;
    }

    inputs.push(join(dependencyRoot, "package.json"));
    inputs.push(...await collectFiles(join(dependencyRoot, "dist"), shouldHashDeclaration));
  }

  return inputs;
}

async function collectPackageTsconfigs() {
  return collectFiles(packageRoot, (filePath) => {
    const packageRelativePath = relative(packageRoot, filePath).replaceAll("\\", "/");
    return /^tsconfig(?:\.[^/]+)?\.json$/u.test(packageRelativePath);
  });
}

async function computeFingerprint(options, packageJson) {
  const hash = createHash("sha256");
  const sourceFiles = [];

  for (const src of options.src) {
    sourceFiles.push(...await collectFiles(resolve(packageRoot, src), shouldHashSourceFile));
  }

  const inputs = [
    fileURLToPath(import.meta.url),
    join(workspaceRoot, "pnpm-lock.yaml"),
    join(workspaceRoot, "tsconfig.json"),
    join(packageRoot, "package.json"),
    ...await collectPackageTsconfigs(),
    ...sourceFiles,
    ...await collectWorkspaceDependencyInputs(packageJson),
  ];

  for (const filePath of [...new Set(inputs)].sort()) {
    if (!existsSync(filePath)) {
      continue;
    }
    hash.update(`${relative(workspaceRoot, filePath)}\n`);
    hash.update(await readFile(filePath));
    hash.update("\n");
  }

  return hash.digest("hex");
}

async function readCachedFingerprint(cachePath) {
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

function hasRequiredOutputs(requiredOutputs) {
  return requiredOutputs.every((filePath) => existsSync(filePath));
}

async function removeBuildInfoIfOutputsMissing(options, requiredOutputs) {
  if (hasRequiredOutputs(requiredOutputs)) {
    return;
  }

  const configPath = resolve(packageRoot, options.config);
  const config = await readJson(configPath);
  const buildInfoPath = config.compilerOptions?.tsBuildInfoFile;
  if (typeof buildInfoPath === "string") {
    await rm(resolve(packageRoot, buildInfoPath), { force: true });
  }
}

async function applyExecutableBits(chmodPaths) {
  for (const chmodPath of chmodPaths) {
    const fullPath = resolve(packageRoot, chmodPath);
    if (existsSync(fullPath)) {
      await chmod(fullPath, 0o755);
    }
  }
}

async function writeCache(cachePath, fingerprint) {
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify({ fingerprint }, null, 2)}\n`, "utf-8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageJson = await readJson(join(packageRoot, "package.json"));
  const packageName = packageJson.name ?? relative(workspaceRoot, packageRoot);
  const cacheName = options.cacheName ?? String(packageName).replaceAll("/", "__");
  const cachePath = join(packageRoot, "node_modules", ".cache", `inkos-ts-build-${cacheName}.json`);
  const requiredOutputs = options.required.map((output) => resolve(packageRoot, output));
  const fingerprint = await computeFingerprint(options, packageJson);
  const cachedFingerprint = await readCachedFingerprint(cachePath);

  if (cachedFingerprint === fingerprint && hasRequiredOutputs(requiredOutputs)) {
    await applyExecutableBits(options.chmod);
    console.log(`tsc skipped (${packageName} unchanged)`);
    return;
  }

  await removeBuildInfoIfOutputsMissing(options, requiredOutputs);

  execFileSync(process.execPath, [packageRequire.resolve("typescript/bin/tsc"), "-p", options.config], {
    cwd: packageRoot,
    stdio: "inherit",
  });

  if (!hasRequiredOutputs(requiredOutputs)) {
    throw new Error(`${packageName} build completed without required outputs`);
  }

  await applyExecutableBits(options.chmod);
  await writeCache(cachePath, fingerprint);
}

await main();
