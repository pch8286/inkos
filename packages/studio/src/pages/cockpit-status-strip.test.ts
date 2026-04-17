import { describe, expect, it } from "vitest";
import { deriveCockpitStatusStrip } from "./cockpit-status-strip";

const baseInput = {
  provider: "codex-cli",
  model: "gpt-5.4",
  reasoningEffort: "xhigh" as const,
  mode: "discuss" as const,
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
  setupDiscussionState: "discussing" as const,
  setupSessionStatus: null,
  activityEntries: [],
};

describe("deriveCockpitStatusStrip", () => {
  it("marks structured setup work as live determinate progress", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      preparingFoundationPreview: true,
    })).toMatchObject({
      stage: "previewing-foundation",
      isLive: true,
      liveStage: "previewing-foundation",
      progressMode: "determinate",
      progressValue: 65,
      latestEventIsError: false,
    });
  });

  it("uses indeterminate progress for generic busy work", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      busy: true,
    })).toMatchObject({
      stage: "working",
      isLive: true,
      liveStage: "working",
      progressMode: "indeterminate",
      progressValue: null,
    });
  });

  it("uses queued jobs as compact live detail when no local work is active", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      createJobs: [
        { bookId: "b1", title: "Book", status: "creating", stage: "queued", message: "waiting for worker" },
      ],
    })).toMatchObject({
      stage: "queued",
      isLive: true,
      progressMode: "indeterminate",
      liveDetail: "queued",
    });
  });

  it("flags error events so the renderer can suppress live styling", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      busy: true,
      activityEntries: [
        { event: "draft:error", data: { error: "agent crashed" }, timestamp: 10 },
      ],
    })).toMatchObject({
      latestEvent: "draft:error · agent crashed",
      latestEventIsError: true,
    });
  });

  it("shows preparing-proposal when setup proposal work is active", () => {
    expect(deriveCockpitStatusStrip({
      provider: "codex-cli",
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
      mode: "discuss",
      selectedBookLabel: "New Setup",
      selectedTruthLabel: "—",
      selectedChapterLabel: "—",
      showNewSetup: true,
      busy: false,
      preparingSetupProposal: true,
      approvingSetup: false,
      preparingFoundationPreview: false,
      creatingBook: false,
      createJobs: [],
      setupDiscussionState: "ready",
      setupSessionStatus: null,
      activityEntries: [],
    }).stage).toBe("preparing-proposal");
  });

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
      selectedBookLabel: "New Setup",
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
    }).targetLabel).toBe("New Setup");
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

  it("uses the selected book as the draft target because draft actions queue work at book scope", () => {
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
      setupDiscussionState: "discussing",
      setupSessionStatus: null,
      activityEntries: [],
    }).targetLabel).toBe("Book");
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
