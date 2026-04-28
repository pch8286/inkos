import { describe, expect, it, vi } from "vitest";
import { defaultChapterWordsForLanguage } from "../shared/book-create-form";
import {
  buildCockpitStatusFacts,
  defaultQueuedComposerActionForMode,
  filterCockpitItems,
  getCockpitCreateActionErrorKey,
  getCockpitMessageRolePresentation,
  isCockpitRunDisabled,
  isSetupPrimaryActionDisabled,
  isSetupDiscussionLocked,
  shouldRunQueuedComposerEntry,
} from "./Cockpit";
import {
  advanceSetupMutationRequestState,
  beginVisibleSetupMutationRequest,
  buildHiddenSetupResetState,
  buildVisibleSetupResetState,
  isCurrentSetupMutationRequest,
  isStaleSetupMutation,
  runSetupMutationWithBestEffortFollowUp,
} from "./use-cockpit-setup-session";

describe("getCockpitCreateActionErrorKey", () => {
  it("blocks /create when the new setup flow is not active", () => {
    expect(getCockpitCreateActionErrorKey(false)).toBe("cockpit.createRequiresOpenSetup");
  });

  it("allows /create when the new setup flow is active", () => {
    expect(getCockpitCreateActionErrorKey(true)).toBeNull();
  });
});

describe("isSetupDiscussionLocked", () => {
  it("locks setup discussion while auto-create is running in the new setup discuss flow", () => {
    expect(isSetupDiscussionLocked({
      mode: "discuss",
      showNewSetup: true,
      autoCreateBusy: true,
    })).toBe(true);
  });

  it("keeps other contexts interactive", () => {
    expect(isSetupDiscussionLocked({
      mode: "discuss",
      showNewSetup: false,
      autoCreateBusy: true,
    })).toBe(false);

    expect(isSetupDiscussionLocked({
      mode: "binder",
      showNewSetup: true,
      autoCreateBusy: true,
    })).toBe(false);
  });
});

describe("defaultQueuedComposerActionForMode", () => {
  it("uses the current mode defaults", () => {
    expect(defaultQueuedComposerActionForMode("discuss")).toBe("discuss");
    expect(defaultQueuedComposerActionForMode("binder")).toBe("ask");
    expect(defaultQueuedComposerActionForMode("draft")).toBe("draft");
  });
});

describe("shouldRunQueuedComposerEntry", () => {
  it("runs queued work only when cockpit is idle and the active thread has items", () => {
    expect(shouldRunQueuedComposerEntry({
      busy: false,
      threadKey: "book-1:draft",
      queueState: {
        "book-1:draft": [{ id: "q1", action: "draft", text: "later", createdAt: 1 }],
      },
    })).toBe(true);

    expect(shouldRunQueuedComposerEntry({
      busy: true,
      threadKey: "book-1:draft",
      queueState: {
        "book-1:draft": [{ id: "q1", action: "draft", text: "later", createdAt: 1 }],
      },
    })).toBe(false);

    expect(shouldRunQueuedComposerEntry({
      busy: false,
      threadKey: "book-1:draft",
      queueState: {
        "book-2:draft": [{ id: "q1", action: "draft", text: "later", createdAt: 1 }],
      },
    })).toBe(false);
  });
});

describe("buildCockpitStatusFacts", () => {
  it("omits idle and ready stage facts because they add noise", () => {
    expect(buildCockpitStatusFacts({
      stage: "idle",
      stageLabel: "대기",
      targetLabel: "새 설정 논의",
      modelLabel: "Codex · 5.5",
      reasoningLabel: "보통",
      labels: {
        stage: "단계",
        target: "대상",
        model: "모델",
        reasoning: "추론 강도",
      },
    })).toEqual([
      { label: "대상", value: "새 설정 논의" },
      { label: "모델", value: "Codex · 5.5" },
      { label: "추론 강도", value: "보통" },
    ]);

    expect(buildCockpitStatusFacts({
      stage: "ready",
      stageLabel: "준비 완료",
      targetLabel: "새 설정 논의",
      modelLabel: "Codex · 5.5",
      reasoningLabel: null,
      labels: {
        stage: "단계",
        target: "대상",
        model: "모델",
        reasoning: "추론 강도",
      },
    })).toEqual([
      { label: "대상", value: "새 설정 논의" },
      { label: "모델", value: "Codex · 5.5" },
    ]);
  });

  it("keeps active stage facts when the cockpit is doing work", () => {
    expect(buildCockpitStatusFacts({
      stage: "working",
      stageLabel: "작업 중",
      targetLabel: "1장",
      modelLabel: "Codex · 5.5",
      reasoningLabel: null,
      labels: {
        stage: "단계",
        target: "대상",
        model: "모델",
        reasoning: "추론 강도",
      },
    })).toEqual([
      { accent: true, label: "단계", value: "작업 중" },
      { label: "대상", value: "1장" },
      { label: "모델", value: "Codex · 5.5" },
    ]);
  });
});

