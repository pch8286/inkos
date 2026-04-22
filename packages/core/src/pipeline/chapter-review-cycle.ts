import type { AuditIssue, AuditResult } from "../agents/continuity.js";
import type { ReviseOutput } from "../agents/reviser.js";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import type { LengthSpec } from "../models/length-governance.js";
import type { StructuralGateCriticalFinding, StructuralGateResult, StructuralGateSoftFinding } from "../models/structural-gate.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ChapterReviewCycleUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ChapterReviewCycleControlInput {
  readonly chapterIntent: string;
  readonly contextPackage: ContextPackage;
  readonly ruleStack: RuleStack;
}

export interface ChapterReviewCycleResult {
  readonly finalContent: string;
  readonly finalWordCount: number;
  readonly preAuditNormalizedWordCount: number;
  readonly revised: boolean;
  readonly auditResult: AuditResult;
  readonly totalUsage: ChapterReviewCycleUsage;
  readonly postReviseCount: number;
  readonly normalizeApplied: boolean;
  readonly structuralGate: {
    readonly firstPass: StructuralGateResult;
    readonly secondPass?: StructuralGateResult;
    readonly reviserInvoked: boolean;
    readonly finalBlockingStatus: "passed" | "blocked";
  };
}

function isActionableStyleIssue(issue: AuditIssue): boolean {
  if (issue.severity !== "warning") {
    return false;
  }

  const text = `${issue.category} ${issue.description} ${issue.suggestion}`;
  return [
    "문체", "Style", "文风",
    "대사", "Dialogue", "台词",
    "나열식", "Chronicle", "流水账",
    "AI", "段落", "문단",
    "감정 직설", "대사 압력",
  ].some((needle) => text.includes(needle));
}

function toStructuralGateSuggestion(
  finding: Pick<StructuralGateCriticalFinding | StructuralGateSoftFinding, "evidence" | "location">,
): string {
  const parts = [
    finding.evidence ? `Evidence: ${finding.evidence}` : "",
    finding.location ? `Location: ${finding.location}` : "",
  ].filter(Boolean);

  return parts.join(" ") || "Resolve the structural gate finding.";
}

function toStructuralGateCriticalIssue(finding: StructuralGateCriticalFinding): AuditIssue {
  return {
    severity: "critical",
    category: `structural-gate:${finding.code}`,
    description: finding.message,
    suggestion: toStructuralGateSuggestion(finding),
  };
}

function toStructuralGateSoftIssue(finding: StructuralGateSoftFinding): AuditIssue {
  return {
    severity: "warning",
    category: `structural-gate:${finding.code}`,
    description: finding.message,
    suggestion: toStructuralGateSuggestion(finding),
  };
}

