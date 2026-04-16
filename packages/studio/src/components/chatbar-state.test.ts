import { describe, expect, it } from "vitest";
import { resolveDirectWriteTarget, resolveTruthAssistScope } from "./ChatBar";

describe("resolveDirectWriteTarget", () => {
  it("prefers the active book when the user is already inside a book flow", () => {
    expect(resolveDirectWriteTarget("beta", [
      { id: "alpha" },
      { id: "beta" },
    ])).toEqual({
      bookId: "beta",
      reason: "active",
    });
  });

  it("falls back to the only book when there is no active context", () => {
    expect(resolveDirectWriteTarget(undefined, [{ id: "solo" }])).toEqual({
      bookId: "solo",
      reason: "single",
    });
  });

  it("reports when there is no available target book", () => {
    expect(resolveDirectWriteTarget(undefined, [])).toEqual({
      bookId: null,
      reason: "missing",
    });
  });

  it("does not guess when multiple books exist without an active context", () => {
    expect(resolveDirectWriteTarget(undefined, [
      { id: "alpha" },
      { id: "beta" },
    ])).toEqual({
      bookId: null,
      reason: "ambiguous",
    });
  });
});

describe("resolveTruthAssistScope", () => {
  it("keeps matching file scope for single-file proposals", () => {
    expect(resolveTruthAssistScope(
      { writeScope: { kind: "file", fileName: "author_intent.md" } },
      ["author_intent.md"],
      "proposal",
    )).toEqual({ kind: "file", fileName: "author_intent.md" });
  });

  it("falls back to read-only for proposal mode without an armed file scope", () => {
    expect(resolveTruthAssistScope(
      { writeScope: { kind: "read-only" } },
      ["author_intent.md"],
      "proposal",
    )).toEqual({ kind: "read-only" });
  });

  it("falls back to read-only for bundled proposal targets", () => {
    expect(resolveTruthAssistScope(
      { writeScope: { kind: "file", fileName: "author_intent.md" } },
      ["author_intent.md", "book_rules.md"],
      "proposal",
    )).toEqual({ kind: "read-only" });
  });

  it("keeps question mode usable in read-only scope", () => {
    expect(resolveTruthAssistScope(
      { writeScope: { kind: "read-only" } },
      ["author_intent.md"],
      "question",
    )).toEqual({ kind: "read-only" });
  });
});
