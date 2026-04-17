import { describe, expect, it } from "vitest";
import { defaultChapterWordsForLanguage } from "../shared/book-create-form";
import { getCockpitCreateActionErrorKey } from "./Cockpit";
import { buildHiddenSetupResetState } from "./use-cockpit-setup-session";

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
