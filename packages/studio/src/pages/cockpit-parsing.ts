import type { TFunction } from "../hooks/use-i18n";
import { makeTruthPreview } from "../shared/truth-assistant";
import type { CockpitMode } from "./cockpit-ui-state";

export type ComposerAction = "discuss" | "ask" | "propose" | "draft" | "write-next" | "create";

export interface MessageForTranscript {
  readonly role: "user" | "assistant" | "system" | string;
  readonly content: string;
}

export function buildConversationTranscript(messages: ReadonlyArray<MessageForTranscript>): string {
  return messages
    .slice(-8)
    .map((message) => `${message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System"}: ${message.content}`)
    .join("\n");
}

export function parseComposerCommand(input: string): { action: ComposerAction; text: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const [command, ...rest] = trimmed.split(/\s+/);
  const text = rest.join(" ").trim();

  switch (command.toLowerCase()) {
    case "/ask": {
      return { action: "ask", text };
    }
    case "/propose": {
      return { action: "propose", text };
    }
    case "/draft": {
      return { action: "draft", text };
    }
    case "/write":
    case "/write-next": {
      return { action: "write-next", text };
    }
    case "/create": {
      return { action: "create", text };
    }
    case "/discuss": {
      return { action: "discuss", text };
    }
    default:
      return null;
  }
}

export function defaultActionForMode(mode: CockpitMode): ComposerAction {
  if (mode === "binder") return "ask";
  if (mode === "draft") return "draft";
  return "discuss";
}

export function summarizeProposal(changes: ReadonlyArray<{ readonly label: string; readonly content: string }>): string {
  if (!changes.length) return "";
  return changes
    .map((change) => `${change.label}\n${makeTruthPreview(change.content, 140)}`)
    .join("\n\n");
}

export function extractWordCount(value: string, fallback?: number): number | undefined {
  const match = value.trim().match(/\b(\d{3,5})\b/);
  if (match) return parseInt(match[1]!, 10);
  return fallback;
}

export function renderChapterStatus(status: string): string {
  switch (status) {
    case "approved":
      return "approved";
    case "drafted":
      return "drafted";
    case "rejected":
      return "rejected";
    default:
      return status;
  }
}

export function formatReasoningEffortLabel(value: string, t: TFunction): string {
  if (value === "none") return t("config.reasoningNone");
  if (value === "minimal") return t("config.reasoningMinimal");
  if (value === "low") return t("config.reasoningLow");
  if (value === "medium") return t("config.reasoningMedium");
  if (value === "high") return t("config.reasoningHigh");
  if (value === "xhigh") return t("config.reasoningXHigh");
  return value;
}
