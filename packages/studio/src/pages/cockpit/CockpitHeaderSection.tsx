import type { TFunction } from "../../hooks/use-i18n";
import { BookOpen, FileText, Loader2, MessageSquareText, RefreshCcw } from "lucide-react";

interface Nav {
  readonly toBook: (id: string) => void;
  readonly toTruth: (id: string) => void;
}

interface BookCreateJob {
  readonly bookId: string;
  readonly title: string;
  readonly status: "creating" | "error";
  readonly stage: string | null;
  readonly message: string | null;
  readonly error?: string;
}

interface HeaderClassNames {
  readonly btnPrimary: string;
  readonly btnSecondary: string;
  readonly error: string;
}

interface CockpitHeaderSectionProps {
  readonly t: TFunction;
  readonly nav: Nav;
  readonly booksLoading: boolean;
  readonly booksError: string | null;
  readonly createJobs: ReadonlyArray<BookCreateJob>;
  readonly selectedBookId: string;
  readonly onRefresh: () => void;
  readonly classes: HeaderClassNames;
}

export function CockpitHeaderSection({
  t,
  nav,
  booksLoading,
  booksError,
  createJobs,
  selectedBookId,
  onRefresh,
  classes,
}: CockpitHeaderSectionProps) {
  return (
    <section className="rounded-[1.65rem] border border-border/50 bg-card/70 px-5 py-5 shadow-soft">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 rounded-full studio-badge-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
            <MessageSquareText size={14} />
            {t("nav.cockpit")}
          </div>
          <div>
            <h1 className="font-serif text-[clamp(1.9rem,3vw,2.75rem)] leading-[1.04] text-foreground/92">
              {t("cockpit.title")}
            </h1>
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
              {t("cockpit.subtitle")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onRefresh}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${classes.btnSecondary}`}
          >
            <RefreshCcw size={15} />
            {t("common.refresh")}
          </button>
          {selectedBookId && (
            <>
              <button
                onClick={() => nav.toBook(selectedBookId)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${classes.btnSecondary}`}
              >
                <BookOpen size={15} />
                {t("cockpit.openBook")}
              </button>
              <button
                onClick={() => nav.toTruth(selectedBookId)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${classes.btnPrimary}`}
              >
                <FileText size={15} />
                {t("cockpit.openBinder")}
              </button>
            </>
          )}
        </div>
      </div>

      {(booksLoading || booksError || createJobs.length > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {booksLoading ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" />
              {t("common.loading")}
            </div>
          ) : null}
          {booksError ? (
            <div className={`inline-flex max-w-full items-center rounded-full border px-3 py-2 text-xs ${classes.error}`}>
              {booksError}
            </div>
          ) : null}
          {createJobs.map((job) => (
            <div
              key={job.bookId}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/50 bg-background/70 px-3 py-2 text-xs text-foreground/85"
            >
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
                  job.status === "error" ? "studio-badge-warn" : "studio-badge-ok"
                }`}
              >
                {job.status === "error" ? t("dash.createFailed") : t("dash.createRunning")}
              </span>
              <span className="truncate font-medium">{job.title}</span>
              <span className="truncate text-muted-foreground">
                {(job.error || job.stage || job.message || t("create.creatingHint")).split("\n")[0]}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
