import { describe, expect, it } from "vitest";
import {
  buildSetupDraftFingerprint,
  buildSetupNotes,
  buildSetupProposalDeltaSummary,
  canPrepareSetupProposal,
  deriveSetupDiscussionState,
  extractSetupProposalSections,
} from "./cockpit-setup-state";

describe("buildSetupDraftFingerprint", () => {
  it("changes when the setup discussion changes", () => {
    const base = buildSetupDraftFingerprint({
      title: "Demo",
      genre: "modern-fantasy",
      platform: "naver-series",
      chapterWordCount: "3000",
      targetChapters: "200",
      brief: "Political inheritance drama.",
      conversation: [],
    });

    const changed = buildSetupDraftFingerprint({
      title: "Demo",
      genre: "modern-fantasy",
      platform: "naver-series",
      chapterWordCount: "3000",
      targetChapters: "200",
      brief: "Political inheritance drama.",
      conversation: [{ role: "user", content: "Keep the debt politics visible." }],
    });

    expect(changed).not.toBe(base);
  });
});

describe("deriveSetupDiscussionState", () => {
  it("only returns ready when the current draft matches the armed fingerprint", () => {
    const fingerprint = buildSetupDraftFingerprint({
      title: "Demo",
      genre: "modern-fantasy",
      platform: "naver-series",
      chapterWordCount: "3000",
      targetChapters: "200",
      brief: "Political inheritance drama.",
      conversation: [],
    });

    expect(deriveSetupDiscussionState(null, fingerprint)).toBe("discussing");
    expect(deriveSetupDiscussionState(fingerprint, fingerprint)).toBe("ready");
    expect(deriveSetupDiscussionState("stale", fingerprint)).toBe("discussing");
  });
});

describe("canPrepareSetupProposal", () => {
  it("requires explicit readiness, core setup inputs, and actual brief/discussion context", () => {
    expect(canPrepareSetupProposal({
      discussionState: "discussing",
      title: "Demo",
      genre: "modern-fantasy",
      brief: "Political inheritance drama.",
      hasDiscussion: true,
    })).toBe(false);

    expect(canPrepareSetupProposal({
      discussionState: "ready",
      title: "Demo",
      genre: "modern-fantasy",
      brief: "",
      hasDiscussion: true,
    })).toBe(false);

    expect(canPrepareSetupProposal({
      discussionState: "ready",
      title: "Demo",
      genre: "modern-fantasy",
      brief: "Political inheritance drama.",
      hasDiscussion: false,
    })).toBe(false);

    expect(canPrepareSetupProposal({
      discussionState: "ready",
      title: "Demo",
      genre: "modern-fantasy",
      brief: "Political inheritance drama.",
      hasDiscussion: true,
    })).toBe(true);
  });
});

describe("extractSetupProposalSections", () => {
  it("extracts controlled setup proposal sections by heading", () => {
    const sections = extractSetupProposalSections([
      "# Setup Proposal",
      "## Alignment Summary",
      "Grounded inheritance fantasy.",
      "",
      "## Chosen Parameters",
      "- Title: Demo",
      "",
      "## Open Questions",
      "- Which faction owns the debt?",
      "",
      "## Approved Creative Brief",
      "Keep the premise politically grounded.",
      "",
      "## Why This Shape",
      "It keeps the conflict reviewable.",
    ].join("\n"));

    expect(sections.alignmentSummary).toBe("Grounded inheritance fantasy.");
    expect(sections.chosenParameters).toContain("Title: Demo");
    expect(sections.openQuestions).toContain("Which faction owns the debt?");
    expect(sections.approvedCreativeBrief).toContain("politically grounded");
    expect(sections.whyThisShape).toContain("reviewable");
  });
});

describe("buildSetupProposalDeltaSummary", () => {
  it("summarizes only the changed proposal sections", () => {
    expect(buildSetupProposalDeltaSummary({
      previousContent: [
        "# Setup Proposal",
        "## Alignment Summary",
        "A",
        "",
        "## Open Questions",
        "- none",
      ].join("\n"),
      currentContent: [
        "# Setup Proposal",
        "## Alignment Summary",
        "A2",
        "",
        "## Open Questions",
        "- none",
      ].join("\n"),
    })).toEqual(["Alignment Summary"]);
  });
});

describe("buildSetupNotes", () => {
  it("surfaces missing information before a proposal exists", () => {
    const notes = buildSetupNotes({
      title: "",
      genre: "",
      platform: "",
      chapterWordCount: "",
      targetChapters: "",
      brief: "",
      conversation: [],
    });

    expect(notes.missing).toEqual(expect.arrayContaining(["title", "genre", "brief", "discussion"]));
  });

  it("uses proposal sections when a proposal already exists", () => {
    const notes = buildSetupNotes({
      title: "Demo",
      genre: "modern-fantasy",
      platform: "naver-series",
      chapterWordCount: "3000",
      targetChapters: "200",
      brief: "Political inheritance drama.",
      conversation: [{ role: "user", content: "Keep the debt politics visible." }],
      proposalContent: [
        "# Setup Proposal",
        "## Chosen Parameters",
        "- Title: Demo",
        "- Genre: modern-fantasy",
        "",
        "## Open Questions",
        "- Which faction owns the debt?",
        "",
        "## Approved Creative Brief",
        "Keep the premise politically grounded.",
      ].join("\n"),
    });

    expect(notes.chosen).toContain("Title: Demo");
    expect(notes.openQuestions).toEqual(["Which faction owns the debt?"]);
    expect(notes.creativeBriefPreview).toContain("politically grounded");
  });
});
