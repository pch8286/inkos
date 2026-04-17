import { describe, expect, it } from "vitest";
import {
  getComposerQueueShortcut,
  summarizeQueuedComposerEntries,
} from "./CockpitMainConversation";

describe("getComposerQueueShortcut", () => {
  it("queues the composer value on plain Enter", () => {
    expect(getComposerQueueShortcut({
      busy: false,
      input: "next request",
      key: "Enter",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toBe("queue");
  });

  it("uses Tab as a queue shortcut only when the composer has text", () => {
    expect(getComposerQueueShortcut({
      busy: false,
      input: "queued",
      key: "Tab",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toBe("queue");

    expect(getComposerQueueShortcut({
      busy: false,
      input: "   ",
      key: "Tab",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toBeNull();
  });

  it("restores the latest queued item on Shift+ArrowLeft and Alt+ArrowLeft", () => {
    expect(getComposerQueueShortcut({
      busy: false,
      input: "",
      key: "ArrowLeft",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
    })).toBe("restore");

    expect(getComposerQueueShortcut({
      busy: false,
      input: "",
      key: "ArrowLeft",
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toBe("restore");
  });
});

describe("summarizeQueuedComposerEntries", () => {
  it("shows the latest queued items first and trims to three", () => {
    expect(summarizeQueuedComposerEntries([
      { id: "q1", action: "discuss", text: "one", createdAt: 1 },
      { id: "q2", action: "ask", text: "two", createdAt: 2 },
      { id: "q3", action: "draft", text: "three", createdAt: 3 },
      { id: "q4", action: "write-next", text: "four", createdAt: 4 },
    ])).toEqual([
      { id: "q4", action: "write-next", text: "four", createdAt: 4 },
      { id: "q3", action: "draft", text: "three", createdAt: 3 },
      { id: "q2", action: "ask", text: "two", createdAt: 2 },
    ]);
  });
});
