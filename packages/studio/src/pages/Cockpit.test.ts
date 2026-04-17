import { describe, expect, it, vi } from "vitest";
import { defaultChapterWordsForLanguage } from "../shared/book-create-form";
import { getCockpitCreateActionErrorKey } from "./Cockpit";
import {
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
});
