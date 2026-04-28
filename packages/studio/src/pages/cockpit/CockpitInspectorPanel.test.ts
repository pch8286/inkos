import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TFunction } from "../../hooks/use-i18n";
import { CockpitInspectorPanel } from "./CockpitInspectorPanel";

const t = ((key: string) => {
  const labels: Record<string, string> = {
    "app.llmSettings": "LLM Settings",
    "app.alertsEmpty": "No activity",
    "chapter.label": "Chapter {n}",
    "cockpit.activity": "Activity",
    "cockpit.approvalGate": "Review before approval",
    "cockpit.autoCreateFailed": "Auto-create failed",
    "cockpit.commandHint": "No changes",
    "cockpit.currentContext": "Context",
    "cockpit.exactPreviewBadge": "Exact preview",
    "cockpit.foundationGate": "Review before creating files",
    "cockpit.foundationPreviewDetails": "Foundation preview",
    "cockpit.foundationPreviewTitle": "Foundation preview",
    "cockpit.inlineReviewSummaryIdle": "No review",
    "cockpit.newSetup": "New Setup",
    "cockpit.noBook": "No book",
    "cockpit.pendingChanges": "Pending changes",
    "cockpit.setupBrief": "Brief",
    "cockpit.setupChosen": "Chosen",
    "cockpit.setupDraftChanged": "Setup draft changed",
    "cockpit.setupLlmHint": "Use these settings for setup generation.",
    "cockpit.setupMissingInfo": "Missing info",
    "cockpit.setupNoDelta": "No changes yet",
    "cockpit.setupNotes": "Setup notes",
    "cockpit.setupOpenQuestions": "Open questions",
    "cockpit.setupProposalDetails": "Proposal details",
    "cockpit.setupProposalEmpty": "No proposal",
    "cockpit.setupProposalTitle": "Proposal",
    "cockpit.setupReadyHint": "Fill the setup fields before creating.",
    "cockpit.setupRecoveryEmpty": "No saved sessions",
    "cockpit.setupRecoveryHint": "Resume a recent setup.",
    "cockpit.setupRecoveryTitle": "Recent setups",
    "cockpit.setupSecondaryActions": "More actions",
    "cockpit.setupTitle": "Title",
    "cockpit.setupWhatChanged": "What changed",
    "cockpit.startNewSetup": "Start new setup",
    "create.bookTitle": "Title",
    "create.genre": "Genre",
    "create.platform": "Platform",
    "create.targetChapters": "Target chapters",
    "create.wordsPerChapter": "Words per chapter",
    "config.default": "Default",
    "config.model": "Model",
    "config.reasoningLevel": "Reasoning",
    "config.reasoningUnsupported": "Unsupported",
    "config.save": "Save",
  };
  return labels[key] ?? key;
}) as TFunction;

const tabIds = {
  focusTabId: "focus-tab",
  changesTabId: "changes-tab",
  setupTabId: "setup-tab",
  activityTabId: "activity-tab",
  focusPanelId: "focus-panel",
  changesPanelId: "changes-panel",
  setupPanelId: "setup-panel",
  activityPanelId: "activity-panel",
};

