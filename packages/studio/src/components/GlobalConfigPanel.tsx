import { useEffect, useRef, useState } from "react";
import { fetchJson, postApi, putApi, useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { Theme } from "../hooks/use-theme";
import type { AuthSessionSummary, GlobalConfigSummary } from "../shared/contracts";
import {
  PROVIDER_OPTIONS,
  defaultModelForProvider,
  isCliOAuthProvider,
  modelSuggestionsForProvider,
  normalizeReasoningEffortForProvider,
  providerCapability,
  reasoningEffortsForProvider,
  type CliOAuthProvider,
  type LlmCapabilitiesSummary,
  type LlmProvider,
} from "../shared/llm";
import type { TFunction } from "../hooks/use-i18n";

type GlobalConfigSummaryWithReasoning = GlobalConfigSummary & {
  readonly reasoningEffort?: string;
};

function providerLabel(provider: string): string {
  return PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? provider;
}

function authTitle(provider: CliOAuthProvider): string {
  return provider === "gemini-cli" ? "Gemini CLI OAuth" : "Codex CLI OAuth";
}

function sourceBadgeLabel(source: "installed" | "config" | "fallback" | "mixed", t?: TFunction): string {
  if (source === "installed") return t ? t("config.sourceInstalled") : "Installed CLI";
  if (source === "config") return t ? t("config.sourceConfig") : "Config file";
  if (source === "mixed") return t ? t("config.sourceMixed") : "Mixed";
  return t ? t("config.sourceFallback") : "Fallback";
}

function modelSourceDescription(provider: string, source: "installed" | "config" | "fallback" | "mixed", t?: TFunction): string {
  if (source === "installed") {
    return t ? t("config.modelsDetectedFromInstalledCli") : "Model options detected from the installed CLI.";
  }
  if (provider === "codex-cli" && source === "config") {
    return t ? t("config.modelsDetectedFromCodexConfig") : "Model options detected from the current Codex config.";
  }
  return t ? t("config.modelsFallbackHint") : "Showing fallback suggestions because no installed model catalog was detected here.";
}

function reasoningEffortLabel(value: string, t?: TFunction): string {
  if (value === "none") return t ? t("config.reasoningNone") : "None";
  if (value === "minimal") return t ? t("config.reasoningMinimal") : "Minimal";
  if (value === "low") return t ? t("config.reasoningLow") : "Low";
  if (value === "medium") return t ? t("config.reasoningMedium") : "Medium";
  if (value === "high") return t ? t("config.reasoningHigh") : "High";
  if (value === "xhigh") return t ? t("config.reasoningXHigh") : "XHigh";
  return value;
}

function reasoningLabel(value: string, supportedEfforts: ReadonlyArray<string>, t?: TFunction): string {
  if (!value) {
    return supportedEfforts.length > 0
      ? t ? t("config.default") : "default"
      : t ? t("config.reasoningUnsupported") : "Not supported";
  }
  return reasoningEffortLabel(value, t);
}

function reasoningSourceDescription(provider: string, source: "installed" | "config" | "fallback" | "mixed", t?: TFunction): string {
  if (provider === "codex-cli" && source === "installed") {
    return t ? t("config.reasoningDetectedFromCodexCli") : "Reasoning levels are detected from the local Codex CLI parser.";
  }
  return t ? t("config.reasoningFallbackHint") : "Reasoning levels are currently shown from fallback suggestions.";
}

export function GlobalConfigPanel({ theme, title, compact = false, t, onSaved }: {
  theme: Theme;
  title?: string;
  compact?: boolean;
  t?: TFunction;
  onSaved?: (summary: GlobalConfigSummary) => void;
}) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<GlobalConfigSummaryWithReasoning>("/global-config");
  const { data: capabilities } = useApi<LlmCapabilitiesSummary>("/llm-capabilities");
  const [form, setForm] = useState({
    language: "ko",
    provider: "openai",
    model: "",
    baseUrl: "",
    apiKey: "",
    reasoningEffort: "",
  });
  const [saving, setSaving] = useState(false);
  const [authSession, setAuthSession] = useState<AuthSessionSummary | null>(null);
  const [geminiCode, setGeminiCode] = useState("");
  const openedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const reasoningEffort = normalizeReasoningEffortForProvider(data.reasoningEffort, data.provider, capabilities);
    setForm({
      language: data.language,
      provider: data.provider || "openai",
      model: data.model || defaultModelForProvider(data.provider || "openai", capabilities),
      baseUrl: data.baseUrl || "",
      apiKey: "",
      reasoningEffort,
    });
  }, [capabilities, data]);

  useEffect(() => {
    if (!authSession || authSession.status === "failed" || authSession.status === "succeeded") {
      if (authSession?.status === "succeeded") {
        void fetchJson<GlobalConfigSummaryWithReasoning>("/global-config").then((summary) => {
          const persistedReasoningEffort = normalizeReasoningEffortForProvider(summary.reasoningEffort, summary.provider, capabilities);
          setForm({
            language: summary.language,
            provider: summary.provider || "openai",
            model: summary.model || defaultModelForProvider(summary.provider || "openai", capabilities),
            baseUrl: summary.baseUrl || "",
            apiKey: "",
            reasoningEffort: persistedReasoningEffort,
          });
          onSaved?.(summary as GlobalConfigSummary);
        }).finally(() => {
          void refetch();
        });
      }
      return;
    }

    const timer = window.setInterval(() => {
      void fetchJson<AuthSessionSummary>(`/auth/${authSession.id}`).then((next) => {
        setAuthSession(next);
      }).catch(() => {
        // Keep the last visible state if polling fails.
      });
    }, 1500);

    return () => window.clearInterval(timer);
  }, [authSession, capabilities, onSaved, refetch]);

  useEffect(() => {
    if (!authSession?.url || openedUrlRef.current === authSession.url || typeof window === "undefined") {
      return;
    }
    openedUrlRef.current = authSession.url;
    if (typeof window.open === "function") {
      window.open(authSession.url, "_blank", "noopener,noreferrer");
    }
  }, [authSession?.url]);

  if (loading) {
    return <div className="text-muted-foreground text-sm py-4">Loading global LLM settings...</div>;
  }
  if (error) {
    return <div className="text-destructive text-sm py-4">Error loading global config: {error}</div>;
  }
  if (!data) return null;

  const resolvedTitle = title ?? (t ? t("config.globalTitle") : "Global LLM Defaults");
  const cliOAuthProvider = isCliOAuthProvider(form.provider);
  const datalistId = `model-suggestions-${resolvedTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const suggestions = modelSuggestionsForProvider(form.provider, capabilities);
  const capability = providerCapability(form.provider, capabilities);
  const modelSource = capability?.modelSource ?? "fallback";
  const reasoningEfforts = reasoningEffortsForProvider(form.provider, capabilities);
  const supportsReasoning = reasoningEfforts.length > 0;
  const reasoningSource = capability?.reasoningSource ?? "fallback";
  const modelSummary = form.model || defaultModelForProvider(form.provider, capabilities) || "-";
  const activeAuthStatus = form.provider === "gemini-cli"
    ? data.auth.geminiCli
    : form.provider === "codex-cli"
      ? data.auth.codexCli
      : null;
  const authBusy = authSession
    && authSession.provider === form.provider
    && authSession.status !== "failed"
    && authSession.status !== "succeeded";
  const authSummary = cliOAuthProvider
    ? activeAuthStatus?.authenticated
      ? (t ? t("config.summaryReady") : "Ready")
      : (t ? t("config.summaryNeedsAuth") : "Login required")
    : data.apiKeySet
      ? (t ? t("config.summaryReady") : "Ready")
      : (t ? t("config.summaryNeedsKey") : "API key required");

  const handleProviderSelect = (provider: Exclude<LlmProvider, "">) => {
    setForm((current) => ({
      ...current,
      provider,
      model: current.provider === provider
        ? current.model
        : (current.model && current.model !== defaultModelForProvider(current.provider, capabilities))
          ? current.model
          : defaultModelForProvider(provider, capabilities),
      reasoningEffort: normalizeReasoningEffortForProvider(current.reasoningEffort, provider, capabilities),
      baseUrl: isCliOAuthProvider(provider) ? "" : current.baseUrl,
      apiKey: isCliOAuthProvider(provider) ? "" : current.apiKey,
    }));
    setAuthSession((current) => (current?.provider === provider ? current : null));
  };

  const handleSave = async () => {
    const reasoningEffort = normalizeReasoningEffortForProvider(form.reasoningEffort, form.provider, capabilities);

    setSaving(true);
    try {
      await putApi("/global-config", {
        language: form.language,
        provider: form.provider,
        model: form.model.trim() || defaultModelForProvider(form.provider, capabilities),
        reasoningEffort,
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
      });
      const summary = await fetchJson<GlobalConfigSummaryWithReasoning>("/global-config");
      const persistedReasoningEffort = normalizeReasoningEffortForProvider(summary.reasoningEffort, summary.provider, capabilities);
      setForm({
        language: summary.language,
        provider: summary.provider || "openai",
        model: summary.model || defaultModelForProvider(summary.provider || "openai", capabilities),
        baseUrl: summary.baseUrl || "",
        apiKey: "",
        reasoningEffort: persistedReasoningEffort || reasoningEffort,
      });
      onSaved?.(summary);
      await refetch();
    } catch (saveError) {
      alert(saveError instanceof Error ? saveError.message : "Failed to save global config");
    } finally {
      setSaving(false);
    }
  };

  const beginAuth = async (provider: CliOAuthProvider) => {
    try {
      const session = await postApi<AuthSessionSummary>(`/auth/${provider}/login`);
      setAuthSession(session);
    } catch (authError) {
      alert(authError instanceof Error ? authError.message : "Failed to start auth flow");
    }
  };

  const submitGeminiCode = async () => {
    if (!authSession || authSession.provider !== "gemini-cli") return;
    try {
      const session = await postApi<AuthSessionSummary>(`/auth/${authSession.id}/submit`, {
        code: geminiCode,
      });
      setAuthSession(session);
      setGeminiCode("");
    } catch (authError) {
      alert(authError instanceof Error ? authError.message : "Failed to submit Gemini auth code");
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="font-serif text-2xl">{resolvedTitle}</h2>
          {!compact && (
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t ? t("config.globalHint") : "Save `provider/model/auth` here instead of using `inkos config set-global`."}
            </p>
          )}
        </div>
        {data.exists && (
          <span className="inline-flex items-center rounded-full border border-border/50 bg-background/75 px-3 py-1 text-xs text-muted-foreground">
            {(t ? t("config.storedPath") : "Stored in")} <span className="ml-1 font-mono">~/.inkos/.env</span>
          </span>
        )}
      </div>

      <div className={`border ${c.cardStatic} rounded-2xl bg-card/70 p-4 md:p-5 space-y-6 shadow-sm`}>
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
          <div className="rounded-xl border border-border/50 bg-background/75 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {t ? t("config.providerSummary") : "Current provider"}
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">{providerLabel(form.provider)}</div>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/75 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {t ? t("config.modelSummary") : "Current model"}
            </div>
            <div className="mt-1 text-sm font-medium text-foreground break-all">{modelSummary}</div>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/75 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {t ? t("config.globalReasoningSummary") : "Global reasoning"}
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">{reasoningLabel(form.reasoningEffort, reasoningEfforts, t)}</div>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/75 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {t ? t("config.authSummary") : "Connection status"}
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
              <span className={`h-2 w-2 rounded-full ${authSummary === (t ? t("config.summaryReady") : "Ready") ? "studio-status-dot-ok" : "studio-status-dot-warn"}`} />
              <span>{authSummary}</span>
            </div>
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm text-muted-foreground">{t ? t("config.defaultLanguage") : "Default language"}</span>
          <select
            value={form.language}
            onChange={(event) => setForm({ ...form, language: event.target.value })}
            className={`${c.input} rounded px-3 py-2 text-sm w-full`}
          >
            <option value="ko">{t ? t("config.korean") : "Korean"}</option>
            <option value="zh">{t ? t("config.chinese") : "Chinese"}</option>
            <option value="en">{t ? t("config.english") : "English"}</option>
          </select>
        </label>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">{t ? t("config.providerLabel") : "Provider"}</div>
            <div className="hidden sm:block text-xs text-muted-foreground">
              {t ? t("config.projectWillUse") : "New projects will use these defaults immediately."}
            </div>
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 snap-x snap-mandatory sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-3">
            {PROVIDER_OPTIONS.map((option) => {
              const active = form.provider === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleProviderSelect(option.value)}
                  className={`min-w-[11.5rem] shrink-0 snap-start rounded-xl border px-3 py-3 text-left text-sm transition-colors sm:min-w-0 sm:shrink ${
                    active
                      ? "studio-chip-accent text-foreground shadow-sm"
                      : "studio-chip"
                  }`}
                >
                  <div className="font-medium leading-snug">{option.label}</div>
                  <div className="mt-1 text-[11px] opacity-70">
                    {option.value}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.9fr)]">
          <label className="block space-y-1.5">
            <span className="text-sm text-muted-foreground">{t ? t("config.model") : "Model"}</span>
            <input
              type="text"
              list={datalistId}
              value={form.model}
              onChange={(event) => setForm({ ...form, model: event.target.value })}
              placeholder={defaultModelForProvider(form.provider, capabilities) || "Enter a model name"}
              className={`${c.input} rounded px-3 py-2 text-sm w-full`}
            />
            <datalist id={datalistId}>
              {suggestions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-border/50 bg-background/75 px-2 py-0.5">
                {sourceBadgeLabel(modelSource, t)}
              </span>
              <span>{modelSourceDescription(form.provider, modelSource, t)}</span>
            </div>
            {form.provider === "codex-cli" && modelSource === "config" && (
              <div className="text-xs text-muted-foreground">
                {t ? t("config.codexCatalogLimit") : "Codex CLI does not expose a full model catalog here. Use custom input for other supported models."}
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((model) => (
                  <button
                    key={model}
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, model }))}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      form.model === model
                        ? "studio-badge-ok"
                        : "studio-badge-soft"
                    }`}
                  >
                    {model}
                  </button>
                ))}
              </div>
            )}
          </label>

          <div className="rounded-2xl border border-border/50 bg-background/80 p-4 space-y-3">
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {t ? t("config.globalReasoningTitle") : "Global reasoning default"}
              </div>
              <div className="text-sm text-foreground">
                {t ? t("config.globalReasoningHint") : "Store a default reasoning level here for new projects and providers that support it."}
              </div>
            </div>

            <label className="block space-y-1.5">
              <span className="text-sm text-muted-foreground">{t ? t("config.reasoningLevel") : "Reasoning level"}</span>
              <select
                value={supportsReasoning ? form.reasoningEffort : ""}
                onChange={(event) => setForm({ ...form, reasoningEffort: event.target.value })}
                disabled={!supportsReasoning}
                className={`${c.input} rounded px-3 py-2 text-sm w-full disabled:opacity-50`}
              >
                <option value="">{supportsReasoning ? (t ? t("config.default") : "Default") : (t ? t("config.reasoningUnsupported") : "Not supported")}</option>
                {reasoningEfforts.map((reasoningEffort) => (
                  <option key={reasoningEffort} value={reasoningEffort}>
                    {reasoningEffortLabel(reasoningEffort, t)}
                  </option>
                ))}
              </select>
            </label>

            <div className="rounded-xl border border-border/40 bg-card/60 px-3 py-2 text-xs text-muted-foreground">
              {supportsReasoning
                ? (t ? t("config.globalReasoningProjectHint") : "New projects inherit this reasoning default unless you override them later.")
                : (t ? t("config.globalReasoningUnsupportedHint") : "The current provider does not expose separate reasoning controls, so its built-in default will be used.")}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-border/50 bg-background/75 px-2 py-0.5">
                {sourceBadgeLabel(reasoningSource, t)}
              </span>
              <span>{supportsReasoning ? reasoningSourceDescription(form.provider, reasoningSource, t) : t ? t("config.reasoningUnsupported") : "Not supported"}</span>
            </div>
          </div>
        </div>

        {!cliOAuthProvider && (
          <>
            <label className="block space-y-1.5">
              <span className="text-sm text-muted-foreground">{t ? t("config.baseUrl") : "Base URL"}</span>
              <input
                type="text"
                value={form.baseUrl}
                onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                placeholder="https://api.example.com/v1"
                className={`${c.input} rounded px-3 py-2 text-sm w-full`}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm text-muted-foreground">{t ? t("config.apiKey") : "API key"}</span>
              <input
                type="password"
                value={form.apiKey}
                onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                placeholder={data.apiKeySet
                  ? (t ? t("config.apiKeyStored") : "Leave blank to keep the current key")
                  : "Paste API key"}
                className={`${c.input} rounded px-3 py-2 text-sm w-full`}
              />
            </label>
          </>
        )}

        {cliOAuthProvider && activeAuthStatus && (
          <div className="rounded-2xl border border-border/50 bg-secondary/30 p-4 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium text-foreground">
                    {authTitle(form.provider as CliOAuthProvider)}
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    activeAuthStatus.authenticated
                      ? "studio-badge-ok"
                      : "studio-badge-warn"
                  }`}>
                    {activeAuthStatus.authenticated
                      ? (t ? t("config.authenticated") : "Authenticated")
                      : (t ? t("config.notAuthenticated") : "Not Authenticated")}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {activeAuthStatus.available
                    ? (t ? t("config.commandDetected") : "`{command}` detected").replace("{command}", activeAuthStatus.command)
                    : (t ? t("config.commandMissing") : "`{command}` not found").replace("{command}", activeAuthStatus.command)}
                </div>
                <div className="rounded-lg border border-border/40 bg-background/70 px-3 py-2 text-xs text-muted-foreground break-all">
                  {activeAuthStatus.credentialPath}
                </div>
                {activeAuthStatus.details && (
                  <div className="text-xs text-muted-foreground">
                    {activeAuthStatus.details}
                  </div>
                )}
              </div>

              <div className="grid gap-2 sm:min-w-[12rem] sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className={`px-3 py-2 text-xs rounded-md ${c.btnSecondary}`}
                >
                  {t ? t("config.refreshStatus") : "Refresh Status"}
                </button>
                <button
                  type="button"
                  onClick={() => beginAuth(form.provider as CliOAuthProvider)}
                  disabled={!activeAuthStatus.available || Boolean(authBusy)}
                  className={`px-3 py-2 text-xs rounded-md ${c.btnPrimary} disabled:opacity-50`}
                >
                  {authBusy
                    ? (t ? t("config.launchingLogin") : "Launching...")
                    : activeAuthStatus.authenticated
                      ? (t ? t("config.reauthenticate") : "Re-authenticate")
                      : (t ? t("config.connectBrowser") : "Connect in Browser")}
                </button>
              </div>
            </div>

            <div className="rounded-md border border-border/40 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
              {t ? t("config.oauthHint") : "CLI OAuth providers only need provider/model here. Authenticate first, then save the config."}
            </div>

            {!activeAuthStatus.available && (
              <div className="text-xs text-destructive">
                {(t ? t("config.installCommandFirst") : "Install `{command}` first, then return here to authenticate.")
                  .replace("{command}", activeAuthStatus.command)}
              </div>
            )}

            {authSession && authSession.provider === form.provider && (
              <div className="space-y-2 rounded-md bg-background/70 p-3 border border-border/40">
                <div className="text-xs text-muted-foreground">{t ? t("config.authStatus") : "Auth status"}: {authSession.status}</div>
                {authSession.url && (
                  <a href={authSession.url} target="_blank" rel="noreferrer" className={c.link}>
                    {t ? t("config.openAuthPage") : "Open authorization page"}
                  </a>
                )}
                {authSession.verificationCode && (
                  <div className="text-sm font-mono rounded bg-secondary/60 px-2 py-1 inline-block">
                    {authSession.verificationCode}
                  </div>
                )}
                {authSession.provider === "gemini-cli" && authSession.status === "awaiting-code" && (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={geminiCode}
                      onChange={(event) => setGeminiCode(event.target.value)}
                      placeholder={t ? t("config.pasteGeminiCode") : "Paste Gemini auth code"}
                      className={`${c.input} rounded px-3 py-2 text-sm flex-1`}
                    />
                    <button type="button" onClick={submitGeminiCode} className={`px-3 py-2 text-xs rounded-md ${c.btnPrimary}`}>
                      {t ? t("config.submit") : "Submit"}
                    </button>
                  </div>
                )}
                {authSession.error && (
                  <div className="text-xs text-destructive whitespace-pre-wrap">{authSession.error}</div>
                )}
                {authSession.logs.length > 0 && (
                  <pre className="text-[11px] whitespace-pre-wrap rounded bg-black/80 text-zinc-100 p-2 overflow-x-auto">
                    {authSession.logs.join("")}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-border/40 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{providerLabel(form.provider)}</span>
            {" · "}
            <span className="font-mono">{form.model || defaultModelForProvider(form.provider, capabilities) || "-"}</span>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`w-full sm:w-auto px-4 py-2.5 text-sm rounded-md ${c.btnPrimary} disabled:opacity-50`}
          >
            {saving ? (t ? t("config.saving") : "Saving...") : (t ? t("config.saveGlobal") : "Save global defaults")}
          </button>
        </div>
      </div>
    </section>
  );
}
