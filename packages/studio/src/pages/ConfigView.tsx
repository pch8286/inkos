import { fetchJson, putApi, useApi } from "../hooks/use-api";
import { useEffect, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { resolveStudioLanguage, type StudioLanguage } from "../shared/language";
import { GlobalConfigPanel } from "../components/GlobalConfigPanel";
import {
  MODEL_SUGGESTIONS,
  PROVIDER_OPTIONS,
  defaultModelForProvider,
  isCliOAuthProvider,
  labelForProvider,
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
}

type OverridesMap = Record<string, AgentOverride>;

interface ProjectInfo {
  readonly name: string;
  readonly language: StudioLanguage;
  readonly model: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly stream: boolean;
  readonly temperature: number;
  readonly maxTokens: number;
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
  data?: { readonly overrides?: OverridesMap } | null,
): OverridesMap {
  return Object.fromEntries(
    Object.entries(data?.overrides ?? {}).map(([agent, override]) => [
      agent,
      { ...override },
    ]),
  ) as OverridesMap;
}

export function ConfigView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<ProjectInfo>("/project");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});

  if (loading) return <div className="text-muted-foreground py-20 text-center text-sm">Loading...</div>;
  if (error) return <div className="text-destructive py-20 text-center">Error: {error}</div>;
  if (!data) return null;

  const startEdit = () => {
    setForm({
      provider: data.provider,
      model: data.model,
      baseUrl: data.baseUrl,
      temperature: data.temperature,
      maxTokens: data.maxTokens,
      stream: data.stream,
      language: data.language,
    });
    setEditing(true);
  };

  const handleSave = async () => {
    const provider = String(form.provider ?? data.provider).trim();
    const model = String(form.model ?? data.model).trim();
    if (!provider) {
      alert(t("config.providerRequired"));
      return;
    }
    if (!model) {
      alert(t("config.modelRequired"));
      return;
    }

    const draft = {
      ...form,
      provider,
      model,
      baseUrl: isCliOAuthProvider(provider) ? "" : String(form.baseUrl ?? data.baseUrl).trim(),
    };

    setSaving(true);
    try {
      await saveProjectConfig(draft);
      setEditing(false);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">{t("bread.config")}</span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">{t("config.title")}</h1>
        {!editing && (
          <button onClick={startEdit} className={`px-3 py-2 text-xs rounded-md ${c.btnSecondary}`}>
            {t("config.edit")}
          </button>
        )}
      </div>

      <GlobalConfigPanel theme={theme} t={t} />

      <div className={`border ${c.info} rounded-lg px-4 py-3 text-sm`}>
        {t("config.globalScopeHint")}
      </div>

      <div className="space-y-1">
        <h2 className="font-serif text-2xl">{t("config.activeLlmTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("config.activeLlmHint")}</p>
      </div>

      <div className={`border ${c.cardStatic} rounded-lg divide-y divide-border/40`}>
        <Row label={t("config.project")} value={data.name} />
        <Row label={t("config.provider")} value={labelForProvider(data.provider)} />
        <Row label={t("config.model")} value={data.model} />
        <Row label={t("config.baseUrl")} value={data.baseUrl} mono />

        {editing ? (
          <>
            <EditRow
              label={t("config.provider")}
              value={String(form.provider)}
              onChange={(nextProvider) => {
                const currentProvider = String(form.provider ?? data.provider);
                const currentModel = String(form.model ?? data.model);
                const nextDefault = defaultModelForProvider(nextProvider);
                setForm({
                  ...form,
                  provider: nextProvider,
                  model: currentModel && currentModel !== defaultModelForProvider(currentProvider)
                    ? currentModel
                    : (currentModel || nextDefault),
                  baseUrl: isCliOAuthProvider(nextProvider) ? "" : String(form.baseUrl ?? data.baseUrl),
                });
              }}
              type="select"
              options={PROVIDER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              c={c}
            />
            <ModelEditRow
              label={t("config.model")}
              value={String(form.model)}
              onChange={(value) => setForm({ ...form, model: value })}
              suggestions={MODEL_SUGGESTIONS[String(form.provider ?? data.provider) as keyof typeof MODEL_SUGGESTIONS] ?? []}
              placeholder={defaultModelForProvider(String(form.provider ?? data.provider))}
              c={c}
            />
            <TextEditRow
              label={t("config.baseUrl")}
              value={String(form.baseUrl)}
              onChange={(value) => setForm({ ...form, baseUrl: value })}
              placeholder={isCliOAuthProvider(String(form.provider ?? data.provider)) ? t("config.optional") : "https://api.example.com/v1"}
              disabled={isCliOAuthProvider(String(form.provider ?? data.provider))}
              c={c}
              mono
            />
            <EditRow
              label={t("config.language")}
              value={form.language as string}
              onChange={(v) => setForm({ ...form, language: v })}
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
              onChange={(v) => setForm({ ...form, temperature: parseFloat(v) })}
              type="number"
              c={c}
            />
            <EditRow
              label={t("config.maxTokens")}
              value={String(form.maxTokens)}
              onChange={(v) => setForm({ ...form, maxTokens: parseInt(v, 10) })}
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
          </>
        ) : (
          <>
            <Row label={t("config.language")} value={resolveStudioLanguage(data.language) === "ko"
              ? t("config.korean")
              : resolveStudioLanguage(data.language) === "en"
                ? t("config.english")
                : t("config.chinese")} />
            <Row label={t("config.temperature")} value={String(data.temperature)} mono />
            <Row label={t("config.maxTokens")} value={String(data.maxTokens)} mono />
            <Row label={t("config.stream")} value={data.stream ? t("config.enabled") : t("config.disabled")} />
          </>
        )}
      </div>

      {editing && (
        <div className="flex gap-2 justify-end">
          <button onClick={() => setEditing(false)} className={`px-4 py-2.5 text-sm rounded-md ${c.btnSecondary}`}>
            {t("config.cancel")}
          </button>
          <button onClick={handleSave} disabled={saving} className={`px-4 py-2.5 text-sm rounded-md ${c.btnPrimary} disabled:opacity-50`}>
            {saving ? t("config.saving") : t("config.save")}
          </button>
        </div>
      )}

      <ModelRoutingSection theme={theme} t={t} />
    </div>
  );
}

function emptyOverride(): AgentOverride {
  return { model: "", provider: "", baseUrl: "" };
}

function ModelRoutingSection({ theme, t }: { theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<{ overrides: OverridesMap }>(
    "/project/model-overrides",
  );
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
        body: JSON.stringify({ overrides }),
      });
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save model overrides");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h2 className="font-serif text-xl mt-4">{t("config.modelRouting")}</h2>

      <div className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 text-muted-foreground text-left">
              <th className="px-4 py-2.5 font-medium">{t("config.agent")}</th>
              <th className="px-4 py-2.5 font-medium">{t("config.model")}</th>
              <th className="px-4 py-2.5 font-medium">{t("config.provider")}</th>
              <th className="px-4 py-2.5 font-medium">{t("config.baseUrl")}</th>
            </tr>
          </thead>
          <tbody>
            {ROUTING_AGENTS.map((agent) => {
              const row = overrides[agent] ?? emptyOverride();
              const modelOptions = row.provider && row.provider in MODEL_SUGGESTIONS
                ? MODEL_SUGGESTIONS[row.provider as keyof typeof MODEL_SUGGESTIONS]
                : [];
              const modelListId = `routing-model-${agent}`;
              return (
                <tr key={agent} className="border-b border-border/40 last:border-b-0">
                  <td className="px-4 py-2 font-mono text-foreground/80">{agent}</td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      list={modelListId}
                      value={row.model}
                      onChange={(e) => updateAgent(agent, "model", e.target.value)}
                      placeholder={t("config.default")}
                      className={`${c.input} rounded px-2 py-1 text-sm w-full`}
                    />
                    <datalist id={modelListId}>
                      {modelOptions.map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={row.provider}
                      onChange={(e) => {
                        const provider = e.target.value;
                        updateAgent(agent, "provider", provider);
                        if (isCliOAuthProvider(provider) && row.baseUrl) {
                          updateAgent(agent, "baseUrl", "");
                        }
                      }}
                      className={`${c.input} rounded px-2 py-1 text-sm w-full`}
                    >
                      <option value="">{t("config.optional")}</option>
                      {PROVIDER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={row.baseUrl}
                      onChange={(e) => updateAgent(agent, "baseUrl", e.target.value)}
                      placeholder={t("config.optional")}
                      disabled={isCliOAuthProvider(row.provider)}
                      className={`${c.input} rounded px-2 py-1 text-sm w-full disabled:opacity-50`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between px-4 py-3">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={mono ? "font-mono text-sm" : "text-sm"}>{value}</span>
    </div>
  );
}

function EditRow({ label, value, onChange, type, options, c }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: "number" | "select";
  options?: ReadonlyArray<{ value: string; label: string }>;
  c: ReturnType<typeof useColors>;
}) {
  return (
    <div className="flex justify-between items-center px-4 py-2.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      {type === "select" && options ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={`${c.input} rounded px-2 py-1 text-sm w-32`}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className={`${c.input} rounded px-2 py-1 text-sm w-32 text-right`} />
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
    <div className="flex justify-between items-center gap-4 px-4 py-2.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`${c.input} rounded px-2 py-1 text-sm w-56 disabled:opacity-50 ${mono ? "font-mono" : ""}`}
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
    <div className="flex justify-between items-center gap-4 px-4 py-2.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      <div className="w-56">
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
