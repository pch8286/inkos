import { describe, expect, it, vi } from "vitest";
import { defaultChapterWordsForLanguage } from "../shared/book-create-form";
import {
  defaultQueuedComposerActionForMode,
  getCockpitCreateActionErrorKey,
  isSetupDiscussionLocked,
  shouldRunQueuedComposerEntry,
} from "./Cockpit";
import {
  advanceSetupMutationRequestState,
  buildHiddenSetupResetState,
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
