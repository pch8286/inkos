import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TFunction } from "../hooks/use-i18n";
import type { BookDetailPayload } from "../shared/contracts";
import { BookDetail } from "./BookDetail";

const useApiMock = vi.fn();
const fetchJsonMock = vi.fn();
const postApiMock = vi.fn();

vi.mock("../hooks/use-api", () => ({
  useApi: (...args: ReadonlyArray<unknown>) => useApiMock(...args),
  fetchJson: (...args: ReadonlyArray<unknown>) => fetchJsonMock(...args),
  postApi: (...args: ReadonlyArray<unknown>) => postApiMock(...args),
}));

const t = ((key: string) => key) as TFunction;

const nav = {
  toDashboard: vi.fn(),
  toChapter: vi.fn(),
  toAnalytics: vi.fn(),
};

const sampleData: BookDetailPayload = {
  book: {
    id: "gate-book",
    title: "Gate Book",
    status: "active",
    platform: "munpia",
    genre: "modern-fantasy",
    targetChapters: 40,
    chapters: 1,
    chapterCount: 1,
    lastChapterNumber: 1,
    totalWords: 1200,
    approvedChapters: 0,
    pendingReview: 1,
    pendingReviewChapters: 1,
    failedReview: 0,
    failedChapters: 0,
    updatedAt: "2026-04-18T00:00:00.000Z",
    createdAt: "2026-04-18T00:00:00.000Z",
    chapterWordCount: 2400,
    language: "ko",
  },
  chapters: [
    {
      number: 1,
      title: "입궁",
      status: "ready-for-review",
      wordCount: 1200,
      auditIssueCount: 1,
      updatedAt: "2026-04-18T00:00:00.000Z",
      fileName: "0001_gate.md",
      rejection: {
        editorNote: "장면 호흡을 다듬고 톤을 정리해 주세요.",
        instructions: ["polish", "tone-adjust"],
        executionMode: "save-only",
        requestedAt: "2026-04-18T00:00:00.000Z",
        lastRunStatus: "idle",
        derivedMode: "spot-fix",
      },
      structuralGate: {
        chapterNumber: 1,
        finalBlockingStatus: "passed",
        summary: "soft only",
        reviserInvoked: false,
        criticalFindings: [],
        softFindings: [
          {
            severity: "soft",
            code: "clarity-gap",
            message: "Scene geography is vague.",
            evidence: "The doorway position is unclear.",
            location: "scene break",
          },
        ],
      },
    },
  ],
  nextChapter: 2,
  pendingStructuralGate: {
    chapterNumber: 2,
    finalBlockingStatus: "blocked",
    summary: "still missing foundation",
    reviserInvoked: true,
    criticalFindings: [
      {
        severity: "critical",
        code: "missing-foundation",
        message: "Opening contract is still missing.",
        location: "opening",
      },
    ],
    softFindings: [],
  },
  activeRun: null,
};

describe("BookDetail", () => {
  beforeEach(() => {
    useApiMock.mockReset();
    fetchJsonMock.mockReset();
    postApiMock.mockReset();
    nav.toDashboard.mockReset();
    nav.toChapter.mockReset();
    nav.toAnalytics.mockReset();
  });

  it("renders pending blocked structural gate status and chapter soft findings", () => {
    useApiMock.mockReturnValue({
      data: sampleData,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderToStaticMarkup(
      createElement(BookDetail, {
        bookId: "gate-book",
        nav,
        theme: "light",
        t,
        sse: { messages: [] },
      }),
    );

    expect(html).toContain("구조 게이트 차단: 2화");
    expect(html).toContain("still missing foundation");
    expect(html).toContain("Opening contract is still missing.");
    expect(html).toContain("구조 게이트: Scene geography is vague.");
    expect(html).toContain("반려됨 · 재작업 대기");
    expect(html).toContain("부분 윤문 + 톤/문체 조정");
  });

  it("renders a live rework banner when revise activity is running for a rejected chapter", () => {
    useApiMock.mockReturnValue({
      data: sampleData,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderToStaticMarkup(
      createElement(BookDetail, {
        bookId: "gate-book",
        nav,
        theme: "light",
        t,
        sse: {
          messages: [
            { event: "revise:start", data: { bookId: "gate-book", chapter: 1 }, timestamp: 1 },
            { event: "log", data: { message: "Applying targeted fixes" }, timestamp: 2 },
            { event: "llm:progress", data: { elapsedMs: 1800, totalChars: 640 }, timestamp: 3 },
          ],
        },
      }),
    );

    expect(html).toContain("재작업 진행 중");
    expect(html).toContain("1화");
    expect(html).toContain("부분 윤문 + 톤/문체 조정");
    expect(html).toContain("Applying targeted fixes");
  });

  it("disables top-level mutating actions while rework is running", () => {
    useApiMock.mockReturnValue({
      data: sampleData,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderToStaticMarkup(
      createElement(BookDetail, {
        bookId: "gate-book",
        nav,
        theme: "light",
        t,
        sse: {
          messages: [
            { event: "rewrite:start", data: { bookId: "gate-book", chapter: 1 }, timestamp: 1 },
          ],
        },
      }),
    );

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*book\.writeNext/s);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*book\.draftOnly/s);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*book\.deleteBook/s);
  });

  it("renders a live banner from persisted active run state after refresh", () => {
    useApiMock.mockReturnValue({
      data: {
        ...sampleData,
        activeRun: {
          id: "run-1",
          bookId: "gate-book",
          chapter: null,
          chapterNumber: null,
          action: "draft",
          status: "running",
          stage: "Generating draft",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:03.000Z",
          startedAt: "2026-04-20T00:00:01.000Z",
          finishedAt: null,
          logs: [
            {
              timestamp: "2026-04-20T00:00:03.000Z",
              level: "info",
              message: "Preparing chapter context",
            },
          ],
          elapsedMs: 5400,
          totalChars: 2048,
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderToStaticMarkup(
      createElement(BookDetail, {
        bookId: "gate-book",
        nav,
        theme: "light",
        t,
        sse: { messages: [] },
      }),
    );

    expect(html).toContain("LIVE");
    expect(html).toContain("book.drafting");
    expect(html).toContain("Preparing chapter context");
    expect(html).toContain("radar.progressElapsed");
    expect(html).toContain("5.4s");
    expect(html).toContain("radar.progressChars");
    expect(html).toContain("2,048");
  });
});
