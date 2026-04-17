export type CliOAuthProvider = "gemini-cli" | "codex-cli";

export type LlmProvider = "openai" | "anthropic" | "custom" | CliOAuthProvider | "";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "";
export type SupportedReasoningEffort = Exclude<ReasoningEffort, "">;
export type CapabilitySource = "fallback" | "installed" | "config" | "mixed";

export interface ProviderCapability {
  readonly models: ReadonlyArray<string>;
  readonly defaultModel: string;
  readonly reasoningEfforts: ReadonlyArray<SupportedReasoningEffort>;
  readonly modelSource: CapabilitySource;
  readonly reasoningSource: CapabilitySource;
}

export interface LlmCapabilitiesSummary {
  readonly providers: Record<Exclude<LlmProvider, "">, ProviderCapability>;
}

export const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI / compatible" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "Custom OpenAI-compatible" },
  { value: "gemini-cli", label: "Gemini CLI OAuth" },
  { value: "codex-cli", label: "Codex CLI OAuth" },
] as const satisfies ReadonlyArray<{ readonly value: Exclude<LlmProvider, "">; readonly label: string }>;

export function labelForProvider(provider: string): string {
  return PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? provider;
}

export function shortLabelForProvider(provider: string): string {
  if (provider === "gemini-cli") return "Gemini";
  if (provider === "codex-cli") return "Codex";
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "custom") return "Custom";
  return labelForProvider(provider);
}

export function compactModelLabel(provider: string, model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "-";

  if (provider === "gemini-cli") {
    return trimmed
      .replace(/^auto-gemini-/, "auto-")
      .replace(/^gemini-/, "")
      .replace(/-pro-preview-customtools$/, " preview+")
      .replace(/-pro-preview$/, " preview")
      .replace(/-flash-preview$/, " flash preview")
      .replace(/-flash-lite$/, " flash lite")
      .replace(/-flash$/, " flash")
      .replace(/-pro$/, " pro");
  }

  if (provider === "codex-cli" || provider === "openai" || provider === "custom") {
    return trimmed
      .replace(/^gpt-/, "")
      .replace(/-mini$/, " mini")
      .replace(/-preview$/, " preview");
  }

  return trimmed;
}

export const FALLBACK_MODEL_SUGGESTIONS: Record<Exclude<LlmProvider, "">, ReadonlyArray<string>> = {
  "openai": ["gpt-5.4", "gpt-5.4-mini", "gpt-4.1"],
  "anthropic": ["claude-sonnet-4-0", "claude-3-7-sonnet-latest"],
  "custom": ["gpt-5.4", "gpt-5.4-mini", "gemini-2.5-pro"],
  "gemini-cli": ["gemini-3.1-pro-preview"],
  "codex-cli": ["gpt-5.4"],
};

export const FALLBACK_REASONING_EFFORTS: Record<Exclude<LlmProvider, "">, ReadonlyArray<SupportedReasoningEffort>> = {
  "openai": ["low", "medium", "high"],
  "anthropic": [],
  "custom": ["low", "medium", "high"],
  "gemini-cli": [],
  "codex-cli": ["none", "minimal", "low", "medium", "high", "xhigh"],
};

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return value === "none"
    || value === "minimal"
    || value === "low"
    || value === "medium"
    || value === "high"
    || value === "xhigh"
    ? value
    : "";
}

export function normalizeReasoningEffortForProvider(
  value: unknown,
  provider: string,
  capabilities?: LlmCapabilitiesSummary | null,
): ReasoningEffort {
  const normalized = normalizeReasoningEffort(value);
  if (!normalized) {
    return "";
  }

  return reasoningEffortsForProvider(provider, capabilities).includes(normalized)
    ? normalized
    : "";
}

function uniqueStrings(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function providerCapability(
  provider: string,
  capabilities?: LlmCapabilitiesSummary | null,
): ProviderCapability | null {
  if (!provider) return null;
  return capabilities?.providers[provider as Exclude<LlmProvider, "">] ?? null;
}

export function modelSuggestionsForProvider(
  provider: string,
  capabilities?: LlmCapabilitiesSummary | null,
): ReadonlyArray<string> {
  const capability = providerCapability(provider, capabilities);
  if (capability?.models.length) {
    return uniqueStrings(capability.models);
  }
  const fallback = provider && provider in FALLBACK_MODEL_SUGGESTIONS
    ? FALLBACK_MODEL_SUGGESTIONS[provider as keyof typeof FALLBACK_MODEL_SUGGESTIONS]
    : [];
  return uniqueStrings(fallback);
}

export function reasoningEffortsForProvider(
  provider: string,
  capabilities?: LlmCapabilitiesSummary | null,
): ReadonlyArray<SupportedReasoningEffort> {
  const capability = providerCapability(provider, capabilities);
  if (capability?.reasoningEfforts.length) {
    return uniqueStrings(capability.reasoningEfforts) as SupportedReasoningEffort[];
  }
  const fallback = provider && provider in FALLBACK_REASONING_EFFORTS
    ? FALLBACK_REASONING_EFFORTS[provider as keyof typeof FALLBACK_REASONING_EFFORTS]
    : [];
  return uniqueStrings(fallback) as SupportedReasoningEffort[];
}

export function supportsReasoningEffort(
  provider: string,
  capabilities?: LlmCapabilitiesSummary | null,
): boolean {
  return reasoningEffortsForProvider(provider, capabilities).length > 0;
}

export function defaultModelForProvider(
  provider: string,
  capabilities?: LlmCapabilitiesSummary | null,
): string {
  const discovered = providerCapability(provider, capabilities)?.defaultModel ?? "";
  if (discovered) return discovered;
  const fallback = provider && provider in FALLBACK_MODEL_SUGGESTIONS
    ? FALLBACK_MODEL_SUGGESTIONS[provider as keyof typeof FALLBACK_MODEL_SUGGESTIONS][0]
    : "";
  return fallback ?? "";
}

export function isCliOAuthProvider(provider: string): provider is CliOAuthProvider {
  return provider === "gemini-cli" || provider === "codex-cli";
}
