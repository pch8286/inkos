import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ChapterRejectDialog,
  summarizeChapterRejectionInstructions,
  toggleChapterRejectionInstruction,
  validateChapterRejectDraft,
} from "./ChapterRejectDialog";

describe("ChapterRejectDialog helpers", () => {
  it("summarizes selected rejection instructions in Korean", () => {
    expect(summarizeChapterRejectionInstructions("ko", ["polish", "tone-adjust"])).toBe("부분 윤문 + 톤/문체 조정");
  });

  it("keeps strong rewrite instructions exclusive", () => {
    expect(toggleChapterRejectionInstruction(["polish", "tone-adjust"], "full-rewrite")).toEqual(["full-rewrite"]);
    expect(toggleChapterRejectionInstruction(["full-rewrite"], "polish")).toEqual(["polish"]);
  });

  it("requires an editor note and at least one instruction", () => {
    expect(validateChapterRejectDraft("ko", "   ", [])).toBe("의견서를 입력해야 반려할 수 있습니다.");
    expect(validateChapterRejectDraft("ko", "수정 의견", [])).toBe("최소 한 개의 수정 지시를 선택하세요.");
    expect(validateChapterRejectDraft("ko", "수정 의견", ["polish"])).toBeNull();
  });
});

describe("ChapterRejectDialog", () => {
  it("renders the editor note form and summary", () => {
    const html = renderToStaticMarkup(
      createElement(ChapterRejectDialog, {
        open: true,
        language: "ko",
        chapterLabel: "1화",
        editorNote: "장면 호흡을 다듬어 주세요.",
        instructions: ["polish", "tone-adjust"],
        submittingMode: null,
        error: null,
        onClose: vi.fn(),
        onEditorNoteChange: vi.fn(),
        onToggleInstruction: vi.fn(),
        onSubmit: vi.fn(),
      }),
    );

    expect(html).toContain("반려 및 재작업 지시");
    expect(html).toContain("의견서");
    expect(html).toContain("왜 반려하는지, 무엇을 고쳐야 하는지 구체적으로 적어 주세요.");
    expect(html).toContain("부분 윤문 + 톤/문체 조정");
    expect(html).toContain("즉시 시작");
  });

  it("shows an explicit loading indicator for the active rejection action", () => {
    const html = renderToStaticMarkup(
      createElement(ChapterRejectDialog, {
        open: true,
        language: "ko",
        chapterLabel: "1화",
        editorNote: "장면 호흡을 다듬어 주세요.",
        instructions: ["polish", "tone-adjust"],
        submittingMode: "start-now",
        error: null,
        onClose: vi.fn(),
        onEditorNoteChange: vi.fn(),
        onToggleInstruction: vi.fn(),
        onSubmit: vi.fn(),
      }),
    );

    expect(html).toContain("시작 중...");
    expect(html).toContain("animate-spin");
  });
});
