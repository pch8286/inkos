import { describe, expect, it } from "vitest";
import { inferTruthTargets, resolveTruthTargetsForSubmit, truthThreadKey } from "./truth-assistant";

const files = [
  { name: "author_intent.md", label: "작가 의도", exists: true, path: "story/author_intent.md" },
  { name: "current_focus.md", label: "현재 초점", exists: true, path: "story/current_focus.md" },
  { name: "story_bible.md", label: "스토리 바이블", exists: true, path: "story/story_bible.md" },
  { name: "book_rules.md", label: "작품 규칙", exists: true, path: "story/book_rules.md" },
] as const;

describe("inferTruthTargets", () => {
  it("locks onto the open detail file first", () => {
    expect(inferTruthTargets("이 문서를 더 차갑게 정리해줘", {
      detailFile: "author_intent.md",
      workspaceTargetFile: "current_focus.md",
      files,
    })).toEqual({
      status: "resolved",
      fileNames: ["author_intent.md"],
      reason: "detail-lock",
    });
  });

  it("bundles core files when the instruction clearly asks for the whole binder", () => {
    expect(inferTruthTargets("설정집 전체를 한꺼번에 다듬어줘", {
      detailFile: null,
      workspaceTargetFile: "current_focus.md",
      files,
    })).toEqual({
      status: "resolved",
      fileNames: ["author_intent.md", "current_focus.md", "story_bible.md", "book_rules.md"],
      reason: "bundle",
    });
  });

  it("picks the best matching file from keywords", () => {
    expect(inferTruthTargets("세계관과 세력 설정을 더 명확하게 정리해줘", {
      detailFile: null,
      workspaceTargetFile: "current_focus.md",
      files,
    })).toEqual({
      status: "resolved",
      fileNames: ["story_bible.md"],
      reason: "single",
    });
  });

  it("asks for clarification when the intent is too ambiguous", () => {
    expect(inferTruthTargets("좀 더 좋게 정리해줘", {
      detailFile: null,
      workspaceTargetFile: "",
      files,
    })).toEqual({
      status: "clarify",
      suggestedFileNames: ["author_intent.md", "current_focus.md", "story_bible.md"],
    });
  });

  it("falls back to the workspace target when no stronger clue exists", () => {
    expect(inferTruthTargets("이번 문서를 조금 더 명확하게 다듬어줘", {
      detailFile: null,
      workspaceTargetFile: "current_focus.md",
      files,
    })).toEqual({
      status: "resolved",
      fileNames: ["current_focus.md"],
      reason: "workspace-default",
    });
  });
});

describe("truthThreadKey", () => {
  it("separates detail threads from workspace threads", () => {
    expect(truthThreadKey({
      bookId: "demo",
      mode: "workspace",
      detailFile: null,
    })).toBe("truth:demo:workspace");

    expect(truthThreadKey({
      bookId: "demo",
      mode: "workspace",
      detailFile: "author_intent.md",
    })).toBe("truth:demo:workspace:detail:author_intent.md");
  });
});

describe("resolveTruthTargetsForSubmit", () => {
  it("falls back to the open detail file when the instruction is empty", () => {
    expect(resolveTruthTargetsForSubmit("", {
      detailFile: "author_intent.md",
      workspaceTargetFile: "current_focus.md",
      files,
    })).toEqual({
      status: "resolved",
      fileNames: ["author_intent.md"],
      reason: "detail-lock",
    });
  });

  it("falls back to the workspace target when the instruction is empty", () => {
    expect(resolveTruthTargetsForSubmit("", {
      detailFile: null,
      workspaceTargetFile: "current_focus.md",
      files,
    })).toEqual({
      status: "resolved",
      fileNames: ["current_focus.md"],
      reason: "workspace-default",
    });
  });
});
