import { useState } from "react";
import { fetchJson, postApi } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";
import type { TruthAssistResponse } from "../shared/contracts";
import {
  buildConversationTranscript,
  extractWordCount,
  summarizeProposal,
  type ComposerAction,
} from "./cockpit-parsing";
import {
  createMessage,
  type CockpitMessage,
  type InspectorTab,
  type ProposalState,
} from "./cockpit-shared";

interface UseCockpitConversationInput {
  readonly activeThreadKey: string;
  readonly selectedBookId: string;
  readonly selectedBookTitle: string | null;
  readonly selectedTruthFile: string;
  readonly selectedChapterNumber: number | null;
  readonly setupScopeRef: {
    current: {
      readonly projectLanguage: string;
      readonly setupTitle: string;
      readonly setupGenre: string;
      readonly setupPlatform: string;
      readonly setupBrief: string;
    };
  };
  readonly defaultChapterWordCount?: number;
  readonly t: TFunction;
  readonly setBusy: (busy: boolean) => void;
  readonly setError: (error: string | null) => void;
  readonly setInspectorTab: (tab: InspectorTab) => void;
  readonly refetchTruthList: () => Promise<unknown> | unknown;
  readonly refetchTruthDetail: () => Promise<unknown> | unknown;
  readonly refetchBookDetail: () => Promise<unknown> | unknown;
}

interface SendDiscussOptions {
  readonly threadKey?: string;
  readonly forceSetup?: boolean;
}

