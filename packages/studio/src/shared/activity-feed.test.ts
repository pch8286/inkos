import { describe, expect, it } from "vitest";
import { buildActivityFeedEntries } from "./activity-feed";

describe("activity feed helpers", () => {
  it("formats recent events with useful detail strings", () => {
    const entries = buildActivityFeedEntries([
      { event: "ping", data: null, timestamp: 1 },
      { event: "radar:start", data: { startedAt: "2026-04-09T00:00:00.000Z" }, timestamp: 2 },
      { event: "radar:progress", data: { elapsedMs: 2500, totalChars: 1200 }, timestamp: 3 },
      { event: "log", data: { tag: "studio", message: "scan queued" }, timestamp: 4 },
    ], { includeProgress: true });

    expect(entries.map((entry) => entry.event)).toEqual(["log", "radar:progress", "radar:start"]);
    expect(entries[0].detail).toContain("scan queued");
    expect(entries[1].detail).toContain("chars");
  });

  it("keeps the newest activity first regardless of source ordering", () => {
    const ascending = buildActivityFeedEntries([
      { event: "write:start", data: { bookId: "alpha" }, timestamp: 10 },
      { event: "write:complete", data: { bookId: "alpha" }, timestamp: 20 },
      { event: "audit:complete", data: { bookId: "alpha" }, timestamp: 30 },
    ]);

    const descending = buildActivityFeedEntries([
      { event: "audit:complete", data: { bookId: "alpha" }, timestamp: 30 },
      { event: "write:complete", data: { bookId: "alpha" }, timestamp: 20 },
      { event: "write:start", data: { bookId: "alpha" }, timestamp: 10 },
    ]);

    expect(ascending.map((entry) => entry.timestamp)).toEqual([30, 20, 10]);
    expect(descending.map((entry) => entry.timestamp)).toEqual([30, 20, 10]);
  });
});
