import { beforeEach, describe, expect, it, vi } from "vitest";

const accessMock = vi.fn();
const spawnMock = vi.fn(() => ({
  on: vi.fn(),
}));
const logMock = vi.fn();
const logErrorMock = vi.fn();
const resolveBookIdMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  access: accessMock,
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../utils.js", () => ({
  findProjectRoot: vi.fn(() => "/project"),
  resolveBookId: resolveBookIdMock,
  log: logMock,
  logError: logErrorMock,
}));

describe("studio commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resolveBookIdMock.mockResolvedValue("alpha");
  });

  it("builds cockpit launch URLs", async () => {
    const { buildStudioUrl } = await import("../commands/studio.js");

    expect(buildStudioUrl("4567")).toBe("http://localhost:4567");
    expect(buildStudioUrl("4567", { page: "cockpit", bookId: "alpha" })).toBe(
      "http://localhost:4567/?page=cockpit&bookId=alpha",
    );
    expect(buildStudioUrl("4567", { pathname: "/cockpit/" })).toBe("http://localhost:4567/cockpit/");
    expect(buildStudioUrl("4567", { pathname: "/cockpit/", searchParams: { bookId: "alpha" } })).toBe(
      "http://localhost:4567/cockpit/?bookId=alpha",
    );
  });

  it("launches TypeScript sources through tsx in monorepo mode", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path === "/project/packages/studio/src/api/index.ts") {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { studioCommand } = await import("../commands/studio.js");
    await studioCommand.parseAsync(["node", "studio", "--port", "9001"]);

    expect(spawnMock).toHaveBeenCalledWith(
      "npx",
      ["tsx", "/project/packages/studio/src/api/index.ts", "/project"],
      expect.objectContaining({
        cwd: "/project",
        stdio: "inherit",
        env: expect.objectContaining({ INKOS_STUDIO_PORT: "9001" }),
      }),
    );
    expect(logMock).toHaveBeenCalledWith("Starting InkOS Studio on http://localhost:9001");
  });

  it("launches built JavaScript entries through node", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path === "/project/node_modules/@actalk/inkos-studio/dist/api/index.js") {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { studioCommand } = await import("../commands/studio.js");
    await studioCommand.parseAsync(["node", "studio", "--port", "4567"]);

    expect(spawnMock).toHaveBeenCalledWith(
      "node",
      ["/project/node_modules/@actalk/inkos-studio/dist/api/index.js", "/project"],
      expect.objectContaining({
        cwd: "/project",
        stdio: "inherit",
        env: expect.objectContaining({ INKOS_STUDIO_PORT: "4567" }),
      }),
    );
  });

  it("launches cockpit mode with a resolved book route", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path === "/project/packages/studio/src/api/index.ts") {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { cockpitCommand } = await import("../commands/cockpit.js");
    await cockpitCommand.parseAsync(["node", "cockpit", "alpha", "--port", "9011"]);

    expect(resolveBookIdMock).toHaveBeenCalledWith("alpha", "/project");
    expect(spawnMock).toHaveBeenCalledWith(
      "npx",
      ["tsx", "/project/packages/studio/src/api/index.ts", "/project"],
      expect.objectContaining({
        cwd: "/project",
        stdio: "inherit",
        env: expect.objectContaining({ INKOS_STUDIO_PORT: "9011" }),
      }),
    );
    expect(logMock).toHaveBeenCalledWith(
      "Starting InkOS Cockpit on http://localhost:9011/cockpit/?bookId=alpha",
    );
  });
});
