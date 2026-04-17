import { describe, expect, it } from "vitest";
import {
  appendQueuedComposerEntry,
  popLastQueuedComposerEntry,
  shiftNextQueuedComposerEntry,
} from "./cockpit-queue-state";

describe("cockpit queue state", () => {
  it("keeps independent FIFO queues per thread", () => {
    const withFirst = appendQueuedComposerEntry({}, {
      threadKey: "book-1:discuss",
      action: "discuss",
      text: "first",
      now: 1,
    });
    const withSecond = appendQueuedComposerEntry(withFirst, {
      threadKey: "book-1:discuss",
      action: "discuss",
      text: "second",
      now: 2,
    });
    const withOtherThread = appendQueuedComposerEntry(withSecond, {
      threadKey: "book-2:draft",
      action: "draft",
      text: "draft later",
      now: 3,
    });

    expect(shiftNextQueuedComposerEntry(withOtherThread, "book-1:discuss")).toEqual({
      entry: {
        id: "book-1:discuss:1",
        action: "discuss",
        text: "first",
        createdAt: 1,
      },
      state: {
        "book-1:discuss": [
          {
            id: "book-1:discuss:2",
            action: "discuss",
            text: "second",
            createdAt: 2,
          },
        ],
        "book-2:draft": [
          {
            id: "book-2:draft:3",
            action: "draft",
            text: "draft later",
            createdAt: 3,
          },
        ],
      },
    });
  });

  it("restores the newest queued item when editing", () => {
    const state = appendQueuedComposerEntry(
      appendQueuedComposerEntry({}, {
        threadKey: "book-1:draft",
        action: "draft",
        text: "one",
        now: 1,
      }),
      {
        threadKey: "book-1:draft",
        action: "draft",
        text: "two",
        now: 2,
      },
    );

    expect(popLastQueuedComposerEntry(state, "book-1:draft")).toEqual({
      entry: {
        id: "book-1:draft:2",
        action: "draft",
        text: "two",
        createdAt: 2,
      },
      state: {
        "book-1:draft": [
          {
            id: "book-1:draft:1",
            action: "draft",
            text: "one",
            createdAt: 1,
          },
        ],
      },
    });
  });
});
