import { useState } from "react";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { defaultLocalizedChapterTitle, localizeChapterTitle } from "../shared/chapter-title";
import type { ReaderSettings } from "../shared/contracts";
import {
  buildReaderSettingsDiff,
  normalizeReaderSettings,
  resolveReaderBodyStyle,
  type ReaderDeviceScope,
  type ReaderSettingField,
  type ReaderSettingsDiffItem,
} from "../shared/reader-settings";
import {
  CheckCircle2,
  Clock,
  Eye,
  Hash,
  List,
  Monitor,
  Pencil,
  RotateCcw,
  Save,
  Settings2,
  Smartphone,
  Type,
  XCircle,
} from "lucide-react";

interface ChapterReaderData {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
  readonly language?: "ko" | "zh" | "en";
  readonly readerSettings?: ReaderSettings;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

interface ChapterReaderText {
  readonly title: string;
  readonly body: string;
  readonly paragraphs: ReadonlyArray<string>;
}

const READER_FONT_PRESETS = ["myeongjo", "serif", "sans"] as const;
const MIN_READER_FONT_SIZE = 12;
const MAX_READER_FONT_SIZE = 28;
const MIN_READER_LINE_HEIGHT = 1.3;
const MAX_READER_LINE_HEIGHT = 2.2;

function buildChapterReaderText(data: Pick<ChapterReaderData, "chapterNumber" | "content" | "language">): ChapterReaderText {
  const lines = data.content.split("\n");
  const titleLine = lines.find((line) => line.startsWith("# "));
  const title = titleLine
    ? localizeChapterTitle(titleLine, data.chapterNumber, data.language)
    : defaultLocalizedChapterTitle(data.chapterNumber, data.language);
  const body = lines
    .filter((line) => line !== titleLine)
    .join("\n")
    .trim();

  return {
    title,
    body,
    paragraphs: body.split(/\n\n+/).map((paragraph) => paragraph.trim()).filter(Boolean),
  };
}

function readerDeviceLabel(device: ReaderDeviceScope, t: TFunction): string {
  return device === "mobile" ? t("reader.mobile") : t("reader.desktop");
}

function readerFieldLabel(field: ReaderSettingField, t: TFunction): string {
  if (field === "fontPreset") return t("reader.font");
  if (field === "fontSize") return t("reader.fontSize");
  return t("reader.lineHeight");
}

function formatReaderSettingValue(
  field: ReaderSettingField,
  value: ReaderSettingsDiffItem["savedValue"],
  t: TFunction,
): string {
  if (field === "fontPreset") {
    if (value === "sans") return t("reader.fontPresetSans");
    if (value === "serif") return t("reader.fontPresetSerif");
    return t("reader.fontPresetMyeongjo");
  }
  if (field === "lineHeight" && typeof value === "number") {
    return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }
  return String(value);
}

function updateReaderDeviceSettings(
  settings: ReaderSettings,
  device: ReaderDeviceScope,
  patch: Partial<ReaderSettings[ReaderDeviceScope]>,
): ReaderSettings {
  return {
    ...settings,
    [device]: {
      ...settings[device],
      ...patch,
    },
  };
}

function clampReaderFontSize(value: number): number {
  return Math.min(MAX_READER_FONT_SIZE, Math.max(MIN_READER_FONT_SIZE, Math.round(value)));
}

function clampReaderLineHeight(value: number): number {
  return Number(Math.min(MAX_READER_LINE_HEIGHT, Math.max(MIN_READER_LINE_HEIGHT, value)).toFixed(2));
}

export function ReaderSettingsDiffSummary({
  savedSettings,
  draftSettings,
  t,
}: {
  savedSettings: unknown;
  draftSettings: unknown;
  t: TFunction;
}) {
  const diffItems = buildReaderSettingsDiff(savedSettings, draftSettings);

  if (!diffItems.length) {
    return null;
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-secondary/35 p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{t("reader.readerChanges")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("reader.savedValue")} / {t("reader.draftValue")}</p>
      </div>
      <ul className="space-y-2.5">
        {diffItems.map((item) => (
          <li key={`${item.device}-${item.field}`} className="rounded-xl border border-border/50 bg-background/70 p-3">
            <p className="text-sm font-medium text-foreground">
              {readerDeviceLabel(item.device, t)} / {readerFieldLabel(item.field, t)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("reader.savedValue")}: {formatReaderSettingValue(item.field, item.savedValue, t)}
            </p>
            <p className="text-xs text-[color:var(--studio-state-text)]">
              {t("reader.draftValue")}: {formatReaderSettingValue(item.field, item.draftValue, t)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ChapterReaderPreviewFrame({
  chapter,
  viewMode,
  showReaderSettings,
  draftReaderSettings,
  t,
}: {
  chapter: Pick<ChapterReaderData, "chapterNumber" | "content" | "language" | "readerSettings">;
  viewMode: ReaderDeviceScope;
  showReaderSettings: boolean;
  draftReaderSettings?: ReaderSettings | null;
  t: TFunction;
}) {
  const activeReaderSettings = showReaderSettings
    ? normalizeReaderSettings(draftReaderSettings ?? chapter.readerSettings)
    : normalizeReaderSettings(chapter.readerSettings);
  const readerStyle = resolveReaderBodyStyle(viewMode, activeReaderSettings);
  const { title, body, paragraphs } = buildChapterReaderText(chapter);
  const frameWidthClassName = viewMode === "mobile" ? "max-w-[28rem]" : "max-w-4xl";
  const framePaddingClassName = viewMode === "mobile" ? "p-6 sm:p-8" : "p-8 md:p-16 lg:p-24";

  return (
    <div
      data-reader-view={viewMode}
      className={`paper-sheet relative mx-auto w-full rounded-2xl shadow-2xl shadow-primary/5 overflow-hidden ${frameWidthClassName} ${framePaddingClassName}`}
    >
      <div className="pointer-events-none absolute inset-y-0 left-6 hidden w-px bg-primary/5 md:block" />
      <div className="pointer-events-none absolute inset-y-0 right-6 hidden w-px bg-primary/5 md:block" />

      <header className={viewMode === "mobile" ? "mb-10 text-center" : "mb-16 text-center"}>
        <div className="mb-6 flex items-center justify-center gap-2 text-muted-foreground/30 select-none">
          <div className="h-px w-10 bg-border/40" />
          <Eye size={18} />
          <div className="h-px w-10 bg-border/40" />
        </div>
        <h1 className={viewMode === "mobile"
          ? "text-3xl font-medium text-foreground tracking-tight leading-tight"
          : "text-4xl md:text-5xl font-medium text-foreground tracking-tight leading-tight"}
        >
          {title}
        </h1>
        <div className="mt-6 flex items-center justify-center gap-4 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
          <span>{viewMode === "mobile" ? t("reader.mobileView") : t("reader.desktopView")}</span>
          <span className="text-border">·</span>
          <span>{chapter.chapterNumber.toString().padStart(2, "0")}</span>
        </div>
      </header>

      <article
        className="space-y-6 text-foreground/90"
        style={{
          fontFamily: readerStyle.fontFamily,
          fontSize: `${readerStyle.fontSize}px`,
          lineHeight: readerStyle.lineHeight,
        }}
      >
        {paragraphs.map((paragraph, index) => (
          <p key={`${chapter.chapterNumber}-${index}`} className="text-foreground/90">
            {paragraph}
          </p>
        ))}
      </article>

      <footer className="mt-16 border-t border-border/20 pt-8 text-center">
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs font-medium text-muted-foreground">
          <div className="flex items-center gap-1.5 rounded-full bg-secondary/50 px-3 py-1.5">
            <Type size={14} className="studio-state-soft-text" />
            <span>{body.length.toLocaleString()} {t("reader.characters")}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-secondary/50 px-3 py-1.5">
            <Clock size={14} className="studio-state-soft-text" />
            <span>{Math.max(1, Math.ceil(body.length / 500))} {t("reader.minRead")}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ReaderSettingsPanel({
  savedSettings,
  draftSettings,
  saving,
  onChange,
  onReset,
  onSave,
  t,
}: {
  savedSettings: ReaderSettings;
  draftSettings: ReaderSettings;
  saving: boolean;
  onChange: (device: ReaderDeviceScope, field: ReaderSettingField, value: string | number) => void;
  onReset: () => void;
  onSave: () => Promise<void>;
  t: TFunction;
}) {
  const diffItems = buildReaderSettingsDiff(savedSettings, draftSettings);

  return (
    <aside className="h-fit rounded-2xl border border-border/60 bg-card/95 p-5 shadow-sm xl:sticky xl:top-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">{t("reader.readerSettings")}</h2>
        <p className="text-sm text-muted-foreground">{t("reader.readerSettingsHint")}</p>
      </div>

      <div className="mt-6 space-y-5">
        {(["mobile", "desktop"] as const).map((device) => (
          <section key={device} className="space-y-3 rounded-2xl border border-border/50 bg-background/70 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{readerDeviceLabel(device, t)}</h3>
              <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {device === "mobile" ? t("reader.mobileView") : t("reader.desktopView")}
              </span>
            </div>

            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">{t("reader.font")}</span>
              <select
                value={draftSettings[device].fontPreset}
                onChange={(event) => onChange(device, "fontPreset", event.target.value)}
                className="w-full rounded-xl border border-border/60 bg-input/40 px-3 py-2 text-foreground"
              >
                {READER_FONT_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset === "sans"
                      ? t("reader.fontPresetSans")
                      : preset === "serif"
                        ? t("reader.fontPresetSerif")
                        : t("reader.fontPresetMyeongjo")}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">{t("reader.fontSize")}</span>
              <input
                type="number"
                min={MIN_READER_FONT_SIZE}
                max={MAX_READER_FONT_SIZE}
                step={1}
                value={draftSettings[device].fontSize}
                onChange={(event) => onChange(device, "fontSize", Number(event.target.value))}
                className="w-full rounded-xl border border-border/60 bg-input/40 px-3 py-2 text-foreground"
              />
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">{t("reader.lineHeight")}</span>
              <input
                type="number"
                min={MIN_READER_LINE_HEIGHT}
                max={MAX_READER_LINE_HEIGHT}
                step={0.02}
                value={draftSettings[device].lineHeight}
                onChange={(event) => onChange(device, "lineHeight", Number(event.target.value))}
                className="w-full rounded-xl border border-border/60 bg-input/40 px-3 py-2 text-foreground"
              />
            </label>
          </section>
        ))}
      </div>

      {diffItems.length > 0 ? (
        <div className="mt-6 space-y-3">
          <ReaderSettingsDiffSummary savedSettings={savedSettings} draftSettings={draftSettings} t={t} />
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold shadow-sm disabled:opacity-50 studio-cta"
        >
          {saving ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border/30 border-t-ring" /> : <Save size={14} />}
          {saving ? t("reader.savingReaderSettings") : t("reader.saveReaderSettings")}
        </button>
        <button
          onClick={onReset}
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-secondary px-4 py-2 text-sm font-bold text-muted-foreground transition-all hover:text-foreground disabled:opacity-50"
        >
          <RotateCcw size={14} />
          {t("reader.resetReaderSettings")}
        </button>
      </div>
    </aside>
  );
}

export function ChapterReader({
  bookId,
  chapterNumber,
  nav,
  theme,
  t,
}: {
  bookId: string;
  chapterNumber: number;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<ChapterReaderData>(
    `/books/${bookId}/chapters/${chapterNumber}`,
  );
  const [viewMode, setViewMode] = useState<ReaderDeviceScope>("mobile");
  const [showReaderSettings, setShowReaderSettings] = useState(false);
  const [draftReaderSettings, setDraftReaderSettings] = useState<ReaderSettings | null>(null);
  const [savingReaderSettings, setSavingReaderSettings] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 py-32">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border/30 border-t-ring" />
        <span className="text-sm text-muted-foreground">{t("reader.openingManuscript")}</span>
      </div>
    );
  }

  if (error) {
    return <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-destructive">Error: {error}</div>;
  }

  if (!data) {
    return null;
  }

  const savedReaderSettings = normalizeReaderSettings(data.readerSettings);
  const editorStyle = resolveReaderBodyStyle(viewMode, savedReaderSettings);

  const handleStartEdit = () => {
    setShowReaderSettings(false);
    setDraftReaderSettings(null);
    setEditContent(data.content);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditContent("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetchJson(`/books/${bookId}/chapters/${chapterNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      setEditing(false);
      refetch();
    } catch (saveError) {
      alert(saveError instanceof Error ? saveError.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    await postApi(`/books/${bookId}/chapters/${chapterNumber}/approve`);
    nav.toBook(bookId);
  };

  const handleReject = async () => {
    await postApi(`/books/${bookId}/chapters/${chapterNumber}/reject`);
    nav.toBook(bookId);
  };

  const handleToggleReaderSettings = () => {
    if (editing) {
      return;
    }

    if (showReaderSettings) {
      setShowReaderSettings(false);
      setDraftReaderSettings(null);
      return;
    }

    setDraftReaderSettings(savedReaderSettings);
    setShowReaderSettings(true);
  };

  const handleResetReaderSettings = () => {
    setDraftReaderSettings(savedReaderSettings);
  };

  const handleReaderSettingChange = (
    device: ReaderDeviceScope,
    field: ReaderSettingField,
    value: string | number,
  ) => {
    setDraftReaderSettings((current) => {
      const base = normalizeReaderSettings(current ?? savedReaderSettings);
      if (field === "fontPreset" && typeof value === "string") {
        return updateReaderDeviceSettings(base, device, { fontPreset: value as ReaderSettings[ReaderDeviceScope]["fontPreset"] });
      }
      if (field === "fontSize" && typeof value === "number" && Number.isFinite(value)) {
        return updateReaderDeviceSettings(base, device, { fontSize: clampReaderFontSize(value) });
      }
      if (field === "lineHeight" && typeof value === "number" && Number.isFinite(value)) {
        return updateReaderDeviceSettings(base, device, { lineHeight: clampReaderLineHeight(value) });
      }
      return base;
    });
  };

  const handleSaveReaderSettings = async () => {
    if (!draftReaderSettings) {
      return;
    }

    setSavingReaderSettings(true);
    try {
      await fetchJson(`/books/${bookId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readerSettings: normalizeReaderSettings(draftReaderSettings) }),
      });
      setShowReaderSettings(false);
      setDraftReaderSettings(null);
      refetch();
    } catch (saveError) {
      alert(saveError instanceof Error ? saveError.message : "Save failed");
    } finally {
      setSavingReaderSettings(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 fade-in">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
        <nav className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <button
            onClick={nav.toDashboard}
            className={`${c.link} flex items-center gap-1`}
          >
            {t("bread.books")}
          </button>
          <span className="text-border">/</span>
          <button
            onClick={() => nav.toBook(bookId)}
            className={`${c.link} max-w-[120px] truncate`}
          >
            {bookId}
          </button>
          <span className="text-border">/</span>
          <span className="flex items-center gap-1 text-foreground">
            <Hash size={12} />
            {chapterNumber}
          </span>
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => nav.toBook(bookId)}
            className="flex items-center gap-2 rounded-xl border border-border/50 bg-secondary px-4 py-2 text-xs font-bold text-muted-foreground transition-all hover:bg-secondary/80 hover:text-foreground"
          >
            <List size={14} />
            {t("reader.backToList")}
          </button>

          <div className="flex items-center rounded-xl border border-border/50 bg-secondary/40 p-1">
            <button
              onClick={() => setViewMode("mobile")}
              disabled={editing}
              aria-pressed={viewMode === "mobile"}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-all ${viewMode === "mobile" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"} disabled:opacity-50`}
            >
              <Smartphone size={14} />
              {t("reader.mobileView")}
            </button>
            <button
              onClick={() => setViewMode("desktop")}
              disabled={editing}
              aria-pressed={viewMode === "desktop"}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-all ${viewMode === "desktop" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"} disabled:opacity-50`}
            >
              <Monitor size={14} />
              {t("reader.desktopView")}
            </button>
          </div>

          <button
            onClick={handleToggleReaderSettings}
            disabled={editing}
            className={`flex items-center gap-2 rounded-xl border border-border/50 px-4 py-2 text-xs font-bold transition-all ${showReaderSettings ? "bg-background text-foreground shadow-sm" : "studio-chip"} disabled:opacity-50`}
          >
            <Settings2 size={14} />
            {t("reader.readerSettings")}
          </button>

          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold shadow-sm disabled:opacity-50 ${c.btnPrimary}`}
              >
                {saving ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border/30 border-t-ring" /> : <Save size={14} />}
                {saving ? t("book.saving") : t("book.save")}
              </button>
              <button
                onClick={handleCancelEdit}
                className="flex items-center gap-2 rounded-xl border border-border/50 bg-secondary px-4 py-2 text-xs font-bold text-muted-foreground transition-all hover:text-foreground"
              >
                <Eye size={14} />
                {t("reader.preview")}
              </button>
            </>
          ) : (
            <button
              onClick={handleStartEdit}
              className="flex items-center gap-2 rounded-xl border border-border/50 px-4 py-2 text-xs font-bold transition-all studio-chip"
            >
              <Pencil size={14} />
              {t("reader.edit")}
            </button>
          )}

          <button
            onClick={handleApprove}
            className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-600 shadow-sm transition-all hover:bg-emerald-500 hover:text-white"
          >
            <CheckCircle2 size={14} />
            {t("reader.approve")}
          </button>
          <button
            onClick={handleReject}
            className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-2 text-xs font-bold text-destructive shadow-sm transition-all hover:bg-destructive hover:text-white"
          >
            <XCircle size={14} />
            {t("reader.reject")}
          </button>
        </div>
      </div>

      <div className={showReaderSettings && !editing ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]" : "space-y-6"}>
        <div className="min-w-0">
          {editing ? (
            <div className="paper-sheet mx-auto w-full max-w-4xl rounded-2xl p-8 shadow-2xl shadow-primary/5">
              <textarea
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
                className="min-h-[60vh] w-full resize-none rounded-xl border border-border/30 bg-transparent p-6 text-foreground/90 transition-all focus:border-[color:var(--studio-chip-border)] focus:outline-none focus:ring-2 focus:ring-[color:var(--studio-state-text)]/20"
                style={{
                  fontFamily: editorStyle.fontFamily,
                  fontSize: `${editorStyle.fontSize}px`,
                  lineHeight: editorStyle.lineHeight,
                }}
                autoFocus
              />
            </div>
          ) : (
            <ChapterReaderPreviewFrame
              chapter={data}
              viewMode={viewMode}
              showReaderSettings={showReaderSettings}
              draftReaderSettings={draftReaderSettings}
              t={t}
            />
          )}
        </div>

        {showReaderSettings && !editing && draftReaderSettings ? (
          <ReaderSettingsPanel
            savedSettings={savedReaderSettings}
            draftSettings={draftReaderSettings}
            saving={savingReaderSettings}
            onChange={handleReaderSettingChange}
            onReset={handleResetReaderSettings}
            onSave={handleSaveReaderSettings}
            t={t}
          />
        ) : null}
      </div>

      <div className="flex items-center justify-between py-4">
        {chapterNumber > 1 ? (
          <button
            onClick={() => nav.toBook(bookId)}
            className="group flex items-center gap-2 text-sm font-bold text-muted-foreground transition-all hover:text-[color:var(--studio-state-text)]"
          >
            <RotateCcw size={16} className="transition-transform group-hover:-rotate-45" />
            {t("reader.chapterList")}
          </button>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}
