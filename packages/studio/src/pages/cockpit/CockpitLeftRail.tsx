import type { ReactNode } from "react";
import type { TFunction } from "../../hooks/use-i18n";
import type { CockpitMode } from "../cockpit-ui-state";
import type { TruthFileSummary } from "../../shared/contracts";
import { BookOpen, FileText, MessageSquareText, Plus, PenSquare, Wand2 } from "lucide-react";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly status: string;
  readonly chaptersWritten: number;
}

interface ChapterSummary {
  readonly number: number;
  readonly title: string;
  readonly status: string;
}

interface RailVisibility {
  readonly showTruthList: boolean;
  readonly showChapterList: boolean;
}

interface ModeButtonProps {
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}

interface CockpitLeftRailProps {
  readonly t: TFunction;
  readonly books: ReadonlyArray<BookSummary>;
  readonly showNewSetup: boolean;
  readonly selectedBookId: string;
  readonly mode: CockpitMode;
  readonly railVisibility: RailVisibility;
  readonly referenceChapterLabel: string;
  readonly truthFiles: ReadonlyArray<TruthFileSummary>;
  readonly selectedTruthFile: string;
  readonly chapterItems: ReadonlyArray<ChapterSummary>;
  readonly selectedChapterNumber: number | null;
  readonly onNewSetup: () => void;
  readonly onSelectBook: (bookId: string) => void;
  readonly onModeChange: (mode: CockpitMode) => void;
  readonly onSelectTruthFile: (name: string) => void;
  readonly onSelectChapter: (number: number) => void;
  readonly ModeButton: (props: ModeButtonProps) => ReactNode;
  readonly renderChapterStatus: (status: string) => string;
  readonly makeTruthPreview: (value: string, limit?: number) => string;
}

export function CockpitLeftRail({
  t,
  books,
  showNewSetup,
  selectedBookId,
  mode,
  railVisibility,
  referenceChapterLabel,
  truthFiles,
  selectedTruthFile,
  chapterItems,
  selectedChapterNumber,
  onNewSetup,
  onSelectBook,
  onModeChange,
  onSelectTruthFile,
  onSelectChapter,
  ModeButton,
  renderChapterStatus,
  makeTruthPreview,
}: CockpitLeftRailProps) {
  return (
    <aside className="studio-cockpit-left studio-cockpit-rail space-y-4 xl:pr-1">
      <div className="studio-cockpit-panel rounded-[1.6rem] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            <BookOpen size={14} />
            {t("cockpit.selectBook")}
          </div>
          <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold">
            {books.length}
          </span>
        </div>
        <div className="space-y-2">
          <button
            type="button"
            onClick={onNewSetup}
            className={`w-full rounded-xl px-3 py-3 text-left text-sm transition-all ${
              showNewSetup
                ? "studio-chip-accent studio-surface-active text-foreground font-semibold"
                : "studio-chip studio-surface-hover"
            }`}
          >
            <div className="flex items-center gap-2">
              <Plus size={14} />
              {t("cockpit.newSetup")}
            </div>
          </button>

          {books.map((book) => (
            <button
              key={book.id}
            type="button"
            onClick={() => onSelectBook(book.id)}
            className={`w-full rounded-xl px-3 py-3 text-left text-sm transition-all ${
              !showNewSetup && selectedBookId === book.id
                  ? "studio-chip-accent studio-surface-active text-foreground font-semibold"
                  : "studio-chip studio-surface-hover"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{book.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {book.genre} · {book.platform}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {book.chaptersWritten > 0 ? (
                    <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold">
                      {book.chaptersWritten}
                    </span>
                  ) : null}
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {book.status}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="studio-cockpit-panel rounded-[1.6rem] p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
          <MessageSquareText size={14} />
          {t("cockpit.scope")}
        </div>
        <div className="grid gap-2">
          <ModeButton
            active={mode === "discuss"}
            icon={<MessageSquareText size={15} />}
            label={t("cockpit.discuss")}
            onClick={() => onModeChange("discuss")}
          />
          <ModeButton
            active={mode === "binder"}
            disabled={!selectedBookId}
            icon={<Wand2 size={15} />}
            label={t("cockpit.binder")}
            onClick={() => onModeChange("binder")}
          />
          <ModeButton
            active={mode === "draft"}
            disabled={!selectedBookId}
            icon={<PenSquare size={15} />}
            label={t("cockpit.draft")}
            onClick={() => onModeChange("draft")}
          />
        </div>
        <div className="mt-3 rounded-xl border border-border/50 bg-background/72 px-3 py-3 text-xs leading-6 text-muted-foreground">
          {t("cockpit.commandHint")}
        </div>
      </div>

      {railVisibility.showTruthList && selectedBookId && truthFiles.length > 0 ? (
        <div className="studio-cockpit-panel rounded-[1.6rem] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              <FileText size={14} />
              {t("cockpit.selectedTruth")}
            </div>
            <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold">
              {truthFiles.length}
            </span>
          </div>
          <div className="max-h-[18rem] space-y-2 overflow-y-auto pr-1">
            {truthFiles.map((file) => (
              <button
                key={file.name}
                type="button"
                onClick={() => onSelectTruthFile(file.name)}
                className={`w-full rounded-xl px-3 py-3 text-left text-sm transition-all ${
                  selectedTruthFile === file.name
                    ? "studio-chip-accent studio-surface-active text-foreground font-semibold"
                    : "studio-chip studio-surface-hover"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{file.label}</span>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {file.exists ? "saved" : "seed"}
                  </span>
                </div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{makeTruthPreview(file.preview, 72)}</div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {railVisibility.showChapterList && selectedBookId && chapterItems.length > 0 ? (
        <div className="studio-cockpit-panel rounded-[1.6rem] p-4">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            <div className="flex items-center gap-2">
              <BookOpen size={14} />
              {referenceChapterLabel}
            </div>
            <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold">
              {chapterItems.length}
            </span>
          </div>
          <div className="max-h-[16rem] space-y-2 overflow-y-auto pr-1">
            {[...chapterItems].reverse().slice(0, 8).map((chapter) => (
              <button
                key={chapter.number}
                type="button"
                onClick={() => onSelectChapter(chapter.number)}
                className={`w-full rounded-xl px-3 py-3 text-left text-sm transition-all ${
                  selectedChapterNumber === chapter.number
                    ? "studio-chip-accent studio-surface-active text-foreground font-semibold"
                    : "studio-chip studio-surface-hover"
                }`}
              >
                <div className="truncate font-medium">
                  {t("chapter.label").replace("{n}", `${chapter.number}`)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{chapter.title || renderChapterStatus(chapter.status)}</div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
