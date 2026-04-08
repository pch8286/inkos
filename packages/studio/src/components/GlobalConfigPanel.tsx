import { useEffect, useRef, useState } from "react";
import { fetchJson, postApi, putApi, useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { Theme } from "../hooks/use-theme";
import type { AuthSessionSummary, GlobalConfigSummary } from "../shared/contracts";
import {
  MODEL_SUGGESTIONS,
  PROVIDER_OPTIONS,
  defaultModelForProvider,
  isCliOAuthProvider,
  type CliOAuthProvider,
  type LlmProvider,
} from "../shared/llm";
import type { TFunction } from "../hooks/use-i18n";

function providerLabel(provider: string): string {
  return PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? provider;
}

function authTitle(provider: CliOAuthProvider): string {
  return provider === "gemini-cli" ? "Gemini CLI OAuth" : "Codex CLI OAuth";
}

export function GlobalConfigPanel({ theme, title = "Global LLM Defaults", compact = false, t, onSaved }: {
  theme: Theme;
  title?: string;
  compact?: boolean;
  t?: TFunction;
  onSaved?: (summary: GlobalConfigSummary) => void;
}) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<GlobalConfigSummary>("/global-config");
  const [form, setForm] = useState({
    language: "ko",
    provider: "openai",
    model: "",
    baseUrl: "",
    apiKey: "",
  });
  const [saving, setSaving] = useState(false);
  const [authSession, setAuthSession] = useState<AuthSessionSummary | null>(null);
  const [geminiCode, setGeminiCode] = useState("");
  const openedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setForm({
      language: data.language,
      provider: data.provider || "openai",
      model: data.model || defaultModelForProvider(data.provider || "openai"),
      baseUrl: data.baseUrl || "",
      apiKey: "",
    });
  }, [data]);

  useEffect(() => {
    if (!authSession || authSession.status === "failed" || authSession.status === "succeeded") {
      if (authSession?.status === "succeeded") {
        void fetchJson<GlobalConfigSummary>("/global-config").then((summary) => {
          setForm({
            language: summary.language,
            provider: summary.provider || "openai",
            model: summary.model || defaultModelForProvider(summary.provider || "openai"),
            baseUrl: summary.baseUrl || "",
            apiKey: "",
          });
          onSaved?.(summary);
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
  }, [authSession, onSaved, refetch]);

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

  const cliOAuthProvider = isCliOAuthProvider(form.provider);
  const datalistId = `model-suggestions-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const suggestions = MODEL_SUGGESTIONS[form.provider as Exclude<LlmProvider, "">] ?? [];
  const activeAuthStatus = form.provider === "gemini-cli"
    ? data.auth.geminiCli
    : form.provider === "codex-cli"
      ? data.auth.codexCli
      : null;
  const authBusy = authSession
    && authSession.provider === form.provider
    && authSession.status !== "failed"
    && authSession.status !== "succeeded";

  const handleProviderSelect = (provider: Exclude<LlmProvider, "">) => {
    setForm((current) => ({
      ...current,
      provider,
      model: current.provider === provider
        ? current.model
        : (current.model && current.model !== defaultModelForProvider(current.provider))
          ? current.model
          : defaultModelForProvider(provider),
      baseUrl: isCliOAuthProvider(provider) ? "" : current.baseUrl,
      apiKey: isCliOAuthProvider(provider) ? "" : current.apiKey,
    }));
    setAuthSession((current) => (current?.provider === provider ? current : null));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await putApi("/global-config", {
        language: form.language,
        provider: form.provider,
        model: form.model.trim() || defaultModelForProvider(form.provider),
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
      });
      const summary = await fetchJson<GlobalConfigSummary>("/global-config");
      setForm({
        language: summary.language,
        provider: summary.provider || "openai",
        model: summary.model || defaultModelForProvider(summary.provider || "openai"),
        baseUrl: summary.baseUrl || "",
        apiKey: "",
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl">{title}</h2>
          {!compact && (
            <p className="text-sm text-muted-foreground mt-1">
              {t ? t("config.globalHint") : "Save `provider/model/auth` here instead of using `inkos config set-global`."}
            </p>
          )}
        </div>
        {data.exists && (
          <span className="text-xs text-muted-foreground">Stored in `~/.inkos/.env`</span>
        )}
      </div>

      <div className={`border ${c.cardStatic} rounded-lg p-4 space-y-4`}>
        <label className="block space-y-1.5">
          <span className="text-sm text-muted-foreground">{t ? t("config.language") : "Default language"}</span>
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
          <div className="text-sm text-muted-foreground">Provider</div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {PROVIDER_OPTIONS.map((option) => {
              const active = form.provider === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleProviderSelect(option.value)}
                  className={`rounded-lg border px-3 py-3 text-left text-sm transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/50 bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  <div className="font-medium">{option.label}</div>
                  <div className="mt-1 text-[11px] opacity-80">
                    {option.value}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm text-muted-foreground">{t ? t("config.model") : "Model"}</span>
          <input
            type="text"
            list={datalistId}
            value={form.model}
            onChange={(event) => setForm({ ...form, model: event.target.value })}
            placeholder={defaultModelForProvider(form.provider) || "Enter a model name"}
            className={`${c.input} rounded px-3 py-2 text-sm w-full`}
          />
          <datalist id={datalistId}>
            {suggestions.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((model) => (
                <button
                  key={model}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, model }))}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    form.model === model
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/50 bg-background/70 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {model}
                </button>
              ))}
            </div>
          )}
        </label>

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
          <div className="rounded-lg border border-border/50 bg-secondary/30 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium text-foreground">
                  {authTitle(form.provider as CliOAuthProvider)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {activeAuthStatus.authenticated
                    ? (t ? t("config.authenticated") : "Authenticated")
                    : (t ? t("config.notAuthenticated") : "Not Authenticated")}
                  {" · "}
                  {activeAuthStatus.available ? `\`${activeAuthStatus.command}\` detected` : `\`${activeAuthStatus.command}\` not found`}
                </div>
                <div className="text-xs text-muted-foreground break-all">
                  {activeAuthStatus.credentialPath}
                </div>
                {activeAuthStatus.details && (
                  <div className="text-xs text-muted-foreground">
                    {activeAuthStatus.details}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
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
                      ? "Re-authenticate"
                      : "Connect in Browser"}
                </button>
              </div>
            </div>

            <div className="rounded-md border border-border/40 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
              {t ? t("config.oauthHint") : "CLI OAuth providers only need provider/model here. Authenticate first, then save the config."}
            </div>

            {!activeAuthStatus.available && (
              <div className="text-xs text-destructive">
                Install `{activeAuthStatus.command}` first, then return here to authenticate.
              </div>
            )}

            {authSession && authSession.provider === form.provider && (
              <div className="space-y-2 rounded-md bg-background/70 p-3 border border-border/40">
                <div className="text-xs text-muted-foreground">Auth status: {authSession.status}</div>
                {authSession.url && (
                  <a href={authSession.url} target="_blank" rel="noreferrer" className={c.link}>
                    Open authorization page
                  </a>
                )}
                {authSession.verificationCode && (
                  <div className="text-sm font-mono rounded bg-secondary/60 px-2 py-1 inline-block">
                    {authSession.verificationCode}
                  </div>
                )}
                {authSession.provider === "gemini-cli" && authSession.status === "awaiting-code" && (
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={geminiCode}
                      onChange={(event) => setGeminiCode(event.target.value)}
                      placeholder="Paste Gemini auth code"
                      className={`${c.input} rounded px-3 py-2 text-sm flex-1`}
                    />
                    <button type="button" onClick={submitGeminiCode} className={`px-3 py-2 text-xs rounded-md ${c.btnPrimary}`}>
                      Submit
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

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {providerLabel(form.provider)}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`px-4 py-2.5 text-sm rounded-md ${c.btnPrimary} disabled:opacity-50`}
          >
            {saving ? (t ? t("config.saving") : "Saving...") : (t ? t("config.saveGlobal") : "Save global defaults")}
          </button>
        </div>
      </div>
    </section>
  );
}
