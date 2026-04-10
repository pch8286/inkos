import type { CliOAuthProvider, LlmProvider } from "./llm.js";

/**
 * Shared TypeScript contracts for Studio API/UI communication.
 * Ported from PR #96 (Te9ui1a) — prevents client/server type drift.
 */

// --- Health ---

export interface HealthStatus {
  readonly status: "ok";
  readonly projectRoot: string;
  readonly projectConfigFound: boolean;
  readonly envFound: boolean;
  readonly projectEnvFound: boolean;
  readonly globalConfigFound: boolean;
  readonly bookCount: number;
  readonly provider: string | null;
  readonly model: string | null;
}

// --- Books ---

export interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly platform: string;
  readonly genre: string;
  readonly targetChapters: number;
  readonly chapters: number;
  readonly chapterCount: number;
  readonly lastChapterNumber: number;
  readonly totalWords: number;
  readonly approvedChapters: number;
  readonly pendingReview: number;
  readonly pendingReviewChapters: number;
  readonly failedReview: number;
  readonly failedChapters: number;
  readonly recentRunStatus?: string | null;
  readonly updatedAt: string;
}

export interface BookDetail extends BookSummary {
  readonly createdAt: string;
  readonly chapterWordCount: number;
  readonly language: "ko" | "zh" | "en" | null;
}

// --- Chapters ---

export interface ChapterSummary {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly auditIssueCount: number;
  readonly updatedAt: string;
  readonly fileName: string | null;
}

export interface ChapterDetail extends ChapterSummary {
  readonly auditIssues: ReadonlyArray<string>;
  readonly reviewNote?: string;
  readonly content: string;
}

export interface SaveChapterPayload {
  readonly content: string;
}

// --- Truth Files ---

export interface TruthFileSummary {
  readonly name: string;
  readonly label: string;
  readonly section: string;
  readonly sectionLabel: string;
  readonly exists: boolean;
  readonly path: string;
  readonly optional: boolean;
  readonly available: boolean;
  readonly preview: string;
  readonly size: number;
}

export interface TruthFileDetail extends TruthFileSummary {
  readonly content: string | null;
}

export interface TruthSectionSummary {
  readonly id: string;
  readonly label: string;
  readonly files: ReadonlyArray<TruthFileSummary>;
}

export interface TruthBulkDraft {
  readonly name: string;
  readonly content: string;
  readonly originalContent: string;
  readonly assistPrompt: string;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly assisting: boolean;
  readonly error: string | null;
  readonly assistError: string | null;
}

export interface TruthAssistChange {
  readonly fileName: string;
  readonly label: string;
  readonly content: string;
}

export interface TruthAssistRequest {
  readonly fileName?: string;
  readonly fileNames?: ReadonlyArray<string>;
  readonly instruction?: string;
  readonly mode?: "proposal" | "question";
  readonly alignment?: TruthAssistAlignmentPayload;
  readonly conversation?: ReadonlyArray<{ readonly role?: string; readonly content?: string }>;
}

export interface TruthAssistAlignmentPayload {
  readonly knownFacts?: ReadonlyArray<string>;
  readonly unknowns?: ReadonlyArray<string>;
  readonly mustDecide?: string;
  readonly askFirst?: string;
}

export interface TruthAssistResponse {
  readonly mode?: "proposal" | "question";
  readonly content: string;
  readonly changes: ReadonlyArray<TruthAssistChange>;
  readonly question?: string;
  readonly rationale?: string;
}

export interface TruthDocumentSection {
  readonly id: string;
  readonly heading: string;
  readonly headingLevel: number;
  readonly text: string;
  readonly tableHeaders: ReadonlyArray<string>;
  readonly tableRows: ReadonlyArray<ReadonlyArray<string>>;
}

export interface StructuredTruthDocument {
  readonly frontmatter: string;
  readonly title: string;
  readonly leadText: string;
  readonly sections: ReadonlyArray<TruthDocumentSection>;
}

// --- Review ---

