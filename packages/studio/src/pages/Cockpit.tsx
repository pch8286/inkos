import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import type { SSEMessage } from "../hooks/use-sse";
import { resolveStudioLanguage } from "../shared/language";
import { platformOptionsForLanguage } from "../shared/book-create-form";
import {
  loadAiSessionRecord,
  saveAiSessionRecord,
  writeAiSessionPointer,
  type PersistedAiSessionRecord,
} from "../shared/ai-session-store";
import type {
  BookSetupSessionStatus,
  StudioRun,
  TruthFileDetail,
  TruthFileSummary,
} from "../shared/contracts";
import {
  compactModelLabel,
  defaultModelForProvider,
  normalizeReasoningEffortForProvider,
  shortLabelForProvider,
  type LlmCapabilitiesSummary,
  type ReasoningEffort,
} from "../shared/llm";
import { buildTruthLineDiff, makeTruthPreview, summarizeTruthDiff } from "../shared/truth-assistant";
import { shouldRefetchBookCollections, shouldRefetchBookCreateStatus, shouldRefetchBookView } from "../hooks/use-book-activity";
import {
  deriveCockpitRailVisibility,
  deriveSetupPrimaryAction,
  type CockpitMode,
  type SetupPrimaryAction,
} from "./cockpit-ui-state";
import { CockpitHeaderSection } from "./cockpit/CockpitHeaderSection";
import { CockpitInspectorPanel, makeActivityDataPreview } from "./cockpit/CockpitInspectorPanel";
import { CockpitLeftRail } from "./cockpit/CockpitLeftRail";
import { CockpitMainConversation } from "./cockpit/CockpitMainConversation";
import {
  type ComposerAction,
  defaultActionForMode,
  formatReasoningEffortLabel,
  parseComposerCommand,
  renderChapterStatus,
} from "./cockpit-parsing";
import {
  toSetupConversation,
  type CockpitMessage,
  type FoundationPreviewKey,
  type InspectorTab,
  type ProposalState,
} from "./cockpit-shared";
import {
  appendQueuedComposerEntry,
  popLastQueuedComposerEntry,
  shiftNextQueuedComposerEntry,
  type CockpitComposerQueueState,
  type QueuedComposerEntry,
} from "./cockpit-queue-state";
import { deriveCockpitStatusStrip } from "./cockpit-status-strip";
import { useCockpitConversation } from "./use-cockpit-conversation";
import { useCockpitSetupSession } from "./use-cockpit-setup-session";
import {
  ArrowRight,
  Bot,
  BookOpen,
  Check,
  Loader2,
  MessageSquareText,
  RefreshCcw,
  Sparkles,
  Wand2,
} from "lucide-react";

interface Nav {
  readonly toDashboard: () => void;
  readonly toBook: (id: string) => void;
  readonly toBookCreate?: () => void;
  readonly toTruth: (id: string) => void;
}

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly platform: string;
  readonly chaptersWritten: number;
}

interface BookChapterSummary {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly updatedAt: string;
}

interface BookDetailResponse {
  readonly book: {
    readonly id: string;
    readonly title: string;
    readonly genre: string;
    readonly platform: string;
    readonly chapterWordCount: number;
    readonly targetChapters: number;
    readonly language: string | null;
  };
  readonly chapters: ReadonlyArray<BookChapterSummary>;
  readonly nextChapter: number;
  readonly activeRun?: StudioRun | null;
}

interface ChapterDetailResponse {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
  readonly language: string;
}

interface GenreInfo {
  readonly id: string;
  readonly name: string;
  readonly source: "project" | "builtin";
  readonly language: "ko" | "zh" | "en";
}

interface BookCreateJob {
  readonly bookId: string;
  readonly title: string;
  readonly status: "creating" | "error";
  readonly stage: string | null;
  readonly message: string | null;
  readonly error?: string;
}

interface ProjectSummary {
  readonly language: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

interface PersistedCockpitPayload {
  readonly threads: Readonly<Record<string, ReadonlyArray<CockpitMessage>>>;
  readonly proposals: Readonly<Record<string, ProposalState>>;
  readonly queuedComposerEntries: CockpitComposerQueueState;
  readonly draftInputByThread: Readonly<Record<string, string>>;
  readonly setupDraft: {
    readonly title: string;
    readonly genre: string;
    readonly platform: string;
    readonly words: string;
    readonly targetChapters: string;
    readonly brief: string;
    readonly selectedFoundationPreviewKey: FoundationPreviewKey;
  } | null;
  readonly uiContext: {
    readonly mode: CockpitMode;
    readonly selectedBookId: string;
    readonly selectedTruthFile: string;
    readonly selectedChapterNumber: number | null;
    readonly showNewSetup: boolean;
    readonly inspectorTab: InspectorTab;
  };
}

const COCKPIT_SESSION_ID = "studio:cockpit";
const COCKPIT_POINTER_SCOPE = "cockpit";

interface CockpitStatusFact {
  readonly label: string;
  readonly value: string;
  readonly accent?: boolean;
}

export function buildCockpitStatusFacts(input: {
  readonly stage: string;
  readonly stageLabel: string;
  readonly targetLabel: string;
  readonly modelLabel: string;
  readonly reasoningLabel: string | null;
  readonly labels: {
    readonly stage: string;
    readonly target: string;
    readonly model: string;
    readonly reasoning: string;
  };
}): ReadonlyArray<CockpitStatusFact> {
  const facts: CockpitStatusFact[] = [];
  if (input.stage !== "idle" && input.stage !== "ready") {
    facts.push({ accent: true, label: input.labels.stage, value: input.stageLabel });
  }
  facts.push(
    { label: input.labels.target, value: input.targetLabel },
    { label: input.labels.model, value: input.modelLabel },
  );
  if (input.reasoningLabel) {
    facts.push({ label: input.labels.reasoning, value: input.reasoningLabel });
  }
  return facts;
}

export function getCockpitMessageRolePresentation(role: CockpitMessage["role"]): {
  readonly className: "is-user" | "is-assistant" | "is-system";
  readonly label: string;
  readonly alignLabel: "left" | "right";
} {
  if (role === "user") {
    return { className: "is-user", label: "YOU", alignLabel: "right" };
  }
  if (role === "system") {
    return { className: "is-system", label: "SYSTEM", alignLabel: "left" };
  }
  return { className: "is-assistant", label: "INKOS", alignLabel: "left" };
}

export function filterCockpitItems(input: {
  readonly query: string;
  readonly books: ReadonlyArray<BookSummary>;
  readonly truthFiles: ReadonlyArray<TruthFileSummary>;
  readonly chapters: ReadonlyArray<BookChapterSummary>;
}) {
  const query = input.query.trim().toLocaleLowerCase();
  if (!query) {
    return {
      books: input.books,
      truthFiles: input.truthFiles,
      chapters: input.chapters,
    };
  }
  const includesQuery = (...values: ReadonlyArray<string | number | null | undefined>) => {
    return values.some((value) => String(value ?? "").toLocaleLowerCase().includes(query));
  };
  return {
    books: input.books.filter((book) => includesQuery(
      book.title,
      book.genre,
      book.platform,
      book.status,
      book.chaptersWritten,
    )),
    truthFiles: input.truthFiles.filter((file) => includesQuery(
      file.name,
      file.label,
      file.path,
      file.section,
      file.sectionLabel,
      file.preview,
      file.exists ? "saved" : "seed",
    )),
    chapters: input.chapters.filter((chapter) => includesQuery(
      chapter.number,
      chapter.title,
      chapter.status,
      chapter.wordCount,
    )),
  };
}

function isPersistedCockpitPayload(value: unknown): value is PersistedCockpitPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!record.uiContext || typeof record.uiContext !== "object") {
    return false;
  }
  return true;
}

