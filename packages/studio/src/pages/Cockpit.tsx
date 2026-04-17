import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import type { SSEMessage } from "../hooks/use-sse";
import { resolveStudioLanguage } from "../shared/language";
import { platformOptionsForLanguage } from "../shared/book-create-form";
import type {
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
import { CockpitInspectorPanel } from "./cockpit/CockpitInspectorPanel";
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
  type InspectorTab,
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
}: {
  readonly nav: Nav;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage> };
  readonly initialBookId?: string;
}) {
  const c = useColors(theme);
  const { data: booksData, loading: booksLoading, error: booksError, refetch: refetchBooks } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const { data: project, refetch: refetchProject } = useApi<ProjectSummary>("/project");
  const { data: llmCapabilities } = useApi<LlmCapabilitiesSummary>("/llm-capabilities");
  const { data: genreData } = useApi<{ genres: ReadonlyArray<GenreInfo> }>("/genres");
  const { data: activityData, refetch: refetchActivity } = useApi<{ entries: ReadonlyArray<SSEMessage> }>("/activity");
  const { data: createStatusData, refetch: refetchCreateStatus } = useApi<{ entries: ReadonlyArray<BookCreateJob> }>("/book-create-status");

  const [mode, setMode] = useState<CockpitMode>("discuss");
  const [selectedBookId, setSelectedBookId] = useState(initialBookId ?? "");
  const [selectedTruthFile, setSelectedTruthFile] = useState("");
  const [selectedChapterNumber, setSelectedChapterNumber] = useState<number | null>(null);
  const [showNewSetup, setShowNewSetup] = useState(!initialBookId);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(!initialBookId ? "setup" : "focus");
  const [queuedComposerEntries, setQueuedComposerEntries] = useState<CockpitComposerQueueState>({});
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
    activeMessages,
    activeProposal,
    hasPendingChanges,
    appendMessage,
    replaceThread,
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
    markSetupReady,
    saveSetupLlm,
    handlePrepareSetupProposal,
    handleApproveSetup,
    handlePrepareFoundationPreview,
    handleCreateSetup,
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

  const chapterItems = bookDetailData?.chapters ?? [];
  const truthFiles = truthListData?.files ?? [];
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

    setInput("");
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
      setInput("");
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

    setInput("");
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

    setInput(formatQueuedComposerEntryForInput(restoredEntry, mode));
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
  const statusPills = [
    { accent: true, label: t("cockpit.statusStage"), value: statusStageLabel },
    { label: t("cockpit.statusTarget"), value: statusStrip.targetLabel },
    { label: t("cockpit.statusModel"), value: statusModelLabel },
    ...(statusReasoningLabel ? [{ label: t("config.reasoningLevel"), value: statusReasoningLabel }] : []),
  ];
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

  return (
    <div className="space-y-6 fade-in">
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
        onRefresh={() => {
          void refetchBooks();
          void refetchCreateStatus();
          void refetchBookDetail();
          void refetchTruthList();
          void refetchTruthDetail();
          void refetchChapterDetail();
          void refetchActivity();
          void loadRecentSetupSessions();
        }}
        classes={{ btnPrimary: c.btnPrimary, btnSecondary: c.btnSecondary, error: c.error }}
      />

      <section className="studio-cockpit-shell grid gap-5">
        <CockpitLeftRail
          t={t}
          books={books}
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
            setShowNewSetup(true);
            setMode("discuss");
            setInspectorTab("setup");
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
          busy={busy || setupDiscussionLocked}
          error={error}
          input={input}
          scopeChips={scopeChips}
          hasPendingChanges={hasPendingChanges}
          statusPills={statusPills}
          status={statusStrip}
          activeMessages={activeMessages}
          quickStartPanel={setupQuickStartPanel}
          composerInputId={composerInputId}
          composerHintId={composerHintId}
          composerHint={composerHint}
          canUseBinder={canUseBinder}
          canUseDraft={canUseDraft}
          hasPendingProposalChanges={Boolean(activeProposal?.changes.length)}
          queuedComposerEntries={activeQueuedComposerEntries}
          onInputChange={setInput}
          onQueueComposerInput={queueComposerInput}
          onRestoreQueuedComposerInput={restoreQueuedComposerInput}
          onSubmit={handleSubmit}
          onApplyAll={handleApplyAll}
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
            setupDraftDirty,
            setupProposalDelta,
            setupPrimaryAction,
            secondarySetupActions,
            foundationPreviewTabs,
            selectedFoundationPreviewKey,
            onSetSelectedFoundationPreviewKey: (key) => setSelectedFoundationPreviewKey(key as typeof selectedFoundationPreviewKey),
            renderSetupActionButton,
            resumingSetupSessionId,
            autoCreatePhase,
            autoCreateFailedPhase,
            onRetryAutoCreate: () => void handleAutoCreateSetup(),
          }}
          activityEntries={activityEntries}
          activityEmptyLabel={t("app.alertsEmpty")}
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
    <div className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-[11px] ${accent ? "studio-chip-accent studio-surface-active" : "studio-chip"}`}>
      {label ? (
        <span className="shrink-0 font-bold uppercase tracking-[0.14em] text-muted-foreground/90">
          {label}
        </span>
      ) : null}
      <span className="truncate text-sm font-semibold text-foreground/90">
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
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`studio-cockpit-message max-w-[88%] px-4 py-3 text-sm leading-7 shadow-sm ${
        isUser
          ? "is-user"
          : isSystem
            ? "is-system"
            : "is-assistant"
      }`}>
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    </div>
  );
}
