import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findProjectRoot } from "../utils.js";

const originalCwd = process.cwd();
const cleanupDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(async () => {
  process.chdir(originalCwd);

  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("findProjectRoot", () => {
  it("walks up to an InkOS project root from nested directories", async () => {
    const root = await makeTempDir("inkos-project-");
    const nested = join(root, "story", "chapters");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "inkos.json"), "{}\n", "utf-8");

    process.chdir(nested);

    expect(findProjectRoot()).toBe(root);
  });

  it("walks up to the InkOS monorepo root from package subdirectories", async () => {
    const repoRoot = await makeTempDir("inkos-repo-");
    const nested = join(repoRoot, "packages", "cli", "dist");
    await mkdir(join(repoRoot, "packages", "cli"), { recursive: true });
    await mkdir(join(repoRoot, "packages", "studio"), { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(join(repoRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf-8");
    await writeFile(join(repoRoot, "packages", "cli", "package.json"), "{ \"name\": \"@actalk/inkos\" }\n", "utf-8");
    await writeFile(join(repoRoot, "packages", "studio", "package.json"), "{ \"name\": \"@actalk/inkos-studio\" }\n", "utf-8");

    process.chdir(nested);

    expect(findProjectRoot()).toBe(repoRoot);
  });

  it("falls back to the current directory when no InkOS markers exist", async () => {
    const root = await makeTempDir("inkos-cwd-");
    const nested = join(root, "other", "workspace");
    await mkdir(nested, { recursive: true });

    process.chdir(nested);

    expect(findProjectRoot()).toBe(nested);
  });
});
