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
  });
});
