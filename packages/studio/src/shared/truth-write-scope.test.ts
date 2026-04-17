import { describe, expect, it } from "vitest";
import {
  buildTruthAssistRequest,
  buildTruthSaveRequest,
  canWriteTruthFile,
  isTruthProposalApplicable,
} from "./truth-write-scope";

describe("canWriteTruthFile", () => {
  it("blocks writes in read-only scope", () => {
    expect(canWriteTruthFile({ kind: "read-only" }, "book_rules.md")).toBe(false);
  });

  it("allows writes only for the matching file scope", () => {
    expect(canWriteTruthFile({ kind: "file", fileName: "book_rules.md" }, "book_rules.md")).toBe(true);
    expect(canWriteTruthFile({ kind: "file", fileName: "book_rules.md" }, "story_bible.md")).toBe(false);
  });

  it("allows writes for every file inside the matching bundle scope", () => {
    expect(canWriteTruthFile({ kind: "bundle", fileNames: ["author_intent.md", "book_rules.md"] }, "author_intent.md")).toBe(true);
    expect(canWriteTruthFile({ kind: "bundle", fileNames: ["author_intent.md", "book_rules.md"] }, "book_rules.md")).toBe(true);
    expect(canWriteTruthFile({ kind: "bundle", fileNames: ["author_intent.md", "book_rules.md"] }, "story_bible.md")).toBe(false);
  });
});

describe("isTruthProposalApplicable", () => {
  it("only marks matching single-file proposals as applicable", () => {
    expect(isTruthProposalApplicable({ kind: "file", fileName: "book_rules.md" }, "book_rules.md")).toBe(true);
    expect(isTruthProposalApplicable({ kind: "file", fileName: "book_rules.md" }, "story_bible.md")).toBe(false);
    expect(isTruthProposalApplicable({ kind: "read-only" }, "book_rules.md")).toBe(false);
  });

  it("marks bundle proposals as applicable for every file in the bundle", () => {
    expect(isTruthProposalApplicable({ kind: "bundle", fileNames: ["author_intent.md", "book_rules.md"] }, "author_intent.md")).toBe(true);
    expect(isTruthProposalApplicable({ kind: "bundle", fileNames: ["author_intent.md", "book_rules.md"] }, "book_rules.md")).toBe(true);
    expect(isTruthProposalApplicable({ kind: "bundle", fileNames: ["author_intent.md", "book_rules.md"] }, "story_bible.md")).toBe(false);
  });
});

describe("buildTruthAssistRequest", () => {
  it("includes explicit file scope for proposal requests", () => {
    expect(buildTruthAssistRequest({
      fileNames: ["book_rules.md"],
      instruction: "tighten the rules",
      mode: "proposal",
      scope: { kind: "file", fileName: "book_rules.md" },
    })).toEqual({
      fileName: "book_rules.md",
      fileNames: undefined,
      instruction: "tighten the rules",
      mode: "proposal",
      scope: { kind: "file", fileName: "book_rules.md" },
    });
  });

  it("emits a canonical multi-target payload with only fileNames", () => {
    expect(buildTruthAssistRequest({
      fileNames: ["author_intent.md", "book_rules.md", "author_intent.md"],
      instruction: "compare both documents",
      mode: "question",
      scope: { kind: "read-only" },
    })).toEqual({
      fileNames: ["author_intent.md", "book_rules.md"],
      instruction: "compare both documents",
      mode: "question",
      scope: { kind: "read-only" },
    });
  });

  it("rejects proposal requests without explicit file scope", () => {
    expect(() => buildTruthAssistRequest({
      fileNames: ["book_rules.md"],
      instruction: "tighten the rules",
      mode: "proposal",
      scope: { kind: "read-only" },
    })).toThrow("Truth proposal requests require explicit file scope.");
  });

  it("allows proposal requests with an explicit bundle scope", () => {
    expect(buildTruthAssistRequest({
      fileNames: ["author_intent.md", "book_rules.md"],
      instruction: "align both documents",
      mode: "proposal",
      scope: { kind: "bundle", fileNames: ["author_intent.md", "book_rules.md"] },
    })).toEqual({
      fileNames: ["author_intent.md", "book_rules.md"],
      instruction: "align both documents",
      mode: "proposal",
      scope: { kind: "bundle", fileNames: ["author_intent.md", "book_rules.md"] },
    });
  });

  it("rejects proposal bundle scope when the target files do not match", () => {
    expect(() => buildTruthAssistRequest({
      fileNames: ["author_intent.md", "book_rules.md"],
      instruction: "align both documents",
      mode: "proposal",
      scope: { kind: "bundle", fileNames: ["author_intent.md", "story_bible.md"] },
    })).toThrow("Bundle-scoped truth assist requests must target the same files as the scope.");
  });

  it("rejects file-scoped requests whose target does not match the scope", () => {
    expect(() => buildTruthAssistRequest({
      fileNames: ["story_bible.md"],
      instruction: "tighten the rules",
      mode: "question",
      scope: { kind: "file", fileName: "book_rules.md" },
    })).toThrow("File-scoped truth assist requests must target exactly one matching file.");
  });

  it("rejects requests that do not target any file", () => {
    expect(() => buildTruthAssistRequest({
      fileNames: [],
      instruction: "tighten the rules",
      mode: "question",
      scope: { kind: "read-only" },
    })).toThrow("Truth assist requests require at least one target file.");
  });

  it("normalizes file-scoped targets before emitting the payload", () => {
    expect(buildTruthAssistRequest({
      fileNames: [" author_intent.md "],
      instruction: "tighten the intent",
      mode: "proposal",
      scope: { kind: "file", fileName: " author_intent.md " },
    })).toEqual({
      fileName: "author_intent.md",
      instruction: "tighten the intent",
      mode: "proposal",
      scope: { kind: "file", fileName: "author_intent.md" },
    });
  });
});

describe("buildTruthSaveRequest", () => {
  it("keeps the explicit scope on save payloads", () => {
    expect(buildTruthSaveRequest("# rules", { kind: "file", fileName: "book_rules.md" })).toEqual({
      content: "# rules",
      scope: { kind: "file", fileName: "book_rules.md" },
    });
  });

  it("preserves read-only scope without widening it", () => {
    expect(buildTruthSaveRequest("# rules", { kind: "read-only" })).toEqual({
      content: "# rules",
      scope: { kind: "read-only" },
    });
  });

  it("normalizes file scope names before emitting save payloads", () => {
    expect(buildTruthSaveRequest("# rules", { kind: "file", fileName: " book_rules.md " })).toEqual({
      content: "# rules",
      scope: { kind: "file", fileName: "book_rules.md" },
    });
  });

  it("normalizes bundle scope names before emitting save payloads", () => {
    expect(buildTruthSaveRequest("# rules", { kind: "bundle", fileNames: [" author_intent.md ", " book_rules.md "] })).toEqual({
      content: "# rules",
      scope: { kind: "bundle", fileNames: ["author_intent.md", "book_rules.md"] },
    });
  });
});
