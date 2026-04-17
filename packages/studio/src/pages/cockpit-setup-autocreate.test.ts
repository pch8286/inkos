import { describe, expect, it, vi } from "vitest";
import type { BookSetupSessionPayload } from "../shared/contracts";
import { runSetupAutoCreate } from "./cockpit-setup-autocreate";

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
      prepareProposal: async () => previewed,
      approveProposal: async () => previewed,
      prepareFoundationPreview: async () => previewed,
      createBook,
    });

    expect(createBook).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "success",
      bookId: "demo-book",
      session: { status: "creating", revision: 4 },
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
});
