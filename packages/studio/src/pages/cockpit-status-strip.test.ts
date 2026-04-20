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

  it("uses deterministic progress for preparing-proposal", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      preparingSetupProposal: true,
    })).toMatchObject({
      stage: "preparing-proposal",
      progressMode: "determinate",
      progressValue: 20,
    });
  });

  it("uses deterministic progress for approving-proposal", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      approvingSetup: true,
    })).toMatchObject({
      stage: "approving-proposal",
      progressMode: "determinate",
      progressValue: 40,
    });
  });

  it("uses deterministic progress for creating", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      creatingBook: true,
    })).toMatchObject({
      stage: "creating",
      progressMode: "determinate",
      progressValue: 85,
    });
  });

  it("uses creating-job stage for creating live detail before any creating-job message", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      creatingBook: true,
      createJobs: [
        { bookId: "b1", title: "Message First", status: "creating", stage: null, message: "waiting for worker" },
        { bookId: "b2", title: "Stage Second", status: "creating", stage: "queued", message: null },
      ],
    })).toMatchObject({
      stage: "creating",
      liveDetail: "queued",
    });
  });

  it("uses creating-job message for creating live detail before latest event when no stage exists", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      creatingBook: true,
      createJobs: [
        { bookId: "b1", title: "Book", status: "creating", stage: null, message: "waiting for worker" },
      ],
      activityEntries: [
        { event: "draft:log", data: { detail: "writing chapter 12" }, timestamp: 10 },
      ],
    })).toMatchObject({
      stage: "creating",
      liveDetail: "waiting for worker",
    });
  });

  it("uses latest event for creating live detail when no creating-job detail exists", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      creatingBook: true,
      createJobs: [
        { bookId: "b1", title: "Book", status: "creating", stage: null, message: null },
      ],
      activityEntries: [
        { event: "draft:log", data: { detail: "writing chapter 12" }, timestamp: 10 },
      ],
    })).toMatchObject({
      stage: "creating",
      liveDetail: "draft:log · writing chapter 12",
    });
  });

  it("falls back to target label for creating live detail when nothing else exists", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      creatingBook: true,
      createJobs: [
        { bookId: "b1", title: "Book", status: "creating", stage: null, message: null },
      ],
    })).toMatchObject({
      stage: "creating",
      liveDetail: "Book",
    });
  });

  it("uses latest event for preparing-proposal live detail over background create-job detail", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      preparingSetupProposal: true,
      createJobs: [
        { bookId: "b1", title: "Book", status: "creating", stage: "queued", message: "waiting for worker" },
      ],
      activityEntries: [
        { event: "setup:log", data: { detail: "drafting proposal" }, timestamp: 10 },
      ],
    })).toMatchObject({
      stage: "preparing-proposal",
      liveDetail: "setup:log · drafting proposal",
    });
  });

  it("uses target label for approving-proposal live detail when no latest event exists", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      approvingSetup: true,
      createJobs: [
        { bookId: "b1", title: "Book", status: "creating", stage: "queued", message: "waiting for worker" },
      ],
    })).toMatchObject({
      stage: "approving-proposal",
      liveDetail: "Book",
    });
  });

  it("uses latest event for previewing-foundation live detail over background create-job detail", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      preparingFoundationPreview: true,
      createJobs: [
        { bookId: "b1", title: "Book", status: "creating", stage: "queued", message: "waiting for worker" },
      ],
      activityEntries: [
        { event: "setup:log", data: { detail: "previewing foundation" }, timestamp: 10 },
      ],
    })).toMatchObject({
      stage: "previewing-foundation",
      liveDetail: "setup:log · previewing foundation",
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

  it("uses explicit non-live values for idle", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
    })).toMatchObject({
      stage: "idle",
      isLive: false,
      liveStage: null,
      liveDetail: null,
      progressMode: "none",
      progressValue: null,
    });
  });

  it("uses explicit non-live values for ready", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      setupDiscussionState: "ready",
    })).toMatchObject({
      stage: "ready",
      isLive: false,
      liveStage: null,
      liveDetail: null,
      progressMode: "none",
      progressValue: null,
    });
  });

  it("uses latest event for working live detail over background create-job detail", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      busy: true,
      createJobs: [
        { bookId: "b1", title: "Book", status: "creating", stage: null, message: "waiting for worker" },
      ],
      activityEntries: [
        { event: "draft:log", data: { detail: "writing chapter 12" }, timestamp: 10 },
      ],
    })).toMatchObject({
      stage: "working",
      liveDetail: "draft:log · writing chapter 12",
    });
  });

  it("uses a persisted active run to restore live draft status after refresh", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      activeRun: {
        id: "run-1",
        bookId: "book-1",
        chapter: null,
        chapterNumber: null,
        action: "draft",
        status: "running",
        stage: "Drafting",
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:03.000Z",
        startedAt: "2026-04-20T00:00:01.000Z",
        finishedAt: null,
        logs: [
          {
            timestamp: "2026-04-20T00:00:03.000Z",
            level: "info",
            message: "Preparing chapter context",
          },
        ],
        elapsedMs: 5400,
        totalChars: 2048,
      },
    })).toMatchObject({
      stage: "working",
      isLive: true,
      liveStage: "working",
      liveDetail: "Preparing chapter context",
      progressMode: "indeterminate",
      progressValue: null,
      elapsedMs: 5400,
      totalChars: 2048,
    });
  });

  it("falls back to latest event for live detail when there is no active create-job detail", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      busy: true,
      activityEntries: [
        { event: "draft:log", data: { detail: "writing chapter 12" }, timestamp: 10 },
      ],
    })).toMatchObject({
      stage: "working",
      liveDetail: "draft:log · writing chapter 12",
    });
  });

  it("falls back to latest event for live detail when only queued jobs have no details", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      busy: true,
      createJobs: [
        { bookId: "b1", title: "Book", status: "creating", stage: null, message: null },
      ],
      activityEntries: [
        { event: "draft:log", data: { detail: "writing chapter 12" }, timestamp: 10 },
      ],
    })).toMatchObject({
      stage: "working",
      liveDetail: "draft:log · writing chapter 12",
    });
  });

  it("falls back to target label when a creating job has no detail and no event is available", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      busy: true,
      createJobs: [
        { bookId: "b1", title: "Book", status: "creating", stage: null, message: null },
      ],
    })).toMatchObject({
      stage: "working",
      liveDetail: "Book",
    });
  });

  it("uses background create-job detail only for queued states", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      createJobs: [
        { bookId: "b1", title: "Book", status: "creating", stage: null, message: null },
        { bookId: "b2", title: "Book", status: "creating", stage: "queued", message: null },
      ],
    })).toMatchObject({
      stage: "queued",
      liveDetail: "queued",
    });
  });

  it("falls back to target label for working when latest event is unavailable", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      busy: true,
      createJobs: [
        { bookId: "b1", title: "Book", status: "creating", stage: "writing", message: "waiting for worker" },
      ],
    })).toMatchObject({
      stage: "working",
      liveDetail: "Book",
    });
  });

  it("summarizes payload with bookId", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      busy: true,
      activityEntries: [
        { event: "draft:log", data: { bookId: "alpha" }, timestamp: 10 },
      ],
    })).toMatchObject({
      stage: "working",
      latestEvent: "draft:log · alpha",
      liveDetail: "draft:log · alpha",
    });
  });

  it("uses queued create-job details only if they are present", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      createJobs: [
        { bookId: "b1", title: "Book", status: "creating", stage: null, message: null },
      ],
      activityEntries: [
        { event: "draft:log", data: { note: "queued while preparing book" }, timestamp: 10 },
      ],
    })).toMatchObject({
      stage: "queued",
      latestEvent: "draft:log · queued while preparing book",
      liveDetail: "draft:log · queued while preparing book",
    });
  });

  it("uses older creating job detail when newer one has none", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      createJobs: [
        { bookId: "b1", title: "Newest", status: "creating", stage: null, message: null },
        { bookId: "b0", title: "Older", status: "creating", stage: "queued", message: null },
      ],
    })).toMatchObject({
      stage: "queued",
      latestEvent: null,
      liveDetail: "queued",
    });
  });

  it("prefers any creating-job stage over an earlier creating-job message", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      createJobs: [
        { bookId: "b1", title: "Message First", status: "creating", stage: null, message: "waiting for worker" },
        { bookId: "b2", title: "Stage Second", status: "creating", stage: "queued", message: null },
      ],
    })).toMatchObject({
      stage: "queued",
      liveDetail: "queued",
    });
  });

  it("keeps the first usable creating-job stage even when a later creating job only has a message", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      createJobs: [
        { bookId: "b1", title: "Stage First", status: "creating", stage: "queued", message: null },
        { bookId: "b2", title: "Message Second", status: "creating", stage: null, message: "waiting for worker" },
      ],
    })).toMatchObject({
      stage: "queued",
      liveDetail: "queued",
    });
  });

  it("uses the first usable creating-job message when no creating-job stage exists", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      createJobs: [
        { bookId: "b1", title: "Message First", status: "creating", stage: null, message: "waiting for worker" },
        { bookId: "b2", title: "Message Second", status: "creating", stage: null, message: "starting generator" },
      ],
    })).toMatchObject({
      stage: "queued",
      liveDetail: "waiting for worker",
    });
  });

  it("falls back to single no-detail queued create-job and event summary when available", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      createJobs: [
        { bookId: "b1", title: "Book", status: "creating", stage: null, message: null },
      ],
      activityEntries: [
        { event: "draft:log", data: { title: "Queued title" }, timestamp: 10 },
      ],
    })).toMatchObject({
      stage: "queued",
      latestEvent: "draft:log · Queued title",
      liveDetail: "draft:log · Queued title",
    });
  });

  it("falls back to queued target when the only queued create-job has no usable detail", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      selectedBookLabel: "Queued Book",
      createJobs: [
        { bookId: "b1", title: "Queued Book", status: "creating", stage: null, message: null },
      ],
    })).toMatchObject({
      stage: "queued",
      liveDetail: "Queued Book",
    });
  });

  it("summarizes payload with title", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      busy: true,
      activityEntries: [
        { event: "draft:log", data: { title: "Book" }, timestamp: 10 },
      ],
    })).toMatchObject({
      stage: "working",
      latestEvent: "draft:log · Book",
      liveDetail: "draft:log · Book",
    });
  });

  it("summarizes payload with bookId and chapterNumber", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      busy: true,
      activityEntries: [
        { event: "draft:log", data: { bookId: "alpha", chapterNumber: 12 }, timestamp: 10 },
      ],
    })).toMatchObject({
      stage: "working",
      latestEvent: "draft:log · alpha · #12",
      liveDetail: "draft:log · alpha · #12",
    });
  });

  it("falls back to target label for live detail when no create job or event is present", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      busy: true,
    })).toMatchObject({
      stage: "working",
      liveDetail: "Book",
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

  it("flags latest summarized event as error even when a newer raw event cannot be summarized", () => {
    expect(deriveCockpitStatusStrip({
      ...baseInput,
      busy: true,
      activityEntries: [
        { event: "activity:ping", data: { foo: 1 }, timestamp: 10 },
        { event: "draft:error", data: { error: "agent crashed" }, timestamp: 5 },
      ],
    })).toMatchObject({
      stage: "working",
      latestEvent: "draft:error · agent crashed",
      latestEventIsError: true,
    });
  });
});