export async function runChapterReviewCycle(params: {
  readonly book: Pick<{ genre: string }, "genre">;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly initialOutput: Pick<WriteChapterOutput, "title" | "content" | "wordCount" | "postWriteErrors">;
  readonly reducedControlInput?: ChapterReviewCycleControlInput;
  readonly lengthSpec: LengthSpec;
  readonly initialUsage: ChapterReviewCycleUsage;
  readonly createReviser: () => {
    reviseChapter: (
      bookDir: string,
      chapterContent: string,
      chapterNumber: number,
      issues: ReadonlyArray<AuditIssue>,
      mode: "spot-fix",
      genre?: string,
      options?: {
        chapterIntent?: string;
        contextPackage?: ContextPackage;
        ruleStack?: RuleStack;
        lengthSpec?: LengthSpec;
      },
    ) => Promise<ReviseOutput>;
  };
  readonly structuralGate?: {
    evaluateStructuralGate: (input: {
      chapterNumber: number;
      chapterTitle?: string;
      chapterIntent?: string;
      contextPackage?: ContextPackage;
      ruleStack?: RuleStack;
      storyBible: string;
      volumeOutline: string;
      bookRules: string;
      currentState: string;
      pendingHooks: string;
      draftContent: string;
    }) => Promise<StructuralGateResult>;
  };
  readonly auditor: {
    auditChapter: (
      bookDir: string,
      chapterContent: string,
      chapterNumber: number,
      genre?: string,
      options?: {
        temperature?: number;
        chapterIntent?: string;
        contextPackage?: ContextPackage;
        ruleStack?: RuleStack;
      },
    ) => Promise<AuditResult>;
  };
  readonly normalizeDraftLengthIfNeeded: (chapterContent: string) => Promise<{
    content: string;
    wordCount: number;
    applied: boolean;
    tokenUsage?: ChapterReviewCycleUsage;
  }>;
  readonly assertChapterContentNotEmpty: (content: string, stage: string) => void;
  readonly addUsage: (
    left: ChapterReviewCycleUsage,
    right?: ChapterReviewCycleUsage,
  ) => ChapterReviewCycleUsage;
  readonly restoreLostAuditIssues: (previous: AuditResult, next: AuditResult) => AuditResult;
  readonly analyzeAITells: (content: string) => { issues: ReadonlyArray<AuditIssue> };
  readonly analyzeSensitiveWords: (content: string) => {
    found: ReadonlyArray<{ severity: string }>;
    issues: ReadonlyArray<AuditIssue>;
  };
  readonly logWarn: (message: { zh: string; en: string; ko?: string }) => void;
  readonly logStage: (message: { zh: string; en: string; ko?: string }) => void;
}): Promise<ChapterReviewCycleResult> {
  let totalUsage = params.initialUsage;
  let postReviseCount = 0;
  let normalizeApplied = false;
  let finalContent = params.initialOutput.content;
  let finalWordCount = params.initialOutput.wordCount;
  let revised = false;
  const structuralGateSource = params.structuralGate
    ? await loadStructuralGateSource(params.bookDir)
    : undefined;

  if (params.initialOutput.postWriteErrors.length > 0) {
    params.logWarn({
      zh: `检测到 ${params.initialOutput.postWriteErrors.length} 个后写错误，审计前触发 spot-fix 修补`,
      en: `${params.initialOutput.postWriteErrors.length} post-write errors detected, triggering spot-fix before audit`,
      ko: `후작성 오류 ${params.initialOutput.postWriteErrors.length}건 감지, 검수 전 spot-fix 실행`,
    });
    const reviser = params.createReviser();
    const spotFixIssues = params.initialOutput.postWriteErrors.map((violation) => ({
      severity: "critical" as const,
      category: violation.rule,
      description: violation.description,
      suggestion: violation.suggestion,
    }));
    const fixResult = await reviser.reviseChapter(
      params.bookDir,
      finalContent,
      params.chapterNumber,
      spotFixIssues,
      "spot-fix",
      params.book.genre,
      {
        ...params.reducedControlInput,
        lengthSpec: params.lengthSpec,
      },
    );
    totalUsage = params.addUsage(totalUsage, fixResult.tokenUsage);
    if (fixResult.revisedContent.length > 0) {
      finalContent = fixResult.revisedContent;
      finalWordCount = fixResult.wordCount;
      revised = true;
    }
  }

  const normalizedBeforeAudit = await params.normalizeDraftLengthIfNeeded(finalContent);
  totalUsage = params.addUsage(totalUsage, normalizedBeforeAudit.tokenUsage);
  finalContent = normalizedBeforeAudit.content;
  finalWordCount = normalizedBeforeAudit.wordCount;
  normalizeApplied = normalizeApplied || normalizedBeforeAudit.applied;
  params.assertChapterContentNotEmpty(finalContent, "draft generation");

  const defaultGateResult: StructuralGateResult = {
    passed: true,
    summary: "structural gate not configured",
    criticalFindings: [],
    softFindings: [],
  };
  let firstGateResult = defaultGateResult;
  if (params.structuralGate && structuralGateSource) {
    params.logStage({ zh: "结构门禁校验", en: "running structural gate", ko: "구조 게이트 점검" });
    firstGateResult = await params.structuralGate.evaluateStructuralGate({
      chapterNumber: params.chapterNumber,
      chapterTitle: params.initialOutput.title,
      chapterIntent: params.reducedControlInput?.chapterIntent,
      contextPackage: params.reducedControlInput?.contextPackage,
      ruleStack: params.reducedControlInput?.ruleStack,
      draftContent: finalContent,
      ...structuralGateSource,
    });
  }

  let secondGateResult: StructuralGateResult | undefined;
  let structuralGateReviserInvoked = false;
  let finalGateResult = firstGateResult;

  if (firstGateResult.criticalFindings.length > 0) {
    structuralGateReviserInvoked = true;
    params.logStage({
      zh: "结构闸门修复关键问题",
      en: "repairing structural gate failures",
      ko: "구조 게이트 치명 문제 수정",
    });
    const reviser = params.createReviser();
    const reviseOutput = await reviser.reviseChapter(
      params.bookDir,
      finalContent,
      params.chapterNumber,
      firstGateResult.criticalFindings.map(toStructuralGateCriticalIssue),
      "spot-fix",
      params.book.genre,
      {
        ...params.reducedControlInput,
        lengthSpec: params.lengthSpec,
      },
    );
    totalUsage = params.addUsage(totalUsage, reviseOutput.tokenUsage);

    if (reviseOutput.revisedContent.length > 0) {
      const normalizedRevision = await params.normalizeDraftLengthIfNeeded(reviseOutput.revisedContent);
      totalUsage = params.addUsage(totalUsage, normalizedRevision.tokenUsage);
      finalContent = normalizedRevision.content;
      finalWordCount = normalizedRevision.wordCount;
      postReviseCount = normalizedRevision.wordCount;
      normalizeApplied = normalizeApplied || normalizedRevision.applied;
      revised = true;
      params.assertChapterContentNotEmpty(finalContent, "structural revision");
    }

    secondGateResult = params.structuralGate && structuralGateSource
      ? await params.structuralGate.evaluateStructuralGate({
          chapterNumber: params.chapterNumber,
          chapterTitle: params.initialOutput.title,
          chapterIntent: params.reducedControlInput?.chapterIntent,
          contextPackage: params.reducedControlInput?.contextPackage,
          ruleStack: params.reducedControlInput?.ruleStack,
          draftContent: finalContent,
          ...structuralGateSource,
        })
      : defaultGateResult;
    finalGateResult = secondGateResult;
  }

  const structuralGateSoftIssues = (
    secondGateResult?.softFindings
    ?? firstGateResult.softFindings
  ).map(toStructuralGateSoftIssue);

  const structuralGate = {
    firstPass: firstGateResult,
    secondPass: secondGateResult,
    reviserInvoked: structuralGateReviserInvoked,
    finalBlockingStatus: finalGateResult.criticalFindings.length > 0 ? "blocked" as const : "passed" as const,
  };

  if (structuralGate.finalBlockingStatus === "blocked") {
    return {
      finalContent,
      finalWordCount,
      preAuditNormalizedWordCount: normalizedBeforeAudit.wordCount,
      revised,
      auditResult: {
        passed: false,
        issues: structuralGateSoftIssues,
        summary: finalGateResult.summary,
      },
      totalUsage,
      postReviseCount,
      normalizeApplied,
      structuralGate,
    };
  }

  params.logStage({ zh: "审计草稿", en: "auditing draft", ko: "초안 검수" });
  const llmAudit = await params.auditor.auditChapter(
    params.bookDir,
    finalContent,
    params.chapterNumber,
    params.book.genre,
    params.reducedControlInput,
  );
  totalUsage = params.addUsage(totalUsage, llmAudit.tokenUsage);
  const aiTellsResult = params.analyzeAITells(finalContent);
  const sensitiveWriteResult = params.analyzeSensitiveWords(finalContent);
  const hasBlockedWriteWords = sensitiveWriteResult.found.some((item) => item.severity === "block");
  let auditResult: AuditResult = {
    passed: hasBlockedWriteWords ? false : llmAudit.passed,
    issues: [
      ...structuralGateSoftIssues,
      ...llmAudit.issues,
      ...aiTellsResult.issues,
      ...sensitiveWriteResult.issues,
    ],
    summary: llmAudit.summary,
  };

  const criticalIssues = auditResult.issues.filter((issue) => issue.severity === "critical");
  const actionableStyleWarnings = auditResult.issues.filter((issue) => isActionableStyleIssue(issue));

  if (criticalIssues.length > 0 || actionableStyleWarnings.length > 0) {
    const reviser = params.createReviser();
    params.logStage({
      zh: criticalIssues.length > 0 ? "自动修复关键问题" : "自动修复风格问题",
      en: criticalIssues.length > 0 ? "auto-revising critical issues" : "auto-revising style issues",
      ko: criticalIssues.length > 0 ? "치명적 문제 자동 수정" : "문체 문제 자동 수정",
    });
    const reviseOutput = await reviser.reviseChapter(
      params.bookDir,
      finalContent,
      params.chapterNumber,
      criticalIssues.length > 0 ? auditResult.issues : actionableStyleWarnings,
      "spot-fix",
      params.book.genre,
      {
        ...params.reducedControlInput,
        lengthSpec: params.lengthSpec,
      },
    );
    totalUsage = params.addUsage(totalUsage, reviseOutput.tokenUsage);

    if (reviseOutput.revisedContent.length > 0) {
      const normalizedRevision = await params.normalizeDraftLengthIfNeeded(reviseOutput.revisedContent);
      totalUsage = params.addUsage(totalUsage, normalizedRevision.tokenUsage);
      postReviseCount = normalizedRevision.wordCount;
      normalizeApplied = normalizeApplied || normalizedRevision.applied;

      const preMarkers = countRevisionRegressionMarkers(params.analyzeAITells(finalContent).issues);
      const postMarkers = countRevisionRegressionMarkers(params.analyzeAITells(normalizedRevision.content).issues);
      if (postMarkers <= preMarkers) {
        finalContent = normalizedRevision.content;
        finalWordCount = normalizedRevision.wordCount;
        revised = true;
        params.assertChapterContentNotEmpty(finalContent, "revision");
      }

      const reAudit = await params.auditor.auditChapter(
        params.bookDir,
        finalContent,
        params.chapterNumber,
        params.book.genre,
        params.reducedControlInput
          ? { ...params.reducedControlInput, temperature: 0 }
          : { temperature: 0 },
      );
      totalUsage = params.addUsage(totalUsage, reAudit.tokenUsage);
      const reAITells = params.analyzeAITells(finalContent);
      const reSensitive = params.analyzeSensitiveWords(finalContent);
      const reHasBlocked = reSensitive.found.some((item) => item.severity === "block");
      const previousNonStructuralIssues = auditResult.issues.filter(
        (issue) => !issue.category.startsWith("structural-gate:"),
      );
      const restoredReAudit = params.restoreLostAuditIssues({
        ...auditResult,
        issues: previousNonStructuralIssues,
      }, {
        passed: reHasBlocked ? false : reAudit.passed,
        issues: [...reAudit.issues, ...reAITells.issues, ...reSensitive.issues],
        summary: reAudit.summary,
      });
      auditResult = {
        ...restoredReAudit,
        issues: [...structuralGateSoftIssues, ...restoredReAudit.issues],
      };
    }
  }

  return {
    finalContent,
    finalWordCount,
    preAuditNormalizedWordCount: normalizedBeforeAudit.wordCount,
    revised,
    auditResult,
    totalUsage,
    postReviseCount,
    normalizeApplied,
    structuralGate,
  };
}

function countRevisionRegressionMarkers(issues: ReadonlyArray<AuditIssue>): number {
  return issues.filter((issue) => !isParagraphFragmentationIssue(issue)).length;
}

function isParagraphFragmentationIssue(issue: AuditIssue): boolean {
  return [
    "Paragraph fragmentation",
    "문단 과분할",
    "段落过碎",
  ].includes(issue.category);
}

async function loadStructuralGateSource(bookDir: string): Promise<{
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
  readonly currentState: string;
  readonly pendingHooks: string;
}> {
  const storyDir = join(bookDir, "story");
  const [storyBible, volumeOutline, bookRules, currentState, pendingHooks] = await Promise.all([
    readOptional(join(storyDir, "story_bible.md")),
    readOptional(join(storyDir, "volume_outline.md")),
    readOptional(join(storyDir, "book_rules.md")),
    readOptional(join(storyDir, "current_state.md")),
    readOptional(join(storyDir, "pending_hooks.md")),
  ]);

  return {
    storyBible,
    volumeOutline,
    bookRules,
    currentState,
    pendingHooks,
  };
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}
