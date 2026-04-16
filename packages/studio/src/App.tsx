import { useState, useEffect, useMemo, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatBar";
import { Dashboard } from "./pages/Dashboard";
import { BootstrapView } from "./pages/BootstrapView";
import { BookDetail } from "./pages/BookDetail";
import { BookCreate } from "./pages/BookCreate";
import { ChapterReader } from "./pages/ChapterReader";
import { Analytics } from "./pages/Analytics";
import { ConfigView } from "./pages/ConfigView";
import { TruthFiles } from "./pages/TruthFiles";
import { DaemonControl } from "./pages/DaemonControl";
import { LogViewer } from "./pages/LogViewer";
import { GenreManager } from "./pages/GenreManager";
import { StyleManager } from "./pages/StyleManager";
import { ImportManager } from "./pages/ImportManager";
import { RadarView } from "./pages/RadarView";
import { DoctorView } from "./pages/DoctorView";
import { Cockpit } from "./pages/Cockpit";
import { LanguageSelector } from "./pages/LanguageSelector";
import { useSSE, type SSEMessage } from "./hooks/use-sse";
import { useTheme } from "./hooks/use-theme";
import { useI18n } from "./hooks/use-i18n";
import { postApi, useApi } from "./hooks/use-api";
import { Sun, Moon, Bell, MessageSquare, PanelLeftOpen, SlidersHorizontal } from "lucide-react";
import type { BootstrapSummary } from "./shared/contracts";
import { buildActivityFeedEntries } from "./shared/activity-feed";
import { compactModelLabel, defaultModelForProvider, labelForProvider, shortLabelForProvider } from "./shared/llm";
import type { TruthAssistantContext } from "./shared/truth-assistant";
import { getBrowserStorage, readBrowserJson, writeBrowserJson } from "./shared/browser-storage";

export type Route =
  | { page: "dashboard" }
  | { page: "cockpit"; bookId?: string }
  | { page: "book"; bookId: string }
  | { page: "book-create" }
  | { page: "chapter"; bookId: string; chapterNumber: number }
  | { page: "analytics"; bookId: string }
  | { page: "config" }
  | { page: "truth"; bookId: string }
  | { page: "daemon" }
  | { page: "logs" }
  | { page: "genres" }
  | { page: "style" }
  | { page: "import" }
  | { page: "radar" }
  | { page: "doctor" };

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseRouteFromSearch(search: string): Route | null {
  const params = new URLSearchParams(search);
  const page = params.get("page");
  if (!page) return null;

  switch (page) {
    case "dashboard":
      return { page: "dashboard" };
    case "cockpit": {
      const bookId = params.get("bookId")?.trim();
      return bookId ? { page: "cockpit", bookId } : { page: "cockpit" };
    }
    case "book": {
      const bookId = params.get("bookId")?.trim();
      return bookId ? { page: "book", bookId } : null;
    }
    case "book-create":
      return { page: "book-create" };
    case "chapter": {
      const bookId = params.get("bookId")?.trim();
      const chapterNumber = parsePositiveInteger(params.get("chapter"));
      return bookId && chapterNumber ? { page: "chapter", bookId, chapterNumber } : null;
    }
    case "analytics": {
      const bookId = params.get("bookId")?.trim();
      return bookId ? { page: "analytics", bookId } : null;
    }
    case "config":
      return { page: "config" };
    case "truth": {
      const bookId = params.get("bookId")?.trim();
      return bookId ? { page: "truth", bookId } : null;
    }
    case "daemon":
      return { page: "daemon" };
    case "logs":
      return { page: "logs" };
    case "genres":
      return { page: "genres" };
    case "style":
      return { page: "style" };
    case "import":
      return { page: "import" };
    case "radar":
      return { page: "radar" };
    case "doctor":
      return { page: "doctor" };
    default:
      return null;
  }
}

export function buildRouteSearch(route: Route): string {
  const params = new URLSearchParams();

  switch (route.page) {
    case "dashboard":
      return "";
    case "cockpit":
      params.set("page", "cockpit");
      if (route.bookId) params.set("bookId", route.bookId);
      break;
    case "book":
      params.set("page", "book");
      params.set("bookId", route.bookId);
      break;
    case "book-create":
      params.set("page", "book-create");
      break;
    case "chapter":
      params.set("page", "chapter");
      params.set("bookId", route.bookId);
      params.set("chapter", String(route.chapterNumber));
      break;
    case "analytics":
      params.set("page", "analytics");
      params.set("bookId", route.bookId);
      break;
    case "config":
      params.set("page", "config");
      break;
    case "truth":
      params.set("page", "truth");
      params.set("bookId", route.bookId);
      break;
    case "daemon":
      params.set("page", "daemon");
      break;
    case "logs":
      params.set("page", "logs");
      break;
    case "genres":
      params.set("page", "genres");
      break;
    case "style":
      params.set("page", "style");
      break;
    case "import":
      params.set("page", "import");
      break;
    case "radar":
      params.set("page", "radar");
      break;
    case "doctor":
      params.set("page", "doctor");
      break;
  }

  const searchString = params.toString();
  return searchString ? `?${searchString}` : "";
}

export function deriveActiveBookId(route: Route): string | undefined {
  return route.page === "book"
    || route.page === "chapter"
    || route.page === "truth"
    || route.page === "analytics"
    || route.page === "cockpit"
    ? route.bookId
    : undefined;
}

export function deriveActiveLlm(
  bootstrap?: BootstrapSummary,
  project?: { language: string; languageExplicit: boolean; provider: string; model: string; baseUrl?: string },
): { provider: string; model: string; source: "project" | "global" } | null {
  if (!bootstrap) return null;
  if (bootstrap.projectInitialized && project) {
    return {
      provider: project.provider,
      model: project.model,
      source: "project",
    };
  }
  return {
    provider: bootstrap.globalConfig.provider,
    model: bootstrap.globalConfig.model,
    source: "global",
  };
}

interface AssistantPaneWidths {
  readonly general: number;
  readonly truth: number;
}

const ASSISTANT_PANE_WIDTH_STORAGE_KEY = "inkos:assistant-pane-width:v1";
const DEFAULT_ASSISTANT_PANE_WIDTHS: AssistantPaneWidths = {
  general: 380,
  truth: 540,
};

export function clampAssistantPaneWidth(
  width: number,
  options: {
    readonly truthMode?: boolean;
    readonly viewportWidth?: number;
  } = {},
): number {
  const truthMode = options.truthMode ?? false;
  const viewportWidth = Math.max(480, options.viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1440));
  const minWidth = truthMode ? 420 : 320;
  const preferredMax = truthMode ? 760 : 560;
  const viewportMargin = viewportWidth < 1024 ? 48 : 320;
  const maxWidth = Math.max(minWidth, Math.min(preferredMax, viewportWidth - viewportMargin));
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
}

