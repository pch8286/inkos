import { Command } from "commander";
import { findProjectRoot, log, logError } from "../utils.js";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export interface StudioLaunchSpec {
  readonly studioEntry: string;
  readonly command: string;
  readonly args: string[];
}

export interface StudioQueryRoute {
  readonly page: "cockpit";
  readonly bookId?: string;
}

export interface StudioPathRoute {
  readonly pathname: `/${string}`;
  readonly searchParams?: Readonly<Record<string, string | undefined>>;
}

export type StudioInitialRoute = StudioQueryRoute | StudioPathRoute;

interface StudioStartOptions {
  readonly port: string;
  readonly label?: string;
  readonly initialRoute?: StudioInitialRoute;
}

async function firstAccessiblePath(paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // continue
    }
  }
  return undefined;
}

const cliPackageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function resolveStudioLaunch(root: string): Promise<StudioLaunchSpec | null> {
  const sourceEntry = await firstAccessiblePath([
    join(root, "packages", "studio", "src", "api", "index.ts"),
    join(root, "..", "packages", "studio", "src", "api", "index.ts"),
    join(root, "..", "studio", "src", "api", "index.ts"),
  ]);
  if (sourceEntry) {
    const studioPackageRoot = dirname(dirname(dirname(sourceEntry)));
    const localTsxLoader = await firstAccessiblePath([
      join(studioPackageRoot, "node_modules", "tsx", "dist", "loader.mjs"),
    ]);
    if (localTsxLoader) {
      return {
        studioEntry: sourceEntry,
        command: "node",
        args: ["--import", localTsxLoader, sourceEntry, root],
      };
    }

    const localTsx = await firstAccessiblePath([
      join(studioPackageRoot, "node_modules", ".bin", "tsx"),
    ]);
    if (localTsx) {
      return {
        studioEntry: sourceEntry,
        command: localTsx,
        args: [sourceEntry, root],
      };
    }
    return {
      studioEntry: sourceEntry,
      command: "npx",
      args: ["tsx", sourceEntry, root],
    };
  }

  const builtEntry = await firstAccessiblePath([
    join(root, "node_modules", "@actalk", "inkos-studio", "dist", "api", "index.js"),
    join(root, "node_modules", "@actalk", "inkos-studio", "server.cjs"),
    join(cliPackageRoot, "node_modules", "@actalk", "inkos-studio", "dist", "api", "index.js"),
    join(cliPackageRoot, "node_modules", "@actalk", "inkos-studio", "server.cjs"),
    join(cliPackageRoot, "..", "inkos-studio", "dist", "api", "index.js"),
    join(cliPackageRoot, "..", "inkos-studio", "server.cjs"),
  ]);
  if (builtEntry) {
    return {
      studioEntry: builtEntry,
      command: "node",
      args: [builtEntry, root],
    };
  }

  return null;
}

export function buildStudioUrl(port: string, initialRoute?: StudioInitialRoute): string {
  const baseUrl = `http://localhost:${port}`;
  if (!initialRoute) return baseUrl;

  if ("pathname" in initialRoute) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(initialRoute.searchParams ?? {})) {
      if (value) {
        params.set(key, value);
      }
    }
    const search = params.toString();
    return `${baseUrl}${initialRoute.pathname}${search ? `?${search}` : ""}`;
  }

  const params = new URLSearchParams();
  params.set("page", initialRoute.page);
  if (initialRoute.bookId) {
    params.set("bookId", initialRoute.bookId);
  }
  return `${baseUrl}/?${params.toString()}`;
}

function bindStudioLifecycle(child: ChildProcess) {
  child.on("error", (e) => {
    logError(`Failed to start studio: ${e.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

export async function startStudio(root: string, options: StudioStartOptions): Promise<void> {
  const launch = await resolveStudioLaunch(root);

  if (!launch) {
    logError(
      "InkOS Studio not found. If you cloned the repo, run:\n" +
      "  cd packages/studio && pnpm install && pnpm build\n" +
      "Then run 'inkos studio' from the project root.",
    );
    process.exit(1);
  }

  const url = buildStudioUrl(options.port, options.initialRoute);
  log(`Starting ${options.label ?? "InkOS Studio"} on ${url}`);

  const child = spawn(launch.command, launch.args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, INKOS_STUDIO_PORT: options.port },
  });

  bindStudioLifecycle(child);
}

export const studioCommand = new Command("studio")
  .description("Start InkOS Studio web workbench")
  .option("-p, --port <port>", "Server port", "4567")
  .action(async (opts) => {
    const root = findProjectRoot();
    await startStudio(root, {
      port: opts.port,
      label: "InkOS Studio",
    });
  });
