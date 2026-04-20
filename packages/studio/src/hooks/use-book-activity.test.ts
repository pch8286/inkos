import { describe, expect, it } from "vitest";
import type { SSEMessage } from "./use-sse";
import {
  deriveActiveBookIds,
  deriveBookActivity,
  shouldRefetchBookCreateStatus,
  shouldRefetchBookCollections,
  shouldRefetchBookView,
  shouldRefetchDaemonStatus,
} from "./use-book-activity";

function msg(event: string, data: unknown, timestamp: number): SSEMessage {
  return { event, data, timestamp };
}

describe("deriveBookActivity", () => {
  it("keeps a book in writing state after write:start until completion", () => {
    const messages: ReadonlyArray<SSEMessage> = [
      msg("write:start", { bookId: "alpha" }, 1),
      msg("log", { message: "Phase 1" }, 2),
      msg("llm:progress", { totalChars: 1200 }, 3),
    ];

    expect(deriveBookActivity(messages, "alpha")).toMatchObject({
      writing: true,
      drafting: false,
      draftCancelling: false,
      lastError: null,
    });
  });

  it("clears writing state after completion or error", () => {
    const completed: ReadonlyArray<SSEMessage> = [
      msg("write:start", { bookId: "alpha" }, 1),
      msg("write:complete", { bookId: "alpha", chapterNumber: 2 }, 2),
    ];
    const errored: ReadonlyArray<SSEMessage> = [
      msg("write:start", { bookId: "alpha" }, 1),
      msg("write:error", { bookId: "alpha", error: "locked" }, 2),
    ];

    expect(deriveBookActivity(completed, "alpha")).toMatchObject({
      writing: false,
      lastError: null,
    });
    expect(deriveBookActivity(errored, "alpha")).toMatchObject({
      writing: false,
      lastError: "locked",
    });
  });

  it("tracks drafting independently from writing", () => {
    const messages: ReadonlyArray<SSEMessage> = [
      msg("draft:start", { bookId: "alpha" }, 1),
      msg("write:start", { bookId: "beta" }, 2),
    ];

    expect(deriveBookActivity(messages, "alpha")).toMatchObject({
      writing: false,
      drafting: true,
      draftCancelling: false,
    });
  });

  it("marks draft cancellation as in-flight until the cancellation finishes", () => {
    const messages: ReadonlyArray<SSEMessage> = [
      msg("draft:start", { bookId: "alpha" }, 1),
      msg("draft:cancel-requested", { bookId: "alpha" }, 2),
    ];

    expect(deriveBookActivity(messages, "alpha")).toMatchObject({
      writing: false,
      drafting: true,
      draftCancelling: true,
      lastError: null,
    });
  });

  it("surfaces live progress details for the latest active pipeline", () => {
    const messages: ReadonlyArray<SSEMessage> = [
      msg("draft:start", { bookId: "alpha" }, 1),
      msg("log", { message: "Preparing chapter context" }, 2),
      msg("llm:progress", { elapsedMs: 3400, totalChars: 1200 }, 3),
    ];

    expect(deriveBookActivity(messages, "alpha")).toMatchObject({
      drafting: true,
      liveDetail: "Preparing chapter context",
      elapsedMs: 3400,
      totalChars: 1200,
    });
  });

  it("does not attach global progress from another book's newer run", () => {
    const messages: ReadonlyArray<SSEMessage> = [
      msg("draft:start", { bookId: "alpha" }, 1),
      msg("write:start", { bookId: "beta" }, 2),
      msg("log", { message: "Writing beta" }, 3),
      msg("llm:progress", { elapsedMs: 1200, totalChars: 700 }, 4),
    ];

    expect(deriveBookActivity(messages, "alpha")).toMatchObject({
      drafting: true,
      liveDetail: null,
      elapsedMs: null,
      totalChars: null,
    });
  });

  it("tracks revise and rewrite runs as live background work for a chapter", () => {
    const revisingMessages: ReadonlyArray<SSEMessage> = [
      msg("revise:start", { bookId: "alpha", chapter: 3 }, 1),
      msg("log", { message: "Applying targeted fixes" }, 2),
      msg("llm:progress", { elapsedMs: 2200, totalChars: 900 }, 3),
    ];
    const rewriteMessages: ReadonlyArray<SSEMessage> = [
      msg("rewrite:start", { bookId: "alpha", chapter: 4 }, 1),
      msg("rewrite:complete", { bookId: "alpha", chapterNumber: 4 }, 2),
    ];

    expect(deriveBookActivity(revisingMessages, "alpha")).toMatchObject({
      revising: true,
      rewriting: false,
      activeOperation: "revise",
      activeChapterNumber: 3,
      liveDetail: "Applying targeted fixes",
      elapsedMs: 2200,
      totalChars: 900,
    });
    expect(deriveBookActivity(rewriteMessages, "alpha")).toMatchObject({
      rewriting: false,
      activeOperation: null,
      activeChapterNumber: null,
    });
  });

  it("falls back to a persisted active run when SSE history is empty after refresh", () => {
    expect(deriveBookActivity([], "alpha", {
      id: "run-1",
      bookId: "alpha",
      chapter: null,
      chapterNumber: null,
      action: "draft",
      status: "running",
      stage: "Generating draft",
      createdAt: "2026-04-20T10:00:00.000Z",
      updatedAt: "2026-04-20T10:00:05.000Z",
      startedAt: "2026-04-20T10:00:01.000Z",
      finishedAt: null,
      logs: [
        {
          timestamp: "2026-04-20T10:00:04.000Z",
          level: "info",
          message: "Preparing chapter context",
        },
      ],
      elapsedMs: 5400,
      totalChars: 2048,
    })).toMatchObject({
      writing: false,
      drafting: true,
      draftCancelling: false,
      activeOperation: "draft",
      liveDetail: "Preparing chapter context",
      elapsedMs: 5400,
      totalChars: 2048,
    });
  });
});

