import { fetchJson, useApi, postApi } from "../hooks/use-api";
import { useEffect, useMemo, useState, useRef } from "react";
import type { SSEMessage } from "../hooks/use-sse";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { deriveActiveBookIds, shouldRefetchBookCollections } from "../hooks/use-book-activity";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  Plus,
  BookOpen,
  BarChart2,
  Zap,
  Clock,
  AlertCircle,
  MoreVertical,
  ChevronRight,
  Flame,
  Trash2,
  Settings,
  Download,
  FileInput,
  Loader2,
} from "lucide-react";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
  readonly language?: string;
  readonly fanficMode?: string;
}

interface BookCreateJob {
  readonly bookId: string;
  readonly title: string;
  readonly status: "creating" | "error";
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly stage: string | null;
  readonly message: string | null;
  readonly history: ReadonlyArray<{
    readonly timestamp: string;
    readonly kind: "start" | "stage" | "info" | "error";
    readonly label: string;
    readonly detail?: string | null;
  }>;
  readonly error?: string;
}

interface Nav {
  toBook: (id: string) => void;
  toAnalytics: (id: string) => void;
  toCockpit: () => void;
  toConfig: () => void;
  toRadar: () => void;
}

function BookMenu({ bookId, bookTitle, nav, t, onDelete }: {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly nav: Nav;
  readonly t: TFunction;
  readonly onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleDelete = async () => {
    setConfirmDelete(false);
    setOpen(false);
    await fetchJson(`/books/${bookId}`, { method: "DELETE" });
    onDelete();
  };

  return (
    <div ref={menuRef} className="relative z-10">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl studio-icon-btn cursor-pointer"
      >
        <MoreVertical size={18} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 min-w-[11rem] bg-card/95 backdrop-blur-md border border-border/80 rounded-xl shadow-2xl shadow-black/15 py-1 z-50 fade-in">
          <button
            onClick={() => { setOpen(false); nav.toBook(bookId); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/60 transition-colors cursor-pointer"
          >
            <Settings size={14} className="text-muted-foreground" />
            {t("book.settings")}
          </button>
          <a
            href={`/api/books/${bookId}/export?format=txt`}
            download
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/60 transition-colors cursor-pointer"
          >
            <Download size={14} className="text-muted-foreground" />
            {t("book.export")}
          </a>
          <div className="border-t border-border/50 my-1" />
          <button
            onClick={() => { setOpen(false); setConfirmDelete(true); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/12 transition-colors cursor-pointer"
          >
            <Trash2 size={14} />
            {t("book.deleteBook")}
          </button>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={t("book.deleteBook")}
        message={`${t("book.confirmDelete")}\n\n"${bookTitle}"`}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export function Dashboard({ nav, sse, theme, t }: { nav: Nav; sse: { messages: ReadonlyArray<SSEMessage> }; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const { data: createStatusData, refetch: refetchCreateStatus } = useApi<{ entries: ReadonlyArray<BookCreateJob> }>("/book-create-status");
  const writingBooks = useMemo(() => deriveActiveBookIds(sse.messages), [sse.messages]);
  const createJobs = createStatusData?.entries ?? [];

  const logEvents = sse.messages.filter((m) => m.event === "log").slice(-8);
  const progressEvent = sse.messages.filter((m) => m.event === "llm:progress").slice(-1)[0];

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;
    if (shouldRefetchBookCollections(recent)) {
      refetch();
    }
    if (recent.event === "book:creating" || recent.event === "book:create:progress" || recent.event === "book:error" || recent.event === "book:created") {
      refetchCreateStatus();
    }
  }, [refetch, refetchCreateStatus, sse.messages]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 space-y-4">
      <div className="w-8 h-8 border-2 border-border/30 border-t-ring rounded-full animate-spin" />
      <span className="text-sm text-muted-foreground animate-pulse">Gathering manuscripts...</span>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center py-20 bg-destructive/5 border border-destructive/20 rounded-2xl">
      <AlertCircle className="text-destructive mb-4" size={32} />
      <h2 className="text-lg font-semibold text-destructive">Failed to load library</h2>
      <p className="text-sm text-muted-foreground mt-1">{error}</p>
    </div>
  );

  if (!data?.books.length) {
    return (
      <div className="space-y-10 fade-in">
        {createJobs.length > 0 && (
          <CreateJobPanel jobs={createJobs} t={t} />
        )}
        <section className="grid gap-6 rounded-[2rem] border border-border/50 bg-card/70 px-6 py-8 shadow-soft md:grid-cols-[minmax(0,1.02fr)_minmax(19rem,0.98fr)] md:px-8 md:py-10">
          <div className="flex flex-col gap-5 text-center md:text-left">
            <div className="grid gap-3 lg:grid-cols-3">
              <HeroSignalCard
                icon={<Clock size={14} />}
                title={t("dash.quickStartTitle")}
                description={t("dash.quickStartBody")}
              />
              <HeroSignalCard
                icon={<Zap size={14} />}
                title={t("dash.workflowTitle")}
                description={t("dash.workflowBody")}
              />
              <HeroSignalCard
                icon={<BarChart2 size={14} />}
                title={t("dash.localizedTitle")}
                description={t("dash.localizedBody")}
              />
            </div>

            <div className="flex flex-1 flex-col justify-center rounded-[1.75rem] border border-border/50 bg-background/72 px-6 py-8 md:px-7">
              <div className="mx-auto mb-6 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full studio-chip-accent md:mx-0">
                <BookOpen size={34} className="text-[color:var(--studio-state-text)]" />
              </div>
              <h2 className="font-serif text-[clamp(2.1rem,4vw,3.2rem)] leading-[1.02] text-foreground/90">{t("dash.noBooks")}</h2>
              <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
                {t("dash.createFirst")}
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row md:justify-start">
                <button
                  onClick={nav.toCockpit}
                  className="group inline-flex items-center justify-center gap-2 rounded-xl px-8 py-3.5 text-sm font-bold studio-cta transition-all hover:scale-[1.02] active:scale-95"
                >
                  <Plus size={18} />
                  {t("nav.openCockpit")}
                </button>
                <button
                  onClick={nav.toConfig}
                  className="flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold studio-chip transition-colors"
                >
                  <Settings size={16} />
                  {t("app.llmSettings")}
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-1">
            <QuickStartCard
              icon={<Settings size={16} />}
              step="01"
              title={t("dash.quickStepConfig")}
              description={t("dash.quickStepConfigBody")}
              ctaLabel={t("common.open")}
              onClick={nav.toConfig}
            />
            <QuickStartCard
              icon={<Plus size={16} />}
              step="02"
              title={t("dash.quickStepCockpit")}
              description={t("dash.quickStepBookBody")}
              ctaLabel={t("common.open")}
              onClick={nav.toCockpit}
            />
            <QuickStartCard
              icon={<FileInput size={16} />}
              step="03"
              title={t("nav.radar")}
              description={t("dash.quickStepRadarBody")}
              ctaLabel={t("common.open")}
              onClick={nav.toRadar}
            />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <div className="flex flex-col gap-4 border-b border-border/40 pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="mb-2 font-serif text-3xl sm:text-4xl">{t("dash.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("dash.subtitle")}</p>
        </div>
        <button
          onClick={nav.toCockpit}
          className="group inline-flex items-center justify-center gap-2 self-start rounded-xl px-5 py-2.5 text-sm font-bold studio-cta transition-all hover:scale-105 active:scale-95 sm:self-auto"
        >
          <Plus size={16} />
          {t("nav.openCockpit")}
        </button>
      </div>

      {createJobs.length > 0 && (
        <CreateJobPanel jobs={createJobs} t={t} />
      )}

      <div className="grid gap-6">
        {data.books.map((book, index) => {
          const isWriting = writingBooks.has(book.id);
          const staggerClass = `stagger-${Math.min(index + 1, 5)}`;
          return (
            <div
              key={book.id}
              className={`paper-sheet group relative rounded-2xl overflow-visible fade-in ${staggerClass}`}
            >
              <div className="flex flex-col gap-5 p-5 sm:p-6 xl:flex-row xl:items-start xl:justify-between xl:p-8">
                <div className="min-w-0 flex-1">
                  <div className="mb-4 flex items-start gap-3">
                    <div className="rounded-lg studio-chip p-2">
                      <BookOpen size={20} />
                    </div>
                    <button
                      onClick={() => nav.toBook(book.id)}
                      className="block min-w-0 truncate text-left font-serif text-xl font-medium transition-all hover:text-[color:var(--studio-state-text)] hover:underline decoration-[color:var(--studio-state-text)] underline-offset-4 sm:text-2xl"
                    >
                      {book.title}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[12px] font-medium text-muted-foreground sm:flex sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2 sm:text-[13px]">
                    <div className="inline-flex items-center gap-1.5 rounded bg-secondary/50 px-2 py-1">
                      <span className="uppercase tracking-wider">{book.genre}</span>
                    </div>
                    <div className="inline-flex items-center gap-1.5 rounded bg-background/75 px-2 py-1 sm:bg-transparent sm:px-0 sm:py-0">
                      <Clock size={14} />
                      <span>{book.chaptersWritten} {t("dash.chapters")}</span>
                    </div>
                    <div className="inline-flex items-center gap-1.5 rounded bg-background/75 px-2 py-1 sm:bg-transparent sm:px-0 sm:py-0">
                      <div className={`w-2 h-2 rounded-full ${
                        book.status === "active" ? "studio-status-dot-ok" :
                        book.status === "paused" ? "studio-status-dot-warn" :
                        "bg-muted-foreground"
                      }`} />
                      <span>{
                        book.status === "active" ? t("book.statusActive") :
                        book.status === "paused" ? t("book.statusPaused") :
                        book.status === "outlining" ? t("book.statusOutlining") :
                        book.status === "completed" ? t("book.statusCompleted") :
                        book.status === "dropped" ? t("book.statusDropped") :
                        book.status
                      }</span>
                    </div>
                    {book.language === "en" && (
                      <span className="inline-flex items-center rounded studio-badge-soft px-1.5 py-1 text-[10px] font-bold">EN</span>
                    )}
                    {book.fanficMode && (
                      <span className="inline-flex items-center gap-1 rounded studio-chip px-2 py-1 sm:bg-transparent sm:px-0 sm:py-0">
                        <Zap size={12} />
                        <span className="italic">{book.fanficMode}</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex w-full items-center gap-2 sm:gap-3 xl:ml-6 xl:w-auto xl:shrink-0 xl:justify-end">
                  <button
                    onClick={() => postApi(`/books/${book.id}/write-next`)}
                    disabled={isWriting}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all sm:flex-none sm:px-6 ${
                      isWriting
                        ? "studio-chip text-foreground cursor-wait animate-pulse"
                        : "studio-chip-accent hover:scale-105 active:scale-95"
                    }`}
                  >
                    {isWriting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-border/30 border-t-ring rounded-full animate-spin" />
                        {t("dash.writing")}
                      </>
                    ) : (
                      <>
                        <Zap size={16} />
                        {t("dash.writeNext")}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => nav.toAnalytics(book.id)}
                    className="rounded-xl studio-icon-btn p-3 transition-all hover:scale-105 active:scale-95"
                    title={t("dash.stats")}
                  >
                    <BarChart2 size={18} />
                  </button>
                  <BookMenu
                    bookId={book.id}
                    bookTitle={book.title}
                    nav={nav}
                    t={t}
                    onDelete={() => refetch()}
                  />
                </div>
              </div>

              {/* Enhanced progress indicator */}
              {isWriting && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-secondary overflow-hidden">
                   <div className="h-full bg-ring w-1/3 animate-[progress_2s_ease-in-out_infinite]" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modern writing progress panel */}
      {writingBooks.size > 0 && logEvents.length > 0 && (
        <div className="glass-panel rounded-2xl p-8 border border-border/50 shadow-2xl fade-in">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg studio-chip-accent">
                <Flame size={18} className="animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-bold uppercase tracking-widest text-[color:var(--studio-state-text)]"> Manuscript Foundry</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Real-time LLM generation tracking</p>
              </div>
            </div>
            {progressEvent && (
              <div className="flex items-center gap-4 text-xs font-bold studio-chip px-4 py-2 rounded-full">
                <div className="flex items-center gap-2">
                  <Clock size={12} />
                  <span>{Math.round(((progressEvent.data as { elapsedMs?: number })?.elapsedMs ?? 0) / 1000)}s</span>
                </div>
                <div className="w-px h-3 bg-border/40" />
                <div className="flex items-center gap-2">
                  <Zap size={12} />
                  <span>{((progressEvent.data as { totalChars?: number })?.totalChars ?? 0).toLocaleString()} Chars</span>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2 font-mono text-xs bg-black/5 dark:bg-black/20 p-6 rounded-xl border border-border/50 max-h-[200px] overflow-y-auto scrollbar-thin">
            {logEvents.map((msg, i) => {
              const d = msg.data as { tag?: string; message?: string };
              return (
                <div key={i} className="flex gap-3 leading-relaxed animate-in fade-in slide-in-from-left-2 duration-300">
                  <span className="font-bold shrink-0 studio-state-soft-text">[{d.tag}]</span>
                  <span className="text-muted-foreground">{d.message}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}

function HeroSignalCard({ icon, title, description }: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-background/72 p-4 text-left">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function CreateJobPanel({ jobs, t }: {
  readonly jobs: ReadonlyArray<BookCreateJob>;
  readonly t: TFunction;
}) {
  return (
    <section className="rounded-[1.75rem] border border-border/40 studio-chip px-5 py-5 shadow-soft">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl studio-chip">
          <Loader2 size={18} className="animate-spin" />
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">{t("dash.createQueueTitle")}</div>
          <div className="mt-1 text-xs text-muted-foreground">{t("dash.createQueueHint")}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {jobs.map((job) => (
          <CreateJobCard key={job.bookId} job={job} t={t} />
        ))}
      </div>
    </section>
  );
}

function CreateJobCard({ job, t }: { readonly job: BookCreateJob; readonly t: TFunction }) {
  const detail = (job.error || job.stage || job.message || t("create.creatingHint")).split("\n")[0];

  return (
    <div
      className={`rounded-2xl border px-4 py-4 ${
        job.status === "error"
          ? "border-destructive/25 bg-destructive/6"
          : "border-border/50 bg-background/75"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-foreground">{job.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{job.bookId}</div>
        </div>
        <div className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
          job.status === "error"
            ? "bg-destructive/10 text-destructive"
            : "studio-badge-soft"
        }`}>
          {job.status === "error" ? t("dash.createFailed") : t("dash.createRunning")}
        </div>
      </div>
      <div className="mt-3 text-sm leading-6 text-foreground/85">
        {detail}
      </div>
      {job.status === "creating" && job.stage && (
        <div className="mt-2 text-xs text-muted-foreground">
          {job.stage}
        </div>
      )}
      {job.history.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
          {job.history.slice(-3).reverse().map((entry) => (
            <div key={`${entry.timestamp}-${entry.kind}-${entry.label}`} className="flex items-start justify-between gap-3 text-xs">
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground/85">{entry.label}</div>
                {entry.detail && entry.detail !== entry.label && (
                  <div className="truncate text-muted-foreground">{entry.detail.split("\n")[0]}</div>
                )}
              </div>
              <div className="shrink-0 text-muted-foreground">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 text-xs text-muted-foreground">
        {t("dash.createUpdated")} {new Date(job.updatedAt).toLocaleTimeString()}
      </div>
    </div>
  );
}

function QuickStartCard({ step, title, description, icon, ctaLabel, onClick }: {
  readonly step: string;
  readonly title: string;
  readonly description: string;
  readonly icon: React.ReactNode;
  readonly ctaLabel: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-2xl border border-border/60 bg-background/75 p-4 text-left transition-all hover:bg-card hover:border-border hover:shadow-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{step}</div>
          <div className="mt-2 text-base font-semibold text-foreground">{title}</div>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl studio-icon-btn transition-transform group-hover:scale-105">
          {icon}
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--studio-state-text)]">
        {ctaLabel}
        <ChevronRight size={14} />
      </div>
    </button>
  );
}
