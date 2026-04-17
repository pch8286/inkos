import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createIdempotencyKey, fetchJson, postApi, putApi } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";
import { defaultChapterWordsForLanguage, pickValidValue } from "../shared/book-create-form";
import type {
  BookSetupConversationEntry,
  BookSetupCreateRequest,
  BookSetupRevisionRequest,
  BookSetupSessionPayload,
} from "../shared/contracts";
import {
  defaultModelForProvider,
  modelSuggestionsForProvider,
  normalizeReasoningEffortForProvider,
  reasoningEffortsForProvider,
  supportsReasoningEffort,
  type LlmCapabilitiesSummary,
  type ReasoningEffort,
} from "../shared/llm";
import {
  buildSetupDraftFingerprint,
  buildSetupNotes,
  buildSetupProposalDeltaSummary,
  canPrepareSetupProposal,
  deriveSetupDiscussionState,
} from "./cockpit-setup-state";
import type { CockpitMode } from "./cockpit-ui-state";
import {
  buildFoundationPreviewTabs,
  buildSetupCreateRequestFingerprint,
  createMessage,
  isBookSetupRevisionMismatchMessage,
  parseSetupSessions,
  type BookSetupSessionSummary,
  type CockpitMessage,
  type FoundationPreviewKey,
  type InspectorTab,
} from "./cockpit-shared";
import { runSetupAutoCreate, type SetupAutoCreatePhase } from "./cockpit-setup-autocreate";

interface SetupLlmForm {
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
}

interface UseCockpitSetupSessionInput {
  readonly t: TFunction;
  readonly projectLanguage: "ko" | "zh" | "en";
  readonly projectProvider: string;
  readonly projectModel: string;
  readonly projectReasoningEffort: ReasoningEffort;
  readonly llmCapabilities: LlmCapabilitiesSummary | null | undefined;
  readonly availableGenreIds: ReadonlyArray<string>;
  readonly availablePlatformValues: ReadonlyArray<string>;
  readonly books: ReadonlyArray<{ readonly id: string }>;
  readonly showNewSetup: boolean;
  readonly setupThreadKey: string;
  readonly setupConversation: ReadonlyArray<BookSetupConversationEntry>;
  readonly appendMessage: (key: string, message: CockpitMessage) => void;
  readonly replaceThread: (key: string, messages: ReadonlyArray<CockpitMessage>) => void;
  readonly clearProposal: (key: string) => void;
  readonly sendDiscussPrompt: (
    rawText: string,
    options?: Readonly<{ readonly threadKey?: string; readonly forceSetup?: boolean }>,
  ) => Promise<void>;
  readonly refetchProject: () => Promise<unknown> | unknown;
  readonly refetchBooks: () => Promise<unknown> | unknown;
  readonly refetchCreateStatus: () => Promise<unknown> | unknown;
  readonly setShowNewSetup: (value: boolean) => void;
  readonly setMode: (mode: CockpitMode) => void;
  readonly setInspectorTab: (tab: InspectorTab) => void;
  readonly setSelectedBookId: (bookId: string) => void;
  readonly setError: (error: string | null) => void;
}

export function buildHiddenSetupResetState(projectLanguage: "ko" | "zh" | "en") {
  return {
    setupTitle: "",
    setupGenre: "",
    setupPlatform: "",
    setupWords: defaultChapterWordsForLanguage(projectLanguage),
    setupTargetChapters: "200",
    setupBrief: "",
    selectedFoundationPreviewKey: "storyBible" as const,
    autoCreatePhase: null as SetupAutoCreatePhase | null,
    autoCreateFailedPhase: null as SetupAutoCreatePhase | null,
    pendingSetupBookId: "",
  };
}

export interface SetupMutationRequestState {
  readonly version: number;
  readonly visible: boolean;
}

const staleSetupMutation = Symbol("stale-setup-mutation");

export function isCurrentSetupMutationRequest(
  request: SetupMutationRequestState,
  current: SetupMutationRequestState,
) {
  return request.visible && current.visible && request.version === current.version;
}

