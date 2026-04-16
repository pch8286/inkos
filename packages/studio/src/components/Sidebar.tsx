import { useEffect } from "react";
import { useApi } from "../hooks/use-api";
import type { SSEMessage } from "../hooks/use-sse";
import { shouldRefetchBookCollections, shouldRefetchDaemonStatus, shouldRefetchBookCreateStatus } from "../hooks/use-book-activity";
import type { TFunction } from "../hooks/use-i18n";
import {
  Book,
  Settings,
  Terminal,
  Plus,
  ScrollText,
  Boxes,
  Zap,
  Wand2,
  FileInput,
  TrendingUp,
  Stethoscope,
  MessageSquareText,
  X,
} from "lucide-react";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
}

interface BookCreateJob {
  readonly bookId: string;
  readonly title: string;
  readonly status: "creating" | "error";
  readonly stage: string | null;
  readonly message: string | null;
  readonly error?: string;
}

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toBookCreate: () => void;
  toCockpit: () => void;
  toConfig: () => void;
  toDaemon: () => void;
  toLogs: () => void;
  toGenres: () => void;
  toStyle: () => void;
  toImport: () => void;
  toRadar: () => void;
  toDoctor: () => void;
}

export function Sidebar({ nav, activePage, sse, t, mobileOpen = false, onClose }: {
  nav: Nav;
  activePage: string;
  sse: { messages: ReadonlyArray<SSEMessage> };
  t: TFunction;
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  const { data, refetch: refetchBooks } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const { data: createStatusData, refetch: refetchCreateStatus } = useApi<{ entries: ReadonlyArray<BookCreateJob> }>("/book-create-status");
  const { data: daemon, refetch: refetchDaemon } = useApi<{ running: boolean }>("/daemon");

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;
    if (shouldRefetchBookCollections(recent)) {
      refetchBooks();
    }
    if (shouldRefetchBookCreateStatus(recent)) {
      refetchCreateStatus();
    }
    if (shouldRefetchDaemonStatus(recent)) {
      refetchDaemon();
    }
  }, [refetchBooks, refetchCreateStatus, refetchDaemon, sse.messages]);

  return (
    <>
      <button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] transition-opacity md:hidden ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside className={`fixed inset-y-0 left-0 z-50 flex h-full w-[280px] max-w-[86vw] flex-col overflow-hidden border-r border-border bg-background/92 backdrop-blur-md select-none transition-transform duration-300 md:static md:z-auto md:w-[260px] md:max-w-none md:translate-x-0 ${
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      }`}>
      {/* Logo Area */}
      <div className="flex items-center justify-between px-5 py-6 md:px-6 md:py-8">
        <button
          onClick={nav.toDashboard}
          className="group flex items-center gap-2 hover:opacity-80 transition-all duration-300"
        >
          <div className="w-8 h-8 rounded-lg studio-chip-accent flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
            <ScrollText size={18} />
          </div>
          <div className="flex flex-col">
            <span className="font-serif text-xl leading-none italic font-medium">InkOS</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold mt-1">Studio</span>
          </div>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:text-foreground md:hidden"
          aria-label="Close navigation"
        >
          <X size={16} />
        </button>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-6">
        {/* Books Section */}
        <div>
          <div className="px-3 mb-3 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              {t("nav.books")}
            </span>
            <button
              onClick={nav.toCockpit}
              className="p-1 rounded-md studio-icon-btn transition-all group"
              title={t("nav.openCockpit")}
            >
              <Plus size={14} className="group-hover:rotate-90 transition-transform duration-300" />
            </button>
          </div>

          <div className="space-y-1">
            <SidebarItem
              label={t("nav.cockpit")}
              icon={<MessageSquareText size={16} />}
              active={activePage === "cockpit"}
              onClick={() => nav.toCockpit()}
            />

            {(createStatusData?.entries ?? []).map((job) => (
              <div
                key={`create-${job.bookId}`}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                  job.status === "error"
                    ? "border-destructive/30 bg-destructive/6 text-destructive"
                    : "studio-chip-accent"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${job.status === "error" ? "bg-destructive" : "studio-status-dot-ok animate-pulse"}`} />
                  <span className="truncate font-medium">{job.title}</span>
                </div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  {(job.error || job.stage || job.message || t("dash.createRunning")).split("\n")[0]}
                </div>
              </div>
            ))}

            {data?.books.map((book) => (
              <button
                key={book.id}
                onClick={() => nav.toBook(book.id)}
                className={`w-full group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  activePage === `book:${book.id}`
                    ? "studio-chip-accent text-foreground font-semibold"
                    : "studio-chip"
                }`}
              >
                <Book size={16} className={activePage === `book:${book.id}` ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"} />
                <span className="truncate flex-1 text-left">{book.title}</span>
                {book.chaptersWritten > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded studio-chip">
                    {book.chaptersWritten}
                  </span>
                )}
              </button>
            ))}

            {(!data?.books || data.books.length === 0) && (
              <div className="px-3 py-6 text-xs text-muted-foreground/70 italic text-center border border-dashed border-border rounded-lg">
                {t("dash.noBooks")}
              </div>
            )}
          </div>
        </div>

        {/* System Section */}
        <div>
          <div className="px-3 mb-3">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              {t("nav.system")}
            </span>
          </div>
          <div className="space-y-1">
            <SidebarItem
              label={t("create.genre")}
              icon={<Boxes size={16} />}
              active={activePage === "genres"}
              onClick={nav.toGenres}
            />
            <SidebarItem
              label={t("nav.config")}
              icon={<Settings size={16} />}
              active={activePage === "config"}
              onClick={nav.toConfig}
            />
            <SidebarItem
              label={t("nav.daemon")}
              icon={<Zap size={16} />}
              active={activePage === "daemon"}
              onClick={nav.toDaemon}
              badge={daemon?.running ? t("nav.running") : undefined}
              badgeColor={daemon?.running ? "studio-badge-ok" : "studio-badge-soft"}
            />
            <SidebarItem
              label={t("nav.logs")}
              icon={<Terminal size={16} />}
              active={activePage === "logs"}
              onClick={nav.toLogs}
            />
          </div>
        </div>

        {/* Tools Section */}
        <div>
          <div className="px-3 mb-3">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              {t("nav.tools")}
            </span>
          </div>
          <div className="space-y-1">
            <SidebarItem
              label={t("nav.style")}
              icon={<Wand2 size={16} />}
              active={activePage === "style"}
              onClick={nav.toStyle}
            />
            <SidebarItem
              label={t("nav.import")}
              icon={<FileInput size={16} />}
              active={activePage === "import"}
              onClick={nav.toImport}
            />
            <SidebarItem
              label={t("nav.radar")}
              icon={<TrendingUp size={16} />}
              active={activePage === "radar"}
              onClick={nav.toRadar}
            />
            <SidebarItem
              label={t("nav.doctor")}
              icon={<Stethoscope size={16} />}
              active={activePage === "doctor"}
              onClick={nav.toDoctor}
            />
          </div>
        </div>
      </div>

      {/* Footer / Status Area */}
      <div className="p-4 border-t border-border bg-secondary/40">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border shadow-sm">
          <div className={`w-2 h-2 rounded-full ${daemon?.running ? "studio-status-dot-ok" : "bg-muted-foreground/40"}`} />
          <span className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wider">
            {daemon?.running ? t("nav.agentOnline") : t("nav.agentOffline")}
          </span>
        </div>
      </div>
      </aside>
    </>
  );
}

function SidebarItem({ label, icon, active, onClick, badge, badgeColor }: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
        active
          ? "studio-chip-accent text-foreground font-semibold shadow-sm"
          : "text-foreground font-medium studio-chip"
      }`}
    >
      <span className="transition-colors text-foreground">
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {badge && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tight ${badgeColor}`}>
          {badge}
        </span>
      )}
    </button>
  );
}