export function getCockpitCreateActionErrorKey(showNewSetup: boolean): "cockpit.createRequiresOpenSetup" | null {
  return showNewSetup ? null : "cockpit.createRequiresOpenSetup";
}

export function isSetupDiscussionLocked(input: {
  readonly mode: CockpitMode;
  readonly showNewSetup: boolean;
  readonly autoCreateBusy: boolean;
}) {
  return input.mode === "discuss" && input.showNewSetup && input.autoCreateBusy;
}

export function isSetupPrimaryActionDisabled(input: {
  readonly action: SetupPrimaryAction;
  readonly setupDiscussionLocked: boolean;
  readonly setupTitle: string;
  readonly setupGenre: string;
  readonly setupDiscussionState: "discussing" | "ready";
  readonly autoCreateAllowed: boolean;
  readonly autoCreateBusy: boolean;
  readonly setupCanPrepareProposal: boolean;
  readonly preparingSetupProposal: boolean;
  readonly approvingSetup: boolean;
  readonly preparingFoundationPreview: boolean;
  readonly creatingBook: boolean;
  readonly setupDraftDirty: boolean;
  readonly setupSessionStatus: BookSetupSessionStatus | null;
  readonly hasFoundationPreview: boolean;
}) {
  switch (input.action) {
    case "discuss":
      return input.setupDiscussionLocked;
    case "mark-ready":
      return !input.setupTitle.trim() || !input.setupGenre || input.setupDiscussionState === "ready";
    case "auto-create":
      return !input.autoCreateAllowed || input.autoCreateBusy;
    case "prepare-proposal":
      return !input.setupCanPrepareProposal
        || input.preparingSetupProposal
        || input.approvingSetup
        || input.preparingFoundationPreview
        || input.creatingBook;
    case "approve":
      return input.setupDraftDirty || input.approvingSetup || input.setupSessionStatus !== "proposed";
    case "preview-foundation":
      return input.setupDraftDirty
        || input.preparingFoundationPreview
        || input.creatingBook
        || input.setupSessionStatus !== "approved";
    case "create":
      return input.setupDraftDirty
        || input.creatingBook
        || input.setupSessionStatus !== "approved"
        || !input.hasFoundationPreview;
    default: {
      const exhaustiveAction: never = input.action;
      return exhaustiveAction;
    }
  }
}

export function isCockpitRunDisabled(input: {
  readonly showNewSetup: boolean;
  readonly setupPrimaryActionDisabled: boolean;
  readonly busy: boolean;
  readonly mode: CockpitMode;
  readonly canUseBinder: boolean;
  readonly canUseDraft: boolean;
}) {
  if (input.busy) {
    return true;
  }
  if (input.showNewSetup) {
    return input.setupPrimaryActionDisabled;
  }
  return (input.mode === "binder" && !input.canUseBinder)
    || (input.mode === "draft" && !input.canUseDraft);
}

export function defaultQueuedComposerActionForMode(mode: CockpitMode): ComposerAction {
  return defaultActionForMode(mode);
}

export function shouldRunQueuedComposerEntry(input: {
  readonly busy: boolean;
  readonly threadKey: string;
  readonly queueState: CockpitComposerQueueState;
}) {
  return !input.busy && (input.queueState[input.threadKey]?.length ?? 0) > 0;
}

function formatQueuedComposerEntryForInput(entry: QueuedComposerEntry, mode: CockpitMode): string {
  if (entry.action === defaultQueuedComposerActionForMode(mode)) {
    return entry.text;
  }
  return entry.text ? `/${entry.action} ${entry.text}` : `/${entry.action}`;
}

