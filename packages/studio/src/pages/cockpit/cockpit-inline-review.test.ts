import { describe, expect, it } from "vitest";
import {
  buildInlineReviewQuote,
  formatInlineReviewRange,
  normalizeInlineReviewRange,
  splitInlineReviewLines,
  summarizeInlineReviewThreads,
  type InlineReviewThread,
} from "./cockpit-inline-review";

function makeThread(overrides: Partial<InlineReviewThread> = {}): InlineReviewThread {
  return {
    id: overrides.id ?? "thread-1",
    targetId: overrides.targetId ?? "proposal",
    targetLabel: overrides.targetLabel ?? "Setup Proposal",
    startLine: overrides.startLine ?? 1,
    endLine: overrides.endLine ?? 1,
    decision: overrides.decision ?? "comment",
    status: overrides.status ?? "open",
    note: overrides.note ?? "note",
    quote: overrides.quote ?? "quote",
    createdAt: overrides.createdAt ?? "2026-04-17T00:00:00.000Z",
    resolvedAt: overrides.resolvedAt ?? null,
  };
}

describe("cockpit inline review helpers", () => {
  it("normalizes review ranges within the available line count", () => {
    expect(normalizeInlineReviewRange(9, 2, 6)).toEqual({ startLine: 2, endLine: 6 });
    expect(normalizeInlineReviewRange(-3, -1, 4)).toEqual({ startLine: 1, endLine: 1 });
  });

  it("preserves blank lines when splitting content for review", () => {
    expect(splitInlineReviewLines("first\n\nthird")).toEqual(["first", "", "third"]);
  });

  it("builds quotes from the selected line range", () => {
    const lines = splitInlineReviewLines("alpha\nbeta\ngamma");
    expect(buildInlineReviewQuote(lines, 2, 3)).toBe("beta\ngamma");
  });

  it("summarizes mixed approval states per target", () => {
    const threads = [
      makeThread({ id: "a", decision: "approve" }),
      makeThread({ id: "b", decision: "request-change" }),
      makeThread({ id: "c", decision: "comment", targetId: "foundation:storyBible" }),
    ];

    expect(summarizeInlineReviewThreads(threads, "proposal")).toEqual({
      approvalCount: 1,
      requestChangeCount: 1,
      commentCount: 0,
      totalCount: 2,
      status: "mixed",
    });
    expect(summarizeInlineReviewThreads(threads, "foundation:storyBible").status).toBe("commented");
  });

  it("ignores resolved threads in the active summary", () => {
    const threads = [
      makeThread({ id: "a", decision: "request-change", status: "resolved", resolvedAt: "2026-04-17T00:00:03.000Z" }),
      makeThread({ id: "b", decision: "comment" }),
    ];

    expect(summarizeInlineReviewThreads(threads, "proposal")).toEqual({
      approvalCount: 0,
      requestChangeCount: 0,
      commentCount: 1,
      totalCount: 2,
      status: "commented",
    });
  });

  it("formats single-line and range labels", () => {
    expect(formatInlineReviewRange(4, 4)).toBe("L4");
    expect(formatInlineReviewRange(4, 7)).toBe("L4-7");
  });
});