const ActionButton = ({
  disabled,
  className,
  icon,
  label,
  onClick,
}: {
  readonly disabled?: boolean;
  readonly className?: string;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) => React.createElement("button", {
  type: "button",
  disabled,
  className,
  onClick,
}, icon, label);

const InspectorTabButton = ({
  tabId,
  panelId,
  active,
  icon,
  label,
  onClick,
}: {
  readonly tabId: string;
  readonly panelId: string;
  readonly active: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) => React.createElement("button", {
  type: "button",
  id: tabId,
  "aria-controls": panelId,
  "aria-selected": active,
  onClick,
}, icon, label);

const baseProps = {
  t,
  inspectorTab: "setup" as const,
  setInspectorTab: () => undefined,
  hasPendingChanges: false,
  pendingChangesCount: 0,
  selectedBookLabel: "New Setup",
  setupStatusLabelFallback: "Discussing",
  legacyCreateLabel: "Legacy Create",
  focusPanel: {
    heading: "Focus",
    title: "No book",
    content: "",
  },
  focusPanelEmptyLabel: "No book",
  setupTabEmptyLabel: "No setup",
  changesPanel: {
    changes: [],
    onApplyChange: () => undefined,
  },
  setupPanel: {
    loadingRecentSetupSessions: false,
    recentSetupSessions: [],
    setupRecoveryError: null,
    onResumeSetupSession: () => undefined,
    setupModelSuggestions: [],
    setupModelListId: "setup-models",
    setupSupportsReasoning: false,
    setupLlmSaving: false,
    setupLlmError: null,
    setupLlmFormModel: "",
    setupLlmFormReasoningEffort: "none" as const,
    projectProviderLabel: "",
    projectModelLabel: "-",
    projectModelPlaceholder: "Model",
    onSetSetupLlmFormModel: () => undefined,
    onSetSetupLlmFormReasoningEffort: () => undefined,
    onSaveSetupLlm: () => undefined,
    setupReasons: [],
    setupReasoningEfforts: [],
    setupTitle: "Moon Archive",
    setupGenre: "fantasy",
    setupPlatform: "webnovel",
    setupWords: "1500",
    setupTargetChapters: "120",
    setupBrief: "A lunar archive mystery.",
    onSetSetupTitle: () => undefined,
    onSetSetupGenre: () => undefined,
    onSetSetupPlatform: () => undefined,
    onSetSetupWords: () => undefined,
    onSetSetupTargetChapters: () => undefined,
    onSetSetupBrief: () => undefined,
    genres: [{ id: "fantasy", name: "Fantasy" }],
    platformOptions: [{ value: "webnovel", label: "Webnovel" }],
    onLegacyCreate: null,
    setupNotes: {
      chosen: [],
      openQuestions: [],
      creativeBriefPreview: "",
    },
    setupMissingInfoLabels: [],
    setupDiscussionLabel: "Discussing",
    setupStatusLabel: "Discussing",
    setupSession: null,
    onStartNewSetup: () => undefined,
    setupResetDisabled: false,
    setupDraftDirty: false,
    setupProposalDelta: [],
    setupPrimaryAction: "mark-ready" as const,
    secondarySetupActions: [],
    foundationPreviewTabs: [],
    selectedFoundationPreviewKey: "storyBible",
    onSetSelectedFoundationPreviewKey: () => undefined,
    savingSetupReviewThreads: false,
    onSaveSetupReviewThreads: () => undefined,
    renderSetupActionButton: () => React.createElement("button", { type: "button" }, "Mark Ready"),
    resumingSetupSessionId: "",
    autoCreatePhase: null,
    autoCreateFailedPhase: null,
    onRetryAutoCreate: () => undefined,
  },
  activityEntries: [],
  activityEmptyLabel: "No activity",
  classNames: {
    btnPrimary: "primary",
    btnSecondary: "secondary",
    input: "input",
    error: "error",
  },
  ids: tabIds,
  InspectorTabButton,
  ActionButton,
};

describe("CockpitInspectorPanel", () => {
  it("renders editable setup draft fields in the setup inspector", () => {
    const html = renderToStaticMarkup(React.createElement(CockpitInspectorPanel, baseProps));

    expect(html).toContain("Moon Archive");
    expect(html).toContain("A lunar archive mystery.");
    expect(html).toContain('aria-label="Title"');
    expect(html).toContain('aria-label="Genre"');
    expect(html).toContain('aria-label="Brief"');
  });

  it("disables starting a new setup while setup creation is running", () => {
    const html = renderToStaticMarkup(React.createElement(CockpitInspectorPanel, {
      ...baseProps,
      setupPanel: {
        ...baseProps.setupPanel,
        autoCreatePhase: "creating",
      },
    }));

    expect(html).toMatch(/<button[^>]*disabled[^>]*>Start new setup<\/button>/);
  });
});
