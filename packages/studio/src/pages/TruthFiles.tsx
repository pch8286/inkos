import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type TextareaHTMLAttributes } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpenText,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Files,
  ListTree,
  Pencil,
  Plus,
  Rows3,
  Save,
  Sparkles,
  TableProperties,
  Trash2,
  X,
} from "lucide-react";
import { fetchJson, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import type {
  StructuredTruthDocument,
  TruthBulkDraft,
  TruthDocumentSection,
  TruthFileDetail,
  TruthFileSummary,
  TruthSectionSummary,
} from "../shared/contracts";
import type { BinderMode, TruthAssistantContext } from "../shared/truth-assistant";
import {
  clearStoredTruthSession,
  readStoredTruthSession,
  type StoredTruthSession,
  writeStoredTruthSession,
} from "../shared/truth-session";
import { countCharacters, parseTruthMarkdown, serializeTruthMarkdown } from "../shared/truth-editor";
import {
  computeTruthMentions,
  mergeInterviewAnswerIntoAlignmentDraft,
  type TruthAlignmentDraftValue,
} from "../shared/truth-workspace";

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

interface BinderStats {
  readonly total: number;
  readonly ready: number;
  readonly missing: number;
}

type TruthAlignmentDraft = TruthAlignmentDraftValue;

const SUMMARY_FOCUS_FILE_ORDER = [
  "author_intent.md",
  "current_focus.md",
  "story_bible.md",
  "volume_outline.md",
  "book_rules.md",
  "current_state.md",
  "pending_hooks.md",
  "character_matrix.md",
  "emotional_arcs.md",
] as const;
type SummaryFocusFileName = (typeof SUMMARY_FOCUS_FILE_ORDER)[number];

const WORKSPACE_FILE_ORDER = [
  "author_intent.md",
  "current_focus.md",
  "story_bible.md",
  "volume_outline.md",
  "book_rules.md",
  "current_state.md",
  "pending_hooks.md",
] as const;

const SUMMARY_FOCUS_FILE_SET = new Set<string>(SUMMARY_FOCUS_FILE_ORDER);
const WORKSPACE_FILE_SET = new Set<string>(WORKSPACE_FILE_ORDER);

function normalizeBulkDraftState(
  state: Partial<TruthBulkDraft> | undefined,
  updates: Partial<TruthBulkDraft>,
): TruthBulkDraft {
  return {
    name: updates.name ?? state?.name ?? "",
    content: updates.content ?? state?.content ?? "",
    originalContent: updates.originalContent ?? state?.originalContent ?? "",
    assistPrompt: updates.assistPrompt ?? state?.assistPrompt ?? "",
    loading: updates.loading ?? false,
    saving: updates.saving ?? false,
    assisting: updates.assisting ?? false,
    error: updates.error ?? null,
    assistError: updates.assistError ?? null,
  };
}

type EditorMode = "structured" | "markdown";

function groupTruthFiles(files: ReadonlyArray<TruthFileSummary>): ReadonlyArray<TruthSectionSummary> {
  const sections = new Map<string, TruthSectionSummary>();
  for (const file of files) {
    const existing = sections.get(file.section);
    if (existing) {
      sections.set(file.section, { ...existing, files: [...existing.files, file] });
      continue;
    }
    sections.set(file.section, {
      id: file.section,
      label: file.sectionLabel,
      files: [file],
    });
  }
  return [...sections.values()];
}

function getOverviewSectionRank(fileName: string): number {
  const order = SUMMARY_FOCUS_FILE_ORDER.indexOf(fileName as SummaryFocusFileName);
  return order >= 0 ? order : SUMMARY_FOCUS_FILE_ORDER.length + fileName.length;
}

function getWorkspaceRank(fileName: string): number {
  const order = WORKSPACE_FILE_ORDER.indexOf(fileName as (typeof WORKSPACE_FILE_ORDER)[number]);
  return order >= 0 ? order : WORKSPACE_FILE_ORDER.length + fileName.length;
}

function summarizePreview(preview: string): string {
  return String(preview ?? "")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^\|.*$/gmu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function reindexSections(sections: ReadonlyArray<TruthDocumentSection>): ReadonlyArray<TruthDocumentSection> {
  return sections.map((section, index) => ({ ...section, id: `${index}` }));
}

function hasSectionBody(section: TruthDocumentSection): boolean {
  return section.text.trim().length > 0 || section.tableHeaders.length > 0 || section.tableRows.length > 0;
}

function compactPreview(value: string, limit = 140): string {
  const preview = summarizePreview(value);
  if (!preview) return "";
  if (preview.length <= limit) return preview;
  return `${preview.slice(0, limit).trimEnd()}...`;
}

function splitAlignmentLines(value: string): ReadonlyArray<string> {
  return value
    .split("\n")
    .map((entry) => entry.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);
}

function createAlignmentDraft(
  knownFacts: ReadonlyArray<string>,
  unknowns: ReadonlyArray<string>,
): TruthAlignmentDraft {
  return {
    knownFacts: knownFacts.join("\n"),
    unknowns: unknowns.join("\n"),
    mustDecide: "",
    askFirst: "",
  };
}

function AutoResizeTextarea({
  value,
  className,
  minHeight = 160,
  style,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
  readonly value: string;
  readonly minHeight?: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "0px";
    ref.current.style.height = `${Math.max(ref.current.scrollHeight, minHeight)}px`;
  }, [minHeight, value]);

  return (
    <textarea
      {...props}
      ref={ref}
      value={value}
      rows={1}
      style={{ ...style, minHeight }}
      className={`${className} overflow-hidden`}
    />
  );
}

export function TruthFiles({
  bookId,
  nav,
  theme,
  t,
  onAssistantContextChange,
}: {
  bookId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
  onAssistantContextChange?: (context: TruthAssistantContext | null) => void;
}) {
  const c = useColors(theme);
  const {
    data,
    loading: listLoading,
    error: listError,
    refetch: refetchList,
  } = useApi<{ files: ReadonlyArray<TruthFileSummary> }>(`/books/${bookId}/truth`);
  const {
    data: bookMeta,
    refetch: refetchBookMeta,
  } = useApi<{ book: { id: string; title: string } }>(`/books/${bookId}`);
  const [selected, setSelected] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("structured");
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [bookTitleDraft, setBookTitleDraft] = useState("");
  const [renamingBookTitle, setRenamingBookTitle] = useState(false);
  const [savingBookTitle, setSavingBookTitle] = useState(false);
  const [structuredDoc, setStructuredDoc] = useState<StructuredTruthDocument | null>(null);
  const [editingError, setEditingError] = useState<string | null>(null);
  const [bulkDrafts, setBulkDrafts] = useState<Record<string, TruthBulkDraft>>({});
  const [activeMode, setActiveMode] = useState<BinderMode>("overview");
  const [workspaceTargetFile, setWorkspaceTargetFile] = useState<string>("");
  const [alignmentDrafts, setAlignmentDrafts] = useState<Record<string, TruthAlignmentDraft>>({});
  const [truthContentCache, setTruthContentCache] = useState<Record<string, string>>({});
  const [restoredLocalDrafts, setRestoredLocalDrafts] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [activeEditorKey, setActiveEditorKey] = useState("doc-title");
  const editorAnchorsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const restoredSessionBookRef = useRef<string | null>(null);
  const loadingContentRef = useRef<Set<string>>(new Set());
  const {
    data: fileData,
    error: fileError,
    loading: fileLoading,
    refetch: refetchFile,
  } = useApi<TruthFileDetail>(selected ? `/books/${bookId}/truth/${selected}` : "");

  const sections = useMemo(() => groupTruthFiles(data?.files ?? []), [data?.files]);
  const overviewSections = useMemo(() => {
    return sections
      .filter((section) => section.id !== "reference")
      .map((section) => ({
        ...section,
        files: [...section.files]
          .filter((file) => SUMMARY_FOCUS_FILE_SET.has(file.name) || !file.optional)
          .sort((left, right) => {
            const leftRank = getOverviewSectionRank(left.name);
            const rightRank = getOverviewSectionRank(right.name);
            return leftRank === rightRank ? left.name.localeCompare(right.name) : leftRank - rightRank;
          }),
      }))
      .filter((section) => section.files.length > 0);
  }, [sections]);
  const binderStats = useMemo<BinderStats>(() => {
    const files = data?.files ?? [];
    const ready = files.filter((entry) => entry.exists).length;
    return {
      total: files.length,
      ready,
      missing: files.length - ready,
    };
  }, [data?.files]);
  const workspaceFiles = useMemo(
    () => [...(data?.files ?? [])]
      .filter((file) => WORKSPACE_FILE_SET.has(file.name))
      .sort((left, right) => getWorkspaceRank(left.name) - getWorkspaceRank(right.name)),
    [data?.files],
  );
  const selectedSummary = useMemo(
    () => data?.files.find((entry) => entry.name === selected) ?? null,
    [data?.files, selected],
  );
  const relatedFiles = useMemo(
    () => data?.files
      .filter((file) => file.section === selectedSummary?.section && file.name !== selectedSummary?.name)
      .slice(0, 5) ?? [],
    [data?.files, selectedSummary?.name, selectedSummary?.section],
  );
  const showDocumentList = activeMode === "overview" && Boolean(selected) && !(editMode && editorMode === "structured");
  const assistantFiles = useMemo(() => {
    const allFiles = data?.files ?? [];
    if (selected && selectedSummary) {
      return [
        selectedSummary,
        ...allFiles.filter((file) => file.name !== selectedSummary.name),
      ];
    }
    return allFiles;
  }, [data?.files, selected, selectedSummary]);
  const agentCurrentContents = useMemo(() => {
    const entries = Object.values(bulkDrafts)
      .filter((draft) => typeof draft.name === "string" && draft.name.length > 0)
      .map((draft) => [draft.name, draft.content] as const);
    if (selected) {
      const selectedContent = editMode
        ? editorMode === "structured" && structuredDoc
          ? serializeTruthMarkdown(structuredDoc)
          : editText
        : fileData?.content ?? "";
      entries.push([selected, selectedContent]);
    }
    return Object.fromEntries(entries);
  }, [bulkDrafts, editMode, editorMode, editText, fileData?.content, selected, structuredDoc]);
  const canonicalTruthContents = useMemo(() => {
    const contents: Record<string, string> = {};
    for (const file of data?.files ?? []) {
      if (file.name in truthContentCache) {
        contents[file.name] = truthContentCache[file.name] ?? "";
      }
    }
    for (const draft of Object.values(bulkDrafts)) {
      if (draft.name) {
        contents[draft.name] = draft.content;
      }
    }
    if (selected) {
      contents[selected] = editMode
        ? editorMode === "structured" && structuredDoc
          ? serializeTruthMarkdown(structuredDoc)
          : editText
        : bulkDrafts[selected]?.content ?? fileData?.content ?? truthContentCache[selected] ?? "";
    }
    return contents;
  }, [bulkDrafts, data?.files, editMode, editorMode, editText, fileData?.content, selected, structuredDoc, truthContentCache]);
  const deferredAgentCurrentContents = useDeferredValue(agentCurrentContents);
  const workspaceFileSet = useMemo(() => new Set(workspaceFiles.map((file) => file.name)), [workspaceFiles]);
  const sectionLabel = useCallback((section: TruthDocumentSection, index: number) => (
    section.heading.trim() || `${t("truth.sectionPlaceholder")} ${index + 1}`
  ), [t]);

  const outlineItems = useMemo(() => {
    if (!structuredDoc) return [];
    return [
      { key: "doc-title", label: t("truth.docTitle"), hint: structuredDoc.title.trim() || t("truth.missing") },
      ...(structuredDoc.frontmatter.trim()
        ? [{ key: "frontmatter", label: t("truth.frontmatter"), hint: t("truth.exists") }]
        : []),
      { key: "lead-text", label: t("truth.leadText"), hint: compactPreview(structuredDoc.leadText, 64) || t("truth.missing") },
      ...structuredDoc.sections.map((section, index) => ({
        key: `section-${section.id}`,
        label: sectionLabel(section, index),
        hint: hasSectionBody(section) ? compactPreview(section.text, 64) || t("truth.tableEditor") : t("truth.missing"),
      })),
    ];
  }, [sectionLabel, structuredDoc, t]);

  const structuredInsights = useMemo(() => {
    if (!structuredDoc) return null;
    const emptyBlocks = [];
    if (!structuredDoc.title.trim()) emptyBlocks.push(t("truth.docTitle"));
    if (!structuredDoc.leadText.trim()) emptyBlocks.push(t("truth.leadText"));

    const sectionEntries = structuredDoc.sections.map((section, index) => ({ section, index }));
    const emptySections = sectionEntries
      .filter(({ section }) => !section.heading.trim() || !hasSectionBody(section))
      .map(({ section, index }) => sectionLabel(section, index));

    const knownItems = [
      ...(structuredDoc.title.trim() ? [`${t("truth.docTitle")}: ${structuredDoc.title.trim()}`] : []),
      ...(structuredDoc.leadText.trim() ? [`${t("truth.leadText")}: ${compactPreview(structuredDoc.leadText, 84)}`] : []),
      ...sectionEntries
        .filter(({ section }) => section.heading.trim() || hasSectionBody(section))
        .slice(0, 3)
        .map(({ section, index }) => sectionLabel(section, index)),
    ].slice(0, 5);

    return {
      filledSections: sectionEntries.filter(({ section }) => hasSectionBody(section)).length,
      emptyBlocks: [...emptyBlocks, ...emptySections],
      knownItems,
      prompts: [
        t("truth.alignPromptKnown"),
        t("truth.alignPromptUnknown"),
        t("truth.alignPromptDecision"),
        t("truth.alignPromptAsk"),
      ],
    };
  }, [sectionLabel, structuredDoc, t]);

  const alignmentDraftKey = useMemo(() => {
    if (selected) return selected;
    if (workspaceTargetFile) return workspaceTargetFile;
    return activeMode === "overview" ? "__binder__" : "__workspace__";
  }, [activeMode, selected, workspaceTargetFile]);

  const seededAlignmentDraft = useMemo(
    () => createAlignmentDraft(structuredInsights?.knownItems ?? [], structuredInsights?.emptyBlocks ?? []),
    [structuredInsights?.emptyBlocks, structuredInsights?.knownItems],
  );

  const activeAlignmentDraft = alignmentDrafts[alignmentDraftKey] ?? seededAlignmentDraft;
  const displayBookTitle = bookMeta?.book.title?.trim() || bookId;
  const truthMentions = useMemo(() => {
    if (!selectedSummary) {
      return { outgoing: [], backlinks: [] };
    }
    return computeTruthMentions({
      selectedFileName: selectedSummary.name,
      selectedLabel: selectedSummary.label,
      selectedTitle: structuredDoc?.title || selectedSummary.label,
      selectedHeadings: structuredDoc?.sections.map((section) => section.heading).filter(Boolean),
      files: data?.files ?? [],
      contentByFile: canonicalTruthContents,
    });
  }, [canonicalTruthContents, data?.files, selectedSummary, structuredDoc]);
  const detailUnsaved = Boolean(selected && bulkDrafts[selected] && bulkDrafts[selected]!.content !== bulkDrafts[selected]!.originalContent);

  useEffect(() => {
    if (renamingBookTitle) {
      return;
    }
    setBookTitleDraft(bookMeta?.book.title ?? "");
  }, [bookMeta?.book.title, renamingBookTitle]);

  useEffect(() => {
    setRenamingBookTitle(false);
    setSavingBookTitle(false);
  }, [bookId]);

  useEffect(() => {
    setAlignmentDrafts((current) => {
      if (current[alignmentDraftKey]) {
        return current;
      }
      return {
        ...current,
        [alignmentDraftKey]: seededAlignmentDraft,
      };
    });
  }, [alignmentDraftKey, seededAlignmentDraft]);

  useEffect(() => {
    if (!data?.files?.length || restoredSessionBookRef.current === bookId) {
      return;
    }

    const allowedFiles = new Set(data.files.map((file) => file.name));
    const storedSession = readStoredTruthSession(bookId);
    const filteredDrafts = Object.fromEntries(
      Object.entries(storedSession?.drafts ?? {})
        .filter(([name]) => allowedFiles.has(name))
        .map(([name, draft]) => [name, normalizeBulkDraftState(undefined, {
          name,
          content: draft.content,
          originalContent: draft.originalContent,
          loading: false,
          saving: false,
          error: null,
        })]),
    );
    const filteredAlignmentDrafts = Object.fromEntries(
      Object.entries(storedSession?.alignmentDrafts ?? {}).map(([key, draft]) => [key, {
        knownFacts: draft.knownFacts,
        unknowns: draft.unknowns,
        mustDecide: draft.mustDecide,
        askFirst: draft.askFirst,
      } satisfies TruthAlignmentDraft]),
    );
    const restoredSelected = storedSession?.ui.selected && allowedFiles.has(storedSession.ui.selected)
      ? storedSession.ui.selected
      : null;
    const restoredWorkspaceTarget = storedSession?.ui.workspaceTargetFile && allowedFiles.has(storedSession.ui.workspaceTargetFile)
      ? storedSession.ui.workspaceTargetFile
      : "";

    setBulkDrafts(filteredDrafts);
    setAlignmentDrafts((current) => Object.keys(filteredAlignmentDrafts).length > 0 ? filteredAlignmentDrafts : current);
    setTruthContentCache(Object.fromEntries(
      Object.entries(filteredDrafts).map(([name, draft]) => [name, draft.content]),
    ));
    if (storedSession?.ui.activeMode === "workspace" || storedSession?.ui.activeMode === "overview") {
      setActiveMode(storedSession.ui.activeMode);
    }
    setWorkspaceTargetFile(restoredWorkspaceTarget);
    setSelected(restoredSelected);
    setEditMode(Boolean(storedSession?.ui.editMode && restoredSelected));
    setEditorMode(storedSession?.ui.editorMode === "markdown" ? "markdown" : "structured");
    setRestoredLocalDrafts(Boolean(storedSession && (
      Object.keys(filteredDrafts).length > 0
      || Object.keys(filteredAlignmentDrafts).length > 0
      || restoredSelected
    )));
    restoredSessionBookRef.current = bookId;
  }, [bookId, data?.files]);

  useEffect(() => {
    if (!data?.files?.length || restoredSessionBookRef.current !== bookId) {
      return;
    }

    const draftSnapshot = Object.fromEntries(
      Object.entries(bulkDrafts)
        .filter(([, draft]) => draft.name && draft.content !== draft.originalContent)
        .map(([name, draft]) => [name, {
          content: draft.content,
          originalContent: draft.originalContent,
        }]),
    );
    const alignmentSnapshot = Object.fromEntries(
      Object.entries(alignmentDrafts)
        .filter(([, draft]) => draft.knownFacts.trim() || draft.unknowns.trim() || draft.mustDecide.trim() || draft.askFirst.trim())
        .map(([key, draft]) => [key, {
          knownFacts: draft.knownFacts,
          unknowns: draft.unknowns,
          mustDecide: draft.mustDecide,
          askFirst: draft.askFirst,
        }]),
    );

    const hasStateToPersist = Object.keys(draftSnapshot).length > 0
      || Object.keys(alignmentSnapshot).length > 0
      || Boolean(selected)
      || editMode
      || activeMode !== "overview"
      || editorMode !== "structured"
      || Boolean(workspaceTargetFile);

    if (!hasStateToPersist) {
      clearStoredTruthSession(bookId);
      return;
    }

    writeStoredTruthSession(bookId, {
      version: 1,
      drafts: draftSnapshot,
      alignmentDrafts: alignmentSnapshot,
      ui: {
        activeMode,
        selected,
        editMode,
        editorMode,
        workspaceTargetFile,
      },
    } satisfies StoredTruthSession);
  }, [activeMode, alignmentDrafts, bookId, bulkDrafts, data?.files, editMode, editorMode, selected, workspaceTargetFile]);

  useEffect(() => {
    if (!selected) {
      setEditMode(false);
      setEditorMode("structured");
      setEditText("");
      setStructuredDoc(null);
      setEditingError(null);
      setCollapsedSections({});
      setActiveEditorKey("doc-title");
      return;
    }
    if (!data?.files.some((entry) => entry.name === selected)) {
      setSelected(null);
      setEditMode(false);
      setEditorMode("structured");
      setEditText("");
      setStructuredDoc(null);
      setEditingError(null);
      setCollapsedSections({});
      setActiveEditorKey("doc-title");
    }
  }, [data?.files, selected]);

  useEffect(() => {
    if (!structuredDoc || !editMode || editorMode !== "structured") {
      return;
    }
    setCollapsedSections((current) => {
      const next = Object.fromEntries(
        structuredDoc.sections.map((section, index) => [section.id, current[section.id] ?? index > 0]),
      );
      const same = Object.keys(next).length === Object.keys(current).length
        && Object.entries(next).every(([key, value]) => current[key] === value);
      return same ? current : next;
    });
  }, [editMode, editorMode, structuredDoc]);

  const syncBulkStateFromFileList = () => {
    if (!data?.files.length) {
      setBulkDrafts({});
      setTruthContentCache({});
      return;
    }
    const available = new Set(data.files.map((file) => file.name));
    setBulkDrafts((current) => Object.fromEntries(
      Object.entries(current).filter(([name]) => available.has(name)),
    ));
    setTruthContentCache((current) => Object.fromEntries(
      Object.entries(current).filter(([name]) => available.has(name)),
    ));
  };

  useEffect(() => {
    syncBulkStateFromFileList();
  }, [data?.files]);

  useEffect(() => {
    if (selected || workspaceFiles.length === 0) {
      return;
    }
    if (workspaceFiles.some((file) => file.name === workspaceTargetFile)) {
      return;
    }
    setWorkspaceTargetFile(workspaceFiles[0]!.name);
  }, [selected, workspaceFiles, workspaceTargetFile]);

  useEffect(() => {
    if (!selected || fileLoading || fileError) return;
    const content = bulkDrafts[selected]?.content ?? fileData?.content ?? "";
    setEditText(content);
    try {
      setStructuredDoc(parseTruthMarkdown(content));
      setEditingError(null);
    } catch (error) {
      setStructuredDoc(null);
      setEditingError(error instanceof Error ? error.message : "Failed to parse markdown");
      setEditorMode("markdown");
    }
  }, [fileData?.content, fileError, fileLoading, selected]);

  useEffect(() => {
    if (!selected || typeof fileData?.content !== "string") {
      return;
    }
    setTruthContentCache((current) => current[selected] === fileData.content
      ? current
      : { ...current, [selected]: fileData.content ?? "" });
  }, [fileData?.content, selected]);

  useEffect(() => {
    if (!selected || !editMode) {
      return;
    }

    const content = editorMode === "structured" && structuredDoc
      ? serializeTruthMarkdown(structuredDoc)
      : editText;
    const originalContent = bulkDrafts[selected]?.originalContent ?? fileData?.content ?? "";

    setBulkDrafts((current) => {
      const previous = current[selected];
      if (previous?.content === content && previous.originalContent === originalContent) {
        return current;
      }
      return {
        ...current,
        [selected]: normalizeBulkDraftState(previous, {
          name: selected,
          content,
          originalContent,
          loading: false,
          saving: false,
          error: null,
        }),
      };
    });
    setTruthContentCache((current) => current[selected] === content
      ? current
      : { ...current, [selected]: content });
  }, [bulkDrafts, editMode, editText, editorMode, fileData?.content, selected, structuredDoc]);

  const handleSelect = useCallback((name: string) => {
    setSelected(name);
    setEditMode(false);
    setEditorMode("structured");
    setEditText("");
    setStructuredDoc(null);
    setEditingError(null);
    setCollapsedSections({});
    setActiveEditorKey("doc-title");
  }, []);

  const startBookTitleRename = useCallback(() => {
    setBookTitleDraft(bookMeta?.book.title ?? "");
    setRenamingBookTitle(true);
  }, [bookMeta?.book.title]);

  const cancelBookTitleRename = useCallback(() => {
    setBookTitleDraft(bookMeta?.book.title ?? "");
    setRenamingBookTitle(false);
  }, [bookMeta?.book.title]);

  const saveBookTitle = useCallback(async () => {
    const normalizedTitle = bookTitleDraft.trim();
    if (!normalizedTitle) {
      alert(t("book.titleRequired"));
      return;
    }
    if (normalizedTitle === (bookMeta?.book.title ?? "").trim()) {
      setRenamingBookTitle(false);
      return;
    }

    setSavingBookTitle(true);
    try {
      await fetchJson(`/books/${bookId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: normalizedTitle }),
      });
      await refetchBookMeta();
      setRenamingBookTitle(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to rename book");
    } finally {
      setSavingBookTitle(false);
    }
  }, [bookId, bookMeta?.book.title, bookTitleDraft, refetchBookMeta, t]);

  const startEdit = () => {
    const content = (selected ? bulkDrafts[selected]?.content : "") ?? fileData?.content ?? "";
    setEditText(content);
    try {
      setStructuredDoc(parseTruthMarkdown(content));
      setEditorMode("structured");
      setEditingError(null);
    } catch (error) {
      setStructuredDoc(null);
      setEditorMode("markdown");
      setEditingError(error instanceof Error ? error.message : "Failed to parse markdown");
    }
    setEditMode(true);
    setCollapsedSections({});
    setActiveEditorKey("doc-title");
  };

  const registerEditorAnchor = useCallback((key: string) => (element: HTMLDivElement | null) => {
    editorAnchorsRef.current[key] = element;
  }, []);

  const scrollToEditorAnchor = useCallback((key: string) => {
    if (key.startsWith("section-")) {
      const sectionId = key.slice("section-".length);
      setCollapsedSections((current) => (current[sectionId]
        ? { ...current, [sectionId]: false }
        : current));
    }
    setActiveEditorKey(key);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        editorAnchorsRef.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);

  const loadTruthContent = useCallback(async (name: string) => {
    if (!name || loadingContentRef.current.has(name)) {
      return;
    }
    loadingContentRef.current.add(name);
    try {
      const response = await fetchJson<TruthFileDetail>(`/books/${bookId}/truth/${name}`);
      setTruthContentCache((current) => current[name] === (response.content ?? "")
        ? current
        : { ...current, [name]: response.content ?? "" });
    } catch {
      // Ignore backlink cache misses and keep the current UI responsive.
    } finally {
      loadingContentRef.current.delete(name);
    }
  }, [bookId]);

  const loadBulkDraft = async (name: string) => {
    const existing = bulkDrafts[name];
    if (existing && !existing.loading) return;

    setBulkDrafts((current) => ({
      ...current,
      [name]: normalizeBulkDraftState(current[name], {
        name,
        loading: true,
      }),
    }));

    try {
      const response = await fetchJson<TruthFileDetail>(`/books/${bookId}/truth/${name}`);
      setBulkDrafts((current) => ({
        ...current,
        [name]: current[name] && current[name]!.content !== current[name]!.originalContent
          ? normalizeBulkDraftState(current[name], {
            name,
            loading: false,
            error: null,
          })
          : normalizeBulkDraftState(current[name], {
            name,
            loading: false,
            content: response.content ?? "",
            originalContent: response.content ?? "",
            error: null,
          }),
      }));
      setTruthContentCache((current) => current[name] === (response.content ?? "")
        ? current
        : { ...current, [name]: response.content ?? "" });
    } catch (error) {
      setBulkDrafts((current) => ({
        ...current,
        [name]: normalizeBulkDraftState(current[name], {
          name,
          loading: false,
          saving: false,
          error: error instanceof Error ? error.message : "Failed to load",
        }),
      }));
    }
  };

  useEffect(() => {
    if (workspaceFiles.length === 0) return;
    for (const file of workspaceFiles) {
      if (!bulkDrafts[file.name]) {
        void loadBulkDraft(file.name);
      }
    }
  }, [bulkDrafts, workspaceFiles]);

  useEffect(() => {
    if (!selectedSummary || !data?.files?.length) {
      return;
    }
    for (const file of data.files) {
      if (file.name !== selectedSummary.name && !(file.name in canonicalTruthContents)) {
        void loadTruthContent(file.name);
      }
    }
  }, [canonicalTruthContents, data?.files, loadTruthContent, selectedSummary]);

  const updateBulkDraft = (name: string, content: string) => {
    setBulkDrafts((current) => ({
      ...current,
      [name]: normalizeBulkDraftState(current[name], {
        name,
        content,
      }),
    }));
    setTruthContentCache((current) => current[name] === content
      ? current
      : { ...current, [name]: content });
  };

  const applyAgentSuggestion = useCallback((name: string, content: string) => {
    setWorkspaceTargetFile(name);
    setBulkDrafts((current) => ({
      ...current,
      [name]: normalizeBulkDraftState(current[name], {
        name,
        content,
        error: null,
      }),
    }));
    setTruthContentCache((current) => current[name] === content
      ? current
      : { ...current, [name]: content });

    if (!workspaceFileSet.has(name)) {
      setSelected(name);
      setEditText(content);
      setEditMode(true);
      try {
        setStructuredDoc(parseTruthMarkdown(content));
        setEditorMode("structured");
        setEditingError(null);
      } catch (error) {
        setStructuredDoc(null);
        setEditorMode("markdown");
        setEditingError(error instanceof Error ? error.message : "Failed to parse markdown");
      }
      return;
    }

    if (selected !== name) {
      setActiveMode("workspace");
      return;
    }

    setEditText(content);
    setEditMode(true);
    try {
      setStructuredDoc(parseTruthMarkdown(content));
      setEditorMode("structured");
      setEditingError(null);
    } catch (error) {
      setStructuredDoc(null);
      setEditorMode("markdown");
      setEditingError(error instanceof Error ? error.message : "Failed to parse markdown");
    }
  }, [selected, workspaceFileSet]);

  const applyInterviewAnswer = useCallback((question: string, answer: string) => {
    setAlignmentDrafts((current) => ({
      ...current,
      [alignmentDraftKey]: mergeInterviewAnswerIntoAlignmentDraft(current[alignmentDraftKey] ?? seededAlignmentDraft, {
        question,
        answer,
      }),
    }));
  }, [alignmentDraftKey, seededAlignmentDraft]);

  const assistantContext = useMemo<TruthAssistantContext | null>(() => {
    if (!assistantFiles.length && !selectedSummary) {
      return null;
    }
    return {
      kind: "truth",
      bookId,
      mode: activeMode,
      detailFile: selected,
      workspaceTargetFile,
      files: assistantFiles.map((file) => ({
        name: file.name,
        label: file.label,
        exists: file.exists,
        path: file.path,
      })),
      alignment: {
        knownFacts: splitAlignmentLines(activeAlignmentDraft.knownFacts),
        unknowns: splitAlignmentLines(activeAlignmentDraft.unknowns),
        mustDecide: activeAlignmentDraft.mustDecide.trim(),
        askFirst: activeAlignmentDraft.askFirst.trim(),
      },
      currentContents: deferredAgentCurrentContents,
      applySuggestion: applyAgentSuggestion,
      applyInterviewAnswer,
      openDetail: handleSelect,
      setWorkspaceTargetFile,
    };
  }, [
    activeMode,
    activeAlignmentDraft.askFirst,
    activeAlignmentDraft.knownFacts,
    activeAlignmentDraft.mustDecide,
    activeAlignmentDraft.unknowns,
    deferredAgentCurrentContents,
    applyAgentSuggestion,
    applyInterviewAnswer,
    assistantFiles,
    bookId,
    handleSelect,
    selected,
    selectedSummary,
    workspaceTargetFile,
  ]);

  useEffect(() => {
    onAssistantContextChange?.(assistantContext);
  }, [assistantContext, onAssistantContextChange]);

  useEffect(() => {
    return () => {
      onAssistantContextChange?.(null);
    };
  }, [onAssistantContextChange]);

  const updateAlignmentDraft = useCallback((field: keyof TruthAlignmentDraft, value: string) => {
    setAlignmentDrafts((current) => ({
      ...current,
      [alignmentDraftKey]: {
        ...(current[alignmentDraftKey] ?? seededAlignmentDraft),
        [field]: value,
      },
    }));
  }, [alignmentDraftKey, seededAlignmentDraft]);

  const saveBulkDraft = async (name: string) => {
    const draft = bulkDrafts[name];
    if (!draft || draft.loading || draft.saving) return;
    setBulkDrafts((current) => ({
      ...current,
      [name]: normalizeBulkDraftState(current[name], {
        name,
        saving: true,
        error: null,
      }),
    }));
    try {
      await fetchJson(`/books/${bookId}/truth/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft.content }),
      });
      setBulkDrafts((current) => ({
        ...current,
        [name]: normalizeBulkDraftState(current[name], {
          name,
          saving: false,
          originalContent: draft.content,
          error: null,
        }),
      }));
      await Promise.all([
        refetchList(),
        ...(selected === name ? [refetchFile()] : []),
      ]);
    } catch (error) {
      setBulkDrafts((current) => ({
        ...current,
        [name]: normalizeBulkDraftState(current[name], {
          name,
          saving: false,
          error: error instanceof Error ? error.message : "Failed to save",
        }),
      }));
    }
  };

  const saveAllWorkspaceDrafts = async () => {
    for (const file of workspaceFiles) {
      if (bulkDrafts[file.name] && bulkDrafts[file.name]!.content !== bulkDrafts[file.name]!.originalContent) {
        // Sequential saves keep feedback predictable and avoid overlapping writes.
        // eslint-disable-next-line no-await-in-loop
        await saveBulkDraft(file.name);
      }
    }
  };

  const cancelEdit = () => {
    const originalContent = selected
      ? bulkDrafts[selected]?.originalContent ?? fileData?.content ?? ""
      : fileData?.content ?? "";
    if (selected) {
      setTruthContentCache((current) => current[selected] === originalContent
        ? current
        : { ...current, [selected]: originalContent });
      setBulkDrafts((current) => {
        const previous = current[selected];
        if (!previous) {
          return current;
        }
        const next = { ...current };
        if (workspaceFileSet.has(selected)) {
          next[selected] = normalizeBulkDraftState(previous, {
            name: selected,
            content: originalContent,
            originalContent,
            loading: false,
            saving: false,
            error: null,
          });
        } else {
          delete next[selected];
        }
        return next;
      });
    }
    setEditMode(false);
    setEditText(originalContent);
    setCollapsedSections({});
    setActiveEditorKey("doc-title");
    try {
      setStructuredDoc(parseTruthMarkdown(originalContent));
      setEditingError(null);
    } catch (error) {
      setStructuredDoc(null);
      setEditingError(error instanceof Error ? error.message : "Failed to parse markdown");
    }
  };

  const updateStructuredDoc = (updater: (current: StructuredTruthDocument) => StructuredTruthDocument) => {
    setStructuredDoc((current) => (current ? updater(current) : current));
  };

  const updateTitle = (title: string) => {
    updateStructuredDoc((current) => ({ ...current, title }));
  };

  const updateFrontmatter = (frontmatter: string) => {
    updateStructuredDoc((current) => ({ ...current, frontmatter }));
  };

  const updateLeadText = (leadText: string) => {
    updateStructuredDoc((current) => ({ ...current, leadText }));
  };

  const updateSection = (index: number, updater: (section: TruthDocumentSection) => TruthDocumentSection) => {
    updateStructuredDoc((current) => ({
      ...current,
      sections: reindexSections(current.sections.map((section, currentIndex) => (
        currentIndex === index ? updater(section) : section
      ))),
    }));
  };

  const addSection = () => {
    const nextIndex = structuredDoc?.sections.length ?? 0;
    updateStructuredDoc((current) => ({
      ...current,
      sections: reindexSections([
        ...current.sections,
        {
          id: `${current.sections.length}`,
          heading: "",
          headingLevel: 2,
          text: "",
          tableHeaders: [],
          tableRows: [],
        },
      ]),
    }));
    setCollapsedSections((current) => ({ ...current, [`${nextIndex}`]: false }));
    scrollToEditorAnchor(`section-${nextIndex}`);
  };

  const removeSection = (index: number) => {
    updateStructuredDoc((current) => ({
      ...current,
      sections: reindexSections(current.sections.filter((_section, currentIndex) => currentIndex !== index)),
    }));
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    if (!structuredDoc) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= structuredDoc.sections.length) return;
    updateStructuredDoc((current) => {
      const sections = [...current.sections];
      const [section] = sections.splice(index, 1);
      sections.splice(nextIndex, 0, section!);
      return {
        ...current,
        sections: reindexSections(sections),
      };
    });
    scrollToEditorAnchor(`section-${nextIndex}`);
  };

  const toggleSectionCollapsed = (sectionId: string) => {
    setCollapsedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  };

  const expandAllSections = () => {
    if (!structuredDoc) return;
    setCollapsedSections(Object.fromEntries(structuredDoc.sections.map((section) => [section.id, false])));
  };

  const collapseAllSections = () => {
    if (!structuredDoc) return;
    setCollapsedSections(Object.fromEntries(structuredDoc.sections.map((section) => [section.id, true])));
  };

  const addTableRow = (sectionIndex: number) => {
    updateSection(sectionIndex, (section) => ({
      ...section,
      tableRows: [
        ...section.tableRows,
        section.tableHeaders.map(() => ""),
      ],
    }));
  };

  const addTableColumn = (sectionIndex: number) => {
    updateSection(sectionIndex, (section) => ({
      ...section,
      tableHeaders: [...section.tableHeaders, ""],
      tableRows: section.tableRows.map((row) => [...row, ""]),
    }));
  };

  const updateTableHeader = (sectionIndex: number, columnIndex: number, value: string) => {
    updateSection(sectionIndex, (section) => ({
      ...section,
      tableHeaders: section.tableHeaders.map((header, currentColumn) => (
        currentColumn === columnIndex ? value : header
      )),
    }));
  };

  const removeTableColumn = (sectionIndex: number, columnIndex: number) => {
    updateSection(sectionIndex, (section) => ({
      ...section,
      tableHeaders: section.tableHeaders.filter((_header, currentColumn) => currentColumn !== columnIndex),
      tableRows: section.tableRows.map((row) => row.filter((_cell, currentColumn) => currentColumn !== columnIndex)),
    }));
  };

  const removeTableRow = (sectionIndex: number, rowIndex: number) => {
    updateSection(sectionIndex, (section) => ({
      ...section,
      tableRows: section.tableRows.filter((_row, currentIndex) => currentIndex !== rowIndex),
    }));
  };

  const updateTableCell = (sectionIndex: number, rowIndex: number, columnIndex: number, value: string) => {
    updateSection(sectionIndex, (section) => ({
      ...section,
      tableRows: section.tableRows.map((row, currentRow) => {
        if (currentRow !== rowIndex) return row;
        return row.map((cell, currentColumn) => (
          currentColumn === columnIndex ? value : cell
        ));
      }),
    }));
  };

  const handleSaveEdit = async () => {
    if (!selected) return;
    const content = editorMode === "structured" && structuredDoc
      ? serializeTruthMarkdown(structuredDoc)
      : editText;
    setSavingEdit(true);
    try {
      await fetchJson(`/books/${bookId}/truth/${selected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setBulkDrafts((current) => ({
        ...current,
        [selected]: normalizeBulkDraftState(current[selected], {
          name: selected,
          content,
          originalContent: content,
          saving: false,
          error: null,
        }),
      }));
      setTruthContentCache((current) => current[selected] === content
        ? current
        : { ...current, [selected]: content });
      setEditMode(false);
      await Promise.all([refetchFile(), refetchList()]);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSavingEdit(false);
    }
  };

  const structuredPreview = structuredDoc;
  const activateMode = (mode: BinderMode) => {
    setActiveMode(mode);
    setSelected(null);
    setEditMode(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span className="text-border">/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>{displayBookTitle}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">{t("truth.title")}</span>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t("truth.title")}</div>
          {renamingBookTitle ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveBookTitle();
              }}
              className="space-y-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  value={bookTitleDraft}
                  onChange={(event) => setBookTitleDraft(event.target.value)}
                  placeholder={t("create.placeholder")}
                  className={`${c.input} min-w-0 flex-1 rounded-xl px-4 py-3 text-base font-medium`}
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={savingBookTitle}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm ${c.btnPrimary} disabled:opacity-50`}
                  >
                    <Save size={14} />
                    {savingBookTitle ? t("book.saving") : t("book.save")}
                  </button>
                  <button
                    type="button"
                    onClick={cancelBookTitleRename}
                    disabled={savingBookTitle}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm ${c.btnSecondary} disabled:opacity-50`}
                  >
                    <X size={14} />
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
              <p className="max-w-3xl text-sm text-muted-foreground">{t("book.titleHint")}</p>
            </form>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-serif text-3xl">{displayBookTitle}</h1>
                <button
                  type="button"
                  onClick={startBookTitleRename}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs ${c.btnSecondary}`}
                >
                  <Pencil size={13} />
                  {t("common.edit")}
                </button>
                <span className="rounded-full border border-border/50 bg-background/70 px-2.5 py-1 text-[11px] font-mono text-muted-foreground">
                  {bookId}
                </span>
              </div>
              <p className="max-w-3xl text-sm text-muted-foreground">{t("truth.hint")}</p>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-border/50 bg-background/75 p-1">
            <button
              type="button"
              onClick={() => activateMode("overview")}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${
                activeMode === "overview" ? c.btnPrimary : c.btnSecondary
              }`}
            >
              <BookOpenText size={13} />
              {t("truth.overview")}
            </button>
            <button
              type="button"
              onClick={() => activateMode("workspace")}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${
                activeMode === "workspace" ? c.btnPrimary : c.btnSecondary
              }`}
            >
              <Files size={13} />
              {t("truth.workspaceTitle")}
            </button>
          </div>
        </div>
      </div>

      {restoredLocalDrafts && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-foreground/85">
          <div className="font-medium text-amber-800 dark:text-amber-200">{t("truth.restoredDrafts")}</div>
          <div className="mt-1 text-xs leading-6 text-muted-foreground">{t("truth.restoredDraftsHint")}</div>
        </div>
      )}

      <div
        className={showDocumentList
          ? "grid gap-6 xl:grid-cols-[17rem_minmax(0,1fr)]"
          : "w-full"}
      >
        {showDocumentList ? (
          <aside className={`rounded-2xl border ${c.cardStatic} bg-card/70 p-4`}>
            <div className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
              <BookOpenText size={16} />
              <span>{t("truth.documents")}</span>
            </div>

            {listLoading && <div className="text-sm text-muted-foreground">{t("common.loading")}</div>}
            {listError && <div className="text-sm text-destructive">{listError}</div>}
            {!listLoading && !listError && (
              <div className="space-y-4">
                {sections.map((section) => (
                  <div key={section.id} className="space-y-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{section.label}</div>
                    <div className="space-y-1.5">
                      {section.files.map((file) => (
                        <button
                          key={file.name}
                          type="button"
                          onClick={() => handleSelect(file.name)}
                          className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                            selected === file.name ? "studio-surface-active" : "studio-chip"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">{file.label}</div>
                              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{file.name}</div>
                            </div>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              file.exists ? "studio-badge-ok" : "studio-badge-soft"
                            }`}>
                              {file.exists ? t("truth.exists") : t("truth.missing")}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {(!data?.files || data.files.length === 0) && (
                  <div className="rounded-xl border border-dashed border-border/50 px-3 py-6 text-center text-sm text-muted-foreground">
                    {t("truth.empty")}
                  </div>
                )}
              </div>
            )}
          </aside>
        ) : null}

        <section className={`min-w-0 rounded-2xl border ${c.cardStatic} bg-card/70 p-5 min-h-[32rem]`}>
          {!selected && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-border/50 bg-background/70 px-4 py-4">
                <div className="text-sm font-medium text-foreground">
                  {activeMode === "overview" ? t("truth.overviewTitle") : t("truth.workspaceTitle")}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {activeMode === "overview" ? t("truth.overviewHint") : t("truth.workspaceHint")}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-border/50 bg-background/70 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("truth.totalDocs")}</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{binderStats.total}</div>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/70 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("truth.exists")}</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{binderStats.ready}</div>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/70 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("truth.missingDocs")}</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{binderStats.missing}</div>
                </div>
              </div>

              {activeMode === "overview" ? (
                <div className="space-y-4">
                  <div className="space-y-4">
                    {overviewSections.map((section) => (
                      <div key={`${section.id}-summary`} className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{section.label}</div>
                          <div className="text-xs text-muted-foreground">{section.files.length} {t("truth.documents")}</div>
                        </div>
                        <div className="grid gap-2 xl:grid-cols-2">
                          {section.files.map((file) => (
                            <div
                              key={`${section.id}-${file.name}-brief`}
                              className="rounded-xl border border-border/50 bg-background/70 px-4 py-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-foreground">{file.label}</div>
                                  <div className="text-[11px] text-muted-foreground">{file.name}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleSelect(file.name)}
                                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs ${c.btnSecondary}`}
                                >
                                  {t("truth.openDetail")}
                                </button>
                              </div>
                              <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                                {summarizePreview(file.preview) || t("truth.previewEmpty")}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {(!overviewSections.length) && (
                    <div className="rounded-xl border border-dashed border-border/50 px-3 py-6 text-center text-sm text-muted-foreground">
                      {t("truth.overviewHint")}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-muted-foreground">{t("truth.workspaceHint")}</div>
                    <button
                      type="button"
                      onClick={() => void saveAllWorkspaceDrafts()}
                      disabled={workspaceFiles.length === 0}
                      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm ${c.btnPrimary} disabled:opacity-50`}
                    >
                      <Save size={14} />
                      {t("truth.saveAll")}
                    </button>
                  </div>
                  {workspaceFiles.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border/50 px-3 py-10 text-center text-sm text-muted-foreground">
                      {t("truth.workspaceEmpty")}
                    </div>
                  )}
                  <div className="space-y-4">
                    {workspaceFiles.map((file) => {
                      const draft = bulkDrafts[file.name];
                      const draftContent = draft?.content ?? "";
                      return (
                        <div key={`${file.name}-workspace`} className="rounded-xl border border-border/50 bg-background/70 px-4 py-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-medium text-foreground">{file.label}</div>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                  file.exists ? "studio-badge-ok" : "studio-badge-soft"
                                }`}>
                                  {file.exists ? t("truth.exists") : t("truth.missing")}
                                </span>
                                {draft && draft.content !== draft.originalContent && (
                                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                                    {t("truth.unsaved")}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] font-mono text-muted-foreground">{file.path}</div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleSelect(file.name)}
                                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs ${c.btnSecondary}`}
                              >
                                {t("truth.openDetail")}
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveBulkDraft(file.name)}
                                disabled={!draft || draft.loading || draft.saving}
                                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs ${c.btnPrimary} disabled:opacity-50`}
                              >
                                <Save size={13} />
                                {draft?.saving ? t("truth.saving") : t("truth.save")}
                              </button>
                            </div>
                          </div>
                          <div className="mt-3">
                            {draft?.loading ? (
                              <div className="rounded-lg border border-border/40 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                                {t("common.loading")}
                              </div>
                            ) : (
                              <textarea
                                value={draftContent}
                                onChange={(event) => updateBulkDraft(file.name, event.target.value)}
                                className={`${c.input} min-h-[18rem] w-full rounded-xl p-4 text-sm leading-relaxed`}
                              />
                            )}
                          </div>
                          {draft?.error && (
                            <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                              {draft.error}
                            </div>
                          )}
                          <div className="mt-2 text-xs text-muted-foreground">
                            {countCharacters(draftContent)} {t("truth.chars")}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {selected && (
            <div className="flex h-full flex-col">
              <div className="mb-4 flex flex-col gap-3 border-b border-border/50 pb-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold text-foreground">{selectedSummary?.label ?? selected}</h2>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                      selectedSummary?.exists ? "studio-badge-ok" : "studio-badge-soft"
                    }`}>
                      {selectedSummary?.exists ? t("truth.exists") : t("truth.missing")}
                    </span>
                    {detailUnsaved && (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                        {t("truth.unsaved")}
                      </span>
                    )}
                    {selectedSummary?.optional && (
                      <span className="rounded-full border border-border/50 bg-background/75 px-2.5 py-0.5 text-[11px] text-muted-foreground">
                        {t("config.optional")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-mono text-muted-foreground">{selectedSummary?.path ?? `story/${selected}`}</div>
                  {!selectedSummary?.exists && (
                    <div className="rounded-xl border border-border/40 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                      {t("truth.templateHint")}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {editMode ? (
                    <>
                      <div className="inline-flex rounded-xl border border-border/50 bg-background/75 p-1">
                        <button
                          type="button"
                          onClick={() => setEditorMode("structured")}
                          className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs ${
                            editorMode === "structured" ? c.btnPrimary : c.btnSecondary
                          }`}
                        >
                          <Rows3 size={12} />
                          {t("truth.structured")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditorMode("markdown")}
                          className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs ${
                            editorMode === "markdown" ? c.btnPrimary : c.btnSecondary
                          }`}
                        >
                          <TableProperties size={12} />
                          {t("truth.markdown")}
                        </button>
                      </div>
                      <button
                        onClick={cancelEdit}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md ${c.btnSecondary}`}
                      >
                        <X size={14} />
                        {t("truth.cancel")}
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        disabled={savingEdit}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md ${c.btnPrimary} disabled:opacity-50`}
                      >
                        <Save size={14} />
                        {savingEdit ? t("truth.saving") : t("truth.save")}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={startEdit}
                      disabled={fileLoading || Boolean(fileError)}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md ${c.btnSecondary} disabled:opacity-50`}
                    >
                      {!selectedSummary?.exists ? <Sparkles size={14} /> : <Pencil size={14} />}
                      {t("truth.structured")}
                    </button>
                  )}
                </div>
              </div>

              {fileLoading && <div className="text-sm text-muted-foreground">{t("common.loading")}</div>}
              {!fileLoading && fileError && <div className="text-sm text-destructive">{fileError}</div>}
              {!fileLoading && !fileError && editingError && (
                <div className="mb-3 rounded-xl border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {editingError}
                </div>
              )}

              {!fileLoading && !fileError && editMode && editorMode === "structured" && structuredDoc && (
                <div className="min-h-[32rem] space-y-4">
                  <div className="rounded-2xl border border-border/50 bg-background/70 px-4 py-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-foreground">{t("truth.structured")}</div>
                        <p className="text-xs leading-6 text-muted-foreground">{t("truth.structuredHint")}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={expandAllSections}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs ${c.btnSecondary}`}
                        >
                          <ChevronDown size={12} />
                          {t("truth.expandAll")}
                        </button>
                        <button
                          type="button"
                          onClick={collapseAllSections}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs ${c.btnSecondary}`}
                        >
                          <ChevronRight size={12} />
                          {t("truth.collapseAll")}
                        </button>
                        <button
                          type="button"
                          onClick={addSection}
                          className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs ${c.btnPrimary}`}
                        >
                          <Plus size={12} />
                          {t("truth.addSection")}
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-border/40 bg-card/60 px-3 py-3">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("truth.sectionCount")}</div>
                        <div className="mt-2 text-xl font-semibold text-foreground">{structuredDoc.sections.length}</div>
                      </div>
                      <div className="rounded-xl border border-border/40 bg-card/60 px-3 py-3">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("truth.knownFacts")}</div>
                        <div className="mt-2 text-xl font-semibold text-foreground">{structuredInsights?.knownItems.length ?? 0}</div>
                      </div>
                      <div className="rounded-xl border border-border/40 bg-card/60 px-3 py-3">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("truth.unknowns")}</div>
                        <div className="mt-2 text-xl font-semibold text-foreground">{structuredInsights?.emptyBlocks.length ?? 0}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-5 xl:grid-cols-[14rem_minmax(0,1fr)] 2xl:grid-cols-[14rem_minmax(0,1fr)_18rem]">
                    <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
                      <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <ListTree size={15} />
                          {t("truth.structureMap")}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {t("truth.structureMapHint")}
                        </div>
                        <div className="mt-4 space-y-1.5">
                          {outlineItems.map((item) => (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => scrollToEditorAnchor(item.key)}
                              className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                                activeEditorKey === item.key ? "studio-surface-active" : "studio-chip"
                              }`}
                            >
                              <div className="text-sm font-medium text-foreground">{item.label}</div>
                              <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                                {item.hint}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </aside>

                    <div className="min-w-0 space-y-4">
                      <div className="grid gap-4">
                        <div
                          ref={registerEditorAnchor("doc-title")}
                          className={`rounded-2xl border p-4 ${activeEditorKey === "doc-title" ? "studio-surface-active" : "border-border/50 bg-background/70"}`}
                        >
                          <label className="block space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">{t("truth.docTitle")}</span>
                            <input
                              type="text"
                              value={structuredDoc.title}
                              onChange={(event) => updateTitle(event.target.value)}
                              onFocus={() => setActiveEditorKey("doc-title")}
                              className={`${c.input} w-full rounded-xl px-3 py-3 text-sm`}
                            />
                          </label>
                        </div>

                        {structuredDoc.frontmatter.trim() && (
                          <div
                            ref={registerEditorAnchor("frontmatter")}
                            className={`rounded-2xl border p-4 ${activeEditorKey === "frontmatter" ? "studio-surface-active" : "border-border/50 bg-background/70"}`}
                          >
                            <label className="block space-y-1.5">
                              <span className="text-xs font-medium text-muted-foreground">{t("truth.frontmatter")}</span>
                              <AutoResizeTextarea
                                value={structuredDoc.frontmatter}
                                onChange={(event) => updateFrontmatter(event.target.value)}
                                onFocus={() => setActiveEditorKey("frontmatter")}
                                minHeight={240}
                                className={`${c.input} w-full rounded-xl p-3 text-sm font-mono leading-relaxed resize-none`}
                              />
                            </label>
                          </div>
                        )}

                        <div
                          ref={registerEditorAnchor("lead-text")}
                          className={`rounded-2xl border p-4 ${activeEditorKey === "lead-text" ? "studio-surface-active" : "border-border/50 bg-background/70"}`}
                        >
                          <label className="block space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">{t("truth.leadText")}</span>
                            <AutoResizeTextarea
                              value={structuredDoc.leadText}
                              onChange={(event) => updateLeadText(event.target.value)}
                              onFocus={() => setActiveEditorKey("lead-text")}
                              minHeight={180}
                              className={`${c.input} w-full rounded-xl p-3 text-sm leading-relaxed resize-none`}
                            />
                          </label>
                        </div>
                      </div>

                      {structuredDoc.sections.length === 0 && (
                        <div className="rounded-xl border border-border/50 bg-background/70 px-3 py-3 text-sm text-muted-foreground">
                          {t("truth.noSections")}
                        </div>
                      )}

                      {structuredDoc.sections.map((section, index) => {
                        const sectionKey = `section-${section.id}`;
                        const collapsed = collapsedSections[section.id] ?? false;
                        const hasBody = hasSectionBody(section);
                        return (
                          <div
                            key={`${selected}-section-${section.id}`}
                            ref={registerEditorAnchor(sectionKey)}
                            className={`rounded-2xl border p-4 ${activeEditorKey === sectionKey ? "studio-surface-active" : "border-border/50 bg-background/70"}`}
                          >
                            <div className="flex flex-col gap-3 border-b border-border/40 pb-4 lg:flex-row lg:items-start lg:justify-between">
                              <div className="flex min-w-0 items-start gap-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveEditorKey(sectionKey);
                                    toggleSectionCollapsed(section.id);
                                  }}
                                  className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md ${c.btnSecondary}`}
                                  aria-label={collapsed ? t("truth.expandAll") : t("truth.collapseAll")}
                                >
                                  {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                </button>
                                <div className="min-w-0">
                                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                                    {t("truth.sectionLabel")} {index + 1}
                                  </div>
                                  <div className="mt-1 text-base font-semibold text-foreground">
                                    {sectionLabel(section, index)}
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                    <span className="rounded-full border border-border/40 bg-card/70 px-2 py-0.5">
                                      {countCharacters(section.text)} {t("truth.chars")}
                                    </span>
                                    {section.tableHeaders.length > 0 && (
                                      <span className="rounded-full border border-border/40 bg-card/70 px-2 py-0.5">
                                        {section.tableHeaders.length} {t("truth.addColumn")} · {section.tableRows.length} {t("truth.addRow")}
                                      </span>
                                    )}
                                    {!hasBody && (
                                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
                                        {t("truth.missing")}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => moveSection(index, -1)}
                                  disabled={index === 0}
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${c.btnSecondary} disabled:opacity-40`}
                                >
                                  <ArrowUp size={12} />
                                  {t("truth.moveUp")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveSection(index, 1)}
                                  disabled={index === structuredDoc.sections.length - 1}
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${c.btnSecondary} disabled:opacity-40`}
                                >
                                  <ArrowDown size={12} />
                                  {t("truth.moveDown")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeSection(index)}
                                  disabled={structuredDoc.sections.length === 0}
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${c.btnSecondary} disabled:opacity-40`}
                                >
                                  <Trash2 size={12} />
                                  {t("truth.removeSection")}
                                </button>
                              </div>
                            </div>

                            {collapsed ? (
                              <div className="mt-4 space-y-2">
                                <div className="text-sm leading-6 text-muted-foreground">
                                  {compactPreview(section.text, 180) || t("truth.sectionEmptyState")}
                                </div>
                              </div>
                            ) : (
                              <div className="mt-4 space-y-4">
                                <label className="block space-y-1.5">
                                  <span className="text-xs font-medium text-muted-foreground">{t("truth.sectionLabel")}</span>
                                  <input
                                    type="text"
                                    value={section.heading}
                                    onChange={(event) => updateSection(index, (current) => ({ ...current, heading: event.target.value }))}
                                    onFocus={() => setActiveEditorKey(sectionKey)}
                                    placeholder={`${t("truth.sectionPlaceholder")} ${index + 1}`}
                                    className={`${c.input} w-full rounded-xl px-3 py-2 text-sm`}
                                  />
                                </label>

                                <AutoResizeTextarea
                                  value={section.text}
                                  onChange={(event) => updateSection(index, (current) => ({ ...current, text: event.target.value }))}
                                  onFocus={() => setActiveEditorKey(sectionKey)}
                                  minHeight={220}
                                  className={`${c.input} w-full rounded-xl p-3 text-sm leading-relaxed resize-none`}
                                />

                                {section.tableHeaders.length > 0 && (
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="text-xs font-medium text-muted-foreground">{t("truth.tableEditor")}</div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => addTableColumn(index)}
                                          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${c.btnSecondary}`}
                                        >
                                          <Plus size={12} />
                                          {t("truth.addColumn")}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => addTableRow(index)}
                                          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${c.btnSecondary}`}
                                        >
                                          <Plus size={12} />
                                          {t("truth.addRow")}
                                        </button>
                                      </div>
                                    </div>

                                    <div className="overflow-x-auto rounded-xl border border-border/40">
                                      <table className="min-w-full text-sm">
                                        <thead className="bg-background/80">
                                          <tr>
                                            {section.tableHeaders.map((header, headerIndex) => (
                                              <th key={`${section.id}-header-${headerIndex}`} className="border-b border-border/40 px-2 py-2 text-left">
                                                <div className="flex items-center gap-2">
                                                  <input
                                                    type="text"
                                                    value={header}
                                                    onChange={(event) => updateTableHeader(index, headerIndex, event.target.value)}
                                                    onFocus={() => setActiveEditorKey(sectionKey)}
                                                    className={`${c.input} w-full rounded-lg px-2 py-1.5 text-xs font-medium`}
                                                  />
                                                  <button
                                                    type="button"
                                                    onClick={() => removeTableColumn(index, headerIndex)}
                                                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ${c.btnSecondary}`}
                                                  >
                                                    <Trash2 size={11} />
                                                    {t("truth.removeColumn")}
                                                  </button>
                                                </div>
                                              </th>
                                            ))}
                                            <th className="border-b border-border/40 px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                                              {t("book.curate")}
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {section.tableRows.map((row, rowIndex) => (
                                            <tr key={`${section.id}-row-${rowIndex}`}>
                                              {section.tableHeaders.map((header, columnIndex) => (
                                                <td key={`${section.id}-${rowIndex}-${header}`} className="border-b border-border/30 px-2 py-2">
                                                  <input
                                                    type="text"
                                                    value={row[columnIndex] ?? ""}
                                                    onChange={(event) => updateTableCell(index, rowIndex, columnIndex, event.target.value)}
                                                    onFocus={() => setActiveEditorKey(sectionKey)}
                                                    className={`${c.input} w-full rounded-lg px-2 py-1.5 text-xs`}
                                                  />
                                                </td>
                                              ))}
                                              <td className="border-b border-border/30 px-2 py-2">
                                                <button
                                                  type="button"
                                                  onClick={() => removeTableRow(index, rowIndex)}
                                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${c.btnSecondary}`}
                                                >
                                                  <Trash2 size={12} />
                                                  {t("truth.removeRow")}
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <div className="flex flex-wrap items-center gap-3">
                        <div className="text-xs text-muted-foreground">
                          {countCharacters(serializeTruthMarkdown(structuredDoc))} {t("truth.chars")}
                        </div>
                      </div>
                    </div>

                    <aside className="space-y-4 xl:col-span-2 2xl:col-span-1 2xl:sticky 2xl:top-6 2xl:self-start">
                      <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <CircleHelp size={15} />
                          {t("truth.alignmentTitle")}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {t("truth.alignmentHint")}
                        </div>

                        <div className="mt-4 space-y-4">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("truth.knownFacts")}</div>
                            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{t("truth.alignPromptKnown")}</div>
                            <AutoResizeTextarea
                              value={activeAlignmentDraft.knownFacts}
                              onChange={(event) => updateAlignmentDraft("knownFacts", event.target.value)}
                              minHeight={112}
                              placeholder={t("truth.alignmentKnownPlaceholder")}
                              className={`${c.input} mt-2 w-full rounded-xl px-3 py-3 text-sm leading-6`}
                            />
                          </div>

                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("truth.unknowns")}</div>
                            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{t("truth.alignPromptUnknown")}</div>
                            <AutoResizeTextarea
                              value={activeAlignmentDraft.unknowns}
                              onChange={(event) => updateAlignmentDraft("unknowns", event.target.value)}
                              minHeight={112}
                              placeholder={t("truth.alignmentUnknownPlaceholder")}
                              className={`${c.input} mt-2 w-full rounded-xl border-amber-500/20 bg-amber-500/5 px-3 py-3 text-sm leading-6`}
                            />
                          </div>

                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("truth.mustDecide")}</div>
                            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{t("truth.alignPromptDecision")}</div>
                            <AutoResizeTextarea
                              value={activeAlignmentDraft.mustDecide}
                              onChange={(event) => updateAlignmentDraft("mustDecide", event.target.value)}
                              minHeight={96}
                              placeholder={t("truth.alignmentDecisionPlaceholder")}
                              className={`${c.input} mt-2 w-full rounded-xl px-3 py-3 text-sm leading-6`}
                            />
                          </div>

                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("truth.questionQueue")}</div>
                            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{t("truth.alignPromptAsk")}</div>
                            <AutoResizeTextarea
                              value={activeAlignmentDraft.askFirst}
                              onChange={(event) => updateAlignmentDraft("askFirst", event.target.value)}
                              minHeight={96}
                              placeholder={t("truth.alignmentAskPlaceholder")}
                              className={`${c.input} mt-2 w-full rounded-xl px-3 py-3 text-sm leading-6`}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                        <div className="text-sm font-medium text-foreground">{t("truth.liveCanvas")}</div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">{t("truth.liveCanvasHint")}</div>
                        <div className="mt-4 rounded-xl border border-border/40 bg-card/60 px-3 py-3">
                          <div className="text-sm font-semibold text-foreground">
                            {structuredDoc.title.trim() || (selectedSummary?.label ?? selected)}
                          </div>
                          <div className="mt-2 text-sm leading-6 text-muted-foreground">
                            {compactPreview(structuredDoc.leadText, 120) || t("truth.sectionEmptyState")}
                          </div>
                          {activeAlignmentDraft.mustDecide.trim() && (
                            <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-3 py-3">
                              <div className="text-[11px] uppercase tracking-[0.14em] text-primary">{t("truth.mustDecide")}</div>
                              <div className="mt-1 text-sm leading-6 text-foreground/85">{activeAlignmentDraft.mustDecide.trim()}</div>
                            </div>
                          )}
                          <div className="mt-4 space-y-2">
                            {structuredDoc.sections.map((section, index) => (
                              <button
                                key={`canvas-${section.id}`}
                                type="button"
                                onClick={() => scrollToEditorAnchor(`section-${section.id}`)}
                                className="w-full rounded-xl border border-border/40 bg-background/70 px-3 py-2 text-left transition-colors hover:border-border/70"
                              >
                                <div className="text-sm font-medium text-foreground">{sectionLabel(section, index)}</div>
                                <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                                  {compactPreview(section.text, 80) || t("truth.sectionEmptyState")}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                        <div className="text-sm font-medium text-foreground">{t("truth.relatedDocs")}</div>
                        <div className="mt-4 space-y-4">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("truth.mentions")}</div>
                            <div className="mt-2 space-y-2">
                              {truthMentions.outgoing.length > 0 ? truthMentions.outgoing.map((file) => (
                                <button
                                  key={`mention-${file.fileName}`}
                                  type="button"
                                  onClick={() => handleSelect(file.fileName)}
                                  className="w-full rounded-xl border border-border/40 bg-card/60 px-3 py-2 text-left transition-colors hover:border-border/70"
                                >
                                  <div className="text-sm font-medium text-foreground">{file.label}</div>
                                  <div className="mt-1 text-[11px] text-muted-foreground">{file.matches.join(", ")}</div>
                                  <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{file.excerpt}</div>
                                </button>
                              )) : (
                                <div className="rounded-xl border border-dashed border-border/40 px-3 py-3 text-sm text-muted-foreground">
                                  {t("truth.noMentions")}
                                </div>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("truth.backlinks")}</div>
                            <div className="mt-2 space-y-2">
                              {truthMentions.backlinks.length > 0 ? truthMentions.backlinks.map((file) => (
                                <button
                                  key={`backlink-${file.fileName}`}
                                  type="button"
                                  onClick={() => handleSelect(file.fileName)}
                                  className="w-full rounded-xl border border-border/40 bg-card/60 px-3 py-2 text-left transition-colors hover:border-border/70"
                                >
                                  <div className="text-sm font-medium text-foreground">{file.label}</div>
                                  <div className="mt-1 text-[11px] text-muted-foreground">{file.matches.join(", ")}</div>
                                  <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{file.excerpt}</div>
                                </button>
                              )) : (
                                <div className="rounded-xl border border-dashed border-border/40 px-3 py-3 text-sm text-muted-foreground">
                                  {t("truth.noBacklinks")}
                                </div>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("truth.sameSectionDocs")}</div>
                            <div className="mt-2 space-y-2">
                              {relatedFiles.length > 0 ? relatedFiles.map((file) => (
                                <button
                                  key={`related-${file.name}`}
                                  type="button"
                                  onClick={() => handleSelect(file.name)}
                                  className="w-full rounded-xl border border-border/40 bg-card/60 px-3 py-2 text-left transition-colors hover:border-border/70"
                                >
                                  <div className="text-sm font-medium text-foreground">{file.label}</div>
                                  <div className="mt-1 text-[11px] text-muted-foreground">{file.name}</div>
                                </button>
                              )) : (
                                <div className="rounded-xl border border-dashed border-border/40 px-3 py-3 text-sm text-muted-foreground">
                                  {t("truth.noRelatedDocs")}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </aside>
                  </div>
                </div>
              )}

              {!fileLoading && !fileError && editMode && (editorMode === "markdown" || !structuredDoc) && (
                <textarea
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                  className={`${c.input} min-h-[28rem] flex-1 rounded-xl p-4 text-sm font-mono leading-relaxed resize-none`}
                />
              )}

              {!fileLoading && !fileError && !editMode && structuredPreview && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border/40 bg-background/70 px-4 py-4">
                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("truth.docTitle")}</div>
                    <div className="mt-2 text-lg font-semibold text-foreground">{structuredPreview.title || (selectedSummary?.label ?? selected)}</div>
                  </div>

                  {structuredPreview.frontmatter.trim() && (
                    <div className="rounded-2xl border border-border/40 bg-background/70 px-4 py-4">
                      <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("truth.frontmatter")}</div>
                      <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-card/70 p-3 text-xs font-mono text-foreground/80">
                        {structuredPreview.frontmatter}
                      </pre>
                    </div>
                  )}

                  {structuredPreview.leadText.trim() && (
                    <div className="rounded-2xl border border-border/40 bg-background/70 px-4 py-4">
                      <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("truth.leadText")}</div>
                      <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
                        {structuredPreview.leadText}
                      </div>
                    </div>
                  )}

                  {structuredPreview.sections.length === 0 && (
                    <div className="rounded-2xl border border-border/40 bg-background/70 px-4 py-6 text-sm text-muted-foreground">
                      {t("truth.noSections")}
                    </div>
                  )}

                  {structuredPreview.sections.map((section) => (
                    <div key={`${selected}-preview-${section.id}`} className="rounded-2xl border border-border/40 bg-background/70 px-4 py-4">
                      {section.heading && (
                        <div className="text-base font-semibold text-foreground">{section.heading}</div>
                      )}
                      {section.text.trim() && (
                        <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
                          {section.text}
                        </div>
                      )}
                      {section.tableHeaders.length > 0 && (
                        <div className="mt-3 overflow-x-auto rounded-xl border border-border/40">
                          <table className="min-w-full text-sm">
                            <thead className="bg-background/80">
                              <tr>
                                {section.tableHeaders.map((header, index) => (
                                  <th key={`${section.id}-preview-header-${index}`} className="border-b border-border/40 px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                                    {header}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {section.tableRows.map((row, rowIndex) => (
                                <tr key={`${section.id}-preview-row-${rowIndex}`}>
                                  {section.tableHeaders.map((header, columnIndex) => (
                                    <td key={`${section.id}-preview-cell-${rowIndex}-${header}`} className="border-b border-border/30 px-3 py-2 text-foreground/85">
                                      {row[columnIndex] ?? ""}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
