import { fetchJson, putApi, useApi } from "../hooks/use-api";
import { useEffect, useState, type ReactNode } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { type StudioLanguage } from "../shared/language";
import { GlobalConfigPanel } from "../components/GlobalConfigPanel";
import {
  PROVIDER_OPTIONS,
  defaultModelForProvider,
  labelForProvider,
  isCliOAuthProvider,
  modelSuggestionsForProvider,
  providerCapability,
  normalizeReasoningEffort,
  normalizeReasoningEffortForProvider,
  reasoningEffortsForProvider,
  supportsReasoningEffort,
  type LlmCapabilitiesSummary,
  type ReasoningEffort,
} from "../shared/llm";

const ROUTING_AGENTS = [
  "writer",
  "auditor",
  "reviser",
  "architect",
  "radar",
  "chapter-analyzer",
] as const;

interface AgentOverride {
  readonly model: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly reasoningEffort: ReasoningEffort;
}

type OverridesMap = Record<string, AgentOverride>;
type StoredAgentOverride = string | Partial<Omit<AgentOverride, "reasoningEffort"> & { reasoningEffort: string }>;

interface ProjectInfo {
  readonly name: string;
  readonly language: StudioLanguage;
  readonly model: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly stream: boolean;
  readonly temperature: number;
  readonly maxTokens: number;
}

interface ProjectForm {
  provider: string;
  model: string;
  baseUrl: string;
  reasoningEffort: ReasoningEffort;
  temperature: number;
  maxTokens: number;
  stream: boolean;
  language: StudioLanguage;
}

interface Nav {
  toDashboard: () => void;
}

interface SaveProjectConfigOptions {
  readonly putApiImpl?: typeof putApi;
}

export async function saveProjectConfig(
  form: Record<string, unknown>,
  options: SaveProjectConfigOptions = {},
): Promise<void> {
  const putApiImpl = options.putApiImpl ?? putApi;
  await putApiImpl("/project", form);
}

export function normalizeOverridesDraft(
  data?: { readonly overrides?: Record<string, StoredAgentOverride> } | null,
): OverridesMap {
  return Object.fromEntries(
    Object.entries(data?.overrides ?? {}).map(([agent, override]) => [
      agent,
      normalizeOverride(override),
    ]),
  ) as OverridesMap;
}

