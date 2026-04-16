import { describe, expect, it } from "vitest";
import { type TFunction } from "../hooks/use-i18n";
import {
  buildConversationTranscript,
  defaultActionForMode,
  extractWordCount,
  formatReasoningEffortLabel,
  parseComposerCommand,
  renderChapterStatus,
  summarizeProposal,
} from "./cockpit-parsing";

describe("parseComposerCommand", () => {
  it("parses /write-next payloads", () => {
    expect(parseComposerCommand("/write-next 3200 words")).toEqual({
      action: "write-next",
      text: "3200 words",
    });
  });

  it("handles /write alias", () => {
    expect(parseComposerCommand("/write 500 words")).toEqual({
      action: "write-next",
      text: "500 words",
    });
  });

  it("trims whitespace around input", () => {
    expect(parseComposerCommand("   /draft  600 words  ")).toEqual({
      action: "draft",
      text: "600 words",
    });
  });

  it("supports case-insensitive matching", () => {
    expect(parseComposerCommand("/ProPoSe tighten this scene")).toEqual({
      action: "propose",
      text: "tighten this scene",
    });
  });

  it("returns null for unknown commands", () => {
    expect(parseComposerCommand("/unknown hello")).toBeNull();
  });
});

describe("defaultActionForMode", () => {
  it("maps binder mode to ask", () => {
    expect(defaultActionForMode("binder")).toBe("ask");
  });

  it("maps draft mode to draft", () => {
    expect(defaultActionForMode("draft")).toBe("draft");
  });

  it("maps discuss mode to discuss", () => {
    expect(defaultActionForMode("discuss")).toBe("discuss");
  });
});

describe("buildConversationTranscript", () => {
  it("keeps the latest eight messages with readable role labels", () => {
    const transcript = buildConversationTranscript([
      { role: "user", content: "First" },
      { role: "assistant", content: "Reply 1" },
      { role: "system", content: "System note" },
      { role: "user", content: "Second" },
      { role: "assistant", content: "Reply 2" },
      { role: "assistant", content: "Reply 3" },
      { role: "user", content: "Third" },
      { role: "assistant", content: "Reply 4" },
      { role: "user", content: "Fourth" },
    ]);

    expect(transcript).toBe([
      "Assistant: Reply 1",
      "System: System note",
      "User: Second",
      "Assistant: Reply 2",
      "Assistant: Reply 3",
      "User: Third",
      "Assistant: Reply 4",
      "User: Fourth",
    ].join("\n"));
  });
});

describe("summarizeProposal", () => {
  it("combines labels with content previews and separates entries", () => {
    expect(
      summarizeProposal([
        { label: "Chapter outline", content: "First paragraph of a long proposal section." },
        { label: "Mood pass", content: "Adjust tone and pacing." },
      ]),
    ).toBe("Chapter outline\nFirst paragraph of a long proposal section.\n\nMood pass\nAdjust tone and pacing.");
  });
});

describe("extractWordCount", () => {
  it("extracts embedded 3-5 digit word counts", () => {
    expect(extractWordCount("Please write 2500 words", 3200)).toBe(2500);
    expect(extractWordCount("No numeric target", 1800)).toBe(1800);
    expect(extractWordCount("tiny 99", 1200)).toBe(1200);
  });
});

describe("renderChapterStatus", () => {
  it("maps known statuses and keeps unknown statuses unchanged", () => {
    expect(renderChapterStatus("approved")).toBe("approved");
    expect(renderChapterStatus("drafted")).toBe("drafted");
    expect(renderChapterStatus("in-review")).toBe("in-review");
  });
});

describe("formatReasoningEffortLabel", () => {
  const t: TFunction = ((key) => {
    const map = new Map([
      ["config.reasoningNone", "No reasoning"],
      ["config.reasoningMinimal", "Minimal"],
      ["config.reasoningLow", "Low"],
      ["config.reasoningMedium", "Medium"],
      ["config.reasoningHigh", "High"],
      ["config.reasoningXHigh", "Extreme"],
    ]);
    return map.get(key as string) ?? String(key);
  }) as TFunction;

  it("maps known reasoning labels through t()", () => {
    expect(formatReasoningEffortLabel("xhigh", t)).toBe("Extreme");
    expect(formatReasoningEffortLabel("unknown", t)).toBe("unknown");
  });
});
