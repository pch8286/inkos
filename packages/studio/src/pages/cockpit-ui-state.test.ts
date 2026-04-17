import { describe, expect, it } from "vitest";
import { deriveCockpitRailVisibility, deriveSetupPrimaryAction } from "./cockpit-ui-state";

function setupPrimaryActionInput(
  overrides: Partial<Parameters<typeof deriveSetupPrimaryAction>[0]> = {},
): Parameters<typeof deriveSetupPrimaryAction>[0] {
  return {
    showNewSetup: true,
    discussionState: "discussing",
    draftDirty: false,
    canPrepare: false,
    sessionStatus: null,
    hasFoundationPreview: false,
    ...overrides,
  };
}

describe("deriveCockpitRailVisibility", () => {
  it("shows only the truth list in binder mode outside new setup", () => {
    expect(deriveCockpitRailVisibility({
      mode: "binder",
      showNewSetup: false,
    })).toEqual({
      showTruthList: true,
      showChapterList: false,
    });
  });

  it("shows only the chapter list in draft mode outside new setup", () => {
    expect(deriveCockpitRailVisibility({
      mode: "draft",
      showNewSetup: false,
    })).toEqual({
      showTruthList: false,
      showChapterList: true,
    });
  });

  it("hides both left-rail lists while new setup is open", () => {
    expect(deriveCockpitRailVisibility({
      mode: "discuss",
      showNewSetup: true,
    })).toEqual({
      showTruthList: false,
      showChapterList: false,
    });
  });
});

describe("deriveSetupPrimaryAction", () => {
  it("returns discuss instead of auto-create when hidden setup retains a ready draft", () => {
    expect(deriveSetupPrimaryAction({
      ...setupPrimaryActionInput({
        discussionState: "ready",
        canPrepare: true,
      }),
      showNewSetup: false,
    } as Parameters<typeof deriveSetupPrimaryAction>[0])).toBe("discuss");
  });

  it("returns discuss instead of auto-create when hidden setup retains an approved session", () => {
    expect(deriveSetupPrimaryAction({
      ...setupPrimaryActionInput({
        discussionState: "ready",
        canPrepare: true,
        sessionStatus: "approved",
        hasFoundationPreview: true,
      }),
      showNewSetup: false,
    } as Parameters<typeof deriveSetupPrimaryAction>[0])).toBe("discuss");
  });

  it("returns discuss while the setup is still being discussed and cannot advance", () => {
    expect(deriveSetupPrimaryAction(setupPrimaryActionInput())).toBe("discuss");
  });

  it("returns mark-ready when discussion has enough setup information", () => {
    expect(deriveSetupPrimaryAction(setupPrimaryActionInput({
      canPrepare: true,
    }))).toBe("mark-ready");
  });

  it("returns mark-ready when a ready draft became dirty again", () => {
    expect(deriveSetupPrimaryAction(setupPrimaryActionInput({
      discussionState: "ready",
      draftDirty: true,
      canPrepare: true,
      sessionStatus: "approved",
      hasFoundationPreview: true,
    }))).toBe("mark-ready");
  });

  it("returns auto-create when setup is ready and no session exists yet", () => {
    expect(deriveSetupPrimaryAction(setupPrimaryActionInput({
      discussionState: "ready",
      canPrepare: true,
    }))).toBe("auto-create");
  });

  it("returns auto-create when a proposal session is waiting for approval", () => {
    expect(deriveSetupPrimaryAction(setupPrimaryActionInput({
      discussionState: "ready",
      canPrepare: true,
      sessionStatus: "proposed",
    }))).toBe("auto-create");
  });

  it("returns auto-create when an approved session has no foundation preview yet", () => {
    expect(deriveSetupPrimaryAction(setupPrimaryActionInput({
      discussionState: "ready",
      canPrepare: true,
      sessionStatus: "approved",
    }))).toBe("auto-create");
  });

  it("returns auto-create when an approved session already has a foundation preview", () => {
    expect(deriveSetupPrimaryAction(setupPrimaryActionInput({
      discussionState: "ready",
      canPrepare: true,
      sessionStatus: "approved",
      hasFoundationPreview: true,
    }))).toBe("auto-create");
  });

  it("returns create while the create job is already in progress", () => {
    expect(deriveSetupPrimaryAction(setupPrimaryActionInput({
      discussionState: "ready",
      canPrepare: true,
      sessionStatus: "creating",
    }))).toBe("create");
  });
});
