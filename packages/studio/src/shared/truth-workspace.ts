import type { TruthFileSummary } from "./contracts";
import type { TruthAlignmentContext } from "./truth-assistant";

export interface TruthAlignmentDraftValue {
  readonly knownFacts: string;
  readonly unknowns: string;
  readonly mustDecide: string;
  readonly askFirst: string;
}

export interface TruthMentionEntry {
  readonly fileName: string;
  readonly label: string;
  readonly matches: ReadonlyArray<string>;
  readonly excerpt: string;
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);
}

function joinLines(values: ReadonlyArray<string>): string {
  return values.join("\n");
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function uniqueValues(values: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(value.trim());
  }
  return unique;
}

function collectTokens(value: string): ReadonlyArray<string> {
  return uniqueValues(
    value
      .split(/[^0-9A-Za-z가-힣]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  );
}

function buildExcerpt(content: string, matches: ReadonlyArray<string>): string {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const normalizedMatches = matches.map(normalizeText);
  const matchingLine = lines.find((line) => {
    const normalizedLine = normalizeText(line);
    return normalizedMatches.some((match) => normalizedLine.includes(match));
  });
  if (matchingLine) {
    return matchingLine.length <= 120 ? matchingLine : `${matchingLine.slice(0, 117).trimEnd()}...`;
  }
  const compact = lines.join(" ");
  return compact.length <= 120 ? compact : `${compact.slice(0, 117).trimEnd()}...`;
}

export function buildTruthAliases(params: {
  readonly name: string;
  readonly label: string;
  readonly title?: string;
  readonly sectionHeadings?: ReadonlyArray<string>;
}): ReadonlyArray<string> {
  const baseName = params.name.replace(/\.md$/i, "").replace(/[_-]+/g, " ").trim();
  return uniqueValues([
    params.label,
    params.title?.trim() ?? "",
    baseName,
    ...(params.sectionHeadings ?? []).slice(0, 6),
  ]).filter((entry) => entry.length >= 2);
}

function findMatches(content: string, aliases: ReadonlyArray<string>): ReadonlyArray<string> {
  const normalizedContent = normalizeText(content);
  return aliases.filter((alias) => normalizedContent.includes(normalizeText(alias)));
}

function shouldRemoveUnknown(item: string, question: string, answer: string): boolean {
  const itemNormalized = normalizeText(item);
  if (!itemNormalized) return false;

  if (normalizeText(question).includes(itemNormalized) || normalizeText(answer).includes(itemNormalized)) {
    return true;
  }

  const questionTokens = new Set([...collectTokens(question), ...collectTokens(answer)].map(normalizeText));
  return collectTokens(item).some((token) => questionTokens.has(normalizeText(token)));
}

function mergeInterviewAnswerBase(base: {
  readonly knownFacts: ReadonlyArray<string>;
  readonly unknowns: ReadonlyArray<string>;
  readonly mustDecide: string;
  readonly askFirst: string;
}, params: {
  readonly question: string;
  readonly answer: string;
}): {
  readonly knownFacts: ReadonlyArray<string>;
  readonly unknowns: ReadonlyArray<string>;
  readonly mustDecide: string;
  readonly askFirst: string;
} {
  const answer = params.answer.trim();
  const question = params.question.split("\n\n")[0]?.trim() ?? params.question.trim();
  if (!answer) {
    return base;
  }

  const nextKnownFacts = uniqueValues([...base.knownFacts, answer]);
  const nextUnknowns = base.unknowns.filter((item) => !shouldRemoveUnknown(item, question, answer));
  const decisionQuestion = /(결정|정할|정해야|원칙|기준|무엇이어야|what should|should .*be|decide|rule|principle|must decide)/i.test(question);
  let mustDecide = base.mustDecide.trim();
  if (decisionQuestion) {
    if (!mustDecide) {
      mustDecide = answer;
    } else if (!normalizeText(mustDecide).includes(normalizeText(answer))) {
      mustDecide = `${mustDecide}\n${answer}`;
    }
  }

  return {
    knownFacts: nextKnownFacts,
    unknowns: nextUnknowns,
    mustDecide,
    askFirst: "",
  };
}

export function mergeInterviewAnswerIntoAlignmentDraft(
  draft: TruthAlignmentDraftValue,
  params: {
    readonly question: string;
    readonly answer: string;
  },
): TruthAlignmentDraftValue {
  const merged = mergeInterviewAnswerBase({
    knownFacts: splitLines(draft.knownFacts),
    unknowns: splitLines(draft.unknowns),
    mustDecide: draft.mustDecide,
    askFirst: draft.askFirst,
  }, params);

  return {
    knownFacts: joinLines(merged.knownFacts),
    unknowns: joinLines(merged.unknowns),
    mustDecide: merged.mustDecide,
    askFirst: merged.askFirst,
  };
}

export function mergeInterviewAnswerIntoAlignmentContext(
  context: TruthAlignmentContext,
  params: {
    readonly question: string;
    readonly answer: string;
  },
): TruthAlignmentContext {
  const merged = mergeInterviewAnswerBase(context, params);
  return {
    knownFacts: merged.knownFacts,
    unknowns: merged.unknowns,
    mustDecide: merged.mustDecide,
    askFirst: merged.askFirst,
  };
}

export function computeTruthMentions(params: {
  readonly selectedFileName: string;
  readonly selectedLabel: string;
  readonly selectedTitle?: string;
  readonly selectedHeadings?: ReadonlyArray<string>;
  readonly files: ReadonlyArray<Pick<TruthFileSummary, "name" | "label">>;
  readonly contentByFile: Readonly<Record<string, string>>;
}): {
  readonly outgoing: ReadonlyArray<TruthMentionEntry>;
  readonly backlinks: ReadonlyArray<TruthMentionEntry>;
} {
  const currentContent = params.contentByFile[params.selectedFileName] ?? "";
  const currentAliases = buildTruthAliases({
    name: params.selectedFileName,
    label: params.selectedLabel,
    title: params.selectedTitle,
    sectionHeadings: params.selectedHeadings,
  });

  const outgoing: TruthMentionEntry[] = [];
  const backlinks: TruthMentionEntry[] = [];

  for (const file of params.files) {
    if (file.name === params.selectedFileName) {
      continue;
    }

    const aliases = buildTruthAliases({
      name: file.name,
      label: file.label,
    });
    const outgoingMatches = findMatches(currentContent, aliases);
    if (outgoingMatches.length > 0) {
      outgoing.push({
        fileName: file.name,
        label: file.label,
        matches: outgoingMatches,
        excerpt: buildExcerpt(currentContent, outgoingMatches),
      });
    }

    const candidateContent = params.contentByFile[file.name] ?? "";
    const backlinkMatches = findMatches(candidateContent, currentAliases);
    if (backlinkMatches.length > 0) {
      backlinks.push({
        fileName: file.name,
        label: file.label,
        matches: backlinkMatches,
        excerpt: buildExcerpt(candidateContent, backlinkMatches),
      });
    }
  }

  const sortEntries = (left: TruthMentionEntry, right: TruthMentionEntry) => {
    if (right.matches.length !== left.matches.length) {
      return right.matches.length - left.matches.length;
    }
    return left.label.localeCompare(right.label);
  };

  return {
    outgoing: outgoing.sort(sortEntries),
    backlinks: backlinks.sort(sortEntries),
  };
}
