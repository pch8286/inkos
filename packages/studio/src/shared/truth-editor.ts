import type { StructuredTruthDocument, TruthDocumentSection } from "./contracts.js";

function normalizeMarkdown(content: string): string {
  return (content ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^\uFEFF/u, "");
}

function splitMarkdownCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isDividerRow(line: string): boolean {
  const cells = splitMarkdownCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function parseSectionBody(text: string): Pick<TruthDocumentSection, "text" | "tableHeaders" | "tableRows"> {
  const lines = normalizeMarkdown(text).split("\n");
  let tableStart = -1;

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index]?.trim().startsWith("|")) continue;
    if (lines[index + 1]?.trim().startsWith("|") && isDividerRow(lines[index + 1] ?? "")) {
      tableStart = index;
      break;
    }
  }

  if (tableStart < 0) {
    return {
      text: text.trim(),
      tableHeaders: [],
      tableRows: [],
    };
  }

  let tableEnd = tableStart + 2;
  while (tableEnd < lines.length && lines[tableEnd]?.trim().startsWith("|")) {
    tableEnd += 1;
  }

  const before = lines.slice(0, tableStart).join("\n").trim();
  const after = lines.slice(tableEnd).join("\n").trim();
  const textParts = [before, after].filter(Boolean);

  return {
    text: textParts.join("\n\n").trim(),
    tableHeaders: splitMarkdownCells(lines[tableStart] ?? ""),
    tableRows: lines.slice(tableStart + 2, tableEnd).map((line) => splitMarkdownCells(line)),
  };
}

export function parseTruthMarkdown(content: string): StructuredTruthDocument {
  const normalized = normalizeMarkdown(content).trim();
  if (!normalized) {
    return {
      frontmatter: "",
      title: "",
      leadText: "",
      sections: [],
    };
  }

  let rest = normalized;
  let frontmatter = "";
  if (rest.startsWith("---\n")) {
    const closingIndex = rest.indexOf("\n---\n", 4);
    if (closingIndex >= 0) {
      frontmatter = rest.slice(0, closingIndex + 4).trim();
      rest = rest.slice(closingIndex + 5).trim();
    }
  }

  const lines = rest.split("\n");
  let title = "";
  let cursor = 0;
  if (lines[0]?.trim().startsWith("# ")) {
    title = lines[0].trim().slice(2).trim();
    cursor = 1;
  }

  const sections: TruthDocumentSection[] = [];
  let currentHeading = "";
  let currentLevel = 2;
  let currentLines: string[] = [];

  const flush = () => {
    const body = currentLines.join("\n").trim();
    const parsed = parseSectionBody(body);
    sections.push({
      id: `${sections.length}`,
      heading: currentHeading,
      headingLevel: currentLevel,
      text: parsed.text,
      tableHeaders: parsed.tableHeaders,
      tableRows: parsed.tableRows,
    });
    currentLines = [];
  };

  for (let index = cursor; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(/^(#{2,6})\s+(.*)$/u);
    if (match) {
      if (currentLines.length > 0 || currentHeading) {
        flush();
      }
      currentHeading = match[2]?.trim() ?? "";
      currentLevel = match[1]?.length ?? 2;
      continue;
    }
    currentLines.push(line);
  }

  if (currentLines.length > 0 || currentHeading) {
    flush();
  }

  let leadText = "";
  let normalizedSections = sections;
  if (sections[0] && !sections[0].heading) {
    leadText = sections[0].text;
    normalizedSections = sections.slice(1);
  }

  return {
    frontmatter,
    title,
    leadText,
    sections: normalizedSections,
  };
}

function renderMarkdownTable(headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): string {
  if (headers.length === 0) return "";
  const divider = headers.map(() => "---");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${divider.join(" | ")} |`,
    ...rows.map((row) => `| ${headers.map((_, index) => row[index] ?? "").join(" | ")} |`),
  ].join("\n");
}

export function serializeTruthMarkdown(document: StructuredTruthDocument): string {
  const parts: string[] = [];
  if (document.frontmatter.trim()) {
    parts.push(document.frontmatter.trim());
  }
  if (document.title.trim()) {
    parts.push(`# ${document.title.trim()}`);
  }
  if (document.leadText.trim()) {
    parts.push(document.leadText.trim());
  }
  for (const section of document.sections) {
    const block: string[] = [];
    if (section.heading.trim()) {
      block.push(`${"#".repeat(Math.max(2, section.headingLevel || 2))} ${section.heading.trim()}`);
    }
    if (section.text.trim()) {
      block.push(section.text.trim());
    }
    const table = renderMarkdownTable(section.tableHeaders, section.tableRows);
    if (table) {
      block.push(table);
    }
    if (block.length > 0) {
      parts.push(block.join("\n\n"));
    }
  }
  return `${parts.filter(Boolean).join("\n\n").trim()}\n`;
}

export function countCharacters(value: string): number {
  return (value ?? "").length;
}
