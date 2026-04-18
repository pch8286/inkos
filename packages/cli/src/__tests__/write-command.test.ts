import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const writeNextChapterMock = vi.fn();
const repairChapterStateMock = vi.fn();
const logMock = vi.fn();
const logErrorMock = vi.fn();
const findProjectRootMock = vi.fn();
const resolveBookIdMock = vi.fn();
const resolveContextMock = vi.fn();
const getLegacyMigrationHintMock = vi.fn();
const loadConfigMock = vi.fn();
const buildPipelineConfigMock = vi.fn();

vi.mock("@actalk/inkos-core", async () => {
  const actual = await vi.importActual<typeof import("@actalk/inkos-core")>("@actalk/inkos-core");

  class MockPipelineRunner {
    constructor(_config: unknown) {}

    writeNextChapter = writeNextChapterMock;
    repairChapterState = repairChapterStateMock;
  }

  return {
    ...actual,
    PipelineRunner: MockPipelineRunner,
  };
});

vi.mock("../utils.js", () => ({
  findProjectRoot: () => findProjectRootMock(),
  resolveBookId: (...args: ReadonlyArray<unknown>) => resolveBookIdMock(...args),
  resolveContext: (...args: ReadonlyArray<unknown>) => resolveContextMock(...args),
  getLegacyMigrationHint: (...args: ReadonlyArray<unknown>) => getLegacyMigrationHintMock(...args),
  loadConfig: () => loadConfigMock(),
  buildPipelineConfig: (...args: ReadonlyArray<unknown>) => buildPipelineConfigMock(...args),
  log: (...args: ReadonlyArray<unknown>) => logMock(...args),
  logError: (...args: ReadonlyArray<unknown>) => logErrorMock(...args),
}));

async function loadWriteCommand() {
  vi.resetModules();
  const mod = await import("../commands/write.js");
  return mod.writeCommand;
}

describe("write command structural gate output", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-write-command-test-"));
    writeNextChapterMock.mockReset();
    repairChapterStateMock.mockReset();
    logMock.mockReset();
    logErrorMock.mockReset();
    findProjectRootMock.mockReset();
    resolveBookIdMock.mockReset();
    resolveContextMock.mockReset();
    getLegacyMigrationHintMock.mockReset();
    loadConfigMock.mockReset();
    buildPipelineConfigMock.mockReset();

    findProjectRootMock.mockReturnValue(root);
    resolveBookIdMock.mockResolvedValue("demo-book");
    resolveContextMock.mockResolvedValue(undefined);
    getLegacyMigrationHintMock.mockResolvedValue(null);
    loadConfigMock.mockResolvedValue({});
    buildPipelineConfigMock.mockReturnValue({});

    await mkdir(join(root, "books", "demo-book", "story", "runtime"), { recursive: true });
    await writeFile(join(root, "books", "demo-book", "book.json"), JSON.stringify({
      id: "demo-book",
      title: "Demo Book",
      platform: "munpia",
      genre: "modern-fantasy",
      status: "active",
      targetChapters: 40,
      chapterWordCount: 2400,
      language: "en",
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    }, null, 2), "utf-8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("prints structural gate hard-fail details for write next", async () => {
    await writeFile(
      join(root, "books", "demo-book", "story", "runtime", "chapter-0001.structural-gate.json"),
      JSON.stringify({
        firstPass: {
          passed: false,
          summary: "missing foundation",
          criticalFindings: [{
            severity: "critical",
            code: "missing-foundation",
            message: "Opening contract is missing.",
            evidence: "No clear story engine.",
            location: "opening",
          }],
          softFindings: [],
        },
        secondPass: {
          passed: false,
          summary: "still missing foundation",
          criticalFindings: [{
            severity: "critical",
            code: "missing-foundation",
            message: "Opening contract is still missing.",
            evidence: "No clear story engine.",
            location: "opening",
          }],
          softFindings: [],
        },
        reviserInvoked: true,
        finalBlockingStatus: "blocked",
      }, null, 2),
      "utf-8",
    );
    writeNextChapterMock.mockRejectedValue(Object.assign(
      new Error("Structural gate failed closed for chapter 1: still missing foundation"),
      { chapterNumber: 1 },
    ));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    const writeCommand = await loadWriteCommand();

    await expect(
      writeCommand.parseAsync(["node", "inkos", "next", "demo-book"], { from: "node" }),
    ).rejects.toThrow("process.exit");

    expect(logErrorMock.mock.calls.flat().join("\n")).toContain("Structural gate failed closed: still missing foundation");
    expect(logErrorMock.mock.calls.flat().join("\n")).toContain("[missing-foundation] Opening contract is still missing.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prints structural gate soft-finding notes after a successful write", async () => {
    await writeFile(
      join(root, "books", "demo-book", "story", "runtime", "chapter-0001.structural-gate.json"),
      JSON.stringify({
        firstPass: {
          passed: true,
          summary: "soft only",
          criticalFindings: [],
          softFindings: [{
            severity: "soft",
            code: "clarity-gap",
            message: "Scene geography is vague.",
          }],
        },
        reviserInvoked: false,
        finalBlockingStatus: "passed",
      }, null, 2),
      "utf-8",
    );
    writeNextChapterMock.mockResolvedValue({
      chapterNumber: 1,
      title: "Test Chapter",
      wordCount: 1200,
      auditResult: { passed: true, issues: [] },
      revised: false,
      status: "ready-for-review",
    });

    const writeCommand = await loadWriteCommand();
    await writeCommand.parseAsync(["node", "inkos", "next", "demo-book"], { from: "node" });

    expect(logMock.mock.calls.flat().join("\n")).toContain("Structural gate note: 1 soft finding(s) (clarity-gap)");
  });

  it("includes structural gate data in successful JSON output", async () => {
    await writeFile(
      join(root, "books", "demo-book", "story", "runtime", "chapter-0001.structural-gate.json"),
      JSON.stringify({
        firstPass: {
          passed: true,
          summary: "soft only",
          criticalFindings: [],
          softFindings: [{
            severity: "soft",
            code: "clarity-gap",
            message: "Scene geography is vague.",
          }],
        },
        reviserInvoked: false,
        finalBlockingStatus: "passed",
      }, null, 2),
      "utf-8",
    );
    writeNextChapterMock.mockResolvedValue({
      chapterNumber: 1,
      title: "Test Chapter",
      wordCount: 1200,
      auditResult: { passed: true, issues: [] },
      revised: false,
      status: "ready-for-review",
    });

    const writeCommand = await loadWriteCommand();
    await writeCommand.parseAsync(["node", "inkos", "next", "demo-book", "--json"], { from: "node" });

    const output = JSON.parse(String(logMock.mock.calls.at(-1)?.[0] ?? "null")) as Array<{
      structuralGate?: { summary?: string; softFindings?: Array<{ code?: string }> };
    }>;
    expect(output[0]?.structuralGate?.summary).toBe("soft only");
    expect(output[0]?.structuralGate?.softFindings?.[0]?.code).toBe("clarity-gap");
  });
});
