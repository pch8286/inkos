import { describe, expect, it, vi } from "vitest";
import type { TFunction } from "../hooks/use-i18n";
import {
  buildFoundationPreviewTabs,
  buildSetupCreateRequestFingerprint,
  createMessage,
  isBookSetupRevisionMismatchMessage,
  parseSetupSessions,
  toSetupConversation,
} from "./cockpit-shared";

describe("parseSetupSessions", () => {
  it("coerces session summaries and sorts them by the latest timestamp", () => {
    expect(parseSetupSessions({
      entries: [
        {
          id: "session-old",
          revision: "2",
          status: "approved",
          title: "Recovered title",
          genre: "Fantasy",
          language: "en",
          platform: "webnovel",
          chapterWordCount: "1800",
          targetChapters: 150,
          brief: "Older session",
          bookId: "",
          createdAt: "2026-03-01T10:00:00.000Z",
          updatedAt: "2026-03-01T12:00:00.000Z",
        },
        {
          id: "session-new",
          revision: 3,
          status: "creating",
          title: "Latest title",
          genre: "Mystery",
          language: "zh",
          platform: "kindle",
          chapterWordCount: 2200,
          targetChapters: "90",
          brief: "Newest session",
          bookId: "book-42",
          createdAt: "2026-04-01T09:00:00.000Z",
          updatedAt: "",
        },
        {
          id: "",
          title: "ignored",
        },
      ],
    })).toEqual([
      {
        id: "session-new",
        revision: 3,
        status: "creating",
        title: "Latest title",
        genre: "Mystery",
        language: "zh",
        platform: "kindle",
        chapterWordCount: 2200,
        targetChapters: 90,
        brief: "Newest session",
        bookId: "book-42",
        createdAt: "2026-04-01T09:00:00.000Z",
        updatedAt: "",
      },
      {
        id: "session-old",
        revision: 2,
        status: "approved",
        title: "Recovered title",
        genre: "Fantasy",
        language: "en",
        platform: "webnovel",
        chapterWordCount: 1800,
        targetChapters: 150,
        brief: "Older session",
        bookId: "session-old",
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T12:00:00.000Z",
      },
    ]);
  });

  it("falls back to defaults for unsupported status and language values", () => {
    expect(parseSetupSessions([
      {
        id: "session-defaults",
        language: "jp",
        status: "queued",
      },
    ])).toEqual([
      {
        id: "session-defaults",
        revision: 1,
        status: "proposed",
        title: "",
        genre: "",
        language: "ko",
        platform: "",
        chapterWordCount: 0,
        targetChapters: 0,
        brief: "",
        bookId: "session-defaults",
        createdAt: "",
        updatedAt: "",
      },
    ]);
  });
});

describe("buildFoundationPreviewTabs", () => {
  const t: TFunction = ((key) => {
    const labels = new Map([
      ["cockpit.foundationStoryBible", "Story Bible"],
      ["cockpit.foundationVolumeOutline", "Volume Outline"],
      ["cockpit.foundationBookRules", "Book Rules"],
      ["cockpit.foundationCurrentState", "Current State"],
      ["cockpit.foundationPendingHooks", "Pending Hooks"],
    ]);
    return labels.get(String(key)) ?? String(key);
  }) as TFunction;

  it("returns the fixed preview tab order with translated labels", () => {
    expect(buildFoundationPreviewTabs({
      createdAt: "2026-04-01T00:00:00.000Z",
      revision: 7,
      digest: "digest-1",
      storyBible: "Story",
      volumeOutline: "Outline",
      bookRules: "Rules",
      currentState: "State",
      pendingHooks: "Hooks",
    }, t)).toEqual([
      { key: "storyBible", label: "Story Bible", content: "Story" },
      { key: "volumeOutline", label: "Volume Outline", content: "Outline" },
      { key: "bookRules", label: "Book Rules", content: "Rules" },
      { key: "currentState", label: "Current State", content: "State" },
      { key: "pendingHooks", label: "Pending Hooks", content: "Hooks" },
    ]);
  });
});

describe("createMessage", () => {
  it("creates cockpit messages with deterministic timestamps when time is mocked", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T00:00:00.000Z"));

    const message = createMessage("assistant", "Ready");

    expect(message.role).toBe("assistant");
    expect(message.content).toBe("Ready");
    expect(message.createdAt).toBe(new Date("2026-04-16T00:00:00.000Z").getTime());
    expect(message.id).toMatch(/^assistant-1776297600000-[a-z0-9]{6}$/);

    vi.useRealTimers();
  });
});

describe("toSetupConversation", () => {
  it("drops system messages and preserves user and assistant turns", () => {
    expect(toSetupConversation([
      { id: "1", role: "system", content: "internal", createdAt: 1 },
      { id: "2", role: "user", content: "Need a tighter premise", createdAt: 2 },
      { id: "3", role: "assistant", content: "Here is a refinement", createdAt: 3 },
    ])).toEqual([
      { role: "user", content: "Need a tighter premise" },
      { role: "assistant", content: "Here is a refinement" },
    ]);
  });
});

describe("small shared helpers", () => {
  it("detects setup revision mismatch messages", () => {
    expect(isBookSetupRevisionMismatchMessage("The setup changed while you were reviewing it.")).toBe(true);
    expect(isBookSetupRevisionMismatchMessage("A different setup error happened.")).toBe(false);
  });

  it("builds a stable create-request fingerprint", () => {
    expect(buildSetupCreateRequestFingerprint({
      sessionId: "session-1",
      expectedRevision: 4,
      expectedPreviewDigest: "digest-2",
    })).toBe("{\"sessionId\":\"session-1\",\"expectedRevision\":4,\"expectedPreviewDigest\":\"digest-2\"}");
  });
});
