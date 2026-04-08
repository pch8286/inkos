export type CliOAuthProvider = "gemini-cli" | "codex-cli";

export type LlmProvider = "openai" | "anthropic" | "custom" | CliOAuthProvider | "";

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

export const MODEL_SUGGESTIONS: Record<Exclude<LlmProvider, "">, ReadonlyArray<string>> = {
  "openai": ["gpt-5.4", "gpt-5.4-mini", "gpt-4.1"],
  "anthropic": ["claude-sonnet-4-0", "claude-3-7-sonnet-latest"],
  "custom": ["gpt-5.4", "gpt-5.4-mini", "gemini-2.5-pro"],
  "gemini-cli": ["auto-gemini-3", "gemini-2.5-pro", "gemini-2.5-flash"],
  "codex-cli": ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark"],
};

export function defaultModelForProvider(provider: string): string {
  return provider === "gemini-cli"
    ? "auto-gemini-3"
    : provider === "codex-cli"
      ? "gpt-5.4"
      : "";
}

export function isCliOAuthProvider(provider: string): provider is CliOAuthProvider {
  return provider === "gemini-cli" || provider === "codex-cli";
}