describe("getCockpitMessageRolePresentation", () => {
  it("uses distinct labels, alignment, and tone for user and InkOS messages", () => {
    expect(getCockpitMessageRolePresentation("user")).toEqual({
      className: "is-user",
      label: "YOU",
      alignLabel: "right",
    });

    expect(getCockpitMessageRolePresentation("assistant")).toEqual({
      className: "is-assistant",
      label: "INKOS",
      alignLabel: "left",
    });
  });
});

describe("filterCockpitItems", () => {
  it("filters books, truth files, and chapters using the cockpit search query", () => {
    const result = filterCockpitItems({
      query: "moon",
      books: [
        { id: "a", title: "Moon Archive", genre: "fantasy", platform: "naver", status: "draft", chaptersWritten: 2 },
        { id: "b", title: "Solar Archive", genre: "sf", platform: "kakao", status: "draft", chaptersWritten: 1 },
      ],
      truthFiles: [
        {
          name: "story_bible.md",
          label: "Story Bible",
          section: "core",
          sectionLabel: "Core",
          exists: true,
          path: "story_bible.md",
          optional: false,
          available: true,
          preview: "moon relic",
          size: 10,
        },
        {
          name: "rules.md",
          label: "Rules",
          section: "core",
          sectionLabel: "Core",
          exists: true,
          path: "rules.md",
          optional: false,
          available: true,
          preview: "sun relic",
          size: 10,
        },
      ],
      chapters: [
        { number: 1, title: "Under the Moon", status: "done", wordCount: 1200, updatedAt: "now" },
        { number: 2, title: "Under the Sun", status: "done", wordCount: 1200, updatedAt: "now" },
      ],
    });

    expect(result.books.map((book) => book.id)).toEqual(["a"]);
    expect(result.truthFiles.map((file) => file.name)).toEqual(["story_bible.md"]);
    expect(result.chapters.map((chapter) => chapter.number)).toEqual([1]);
  });

  it("matches cockpit truth files by path and section metadata", () => {
    const result = filterCockpitItems({
      query: "world",
      books: [],
      truthFiles: [
        {
          name: "timeline.md",
          label: "Timeline",
          section: "world",
          sectionLabel: "World",
          exists: true,
          path: "truth/world/timeline.md",
          optional: false,
          available: true,
          preview: "chronology",
          size: 10,
        },
        {
          name: "style.md",
          label: "Style",
          section: "voice",
          sectionLabel: "Voice",
          exists: true,
          path: "truth/voice/style.md",
          optional: false,
          available: true,
          preview: "sentence rhythm",
          size: 10,
        },
      ],
      chapters: [],
    });

    expect(result.truthFiles.map((file) => file.name)).toEqual(["timeline.md"]);
  });
});

describe("isSetupPrimaryActionDisabled", () => {
  const baseInput: Parameters<typeof isSetupPrimaryActionDisabled>[0] = {
    action: "discuss",
    setupDiscussionLocked: false,
    setupTitle: "Moon Archive",
    setupGenre: "fantasy",
    setupDiscussionState: "discussing",
    autoCreateAllowed: true,
    autoCreateBusy: false,
    setupCanPrepareProposal: true,
    preparingSetupProposal: false,
    approvingSetup: false,
    preparingFoundationPreview: false,
    creatingBook: false,
    setupDraftDirty: false,
    setupSessionStatus: "approved",
    hasFoundationPreview: true,
  };

  it("keeps the header setup action disabled while its matching setup button would be disabled", () => {
    expect(isSetupPrimaryActionDisabled({
      ...baseInput,
      action: "mark-ready",
      setupTitle: "",
    })).toBe(true);

    expect(isSetupPrimaryActionDisabled({
      ...baseInput,
      action: "create",
      creatingBook: true,
    })).toBe(true);
  });

  it("allows only valid setup primary actions to run from the header", () => {
    expect(isSetupPrimaryActionDisabled({
      ...baseInput,
      action: "mark-ready",
    })).toBe(false);

    expect(isSetupPrimaryActionDisabled({
      ...baseInput,
      action: "create",
    })).toBe(false);
  });
});