describe("deriveActiveBookIds", () => {
  it("returns only books with in-flight background work", () => {
    const messages: ReadonlyArray<SSEMessage> = [
      msg("write:start", { bookId: "alpha" }, 1),
      msg("draft:start", { bookId: "beta" }, 2),
      msg("write:complete", { bookId: "alpha", chapterNumber: 2 }, 3),
      msg("write:start", { bookId: "gamma" }, 4),
      msg("draft:cancelled", { bookId: "beta" }, 5),
    ];

    expect([...deriveActiveBookIds(messages)].sort()).toEqual(["gamma"]);
  });
});

describe("shouldRefetchBookView", () => {
  it("refreshes the book detail view after terminal background jobs for that book", () => {
    expect(shouldRefetchBookView(msg("book:updated", { bookId: "alpha", title: "Renamed" }, 1), "alpha")).toBe(true);
    expect(shouldRefetchBookView(msg("write:complete", { bookId: "alpha" }, 1), "alpha")).toBe(true);
    expect(shouldRefetchBookView(msg("draft:cancelled", { bookId: "alpha" }, 1), "alpha")).toBe(true);
    expect(shouldRefetchBookView(msg("draft:error", { bookId: "alpha", error: "quota" }, 1), "alpha")).toBe(true);
    expect(shouldRefetchBookView(msg("rewrite:complete", { bookId: "alpha", chapterNumber: 3 }, 1), "alpha")).toBe(true);
    expect(shouldRefetchBookView(msg("revise:error", { bookId: "alpha", error: "bad" }, 1), "alpha")).toBe(true);
    expect(shouldRefetchBookView(msg("audit:complete", { bookId: "alpha", chapter: 3, passed: true }, 1), "alpha")).toBe(true);
    expect(shouldRefetchBookView(msg("audit:start", { bookId: "alpha", chapter: 3 }, 1), "alpha")).toBe(false);
    expect(shouldRefetchBookView(msg("rewrite:complete", { bookId: "beta" }, 1), "alpha")).toBe(false);
  });
});

describe("shouldRefetchBookCollections", () => {
  it("refreshes book lists for create/delete and chapter-changing terminal events", () => {
    expect(shouldRefetchBookCollections(msg("book:created", { bookId: "alpha" }, 1))).toBe(true);
    expect(shouldRefetchBookCollections(msg("book:updated", { bookId: "alpha", title: "Renamed" }, 1))).toBe(true);
    expect(shouldRefetchBookCollections(msg("book:deleted", { bookId: "alpha" }, 1))).toBe(true);
    expect(shouldRefetchBookCollections(msg("write:complete", { bookId: "alpha" }, 1))).toBe(true);
    expect(shouldRefetchBookCollections(msg("draft:cancelled", { bookId: "alpha" }, 1))).toBe(true);
    expect(shouldRefetchBookCollections(msg("draft:error", { bookId: "alpha" }, 1))).toBe(true);
    expect(shouldRefetchBookCollections(msg("rewrite:complete", { bookId: "alpha" }, 1))).toBe(true);
    expect(shouldRefetchBookCollections(msg("audit:start", { bookId: "alpha" }, 1))).toBe(false);
    expect(shouldRefetchBookCollections(undefined)).toBe(false);
  });
});

describe("shouldRefetchBookCreateStatus", () => {
  it("refreshes create-job status lists for background book creation events", () => {
    expect(shouldRefetchBookCreateStatus(msg("book:creating", { bookId: "alpha" }, 1))).toBe(true);
    expect(shouldRefetchBookCreateStatus(msg("book:create:progress", { bookId: "alpha" }, 2))).toBe(true);
    expect(shouldRefetchBookCreateStatus(msg("book:created", { bookId: "alpha" }, 3))).toBe(true);
    expect(shouldRefetchBookCreateStatus(msg("book:error", { bookId: "alpha" }, 4))).toBe(true);
    expect(shouldRefetchBookCreateStatus(msg("write:start", { bookId: "alpha" }, 5))).toBe(false);
  });
});

describe("shouldRefetchDaemonStatus", () => {
  it("refreshes daemon status for daemon terminal events", () => {
    expect(shouldRefetchDaemonStatus(msg("daemon:started", {}, 1))).toBe(true);
    expect(shouldRefetchDaemonStatus(msg("daemon:stopped", {}, 1))).toBe(true);
    expect(shouldRefetchDaemonStatus(msg("daemon:error", {}, 1))).toBe(true);
    expect(shouldRefetchDaemonStatus(msg("daemon:chapter", {}, 1))).toBe(false);
  });
});
