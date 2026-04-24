import type { TFunction } from "../../hooks/use-i18n";
import {
  BookOpen,
  ChevronDown,
  FileText,
  Loader2,
  MessageSquareText,
  Play,
  RefreshCcw,
  Search,
} from "lucide-react";

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
        <div className="studio-cockpit-console-brand">
          <span className="studio-cockpit-console-kicker">InkOS Studio / {t("nav.cockpit")}</span>
          <h1 className="studio-cockpit-console-title">{t("cockpit.title")}</h1>
          <div className="studio-cockpit-console-subtitle">{t("cockpit.subtitle")}</div>
        </div>

        <div className="studio-cockpit-top-controls">
          <div className="studio-cockpit-select-chip">
            <span>Workspace</span>
            <strong>{selectedBookLabel}</strong>
            <ChevronDown size={13} />
          </div>
          <div className="studio-cockpit-select-chip">
            <span>Environment</span>
            <i />
            <strong>Production</strong>
            <ChevronDown size={13} />
          </div>
          <div className="studio-cockpit-search" aria-label="Search">
            <Search size={14} />
            <span>Search</span>
          </div>
        </div>
      </div>

      <div className="studio-cockpit-commandline">
        <div className="studio-cockpit-commandline-input">
          <MessageSquareText size={15} />
          <span>&gt;</span>
          <strong>{statusTargetLabel || selectedBookLabel || t("cockpit.currentContext")}</strong>
          <span className="studio-cockpit-commandline-muted">{modeLabel} · {statusStageLabel}</span>
        </div>
        <button
          onClick={onRefresh}
          className={`studio-cockpit-launch-button ${classes.btnPrimary}`}
        >
          <Play size={15} />
          Run
        </button>
      </div>

      <div className="studio-cockpit-console-status-grid" aria-label={t("cockpit.currentContext")}>
        <div className="studio-cockpit-console-cell">
          <span>Model</span>
          <strong>{statusModelLabel}</strong>
        </div>
        <div className="studio-cockpit-console-cell">
          <span>Agents</span>
          <strong>4</strong>
        </div>
        <div className="studio-cockpit-console-cell">
          <span>Mode</span>
          <strong>{modeLabel}</strong>
        </div>
        <div className="studio-cockpit-console-cell">
          <span>Max Steps</span>
          <strong>{statusStageLabel}</strong>
        </div>
        <div className="studio-cockpit-console-cell">
          <span>Context</span>
          <strong>85%</strong>
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