export function serializeOverridesDraft(overrides: OverridesMap): Record<string, string | {
  readonly model: string;
  readonly provider?: string;
  readonly baseUrl?: string;
  readonly reasoningEffort?: Exclude<ReasoningEffort, "">;
}> {
  const serialized: Record<string, string | {
    readonly model: string;
    readonly provider?: string;
    readonly baseUrl?: string;
    readonly reasoningEffort?: Exclude<ReasoningEffort, "">;
  }> = {};

  for (const [agent, override] of Object.entries(overrides)) {
    const model = override.model.trim();
    if (!model) continue;

    const provider = override.provider.trim();
    const baseUrl = override.baseUrl.trim();
    const reasoningEffort = normalizeReasoningEffort(override.reasoningEffort);
    const hasExtraConfig = provider.length > 0 || baseUrl.length > 0 || reasoningEffort.length > 0;

    serialized[agent] = hasExtraConfig
      ? {
          model,
          ...(provider ? { provider } : {}),
          ...(baseUrl ? { baseUrl } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
        }
      : model;
  }

  return serialized;
}

function languageLabel(language: StudioLanguage, t: TFunction): string {
  return language === "ko"
    ? t("config.korean")
    : language === "en"
      ? t("config.english")
      : t("config.chinese");
}

function projectToForm(data: ProjectInfo): ProjectForm {
  return {
    provider: data.provider,
    model: data.model,
    baseUrl: data.baseUrl,
    reasoningEffort: normalizeReasoningEffort(data.reasoningEffort),
    temperature: data.temperature,
    maxTokens: data.maxTokens,
    stream: data.stream,
    language: data.language,
  };
}

function projectFormHasChanges(form: ProjectForm, data: ProjectInfo): boolean {
  return (
    form.provider !== data.provider
    || form.model !== data.model
    || form.baseUrl !== data.baseUrl
    || normalizeReasoningEffort(form.reasoningEffort) !== normalizeReasoningEffort(data.reasoningEffort)
    || form.language !== data.language
    || form.temperature !== data.temperature
    || form.maxTokens !== data.maxTokens
    || form.stream !== data.stream
  );
}

export function ConfigView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<ProjectInfo>("/project");
  const { data: capabilities } = useApi<LlmCapabilitiesSummary>("/llm-capabilities");
  const [form, setForm] = useState<ProjectForm | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setForm(projectToForm(data));
  }, [data]);

  if (loading) return <div className="text-muted-foreground py-20 text-center text-sm">Loading...</div>;
  if (error) return <div className="text-destructive py-20 text-center">Error: {error}</div>;
  if (!data) return null;

  if (!form) return null;

  const hasChanges = projectFormHasChanges(form, data);
  const handleReset = () => {
    setForm(projectToForm(data));
  };

  const handleSave = async () => {
    const provider = form.provider.trim();
    const model = form.model.trim();
    if (!provider) {
      alert(t("config.providerRequired"));
      return;
    }
    if (!model) {
      alert(t("config.modelRequired"));
      return;
    }

    const reasoningEffort = normalizeReasoningEffortForProvider(form.reasoningEffort, provider, capabilities);
    const draft = {
      ...form,
      provider,
      model,
      reasoningEffort,
      baseUrl: isCliOAuthProvider(provider) ? "" : form.baseUrl.trim(),
    };

    setSaving(true);
    try {
      await saveProjectConfig(draft);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
          <span className="text-border">/</span>
          <span className="text-foreground">{t("bread.config")}</span>
        </div>

        <div className={`rounded-[1.75rem] border ${c.cardStatic} bg-card/70 px-5 py-5 shadow-sm sm:px-6`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <h1 className="font-serif text-3xl sm:text-4xl">{t("config.title")}</h1>
              <p className="max-w-2xl text-sm text-muted-foreground">{t("config.titleHint")}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <SummaryStat label={t("config.project")} value={data.name} />
            <SummaryStat
              label={t("config.language")}
              value={languageLabel(data.language, t)}
            />
          </div>
        </div>
      </div>

      <GlobalConfigPanel theme={theme} t={t} title={t("config.globalTitle")} compact />

      <div className="space-y-3">
        <SectionHeader title={t("config.activeLlmTitle")} hint={t("config.activeLlmHint")} />

        <div className={`border ${c.cardStatic} rounded-2xl divide-y divide-border/40 bg-card/70 shadow-sm`}>
          <EditRow
            label={t("config.provider")}
            value={form.provider}
            onChange={(nextProvider) => {
              setForm((current) => {
                if (!current) return projectToForm(data);
                const currentProvider = current.provider;
                const currentModel = current.model.trim();
                const nextModel = currentModel && currentModel !== defaultModelForProvider(currentProvider, capabilities)
                  ? currentModel
                  : currentModel || defaultModelForProvider(nextProvider, capabilities);
                return {
                  ...current,
                  provider: nextProvider,
                  model: nextModel ?? "",
                  baseUrl: isCliOAuthProvider(nextProvider) ? "" : current.baseUrl,
                  reasoningEffort: normalizeReasoningEffortForProvider(current.reasoningEffort, nextProvider, capabilities),
                };
              });
            }}
            type="select"
            options={PROVIDER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            c={c}
          />
          <ModelEditRow
            label={t("config.model")}
            value={form.model}
            onChange={(value) => setForm({ ...form, model: value })}
            suggestions={modelSuggestionsForProvider(form.provider, capabilities)}
            placeholder={defaultModelForProvider(form.provider, capabilities)}
            c={c}
          />
          <details className="group">
            <summary className="list-none cursor-pointer px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
              {t("config.advancedProjectSettings")}
            </summary>
            <div className="divide-y divide-border/40 border-t border-border/40">
              <TextEditRow
                label={t("config.baseUrl")}
                value={form.baseUrl}
                onChange={(value) => setForm({ ...form, baseUrl: value })}
                placeholder={isCliOAuthProvider(form.provider) ? t("config.optional") : "https://api.example.com/v1"}
                disabled={isCliOAuthProvider(form.provider)}
                c={c}
                mono
              />
              <EditRow
                label={t("config.language")}
                value={form.language}
                onChange={(v) => setForm({ ...form, language: v as StudioLanguage })}
                type="select"
                options={[
                  { value: "ko", label: t("config.korean") },
                  { value: "zh", label: t("config.chinese") },
                  { value: "en", label: t("config.english") },
                ]}
                c={c}
              />
              <EditRow
                label={t("config.temperature")}
                value={String(form.temperature)}
                onChange={(v) => setForm({ ...form, temperature: Number.isNaN(parseFloat(v)) ? form.temperature : parseFloat(v) })}
                type="number"
                c={c}
              />
              <EditRow
                label={t("config.maxTokens")}
                value={String(form.maxTokens)}
                onChange={(v) => setForm({ ...form, maxTokens: Number.isNaN(parseInt(v, 10)) ? form.maxTokens : parseInt(v, 10) })}
                type="number"
                c={c}
              />
              <EditRow
                label={t("config.stream")}
                value={String(form.stream)}
                onChange={(v) => setForm({ ...form, stream: v === "true" })}
                type="select"
                options={[{ value: "true", label: t("config.enabled") }, { value: "false", label: t("config.disabled") }]}
                c={c}
              />
              <EditRow
                label={t("config.reasoningLevel")}
                value={form.reasoningEffort}
                onChange={(value) => setForm({ ...form, reasoningEffort: value as ReasoningEffort })}
                disabled={!supportsReasoningEffort(form.provider, capabilities)}
                type="select"
                options={[
                  { value: "", label: t("config.default") },
                  ...reasoningEffortsForProvider(form.provider, capabilities).map((effort) => ({
                    value: effort,
                    label: reasoningEffortLabel(effort, t),
                  })),
                ]}
                c={c}
              />
            </div>
          </details>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <button onClick={handleReset} disabled={!hasChanges || saving} className={`px-4 py-2.5 text-sm rounded-md ${c.btnSecondary} disabled:opacity-50`}>
          {t("config.cancel")}
        </button>
        <button onClick={handleSave} disabled={!hasChanges || saving} className={`px-4 py-2.5 text-sm rounded-md ${c.btnPrimary} disabled:opacity-50`}>
          {saving ? t("config.saving") : t("config.save")}
        </button>
      </div>

      <ModelRoutingSection theme={theme} t={t} projectProvider={form.provider} />
    </div>
  );
}

function emptyOverride(): AgentOverride {
  return { model: "", provider: "", baseUrl: "", reasoningEffort: "" };
}

function reasoningEffortLabel(effort: Exclude<ReasoningEffort, "">, t: TFunction): string {
  if (effort === "none") return t("config.reasoningNone");
  if (effort === "minimal") return t("config.reasoningMinimal");
  if (effort === "low") return t("config.reasoningLow");
  if (effort === "medium") return t("config.reasoningMedium");
  if (effort === "high") return t("config.reasoningHigh");
  return t("config.reasoningXHigh");
}

function normalizeOverride(override: StoredAgentOverride): AgentOverride {
  if (typeof override === "string") {
    return {
      ...emptyOverride(),
      model: override,
    };
  }

  return {
    model: typeof override.model === "string" ? override.model : "",
    provider: typeof override.provider === "string" ? override.provider : "",
    baseUrl: typeof override.baseUrl === "string" ? override.baseUrl : "",
    reasoningEffort: normalizeReasoningEffort(override.reasoningEffort),
  };
}

function preferredModelForProvider(provider: string, capabilities?: LlmCapabilitiesSummary | null): string {
  return defaultModelForProvider(provider, capabilities) || modelSuggestionsForProvider(provider, capabilities)[0] || "";
}

function sourceBadgeLabel(source: "installed" | "config" | "fallback" | "mixed", t: TFunction): string {
  if (source === "installed") return t("config.sourceInstalled");
  if (source === "config") return t("config.sourceConfig");
  if (source === "mixed") return t("config.sourceMixed");
  return t("config.sourceFallback");
}

function modelSourceDescription(provider: string, source: "installed" | "config" | "fallback" | "mixed", t: TFunction): string {
  if (source === "installed") return t("config.modelsDetectedFromInstalledCli");
  if (provider === "codex-cli" && source === "config") return t("config.modelsDetectedFromCodexConfig");
  return t("config.modelsFallbackHint");
}

function reasoningSourceDescription(provider: string, source: "installed" | "config" | "fallback" | "mixed", t: TFunction): string {
  if (provider === "codex-cli" && source === "installed") return t("config.reasoningDetectedFromCodexCli");
  return t("config.reasoningFallbackHint");
}

export function applyRoutingProviderChange(
  current: AgentOverride,
  nextProvider: string,
  fallbackProvider: string,
  capabilities?: LlmCapabilitiesSummary | null,
): AgentOverride {
  const previousEffectiveProvider = current.provider || fallbackProvider;
  const nextEffectiveProvider = nextProvider || fallbackProvider;
  const previousSuggestions = modelSuggestionsForProvider(previousEffectiveProvider, capabilities);
  const nextPreferredModel = preferredModelForProvider(nextEffectiveProvider, capabilities);
  const currentModel = current.model.trim();
  const previousPreferredModel = preferredModelForProvider(previousEffectiveProvider, capabilities);
  const shouldResetModel = !currentModel || currentModel === previousPreferredModel || previousSuggestions.includes(currentModel);

  return {
    model: shouldResetModel ? nextPreferredModel : current.model,
    provider: nextProvider,
    baseUrl: isCliOAuthProvider(nextEffectiveProvider) ? "" : current.baseUrl,
    reasoningEffort: normalizeReasoningEffortForProvider(current.reasoningEffort, nextEffectiveProvider, capabilities),
  };
}

function ModelRoutingSection({ theme, t, projectProvider }: { theme: Theme; t: TFunction; projectProvider: string }) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<{ overrides: Record<string, StoredAgentOverride> }>(
    "/project/model-overrides",
  );
  const { data: capabilities } = useApi<LlmCapabilitiesSummary>("/llm-capabilities");
  const [overrides, setOverrides] = useState<OverridesMap>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOverrides(normalizeOverridesDraft(data));
  }, [data]);

  if (loading) return <div className="text-muted-foreground py-8 text-center text-sm">Loading model overrides...</div>;
  if (error) return <div className="text-destructive py-8 text-center text-sm">Error: {error}</div>;

  const updateAgent = (agent: string, field: keyof AgentOverride, value: string) => {
    const current = overrides[agent] ?? emptyOverride();
    setOverrides({
      ...overrides,
      [agent]: { ...current, [field]: value },
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetchJson("/project/model-overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: serializeOverridesDraft(overrides) }),
      });
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save model overrides");
    } finally {
      setSaving(false);
    }
  };

  return (
      <details className="group rounded-2xl border border-border/60 bg-card/40">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-left">
        <div>
          <div className="font-serif text-2xl">{t("config.modelRouting")}</div>
          <p className="text-sm text-muted-foreground">{t("config.routingHint")}</p>
        </div>
      </summary>
      <div className="px-4 pb-4 pt-3 space-y-4">
        <div className="grid gap-4 xl:grid-cols-2">
          {ROUTING_AGENTS.map((agent) => {
            const row = overrides[agent] ?? emptyOverride();
            const effectiveProvider = row.provider || projectProvider;
            const capability = providerCapability(effectiveProvider, capabilities);
            const modelOptions = modelSuggestionsForProvider(effectiveProvider, capabilities);
            const supportedReasoningEfforts = reasoningEffortsForProvider(effectiveProvider, capabilities);
            const supportsReasoning = supportedReasoningEfforts.length > 0;
            const selectedModel = modelOptions.includes(row.model) ? row.model : "";
            const inheritsProject = !row.provider;
            const modelSource = capability?.modelSource ?? "fallback";
            const reasoningSource = capability?.reasoningSource ?? "fallback";

            return (
              <section key={agent} className={`rounded-2xl border ${c.cardStatic} bg-card/70 p-4 shadow-sm`}>
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{t("config.agent")}</div>
                    <div className="font-mono text-sm text-foreground/90">{agent}</div>
                  </div>
                  <div className="space-y-1 text-left sm:text-right">
                    <div className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                      inheritsProject
                        ? "border-border/60 bg-secondary/60 text-muted-foreground"
                        : "studio-surface-active"
                    }`}>
                      {inheritsProject ? t("config.inheritsProjectLlm") : labelForProvider(row.provider)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {inheritsProject ? labelForProvider(projectProvider) : t("config.overrideEnabled")}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <FieldGroup label={t("config.provider")}>
                    <select
                      value={row.provider}
                      onChange={(e) => setOverrides((current) => ({
                        ...current,
                        [agent]: applyRoutingProviderChange(current[agent] ?? emptyOverride(), e.target.value, projectProvider, capabilities),
                      }))}
                      className={`${c.input} rounded-lg px-3 py-2 text-sm w-full`}
                    >
                      <option value="">{t("app.currentProjectLlm")}</option>
                      {PROVIDER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </FieldGroup>

                  <FieldGroup label={t("config.model")}>
                    <div className="space-y-2">
                      <select
                        value={selectedModel}
                        onChange={(e) => updateAgent(agent, "model", e.target.value)}
                        className={`${c.input} rounded-lg px-3 py-2 text-sm w-full`}
                      >
                        <option value="">{t("config.customModel")}</option>
                        {modelOptions.map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={row.model}
                        onChange={(e) => updateAgent(agent, "model", e.target.value)}
                        placeholder={preferredModelForProvider(effectiveProvider, capabilities) || t("config.optional")}
                        className={`${c.input} rounded-lg px-3 py-2 text-sm w-full`}
                      />
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full border border-border/50 bg-background/75 px-2 py-0.5">
                          {sourceBadgeLabel(modelSource, t)}
                        </span>
                        <span>{modelSourceDescription(effectiveProvider, modelSource, t)}</span>
                      </div>
                      {effectiveProvider === "codex-cli" && modelSource === "config" && (
                        <div className="text-[11px] text-muted-foreground">
                          {t("config.codexCatalogLimit")}
                        </div>
                      )}
                    </div>
                  </FieldGroup>

                  <FieldGroup label={t("config.reasoningLevel")}>
                    <div className="space-y-2">
                      <select
                        value={supportsReasoning ? row.reasoningEffort : ""}
                        onChange={(e) => updateAgent(agent, "reasoningEffort", e.target.value)}
                        disabled={!supportsReasoning}
                        className={`${c.input} rounded-lg px-3 py-2 text-sm w-full disabled:opacity-50`}
                      >
                        <option value="">{supportsReasoning ? t("config.default") : t("config.reasoningUnsupported")}</option>
                        {supportedReasoningEfforts.map((effort) => (
                          <option key={effort} value={effort}>
                            {effort === "none"
                              ? t("config.reasoningNone")
                              : effort === "minimal"
                                ? t("config.reasoningMinimal")
                                : effort === "low"
                                  ? t("config.reasoningLow")
                                  : effort === "medium"
                                    ? t("config.reasoningMedium")
                                    : effort === "high"
                                      ? t("config.reasoningHigh")
                                      : t("config.reasoningXHigh")}
                          </option>
                        ))}
                      </select>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full border border-border/50 bg-background/75 px-2 py-0.5">
                          {sourceBadgeLabel(reasoningSource, t)}
                        </span>
                        <span>{supportsReasoning ? reasoningSourceDescription(effectiveProvider, reasoningSource, t) : t("config.reasoningUnsupported")}</span>
                      </div>
                    </div>
                  </FieldGroup>

                  <FieldGroup label={t("config.baseUrl")}>
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        value={row.baseUrl}
                        onChange={(e) => updateAgent(agent, "baseUrl", e.target.value)}
                        placeholder={t("config.optional")}
                        disabled={isCliOAuthProvider(effectiveProvider)}
                        className={`${c.input} rounded-lg px-3 py-2 text-sm w-full disabled:opacity-50`}
                      />
                      {isCliOAuthProvider(effectiveProvider) && (
                        <div className="text-[11px] text-muted-foreground">{t("config.baseUrlManagedByCli")}</div>
                      )}
                    </div>
                  </FieldGroup>
                </div>
              </section>
            );
          })}
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-4 py-2.5 text-sm rounded-md ${c.btnPrimary} disabled:opacity-50`}
          >
            {saving ? t("config.saving") : t("config.saveOverrides")}
          </button>
        </div>
      </div>
    </details>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={`${mono ? "font-mono break-all" : "break-words"} min-w-0 whitespace-normal text-sm sm:text-right`}>{value}</span>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="space-y-1">
      <h2 className="font-serif text-2xl">{title}</h2>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function SummaryStat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/50 bg-background/75 px-3 py-3 shadow-sm">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`mt-1 min-w-0 whitespace-normal text-sm font-medium text-foreground ${mono ? "font-mono break-all" : "break-words"}`}>{value}</div>
    </div>
  );
}

function EditRow({ label, value, onChange, type, options, c, disabled = false }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: "number" | "select";
  options?: ReadonlyArray<{ value: string; label: string }>;
  c: ReturnType<typeof useColors>;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      {type === "select" && options ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`${c.input} min-w-0 rounded px-2 py-1 text-sm w-full sm:w-[16rem] lg:w-[18rem] disabled:opacity-50`}
        >
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className={`${c.input} min-w-0 rounded px-2 py-1 text-sm w-full text-right sm:w-[16rem] lg:w-[18rem]`} />
      )}
    </div>
  );
}

function TextEditRow({ label, value, onChange, placeholder, disabled = false, c, mono = false }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  c: ReturnType<typeof useColors>;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`${c.input} min-w-0 rounded px-2 py-1 text-sm w-full disabled:opacity-50 sm:w-[16rem] lg:w-[22rem] ${mono ? "font-mono break-all" : ""}`}
      />
    </div>
  );
}

function ModelEditRow({ label, value, onChange, suggestions, placeholder, c }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: ReadonlyArray<string>;
  placeholder?: string;
  c: ReturnType<typeof useColors>;
}) {
  const listId = `project-model-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <div className="w-full sm:w-[16rem] lg:w-[22rem]">
        <input
          type="text"
          list={listId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${c.input} rounded px-2 py-1 text-sm w-full`}
        />
        <datalist id={listId}>
          {suggestions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
