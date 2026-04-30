/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BookCreate } from "./BookCreate";
import type { TFunction } from "../hooks/use-i18n";

const t: TFunction = ((key: string) => {
  const strings: Record<string, string> = {
    "bread.books": "Books",
    "bread.legacyCreate": "Legacy Create",
    "create.legacyTitle": "Advanced Legacy Create",
    "create.bookTitle": "Title",
    "create.placeholder": "Book title...",
    "create.genre": "Genre",
    "create.platform": "Platform",
    "create.wordsPerChapter": "Words / Chapter",
    "create.targetChapters": "Target Chapters",
    "create.creating": "Creating...",
    "create.creatingHint": "Preparing the foundation and control documents.",
    "create.backgroundHint": "Creation continues even if you leave this page.",
    "create.legacySubmit": "Create via legacy flow",
    "create.titleRequired": "Title is required",
    "create.genreRequired": "Genre is required",
  };
  return strings[key] ?? key;
}) as TFunction;

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("BookCreate mounted legacy flow", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the legacy create page waiting past the default polling budget and navigates when the book is readable", async () => {
    let bookAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const path = new URL(url, "http://localhost").pathname;

      if (path === "/api/genres") {
        return jsonResponse({
          genres: [
            {
              id: "modern-fantasy",
              name: "Modern Fantasy",
              source: "builtin",
              language: "ko",
            },
          ],
        });
      }

      if (path === "/api/project") {
        return jsonResponse({ language: "ko" });
      }

      if (path === "/api/books/create" && init?.method === "POST") {
        return jsonResponse({ bookId: "legacy-slow-book" });
      }

      if (path === "/api/books/legacy-slow-book/create-status") {
        return jsonResponse({
          status: "creating",
          stage: "기초 설정 생성",
          message: "기초 설정 초안을 검토 중입니다.",
          history: [
            {
              timestamp: "2026-04-30T00:00:00.000Z",
              kind: "stage",
              label: "기초 설정 생성",
              detail: "기초 설정 초안을 검토 중입니다.",
            },
          ],
        });
      }

      if (path === "/api/books/legacy-slow-book") {
        bookAttempts += 1;
        if (bookAttempts <= 121) {
          return jsonResponse({ error: "Book not found" }, { status: 404, statusText: "Not Found" });
        }
        return jsonResponse({
          book: {
            id: "legacy-slow-book",
            title: "Legacy Slow Book",
          },
          chapters: [],
          nextChapter: 1,
        });
      }

      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const nav = {
      toDashboard: vi.fn(),
      toBook: vi.fn(),
    };

    render(React.createElement(BookCreate, { nav, theme: "light", t }));

    await screen.findByRole("button", { name: "Modern Fantasy" });
    fireEvent.change(screen.getByPlaceholderText("Book title..."), {
      target: { value: "Legacy Slow Book" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Modern Fantasy" }));

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Create via legacy flow" }));

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(screen.getByText('"legacy-slow-book"')).toBeTruthy();
    expect(screen.getAllByText("기초 설정 생성").length).toBeGreaterThan(0);

    for (let i = 0; i < 122; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
    }

    expect(nav.toBook).toHaveBeenCalledWith("legacy-slow-book");
    expect(screen.queryByText('Book "legacy-slow-book" is still being created. Wait a moment and refresh.')).toBeNull();
    expect(bookAttempts).toBeGreaterThan(121);
  });
});