export function Cockpit({
  nav,
  theme,
  t,
  sse,
  initialBookId,
  forceNewSetup = false,
}: {
  readonly nav: Nav;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage> };
  readonly initialBookId?: string;
  readonly forceNewSetup?: boolean;
}) {
  const c = useColors(theme);
  const { data: booksData, loading: booksLoading, error: booksError, refetch: refetchBooks } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const { data: project, refetch: refetchProject } = useApi<ProjectSummary>("/project");
  const { data: llmCapabilities } = useApi<LlmCapabilitiesSummary>("/llm-capabilities");
  const { data: genreData } = useApi<{ genres: ReadonlyArray<GenreInfo> }>("/genres");
  const { data: activityData, refetch: refetchActivity } = useApi<{ entries: ReadonlyArray<SSEMessage> }>("/activity");
  const { data: createStatusData, refetch: refetchCreateStatus } = useApi<{ entries: ReadonlyArray<BookCreateJob> }>("/book-create-status");

  const [mode, setMode] = useState<CockpitMode>("discuss");
  const [selectedBookId, setSelectedBookId] = useState(forceNewSetup ? "" : initialBookId ?? "");
  const [selectedTruthFile, setSelectedTruthFile] = useState("");
  const [selectedChapterNumber, setSelectedChapterNumber] = useState<number | null>(null);
  const [showNewSetup, setShowNewSetup] = useState(forceNewSetup || !initialBookId);
  const [input, setInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [draftInputByThread, setDraftInputByThread] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(forceNewSetup || !initialBookId ? "setup" : "focus");
  const [queuedComposerEntries, setQueuedComposerEntries] = useState<CockpitComposerQueueState>({});
  const [cockpitPersistenceHydrated, setCockpitPersistenceHydrated] = useState(false);
  const queuedComposerEntriesRef = useRef<CockpitComposerQueueState>({});
  const queueDispatchingRef = useRef(false);
  const activeThreadKeyRef = useRef("");
  const runNextQueuedComposerEntryRef = useRef<(threadKey: string) => Promise<void>>(async () => undefined);

  const projectLanguage = resolveStudioLanguage(project?.language);
  const projectProvider = project?.provider ?? "";
  const projectModel = (project?.model ?? "").trim() || defaultModelForProvider(projectProvider, llmCapabilities) || "";
  const projectReasoningEffort = normalizeReasoningEffortForProvider(
    project?.reasoningEffort ?? "",
    projectProvider,
    llmCapabilities,
  );
  const setupScopeRef = useRef({
    projectLanguage,
    setupTitle: "",
    setupGenre: "",
    setupPlatform: "",
    setupBrief: "",
  });
  const books = booksData?.books ?? [];
  const selectedBook = books.find((book) => book.id === selectedBookId) ?? null;
  const genres = useMemo(
    () => (genreData?.genres ?? []).filter((genre) => genre.language === projectLanguage || genre.source === "project"),
    [genreData?.genres, projectLanguage],
  );
  const platformOptions = useMemo(() => platformOptionsForLanguage(projectLanguage), [projectLanguage]);
  const setupThreadKey = "project:setup";
  const activeThreadKey = useMemo(() => {
    if (mode === "binder") {
      return `${selectedBookId || "project"}:binder`;
    }
    if (mode === "discuss" && showNewSetup) {
      return setupThreadKey;
    }
    return `${selectedBookId || "project"}:${mode}`;
  }, [mode, selectedBookId, showNewSetup]);

  const { data: bookDetailData, error: bookDetailError, refetch: refetchBookDetail } = useApi<BookDetailResponse>(
    selectedBookId ? `/books/${selectedBookId}` : "",
  );
  const { data: truthListData, refetch: refetchTruthList } = useApi<{ files: ReadonlyArray<TruthFileSummary> }>(
    selectedBookId ? `/books/${selectedBookId}/truth` : "",
  );
  const { data: truthDetailData, refetch: refetchTruthDetail } = useApi<TruthFileDetail>(
    selectedBookId && selectedTruthFile ? `/books/${selectedBookId}/truth/${selectedTruthFile}` : "",
  );
  const { data: chapterDetailData, refetch: refetchChapterDetail } = useApi<ChapterDetailResponse>(
    selectedBookId && selectedChapterNumber
      ? `/books/${selectedBookId}/chapters/${selectedChapterNumber}`
      : "",
  );
  const {
    threads,
    proposals,
    activeMessages,
    activeProposal,
    hasPendingChanges,
    appendMessage,
    replaceThread,
    hydrateConversationState,
    clearProposal,
    sendDiscussPrompt,
    sendBinderPrompt,
    triggerDraftAction,
    handleApplyChange,
    handleApplyAll,
  } = useCockpitConversation({
    activeThreadKey,
    selectedBookId,
    selectedBookTitle: selectedBook?.title ?? null,
    selectedTruthFile,
    truthFiles: truthListData?.files ?? [],
    selectedChapterNumber,
    setupScopeRef,
    defaultChapterWordCount: bookDetailData?.book.chapterWordCount,
    t,
    setBusy,
    setError,
    setInspectorTab,
    setSelectedTruthFile,
    refetchTruthList,
    refetchTruthDetail,
    refetchBookDetail,
  });
  const setupThreadMessages = threads[setupThreadKey] ?? [];
  const setupConversation = useMemo(
    () => toSetupConversation(setupThreadMessages),
    [setupThreadMessages],
  );
  const {
    setupSession,
    setupTitle,
    setupGenre,
    setupPlatform,
    setupWords,
    setupTargetChapters,
    setupBrief,
    setSetupTitle,
    setSetupGenre,
    setSetupPlatform,
    setSetupWords,
    setSetupTargetChapters,
    setSetupBrief,
    autoCreatePhase,
    autoCreateFailedPhase,
    setupLlmForm,
    setSetupLlmForm,
    setupLlmSaving,
    setupLlmError,
    selectedFoundationPreviewKey,
    setSelectedFoundationPreviewKey,
    recentSetupSessions,
    loadingRecentSetupSessions,
    resumingSetupSessionId,
    setupRecoveryError,
    loadRecentSetupSessions,
    setupModelSuggestions,
    setupReasoningEfforts,
    setupSupportsReasoning,
    setupModelListId,
    setupLlmDirty,
    foundationPreviewTabs,
    activeFoundationPreview,
    setupDiscussionState,
    setupNotes,
    setupProposalDelta,
    setupDraftDirty,
    setupCanPrepareProposal,
    preparingSetupProposal,
    approvingSetup,
    preparingFoundationPreview,
    creatingBook,
    savingSetupReviewThreads,
    markSetupReady,
    startNewSetupSession,
    openSetupSession,
    saveSetupLlm,
    handlePrepareSetupProposal,
    handleApproveSetup,
    handlePrepareFoundationPreview,
    handleCreateSetup,
    handleSaveSetupReviewThreads,
    handleAutoCreateSetup,
    handleResumeSetupSession,
    handleDiscussSetup,
  } = useCockpitSetupSession({
    t,
    projectLanguage,
    projectProvider,
    projectModel,
    projectReasoningEffort,
    llmCapabilities,
    availableGenreIds: genres.map((genre) => genre.id),
    availablePlatformValues: platformOptions.map((option) => option.value),
    books,
    showNewSetup,
    setupThreadKey,
    setupConversation,
    appendMessage,
    replaceThread,
    clearProposal,
    sendDiscussPrompt,
    refetchProject,
    refetchBooks,
    refetchCreateStatus,
    setShowNewSetup,
    setMode,
    setInspectorTab,
    setSelectedBookId,
    setError,
  });
  setupScopeRef.current = {
    projectLanguage,
    setupTitle,
    setupGenre,
    setupPlatform,
    setupBrief,
  };

  const setComposerInput = (value: string, threadKey = activeThreadKeyRef.current || activeThreadKey) => {
    setInput(value);
    setDraftInputByThread((current) => {
      if (!value) {
        if (!(threadKey in current)) {
          return current;
        }
        const next = { ...current };
        delete next[threadKey];
        return next;
      }
      if (current[threadKey] === value) {
        return current;
      }
      return {
        ...current,
        [threadKey]: value,
      };
    });
  };

  useEffect(() => {
    setInput(draftInputByThread[activeThreadKey] ?? "");
  }, [activeThreadKey, draftInputByThread]);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const record = await loadAiSessionRecord<PersistedCockpitPayload>(COCKPIT_SESSION_ID);
      if (cancelled) {
        return;
      }
      const payload = record?.payload;
      if (!isPersistedCockpitPayload(payload)) {
        setCockpitPersistenceHydrated(true);
        return;
      }

      const restoredThreads = { ...(payload.threads ?? {}) };
      const restoredProposals = { ...(payload.proposals ?? {}) };
      const restoredQueue = { ...(payload.queuedComposerEntries ?? {}) };
      const restoredDraftInput = { ...(payload.draftInputByThread ?? {}) };
      if (forceNewSetup) {
        delete restoredThreads[setupThreadKey];
        delete restoredProposals[setupThreadKey];
        delete restoredQueue[setupThreadKey];
        delete restoredDraftInput[setupThreadKey];
      }

      hydrateConversationState({
        threads: restoredThreads,
        proposals: restoredProposals,
      });

      queuedComposerEntriesRef.current = restoredQueue;
      setQueuedComposerEntries(restoredQueue);
      setDraftInputByThread(restoredDraftInput);

      const restoredContext = payload.uiContext;
      if (!forceNewSetup && !initialBookId && typeof restoredContext.selectedBookId === "string") {
        setSelectedBookId(restoredContext.selectedBookId);
      }
      if (!forceNewSetup && (restoredContext.mode === "discuss" || restoredContext.mode === "binder" || restoredContext.mode === "draft")) {
        setMode(restoredContext.mode);
      }
      if (!forceNewSetup && typeof restoredContext.selectedTruthFile === "string") {
        setSelectedTruthFile(restoredContext.selectedTruthFile);
      }
      if (!forceNewSetup && (typeof restoredContext.selectedChapterNumber === "number" || restoredContext.selectedChapterNumber === null)) {
        setSelectedChapterNumber(restoredContext.selectedChapterNumber);
      }
      if (forceNewSetup) {
        setMode("discuss");
        setSelectedBookId("");
        setSelectedTruthFile("");
        setSelectedChapterNumber(null);
        setShowNewSetup(true);
        setInspectorTab("setup");
      } else {
        setShowNewSetup(initialBookId ? false : Boolean(restoredContext.showNewSetup));
      }
      if (!forceNewSetup && (
        restoredContext.inspectorTab === "focus"
        || restoredContext.inspectorTab === "changes"
        || restoredContext.inspectorTab === "setup"
        || restoredContext.inspectorTab === "activity"
      )) {
        setInspectorTab(restoredContext.inspectorTab);
      }

      if (!forceNewSetup && payload.setupDraft) {
        setSetupTitle(payload.setupDraft.title);
        setSetupGenre(payload.setupDraft.genre);
        setSetupPlatform(payload.setupDraft.platform);
        setSetupWords(payload.setupDraft.words);
        setSetupTargetChapters(payload.setupDraft.targetChapters);
        setSetupBrief(payload.setupDraft.brief);
        setSelectedFoundationPreviewKey(payload.setupDraft.selectedFoundationPreviewKey);
      }

      setCockpitPersistenceHydrated(true);
    };

    void hydrate().catch(() => {
      if (!cancelled) {
        setCockpitPersistenceHydrated(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    forceNewSetup,
    hydrateConversationState,
    initialBookId,
    setSelectedFoundationPreviewKey,
    setSetupBrief,
    setSetupGenre,
    setSetupPlatform,
    setSetupTargetChapters,
    setSetupTitle,
    setSetupWords,
  ]);

  useEffect(() => {
    if (initialBookId) {
      setSelectedBookId(initialBookId);
      setShowNewSetup(false);
    }
  }, [initialBookId]);

  useEffect(() => {
    if (!showNewSetup) {
      setInspectorTab((current) => current === "setup" ? "focus" : current);
    }
  }, [showNewSetup]);

  useEffect(() => {
    if (showNewSetup) {
      setSelectedBookId("");
      return;
    }

    if (!books.length) {
      setSelectedBookId("");
      return;
    }

    const stillExists = books.some((book) => book.id === selectedBookId);
    if (!selectedBookId || !stillExists) {
      setSelectedBookId(books[0]!.id);
    }
  }, [books, selectedBookId, showNewSetup]);

  useEffect(() => {
    const files = truthListData?.files ?? [];
    if (!files.length) {
      setSelectedTruthFile("");
      return;
    }

    const stillExists = files.some((file) => file.name === selectedTruthFile);
    if (!selectedTruthFile || !stillExists) {
      const preferred = files.find((file) => file.exists) ?? files[0]!;
      setSelectedTruthFile(preferred.name);
    }
  }, [selectedTruthFile, truthListData?.files]);

  useEffect(() => {
    const chapters = bookDetailData?.chapters ?? [];
    if (!chapters.length) {
      setSelectedChapterNumber(null);
      return;
    }

    const stillExists = chapters.some((chapter) => chapter.number === selectedChapterNumber);
    if (!selectedChapterNumber || !stillExists) {
      setSelectedChapterNumber(chapters[chapters.length - 1]!.number);
    }
  }, [bookDetailData?.chapters, selectedChapterNumber]);

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;

    if (shouldRefetchBookCollections(recent)) {
      void refetchBooks();
    }
    if (shouldRefetchBookCreateStatus(recent)) {
      void refetchCreateStatus();
    }
    if (selectedBookId && shouldRefetchBookView(recent, selectedBookId)) {
      void refetchBookDetail();
      void refetchTruthList();
      void refetchChapterDetail();
    }
    if (recent.event !== "ping") {
      void refetchActivity();
    }
  }, [
    refetchActivity,
    refetchBookDetail,
    refetchBooks,
    refetchChapterDetail,
    refetchCreateStatus,
    refetchTruthList,
    selectedBookId,
    sse.messages,
  ]);

  const searchFilteredItems = filterCockpitItems({
    query: searchQuery,
    books,
    truthFiles: truthListData?.files ?? [],
    chapters: bookDetailData?.chapters ?? [],
  });
  const visibleBooks = searchFilteredItems.books;
  const chapterItems = searchFilteredItems.chapters;
  const truthFiles = searchFilteredItems.truthFiles;
  const activityEntries = activityData?.entries.slice(0, 6) ?? [];
  const createJobs = createStatusData?.entries ?? [];
  const activeQueuedComposerEntries = queuedComposerEntries[activeThreadKey] ?? [];
  activeThreadKeyRef.current = activeThreadKey;
  const autoCreateBusy = autoCreatePhase !== null || preparingSetupProposal || approvingSetup || preparingFoundationPreview || creatingBook;
  const setupDiscussionLocked = isSetupDiscussionLocked({
    mode,
    showNewSetup,
    autoCreateBusy,
  });

  const updateQueuedComposerEntries = (
    updater: CockpitComposerQueueState | ((current: CockpitComposerQueueState) => CockpitComposerQueueState),
  ) => {
    setQueuedComposerEntries((current) => {
      const next = typeof updater === "function"
        ? (updater as (current: CockpitComposerQueueState) => CockpitComposerQueueState)(current)
        : updater;
      queuedComposerEntriesRef.current = next;
      return next;
    });
  };

  const executeComposerAction = async (action: ComposerAction, text: string) => {
    const createActionErrorKey = action === "create" ? getCockpitCreateActionErrorKey(showNewSetup) : null;

    if (action !== "draft" && action !== "write-next" && action !== "create" && !text) return;
    if (createActionErrorKey) {
      setError(t(createActionErrorKey));
      return;
    }
    if (setupDiscussionLocked && action === "discuss") {
      return;
    }
    if (autoCreateBusy && action === "create") {
      return;
    }

    setComposerInput("");
    if (action === "ask") {
      await sendBinderPrompt(text, "ask");
      return;
    }
    if (action === "propose") {
      await sendBinderPrompt(text, "propose");
      return;
    }
    if (action === "draft" || action === "write-next") {
      await triggerDraftAction(text, action);
      return;
    }
    if (action === "create") {
      await handleAutoCreateSetup();
      return;
    }
    await sendDiscussPrompt(text);
  };

  const handleSubmit = async (explicitAction?: ComposerAction, explicitInput?: string) => {
    const rawInput = explicitInput ?? input;
    const parsedCommand = explicitInput === undefined ? parseComposerCommand(rawInput) : null;
    const action = explicitAction ?? parsedCommand?.action ?? defaultActionForMode(mode);
    const text = (parsedCommand?.text ?? rawInput).trim();

    if (explicitInput === undefined) {
      setComposerInput("");
    }

    await executeComposerAction(action, text);
  };

  runNextQueuedComposerEntryRef.current = async (threadKey: string) => {
    if (queueDispatchingRef.current) {
      return;
    }

    const result = shiftNextQueuedComposerEntry(queuedComposerEntriesRef.current, threadKey);
    if (!result.entry) {
      return;
    }

    queueDispatchingRef.current = true;
    updateQueuedComposerEntries(result.state);
    try {
      await handleSubmit(result.entry.action, result.entry.text);
    } finally {
      queueDispatchingRef.current = false;
      if (
        activeThreadKeyRef.current === threadKey
        && shouldRunQueuedComposerEntry({
        busy: false,
        threadKey,
        queueState: queuedComposerEntriesRef.current,
      })
      ) {
        void runNextQueuedComposerEntryRef.current(threadKey);
      }
    }
  };

  const queueComposerInput = () => {
    const parsedCommand = parseComposerCommand(input);
    const action = parsedCommand?.action ?? defaultQueuedComposerActionForMode(mode);
    const text = parsedCommand?.text ?? input;
    let didQueue = false;

    updateQueuedComposerEntries((current) => {
      const next = appendQueuedComposerEntry(current, {
        threadKey: activeThreadKey,
        action,
        text,
      });
      didQueue = next !== current;
      return next;
    });

    if (!didQueue) {
      return;
    }

    setComposerInput("");
    if (!busy) {
      void runNextQueuedComposerEntryRef.current(activeThreadKey);
    }
  };

  const restoreQueuedComposerInput = () => {
    let restoredEntry: QueuedComposerEntry | null = null;

    updateQueuedComposerEntries((current) => {
      const result = popLastQueuedComposerEntry(current, activeThreadKey);
      restoredEntry = result.entry;
      return result.state;
    });

    if (!restoredEntry) {
      return;
    }

    setComposerInput(formatQueuedComposerEntryForInput(restoredEntry, mode));
  };

  useEffect(() => {
    if (!shouldRunQueuedComposerEntry({
      busy,
      threadKey: activeThreadKey,
      queueState: queuedComposerEntries,
    })) {
      return;
    }
    if (queueDispatchingRef.current) {
      return;
    }
    void runNextQueuedComposerEntryRef.current(activeThreadKey);
  }, [activeThreadKey, busy, queuedComposerEntries]);

  useEffect(() => {
    if (!cockpitPersistenceHydrated) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const record: PersistedAiSessionRecord<PersistedCockpitPayload> = {
        version: 1,
        sessionId: COCKPIT_SESSION_ID,
        kind: "cockpit",
        bookId: selectedBookId || null,
        scopeKey: COCKPIT_POINTER_SCOPE,
        updatedAt: Date.now(),
        payload: {
          threads,
          proposals,
          queuedComposerEntries,
          draftInputByThread,
          setupDraft: {
            title: setupTitle,
            genre: setupGenre,
            platform: setupPlatform,
            words: setupWords,
            targetChapters: setupTargetChapters,
            brief: setupBrief,
            selectedFoundationPreviewKey,
          },
          uiContext: {
            mode,
            selectedBookId,
            selectedTruthFile,
            selectedChapterNumber,
            showNewSetup,
            inspectorTab,
          },
        },
      };

      void saveAiSessionRecord(record)
        .then(() => {
          writeAiSessionPointer(COCKPIT_POINTER_SCOPE, COCKPIT_SESSION_ID);
        })
        .catch(() => undefined);
    }, 160);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    cockpitPersistenceHydrated,
    draftInputByThread,
    inspectorTab,
    mode,
    proposals,
    queuedComposerEntries,
    selectedBookId,
    selectedChapterNumber,
    selectedFoundationPreviewKey,
    selectedTruthFile,
    setupBrief,
    setupGenre,
    setupPlatform,
    setupTargetChapters,
    setupTitle,
    setupWords,
    showNewSetup,
    threads,
  ]);

  const canUseBinder = Boolean(selectedBookId && (truthListData?.files.length ?? 0) > 0);
  const canUseDraft = Boolean(selectedBookId);
  const modeLabel = mode === "binder" ? t("cockpit.binder") : mode === "draft" ? t("cockpit.draft") : t("cockpit.discuss");
  const selectedBookLabel = showNewSetup ? t("cockpit.newSetup") : selectedBook?.title ?? t("cockpit.noBook");
  const selectedTruthLabel = truthDetailData?.label ?? (selectedTruthFile || "—");
  const scopeDisplayLabel = mode === "binder" ? `${t("cockpit.selectedTruth")}: ${selectedTruthLabel}` : modeLabel;
  const selectedChapterLabel = selectedChapterNumber ? t("chapter.label").replace("{n}", `${selectedChapterNumber}`) : "—";
  const referenceChapterLabel = t("cockpit.referenceChapter");
  const setupStatusLabel = setupSession ? `${setupSession.status} · r${setupSession.revision}` : t("cockpit.newSetup");
  const setupDiscussionLabel = setupDiscussionState === "ready"
    ? t("cockpit.setupReadyForProposal")
    : t("cockpit.setupDiscussing");
  const setupMissingInfoLabels = setupNotes.missing.map((item) => {
    if (item === "title") return t("cockpit.setupMissingTitle");
    if (item === "genre") return t("cockpit.setupMissingGenre");
    if (item === "brief") return t("cockpit.setupMissingBrief");
    return t("cockpit.setupMissingDiscussion");
  });
  const focusPreviewHeading = mode === "draft" ? referenceChapterLabel : t("cockpit.selectedTruth");
  const focusPreviewTitle = mode === "draft"
    ? (chapterDetailData ? t("chapter.label").replace("{n}", `${chapterDetailData.chapterNumber}`) : referenceChapterLabel)
    : (truthDetailData?.label ?? t("cockpit.selectedTruth"));
  const focusPreviewContent = mode === "draft" ? (chapterDetailData?.content ?? "") : (truthDetailData?.content ?? "");
  const railVisibility = deriveCockpitRailVisibility({ mode, showNewSetup });
  const setupPrimaryAction = deriveSetupPrimaryAction({
    showNewSetup,
    discussionState: setupDiscussionState,
    draftDirty: setupDraftDirty,
    canPrepare: setupCanPrepareProposal,
    sessionStatus: setupSession?.status ?? null,
    hasFoundationPreview: Boolean(setupSession?.foundationPreview),
  });
  const statusStrip = deriveCockpitStatusStrip({
    provider: projectProvider,
    model: projectModel,
    reasoningEffort: projectReasoningEffort,
    mode,
    selectedBookLabel,
    selectedTruthLabel,
    selectedChapterLabel,
    showNewSetup,
    busy,
    preparingSetupProposal,
    approvingSetup,
    preparingFoundationPreview,
    creatingBook,
    createJobs,
    setupDiscussionState,
    setupSessionStatus: setupSession?.status ?? null,
    activityEntries,
    activeRun: bookDetailData?.activeRun ?? null,
  });
  const statusStageLabel = t(`cockpit.stage.${statusStrip.stage}`);
  const statusModelLabel = statusStrip.modelLabel === "-"
    ? (statusStrip.providerLabel || "-")
    : statusStrip.providerLabel
      ? `${statusStrip.providerLabel} · ${statusStrip.modelLabel}`
      : statusStrip.modelLabel;
  const statusReasoningLabel = statusStrip.reasoningLabel
    ? formatReasoningEffortLabel(statusStrip.reasoningLabel, t)
    : null;
  const composerHint = mode === "binder"
    ? t("cockpit.binderCommandHint")
    : mode === "draft"
      ? t("cockpit.draftCommandHint")
      : t("cockpit.discussCommandHint");
  const composerInputId = "cockpit-composer";
  const composerHintId = "cockpit-composer-hint";
  const focusTabId = "cockpit-tab-focus";
  const changesTabId = "cockpit-tab-changes";
  const setupTabId = "cockpit-tab-setup";
  const activityTabId = "cockpit-tab-activity";
  const focusPanelId = "cockpit-panel-focus";
  const changesPanelId = "cockpit-panel-changes";
  const setupPanelId = "cockpit-panel-setup";
  const activityPanelId = "cockpit-panel-activity";
  const scopeChips = [
    { accent: true, label: t("cockpit.scope"), value: scopeDisplayLabel },
    { label: t("cockpit.selectBook"), value: selectedBookLabel },
    ...(!showNewSetup && mode === "binder" ? [{ label: t("cockpit.selectedTruth"), value: selectedTruthLabel }] : []),
    ...(!showNewSetup && mode === "draft" ? [{ label: referenceChapterLabel, value: selectedChapterLabel }] : []),
    ...(showNewSetup ? [{ label: t("cockpit.setupTitle"), value: setupStatusLabel }] : []),
    { accent: true, label: t("cockpit.statusTarget"), value: statusStrip.targetLabel },
    ...(hasPendingChanges ? [{ accent: true, label: t("cockpit.pendingChanges"), value: `${activeProposal?.changes.length ?? 0}` }] : []),
  ];
  const statusPills = buildCockpitStatusFacts({
    stage: statusStrip.stage,
    stageLabel: statusStageLabel,
    targetLabel: statusStrip.targetLabel,
    modelLabel: statusModelLabel,
    reasoningLabel: statusReasoningLabel,
    labels: {
      stage: t("cockpit.statusStage"),
      target: t("cockpit.statusTarget"),
      model: t("cockpit.statusModel"),
      reasoning: t("config.reasoningLevel"),
    },
  });
  const activeEditorTab =
    inspectorTab === "changes" ? "diffs"
      : inspectorTab === "activity" ? "reviews"
        : mode === "draft" ? "manuscript"
          : "outline";
  const tabIds = {
    focusTabId,
    changesTabId,
    setupTabId,
    activityTabId,
    focusPanelId,
    changesPanelId,
    setupPanelId,
    activityPanelId,
  };
  const needsFreshAutoCreateProposal = !setupSession || setupDraftDirty;
  const autoCreateAllowed = Boolean(
    setupTitle.trim()
    && setupGenre
    && (!needsFreshAutoCreateProposal || setupCanPrepareProposal),
  );
  const setupPrimaryActionDisabled = isSetupPrimaryActionDisabled({
    action: setupPrimaryAction,
    setupDiscussionLocked,
    setupTitle,
    setupGenre,
    setupDiscussionState,
    autoCreateAllowed,
    autoCreateBusy,
    setupCanPrepareProposal,
    preparingSetupProposal,
    approvingSetup,
    preparingFoundationPreview,
    creatingBook,
    setupDraftDirty,
    setupSessionStatus: setupSession?.status ?? null,
    hasFoundationPreview: Boolean(setupSession?.foundationPreview),
  });
  const runDisabled = isCockpitRunDisabled({
    showNewSetup,
    setupPrimaryActionDisabled,
    busy,
    mode,
    canUseBinder,
    canUseDraft,
  });
  const refreshCockpitData = () => {
    void refetchBooks();
    void refetchCreateStatus();
    void refetchBookDetail();
    void refetchTruthList();
    void refetchTruthDetail();
    void refetchChapterDetail();
    void refetchActivity();
    void loadRecentSetupSessions();
  };
  const focusComposer = () => {
    document.getElementById(composerInputId)?.focus();
  };
  const focusWorkspace = () => {
    setInspectorTab(showNewSetup ? "setup" : "focus");
  };
  const openManuscriptView = () => {
    if (!selectedBookId) {
      setError(t("cockpit.noBook"));
      return;
    }
    setShowNewSetup(false);
    setMode("draft");
    setInspectorTab("focus");
  };
  const openOutlineView = () => {
    setMode("discuss");
    setInspectorTab(showNewSetup ? "setup" : "focus");
  };
  const openDiffsView = () => {
    setInspectorTab("changes");
  };
  const openReviewsView = () => {
    setInspectorTab("activity");
  };
  const openSystemHealth = () => {
    setInspectorTab("activity");
    refreshCockpitData();
  };
  const runSetupAction = async (action: SetupPrimaryAction) => {
    switch (action) {
      case "discuss":
        await handleDiscussSetup();
        return;
      case "mark-ready":
        markSetupReady();
        return;
      case "auto-create":
        await handleAutoCreateSetup();
        return;
      case "prepare-proposal":
        await handlePrepareSetupProposal();
        return;
      case "approve":
        await handleApproveSetup();
        return;
      case "preview-foundation":
        await handlePrepareFoundationPreview();
        return;
      case "create":
        await handleCreateSetup();
        return;
      default: {
        const exhaustiveAction: never = action;
        return exhaustiveAction;
      }
    }
  };
  const setupActionLabel = (action: SetupPrimaryAction) => {
    switch (action) {
      case "discuss":
        return t("cockpit.discussSetup");
      case "mark-ready":
        return t("cockpit.setupMarkReady");
      case "auto-create":
        return t("cockpit.createNow");
      case "prepare-proposal":
        return t("cockpit.prepareSetupProposal");
      case "approve":
        return t("cockpit.approveCreate");
      case "preview-foundation":
        return t("cockpit.previewFoundation");
      case "create":
        return t("cockpit.createFromSetup");
      default: {
        const exhaustiveAction: never = action;
        return exhaustiveAction;
      }
    }
  };
  const runCurrentAction = () => {
    if (runDisabled) {
      return;
    }
    if (showNewSetup) {
      void runSetupAction(setupPrimaryAction);
      return;
    }
    if (mode === "draft") {
      void handleSubmit("draft");
      return;
    }
    if (!input.trim()) {
      focusComposer();
      setError(t("common.enterCommand"));
      return;
    }
    void handleSubmit(mode === "binder" ? "ask" : "discuss");
  };
  const runLabel = showNewSetup
    ? setupActionLabel(setupPrimaryAction)
    : mode === "draft"
      ? t("cockpit.generateDraft")
      : mode === "binder"
        ? t("cockpit.ask")
        : t("cockpit.discuss");

  const renderSetupActionButton = (action: SetupPrimaryAction, primary = false) => {
    const className = primary ? c.btnPrimary : c.btnSecondary;

    switch (action) {
      case "discuss":
        return (
          <ActionButton
            key={action}
            disabled={setupDiscussionLocked}
            className={className}
            icon={<Bot size={14} />}
            label={t("cockpit.discussSetup")}
            onClick={() => void handleDiscussSetup()}
          />
        );
      case "mark-ready":
        return (
          <ActionButton
            key={action}
            disabled={!setupTitle.trim() || !setupGenre || setupDiscussionState === "ready"}
            className={className}
            icon={<Check size={14} />}
            label={t("cockpit.setupMarkReady")}
            onClick={() => markSetupReady()}
          />
        );
      case "auto-create":
        return (
          <ActionButton
            key={action}
            disabled={!autoCreateAllowed || autoCreateBusy}
            className={className}
            icon={autoCreateBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            label={t("cockpit.createNow")}
            onClick={() => void handleAutoCreateSetup()}
          />
        );
      case "prepare-proposal":
        return (
          <ActionButton
            key={action}
            disabled={!setupCanPrepareProposal || preparingSetupProposal || approvingSetup || preparingFoundationPreview || creatingBook}
            className={className}
            icon={preparingSetupProposal ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            label={t("cockpit.prepareSetupProposal")}
            onClick={() => void handlePrepareSetupProposal()}
          />
        );
      case "approve":
        return (
          <ActionButton
            key={action}
            disabled={setupDraftDirty || approvingSetup || !setupSession || setupSession.status !== "proposed"}
            className={className}
            icon={approvingSetup ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            label={t("cockpit.approveCreate")}
            onClick={() => void handleApproveSetup()}
          />
        );
      case "preview-foundation":
        return (
          <ActionButton
            key={action}
            disabled={setupDraftDirty || preparingFoundationPreview || creatingBook || !setupSession || setupSession.status !== "approved"}
            className={className}
            icon={preparingFoundationPreview ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            label={t("cockpit.previewFoundation")}
            onClick={() => void handlePrepareFoundationPreview()}
          />
        );
      case "create":
        return (
          <ActionButton
            key={action}
            disabled={setupDraftDirty || creatingBook || !setupSession || setupSession.status !== "approved" || !setupSession.foundationPreview}
            className={className}
            icon={creatingBook ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            label={t("cockpit.createFromSetup")}
            onClick={() => void handleCreateSetup()}
          />
        );
      default: {
        const exhaustiveAction: never = action;
        return exhaustiveAction;
      }
    }
  };

  const secondarySetupActions: ReadonlyArray<SetupPrimaryAction> = (
    showNewSetup
      ? [
        "discuss",
        "mark-ready",
        "auto-create",
        "prepare-proposal",
        "approve",
        "preview-foundation",
        "create",
      ]
      : [
        "discuss",
        "mark-ready",
      ]
  ).filter((action): action is SetupPrimaryAction => action !== setupPrimaryAction);
  const setupQuickStartPanel = showNewSetup && mode === "discuss"
    ? {
      badge: t("cockpit.setupTitle"),
      title: selectedBookLabel,
      status: setupDiscussionLabel,
      description: t("cockpit.messagesEmpty"),
      note: t("cockpit.setupReadyHint"),
      missingInfoLabel: t("cockpit.setupMissingInfo"),
      missingInfo: setupMissingInfoLabels,
      actions: [
        renderSetupActionButton(setupPrimaryAction, true),
        ...(nav.toBookCreate ? [
          <ActionButton
            key="legacy-create"
            className={c.btnSecondary}
            icon={<ArrowRight size={14} />}
            label={t("cockpit.legacyCreate")}
            onClick={() => nav.toBookCreate?.()}
          />,
        ] : []),
      ],
    }
    : null;
  const editorPanel = (() => {
    if (activeEditorTab === "manuscript") {
      return (
        <section className="studio-cockpit-editor-card" aria-label="Manuscript preview">
          <div className="studio-cockpit-editor-card-header">
            <span>MANUSCRIPT</span>
            <strong>{selectedChapterLabel}</strong>
          </div>
          {chapterDetailData?.content ? (
            <div className="studio-cockpit-editor-card-body whitespace-pre-wrap">
              {chapterDetailData.content.slice(0, 1400)}
              {chapterDetailData.content.length > 1400 ? "…" : ""}
            </div>
          ) : (
            <div className="studio-cockpit-editor-card-empty">{t("cockpit.noBook")}</div>
          )}
        </section>
      );
    }
    if (activeEditorTab === "diffs") {
      return (
        <section className="studio-cockpit-editor-card" aria-label="Pending diffs">
          <div className="studio-cockpit-editor-card-header">
            <span>DIFFS</span>
            <strong>{activeProposal?.changes.length ?? 0}</strong>
          </div>
          {activeProposal?.changes.length ? (
            <div className="space-y-2">
              {activeProposal.changes.slice(0, 4).map((change) => (
                <div key={change.fileName} className="studio-cockpit-editor-row">
                  <span>{change.label}</span>
                  <button type="button" onClick={() => void handleApplyChange(change.fileName, change.content)}>
                    {t("cockpit.apply")}
                  </button>
                </div>
              ))}
              <button type="button" className={`mt-2 rounded-xl px-3 py-2 text-xs font-semibold ${c.btnPrimary}`} onClick={() => handleApplyAll()}>
                {t("cockpit.applyAll")}
              </button>
            </div>
          ) : (
            <div className="studio-cockpit-editor-card-empty">{t("cockpit.commandHint")}</div>
          )}
        </section>
      );
    }
    if (activeEditorTab === "reviews") {
      return (
        <section className="studio-cockpit-editor-card" aria-label="Recent reviews and activity">
          <div className="studio-cockpit-editor-card-header">
            <span>REVIEWS</span>
            <strong>{activityEntries.length}</strong>
          </div>
          {activityEntries.length ? (
            <div className="space-y-2">
              {activityEntries.map((entry, index) => (
                <div key={`${entry.event}-${entry.timestamp}-${index}`} className="studio-cockpit-editor-row">
                  <span>{entry.event}</span>
                  <small>{makeTruthPreview(makeActivityDataPreview(entry.data), 96)}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="studio-cockpit-editor-card-empty">{t("app.alertsEmpty")}</div>
          )}
        </section>
      );
    }
    return (
      <section className="studio-cockpit-editor-card" aria-label="Outline workspace">
        <div className="studio-cockpit-editor-card-header">
          <span>OUTLINE</span>
          <strong>{showNewSetup ? setupDiscussionLabel : `${chapterItems.length}`}</strong>
        </div>
        {showNewSetup ? (
          <div className="studio-cockpit-editor-card-body">
            <div className="font-semibold text-foreground">{setupTitle || t("cockpit.newSetup")}</div>
            <div className="mt-2 text-muted-foreground">{setupNotes.creativeBriefPreview || t("cockpit.setupBrief")}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {setupMissingInfoLabels.map((item) => (
                <span key={item} className="rounded-full studio-badge-soft px-2 py-1 text-[11px]">{item}</span>
              ))}
            </div>
          </div>
        ) : chapterItems.length ? (
          <div className="space-y-2">
            {[...chapterItems].reverse().slice(0, 6).map((chapter) => (
              <button
                key={chapter.number}
                type="button"
                className="studio-cockpit-editor-row w-full text-left"
                onClick={() => {
                  setSelectedChapterNumber(chapter.number);
                  setMode("draft");
                  setInspectorTab("focus");
                }}
              >
                <span>{t("chapter.label").replace("{n}", `${chapter.number}`)}</span>
                <small>{chapter.title || renderChapterStatus(chapter.status)}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="studio-cockpit-editor-card-empty">{t("cockpit.noBook")}</div>
        )}
      </section>
    );
  })();

  return (
    <div className="studio-cockpit-page space-y-6 fade-in">
      <CockpitHeaderSection
        t={t}
        nav={nav}
        booksLoading={booksLoading}
        booksError={booksError}
        createJobs={createJobs}
        bookCount={books.length}
        selectedBookLabel={selectedBookLabel}
        modeLabel={modeLabel}
        statusStageLabel={statusStageLabel}
        statusTargetLabel={statusStrip.targetLabel}
        statusModelLabel={statusModelLabel}
        selectedBookId={selectedBookId}
        runLabel={runLabel}
        runDisabled={runDisabled}
        onRun={runCurrentAction}
        onRefresh={refreshCockpitData}
        onFocusWorkspace={focusWorkspace}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        classes={{ btnPrimary: c.btnPrimary, btnSecondary: c.btnSecondary, error: c.error }}
      />

      <section className="studio-cockpit-shell grid gap-5">
        <CockpitLeftRail
          t={t}
          books={visibleBooks}
          showNewSetup={showNewSetup}
          selectedBookId={selectedBookId}
          mode={mode}
          railVisibility={railVisibility}
          referenceChapterLabel={referenceChapterLabel}
          truthFiles={truthFiles}
          selectedTruthFile={selectedTruthFile}
          chapterItems={chapterItems}
          selectedChapterNumber={selectedChapterNumber}
          onNewSetup={() => {
            openSetupSession();
          }}
          onSelectBook={(bookId) => {
            setShowNewSetup(false);
            setSelectedBookId(bookId);
            setInspectorTab("focus");
          }}
          onModeChange={(nextMode) => {
            setMode(nextMode);
            setInspectorTab(nextMode === "discuss" ? (showNewSetup ? "setup" : "focus") : "focus");
          }}
          onSelectTruthFile={(name) => {
            setSelectedTruthFile(name);
            setMode("binder");
            setInspectorTab("focus");
          }}
          onSelectChapter={(chapterNumber) => {
            setSelectedChapterNumber(chapterNumber);
            setMode("draft");
            setInspectorTab("focus");
          }}
          ModeButton={ModeButton}
          renderChapterStatus={renderChapterStatus}
          makeTruthPreview={makeTruthPreview}
        />

        <CockpitMainConversation
          t={t}
          mode={mode}
          activeEditorTab={activeEditorTab}
          busy={busy || setupDiscussionLocked}
          error={error}
          input={input}
          scopeChips={scopeChips}
          hasPendingChanges={hasPendingChanges}
          statusPills={statusPills}
          status={statusStrip}
          activeMessages={activeMessages}
          quickStartPanel={setupQuickStartPanel}
          editorPanel={editorPanel}
          composerInputId={composerInputId}
          composerHintId={composerHintId}
          composerHint={composerHint}
          canUseBinder={canUseBinder}
          canUseDraft={canUseDraft}
          hasPendingProposalChanges={Boolean(activeProposal?.changes.length)}
          queuedComposerEntries={activeQueuedComposerEntries}
          onInputChange={setComposerInput}
          onQueueComposerInput={queueComposerInput}
          onRestoreQueuedComposerInput={restoreQueuedComposerInput}
          onSubmit={handleSubmit}
          onApplyAll={handleApplyAll}
          onOpenManuscript={openManuscriptView}
          onOpenOutline={openOutlineView}
          onOpenDiffs={openDiffsView}
          onOpenReviews={openReviewsView}
          classes={{ btnPrimary: c.btnPrimary, btnSecondary: c.btnSecondary, input: c.input, error: c.error }}
          ActionButton={ActionButton}
          ScopeChip={ScopeChip}
          StatusPill={StatusPill}
          MessageBubble={MessageBubble}
        />

        {/* Source contract for routing test: label={t("cockpit.legacyCreate")} */}
        <CockpitInspectorPanel
          t={t}
          inspectorTab={inspectorTab}
          setInspectorTab={setInspectorTab}
          hasPendingChanges={hasPendingChanges}
          pendingChangesCount={activeProposal?.changes.length ?? 0}
          selectedBookLabel={selectedBookLabel}
          setupStatusLabelFallback={setupStatusLabel}
          legacyCreateLabel={t("cockpit.legacyCreate")}
          focusPanel={{
            heading: focusPreviewHeading,
            title: focusPreviewTitle,
            content: focusPreviewContent,
          }}
          focusPanelEmptyLabel={t("cockpit.noBook")}
          setupTabEmptyLabel={t("cockpit.setupProposalEmpty")}
          changesPanel={{
            changes: activeProposal?.changes ?? [],
            onApplyChange: (fileName, content) => void handleApplyChange(fileName, content),
          }}
          setupPanel={{
            loadingRecentSetupSessions,
            recentSetupSessions,
            setupRecoveryError,
            onResumeSetupSession: (session) => void handleResumeSetupSession(session),
            setupModelSuggestions,
            setupModelListId,
            setupSupportsReasoning,
            setupLlmSaving,
            setupLlmError,
            setupLlmFormModel: setupLlmForm.model,
            setupLlmFormReasoningEffort: setupLlmForm.reasoningEffort,
            projectProviderLabel: projectProvider ? shortLabelForProvider(projectProvider) : "",
            projectModelLabel: projectProvider ? compactModelLabel(projectProvider, projectModel || "-") : "-",
            projectModelPlaceholder: defaultModelForProvider(projectProvider, llmCapabilities) || t("config.model"),
            onSetSetupLlmFormModel: (value) => setSetupLlmForm((current) => ({ ...current, model: value })),
            onSetSetupLlmFormReasoningEffort: (value) => setSetupLlmForm((current) => ({ ...current, reasoningEffort: value })),
            onSaveSetupLlm: () => void saveSetupLlm(),
            setupReasons: setupReasoningEfforts,
            setupReasoningEfforts,
            setupTitle,
            setupGenre,
            setupPlatform,
            setupWords,
            setupTargetChapters,
            setupBrief,
            onSetSetupTitle: setSetupTitle,
            onSetSetupGenre: setSetupGenre,
            onSetSetupPlatform: setSetupPlatform,
            onSetSetupWords: setSetupWords,
            onSetSetupTargetChapters: setSetupTargetChapters,
            onSetSetupBrief: setSetupBrief,
            genres: genres.map((genre) => ({ id: genre.id, name: genre.name })),
            platformOptions,
            onLegacyCreate: nav.toBookCreate ? () => nav.toBookCreate?.() : null,
            setupNotes,
            setupMissingInfoLabels,
            setupDiscussionLabel,
            setupStatusLabel,
            setupSession,
            onStartNewSetup: startNewSetupSession,
            setupDraftDirty,
            setupProposalDelta,
            setupPrimaryAction,
            secondarySetupActions,
            foundationPreviewTabs,
            selectedFoundationPreviewKey,
            onSetSelectedFoundationPreviewKey: (key) => setSelectedFoundationPreviewKey(key as typeof selectedFoundationPreviewKey),
            savingSetupReviewThreads,
            onSaveSetupReviewThreads: (threads, options) => void handleSaveSetupReviewThreads(threads, options),
            renderSetupActionButton,
            resumingSetupSessionId,
            autoCreatePhase,
            autoCreateFailedPhase,
            onRetryAutoCreate: () => void handleAutoCreateSetup(),
          }}
          activityEntries={activityEntries}
          activityEmptyLabel={t("app.alertsEmpty")}
          onOpenSystemHealth={openSystemHealth}
          classNames={{ btnPrimary: c.btnPrimary, btnSecondary: c.btnSecondary, input: c.input, error: c.error }}
          ids={tabIds}
          InspectorTabButton={InspectorTabButton}
          ActionButton={ActionButton}
        />
      </section>

      {bookDetailError && selectedBookId && !showNewSetup && (
        <div className="rounded-2xl border border-border/50 bg-card/70 px-5 py-4 text-sm text-muted-foreground">
          {bookDetailError}
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition-all ${
        active
          ? "studio-chip-accent studio-surface-active text-foreground font-semibold"
          : "studio-chip studio-surface-hover"
      } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function InspectorTabButton({
  tabId,
  panelId,
  active,
  icon,
  label,
  badge,
  onClick,
}: {
  readonly tabId: string;
  readonly panelId: string;
  readonly active: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly badge?: number;
  readonly onClick: () => void;
}) {
  return (
    <button
      id={tabId}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      onClick={onClick}
      className={`studio-inspector-tab inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold ${active ? "studio-chip-accent studio-surface-active text-foreground" : "studio-chip studio-surface-hover"}`}
    >
      {icon}
      <span>{label}</span>
      {typeof badge === "number" ? (
        <span className="rounded-full studio-badge-soft px-1.5 py-0.5 text-[10px] font-bold">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function ScopeChip({
  label,
  value,
  accent = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly accent?: boolean;
}) {
  return (
    <div className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-2 text-xs ${accent ? "studio-chip-accent studio-surface-active" : "studio-chip"}`}>
      <span className="shrink-0 font-bold uppercase tracking-[0.14em] text-muted-foreground/90">
        {label}
      </span>
      <span className="truncate text-sm font-semibold text-foreground/90">
        {value}
      </span>
    </div>
  );
}

function StatusPill({
  label,
  value,
  accent = false,
}: {
  readonly label?: string;
  readonly value: string;
  readonly accent?: boolean;
}) {
  return (
    <div className={`studio-cockpit-status-fact ${accent ? "is-active" : ""}`}>
      {label ? (
        <span className="studio-cockpit-status-fact-label">
          {label}
        </span>
      ) : null}
      <span className="studio-cockpit-status-fact-value">
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  disabled = false,
  className = "studio-chip",
  icon,
  label,
  onClick,
}: {
  readonly disabled?: boolean;
  readonly className?: string;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-transform duration-200 ${className} ${disabled ? "cursor-not-allowed opacity-45" : "hover:-translate-y-[1px]"} `}
    >
      {icon}
      {label}
    </button>
  );
}

function MessageBubble({ message }: { readonly message: CockpitMessage }) {
  const role = getCockpitMessageRolePresentation(message.role);

  return (
    <div className={`studio-cockpit-message ${role.className}`}>
      <div className="studio-cockpit-message-meta" data-align={role.alignLabel}>
        <span>{role.label}</span>
      </div>
      <div className="studio-cockpit-message-body whitespace-pre-wrap break-words">
        {message.content}
      </div>
    </div>
  );
}
