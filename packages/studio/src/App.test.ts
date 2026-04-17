import { describe, expect, it } from "vitest";
import {
  buildLegacyCockpitRedirectUrl,
  buildRouteSearch,
  clampAssistantPaneWidth,
  deriveActiveBookId,
  deriveActiveLlm,
  deriveLatestAlertTimestamp,
  deriveUnreadAlertCount,
  parseRouteFromSearch,
  resolveAssistantPaneWidths,
} from "./App";

describe("route search helpers", () => {
  it("parses cockpit route without a selected book", () => {
    expect(parseRouteFromSearch("?page=cockpit")).toEqual({ page: "cockpit" });
  });

  it("parses cockpit route with a selected book", () => {
    expect(parseRouteFromSearch("?page=cockpit&bookId=alpha")).toEqual({
      page: "cockpit",
      bookId: "alpha",
    });
  });

  it("serializes cockpit routes into query strings", () => {
    expect(buildRouteSearch({ page: "cockpit", bookId: "alpha" })).toBe("?page=cockpit&bookId=alpha");
    expect(buildRouteSearch({ page: "dashboard" })).toBe("");
  });
});

describe("legacy cockpit redirect", () => {
  it("builds a standalone cockpit redirect for the legacy cockpit route", () => {
    expect(buildLegacyCockpitRedirectUrl("/", { page: "cockpit", bookId: "alpha" }))
      .toBe("/cockpit/?bookId=alpha");
  });

  it("returns null for normal studio routes", () => {
    expect(buildLegacyCockpitRedirectUrl("/tenant-a/", { page: "dashboard" })).toBeNull();
  });
});

describe("deriveActiveBookId", () => {
  it("returns the current book across book-centered routes", () => {
    expect(deriveActiveBookId({ page: "cockpit", bookId: "alpha" })).toBe("alpha");
    expect(deriveActiveBookId({ page: "book", bookId: "alpha" })).toBe("alpha");
    expect(deriveActiveBookId({ page: "chapter", bookId: "beta", chapterNumber: 3 })).toBe("beta");
    expect(deriveActiveBookId({ page: "truth", bookId: "gamma" })).toBe("gamma");
    expect(deriveActiveBookId({ page: "analytics", bookId: "delta" })).toBe("delta");
  });

  it("returns undefined for non-book routes", () => {
    expect(deriveActiveBookId({ page: "dashboard" })).toBeUndefined();
    expect(deriveActiveBookId({ page: "config" })).toBeUndefined();
    expect(deriveActiveBookId({ page: "style" })).toBeUndefined();
  });
});

describe("deriveActiveLlm", () => {
  it("prefers the initialized project's active provider/model", () => {
    expect(deriveActiveLlm(
      {
        root: "/tmp/demo",
        suggestedProjectName: "demo",
        projectInitialized: true,
        globalConfig: {
          exists: true,
          language: "ko",
          provider: "gemini-cli",
          model: "gemini-2.5-pro",
          baseUrl: "",
          apiKeySet: false,
          auth: {
            geminiCli: { available: true, authenticated: true, credentialPath: "~/.gemini", command: "gemini" },
            codexCli: { available: true, authenticated: true, credentialPath: "~/.codex", command: "codex" },
          },
        },
      },
      { language: "ko", languageExplicit: true, provider: "codex-cli", model: "gpt-5.4", baseUrl: "" },
    )).toEqual({
      provider: "codex-cli",
      model: "gpt-5.4",
      source: "project",
    });
  });

  it("falls back to global defaults before project initialization", () => {
    expect(deriveActiveLlm(
      {
        root: "/tmp/demo",
        suggestedProjectName: "demo",
        projectInitialized: false,
        globalConfig: {
          exists: true,
          language: "ko",
          provider: "gemini-cli",
          model: "auto-gemini-3",
          baseUrl: "",
          apiKeySet: false,
          auth: {
            geminiCli: { available: true, authenticated: true, credentialPath: "~/.gemini", command: "gemini" },
            codexCli: { available: true, authenticated: true, credentialPath: "~/.codex", command: "codex" },
          },
        },
      },
      undefined,
    )).toEqual({
      provider: "gemini-cli",
      model: "auto-gemini-3",
      source: "global",
    });
  });
});

describe("header alerts", () => {
  it("counts unread actionable SSE events and ignores ping/progress noise", () => {
    const messages = [
      { event: "ping", data: null, timestamp: 100 },
      { event: "log", data: { message: "noise" }, timestamp: 105 },
      { event: "llm:progress", data: { phase: "write" }, timestamp: 110 },
      { event: "write:start", data: { bookId: "alpha" }, timestamp: 120 },
      { event: "write:complete", data: { bookId: "alpha" }, timestamp: 140 },
    ];

    expect(deriveUnreadAlertCount(messages, 0)).toBe(2);
    expect(deriveUnreadAlertCount(messages, 125)).toBe(1);
  });

  it("tracks the latest actionable event timestamp", () => {
    const messages = [
      { event: "ping", data: null, timestamp: 100 },
      { event: "log", data: { message: "Started" }, timestamp: 155 },
      { event: "llm:progress", data: { phase: "audit" }, timestamp: 180 },
      { event: "audit:complete", data: { bookId: "alpha" }, timestamp: 210 },
    ];

    expect(deriveLatestAlertTimestamp(messages)).toBe(210);
  });
});

describe("assistant pane sizing", () => {
  it("clamps pane widths by mode and viewport", () => {
    expect(clampAssistantPaneWidth(200, { viewportWidth: 1440 })).toBe(320);
    expect(clampAssistantPaneWidth(900, { viewportWidth: 1440 })).toBe(560);
    expect(clampAssistantPaneWidth(900, { truthMode: true, viewportWidth: 1440 })).toBe(760);
    expect(clampAssistantPaneWidth(900, { truthMode: true, viewportWidth: 700 })).toBe(652);
  });

  it("fills missing stored widths with defaults", () => {
    expect(resolveAssistantPaneWidths({ general: 430 }, 1440)).toEqual({
      general: 430,
      truth: 540,
    });
  });
});