describe("isCockpitRunDisabled", () => {
  const baseInput: Parameters<typeof isCockpitRunDisabled>[0] = {
    showNewSetup: false,
    setupPrimaryActionDisabled: false,
    busy: false,
    mode: "discuss",
    canUseBinder: true,
    canUseDraft: true,
  };

  it("blocks the header Run action while any cockpit request is busy, including setup mode", () => {
    expect(isCockpitRunDisabled({
      ...baseInput,
      showNewSetup: true,
      busy: true,
    })).toBe(true);
  });

  it("keeps mode-specific capability guards for non-setup contexts", () => {
    expect(isCockpitRunDisabled({
      ...baseInput,
      mode: "binder",
      canUseBinder: false,
    })).toBe(true);

    expect(isCockpitRunDisabled({
      ...baseInput,
      mode: "draft",
      canUseDraft: false,
    })).toBe(true);
  });
});

describe("buildHiddenSetupResetState", () => {
  it("clears retained setup draft state using the current project language defaults", () => {
    expect(buildHiddenSetupResetState("en")).toEqual({
      setupTitle: "",
      setupGenre: "",
      setupPlatform: "",
      setupWords: defaultChapterWordsForLanguage("en"),
      setupTargetChapters: "200",
      setupBrief: "",
      selectedFoundationPreviewKey: "storyBible",
      autoCreatePhase: null,
      autoCreateFailedPhase: null,
      pendingSetupBookId: "",
    });

    expect(buildHiddenSetupResetState("ko")).toEqual({
      setupTitle: "",
      setupGenre: "",
      setupPlatform: "",
      setupWords: defaultChapterWordsForLanguage("ko"),
      setupTargetChapters: "200",
      setupBrief: "",
      selectedFoundationPreviewKey: "storyBible",
      autoCreatePhase: null,
      autoCreateFailedPhase: null,
      pendingSetupBookId: "",
    });
  });
});

describe("buildVisibleSetupResetState", () => {
  it("clears the visible setup session so a new setup discussion starts from scratch", () => {
    expect(buildVisibleSetupResetState("ko")).toEqual({
      ...buildHiddenSetupResetState("ko"),
      setupSession: null,
      readySetupFingerprint: null,
      committedSetupFingerprint: null,
    });
  });
});

describe("isCurrentSetupMutationRequest", () => {
  it("accepts only requests from the active visible setup generation", () => {
    expect(isCurrentSetupMutationRequest(
      { version: 4, visible: true },
      { version: 4, visible: true },
    )).toBe(true);

    expect(isCurrentSetupMutationRequest(
      { version: 4, visible: true },
      { version: 5, visible: false },
    )).toBe(false);

    expect(isCurrentSetupMutationRequest(
      { version: 4, visible: true },
      { version: 5, visible: true },
    )).toBe(false);
  });
});

describe("advanceSetupMutationRequestState", () => {
  it("invalidates in-flight requests when the visible setup context changes without closing", () => {
    expect(advanceSetupMutationRequestState(
      { version: 2, visible: true },
      { visible: true, invalidate: true },
    )).toEqual({ version: 3, visible: true });
  });
});

describe("beginVisibleSetupMutationRequest", () => {
  it("opens a visible request when resuming setup from a hidden book context", () => {
    const request = beginVisibleSetupMutationRequest({ version: 2, visible: false });

    expect(request).toEqual({ version: 3, visible: true });
    expect(isCurrentSetupMutationRequest(request, request)).toBe(true);
  });
});

describe("runSetupMutationWithBestEffortFollowUp", () => {
  it("aborts stale setup completions without applying state or follow-up work", async () => {
    const apply = vi.fn();
    const followUp = vi.fn(async () => undefined);

    await expect(runSetupMutationWithBestEffortFollowUp({
      mutate: async () => "ok",
      apply,
      followUp,
      isCurrent: () => false,
    })).rejects.toSatisfy((cause) => isStaleSetupMutation(cause));

    expect(apply).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();
  });

  it("treats resumed visible setup contexts as stale for older in-flight requests", async () => {
    let current = { version: 6, visible: true };
    const request = current;
    const apply = vi.fn();
    let resolveMutation!: (value: string) => void;

    const mutation = runSetupMutationWithBestEffortFollowUp({
      mutate: async () => await new Promise<string>((resolve) => {
        resolveMutation = resolve;
      }),
      apply,
      isCurrent: () => isCurrentSetupMutationRequest(request, current),
    });

    current = advanceSetupMutationRequestState(current, { visible: true, invalidate: true });
    resolveMutation("ok");

    await expect(mutation).rejects.toSatisfy((cause) => isStaleSetupMutation(cause));
    expect(apply).not.toHaveBeenCalled();
  });
});