export interface ReviewActionPayload {
  readonly chapterNumber: number;
  readonly reason?: string;
}

// --- Runs ---

export type RunAction = "draft" | "audit" | "revise" | "write-next";

export type RunStatus = "queued" | "running" | "succeeded" | "failed";

export interface RunLogEntry {
  readonly timestamp: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

export interface RunActionPayload {
  readonly chapterNumber?: number;
}

export interface StudioRun {
  readonly id: string;
  readonly bookId: string;
  readonly chapter: number | null;
  readonly chapterNumber: number | null;
  readonly action: RunAction;
  readonly status: RunStatus;
  readonly stage: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly logs: ReadonlyArray<RunLogEntry>;
  readonly result?: unknown;
  readonly error?: string;
}

export interface RunStreamEvent {
  readonly type: "snapshot" | "status" | "stage" | "log";
  readonly runId: string;
  readonly run?: StudioRun;
  readonly status?: RunStatus;
  readonly stage?: string;
  readonly log?: RunLogEntry;
  readonly result?: unknown;
  readonly error?: string;
}

// --- API Error Response ---

export interface ApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type RadarMode = "market-trends" | "idea-mining" | "fit-check";

// --- Bootstrap / global config ---

export interface CliAuthStatus {
  readonly available: boolean;
  readonly authenticated: boolean;
  readonly credentialPath: string;
  readonly command: string;
  readonly details?: string;
}

export interface GlobalConfigSummary {
  readonly exists: boolean;
  readonly language: "ko" | "zh" | "en";
  readonly provider: LlmProvider;
  readonly model: string;
  readonly reasoningEffort?: string;
  readonly baseUrl: string;
  readonly apiKeySet: boolean;
  readonly auth: {
    readonly geminiCli: CliAuthStatus;
    readonly codexCli: CliAuthStatus;
  };
}

export interface BootstrapSummary {
  readonly root: string;
  readonly suggestedProjectName: string;
  readonly projectInitialized: boolean;
  readonly globalConfig: GlobalConfigSummary;
}

export type AuthSessionStatus = "starting" | "waiting-browser" | "awaiting-code" | "authorizing" | "succeeded" | "failed";

export interface AuthSessionSummary {
  readonly id: string;
  readonly provider: CliOAuthProvider;
  readonly status: AuthSessionStatus;
  readonly url: string | null;
  readonly verificationCode: string | null;
  readonly error: string | null;
  readonly logs: ReadonlyArray<string>;
}

export interface RadarRecommendation {
  readonly confidence: number;
  readonly platform: string;
  readonly genre: string;
  readonly concept: string;
  readonly reasoning: string;
  readonly benchmarkTitles: ReadonlyArray<string>;
}

export interface RadarResult {
  readonly marketSummary: string;
  readonly recommendations: ReadonlyArray<RadarRecommendation>;
}

export interface RadarFitCheckMetadata {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly sourceFiles: ReadonlyArray<string>;
  readonly contextPreview: string;
  readonly contextLength: number;
  readonly note: string | null;
}

export interface RadarProgressSnapshot {
  readonly elapsedMs: number;
  readonly totalChars: number;
  readonly chineseChars?: number;
}

export interface RadarStatusSummary {
  readonly status: "idle" | "running" | "succeeded" | "failed";
  readonly mode: RadarMode;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly progress: RadarProgressSnapshot | null;
  readonly result: RadarResult | null;
  readonly error: string | null;
  readonly fitCheckMetadata?: RadarFitCheckMetadata;
}

export interface RadarHistoryEntry {
  readonly id: string;
  readonly savedPath: string;
  readonly savedAt: string;
  readonly status: "succeeded" | "failed";
  readonly mode: RadarMode;
  readonly fitCheckMetadata?: RadarFitCheckMetadata;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly result: RadarResult | null;
  readonly error: string | null;
}

export interface RadarHistorySummary {
  readonly scans: ReadonlyArray<RadarHistoryEntry>;
}
