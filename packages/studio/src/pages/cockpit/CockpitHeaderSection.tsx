import type { TFunction } from "../../hooks/use-i18n";
import { BookOpen, FileText, Loader2, MessageSquareText, RefreshCcw, Sparkles } from "lucide-react";

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

const heroImageUrl = new URL("../../assets/cockpit-hero-v1.png", import.meta.url).href;

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
    <section className="studio-cockpit-hero">
      <div className="studio-cockpit-hero-media" aria-hidden="true">
        <img src={heroImageUrl} alt="" className="h-full w-full object-cover" />
      </div>
      <div className="studio-cockpit-hero-scrim" aria-hidden="true" />

      <div className="studio-cockpit-hero-grid">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full studio-badge-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
            <MessageSquareText size={14} />
            {t("nav.cockpit")}
          </div>

          <div>
            <h1 className="font-serif text-[clamp(2.1rem,3.2vw,3.25rem)] leading-[0.98] text-foreground">
              {t("cockpit.title")}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-foreground/78">
              {t("cockpit.subtitle")}
            </p>
          </div>

          <div className="studio-cockpit-hero-kpis">
            <div className="studio-cockpit-kpi">
              <span>{t("cockpit.scope")}</span>
              <strong>{modeLabel}</strong>
            </div>
            <div className="studio-cockpit-kpi">
              <span>{t("cockpit.statusStage")}</span>
              <strong>{statusStageLabel}</strong>
            </div>
            <div className="studio-cockpit-kpi">
              <span>{t("cockpit.statusTarget")}</span>
              <strong>{statusTargetLabel}</strong>
            </div>
            <div className="studio-cockpit-kpi">
              <span>{t("cockpit.selectBook")}</span>
              <strong>{bookCount}</strong>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="studio-cockpit-hero-card hidden lg:block">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {t("cockpit.currentContext")}
                </div>
                <div className="mt-2 text-xl font-semibold text-foreground">{selectedBookLabel}</div>
                <div className="mt-1 text-sm leading-6 text-foreground/72">{statusModelLabel}</div>
              </div>
              <div className="rounded-full studio-chip-accent p-2 text-foreground">
                <Sparkles size={16} />
              </div>
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
            {selectedBookId ? (
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
            ) : null}
          </div>
        </div>
      </div>

      {(booksLoading || booksError || createJobs.length > 0) ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
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
      ) : null}
    </section>
  );
}
