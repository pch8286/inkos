import { useApi } from "../hooks/use-api";
import { useEffect } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import type { SSEMessage } from "../hooks/use-sse";
import { buildActivityFeedEntries } from "../shared/activity-feed";

interface LogEntry {
  readonly level?: string;
  readonly tag?: string;
  readonly message: string;
  readonly timestamp?: string;
}

interface Nav {
  toDashboard: () => void;
}

const LEVEL_COLORS: Record<string, string> = {
  error: "text-destructive",
  warn: "text-amber-500",
  info: "text-primary/70",
  debug: "text-muted-foreground/50",
};

function activityToneClass(tone: "neutral" | "success" | "error" | "progress"): string {
  if (tone === "success") return "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300";
  if (tone === "error") return "border-destructive/30 bg-destructive/8 text-destructive";
  if (tone === "progress") return "border-primary/25 bg-primary/8 text-primary";
  return "border-border/50 bg-background/70 text-muted-foreground";
}

export function LogViewer({ nav, theme, t, sse }: { nav: Nav; theme: Theme; t: TFunction; sse: { messages: ReadonlyArray<SSEMessage> } }) {
  const c = useColors(theme);
  const { data, refetch } = useApi<{ entries: ReadonlyArray<LogEntry> }>("/logs");
  const { data: activityData, refetch: refetchActivity } = useApi<{ entries: ReadonlyArray<SSEMessage> }>("/activity");
  const activityEntries = buildActivityFeedEntries(activityData?.entries ?? sse.messages);

  useEffect(() => {
    if (!sse.messages.length) return;
    void refetchActivity();
  }, [refetchActivity, sse.messages]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">{t("logs.title")}</span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">{t("logs.title")}</h1>
        <button
          onClick={() => {
            refetch();
            refetchActivity();
          }}
          className={`px-4 py-2.5 text-sm rounded-md ${c.btnSecondary}`}
        >
          {t("common.refresh")}
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(19rem,0.95fr)]">
        <div className={`border ${c.cardStatic} rounded-2xl overflow-hidden`}>
          <div className="border-b border-border/40 px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">{t("logs.activityTitle")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("logs.activityHint")}</p>
          </div>
          <div className="max-h-[640px] space-y-3 overflow-y-auto p-4">
            {activityEntries.length > 0 ? activityEntries.map((entry) => (
              <div key={entry.id} className={`rounded-xl border p-3 ${activityToneClass(entry.tone)}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em]">{entry.label}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                {entry.detail && (
                  <div className="mt-2 text-sm leading-6 text-foreground/85 break-words">
                    {entry.detail}
                  </div>
                )}
              </div>
            )) : (
              <div className="text-muted-foreground text-sm italic py-12 text-center">
                {t("logs.empty")}
              </div>
            )}
          </div>
        </div>

        <div className={`border ${c.cardStatic} rounded-2xl overflow-hidden`}>
          <div className="border-b border-border/40 px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">{t("logs.fileLogTitle")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("logs.showingRecent")}</p>
          </div>
          <div className="max-h-[640px] overflow-y-auto p-4">
            {data?.entries && data.entries.length > 0 ? (
              <div className="space-y-1 font-mono text-sm leading-relaxed">
                {data.entries.map((entry, i) => (
                  <div key={i} className="flex gap-2">
                    {entry.timestamp && (
                      <span className="text-muted-foreground shrink-0 w-20 tabular-nums">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    )}
                    {entry.level && (
                      <span className={`shrink-0 w-12 uppercase ${LEVEL_COLORS[entry.level] ?? "text-muted-foreground"}`}>
                        {entry.level}
                      </span>
                    )}
                    {entry.tag && (
                      <span className="text-primary/70 shrink-0">[{entry.tag}]</span>
                    )}
                    <span className="text-foreground/80">{entry.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground text-sm italic py-12 text-center">
                {t("logs.empty")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
