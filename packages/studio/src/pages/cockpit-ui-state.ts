import type { BookSetupSessionStatus } from "../shared/contracts";
import type { SetupDiscussionState } from "./cockpit-setup-state";

export type CockpitMode = "discuss" | "binder" | "draft";

export interface CockpitRailVisibility {
  readonly showTruthList: boolean;
  readonly showChapterList: boolean;
}

export interface CockpitRailVisibilityInput {
  readonly mode: CockpitMode;
  readonly showNewSetup: boolean;
}

export type SetupPrimaryAction =
  | "discuss"
  | "mark-ready"
  | "prepare-proposal"
  | "approve"
  | "preview-foundation"
  | "create";

export interface SetupPrimaryActionInput {
  readonly discussionState: SetupDiscussionState;
  readonly draftDirty: boolean;
  readonly canPrepare: boolean;
  readonly sessionStatus: BookSetupSessionStatus | null;
  readonly hasFoundationPreview: boolean;
}

export function deriveCockpitRailVisibility(input: CockpitRailVisibilityInput): CockpitRailVisibility {
  if (input.showNewSetup || input.mode === "discuss") {
    return {
      showTruthList: false,
      showChapterList: false,
    };
  }

  switch (input.mode) {
    case "binder":
      return {
        showTruthList: true,
        showChapterList: false,
      };
    case "draft":
      return {
        showTruthList: false,
        showChapterList: true,
      };
    default: {
      const exhaustiveMode: never = input.mode;
      void exhaustiveMode;
      return {
        showTruthList: false,
        showChapterList: false,
      };
    }
  }
}

export function deriveSetupPrimaryAction(input: SetupPrimaryActionInput): SetupPrimaryAction {
  if (input.sessionStatus === "creating") {
    return "create";
  }

  if ((input.discussionState === "discussing" || input.draftDirty) && input.canPrepare) {
    return "mark-ready";
  }

  if (input.discussionState === "discussing") {
    return "discuss";
  }

  switch (input.sessionStatus) {
    case null:
      return input.canPrepare ? "prepare-proposal" : "discuss";
    case "proposed":
      return "approve";
    case "approved":
      return input.hasFoundationPreview ? "create" : "preview-foundation";
    default: {
      const exhaustiveStatus: never = input.sessionStatus;
      void exhaustiveStatus;
      return "create";
    }
  }
}
