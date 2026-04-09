import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  BookOpenText,
  Files,
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
import { countCharacters, parseTruthMarkdown, serializeTruthMarkdown } from "../shared/truth-editor";

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

interface BinderStats {
  readonly total: number;
  readonly ready: number;
  readonly missing: number;
}

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

export function TruthFiles({
  bookId,
  nav,
  theme,
  t,
  onAssistantContextChange,
  onOpenAssistant,
}: {
  bookId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
  onAssistantContextChange?: (context: TruthAssistantContext | null) => void;
  onOpenAssistant?: () => void;
}) {
  const c = useColors(theme);
  const {
    data,
    loading: listLoading,
    error: listError,
    refetch: refetchList,
  } = useApi<{ files: ReadonlyArray<TruthFileSummary> }>(`/books/${bookId}/truth`);
  const [selected, setSelected] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("structured");
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [structuredDoc, setStructuredDoc] = useState<StructuredTruthDocument | null>(null);
  const [editingError, setEditingError] = useState<string | null>(null);
  const [bulkDrafts, setBulkDrafts] = useState<Record<string, TruthBulkDraft>>({});
  const [activeMode, setActiveMode] = useState<BinderMode>("overview");
  const [workspaceTargetFile, setWorkspaceTargetFile] = useState<string>("");
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
  const showDocumentList = activeMode === "overview";
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
  const deferredAgentCurrentContents = useDeferredValue(agentCurrentContents);
  const workspaceFileSet = useMemo(() => new Set(workspaceFiles.map((file) => file.name)), [workspaceFiles]);

  useEffect(() => {
    if (!selected) {
      setEditMode(false);
      setEditorMode("structured");
      setEditText("");
      setStructuredDoc(null);
      setEditingError(null);
      return;
    }
    if (!data?.files.some((entry) => entry.name === selected)) {
      setSelected(null);
      setEditMode(false);
      setEditorMode("structured");
      setEditText("");
      setStructuredDoc(null);
      setEditingError(null);
    }
  }, [data?.files, selected]);

  const syncBulkStateFromFileList = () => {
    if (!data?.files.length) {
      setBulkDrafts({});
      return;
    }
    const available = new Set(data.files.map((file) => file.name));
    setBulkDrafts((current) => Object.fromEntries(
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
    const content = fileData?.content ?? "";
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

  const handleSelect = useCallback((name: string) => {
    setSelected(name);
    setEditMode(false);
    setEditorMode("structured");
    setEditText("");
    setStructuredDoc(null);
    setEditingError(null);
  }, []);

  const startEdit = () => {
    const content = fileData?.content ?? "";
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
  };

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
        [name]: normalizeBulkDraftState(current[name], {
          name,
          loading: false,
          content: response.content ?? "",
          originalContent: response.content ?? "",
          error: null,
        }),
      }));
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

  const updateBulkDraft = (name: string, content: string) => {
    setBulkDrafts((current) => ({
      ...current,
      [name]: normalizeBulkDraftState(current[name], {
        name,
        content,
      }),
    }));
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
      currentContents: deferredAgentCurrentContents,
      applySuggestion: applyAgentSuggestion,
      openDetail: handleSelect,
      setWorkspaceTargetFile,
    };
  }, [
    activeMode,
    deferredAgentCurrentContents,
    applyAgentSuggestion,
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
    const content = fileData?.content ?? "";
    setEditMode(false);
    setEditText(content);
    try {
      setStructuredDoc(parseTruthMarkdown(content));
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
  };

  const removeSection = (index: number) => {
    updateStructuredDoc((current) => ({
      ...current,
      sections: reindexSections(current.sections.filter((_section, currentIndex) => currentIndex !== index)),
    }));
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
      setEditMode(false);
      await Promise.all([refetchFile(), refetchList()]);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSavingEdit(false);
    }
  };

  const structuredPreview = structuredDoc;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span className="text-border">/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>{bookId}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">{t("truth.title")}</span>
      </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <h1 className="font-serif text-3xl">{t("truth.title")}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{t("truth.hint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-border/50 bg-background/75 p-1">
            <button
              type="button"
              onClick={() => setActiveMode("overview")}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${
                activeMode === "overview" ? c.btnPrimary : c.btnSecondary
              }`}
            >
              <BookOpenText size={13} />
              {t("truth.overview")}
            </button>
            <button
              type="button"
              onClick={() => setActiveMode("workspace")}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${
                activeMode === "workspace" ? c.btnPrimary : c.btnSecondary
              }`}
            >
              <Files size={13} />
              {t("truth.workspaceTitle")}
            </button>
          </div>
          {onOpenAssistant ? (
            <button
              type="button"
              onClick={onOpenAssistant}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm ${c.btnSecondary}`}
            >
              <Sparkles size={15} />
              {t("truth.openAssistant")}
            </button>
          ) : null}
          {selected ? (
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setEditMode(false);
              }}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm ${c.btnSecondary}`}
            >
              <Files size={15} />
              {activeMode === "overview" ? t("truth.overview") : t("truth.workspace")}
            </button>
          ) : null}
        </div>
      </div>

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
                <div className="min-h-[28rem] space-y-4">
                  <p className="text-xs text-muted-foreground">{t("truth.structuredHint")}</p>

                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">{t("truth.docTitle")}</span>
                    <input
                      type="text"
                      value={structuredDoc.title}
                      onChange={(event) => updateTitle(event.target.value)}
                      className={`${c.input} w-full rounded-xl px-3 py-2 text-sm`}
                    />
                  </label>

                  {structuredDoc.frontmatter.trim() && (
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">{t("truth.frontmatter")}</span>
                      <textarea
                        value={structuredDoc.frontmatter}
                        onChange={(event) => updateFrontmatter(event.target.value)}
                        className={`${c.input} min-h-[10rem] w-full rounded-xl p-3 text-sm font-mono leading-relaxed resize-none`}
                      />
                    </label>
                  )}

                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">{t("truth.leadText")}</span>
                    <textarea
                      value={structuredDoc.leadText}
                      onChange={(event) => updateLeadText(event.target.value)}
                      className={`${c.input} min-h-[7rem] w-full rounded-xl p-3 text-sm leading-relaxed resize-none`}
                    />
                  </label>

                  {structuredDoc.sections.length === 0 && (
                    <div className="rounded-xl border border-border/50 bg-background/70 px-3 py-3 text-sm text-muted-foreground">
                      {t("truth.noSections")}
                    </div>
                  )}

                  {structuredDoc.sections.map((section, index) => (
                    <div key={`${selected}-section-${section.id}`} className="space-y-3 rounded-xl border border-border/50 bg-background/70 p-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={section.heading}
                          onChange={(event) => updateSection(index, (current) => ({ ...current, heading: event.target.value }))}
                          placeholder={`${t("truth.sectionPlaceholder")} ${index + 1}`}
                          className={`${c.input} flex-1 rounded-xl px-3 py-2 text-sm`}
                        />
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

                      <textarea
                        value={section.text}
                        onChange={(event) => updateSection(index, (current) => ({ ...current, text: event.target.value }))}
                        className={`${c.input} min-h-[7rem] w-full rounded-xl p-3 text-sm leading-relaxed resize-none`}
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
                  ))}

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={addSection}
                      className={`inline-flex items-center gap-1 rounded-md ${c.btnSecondary} px-3 py-2 text-sm`}
                    >
                      <Plus size={14} />
                      {t("truth.addSection")}
                    </button>
                    <div className="text-xs text-muted-foreground">
                      {countCharacters(serializeTruthMarkdown(structuredDoc))} {t("truth.chars")}
                    </div>
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
