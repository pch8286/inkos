import { describe, expect, it, vi } from "vitest";
import type { BookSetupSessionPayload } from "../shared/contracts";
import { runSetupAutoCreate } from "./cockpit-setup-autocreate";
import { runSetupMutationWithBestEffortFollowUp } from "./use-cockpit-setup-session";

function makeSession(overrides: Partial<BookSetupSessionPayload>): BookSetupSessionPayload {
  return {
    id: "setup-demo",
    revision: 1,
    status: "proposed",
    bookId: "demo-book",
    title: "Demo Book",
    genre: "modern-fantasy",
    language: "ko",
    platform: "naver-series",
    chapterWordCount: 3000,
    targetChapters: 200,
    brief: "Brief",
    proposal: {
      content: "# Setup Proposal",
      createdAt: "2026-04-17T00:00:00.000Z",
      revision: 1,
    },
    createdAt: "2026-04-17T00:00:00.000Z",
    updatedAt: "2026-04-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("runSetupAutoCreate", () => {
  it("returns the mutation result even if best-effort follow-up refresh fails", async () => {
    const approved = makeSession({ status: "approved", revision: 2 });
    const apply = vi.fn();
    const followUp = vi.fn(async () => {
      throw new Error("refresh failed");
    });

    await expect(runSetupMutationWithBestEffortFollowUp({
      mutate: async () => approved,
      apply,
      followUp,
    })).resolves.toBe(approved);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(approved);
    expect(followUp).toHaveBeenCalledTimes(1);
  });

  it("runs proposal, approval, preview, and create in order for a fresh setup", async () => {
    const calls: string[] = [];
    const proposed = makeSession({ status: "proposed", revision: 1 });
    const approved = makeSession({ status: "approved", revision: 2 });
    const previewed = makeSession({
      status: "approved",
      revision: 3,
      foundationPreview: {
        createdAt: "2026-04-17T00:00:01.000Z",
        revision: 3,
        digest: "sha256:demo",
        storyBible: "# story_bible",
        volumeOutline: "# volume_outline",
        bookRules: "# book_rules",
        currentState: "# current_state",
        pendingHooks: "# pending_hooks",
      },
    });
    const creating = makeSession({ status: "creating", revision: 4, foundationPreview: previewed.foundationPreview });

    const result = await runSetupAutoCreate({
      currentSession: null,
      needsFreshProposal: true,
      prepareProposal: async () => {
        calls.push("proposal");
        return proposed;
      },
      approveProposal: async () => {
        calls.push("approval");
        return approved;
      },
      prepareFoundationPreview: async () => {
        calls.push("preview");
        return previewed;
      },
      createBook: async () => {
        calls.push("create");
        return { bookId: "demo-book", session: creating };
      },
    });

    expect(calls).toEqual(["proposal", "approval", "preview", "create"]);
    expect(result).toMatchObject({
      status: "success",
      bookId: "demo-book",
      session: { status: "creating", revision: 4 },
    });
  });

  it("skips directly to create when the session is already approved and previewed", async () => {
    const previewed = makeSession({
      status: "approved",
      revision: 3,
      foundationPreview: {
        createdAt: "2026-04-17T00:00:01.000Z",
        revision: 3,
        digest: "sha256:demo",
        storyBible: "# story_bible",
        volumeOutline: "# volume_outline",
        bookRules: "# book_rules",
        currentState: "# current_state",
        pendingHooks: "# pending_hooks",
      },
    });
    const prepareProposal = vi.fn(async () => previewed);
    const approveProposal = vi.fn(async () => previewed);
    const prepareFoundationPreview = vi.fn(async () => previewed);
    const createBook = vi.fn(async () => ({
      bookId: "demo-book",
      session: makeSession({
        status: "creating",
        revision: 4,
        foundationPreview: previewed.foundationPreview,
      }),
    }));

    const result = await runSetupAutoCreate({
      currentSession: previewed,
      needsFreshProposal: false,
      prepareProposal,
      approveProposal,
      prepareFoundationPreview,
      createBook,
    });

    expect(prepareProposal).not.toHaveBeenCalled();
    expect(approveProposal).not.toHaveBeenCalled();
    expect(prepareFoundationPreview).not.toHaveBeenCalled();
    expect(createBook).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "success",
      bookId: "demo-book",
      session: { status: "creating", revision: 4 },
    });
  });

  it("restarts from proposal when a fresh proposal is required even if the old session is already creating", async () => {
    const calls: string[] = [];
    const creating = makeSession({
      status: "creating",
      revision: 4,
      foundationPreview: {
        createdAt: "2026-04-17T00:00:01.000Z",
        revision: 4,
        digest: "sha256:queued",
        storyBible: "# story_bible",
        volumeOutline: "# volume_outline",
        bookRules: "# book_rules",
        currentState: "# current_state",
        pendingHooks: "# pending_hooks",
      },
    });
    const proposed = makeSession({ status: "proposed", revision: 5 });
    const approved = makeSession({ status: "approved", revision: 6 });
    const previewed = makeSession({
      status: "approved",
      revision: 7,
      foundationPreview: {
        createdAt: "2026-04-17T00:00:02.000Z",
        revision: 7,
        digest: "sha256:fresh",
        storyBible: "# new_story_bible",
        volumeOutline: "# new_volume_outline",
        bookRules: "# new_book_rules",
        currentState: "# new_current_state",
        pendingHooks: "# new_pending_hooks",
      },
    });

    const result = await runSetupAutoCreate({
      currentSession: creating,
      needsFreshProposal: true,
      prepareProposal: async () => {
        calls.push("proposal");
        return proposed;
      },
      approveProposal: async () => {
        calls.push("approval");
        return approved;
      },
      prepareFoundationPreview: async () => {
        calls.push("preview");
        return previewed;
      },
      createBook: async () => {
        calls.push("create");
        return { bookId: "fresh-book", session: makeSession({ status: "creating", revision: 8, foundationPreview: previewed.foundationPreview }) };
      },
    });

    expect(calls).toEqual(["proposal", "approval", "preview", "create"]);
    expect(result).toMatchObject({
      status: "success",
      bookId: "fresh-book",
      session: { status: "creating", revision: 8 },
    });
  });

  it("returns the failing phase and last successful session when a step throws", async () => {
    const proposed = makeSession({ status: "proposed", revision: 1 });

    const result = await runSetupAutoCreate({
      currentSession: null,
      needsFreshProposal: true,
      prepareProposal: async () => proposed,
      approveProposal: async () => {
        throw new Error("approval drift");
      },
      prepareFoundationPreview: async () => proposed,
      createBook: async () => ({ bookId: "demo-book", session: proposed }),
    });

    expect(result).toMatchObject({
      status: "failure",
      phase: "approving-proposal",
      session: { revision: 1, status: "proposed" },
    });
  });

  it("does not preserve a stale previous session when a fresh proposal attempt fails immediately", async () => {
    const previous = makeSession({
      status: "approved",
      revision: 3,
      foundationPreview: {
        createdAt: "2026-04-17T00:00:01.000Z",
        revision: 3,
        digest: "sha256:previous",
        storyBible: "# story_bible",
        volumeOutline: "# volume_outline",
        bookRules: "# book_rules",
        currentState: "# current_state",
        pendingHooks: "# pending_hooks",
      },
    });

    const result = await runSetupAutoCreate({
      currentSession: previous,
      needsFreshProposal: true,
      prepareProposal: async () => {
        throw new Error("proposal failed");
      },
      approveProposal: async () => previous,
      prepareFoundationPreview: async () => previous,
      createBook: async () => ({ bookId: "demo-book", session: previous }),
    });

    expect(result).toMatchObject({
      status: "failure",
      phase: "preparing-proposal",
      session: null,
    });
  });
});
