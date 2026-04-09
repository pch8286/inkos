import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, Clock3, Database, FileText, History, Loader2, Radio, Target, TrendingUp } from "lucide-react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { fetchJson, useApi } from "../hooks/use-api";
import type { SSEMessage } from "../hooks/use-sse";
import type { RadarFitCheckMetadata, RadarHistoryEntry, RadarHistorySummary, RadarMode, RadarResult, RadarStatusSummary } from "../shared/contracts";
import { buildActivityFeedEntries } from "../shared/activity-feed";

interface Nav {
  toDashboard: () => void;
}

type ProjectLanguage = "ko" | "en" | "zh";

interface RadarBookOption {
  readonly id: string;
  readonly title: string;
}

interface FitCheckPreviewResponse {
  readonly mode: RadarMode;
  readonly context?: string | null;
  readonly metadata?: {
    readonly bookId: string;
    readonly bookTitle: string;
    readonly sourceFiles: ReadonlyArray<string>;
    readonly contextPreview: string;
    readonly contextLength: number;
    readonly note: string | null;
  } | null;
}

function resolveProjectLanguage(language: string | undefined): ProjectLanguage {
  if (language === "en") return "en";
  if (language === "zh") return "zh";
  return "ko";
}

function normalizeRadarFailureMessage(raw: string, language: ProjectLanguage): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || language !== "ko") return trimmed;

  if (/API 返回 400|API returned 400|400 \(invalid request|400 \(bad request/i.test(trimmed)) {
    return "요청 파라미터 오류(400)로 스캔이 실패했습니다. 모델명, max_tokens, stream, 메시지 형식 지원 여부를 확인해 주세요.";
  }
  if (/API 返回 401|API returned 401|401 \(unauthorized/i.test(trimmed)) {
    return "인증 실패(401)로 스캔이 중단되었습니다. API 키와 인증 설정을 확인해 주세요.";
  }
  if (/API 返回 403|API returned 403|403 \(forbidden/i.test(trimmed)) {
    return "요청이 거부(403)되어 스캔이 실패했습니다. 제공자 권한/네트워크/검열 정책을 점검해 주세요.";
  }
  if (/API 返回 429|API returned 429|429 \(too many requests/i.test(trimmed)) {
    return "요청이 너무 잦아(429) 스캔이 일시적으로 실패했습니다. 잠시 뒤 재시도해 주세요.";
  }
  if (/无法连接到 API 服务|Could not connect to the API service|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(trimmed)) {
    return "API 연결 실패가 발생했습니다. baseUrl, 네트워크, 방화벽 설정을 확인해 주세요.";
  }
  if (/API 提供方要求使用流式请求|provider requires streaming|stream must be set to true/i.test(trimmed)) {
    return "제공자가 스트리밍(stream=true) 모드를 요구합니다. 관련 설정을 켜서 다시 시도해 주세요.";
  }
  if (/[\u4e00-\u9fff]/.test(trimmed)) {
    return "레이더 스캔에서 제공자 응답 처리에 실패했습니다. 스캔 설정과 모델/요청 파라미터를 점검해 주세요.";
  }

  return trimmed;
}

function radarStatusTone(status: RadarStatusSummary["status"] | RadarHistoryEntry["status"]): string {
  if (status === "succeeded") return "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300";
  if (status === "failed") return "border-destructive/30 bg-destructive/8 text-destructive";
  if (status === "running") return "studio-surface-active";
  return "border-border/50 bg-background/70 text-muted-foreground";
}

function radarStatusIcon(status: RadarStatusSummary["status"] | RadarHistoryEntry["status"]) {
  if (status === "succeeded") return <CheckCircle2 size={14} />;
  if (status === "failed") return <AlertTriangle size={14} />;
  if (status === "running") return <Loader2 size={14} className="animate-spin" />;
  return <Clock3 size={14} />;
}

function radarStatusLabel(status: RadarStatusSummary["status"], t: TFunction): string {
  if (status === "running") return t("radar.statusRunning");
  if (status === "succeeded") return t("radar.statusSucceeded");
  if (status === "failed") return t("radar.statusFailed");
  return t("radar.statusIdle");
}

function radarModeLabel(mode: RadarMode, t: TFunction): string {
  if (mode === "idea-mining") return t("radar.modeIdeaMining");
  if (mode === "fit-check") return t("radar.modeFitCheck");
  return t("radar.modeMarketTrends");
}

function savedStatusLabel(status: RadarHistoryEntry["status"], t: TFunction): string {
  if (status === "succeeded") return t("radar.statusSucceeded");
  return t("radar.statusFailed");
}

function formatRadarTimestamp(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function summarizeSavedScan(entry: RadarHistoryEntry, language: ProjectLanguage): string {
  const text = entry.result?.marketSummary?.trim() || entry.error?.trim() || "";
  if (!text) return "";
  const normalized = normalizeRadarFailureMessage(text, language);
  return normalized.length > 140 ? `${normalized.slice(0, 140).trimEnd()}...` : normalized;
}

function describeModel(entry: RadarHistoryEntry): string {
  if (entry.provider && entry.model) return `${entry.provider} / ${entry.model}`;
  if (entry.model) return entry.model;
  if (entry.provider) return entry.provider;
  return "-";
}

function resolveDisplayedFitCheckMetadata(
  status: RadarStatusSummary | null | undefined,
  selectedSavedScan: RadarHistoryEntry | null,
): RadarFitCheckMetadata | null {
  if (selectedSavedScan) {
    return selectedSavedScan.mode === "fit-check" ? selectedSavedScan.fitCheckMetadata ?? null : null;
  }
  return status?.mode === "fit-check" ? status.fitCheckMetadata ?? null : null;
}

export function RadarView({
  nav,
  theme,
  t,
  sse,
}: {
  nav: Nav;
  theme: Theme;
  t: TFunction;
  sse: { messages: ReadonlyArray<SSEMessage> };
}) {
  const { data: projectData } = useApi<{ language: string }>("/project");
  const normalizedLanguage = resolveProjectLanguage(projectData?.language);
  const c = useColors(theme);
  const { data: status, loading: statusLoading, refetch } = useApi<RadarStatusSummary>("/radar/status");
  const { data: historyData, refetch: refetchHistory } = useApi<RadarHistorySummary>("/radar/history");
  const { data: activityData, refetch: refetchActivity } = useApi<{ entries: ReadonlyArray<SSEMessage> }>("/activity");
  const { data: projectBooksData } = useApi<{ books: ReadonlyArray<RadarBookOption> }>("/books");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [selectedMode, setSelectedMode] = useState<RadarMode>("market-trends");
  const [selectedScanId, setSelectedScanId] = useState("");
  const [selectedFitCheckBookId, setSelectedFitCheckBookId] = useState("");
  const [fitCheckNote, setFitCheckNote] = useState("");
  const [fitCheckNoteForPreview, setFitCheckNoteForPreview] = useState("");
  const [fitCheckContextPreview, setFitCheckContextPreview] = useState("");
  const [fitCheckContextFiles, setFitCheckContextFiles] = useState<ReadonlyArray<string>>([]);
  const [fitCheckContextLoading, setFitCheckContextLoading] = useState(false);
  const [fitCheckContextError, setFitCheckContextError] = useState("");
  const [fitCheckLoadedBookContext, setFitCheckLoadedBookContext] = useState(false);

  const history = historyData?.scans ?? [];
  const selectedSavedScan = useMemo(
    () => history.find((entry) => entry.id === selectedScanId) ?? history[0] ?? null,
    [history, selectedScanId],
  );
  const selectedModeLabel = radarModeLabel(status?.mode ?? "market-trends", t);

  const activityEntries = useMemo(
    () => buildActivityFeedEntries(activityData?.entries ?? sse.messages, { includeProgress: true })
      .filter((entry) => entry.event.startsWith("radar:"))
      .slice(0, 8),
    [activityData?.entries, sse.messages],
  );

  const displayedResult: RadarResult | null = selectedSavedScan?.result ?? status?.result ?? null;
  const displayedMode = selectedSavedScan ? "saved" : status?.result ? "current" : null;
  const displayedError = !displayedResult
    ? (selectedSavedScan?.error ?? (status?.status === "failed" ? status.error : ""))
    : "";
  const fitCheckBooks = projectBooksData?.books ?? [];
  const selectedFitCheckBook = fitCheckBooks.find((book) => book.id === selectedFitCheckBookId);
  const displayedFitCheckMetadata = resolveDisplayedFitCheckMetadata(status, selectedSavedScan);
  const statusFitCheckMetadata = status?.mode === "fit-check" ? status.fitCheckMetadata ?? null : null;

  const normalizedError = normalizeRadarFailureMessage(error, normalizedLanguage);
  const normalizedStatusError = status?.error
    ? normalizeRadarFailureMessage(status.error, normalizedLanguage)
    : "";
  const normalizedDisplayError = displayedError
    ? normalizeRadarFailureMessage(displayedError, normalizedLanguage)
    : "";
  const isFitCheckScanDisabled = selectedMode === "fit-check" && !selectedFitCheckBookId;

  useEffect(() => {
    if (selectedMode !== "fit-check") return;

    if (!fitCheckBooks.length) {
      setSelectedFitCheckBookId("");
      return;
    }

    setSelectedFitCheckBookId((currentBookId) => {
      if (currentBookId && fitCheckBooks.some((book) => book.id === currentBookId)) {
        return currentBookId;
      }
      return fitCheckBooks[0].id;
    });
  }, [selectedMode, fitCheckBooks]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFitCheckNoteForPreview(fitCheckNote);
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [fitCheckNote]);

  useEffect(() => {
    if (selectedMode !== "fit-check" || !selectedFitCheckBookId) {
      setFitCheckContextPreview("");
      setFitCheckContextFiles([]);
      setFitCheckContextLoading(false);
      setFitCheckContextError("");
      setFitCheckLoadedBookContext(false);
      return;
    }

    let cancelled = false;
    setFitCheckContextLoading(true);
    setFitCheckContextError("");
    setFitCheckLoadedBookContext(false);
    setFitCheckContextFiles([]);
    setFitCheckContextPreview("");

    const previewFitCheck = async () => {
      try {
        const preview = await fetchJson<FitCheckPreviewResponse>("/radar/fit-check/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "fit-check",
            bookId: selectedFitCheckBookId,
            context: fitCheckNoteForPreview.trim() || "",
          }),
        });

        if (cancelled) return;

        setFitCheckContextPreview(preview.context ?? "");
        setFitCheckContextFiles(Array.isArray(preview.metadata?.sourceFiles) ? preview.metadata.sourceFiles : []);
        setFitCheckContextError("");
        setFitCheckLoadedBookContext(true);
      } catch (contextError) {
        if (cancelled) return;
        setFitCheckContextError(contextError instanceof Error ? contextError.message : String(contextError));
        setFitCheckContextPreview("");
        setFitCheckContextFiles([]);
        setFitCheckLoadedBookContext(true);
      } finally {
        if (!cancelled) setFitCheckContextLoading(false);
      }
    };

    void previewFitCheck();

    return () => {
      cancelled = true;
    };
  }, [selectedMode, selectedFitCheckBookId, fitCheckNoteForPreview]);

  useEffect(() => {
    if (selectedMode !== "fit-check") {
      setFitCheckNote("");
    }
  }, [selectedMode]);

  useEffect(() => {
    if (!history.length) {
      setSelectedScanId("");
      return;
    }
    setSelectedScanId((current) => (history.some((entry) => entry.id === current) ? current : history[0].id));
  }, [history]);

  useEffect(() => {
    if (!sse.messages.length) return;
    void refetchActivity();
  }, [refetchActivity, sse.messages]);

  useEffect(() => {
    const latest = sse.messages.at(-1);
    if (!latest) return;
    if (
      latest.event === "radar:start"
      || latest.event === "radar:progress"
      || latest.event === "radar:complete"
      || latest.event === "radar:error"
      || latest.event === "radar:saved"
      || latest.event === "radar:save:error"
    ) {
      void refetch();
      void refetchHistory();
      void refetchActivity();
    }
  }, [refetch, refetchActivity, refetchHistory, sse.messages]);

  useEffect(() => {
    if (status?.status !== "running") return;
    const timer = window.setInterval(() => {
      void refetch();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [refetch, status?.status]);

  const handleScan = async () => {
    setStarting(true);
    setError("");
    const scanPayload: { mode: RadarMode; context?: string; bookId?: string } = {
      mode: selectedMode,
    };

    if (selectedMode === "fit-check" && selectedFitCheckBookId) {
      const trimmedNote = fitCheckNote.trim();
      if (trimmedNote) {
        scanPayload.context = trimmedNote;
      }
      scanPayload.bookId = selectedFitCheckBookId;
    }

    try {
      await fetchJson("/radar/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scanPayload),
      });
      await Promise.all([refetch(), refetchHistory(), refetchActivity()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("nav.radar")}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl flex items-center gap-3">
            <TrendingUp size={28} className="text-[color:var(--studio-state-text)]" />
            {t("radar.title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("radar.historyHint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="radarMode" className="text-xs text-muted-foreground">
            {t("radar.mode")}
          </label>
          <select
            id="radarMode"
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value as RadarMode)}
            className="rounded-lg border border-border/60 bg-background px-2.5 py-2 text-sm"
          >
            <option value="market-trends">{t("radar.modeMarketTrends")}</option>
            <option value="idea-mining">{t("radar.modeIdeaMining")}</option>
            <option value="fit-check">{t("radar.modeFitCheck")}</option>
          </select>
          <button
            onClick={handleScan}
            disabled={starting || status?.status === "running" || isFitCheckScanDisabled}
            className={`px-5 py-2.5 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30 flex items-center gap-2`}
          >
            {starting || status?.status === "running" ? <Loader2 size={14} className="animate-spin" /> : <Target size={14} />}
            {starting || status?.status === "running" ? t("radar.scanning") : t("radar.scan")}
          </button>
        </div>
      </div>

      {selectedMode === "fit-check" && (
        <section className={`border ${c.cardStatic} rounded-2xl p-5 space-y-4`}>
          <div className="flex items-start gap-2">
            <BookOpen size={16} className="mt-0.5 text-[color:var(--studio-state-text)]" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t("radar.fitCheckTitle")}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("radar.fitCheckHelp")}</p>
            </div>
          </div>

          <div className="grid gap-2">
            <label htmlFor="fitCheckBook" className="text-xs font-semibold text-muted-foreground">
              {t("radar.fitCheckBook")}
            </label>
            <select
              id="fitCheckBook"
              value={selectedFitCheckBookId}
              onChange={(e) => setSelectedFitCheckBookId(e.target.value)}
              className="rounded-lg border border-border/60 bg-background px-2.5 py-2 text-sm"
            >
              {fitCheckBooks.length === 0 && <option value="">{t("radar.fitCheckNoBooks")}</option>}
              {fitCheckBooks.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.title}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <label htmlFor="fitCheckNote" className="text-xs font-semibold text-muted-foreground">
              {t("radar.fitCheckExtraAngle")}
            </label>
            <textarea
              id="fitCheckNote"
              value={fitCheckNote}
              onChange={(e) => setFitCheckNote(e.target.value)}
              placeholder={t("radar.fitCheckExtraAnglePlaceholder")}
              className={`${c.input} min-h-[84px] text-sm`}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileText size={16} className="text-[color:var(--studio-state-text)]" />
              <span>{t("radar.fitCheckContextPreview")}</span>
            </div>
            <div className="rounded-xl border border-border/50 bg-background/72 p-3">
              <p className="text-xs text-muted-foreground">
                {fitCheckBooks.length === 0
                  ? t("radar.fitCheckNoBooksHint")
                  : fitCheckContextLoading
                    ? t("radar.fitCheckContextLoading")
                    : fitCheckContextError
                      ? `${t("radar.fitCheckContextError")}: ${fitCheckContextError}`
                      : fitCheckContextPreview
                        ? ""
                        : fitCheckLoadedBookContext
                          ? t("radar.fitCheckContextEmpty")
                          : t("radar.fitCheckContextBuilding")}
              </p>
              {fitCheckContextError && (
                <div className="mt-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                  {t("radar.fitCheckContextError")}
                </div>
              )}
              {fitCheckContextPreview && (
                <pre className="mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-foreground/85">
                  {fitCheckContextPreview}
                </pre>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {fitCheckContextFiles.length > 0
                ? `${t("radar.fitCheckContextSources")}: ${fitCheckContextFiles.join(", ")}`
                : t("radar.fitCheckContextNoSources")}
            </p>
            {selectedFitCheckBook && (
              <p className="text-[11px] text-muted-foreground">
                {t("radar.fitCheckBookHint").replace("{title}", selectedFitCheckBook.title)}
              </p>
            )}
          </div>
        </section>
      )}

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">
          <div className="font-medium">{`${t("radar.errorPrefix")}${normalizedError}`}</div>
          <div className="mt-1 text-xs text-destructive/90">{t("radar.failureHint")}</div>
        </div>
      )}

      {status && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(19rem,0.92fr)]">
          <div className={`rounded-2xl border p-5 ${radarStatusTone(status.status)}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {radarStatusIcon(status.status)}
                {radarStatusLabel(status.status, t)}
              </div>
              {status.startedAt && (
                <div className="text-xs text-muted-foreground">
                  {formatRadarTimestamp(status.startedAt)}
                </div>
              )}
            </div>
            <p className="mt-3 text-sm leading-6 text-foreground/85">
              {status.status === "running" ? t("radar.backgroundHint") : t("radar.statusHint")}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border/40 bg-background/72 px-3 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t("radar.mode")}</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{selectedModeLabel}</div>
              </div>
              <div className="rounded-xl border border-border/40 bg-background/72 px-3 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t("radar.progressElapsed")}</div>
                <div className="mt-1 text-lg font-semibold text-foreground">
                  {status.progress ? `${Math.max(0, Math.round(status.progress.elapsedMs / 100) / 10)}s` : "-"}
                </div>
              </div>
                <div className="rounded-xl border border-border/40 bg-background/72 px-3 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t("radar.progressChars")}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {status.progress ? status.progress.totalChars.toLocaleString() : "-"}
                  </div>
                </div>
              </div>
            {status.error && (
              <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/6 px-3 py-3 text-sm text-destructive">
                {`${t("radar.errorPrefix")}${normalizedStatusError}`}
              </div>
            )}
            {statusFitCheckMetadata && (
              <div className="mt-4 rounded-xl border border-border/40 bg-background/72 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t("radar.fitCheckInputSummary")}</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("radar.fitCheckBook")}</div>
                    <div className="mt-1 text-sm font-medium text-foreground">{statusFitCheckMetadata.bookTitle}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("radar.fitCheckContextLength")}</div>
                    <div className="mt-1 text-sm font-medium text-foreground">{statusFitCheckMetadata.contextLength.toLocaleString()}</div>
                  </div>
                </div>
                <div className="mt-3 text-sm text-muted-foreground">
                  {statusFitCheckMetadata.sourceFiles.length > 0
                    ? `${t("radar.fitCheckContextSources")}: ${statusFitCheckMetadata.sourceFiles.join(", ")}`
                    : t("radar.fitCheckContextNoSources")}
                </div>
                {statusFitCheckMetadata.note && (
                  <div className="mt-3 rounded-lg border border-border/40 bg-background px-3 py-3 text-sm text-foreground/85">
                    <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("radar.fitCheckExtraAngle")}</div>
                    <div className="mt-2 whitespace-pre-wrap break-words leading-6">{statusFitCheckMetadata.note}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={`border ${c.cardStatic} rounded-2xl p-5`}>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Radio size={16} className="text-[color:var(--studio-state-text)]" />
              {t("radar.recentActivity")}
            </div>
            <div className="mt-4 space-y-3">
              {activityEntries.length > 0 ? activityEntries.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-border/40 bg-background/72 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{entry.label}</div>
                    <div className="text-[11px] text-muted-foreground">{new Date(entry.timestamp).toLocaleTimeString()}</div>
                  </div>
                  {entry.detail && (
                    <div className="mt-2 text-sm leading-6 text-foreground/85 break-words">{entry.detail}</div>
                  )}
                </div>
              )) : (
                <div className="rounded-xl border border-dashed border-border/50 px-3 py-8 text-center text-sm italic text-muted-foreground">
                  {t("radar.activityEmpty")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.88fr)_minmax(0,1.12fr)]">
        <div className={`border ${c.cardStatic} rounded-2xl overflow-hidden`}>
          <div className="border-b border-border/40 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <History size={16} className="text-[color:var(--studio-state-text)]" />
              {t("radar.history")}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("radar.historyHint")}</p>
          </div>
          <div className="max-h-[640px] space-y-3 overflow-y-auto p-4">
            {history.length > 0 ? history.map((entry, index) => {
              const selected = entry.id === selectedSavedScan?.id;
              const snippet = summarizeSavedScan(entry, normalizedLanguage);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelectedScanId(entry.id)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${selected ? "studio-surface-active" : "border-border/40 bg-background/72 studio-surface-hover"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${radarStatusTone(entry.status)}`}>
                      {radarStatusIcon(entry.status)}
                      {savedStatusLabel(entry.status, t)}
                    </div>
                    {index === 0 && (
                      <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-secondary-foreground">
                        {t("radar.latestSaved")}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 space-y-2">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("radar.savedAt")}</div>
                      <div className="mt-1 text-sm font-medium text-foreground">{formatRadarTimestamp(entry.savedAt)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("radar.mode")}</div>
                      <div className="mt-1 text-sm font-medium text-foreground">{radarModeLabel(entry.mode, t)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("radar.usedModel")}</div>
                      <div className="mt-1 text-sm text-foreground/85 break-words">{describeModel(entry)}</div>
                    </div>
                    {snippet && (
                      <div className="text-sm leading-6 text-muted-foreground">
                        {snippet}
                      </div>
                    )}
                  </div>
                </button>
              );
            }) : (
              <div className="rounded-xl border border-dashed border-border/50 px-3 py-8 text-center text-sm italic text-muted-foreground">
                {t("radar.historyEmpty")}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className={`border ${c.cardStatic} rounded-2xl p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Database size={16} className="text-[color:var(--studio-state-text)]" />
                {displayedMode === "current" ? t("radar.currentResult") : t("radar.savedResult")}
              </div>
              {displayedMode === "saved" && selectedSavedScan && (
                <div className="text-xs text-muted-foreground">{selectedSavedScan.savedPath}</div>
              )}
            </div>

            {displayedMode === "saved" && selectedSavedScan && (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border/40 bg-background/72 px-3 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("radar.savedAt")}</div>
                  <div className="mt-1 text-sm font-medium text-foreground">{formatRadarTimestamp(selectedSavedScan.savedAt)}</div>
                </div>
                <div className="rounded-xl border border-border/40 bg-background/72 px-3 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("radar.mode")}</div>
                  <div className="mt-1 text-sm font-medium text-foreground">{radarModeLabel(selectedSavedScan.mode, t)}</div>
                </div>
                <div className="rounded-xl border border-border/40 bg-background/72 px-3 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("radar.usedModel")}</div>
                  <div className="mt-1 text-sm text-foreground break-words">{describeModel(selectedSavedScan)}</div>
                </div>
              </div>
            )}

            {displayedFitCheckMetadata && (
              <div className="mt-4 rounded-xl border border-border/40 bg-background/72 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <BookOpen size={15} className="text-[color:var(--studio-state-text)]" />
                  {t("radar.fitCheckInputSummary")}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("radar.fitCheckBook")}</div>
                    <div className="mt-1 text-sm font-medium text-foreground">{displayedFitCheckMetadata.bookTitle}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("radar.fitCheckContextLength")}</div>
                    <div className="mt-1 text-sm font-medium text-foreground">{displayedFitCheckMetadata.contextLength.toLocaleString()}</div>
                  </div>
                </div>
                <div className="mt-3 text-sm text-muted-foreground">
                  {displayedFitCheckMetadata.sourceFiles.length > 0
                    ? `${t("radar.fitCheckContextSources")}: ${displayedFitCheckMetadata.sourceFiles.join(", ")}`
                    : t("radar.fitCheckContextNoSources")}
                </div>
                {displayedFitCheckMetadata.note && (
                  <div className="mt-3 rounded-lg border border-border/40 bg-background px-3 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("radar.fitCheckExtraAngle")}</div>
                    <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/85">
                      {displayedFitCheckMetadata.note}
                    </div>
                  </div>
                )}
                {displayedFitCheckMetadata.contextPreview && (
                  <div className="mt-3 rounded-lg border border-border/40 bg-background px-3 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("radar.fitCheckContextPreview")}</div>
                    <pre className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-foreground/85">
                      {displayedFitCheckMetadata.contextPreview}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {displayedResult ? (
              <div className="mt-5 space-y-6">
                <div className="rounded-xl border border-border/40 bg-background/72 p-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">{t("radar.summary")}</h3>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">{displayedResult.marketSummary}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {displayedResult.recommendations.map((rec, index) => (
                    <div key={`${rec.platform}-${rec.genre}-${index}`} className={`border ${c.cardStatic} rounded-xl p-4 space-y-3`}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          {rec.platform} · {rec.genre}
                        </span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          rec.confidence >= 0.7 ? "bg-emerald-500/10 text-emerald-600" :
                          rec.confidence >= 0.4 ? "bg-amber-500/10 text-amber-600" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {(rec.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-foreground">{rec.concept}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{rec.reasoning}</p>
                      {rec.benchmarkTitles.length > 0 && (
                        <div className="flex gap-2 flex-wrap">
                          {rec.benchmarkTitles.map((title) => (
                            <span key={title} className="px-2 py-0.5 text-[10px] bg-secondary rounded">
                              {title}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : displayedError ? (
              <div className="mt-5 rounded-xl border border-destructive/20 bg-destructive/6 px-4 py-4 text-sm text-destructive">
                {`${t("radar.errorPrefix")}${normalizedDisplayError}`}
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-dashed border-border/50 px-4 py-10 text-center text-sm italic text-muted-foreground">
                {statusLoading ? t("radar.scanning") : t("radar.noSavedResult")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
