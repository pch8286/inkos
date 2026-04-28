import { describe, expect, it, vi } from "vitest";
import { runChapterReviewCycle } from "../pipeline/chapter-review-cycle.js";
import type { AuditResult, AuditIssue } from "../agents/continuity.js";
import type { LengthSpec } from "../models/length-governance.js";

const LENGTH_SPEC: LengthSpec = {
  target: 220,
  softMin: 190,
  softMax: 250,
  hardMin: 160,
  hardMax: 280,
  countingMode: "zh_chars",
  normalizeMode: "none",
};

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

const CLEAN_STRUCTURAL_GATE = {
  passed: true,
  summary: "clean",
  criticalFindings: [],
  softFindings: [],
} as const;

function createAuditResult(overrides?: Partial<AuditResult>): AuditResult {
  return {
    passed: true,
    issues: [],
    summary: "clean",
    ...overrides,
  };
}

describe("runChapterReviewCycle", () => {
  it("applies post-write spot-fix before the first audit pass", async () => {
    const auditChapter = vi.fn()
      .mockResolvedValue(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "fixed draft",
      wordCount: 10,
      fixedIssues: ["fixed"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValue({
        content: "fixed draft",
        wordCount: 10,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });

    const result = await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: {
        title: "Test Chapter",
        content: "raw draft",
        wordCount: 9,
        postWriteErrors: [{
          rule: "paragraph-shape",
          description: "too fragmented",
          suggestion: "merge short fragments",
          severity: "error",
        }],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      structuralGate: { evaluateStructuralGate: vi.fn().mockResolvedValue(CLEAN_STRUCTURAL_GATE) },
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(auditChapter).toHaveBeenCalledTimes(1);
    expect(auditChapter).toHaveBeenCalledWith(
      "/tmp/book",
      "fixed draft",
      1,
      "xuanhuan",
      undefined,
    );
    expect(result.finalContent).toBe("fixed draft");
    expect(result.revised).toBe(true);
  });

  it("drops auto-revision when it increases AI tells and re-audits the original draft", async () => {
    const failingAudit = createAuditResult({
      passed: false,
      issues: [{
        severity: "critical",
        category: "continuity",
        description: "broken continuity",
        suggestion: "fix it",
      }],
      summary: "bad",
    });
    const auditChapter = vi.fn()
      .mockResolvedValueOnce(failingAudit)
      .mockResolvedValueOnce(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "rewritten draft",
      wordCount: 15,
      fixedIssues: ["fixed"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValueOnce({
        content: "original draft",
        wordCount: 13,
        applied: false,
        tokenUsage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "rewritten draft",
        wordCount: 15,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });
    const analyzeAITells = vi.fn((content: string) => ({
      issues: content === "rewritten draft"
        ? [{ severity: "warning", category: "ai", description: "more ai", suggestion: "reduce" } satisfies AuditIssue]
        : [],
    }));

    const result = await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: {
        title: "Test Chapter",
        content: "original draft",
        wordCount: 13,
        postWriteErrors: [],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      structuralGate: { evaluateStructuralGate: vi.fn().mockResolvedValue(CLEAN_STRUCTURAL_GATE) },
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells,
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(auditChapter).toHaveBeenNthCalledWith(1, "/tmp/book", "original draft", 1, "xuanhuan", undefined);
    expect(auditChapter).toHaveBeenNthCalledWith(2, "/tmp/book", "original draft", 1, "xuanhuan", { temperature: 0 });
    expect(result.finalContent).toBe("original draft");
    expect(result.revised).toBe(false);
  });

  it("runs one bounded spot-fix pass for selected style warnings", async () => {
    const warningAudit = createAuditResult({
      passed: true,
      issues: [{
        severity: "warning",
        category: "문체 검사",
        description: "핵심 감정 변화가 요약으로만 처리됩니다.",
        suggestion: "행동과 말투 변화로 먼저 드러내세요.",
      }],
    });
    const auditChapter = vi.fn()
      .mockResolvedValueOnce(warningAudit)
      .mockResolvedValueOnce(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "scene-strengthened draft",
      wordCount: 21,
      fixedIssues: ["scene fix"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValueOnce({
        content: "original draft",
        wordCount: 13,
        applied: false,
        tokenUsage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "scene-strengthened draft",
        wordCount: 21,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });

    const result = await runChapterReviewCycle({
      book: { genre: "modern-fantasy" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: {
        title: "Test Chapter",
        content: "original draft",
        wordCount: 13,
        postWriteErrors: [],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      structuralGate: { evaluateStructuralGate: vi.fn().mockResolvedValue(CLEAN_STRUCTURAL_GATE) },
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(reviseChapter.mock.calls[0]?.[3]).toEqual([
      expect.objectContaining({
        severity: "warning",
        category: "문체 검사",
      }),
    ]);
    expect(result.finalContent).toBe("scene-strengthened draft");
    expect(result.revised).toBe(true);
  });

  it("runs one bounded spot-fix pass for decorative narrator verdict warnings", async () => {
    const warningAudit = createAuditResult({
      passed: true,
      issues: [{
        severity: "warning",
        category: "장식적 판정문",
        description: "구체 묘사 뒤에 서술자가 인물 의도를 비유적 결론으로 다시 판정합니다.",
        suggestion: "독자가 이미 추론 가능한 결론문은 빼고 다음 행동이나 반응으로 이어 주세요.",
      }],
    });
    const auditChapter = vi.fn()
      .mockResolvedValueOnce(warningAudit)
      .mockResolvedValueOnce(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "verdict-trimmed draft",
      wordCount: 19,
      fixedIssues: ["trimmed narrator verdict"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValueOnce({
        content: "original draft",
        wordCount: 13,
        applied: false,
        tokenUsage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "verdict-trimmed draft",
        wordCount: 19,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });

    const result = await runChapterReviewCycle({
      book: { genre: "modern-fantasy" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: {
        title: "Test Chapter",
        content: "original draft",
        wordCount: 13,
        postWriteErrors: [],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      structuralGate: { evaluateStructuralGate: vi.fn().mockResolvedValue(CLEAN_STRUCTURAL_GATE) },
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(reviseChapter.mock.calls[0]?.[3]).toEqual([
      expect.objectContaining({
        severity: "warning",
        category: "장식적 판정문",
      }),
    ]);
    expect(result.finalContent).toBe("verdict-trimmed draft");
    expect(result.revised).toBe(true);
  });

  it("runs one bounded spot-fix pass for Korean scene-note leakage warnings", async () => {
    const auditChapter = vi.fn()
      .mockResolvedValueOnce(createAuditResult())
      .mockResolvedValueOnce(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "scene-note-repaired draft",
      wordCount: 25,
      fixedIssues: ["absorbed scene notes"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValueOnce({
        content: "몸. 장소. 주변. 탈출구.\n\n혼란을 붙잡을 수 있는 건 순서뿐이었다.",
        wordCount: 34,
        applied: false,
        tokenUsage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "scene-note-repaired draft",
        wordCount: 25,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });
    const sceneNoteIssue: AuditIssue = {
      severity: "warning",
      category: "메모식 장면 체크리스트",
      description: "작법 메모처럼 보이는 짧은 명사 파편이 본문에 섞였습니다: 몸 / 장소 / 주변 / 탈출구",
      suggestion: "작법 메모처럼 나누지 말고 장면 안 사건으로 흡수하세요.",
    };

    const result = await runChapterReviewCycle({
      book: { genre: "modern-fantasy" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: {
        title: "Test Chapter",
        content: "몸. 장소. 주변. 탈출구.\n\n혼란을 붙잡을 수 있는 건 순서뿐이었다.",
        wordCount: 34,
        postWriteErrors: [],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      structuralGate: { evaluateStructuralGate: vi.fn().mockResolvedValue(CLEAN_STRUCTURAL_GATE) },
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: (content) => ({
        issues: content.includes("몸. 장소") ? [sceneNoteIssue] : [],
      }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(reviseChapter.mock.calls[0]?.[3]).toEqual([sceneNoteIssue]);
    expect(result.finalContent).toBe("scene-note-repaired draft");
    expect(result.revised).toBe(true);
  });

  it("does not auto-fix non-actionable warnings when no critical issue exists", async () => {
    const reviseChapter = vi.fn();
    const auditChapter = vi.fn().mockResolvedValue(createAuditResult({
      passed: true,
      issues: [{
        severity: "warning",
        category: "독자 기대 관리",
        description: "장기 압박이 누적됩니다.",
        suggestion: "다음 생성 때 공간 앵커를 더 빨리 잡는 정도로 조정하세요.",
      }],
    }));

    const result = await runChapterReviewCycle({
      book: { genre: "modern-fantasy" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: {
        title: "Test Chapter",
        content: "original draft",
        wordCount: 13,
        postWriteErrors: [],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      structuralGate: { evaluateStructuralGate: vi.fn().mockResolvedValue(CLEAN_STRUCTURAL_GATE) },
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded: vi.fn().mockResolvedValue({
        content: "original draft",
        wordCount: 13,
        applied: false,
        tokenUsage: ZERO_USAGE,
      }),
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).not.toHaveBeenCalled();
    expect(result.finalContent).toBe("original draft");
    expect(result.revised).toBe(false);
  });

  it("restores lost critical audit issues even when structural soft warnings exist", async () => {
    const failingAudit = createAuditResult({
      passed: false,
      issues: [{
        severity: "critical",
        category: "continuity",
        description: "critical continuity failure",
        suggestion: "restore the missing causal link",
      }],
      summary: "critical continuity failure",
    });
    const auditChapter = vi.fn()
      .mockResolvedValueOnce(failingAudit)
      .mockResolvedValueOnce(createAuditResult({
        passed: false,
        issues: [],
        summary: "re-audit lost the issue list",
      }));
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "revised draft",
      wordCount: 13,
      fixedIssues: ["attempted fix"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValueOnce({
        content: "original draft",
        wordCount: 13,
        applied: false,
        tokenUsage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "revised draft",
        wordCount: 13,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });

    const result = await runChapterReviewCycle({
      book: { genre: "modern-fantasy" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: {
        title: "Test Chapter",
        content: "original draft",
        wordCount: 13,
        postWriteErrors: [],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      structuralGate: {
        evaluateStructuralGate: vi.fn().mockResolvedValue({
          passed: true,
          summary: "soft warning only",
          criticalFindings: [],
          softFindings: [{
            severity: "soft" as const,
            code: "clarity-gap",
            message: "Scene geography is still vague.",
            evidence: "The doorway position is unclear.",
            location: "scene break",
          }],
        }),
      },
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => {
        if (next.passed || next.issues.length > 0) {
          return next;
        }

        return {
          ...next,
          issues: failingAudit.issues,
          summary: next.summary || failingAudit.summary,
        };
      },
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(result.auditResult.passed).toBe(false);
    expect(result.auditResult.issues).toEqual([
      {
        severity: "warning",
        category: "structural-gate:clarity-gap",
        description: "Scene geography is still vague.",
        suggestion: "Evidence: The doorway position is unclear. Location: scene break",
      },
      {
        severity: "critical",
        category: "continuity",
        description: "critical continuity failure",
        suggestion: "restore the missing causal link",
      },
    ]);
  });
});
