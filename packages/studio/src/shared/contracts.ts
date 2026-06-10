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

export interface ReaderDeviceSettings {
  readonly fontPreset: "sans" | "serif" | "myeongjo";
  readonly fontSize: number;
  readonly lineHeight: number;
}

export interface ReaderSettings {
  readonly mobile: ReaderDeviceSettings;
  readonly desktop: ReaderDeviceSettings;
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
  readonly fanficMode?: string | null;
  readonly readerSettings?: ReaderSettings;
}

export interface BookSetupConversationEntry {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface BookSetupIntakePayload {
  readonly firstChapterDraft: string;
  readonly worldNotes: string;
  readonly characterNotes: string;
  readonly favoriteScenes: string;
  readonly rewriteBoundaries: string;
}

export interface BookSetupProposalRequest {
  readonly title: string;
  readonly genre: string;
  readonly language?: "ko" | "zh" | "en";
  readonly platform?: string;
  readonly chapterWordCount?: number;
  readonly targetChapters?: number;
  readonly sessionId?: string;
  readonly expectedRevision?: number;
  readonly brief?: string;
  readonly conversation?: ReadonlyArray<BookSetupConversationEntry>;
  readonly intake?: BookSetupIntakePayload;
}

export interface BookSetupProposalPayload {
  readonly content: string;
  readonly createdAt: string;
  readonly revision: number;
}

export interface BookSetupFoundationPreviewPayload {
  readonly createdAt: string;
  readonly revision: number;
  readonly digest: string;
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
  readonly currentState: string;
  readonly pendingHooks: string;
}

export type BookSetupReviewDecision = "approve" | "request-change" | "comment";
export type BookSetupReviewThreadStatus = "open" | "resolved";

export interface BookSetupReviewThreadPayload {
  readonly id: string;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly decision: BookSetupReviewDecision;
  readonly status: BookSetupReviewThreadStatus;
  readonly note: string;
  readonly quote: string;
  readonly createdAt: string;
  readonly resolvedAt?: string | null;
}

export interface BookSetupRevisionRequest {
  readonly expectedRevision: number;
}

export interface BookSetupCreateRequest extends BookSetupRevisionRequest {
  readonly expectedPreviewDigest: string;
}

export interface BookSetupReviewThreadsRequest extends BookSetupRevisionRequest {
  readonly reviewThreads: ReadonlyArray<BookSetupReviewThreadPayload>;
  readonly refreshPreviewOnResolve?: boolean;
}

export type BookSetupSessionStatus = "proposed" | "approved" | "creating";

export interface BookSetupSessionPayload {
  readonly id: string;
  readonly revision: number;
  readonly status: BookSetupSessionStatus;
  readonly bookId: string;
  readonly title: string;
  readonly genre: string;
  readonly language: "ko" | "zh" | "en";
  readonly platform: string;
  readonly chapterWordCount: number;
  readonly targetChapters: number;
  readonly brief: string;
  readonly intake?: BookSetupIntakePayload;
  readonly proposal: BookSetupProposalPayload;
  readonly previousProposal?: BookSetupProposalPayload;
  readonly foundationPreview?: BookSetupFoundationPreviewPayload;
  readonly reviewThreads: ReadonlyArray<BookSetupReviewThreadPayload>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BookSetupSessionListPayload {
  readonly sessions: ReadonlyArray<BookSetupSessionPayload>;
}

// --- Chapters ---

export interface StructuralGateFindingPayload {
  readonly severity: "critical" | "soft";
  readonly code: string;
  readonly message: string;
  readonly evidence?: string;
  readonly location?: string;
}

export interface StructuralGateSummaryPayload {
  readonly chapterNumber: number;
  readonly finalBlockingStatus: "passed" | "blocked";
  readonly summary: string;
  readonly reviserInvoked: boolean;
  readonly criticalFindings: ReadonlyArray<StructuralGateFindingPayload>;
  readonly softFindings: ReadonlyArray<StructuralGateFindingPayload>;
}

export interface ChapterSummary {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly auditIssueCount: number;
  readonly updatedAt: string;
  readonly fileName: string | null;
  readonly structuralGate?: StructuralGateSummaryPayload | null;
  readonly rejection?: ChapterRejectionPayload | null;
}

export interface ChapterDetail extends ChapterSummary {
  readonly auditIssues: ReadonlyArray<string>;
  readonly reviewNote?: string;
  readonly reviewThreads?: ReadonlyArray<ChapterInlineReviewThreadPayload>;
  readonly content: string;
  readonly readerSettings?: ReaderSettings;
}

export type ChapterRejectionInstruction =
  | "polish"
  | "targeted-fix"
  | "tone-adjust"
  | "restructure"
  | "heavy-rewrite"
  | "full-rewrite";

export type ChapterRejectionExecutionMode = "save-only" | "start-now";
export type ChapterRejectionRunStatus = "idle" | "running" | "completed" | "failed";
export type ChapterRejectionDerivedMode = "spot-fix" | "polish" | "anti-detect" | "rework" | "rewrite";

export interface ChapterRejectionPayload {
  readonly editorNote: string;
  readonly instructions: ReadonlyArray<ChapterRejectionInstruction>;
  readonly executionMode: ChapterRejectionExecutionMode;
  readonly requestedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly failedAt?: string;
  readonly failureMessage?: string;
  readonly lastRunStatus: ChapterRejectionRunStatus;
  readonly derivedMode: ChapterRejectionDerivedMode;
}

export interface SaveChapterPayload {
  readonly content: string;
  readonly reviewThreads?: ReadonlyArray<ChapterInlineReviewThreadPayload>;
}

export interface ChapterInlineReviewThreadPayload {
  readonly id: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly decision: BookSetupReviewDecision;
  readonly note: string;
  readonly quote: string;
  readonly createdAt: string;
}

export interface RejectChapterRequest {
  readonly reviewThreads?: ReadonlyArray<ChapterInlineReviewThreadPayload>;
  readonly editorNote: string;
  readonly instructions: ReadonlyArray<ChapterRejectionInstruction>;
  readonly executionMode: ChapterRejectionExecutionMode;
}

export interface EpisodeStarterPayload {
  readonly direction: string;
  readonly conti: string;
  readonly avoid: string;
  readonly markdown: string;
  readonly exists: boolean;
  readonly warnings: ReadonlyArray<string>;
}

export interface BookDetailPayload {
  readonly book: BookDetail;
  readonly chapters: ReadonlyArray<ChapterSummary>;
  readonly nextChapter: number;
  readonly pendingStructuralGate?: StructuralGateSummaryPayload | null;
  readonly activeRun?: StudioRun | null;
  readonly episodeStarter?: EpisodeStarterPayload | null;
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

export type TruthWriteScope =
  | { readonly kind: "read-only" }
  | { readonly kind: "file"; readonly fileName: string }
  | { readonly kind: "bundle"; readonly fileNames: readonly [string, ...string[]] };

export interface TruthSaveRequest {
  readonly content: string;
  readonly scope: TruthWriteScope;
}

interface TruthAssistRequestBase {
  readonly instruction?: string;
  readonly alignment?: TruthAssistAlignmentPayload;
  readonly conversation?: ReadonlyArray<{ readonly role?: string; readonly content?: string }>;
}

type TruthAssistSingleTarget =
  | {
    readonly fileName: string;
    readonly fileNames?: never;
  }
  | {
    readonly fileName?: never;
    readonly fileNames: readonly [string, ...string[]];
  };

type TruthQuestionAssistRequest = TruthAssistRequestBase & {
  readonly mode: "question";
  readonly scope?: TruthWriteScope;
};

type TruthProposalAssistRequest = TruthAssistRequestBase & {
  readonly mode: "proposal";
  readonly scope:
    | { readonly kind: "file"; readonly fileName: string }
    | { readonly kind: "bundle"; readonly fileNames: readonly [string, ...string[]] };
};

export type TruthAssistRequest =
  (TruthQuestionAssistRequest | TruthProposalAssistRequest)
  & TruthAssistSingleTarget;

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

export type RunAction = "draft" | "audit" | "revise" | "rewrite" | "write-next";

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
  readonly elapsedMs?: number | null;
  readonly totalChars?: number | null;
  readonly chineseChars?: number | null;
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

// --- Story World Lab ---

export type ProjectStoryModePayload = "draft" | "serialized";
export type ChapterPublicationStatusPayload = "draft" | "locked" | "published";
export type WorldPressureTypePayload = "faction" | "character" | "location" | "hook" | "environment";
export type PressureLevelPayload = "low" | "medium" | "high";
export type ProtagonistVisibilityPayload = "yes" | "no" | "partial";
export type AdaptiveTickKindPayload = "protagonist_action" | "protagonist_inaction" | "elapsed_time" | "direction_override";
export type MovementRelevancePayload = "low" | "medium" | "high";
export type MovementVisibilityPayload = "observed_now" | "rumor" | "hidden" | "delayed";
export type MovementRiskPayload = "low" | "medium" | "high";
export type MovementConflictLevelPayload = "none" | "minor" | "major";
export type MovementCandidateStatusPayload = "candidate" | "approved" | "rejected" | "hold";
export type ConflictPolicyPayload = "draft_rewrite_allowed" | "serialized_forward_only" | "edition_retcon_required";
export type RepairStrategyPayload = "forward_bend" | "soft_reveal" | "continuity_patch" | "local_rewrite" | "cascade_retcon" | "edition_retcon";

export interface StorySpinePayload {
  readonly protagonistId: string;
  readonly currentGoal: string;
  readonly currentQuestion: string;
  readonly emotionalState: ReadonlyArray<string>;
  readonly activeChoices: ReadonlyArray<string>;
  readonly constraints: ReadonlyArray<string>;
}

export interface WorldPressurePayload {
  readonly id: string;
  readonly type: WorldPressureTypePayload;
  readonly label: string;
  readonly currentMotion: string;
  readonly pressureLevel: PressureLevelPayload;
  readonly visibleToProtagonist: ProtagonistVisibilityPayload;
}

export interface AdaptiveTickInputPayload {
  readonly id: string;
  readonly bookId: string;
  readonly chapter: number;
  readonly kind: AdaptiveTickKindPayload;
  readonly protagonistAction?: string;
  readonly protagonistInaction?: string;
  readonly elapsedTime?: string;
  readonly userDirection?: string;
  readonly storySpine: StorySpinePayload;
  readonly worldPressures: ReadonlyArray<WorldPressurePayload>;
  readonly createdAt: string;
}

export interface MovementCandidatePayload {
  readonly id: string;
  readonly sourceTickId: string;
  readonly text: string;
  readonly relevance: MovementRelevancePayload;
  readonly visibility: MovementVisibilityPayload;
  readonly risk: MovementRiskPayload;
  readonly conflictLevel: MovementConflictLevelPayload;
  readonly status: MovementCandidateStatusPayload;
  readonly affectedChapters: ReadonlyArray<number>;
  readonly affectedStateKeys: ReadonlyArray<string>;
  readonly repairStrategy?: RepairStrategyPayload;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdaptiveTickPayload extends AdaptiveTickInputPayload {
  readonly candidates: ReadonlyArray<MovementCandidatePayload>;
}

export interface ChapterStatusRecordPayload {
  readonly chapter: number;
  readonly status: ChapterPublicationStatusPayload;
  readonly updatedAt: string;
}

export interface ImpactReportPayload {
  readonly movementCandidateId: string;
  readonly affectedChapters: ReadonlyArray<number>;
  readonly affectedStateKeys: ReadonlyArray<string>;
  readonly conflictLevel: MovementConflictLevelPayload;
  readonly repairStrategy?: RepairStrategyPayload;
  readonly notes: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SceneContractPayload {
  readonly id: string;
  readonly chapter: number;
  readonly sourceTickIds: ReadonlyArray<string>;
  readonly pov: string;
  readonly location: string;
  readonly sceneGoal: ReadonlyArray<string>;
  readonly outlineNode?: string | null;
  readonly mustInclude: ReadonlyArray<string>;
  readonly mustAvoid: ReadonlyArray<string>;
  readonly styleEmphasis: ReadonlyArray<string>;
  readonly movementCandidateIds: ReadonlyArray<string>;
  readonly endingState: ReadonlyArray<string>;
  readonly conflictPolicy: ConflictPolicyPayload;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoryWorldLabPayload {
  readonly projectMode: ProjectStoryModePayload;
  readonly chapterStatus: ReadonlyArray<ChapterStatusRecordPayload>;
  readonly storySpine: StorySpinePayload | null;
  readonly worldPressures: ReadonlyArray<WorldPressurePayload>;
  readonly ticks: ReadonlyArray<AdaptiveTickPayload>;
  readonly movementCandidates: ReadonlyArray<MovementCandidatePayload>;
  readonly impactReports: ReadonlyArray<ImpactReportPayload>;
  readonly sceneContracts: ReadonlyArray<SceneContractPayload>;
}