export function isStaleSetupMutation(cause: unknown) {
  return cause === staleSetupMutation;
}

export async function runSetupMutationWithBestEffortFollowUp<Result>(input: {
  readonly mutate: () => Promise<Result>;
  readonly apply: (result: Result) => void;
  readonly followUp?: () => Promise<unknown>;
  readonly isCurrent?: () => boolean;
}): Promise<Result> {
  try {
    const result = await input.mutate();
    if (input.isCurrent && !input.isCurrent()) {
      throw staleSetupMutation;
    }
    input.apply(result);
    if (input.followUp) {
      void input.followUp().catch(() => undefined);
    }
    return result;
  } catch (cause) {
    if (input.isCurrent && !input.isCurrent()) {
      throw staleSetupMutation;
    }
    throw cause;
  }
}

export function useCockpitSetupSession(input: UseCockpitSetupSessionInput) {
  const [setupSession, setSetupSession] = useState<BookSetupSessionPayload | null>(null);
  const [setupTitle, setSetupTitle] = useState("");
  const [setupGenre, setSetupGenre] = useState("");
  const [setupPlatform, setSetupPlatform] = useState("");
  const [setupWords, setSetupWords] = useState(defaultChapterWordsForLanguage(input.projectLanguage));
  const [setupTargetChapters, setSetupTargetChapters] = useState("200");
  const [setupBrief, setSetupBrief] = useState("");
  const [readySetupFingerprint, setReadySetupFingerprint] = useState<string | null>(null);
  const [committedSetupFingerprint, setCommittedSetupFingerprint] = useState<string | null>(null);
  const [setupLlmForm, setSetupLlmForm] = useState<SetupLlmForm>({
    model: "",
    reasoningEffort: "",
  });
  const [setupLlmSaving, setSetupLlmSaving] = useState(false);
  const [setupLlmError, setSetupLlmError] = useState<string | null>(null);
  const [pendingSetupBookId, setPendingSetupBookId] = useState("");
  const [selectedFoundationPreviewKey, setSelectedFoundationPreviewKey] = useState<FoundationPreviewKey>("storyBible");
  const [recentSetupSessions, setRecentSetupSessions] = useState<ReadonlyArray<BookSetupSessionSummary>>([]);
  const [loadingRecentSetupSessions, setLoadingRecentSetupSessions] = useState(false);
  const [resumingSetupSessionId, setResumingSetupSessionId] = useState("");
  const [setupRecoveryError, setSetupRecoveryError] = useState<string | null>(null);
  const [preparingSetupProposal, setPreparingSetupProposal] = useState(false);
  const [approvingSetup, setApprovingSetup] = useState(false);
  const [preparingFoundationPreview, setPreparingFoundationPreview] = useState(false);
  const [creatingBook, setCreatingBook] = useState(false);
  const [autoCreatePhase, setAutoCreatePhase] = useState<SetupAutoCreatePhase | null>(null);
  const [autoCreateFailedPhase, setAutoCreateFailedPhase] = useState<SetupAutoCreatePhase | null>(null);
  const setupCreateAttemptRef = useRef<{ readonly fingerprint: string; readonly key: string } | null>(null);
  const setupMutationRequestRef = useRef<SetupMutationRequestState>({
    version: 0,
    visible: input.showNewSetup,
  });
  const previousShowNewSetupRef = useRef(input.showNewSetup);

  if (previousShowNewSetupRef.current !== input.showNewSetup) {
    const version = previousShowNewSetupRef.current && !input.showNewSetup
      ? setupMutationRequestRef.current.version + 1
      : setupMutationRequestRef.current.version;
    setupMutationRequestRef.current = {
      version,
      visible: input.showNewSetup,
    };
    previousShowNewSetupRef.current = input.showNewSetup;
  }

  const setupModelSuggestions = useMemo(
    () => modelSuggestionsForProvider(input.projectProvider, input.llmCapabilities),
    [input.llmCapabilities, input.projectProvider],
  );
  const setupReasoningEfforts = useMemo(
    () => reasoningEffortsForProvider(input.projectProvider, input.llmCapabilities),
    [input.llmCapabilities, input.projectProvider],
  );
  const setupSupportsReasoning = supportsReasoningEffort(input.projectProvider, input.llmCapabilities);
  const setupModelListId = useMemo(
    () => `cockpit-model-suggestions-${input.projectProvider || "default"}`,
    [input.projectProvider],
  );
  const setupLlmDirty = setupLlmForm.model.trim() !== input.projectModel
    || setupLlmForm.reasoningEffort !== input.projectReasoningEffort;

  const currentSetupDraftFingerprint = useMemo(() => buildSetupDraftFingerprint({
    title: setupTitle,
    genre: setupGenre,
    platform: setupPlatform,
    chapterWordCount: setupWords,
    targetChapters: setupTargetChapters,
    brief: setupBrief,
    conversation: input.setupConversation,
  }), [input.setupConversation, setupBrief, setupGenre, setupPlatform, setupTargetChapters, setupTitle, setupWords]);
  const setupDiscussionState = deriveSetupDiscussionState(readySetupFingerprint, currentSetupDraftFingerprint);
  const setupNotes = useMemo(() => buildSetupNotes({
    title: setupTitle,
    genre: setupGenre,
    platform: setupPlatform,
    chapterWordCount: setupWords,
    targetChapters: setupTargetChapters,
    brief: setupBrief,
    conversation: input.setupConversation,
    proposalContent: setupSession?.proposal.content,
  }), [input.setupConversation, setupBrief, setupGenre, setupPlatform, setupSession?.proposal.content, setupTargetChapters, setupTitle, setupWords]);
  const setupProposalDelta = useMemo(() => buildSetupProposalDeltaSummary({
    previousContent: setupSession?.previousProposal?.content,
    currentContent: setupSession?.proposal.content ?? "",
  }), [setupSession?.previousProposal?.content, setupSession?.proposal.content]);
  const setupDraftDirty = Boolean(
    setupSession
    && committedSetupFingerprint
    && committedSetupFingerprint !== currentSetupDraftFingerprint,
  );
  const setupCanPrepareProposal = canPrepareSetupProposal({
    discussionState: setupDiscussionState,
    title: setupTitle,
    genre: setupGenre,
    brief: setupBrief,
    hasDiscussion: input.setupConversation.length > 0,
  });
  const foundationPreviewTabs = useMemo(
    () => setupSession?.foundationPreview ? buildFoundationPreviewTabs(setupSession.foundationPreview, input.t) : [],
    [input.t, setupSession?.foundationPreview],
  );
  const activeFoundationPreview = foundationPreviewTabs.find((tab) => tab.key === selectedFoundationPreviewKey) ?? foundationPreviewTabs[0] ?? null;

  const loadRecentSetupSessions = useCallback(async () => {
    setLoadingRecentSetupSessions(true);
    setSetupRecoveryError(null);
    try {
      const data = await fetchJson<unknown>("/book-setup");
      setRecentSetupSessions(parseSetupSessions(data));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/^404\b/i.test(message) || message.toLowerCase().includes("not found")) {
        setRecentSetupSessions([]);
        return;
      }
      setSetupRecoveryError(message);
      setRecentSetupSessions([]);
    } finally {
      setLoadingRecentSetupSessions(false);
    }
  }, []);

  const syncSetupDraftSnapshot = useCallback((fingerprint: string) => {
    setReadySetupFingerprint(fingerprint);
    setCommittedSetupFingerprint(fingerprint);
  }, []);

  const buildSetupFingerprintFromSession = useCallback((session: BookSetupSessionPayload) => {
    return buildSetupDraftFingerprint({
      title: session.title,
      genre: session.genre,
      platform: session.platform,
      chapterWordCount: String(session.chapterWordCount),
      targetChapters: String(session.targetChapters),
      brief: session.brief,
      conversation: [],
    });
  }, []);

  const hydrateSetupSessionState = useCallback((session: BookSetupSessionPayload, summary?: BookSetupSessionSummary) => {
    setSetupSession(session);
    setSetupTitle(session.title || summary?.title || "");
    setSetupGenre(session.genre || summary?.genre || "");
    setSetupPlatform(session.platform || summary?.platform || "");
    setSetupWords(String(session.chapterWordCount || summary?.chapterWordCount || defaultChapterWordsForLanguage(input.projectLanguage)));
    setSetupTargetChapters(String(session.targetChapters || summary?.targetChapters || 200));
    setSetupBrief(session.brief || summary?.brief || "");
    input.setShowNewSetup(true);
    input.setMode("discuss");
    input.setInspectorTab("setup");
    setSelectedFoundationPreviewKey("storyBible");
  }, [input]);

  const recoverLatestSetupSession = useCallback(async (sessionId: string, message: string) => {
    try {
      const latest = await fetchJson<BookSetupSessionPayload>(`/book-setup/${sessionId}`);
      hydrateSetupSessionState(latest);
      syncSetupDraftSnapshot(buildSetupFingerprintFromSession(latest));
      input.appendMessage(input.setupThreadKey, createMessage("system", message));
      input.setError(message);
      await loadRecentSetupSessions();
      return latest;
    } catch {
      input.setError(message);
      return null;
    }
  }, [buildSetupFingerprintFromSession, hydrateSetupSessionState, input, loadRecentSetupSessions, syncSetupDraftSnapshot]);

  const focusSetupInspector = useCallback(() => {
    input.setShowNewSetup(true);
    input.setMode("discuss");
    input.setInspectorTab("setup");
  }, [input]);

  const handleSetupRequestFailure = useCallback(async (cause: unknown, sessionId?: string | null) => {
    if (isStaleSetupMutation(cause)) {
      return;
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    if (sessionId && isBookSetupRevisionMismatchMessage(message)) {
      await recoverLatestSetupSession(sessionId, input.t("cockpit.setupRevisionChanged"));
      return;
    }
    input.setError(message);
  }, [input, recoverLatestSetupSession]);

  useEffect(() => {
    void loadRecentSetupSessions();
  }, [loadRecentSetupSessions]);

  useEffect(() => {
    setSetupGenre((current) => pickValidValue(current, input.availableGenreIds));
  }, [input.availableGenreIds]);

  useEffect(() => {
    setSetupPlatform((current) => pickValidValue(current, input.availablePlatformValues));
  }, [input.availablePlatformValues]);

  useEffect(() => {
    setSetupWords(defaultChapterWordsForLanguage(input.projectLanguage));
  }, [input.projectLanguage]);

  useEffect(() => {
    setSetupLlmForm({
      model: input.projectModel,
      reasoningEffort: input.projectReasoningEffort,
    });
  }, [input.projectModel, input.projectProvider, input.projectReasoningEffort]);

  useEffect(() => {
    setSetupLlmError(null);
  }, [setupLlmForm.model, setupLlmForm.reasoningEffort]);

  useEffect(() => {
    if (!input.showNewSetup) {
      const resetState = buildHiddenSetupResetState(input.projectLanguage);
      setSetupSession(null);
      setSetupTitle(resetState.setupTitle);
      setSetupGenre(resetState.setupGenre);
      setSetupPlatform(resetState.setupPlatform);
      setSetupWords(resetState.setupWords);
      setSetupTargetChapters(resetState.setupTargetChapters);
      setSetupBrief(resetState.setupBrief);
      setPendingSetupBookId(resetState.pendingSetupBookId);
      setSelectedFoundationPreviewKey(resetState.selectedFoundationPreviewKey);
      setReadySetupFingerprint(null);
      setCommittedSetupFingerprint(null);
      setAutoCreatePhase(resetState.autoCreatePhase);
      setAutoCreateFailedPhase(resetState.autoCreateFailedPhase);
      if (setupRecoveryError) {
        setSetupRecoveryError(null);
      }
    }
  }, [input.projectLanguage, input.showNewSetup, setupRecoveryError]);

  const captureSetupMutationRequest = useCallback((): SetupMutationRequestState => {
    return { ...setupMutationRequestRef.current };
  }, []);

  const isActiveSetupMutationRequest = useCallback((request: SetupMutationRequestState) => {
    return isCurrentSetupMutationRequest(request, setupMutationRequestRef.current);
  }, []);

  useEffect(() => {
    if (!foundationPreviewTabs.length) {
      setSelectedFoundationPreviewKey("storyBible");
      return;
    }
    if (!foundationPreviewTabs.some((tab) => tab.key === selectedFoundationPreviewKey)) {
      setSelectedFoundationPreviewKey(foundationPreviewTabs[0]!.key);
    }
  }, [foundationPreviewTabs, selectedFoundationPreviewKey]);

  useEffect(() => {
    if (!pendingSetupBookId) return;
    const created = input.books.some((book) => book.id === pendingSetupBookId);
    if (!created) return;

    input.setSelectedBookId(pendingSetupBookId);
    input.setShowNewSetup(false);
    input.setMode("discuss");
    input.setInspectorTab("focus");
    setPendingSetupBookId("");
  }, [input, pendingSetupBookId]);

  const markSetupReady = useCallback(() => {
    setReadySetupFingerprint(currentSetupDraftFingerprint);
    setAutoCreateFailedPhase(null);
    input.setError(null);
  }, [currentSetupDraftFingerprint, input]);

  const saveSetupLlm = useCallback(async () => {
    if (!input.projectProvider) {
      return;
    }

    const nextModel = setupLlmForm.model.trim() || defaultModelForProvider(input.projectProvider, input.llmCapabilities) || "";
    if (!nextModel) {
      setSetupLlmError(input.t("config.modelRequired"));
      return;
    }

    setSetupLlmSaving(true);
    setSetupLlmError(null);
    try {
      await putApi("/project", {
        model: nextModel,
        reasoningEffort: normalizeReasoningEffortForProvider(
          setupLlmForm.reasoningEffort,
          input.projectProvider,
          input.llmCapabilities,
        ) || "",
      });
      await input.refetchProject();
    } catch (cause) {
      setSetupLlmError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSetupLlmSaving(false);
    }
  }, [input, setupLlmForm.model, setupLlmForm.reasoningEffort]);

  const requestSetupProposal = useCallback(async () => {
    const request = captureSetupMutationRequest();
    return runSetupMutationWithBestEffortFollowUp({
      mutate: async () => postApi<BookSetupSessionPayload>("/book-setup/propose", {
        sessionId: setupSession?.id,
        expectedRevision: setupSession?.revision,
        title: setupTitle.trim(),
        genre: setupGenre,
        language: input.projectLanguage,
        platform: setupPlatform,
        chapterWordCount: parseInt(setupWords, 10),
        targetChapters: parseInt(setupTargetChapters, 10),
        brief: setupBrief,
        conversation: input.setupConversation,
      }),
      apply: (result) => {
        setSetupSession(result);
        syncSetupDraftSnapshot(currentSetupDraftFingerprint);
        setSelectedFoundationPreviewKey("storyBible");
        setPendingSetupBookId("");
        focusSetupInspector();
      },
      followUp: loadRecentSetupSessions,
      isCurrent: () => isActiveSetupMutationRequest(request),
    });
  }, [
    captureSetupMutationRequest,
    currentSetupDraftFingerprint,
    focusSetupInspector,
    input,
    isActiveSetupMutationRequest,
    loadRecentSetupSessions,
    setupBrief,
    setupGenre,
    setupPlatform,
    setupSession,
    setupTargetChapters,
    setupTitle,
    setupWords,
    syncSetupDraftSnapshot,
  ]);

  const requestSetupApproval = useCallback(async (session: BookSetupSessionPayload) => {
    const request = captureSetupMutationRequest();
    return runSetupMutationWithBestEffortFollowUp({
      mutate: async () => {
        const request: BookSetupRevisionRequest = { expectedRevision: session.revision };
        return postApi<BookSetupSessionPayload>(`/book-setup/${session.id}/approve`, request);
      },
      apply: (result) => {
        setSetupSession(result);
        setCommittedSetupFingerprint(currentSetupDraftFingerprint);
        focusSetupInspector();
      },
      followUp: loadRecentSetupSessions,
      isCurrent: () => isActiveSetupMutationRequest(request),
    });
  }, [captureSetupMutationRequest, currentSetupDraftFingerprint, focusSetupInspector, isActiveSetupMutationRequest, loadRecentSetupSessions]);

  const requestFoundationPreview = useCallback(async (session: BookSetupSessionPayload) => {
    const request = captureSetupMutationRequest();
    return runSetupMutationWithBestEffortFollowUp({
      mutate: async () => {
        const request: BookSetupRevisionRequest = { expectedRevision: session.revision };
        return postApi<BookSetupSessionPayload>(`/book-setup/${session.id}/foundation-preview`, request);
      },
      apply: (result) => {
        setSetupSession(result);
        setCommittedSetupFingerprint(currentSetupDraftFingerprint);
        setSelectedFoundationPreviewKey("storyBible");
        focusSetupInspector();
      },
      followUp: loadRecentSetupSessions,
      isCurrent: () => isActiveSetupMutationRequest(request),
    });
  }, [captureSetupMutationRequest, currentSetupDraftFingerprint, focusSetupInspector, isActiveSetupMutationRequest, loadRecentSetupSessions]);

  const requestCreateSetup = useCallback(async (session: BookSetupSessionPayload) => {
    const request = captureSetupMutationRequest();
    return runSetupMutationWithBestEffortFollowUp({
      mutate: async () => {
        const request: BookSetupCreateRequest = {
          expectedRevision: session.revision,
          expectedPreviewDigest: session.foundationPreview!.digest,
        };
        const fingerprint = buildSetupCreateRequestFingerprint({
          sessionId: session.id,
          expectedRevision: request.expectedRevision,
          expectedPreviewDigest: request.expectedPreviewDigest,
        });
        const currentAttempt = setupCreateAttemptRef.current;
        const idempotencyKey = currentAttempt?.fingerprint === fingerprint
          ? currentAttempt.key
          : createIdempotencyKey();
        setupCreateAttemptRef.current = { fingerprint, key: idempotencyKey };

        return postApi<{ bookId: string; session: BookSetupSessionPayload }>(`/book-setup/${session.id}/create`, request, {
          headers: { "Idempotency-Key": idempotencyKey },
        });
      },
      apply: (result) => {
        setSetupSession(result.session);
        setCommittedSetupFingerprint(currentSetupDraftFingerprint);
        setPendingSetupBookId(result.bookId);
        focusSetupInspector();
      },
      followUp: async () => {
        await Promise.allSettled([
          Promise.resolve(input.refetchBooks()),
          Promise.resolve(input.refetchCreateStatus()),
          loadRecentSetupSessions(),
        ]);
      },
      isCurrent: () => isActiveSetupMutationRequest(request),
    });
  }, [captureSetupMutationRequest, currentSetupDraftFingerprint, focusSetupInspector, input, isActiveSetupMutationRequest, loadRecentSetupSessions]);

  const handlePrepareSetupProposal = useCallback(async () => {
    if (!setupTitle.trim()) {
      input.setError(input.t("create.titleRequired"));
      return;
    }
    if (!setupGenre) {
      input.setError(input.t("create.genreRequired"));
      return;
    }
    if (!setupCanPrepareProposal) {
      input.setError(input.t("cockpit.setupReadyHint"));
      return;
    }

    setPreparingSetupProposal(true);
    setAutoCreateFailedPhase(null);
    input.setError(null);
    try {
      await requestSetupProposal();
      input.appendMessage(input.setupThreadKey, createMessage("system", input.t("cockpit.setupProposalReady")));
    } catch (cause) {
      await handleSetupRequestFailure(cause, setupSession?.id);
    } finally {
      setPreparingSetupProposal(false);
    }
  }, [handleSetupRequestFailure, input, requestSetupProposal, setupCanPrepareProposal, setupGenre, setupSession?.id, setupTitle]);

  const handleApproveSetup = useCallback(async () => {
    if (!setupSession) {
      input.setError(input.t("cockpit.setupProposalEmpty"));
      return;
    }
    if (setupDraftDirty) {
      input.setError(input.t("cockpit.setupDraftChanged"));
      return;
    }

    setApprovingSetup(true);
    setAutoCreateFailedPhase(null);
    input.setError(null);
    try {
      await requestSetupApproval(setupSession);
      input.appendMessage(input.setupThreadKey, createMessage("system", input.t("cockpit.setupApproved")));
    } catch (cause) {
      await handleSetupRequestFailure(cause, setupSession.id);
    } finally {
      setApprovingSetup(false);
    }
  }, [handleSetupRequestFailure, input, requestSetupApproval, setupDraftDirty, setupSession]);

  const handlePrepareFoundationPreview = useCallback(async () => {
    if (!setupSession) {
      input.setError(input.t("cockpit.setupProposalEmpty"));
      return;
    }
    if (setupSession.status !== "approved") {
      input.setError(input.t("cockpit.setupApproveFirst"));
      return;
    }
    if (setupDraftDirty) {
      input.setError(input.t("cockpit.setupDraftChanged"));
      return;
    }

    setPreparingFoundationPreview(true);
    setAutoCreateFailedPhase(null);
    input.setError(null);
    try {
      await requestFoundationPreview(setupSession);
      input.appendMessage(input.setupThreadKey, createMessage("system", input.t("cockpit.foundationPreviewReady")));
    } catch (cause) {
      await handleSetupRequestFailure(cause, setupSession.id);
    } finally {
      setPreparingFoundationPreview(false);
    }
  }, [handleSetupRequestFailure, input, requestFoundationPreview, setupDraftDirty, setupSession]);

  const handleCreateSetup = useCallback(async () => {
    if (!setupSession) {
      input.setError(input.t("cockpit.setupProposalEmpty"));
      return;
    }
    if (setupSession.status !== "approved") {
      input.setError(input.t("cockpit.setupApproveFirst"));
      return;
    }
    if (!setupSession.foundationPreview) {
      input.setError(input.t("cockpit.foundationPreviewRequired"));
      return;
    }
    if (setupDraftDirty) {
      input.setError(input.t("cockpit.setupDraftChanged"));
      return;
    }

    setCreatingBook(true);
    setAutoCreateFailedPhase(null);
    input.setError(null);
    try {
      await requestCreateSetup(setupSession);
      input.appendMessage(input.setupThreadKey, createMessage("system", input.t("cockpit.setupApprovedQueued")));
    } catch (cause) {
      await handleSetupRequestFailure(cause, setupSession.id);
    } finally {
      setCreatingBook(false);
    }
  }, [handleSetupRequestFailure, input, requestCreateSetup, setupDraftDirty, setupSession]);

  const handleAutoCreateSetup = useCallback(async () => {
    if (!input.showNewSetup) {
      input.setError(input.t("cockpit.createRequiresOpenSetup"));
      return;
    }

    const needsFreshProposal = !setupSession || setupDraftDirty;

    if (!setupTitle.trim()) {
      input.setError(input.t("create.titleRequired"));
      return;
    }
    if (!setupGenre) {
      input.setError(input.t("create.genreRequired"));
      return;
    }
    if (needsFreshProposal && !setupCanPrepareProposal) {
      input.setError(input.t("cockpit.setupReadyHint"));
      return;
    }

    setAutoCreateFailedPhase(null);
    setPendingSetupBookId("");
    input.setError(null);

    const outcome = await runSetupAutoCreate({
      currentSession: setupSession,
      needsFreshProposal,
      onPhase: setAutoCreatePhase,
      prepareProposal: async () => {
        setPreparingSetupProposal(true);
        try {
          return await requestSetupProposal();
        } finally {
          setPreparingSetupProposal(false);
        }
      },
      approveProposal: async (session) => {
        setApprovingSetup(true);
        try {
          return await requestSetupApproval(session);
        } finally {
          setApprovingSetup(false);
        }
      },
      prepareFoundationPreview: async (session) => {
        setPreparingFoundationPreview(true);
        try {
          return await requestFoundationPreview(session);
        } finally {
          setPreparingFoundationPreview(false);
        }
      },
      createBook: async (session) => {
        setCreatingBook(true);
        try {
          return await requestCreateSetup(session);
        } finally {
          setCreatingBook(false);
        }
      },
    });

    if (outcome.status === "failure") {
      if (isStaleSetupMutation(outcome.cause)) {
        return;
      }
      setAutoCreateFailedPhase(outcome.phase);
      if (outcome.session) {
        setSetupSession(outcome.session);
      }
      await handleSetupRequestFailure(outcome.cause, outcome.session?.id ?? setupSession?.id);
      return;
    }

    input.appendMessage(input.setupThreadKey, createMessage("system", input.t("cockpit.setupApprovedQueued")));
  }, [
    handleSetupRequestFailure,
    input,
    requestCreateSetup,
    requestFoundationPreview,
    requestSetupApproval,
    requestSetupProposal,
    setupCanPrepareProposal,
    setupDraftDirty,
    setupGenre,
    setupSession,
    setupTitle,
  ]);

  const handleResumeSetupSession = useCallback(async (summary: BookSetupSessionSummary) => {
    if (resumingSetupSessionId) {
      return;
    }

    setResumingSetupSessionId(summary.id);
    setAutoCreatePhase(null);
    setAutoCreateFailedPhase(null);
    input.setError(null);
    setSetupRecoveryError(null);
    try {
      const result = await fetchJson<BookSetupSessionPayload>(`/book-setup/${summary.id}`);
      hydrateSetupSessionState(result, summary);
      syncSetupDraftSnapshot(buildSetupFingerprintFromSession(result));
      input.replaceThread(input.setupThreadKey, [createMessage("system", `${input.t("cockpit.setupRecoveredHeadline")} ${result.title}.`)]);
      input.clearProposal(input.setupThreadKey);
      await loadRecentSetupSessions();
      await Promise.all([input.refetchBooks(), input.refetchCreateStatus()]);
    } catch (cause) {
      input.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setResumingSetupSessionId("");
    }
  }, [buildSetupFingerprintFromSession, hydrateSetupSessionState, input, loadRecentSetupSessions, recoverLatestSetupSession, resumingSetupSessionId, syncSetupDraftSnapshot]);

  const handleDiscussSetup = useCallback(async () => {
    setAutoCreateFailedPhase(null);
    focusSetupInspector();
    const prompt = [
      setupTitle ? `Title idea: ${setupTitle}` : "",
      setupGenre ? `Genre: ${setupGenre}` : "",
      setupPlatform ? `Platform: ${setupPlatform}` : "",
      setupBrief ? `Brief:\n${setupBrief}` : "Brainstorm a new story setup with me before writing binder files.",
    ].filter(Boolean).join("\n\n");
    await input.sendDiscussPrompt(prompt, { threadKey: input.setupThreadKey, forceSetup: true });
  }, [focusSetupInspector, input, setupBrief, setupGenre, setupPlatform, setupTitle]);

  return {
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
    readySetupFingerprint,
    setReadySetupFingerprint,
    committedSetupFingerprint,
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
    currentSetupDraftFingerprint,
    setupDiscussionState,
    setupNotes,
    setupProposalDelta,
    setupDraftDirty,
    setupCanPrepareProposal,
    autoCreatePhase,
    autoCreateFailedPhase,
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
  };
}
