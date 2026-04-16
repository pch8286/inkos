import type { BookSetupConversationEntry } from "../shared/contracts";

export type SetupDiscussionState = "discussing" | "ready";

type SetupProposalSectionKey =
  | "alignmentSummary"
  | "chosenParameters"
  | "openQuestions"
  | "approvedCreativeBrief"
  | "whyThisShape";

interface SetupProposalSectionDefinition {
  readonly key: SetupProposalSectionKey;
  readonly heading: string;
}

const SETUP_PROPOSAL_SECTIONS: ReadonlyArray<SetupProposalSectionDefinition> = [
  { key: "alignmentSummary", heading: "Alignment Summary" },
  { key: "chosenParameters", heading: "Chosen Parameters" },
  { key: "openQuestions", heading: "Open Questions" },
  { key: "approvedCreativeBrief", heading: "Approved Creative Brief" },
  { key: "whyThisShape", heading: "Why This Shape" },
];

const SETUP_PROPOSAL_SECTION_LABELS = Object.fromEntries(
  SETUP_PROPOSAL_SECTIONS.map((section) => [section.key, section.heading]),
) as Record<SetupProposalSectionKey, string>;

export interface SetupProposalSections {
  readonly alignmentSummary: string;
  readonly chosenParameters: string;
  readonly openQuestions: string;
  readonly approvedCreativeBrief: string;
  readonly whyThisShape: string;
}

export interface SetupNotesSummary {
  readonly chosen: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<"title" | "genre" | "brief" | "discussion">;
  readonly openQuestions: ReadonlyArray<string>;
  readonly creativeBriefPreview: string;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function normalizeConversation(
  conversation: ReadonlyArray<BookSetupConversationEntry> | undefined,
): ReadonlyArray<BookSetupConversationEntry> {
  return (conversation ?? [])
    .filter((entry) => entry.role === "user" || entry.role === "assistant")
    .map((entry) => ({
      role: entry.role,
      content: normalizeText(entry.content),
    }))
    .filter((entry) => entry.content.length > 0);
}

function trimSectionBody(lines: ReadonlyArray<string>): string {
  return lines.join("\n").trim();
}

function listItemsFromSection(section: string): string[] {
  const items = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);

  if (items.length > 0) {
    return items;
  }

  return section.trim() ? [section.trim()] : [];
}

function hasDiscussion(conversation: ReadonlyArray<BookSetupConversationEntry>): boolean {
  return conversation.some((entry) => entry.content.trim().length > 0);
}

export function buildSetupDraftFingerprint(input: {
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly chapterWordCount: string | number;
  readonly targetChapters: string | number;
  readonly brief: string;
  readonly conversation: ReadonlyArray<BookSetupConversationEntry>;
}): string {
  return JSON.stringify({
    title: normalizeText(input.title),
    genre: normalizeText(input.genre),
    platform: normalizeText(input.platform),
    chapterWordCount: normalizeText(input.chapterWordCount),
    targetChapters: normalizeText(input.targetChapters),
    brief: normalizeText(input.brief),
    conversation: normalizeConversation(input.conversation),
  });
}

export function deriveSetupDiscussionState(
  readyFingerprint: string | null,
  currentFingerprint: string,
): SetupDiscussionState {
  return readyFingerprint && readyFingerprint === currentFingerprint ? "ready" : "discussing";
}

export function canPrepareSetupProposal(input: {
  readonly discussionState: SetupDiscussionState;
  readonly title: string;
  readonly genre: string;
  readonly brief: string;
  readonly hasDiscussion: boolean;
}): boolean {
  return input.discussionState === "ready"
    && normalizeText(input.title).length > 0
    && normalizeText(input.genre).length > 0
    && normalizeText(input.brief).length > 0
    && input.hasDiscussion;
}

export function extractSetupProposalSections(markdown: string): SetupProposalSections {
  const buckets = new Map<SetupProposalSectionKey, string[]>(
    SETUP_PROPOSAL_SECTIONS.map((section) => [section.key, []]),
  );
  let currentKey: SetupProposalSectionKey | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      const heading = headingMatch[1]!.trim();
      currentKey = SETUP_PROPOSAL_SECTIONS.find((section) => section.heading === heading)?.key ?? null;
      continue;
    }
    if (currentKey) {
      buckets.get(currentKey)!.push(line);
    }
  }

  return {
    alignmentSummary: trimSectionBody(buckets.get("alignmentSummary") ?? []),
    chosenParameters: trimSectionBody(buckets.get("chosenParameters") ?? []),
    openQuestions: trimSectionBody(buckets.get("openQuestions") ?? []),
    approvedCreativeBrief: trimSectionBody(buckets.get("approvedCreativeBrief") ?? []),
    whyThisShape: trimSectionBody(buckets.get("whyThisShape") ?? []),
  };
}

export function buildSetupProposalDeltaSummary(input: {
  readonly previousContent?: string;
  readonly currentContent: string;
}): ReadonlyArray<string> {
  if (!normalizeText(input.previousContent).length || !normalizeText(input.currentContent).length) {
    return [];
  }

  const previous = extractSetupProposalSections(input.previousContent ?? "");
  const current = extractSetupProposalSections(input.currentContent);

  return SETUP_PROPOSAL_SECTIONS
    .filter((section) => previous[section.key].trim() !== current[section.key].trim())
    .map((section) => SETUP_PROPOSAL_SECTION_LABELS[section.key]);
}

export function buildSetupNotes(input: {
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly chapterWordCount: string | number;
  readonly targetChapters: string | number;
  readonly brief: string;
  readonly conversation: ReadonlyArray<BookSetupConversationEntry>;
  readonly proposalContent?: string;
}): SetupNotesSummary {
  const title = normalizeText(input.title);
  const genre = normalizeText(input.genre);
  const platform = normalizeText(input.platform);
  const chapterWordCount = normalizeText(input.chapterWordCount);
  const targetChapters = normalizeText(input.targetChapters);
  const brief = normalizeText(input.brief);
  const conversation = normalizeConversation(input.conversation);
  const proposalSections = extractSetupProposalSections(input.proposalContent ?? "");

  const chosen = listItemsFromSection(proposalSections.chosenParameters);
  if (chosen.length === 0) {
    if (title) chosen.push(`Title: ${title}`);
    if (genre) chosen.push(`Genre: ${genre}`);
    if (platform) chosen.push(`Platform: ${platform}`);
    if (chapterWordCount) chosen.push(`Words / Chapter: ${chapterWordCount}`);
    if (targetChapters) chosen.push(`Target Chapters: ${targetChapters}`);
  }

  const missing: Array<"title" | "genre" | "brief" | "discussion"> = [];
  if (!title) missing.push("title");
  if (!genre) missing.push("genre");
  if (!brief) missing.push("brief");
  if (!hasDiscussion(conversation)) missing.push("discussion");

  return {
    chosen,
    missing,
    openQuestions: listItemsFromSection(proposalSections.openQuestions),
    creativeBriefPreview: proposalSections.approvedCreativeBrief.trim() || brief,
  };
}
