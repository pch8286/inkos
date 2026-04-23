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
  readonly bookCount: number;
  readonly selectedBookLabel: string;
  readonly modeLabel: string;
  readonly statusStageLabel: string;
  readonly statusTargetLabel: string;
  readonly statusModelLabel: string;
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
  bookCount,
  selectedBookLabel,
  modeLabel,
  statusStageLabel,
  statusTargetLabel,
  statusModelLabel,
  selectedBookId,
  onRefresh,
  classes,
}: CockpitHeaderSectionProps) {
  return (
    <section className="studio-cockpit-console-header">
      <div className="studio-cockpit-console-titlebar">
        <div className="min-w-0 space-y-3">
          <div className="inline-flex items-center gap-2 studio-console-eyebrow">
            <MessageSquareText size={14} />
            {t("nav.cockpit")}
          </div>

          <h1 className="studio-cockpit-console-title">{t("cockpit.title")}</h1>
          <p className="studio-cockpit-console-subtitle">{t("cockpit.subtitle")}</p>
        </div>

        <div className="studio-cockpit-console-context" aria-label={t("cockpit.currentContext")}>
          <div className="text-[11px] font-bold uppercase text-muted-foreground">
            {t("cockpit.currentContext")}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-foreground">{selectedBookLabel}</div>
          <div className="mt-1 truncate text-xs text-foreground/70">{statusModelLabel}</div>
        </div>
      </div>

      <div className="studio-cockpit-console-status-grid">
        <div className="studio-cockpit-console-cell">
          <span>{t("cockpit.scope")}</span>
          <strong>{modeLabel}</strong>
        </div>
        <div className="studio-cockpit-console-cell">
          <span>{t("cockpit.statusStage")}</span>
          <strong>{statusStageLabel}</strong>
        </div>
        <div className="studio-cockpit-console-cell">
          <span>{t("cockpit.statusTarget")}</span>
          <strong>{statusTargetLabel}</strong>
        </div>
        <div className="studio-cockpit-console-cell">
          <span>{t("cockpit.selectBook")}</span>
          <strong>{bookCount}</strong>
        </div>
      </div>

      <div className="studio-cockpit-console-actions">
        <button
          onClick={onRefresh}
          className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${classes.btnSecondary}`}
        >
          <RefreshCcw size={15} />
          {t("common.refresh")}
        </button>
        {selectedBookId ? (
          <>
            <button
              onClick={() => nav.toBook(selectedBookId)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${classes.btnSecondary}`}
            >
              <BookOpen size={15} />
              {t("cockpit.openBook")}
            </button>
            <button
              onClick={() => nav.toTruth(selectedBookId)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${classes.btnPrimary}`}
            >
              <FileText size={15} />
              {t("cockpit.openBinder")}
            </button>
          </>
        ) : null}
      </div>

      {(booksLoading || booksError || createJobs.length > 0) ? (
        <div className="studio-cockpit-console-events" role="status" aria-live="polite">
          {booksLoading ? (
            <div className="studio-console-event text-muted-foreground">
              <Loader2 size={13} className="animate-spin" />
              {t("common.loading")}
            </div>
          ) : null}
          {booksError ? (
            <div className={`studio-console-event ${classes.error}`}>
              {booksError}
            </div>
          ) : null}
          {createJobs.map((job) => (
            <div
              key={job.bookId}
              className="studio-console-event text-foreground/85"
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
      ) : null}
    </section>
  );
}