export function useCockpitConversation(input: UseCockpitConversationInput) {
  const [threads, setThreads] = useState<Record<string, ReadonlyArray<CockpitMessage>>>({});
  const [proposals, setProposals] = useState<Record<string, ProposalState>>({});

  const activeMessages = threads[input.activeThreadKey] ?? [];
  const activeProposal = proposals[input.activeThreadKey];
  const hasPendingChanges = Boolean(activeProposal?.changes.length);

  const appendMessage = (key: string, message: CockpitMessage) => {
    setThreads((current) => ({
      ...current,
      [key]: [...(current[key] ?? []), message],
    }));
  };

  const replaceProposal = (key: string, proposal: ProposalState | null) => {
    setProposals((current) => {
      if (!proposal) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: proposal };
    });
  };

  const replaceThread = (key: string, messages: ReadonlyArray<CockpitMessage>) => {
    setThreads((current) => ({
      ...current,
      [key]: [...messages],
    }));
  };

  const clearProposal = (key: string) => {
    replaceProposal(key, null);
  };

  const sendDiscussPrompt = async (rawText: string, options?: SendDiscussOptions) => {
    const text = rawText.trim();
    if (!text) return;

    const threadKey = options?.threadKey ?? input.activeThreadKey;
    const threadMessages = threads[threadKey] ?? [];
    const useSetupScope = options?.forceSetup ?? false;
    const userMessage = createMessage("user", text);
    appendMessage(threadKey, userMessage);

    const scopeBlock = !useSetupScope && input.selectedBookId
      ? [
          `Current book: ${input.selectedBookTitle ?? input.selectedBookId}`,
          input.selectedTruthFile ? `Focused binder file: ${input.selectedTruthFile}` : "",
          input.selectedChapterNumber ? `Focused chapter: ${input.selectedChapterNumber}` : "",
        ].filter(Boolean).join("\n")
      : [
          `Project language: ${input.setupScopeRef.current.projectLanguage}`,
          input.setupScopeRef.current.setupTitle ? `Setup title: ${input.setupScopeRef.current.setupTitle}` : "",
          input.setupScopeRef.current.setupGenre ? `Setup genre: ${input.setupScopeRef.current.setupGenre}` : "",
          input.setupScopeRef.current.setupPlatform ? `Setup platform: ${input.setupScopeRef.current.setupPlatform}` : "",
          input.setupScopeRef.current.setupBrief ? `Setup brief:\n${input.setupScopeRef.current.setupBrief}` : "",
        ].filter(Boolean).join("\n");

    const instruction = [
      "You are helping plan and steer a novel inside InkOS Studio.",
      "Stay in discussion mode. Do not claim to edit files or commit changes.",
      "Ask clarifying questions when needed, summarize alignment clearly, and suggest the next concrete step.",
      scopeBlock ? `Context:\n${scopeBlock}` : "",
      threadMessages.length > 0 ? `Recent conversation:\n${buildConversationTranscript(threadMessages)}` : "",
      `User request:\n${text}`,
    ].filter(Boolean).join("\n\n");

    input.setBusy(true);
    input.setError(null);
    try {
      const response = await postApi<{ response?: string; error?: string }>("/agent", { instruction });
      appendMessage(threadKey, createMessage("assistant", response.response ?? response.error ?? ""));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      input.setError(message);
      appendMessage(threadKey, createMessage("system", message));
    } finally {
      input.setBusy(false);
    }
  };

  const sendBinderPrompt = async (rawText: string, action: "ask" | "propose") => {
    const text = rawText.trim();
    if (!input.selectedBookId || !input.selectedTruthFile) {
      input.setError(input.t("cockpit.noBook"));
      return;
    }
    if (!text) return;

    const userMessage = createMessage("user", text);
    appendMessage(input.activeThreadKey, userMessage);

    input.setBusy(true);
    input.setError(null);
    try {
      const response = await fetchJson<TruthAssistResponse>(`/books/${input.selectedBookId}/truth/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: input.selectedTruthFile,
          scope: {
            kind: "file",
            fileName: input.selectedTruthFile,
          },
          instruction: text,
          mode: action === "ask" ? "question" : "proposal",
          conversation: [...activeMessages, userMessage]
            .filter((message) => message.role !== "system")
            .map((message) => ({ role: message.role, content: message.content })),
        }),
      });

      if (action === "ask" || response.mode === "question" || response.question) {
        appendMessage(input.activeThreadKey, createMessage("assistant", response.question ?? response.content));
        replaceProposal(input.activeThreadKey, null);
        input.setInspectorTab("focus");
        return;
      }

      const changes = response.changes ?? [];
      replaceProposal(input.activeThreadKey, {
        changes,
        createdAt: Date.now(),
      });
      input.setInspectorTab("changes");
      appendMessage(input.activeThreadKey, createMessage("assistant", summarizeProposal(changes)));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      input.setError(message);
      appendMessage(input.activeThreadKey, createMessage("system", message));
    } finally {
      input.setBusy(false);
    }
  };

  const triggerDraftAction = async (rawText: string, action: Extract<ComposerAction, "draft" | "write-next">) => {
    if (!input.selectedBookId || !input.defaultChapterWordCount) {
      input.setError(input.t("cockpit.noBook"));
      return;
    }

    const text = rawText.trim();
    if (text) {
      appendMessage(input.activeThreadKey, createMessage("user", text));
    }

    const body = action === "draft"
      ? {
          context: text || undefined,
          wordCount: extractWordCount(text, input.defaultChapterWordCount),
        }
      : {
          wordCount: extractWordCount(text, input.defaultChapterWordCount),
        };

    input.setBusy(true);
    input.setError(null);
    try {
      await postApi(`/books/${input.selectedBookId}/${action === "draft" ? "draft" : "write-next"}`, body);
      appendMessage(
        input.activeThreadKey,
        createMessage(
          "system",
          action === "draft"
            ? `${input.t("cockpit.generateDraft")} queued for ${input.selectedBookTitle ?? input.selectedBookId}.`
            : `${input.t("cockpit.writeNext")} queued for ${input.selectedBookTitle ?? input.selectedBookId}.`,
        ),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      input.setError(message);
      appendMessage(input.activeThreadKey, createMessage("system", message));
    } finally {
      input.setBusy(false);
    }
  };

  const handleApplyChange = async (fileName: string, content: string) => {
    if (!input.selectedBookId) return;
    input.setBusy(true);
    input.setError(null);
    try {
      await fetchJson(`/books/${input.selectedBookId}/truth/${fileName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          scope: {
            kind: "file",
            fileName,
          },
        }),
      });
      appendMessage(input.activeThreadKey, createMessage("system", `${input.t("cockpit.apply")} ${fileName}`));
      const nextChanges = (activeProposal?.changes ?? []).filter((change) => change.fileName !== fileName);
      replaceProposal(input.activeThreadKey, nextChanges.length ? { changes: nextChanges, createdAt: Date.now() } : null);
      input.setInspectorTab(nextChanges.length ? "changes" : "focus");
      await Promise.all([
        Promise.resolve(input.refetchTruthList()),
        Promise.resolve(input.refetchTruthDetail()),
        Promise.resolve(input.refetchBookDetail()),
      ]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      input.setError(message);
      appendMessage(input.activeThreadKey, createMessage("system", message));
    } finally {
      input.setBusy(false);
    }
  };

  const handleApplyAll = async () => {
    if (!activeProposal?.changes.length) return;
    for (const change of activeProposal.changes) {
      // Sequential writes keep the UI consistent with single-file apply semantics.
      // eslint-disable-next-line no-await-in-loop
      await handleApplyChange(change.fileName, change.content);
    }
  };

  return {
    threads,
    activeMessages,
    activeProposal,
    hasPendingChanges,
    appendMessage,
    replaceThread,
    clearProposal,
    sendDiscussPrompt,
    sendBinderPrompt,
    triggerDraftAction,
    handleApplyChange,
    handleApplyAll,
  };
}
