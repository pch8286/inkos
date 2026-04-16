import { describe, expect, it } from "vitest";
import { deriveCockpitStatusStrip } from "./cockpit-status-strip";

describe("deriveCockpitStatusStrip", () => {
  it("prefers creating over other states", () => {
    expect(deriveCockpitStatusStrip({
      provider: "codex-cli",
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
      mode: "binder",
      selectedBookLabel: "Book",
      selectedTruthLabel: "book_rules.md",
      selectedChapterLabel: "Chapter 12",
      showNewSetup: false,
      busy: true,
      preparingSetupProposal: true,
      approvingSetup: true,
      preparingFoundationPreview: true,
      creatingBook: true,
      createJobs: [{ bookId: "b1", title: "Book", status: "creating", stage: "writing story bible", message: null }],
      setupDiscussionState: "ready",
      setupSessionStatus: "approved",
      activityEntries: [],
    }).stage).toBe("creating");
  });

  it("falls back to queued when no local work is active but a create job exists", () => {
    expect(deriveCockpitStatusStrip({
      provider: "codex-cli",
      model: "gpt-5.4",
      reasoningEffort: "",
      mode: "discuss",
      selectedBookLabel: "Book",
      selectedTruthLabel: "book_rules.md",
      selectedChapterLabel: "Chapter 12",
      showNewSetup: false,
      busy: false,
      preparingSetupProposal: false,
      approvingSetup: false,
      preparingFoundationPreview: false,
      creatingBook: false,
      createJobs: [{ bookId: "b1", title: "Book", status: "creating", stage: "queued", message: null }],
      setupDiscussionState: "discussing",
      setupSessionStatus: null,
      activityEntries: [],
    }).stage).toBe("queued");
  });

  it("prefers foundation preview over generic busy work", () => {
    expect(deriveCockpitStatusStrip({
      provider: "codex-cli",
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
      mode: "discuss",
      selectedBookLabel: "Book",
      selectedTruthLabel: "book_rules.md",
      selectedChapterLabel: "Chapter 12",
      showNewSetup: false,
      busy: true,
      preparingSetupProposal: false,
      approvingSetup: false,
      preparingFoundationPreview: true,
      creatingBook: false,
      createJobs: [],
      setupDiscussionState: "ready",
      setupSessionStatus: "approved",
      activityEntries: [],
    }).stage).toBe("previewing-foundation");
  });

  it("returns ready when setup is armed and no higher-priority work is running", () => {
    expect(deriveCockpitStatusStrip({
      provider: "codex-cli",
      model: "gpt-5.4",
      reasoningEffort: "",
      mode: "discuss",
      selectedBookLabel: "Book",
      selectedTruthLabel: "book_rules.md",
      selectedChapterLabel: "Chapter 12",
      showNewSetup: true,
      busy: false,
      preparingSetupProposal: false,
      approvingSetup: false,
      preparingFoundationPreview: false,
      creatingBook: false,
      createJobs: [],
      setupDiscussionState: "ready",
      setupSessionStatus: "approved",
      activityEntries: [],
    }).stage).toBe("ready");
  });

  it("uses setup as the target when new setup is open", () => {
    expect(deriveCockpitStatusStrip({
      provider: "codex-cli",
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
      mode: "discuss",
      selectedBookLabel: "Book",
      selectedTruthLabel: "book_rules.md",
      selectedChapterLabel: "Chapter 12",
      showNewSetup: true,
      busy: false,
      preparingSetupProposal: false,
      approvingSetup: false,
      preparingFoundationPreview: false,
      creatingBook: false,
      createJobs: [],
      setupDiscussionState: "discussing",
      setupSessionStatus: null,
      activityEntries: [],
    }).targetLabel).toBe("new-setup");
  });

  it("prefers the selected truth file as the binder target", () => {
    expect(deriveCockpitStatusStrip({
      provider: "codex-cli",
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
      mode: "binder",
      selectedBookLabel: "Book",
      selectedTruthLabel: "book_rules.md",
      selectedChapterLabel: "Chapter 12",
      showNewSetup: false,
      busy: false,
      preparingSetupProposal: false,
      approvingSetup: false,
      preparingFoundationPreview: false,
      creatingBook: false,
      createJobs: [],
      setupDiscussionState: "discussing",
      setupSessionStatus: null,
      activityEntries: [],
    }).targetLabel).toBe("book_rules.md");
  });

  it("summarizes the latest meaningful activity message", () => {
    expect(deriveCockpitStatusStrip({
      provider: "codex-cli",
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
      mode: "draft",
      selectedBookLabel: "Book",
      selectedTruthLabel: "book_rules.md",
      selectedChapterLabel: "Chapter 12",
      showNewSetup: false,
      busy: false,
      preparingSetupProposal: false,
      approvingSetup: false,
      preparingFoundationPreview: false,
      creatingBook: false,
      createJobs: [],
      setupDiscussionState: "ready",
      setupSessionStatus: "approved",
      activityEntries: [
        { event: "ping", data: {}, timestamp: 1 },
        { event: "draft:complete", data: { message: "chapter 12 finished" }, timestamp: 2 },
      ],
    }).latestEvent).toBe("draft:complete · chapter 12 finished");
  });
});
