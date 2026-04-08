import { describe, expect, it } from "vitest";
import { deriveActiveBookId, deriveActiveLlm } from "./App";

describe("deriveActiveBookId", () => {
  it("returns the current book across book-centered routes", () => {
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