export function resolveAssistantPaneWidths(
  stored?: Partial<AssistantPaneWidths> | null,
  viewportWidth = 1440,
): AssistantPaneWidths {
  return {
    general: clampAssistantPaneWidth(stored?.general ?? DEFAULT_ASSISTANT_PANE_WIDTHS.general, {
      viewportWidth,
    }),
    truth: clampAssistantPaneWidth(stored?.truth ?? DEFAULT_ASSISTANT_PANE_WIDTHS.truth, {
      truthMode: true,
      viewportWidth,
    }),
  };
}

function isHeaderAlertMessage(message: SSEMessage): boolean {
  return message.event !== "ping"
    && message.event !== "log"
    && message.event !== "llm:progress"
    && message.event !== "radar:progress";
}

export function deriveUnreadAlertCount(messages: ReadonlyArray<SSEMessage>, lastSeenTimestamp: number): number {
  return messages.filter((message) => isHeaderAlertMessage(message) && message.timestamp > lastSeenTimestamp).length;
}

export function deriveLatestAlertTimestamp(messages: ReadonlyArray<SSEMessage>): number {
  return messages
    .filter(isHeaderAlertMessage)
    .reduce((latest, message) => Math.max(latest, message.timestamp), 0);
}

export function App() {
  const [route, setRoute] = useState<Route>(() => {
    if (typeof window === "undefined") {
      return { page: "dashboard" };
    }
    return parseRouteFromSearch(window.location.search) ?? { page: "dashboard" };
  });
  const sse = useSSE();
  const { theme, setTheme } = useTheme();
  const { t, lang } = useI18n();
  const { data: bootstrap, loading: bootstrapLoading, error: bootstrapError, refetch: refetchBootstrap } = useApi<BootstrapSummary>("/bootstrap");
  const { data: project, refetch: refetchProject } = useApi<{
    language: string;
    languageExplicit: boolean;
    provider: string;
    model: string;
    baseUrl: string;
  }>("/project");
  const { data: activityData, refetch: refetchActivity } = useApi<{ entries: ReadonlyArray<SSEMessage> }>("/activity");
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  const [ready, setReady] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [assistantPaneWidths, setAssistantPaneWidths] = useState<AssistantPaneWidths>(() => resolveAssistantPaneWidths(
    readBrowserJson<Partial<AssistantPaneWidths>>(getBrowserStorage(), ASSISTANT_PANE_WIDTH_STORAGE_KEY),
  ));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextSearch = buildRouteSearch(route);
    if (window.location.search === nextSearch) {
      return;
    }

    window.history.replaceState(null, "", `${window.location.pathname}${nextSearch}${window.location.hash}`);
  }, [route]);
  const [assistantResizing, setAssistantResizing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [lastSeenAlertAt, setLastSeenAlertAt] = useState(0);
  const [truthAssistantContext, setTruthAssistantContext] = useState<TruthAssistantContext | null>(null);
  const alertPopoverRef = useRef<HTMLDivElement | null>(null);
  const assistantResizeCleanupRef = useRef<(() => void) | null>(null);

  const isDark = theme === "dark";
  const unreadAlertCount = useMemo(() => deriveUnreadAlertCount(sse.messages, lastSeenAlertAt), [lastSeenAlertAt, sse.messages]);
  const latestAlertTimestamp = useMemo(() => deriveLatestAlertTimestamp(sse.messages), [sse.messages]);
  const alertEntries = useMemo(
    () => buildActivityFeedEntries(activityData?.entries ?? sse.messages)
      .filter((entry) => isHeaderAlertMessage({ event: entry.event, data: null, timestamp: entry.timestamp }))
      .slice(0, 6),
    [activityData?.entries, sse.messages],
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (!bootstrapLoading && bootstrap && !bootstrap.projectInitialized) {
      setReady(true);
      setShowLanguageSelector(false);
      return;
    }
    if (bootstrap?.projectInitialized && !project) {
      setReady(false);
      return;
    }
    if (project) {
      if (!project.languageExplicit) {
        setShowLanguageSelector(true);
      }
      setReady(true);
    }
  }, [bootstrap, bootstrapLoading, project]);

  useEffect(() => {
    if (route.page !== "logs" || latestAlertTimestamp === 0) return;
    setLastSeenAlertAt((current) => Math.max(current, latestAlertTimestamp));
  }, [latestAlertTimestamp, route.page]);

  useEffect(() => {
    setAlertOpen(false);
  }, [route.page]);

  useEffect(() => {
    if (route.page !== "truth") {
      setTruthAssistantContext(null);
    }
  }, [route.page]);

  useEffect(() => {
    writeBrowserJson(getBrowserStorage(), ASSISTANT_PANE_WIDTH_STORAGE_KEY, assistantPaneWidths);
  }, [assistantPaneWidths]);

  const stopAssistantResizing = () => {
    assistantResizeCleanupRef.current?.();
    assistantResizeCleanupRef.current = null;
  };

  useEffect(() => {
    if (!chatOpen && assistantResizing) {
      stopAssistantResizing();
    }
  }, [assistantResizing, chatOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = () => {
      setAssistantPaneWidths((current) => {
        const next = resolveAssistantPaneWidths(current, window.innerWidth);
        return next.general === current.general && next.truth === current.truth ? current : next;
      });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    return () => {
      stopAssistantResizing();
    };
  }, []);

  useEffect(() => {
    if (!sse.messages.length) return;
    void refetchActivity();
  }, [refetchActivity, sse.messages]);

  useEffect(() => {
    if (!alertOpen || latestAlertTimestamp === 0) return;
    setLastSeenAlertAt((current) => Math.max(current, latestAlertTimestamp));
  }, [alertOpen, latestAlertTimestamp]);

  useEffect(() => {
    if (!alertOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!alertPopoverRef.current) return;
      if (alertPopoverRef.current.contains(event.target as Node)) return;
      setAlertOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAlertOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [alertOpen]);

  const assistantPaneMode = route.page === "truth" ? "truth" : "general";

  const handleAssistantResizeStart = (clientX: number) => {
    if (typeof window === "undefined") {
      return;
    }

    stopAssistantResizing();

    const truthMode = assistantPaneMode === "truth";
    const handlePointerMove = (event: MouseEvent) => {
      setAssistantPaneWidths((current) => {
        const nextWidth = clampAssistantPaneWidth(window.innerWidth - event.clientX, {
          truthMode,
          viewportWidth: window.innerWidth,
        });
        if (nextWidth === current[assistantPaneMode]) {
          return current;
        }
        return {
          ...current,
          [assistantPaneMode]: nextWidth,
        };
      });
    };
    const cleanup = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", stopAssistantResizing);
      assistantResizeCleanupRef.current = null;
      setAssistantResizing(false);
    };

    assistantResizeCleanupRef.current = cleanup;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", stopAssistantResizing);

    setAssistantPaneWidths((current) => ({
      ...current,
      [assistantPaneMode]: clampAssistantPaneWidth(window.innerWidth - clientX, {
        truthMode: assistantPaneMode === "truth",
        viewportWidth: window.innerWidth,
      }),
    }));
    setAssistantResizing(true);
  };

  const handleAssistantResizeNudge = (delta: number) => {
    if (typeof window === "undefined") {
      return;
    }

    setAssistantPaneWidths((current) => ({
      ...current,
      [assistantPaneMode]: clampAssistantPaneWidth(current[assistantPaneMode] + delta, {
        truthMode: assistantPaneMode === "truth",
        viewportWidth: window.innerWidth,
      }),
    }));
  };

  const nav = {
    toDashboard: () => {
      setRoute({ page: "dashboard" });
      setSidebarOpen(false);
    },
    toBook: (bookId: string) => {
      setRoute({ page: "book", bookId });
      setSidebarOpen(false);
    },
    toBookCreate: () => {
      setRoute({ page: "book-create" });
      setSidebarOpen(false);
    },
    toCockpit: (bookId?: string) => {
      setRoute(bookId ? { page: "cockpit", bookId } : { page: "cockpit" });
      setChatOpen(false);
      setSidebarOpen(false);
    },
    toChapter: (bookId: string, chapterNumber: number) => {
      setRoute({ page: "chapter", bookId, chapterNumber });
      setSidebarOpen(false);
    },
    toAnalytics: (bookId: string) => {
      setRoute({ page: "analytics", bookId });
      setSidebarOpen(false);
    },
    toConfig: () => {
      setRoute({ page: "config" });
      setSidebarOpen(false);
    },
    toTruth: (bookId: string) => {
      setRoute({ page: "truth", bookId });
      setSidebarOpen(false);
    },
    toDaemon: () => {
      setRoute({ page: "daemon" });
      setSidebarOpen(false);
    },
    toLogs: () => {
      setRoute({ page: "logs" });
      setSidebarOpen(false);
    },
    toGenres: () => {
      setRoute({ page: "genres" });
      setSidebarOpen(false);
    },
    toStyle: () => {
      setRoute({ page: "style" });
      setSidebarOpen(false);
    },
    toImport: () => {
      setRoute({ page: "import" });
      setSidebarOpen(false);
    },
    toRadar: () => {
      setRoute({ page: "radar" });
      setSidebarOpen(false);
    },
    toDoctor: () => {
      setRoute({ page: "doctor" });
      setSidebarOpen(false);
    },
  };

  const activeBookId = deriveActiveBookId(route);
  const activePage =
    route.page === "cockpit"
      ? "cockpit"
      : activeBookId
        ? `book:${activeBookId}`
        : route.page;
  const assistantPaneWidth = clampAssistantPaneWidth(assistantPaneWidths[assistantPaneMode], {
    truthMode: assistantPaneMode === "truth",
    viewportWidth: typeof window !== "undefined" ? window.innerWidth : 1440,
  });
  const contentWidthClass = route.page === "cockpit"
    ? "max-w-none"
    : route.page === "config"
      ? "max-w-6xl"
      : route.page === "truth"
        ? "max-w-7xl"
        : "max-w-5xl";
  const activeLlm = deriveActiveLlm(bootstrap ?? undefined, project ?? undefined);
  const activeLlmAuthMissing = activeLlm
    ? activeLlm.provider === "gemini-cli"
      ? !bootstrap?.globalConfig.auth.geminiCli.authenticated
      : activeLlm.provider === "codex-cli"
        ? !bootstrap?.globalConfig.auth.codexCli.authenticated
        : false
    : false;

  if (bootstrapError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-8 text-center text-destructive">
        {bootstrapError}
      </div>
    );
  }

  if (!ready || bootstrapLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-border/30 border-t-ring rounded-full animate-spin" />
      </div>
    );
  }

  if (bootstrap && !bootstrap.projectInitialized) {
    return (
      <BootstrapView
        bootstrap={bootstrap}
        theme={theme}
        t={t}
        onInitialized={() => {
          refetchBootstrap();
          refetchProject();
        }}
      />
    );
  }

  if (showLanguageSelector) {
    return (
      <LanguageSelector
        onSelect={async (lang) => {
          await postApi("/project/language", { language: lang });
          setShowLanguageSelector(false);
          refetchProject();
        }}
      />
    );
  }

  return (
    <div className="h-screen bg-background text-foreground flex overflow-hidden font-sans">
      {/* Left Sidebar */}
      <Sidebar
        nav={nav}
        activePage={activePage}
        sse={sse}
        t={t}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Center Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/30 backdrop-blur-sm">
        {/* Header Strip */}
        <header className="h-14 shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 md:px-8 border-b border-border/40">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-secondary/60 text-muted-foreground transition-colors hover:text-foreground md:hidden"
              aria-label="Open navigation"
            >
              <PanelLeftOpen size={16} />
            </button>
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
               InkOS Studio
             </span>
          </div>

          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {activeLlm && (
              <button
                onClick={nav.toConfig}
                className={`min-w-0 max-w-[8.25rem] rounded-full px-2 py-1.5 text-left transition-all sm:max-w-[10.75rem] ${
                  route.page === "config"
                    ? "studio-header-pill active"
                    : "studio-header-pill"
                }`}
                title={`${t("app.llmSettings")} · ${labelForProvider(activeLlm.provider)} · ${activeLlm.model || defaultModelForProvider(activeLlm.provider) || "-"}`}
                aria-label={t("app.llmSettings")}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${activeLlmAuthMissing ? "studio-status-dot-warn" : "studio-status-dot-ok"}`} />
                  <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {shortLabelForProvider(activeLlm.provider)}
                  </span>
                  <span className="truncate text-[10px] font-medium text-foreground/85 sm:text-[11px]">
                    {activeLlmAuthMissing
                      ? t("app.loginRequired")
                      : compactModelLabel(activeLlm.provider, activeLlm.model || defaultModelForProvider(activeLlm.provider) || "-")}
                  </span>
                  <SlidersHorizontal size={11} className="ml-auto shrink-0 text-muted-foreground/70" />
                </div>
              </button>
            )}

            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="w-8 h-8 flex items-center justify-center rounded-lg studio-icon-btn"
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <div className="relative hidden sm:block" ref={alertPopoverRef}>
              <button
                type="button"
                onClick={() => setAlertOpen((current) => !current)}
                className={`relative flex h-8 min-w-8 items-center justify-center rounded-lg transition-all studio-icon-btn ${
                  alertOpen
                    ? "active"
                    : "hover:scale-[1.02]"
                }`}
                title={unreadAlertCount > 0 ? `${t("app.alerts")} · ${unreadAlertCount}` : t("app.alerts")}
                aria-label={unreadAlertCount > 0 ? `${t("app.alerts")} (${unreadAlertCount})` : t("app.alerts")}
                aria-expanded={alertOpen}
                aria-haspopup="dialog"
              >
                <Bell size={16} />
                {unreadAlertCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full studio-chip-accent px-1 text-[10px] font-semibold leading-none shadow-sm">
                    {unreadAlertCount > 9 ? "9+" : unreadAlertCount}
                  </span>
                )}
              </button>

              {alertOpen && (
                  <div className="absolute right-0 top-[calc(100%+0.6rem)] z-40 w-[23rem] overflow-hidden rounded-2xl border border-border/70 bg-background/96 shadow-2xl shadow-black/10 backdrop-blur-xl">
                  <div className="border-b border-border/50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{t("app.alerts")}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{t("app.alertsHint")}</div>
                      </div>
                      {unreadAlertCount > 0 && (
                        <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
                          {unreadAlertCount > 9 ? "9+" : unreadAlertCount}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="max-h-[24rem] overflow-y-auto px-3 py-3">
                    {alertEntries.length > 0 ? (
                      <div className="space-y-2">
                        {alertEntries.map((entry) => (
                          <div key={entry.id} className="rounded-xl border border-border/50 bg-secondary/30 px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                {entry.label}
                              </div>
                              <div className="shrink-0 text-[11px] text-muted-foreground">
                                {new Date(entry.timestamp).toLocaleTimeString()}
                              </div>
                            </div>
                            {entry.detail && (
                              <div className="mt-2 text-sm leading-6 text-foreground/85 break-words">
                                {entry.detail}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border/50 px-3 py-8 text-center text-sm italic text-muted-foreground">
                        {t("app.alertsEmpty")}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-border/50 px-3 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setAlertOpen(false);
                        nav.toLogs();
                      }}
                      className="w-full rounded-xl studio-chip border border-border/50 px-3 py-2.5 text-sm font-medium text-foreground"
                    >
                      {t("app.openLogs")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Panel Toggle */}
            {route.page !== "cockpit" && (
              <button
                onClick={() => setChatOpen((prev) => !prev)}
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all studio-icon-btn ${
                  chatOpen
                    ? "active"
                    : "hover:scale-[1.02]"
                }`}
                title="Toggle AI Assistant"
                aria-label="Toggle AI Assistant"
                aria-controls="inkos-assistant-panel"
                aria-expanded={chatOpen}
              >
                <MessageSquare size={16} />
              </button>
            )}
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto scroll-smooth">
          <div className={`${contentWidthClass} mx-auto px-4 py-8 sm:px-6 sm:py-10 md:px-12 lg:py-16 fade-in`}>
            {route.page === "dashboard" && <Dashboard nav={nav} sse={sse} theme={theme} t={t} />}
            {route.page === "cockpit" && <Cockpit nav={nav} theme={theme} t={t} sse={sse} initialBookId={route.bookId} />}
            {route.page === "book" && <BookDetail bookId={route.bookId} nav={nav} theme={theme} t={t} sse={sse} />}
            {route.page === "book-create" && <BookCreate nav={nav} theme={theme} t={t} />}
            {route.page === "chapter" && <ChapterReader bookId={route.bookId} chapterNumber={route.chapterNumber} nav={nav} theme={theme} t={t} />}
            {route.page === "analytics" && <Analytics bookId={route.bookId} nav={nav} theme={theme} t={t} />}
            {route.page === "config" && <ConfigView nav={nav} theme={theme} t={t} />}
            {route.page === "truth" && (
              <TruthFiles
                bookId={route.bookId}
                nav={nav}
                theme={theme}
                t={t}
                onAssistantContextChange={setTruthAssistantContext}
              />
            )}
            {route.page === "daemon" && <DaemonControl nav={nav} theme={theme} t={t} sse={sse} />}
            {route.page === "logs" && <LogViewer nav={nav} theme={theme} t={t} sse={sse} />}
            {route.page === "genres" && <GenreManager nav={nav} theme={theme} t={t} />}
            {route.page === "style" && <StyleManager nav={nav} theme={theme} t={t} />}
            {route.page === "import" && <ImportManager nav={nav} theme={theme} t={t} />}
            {route.page === "radar" && <RadarView nav={nav} theme={theme} t={t} sse={sse} />}
            {route.page === "doctor" && <DoctorView nav={nav} theme={theme} t={t} />}
          </div>
        </main>
      </div>

      {/* Right Chat Panel */}
      {route.page !== "cockpit" && (
        <ChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          onOpenConfig={nav.toConfig}
          t={t}
          sse={sse}
          activeBookId={activeBookId}
          truthContext={route.page === "truth" ? truthAssistantContext : null}
          width={assistantPaneWidth}
          isResizing={assistantResizing}
          onResizeStart={handleAssistantResizeStart}
          onResizeNudge={handleAssistantResizeNudge}
        />
      )}
    </div>
  );
}
