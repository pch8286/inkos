export type InlineReviewDecision = "approve" | "request-change" | "comment";

export interface InlineReviewThread {
  readonly id: string;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly decision: InlineReviewDecision;
  readonly status: "open" | "resolved";
  readonly note: string;
  readonly quote: string;
  readonly createdAt: string;
  readonly resolvedAt?: string | null;
}

export interface InlineReviewSummary {
  readonly approvalCount: number;
  readonly requestChangeCount: number;
  readonly commentCount: number;
  readonly totalCount: number;
  readonly status: "idle" | "approved" | "changes-requested" | "mixed" | "commented";
}

export function splitInlineReviewLines(content: string): ReadonlyArray<string> {
  const normalized = content.replace(/\r\n?/g, "\n");
  return normalized.split("\n");
}

export function normalizeInlineReviewRange(
  startLine: number,
  endLine: number,
  totalLines: number,
): { readonly startLine: number; readonly endLine: number } {
  const safeTotal = Math.max(totalLines, 1);
  const safeStart = Math.min(safeTotal, Math.max(1, startLine));
  const safeEnd = Math.min(safeTotal, Math.max(1, endLine));

  return {
    startLine: Math.min(safeStart, safeEnd),
    endLine: Math.max(safeStart, safeEnd),
  };
}

export function buildInlineReviewQuote(
  lines: ReadonlyArray<string>,
  startLine: number,
  endLine: number,
): string {
  const { startLine: safeStart, endLine: safeEnd } = normalizeInlineReviewRange(startLine, endLine, lines.length);
  return lines
    .slice(safeStart - 1, safeEnd)
    .join("\n")
    .trim();
}

export function summarizeInlineReviewThreads(
  threads: ReadonlyArray<InlineReviewThread>,
  targetId?: string,
): InlineReviewSummary {
  const filtered = targetId
    ? threads.filter((thread) => thread.targetId === targetId)
    : threads;

  let approvalCount = 0;
  let requestChangeCount = 0;
  let commentCount = 0;

  for (const thread of filtered) {
    if (thread.status === "resolved") {
      continue;
    }
    if (thread.decision === "approve") {
      approvalCount += 1;
    } else if (thread.decision === "request-change") {
      requestChangeCount += 1;
    } else {
      commentCount += 1;
    }
  }

  const totalCount = filtered.length;
  let status: InlineReviewSummary["status"] = "idle";
  if (requestChangeCount > 0 && approvalCount > 0) {
    status = "mixed";
  } else if (requestChangeCount > 0) {
    status = "changes-requested";
  } else if (approvalCount > 0) {
    status = "approved";
  } else if (commentCount > 0) {
    status = "commented";
  }

  return {
    approvalCount,
    requestChangeCount,
    commentCount,
    totalCount,
    status,
  };
}

export function formatInlineReviewRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`;
}
