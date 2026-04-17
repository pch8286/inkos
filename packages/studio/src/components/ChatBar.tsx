import { useState, useRef, useEffect, useMemo } from "react";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { cn } from "../lib/utils";
import { fetchJson, postApi, putApi, useApi } from "../hooks/use-api";
import type { TruthAssistResponse, TruthFileDetail, TruthWriteScope } from "../shared/contracts";
import type { TruthAssistantContext } from "../shared/truth-assistant";
import {
  buildTruthLineDiff,
  makeTruthPreview,
  normalizeTruthText,
  resolveTruthTargetsForSubmit,
  summarizeTruthDiff,
  truthThreadKey,
} from "../shared/truth-assistant";
import { readStoredTruthThreads, writeStoredTruthThreads, type StoredTruthThreads } from "../shared/truth-session";
import { buildTruthAssistRequest, isTruthProposalApplicable } from "../shared/truth-write-scope";
import { mergeInterviewAnswerIntoAlignmentContext } from "../shared/truth-workspace";
import {
  compactModelLabel,
  defaultModelForProvider,
  modelSuggestionsForProvider,
  normalizeReasoningEffortForProvider,
  reasoningEffortsForProvider,
  shortLabelForProvider,
  supportsReasoningEffort,
  type LlmCapabilitiesSummary,
  type ReasoningEffort,
} from "../shared/llm";
import {
  Sparkles,
  Trash2,
  PanelRightClose,
  ArrowUp,
  Loader2,
  MessageSquare,
  Lightbulb,
  User,
  CheckCircle2,
  XCircle,
  BotMessageSquare,
  BadgeCheck,
  CircleAlert,
  CircleHelp,
  Brain,
  PenTool,
  Shield,
  Wrench,
  AlertTriangle,
  Zap,
  Search,
  FileOutput,
  TrendingUp,
  WandSparkles,
  Settings2,
} from "lucide-react";

interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: number;
}

interface TruthProposalChange {
  readonly fileName: string;
  readonly label: string;
  readonly beforeContent: string;
  readonly content: string;
  readonly preview: string;
}

type TruthRole = "user" | "assistant";
type TruthMessageKind = "chat" | "proposal" | "clarification" | "question";
type TruthSubmitMode = "proposal" | "question";

interface TruthMessage {
  readonly id: string;
  readonly role: TruthRole;
  readonly content: string;
  readonly createdAt: number;
  readonly kind: TruthMessageKind;
  readonly targetFiles: ReadonlyArray<string>;
  readonly changes?: ReadonlyArray<TruthProposalChange>;
}

type TruthThreads = Readonly<Record<string, ReadonlyArray<TruthMessage>>>;

interface BookRef {
  readonly id: string;
}

interface ProjectLlmSummary {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

export function resolveDirectWriteTarget(
  activeBookId: string | undefined,
  books: ReadonlyArray<BookRef>,
): { bookId: string | null; reason: "active" | "single" | "missing" | "ambiguous" } {
  if (activeBookId && books.some((book) => book.id === activeBookId)) {
    return { bookId: activeBookId, reason: "active" };
  }
  if (books.length === 1) {
    return { bookId: books[0]!.id, reason: "single" };
  }
  if (books.length === 0) {
    return { bookId: null, reason: "missing" };
  }
  return { bookId: null, reason: "ambiguous" };
}

export function resolveTruthAssistScope(
  context: Pick<TruthAssistantContext, "writeScope"> | null | undefined,
  fileNames: ReadonlyArray<string>,
  mode: TruthSubmitMode,
): TruthWriteScope {
  const scope = context?.writeScope ?? { kind: "read-only" };
  if (mode === "question") {
    return scope;
  }
  if (fileNames.length !== 1) {
    return { kind: "read-only" };
  }
  return isTruthProposalApplicable(scope, fileNames[0]!) ? scope : { kind: "read-only" };
}

function addTruthMessage(
  threads: TruthThreads,
  key: string,
  message: TruthMessage,
): TruthThreads {
  return {
    ...threads,
    [key]: [...(threads[key] ?? []), message],
  };
}

function clearTruthThread(
  threads: TruthThreads,
  key: string,
): TruthThreads {
  if (!(key in threads)) {
    return threads;
  }
  const next = { ...threads };
  delete next[key];
  return next;
}

function buildTruthAlignmentBlock(alignment: TruthAssistantContext["alignment"] | null | undefined): string {
  if (!alignment) return "";
  const parts = [
    alignment.knownFacts.length > 0
      ? `Known facts:\n${alignment.knownFacts.map((item) => `- ${item}`).join("\n")}`
      : "",
    alignment.unknowns.length > 0
      ? `Unknowns:\n${alignment.unknowns.map((item) => `- ${item}`).join("\n")}`
      : "",
    alignment.mustDecide ? `Must decide:\n${alignment.mustDecide}` : "",
    alignment.askFirst ? `Ask first:\n${alignment.askFirst}` : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}

function extractTruthQuestionPrompt(value: string): string {
  return value.split("\n\n")[0]?.trim() ?? value.trim();
}

function lineTone(type: "context" | "add" | "remove" | "skip"): string {
  if (type === "add") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (type === "remove") return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (type === "skip") return "bg-background/70 text-muted-foreground";
  return "bg-transparent text-foreground/80";
}

function StatusIcon({ phase }: { readonly phase: string }) {
  const lower = phase.toLowerCase();

  if (lower.includes("think") || lower.includes("plan"))
    return <Brain size={14} className="text-purple-500 animate-pulse" />;
  if (lower.includes("writ") || lower.includes("draft") || lower.includes("stream"))
    return <PenTool size={14} className="text-blue-500 chat-icon-write" />;
  if (lower.includes("audit") || lower.includes("review"))
    return <Shield size={14} className="text-amber-500 animate-pulse" />;
  if (lower.includes("revis") || lower.includes("fix") || lower.includes("spot"))
    return <Wrench size={14} className="text-orange-500 chat-icon-spin-slow" />;
  if (lower.includes("complet") || lower.includes("done") || lower.includes("success"))
    return <CheckCircle2 size={14} className="text-emerald-500 chat-icon-pop" />;
  if (lower.includes("error") || lower.includes("fail"))
    return <AlertTriangle size={14} className="text-destructive animate-pulse" />;
  return <Loader2 size={14} className="text-primary animate-spin" />;
}

function EmptyState({
  truthMode,
  t,
}: {
  readonly truthMode: boolean;
  readonly t: TFunction;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center opacity-40 select-none fade-in">
      <div className="w-14 h-14 rounded-2xl border border-dashed border-border flex items-center justify-center mb-4 bg-secondary/30">
        {truthMode ? <WandSparkles size={24} className="text-muted-foreground" /> : <BotMessageSquare size={24} className="text-muted-foreground" />}
      </div>
      <p className="text-sm italic font-serif mb-1">
        {truthMode ? t("truth.agentEmpty") : "How shall we proceed today?"}
      </p>
      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">
        {truthMode ? t("truth.agentHint") : "Type a command below"}
      </p>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex gap-2.5 chat-msg-assistant">
      <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center shrink-0 chat-thinking-glow">
        <Brain size={14} className="text-primary animate-pulse" />
      </div>
      <div className="bg-card border border-border/50 px-3.5 py-2.5 rounded-2xl rounded-tl-sm flex gap-1.5 items-center">
        <span className="w-1.5 h-1.5 bg-primary/50 rounded-full chat-typing-dot" />
        <span className="w-1.5 h-1.5 bg-primary/50 rounded-full chat-typing-dot" />
        <span className="w-1.5 h-1.5 bg-primary/50 rounded-full chat-typing-dot" />
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { readonly msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const isStatus = msg.content.startsWith("⋯");
  const isSuccess = msg.content.startsWith("✓");
  const isError = msg.content.startsWith("✗");

  return (
    <div className={cn(
      "flex gap-2.5",
      isUser ? "flex-row-reverse chat-msg-user" : "chat-msg-assistant",
    )}>
      <div className={cn(
        "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-colors",
        isUser ? "bg-primary/10" : "bg-secondary",
      )}>
        {isUser ? (
          <User size={14} className="text-primary" />
        ) : isSuccess ? (
          <CheckCircle2 size={14} className="text-emerald-500 chat-icon-pop" />
        ) : isError ? (
          <XCircle size={14} className="text-destructive" />
        ) : isStatus ? (
          <Loader2 size={14} className="text-primary animate-spin" />
        ) : (
          <Sparkles size={14} className="text-primary" />
        )}
      </div>

      <div className={cn(
        "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm",
        isUser
          ? "bg-primary text-primary-foreground font-medium rounded-tr-sm"
          : isStatus
            ? "bg-secondary/50 border border-border/30 text-muted-foreground font-mono text-xs rounded-tl-sm"
            : "bg-card border border-border/50 text-foreground font-serif rounded-tl-sm",
      )}>
        {isSuccess && (
          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-sans font-medium text-[10px] mb-1 uppercase tracking-wider">
            <BadgeCheck size={11} />
            Complete
          </span>
        )}
        {isError && (
          <span className="flex items-center gap-1.5 text-destructive font-sans font-medium text-[10px] mb-1 uppercase tracking-wider">
            <CircleAlert size={11} />
            Error
          </span>
        )}

        <div>{msg.content}</div>

        <div className={cn(
          "text-[9px] mt-1.5 font-mono",
          isUser ? "text-primary-foreground/40" : "text-muted-foreground/40",
        )}>
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}

function TruthMessageCard({
  message,
  t,
  onApplySuggestion,
  onApplyAll,
}: {
  readonly message: TruthMessage;
  readonly t: TFunction;
  readonly onApplySuggestion: (fileName: string, content: string) => void;
  readonly onApplyAll: (changes: ReadonlyArray<TruthProposalChange>) => void;
}) {
  if (message.kind !== "proposal") {
    const isUser = message.role === "user";
    const isQuestion = message.kind === "question";
    return (
      <article
        className={`rounded-xl border px-3 py-3 ${
          isUser
            ? "border-secondary/40 bg-secondary/50"
            : isQuestion
              ? "border-primary/30 bg-primary/5"
              : "border-border/50 bg-background/40"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {isUser ? "You" : "Assistant"}
            </span>
            {isQuestion && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {t("truth.agentQuestionBadge")}
              </span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        {message.targetFiles.length > 0 && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            {message.targetFiles.join(", ")}
          </div>
        )}
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
      </article>
    );
  }

  const changes = message.changes ?? [];
  return (
    <article className="rounded-xl border border-border/50 bg-card/75 p-3 text-xs text-foreground">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-muted-foreground">
            {changes.length > 1 ? `${t("truth.agentBundleSummary")} · ${changes.length}` : t("truth.agentPreview")}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("truth.agentAppliedHint")}</p>
        </div>
        <div className="flex items-center gap-2">
          {changes.length > 1 && (
            <button
              type="button"
              onClick={() => onApplyAll(changes)}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground transition-opacity hover:opacity-90"
            >
              {t("truth.agentApplyAll")}
            </button>
          )}
          <span className="text-[10px] text-muted-foreground">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {changes.map((change) => {
          const lines = buildTruthLineDiff(change.beforeContent, change.content);
          const summary = summarizeTruthDiff(lines);
          return (
            <div key={`${message.id}-${change.fileName}`} className="rounded-xl border border-border/40 bg-background/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-foreground">{change.label}</div>
                  <div className="text-[11px] text-muted-foreground">{change.fileName}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                    +{summary.added}
                  </span>
                  <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-300">
                    -{summary.removed}
                  </span>
                  <button
                    type="button"
                    onClick={() => onApplySuggestion(change.fileName, change.content)}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    {t("truth.agentApply")}
                  </button>
                </div>
              </div>

              <div className="mt-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {t("truth.agentDiff")}
              </div>
              <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border/40 bg-card/70">
                {lines.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-muted-foreground">{t("truth.previewEmpty")}</div>
                ) : (
                  <div className="divide-y divide-border/20 font-mono text-[11px] leading-5">
                    {lines.map((line, index) => (
                      <div
                        key={`${change.fileName}-${index}-${line.type}`}
                        className={`grid grid-cols-[2.5rem_2.5rem_1rem_minmax(0,1fr)] gap-2 px-3 py-1.5 ${lineTone(line.type)}`}
                      >
                        <span className="text-right text-muted-foreground/80">{line.beforeLine ?? ""}</span>
                        <span className="text-right text-muted-foreground/80">{line.afterLine ?? ""}</span>
                        <span className="text-center">
                          {line.type === "add" ? "+" : line.type === "remove" ? "-" : line.type === "skip" ? "…" : " "}
                        </span>
                        <span className="whitespace-pre-wrap break-words">{line.text || " "}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function QuickChip({ icon, label, onClick }: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-secondary/50 border border-border/30 text-[10px] font-medium text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all group"
    >
      <span className="group-hover:scale-110 transition-transform">{icon}</span>
      {label}
    </button>
  );
}

export function ChatPanel({
  open,
  onClose,
  onOpenConfig,
  t,
  sse,
  activeBookId,
  truthContext,
  width,
  isResizing = false,
  onResizeStart,
  onResizeNudge,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onOpenConfig?: () => void;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
  readonly activeBookId?: string;
  readonly truthContext?: TruthAssistantContext | null;
  readonly width: number;
  readonly isResizing?: boolean;
  readonly onResizeStart?: (clientX: number) => void;
  readonly onResizeNudge?: (delta: number) => void;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ReadonlyArray<ChatMessage>>([]);
  const [truthThreads, setTruthThreads] = useState<TruthThreads>({});
  const [loading, setLoading] = useState(false);
  const [truthSending, setTruthSending] = useState(false);
  const [truthError, setTruthError] = useState<string | null>(null);
  const [assistantLlmForm, setAssistantLlmForm] = useState<{ model: string; reasoningEffort: ReasoningEffort }>({
    model: "",
    reasoningEffort: "",
  });
  const [assistantLlmSaving, setAssistantLlmSaving] = useState(false);
  const [assistantLlmError, setAssistantLlmError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hydratedTruthBooksRef = useRef<Set<string>>(new Set());
  const skipTruthThreadPersistRef = useRef<Set<string>>(new Set());
  const { data: projectLlm, refetch: refetchProjectLlm } = useApi<ProjectLlmSummary>("/project");
  const { data: llmCapabilities } = useApi<LlmCapabilitiesSummary>("/llm-capabilities");
  const truthMode = Boolean(truthContext);
  const truthKey = truthContext ? truthThreadKey(truthContext) : "";
  const truthThread = useMemo(() => truthContext ? (truthThreads[truthKey] ?? []) : [], [truthContext, truthKey, truthThreads]);
  const lastTruthMessage = truthThread[truthThread.length - 1];
  const awaitingTruthAnswer = lastTruthMessage?.role === "assistant" && lastTruthMessage.kind === "question";
  const trimmedTruthInput = truthMode ? normalizeTruthText(input) : "";
  const projectProvider = projectLlm?.provider ?? "";
  const projectModel = (projectLlm?.model ?? "").trim() || defaultModelForProvider(projectProvider, llmCapabilities) || "";
  const projectReasoningEffort = normalizeReasoningEffortForProvider(
    projectLlm?.reasoningEffort ?? "",
    projectProvider,
    llmCapabilities,
  );
  const assistantModelSuggestions = useMemo(
    () => modelSuggestionsForProvider(projectProvider, llmCapabilities),
    [llmCapabilities, projectProvider],
  );
  const assistantReasoningEfforts = useMemo(
    () => reasoningEffortsForProvider(projectProvider, llmCapabilities),
    [llmCapabilities, projectProvider],
  );
  const assistantSupportsReasoning = supportsReasoningEffort(projectProvider, llmCapabilities);
  const assistantModelListId = useMemo(
    () => `assistant-model-suggestions-${projectProvider || "default"}`,
    [projectProvider],
  );
  const assistantLlmDirty = assistantLlmForm.model.trim() !== projectModel
    || assistantLlmForm.reasoningEffort !== projectReasoningEffort;
  const truthAlignmentSummary = useMemo(() => {
    if (!truthContext?.alignment) return [];
    return [
      truthContext.alignment.knownFacts.length > 0 ? `${t("truth.knownFacts")} ${truthContext.alignment.knownFacts.length}` : "",
      truthContext.alignment.unknowns.length > 0 ? `${t("truth.unknowns")} ${truthContext.alignment.unknowns.length}` : "",
      truthContext.alignment.mustDecide ? t("truth.mustDecide") : "",
      truthContext.alignment.askFirst ? t("truth.questionQueue") : "",
    ].filter(Boolean);
  }, [t, truthContext?.alignment]);
  const canRequestTruthQuestion = Boolean(
    trimmedTruthInput
    || truthContext?.alignment?.askFirst
    || truthContext?.alignment?.unknowns.length
    || truthContext?.detailFile
    || truthContext?.workspaceTargetFile,
  );
  const hasWritableTruthScope = truthContext?.writeScope?.kind === "file";
  const canRequestTruthProposal = awaitingTruthAnswer
    ? Boolean(trimmedTruthInput && hasWritableTruthScope)
    : Boolean((trimmedTruthInput || truthContext?.alignment?.mustDecide) && hasWritableTruthScope);

  useEffect(() => {
    setAssistantLlmForm({
      model: projectModel,
      reasoningEffort: projectReasoningEffort,
    });
  }, [projectModel, projectReasoningEffort, projectProvider]);

  useEffect(() => {
    setAssistantLlmError(null);
  }, [assistantLlmForm.model, assistantLlmForm.reasoningEffort]);

  useEffect(() => {
    setTruthError(null);
  }, [truthKey, truthMode]);

  useEffect(() => {
    if (!truthContext || hydratedTruthBooksRef.current.has(truthContext.bookId)) {
      return;
    }
    const stored = readStoredTruthThreads(truthContext.bookId);
    hydratedTruthBooksRef.current.add(truthContext.bookId);
    if (!stored) {
      return;
    }
    skipTruthThreadPersistRef.current.add(truthContext.bookId);
    setTruthThreads((current) => ({ ...stored.threads, ...current }));
  }, [truthContext]);

  useEffect(() => {
    if (!truthContext) {
      return;
    }
    if (skipTruthThreadPersistRef.current.has(truthContext.bookId)) {
      skipTruthThreadPersistRef.current.delete(truthContext.bookId);
      return;
    }
    const bookThreads = Object.fromEntries(
      Object.entries(truthThreads).filter(([key]) => key.startsWith(`truth:${truthContext.bookId}:`)),
    );
    writeStoredTruthThreads(truthContext.bookId, {
      version: 1,
      threads: bookThreads,
    } satisfies StoredTruthThreads);
  }, [truthContext, truthThreads]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, sse.messages.length, truthThread.length, truthSending]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open, truthMode]);

  useEffect(() => {
    const recent = sse.messages.slice(-1)[0];
    if (!recent || recent.event === "ping") return;

    const d = recent.data as Record<string, unknown>;

    if (recent.event === "write:complete" || recent.event === "draft:complete") {
      setLoading(false);
      const title = d.title ?? `Chapter ${d.chapterNumber}`;
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `✓ ${title} (${(d.wordCount as number)?.toLocaleString() ?? "?"} chars)`,
        timestamp: Date.now(),
      }]);
    }
    if (recent.event === "write:error" || recent.event === "draft:error") {
      setLoading(false);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `✗ ${d.error ?? "Unknown error"}`,
        timestamp: Date.now(),
      }]);
    }
    if (recent.event === "log" && loading) {
      const msg = d.message as string;
      if (msg && (msg.includes("Phase") || msg.includes("streaming") || msg.includes("Writing") || msg.includes("Audit") || msg.includes("Revis"))) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.content.startsWith("⋯")) {
            return [...prev.slice(0, -1), { role: "assistant", content: `⋯ ${msg}`, timestamp: Date.now() }];
          }
          return [...prev, { role: "assistant", content: `⋯ ${msg}`, timestamp: Date.now() }];
        });
      }
    }
  }, [loading, sse.messages.length]);

  const currentPhase = useMemo(() => {
    const lastStatus = [...messages].reverse().find((m) => m.role === "assistant" && m.content.startsWith("⋯"));
    return lastStatus?.content.replace("⋯ ", "") ?? "Initializing...";
  }, [messages]);

  const saveAssistantLlm = async () => {
    if (!projectProvider) {
      return;
    }

    const nextModel = assistantLlmForm.model.trim() || defaultModelForProvider(projectProvider, llmCapabilities) || "";
    if (!nextModel) {
      setAssistantLlmError(t("config.modelRequired"));
      return;
    }

    setAssistantLlmSaving(true);
    setAssistantLlmError(null);
    try {
      await putApi("/project", {
        model: nextModel,
        reasoningEffort: normalizeReasoningEffortForProvider(
          assistantLlmForm.reasoningEffort,
          projectProvider,
          llmCapabilities,
        ) || "",
      });
      await refetchProjectLlm();
    } catch (error) {
      setAssistantLlmError(error instanceof Error ? error.message : String(error));
    } finally {
      setAssistantLlmSaving(false);
    }
  };

  const isZh = t("nav.connected") === "已连接";

  const handleGeneralSubmit = async (text: string) => {
    setMessages((prev) => [...prev, { role: "user", content: text, timestamp: Date.now() }]);
    setLoading(true);

    const lower = text.toLowerCase();

    try {
      if (lower.match(/^(写下一章|write next)/)) {
        const { books } = await fetchJson<{ books: ReadonlyArray<BookRef> }>("/books");
        const target = resolveDirectWriteTarget(activeBookId, books);

        if (target.bookId) {
          setMessages((prev) => [...prev, {
            role: "assistant",
            content: isZh ? `⋯ 开始处理《${target.bookId}》...` : `⋯ Starting ${target.bookId}...`,
            timestamp: Date.now(),
          }]);
          await postApi(`/books/${target.bookId}/write-next`, {});
          return;
        }

        setLoading(false);
        setMessages((prev) => [...prev, {
          role: "assistant",
          content:
            target.reason === "missing"
              ? (isZh ? "✗ 还没有书，先创建一本再写。" : "✗ No books yet. Create one first.")
              : (isZh ? "✗ 当前有多本书，请先打开目标书籍后再执行“写下一章”。" : '✗ Multiple books found. Open the target book first, then run "write next".'),
          timestamp: Date.now(),
        }]);
        return;
      }

      const data = await fetchJson<{ response?: string; error?: string }>("/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: text }),
      });
      setLoading(false);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: data.response ?? data.error ?? "Acknowledged.",
        timestamp: Date.now(),
      }]);
    } catch (e) {
      setLoading(false);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `✗ ${e instanceof Error ? e.message : String(e)}`,
        timestamp: Date.now(),
      }]);
    }
  };

  const handleTruthSubmit = async (text: string, submitMode: TruthSubmitMode) => {
    if (!truthContext) return;
    const interviewQuestion = awaitingTruthAnswer && submitMode === "proposal"
      ? extractTruthQuestionPrompt(lastTruthMessage?.content ?? "")
      : "";
    const effectiveAlignment = awaitingTruthAnswer && truthContext.alignment && text
      ? mergeInterviewAnswerIntoAlignmentContext(truthContext.alignment, {
        question: interviewQuestion,
        answer: text,
      })
      : truthContext.alignment ?? null;
    const instruction = submitMode === "question"
      ? text || effectiveAlignment?.askFirst || effectiveAlignment?.unknowns[0] || t("truth.agentDefaultQuestionRequest")
      : awaitingTruthAnswer
        ? effectiveAlignment?.mustDecide || t("truth.agentDefaultProposalRequest")
        : text || effectiveAlignment?.mustDecide || t("truth.agentDefaultProposalRequest");

    const userMessage: TruthMessage = {
      id: `truth-user-${Date.now()}-${Math.random()}`,
      role: "user",
      content: text || (submitMode === "question" ? t("truth.agentAskFirst") : t("truth.agentGenerateProposal")),
      createdAt: Date.now(),
      kind: "chat",
      targetFiles: [],
    };

    const inference = resolveTruthTargetsForSubmit(instruction, truthContext);
    if (inference.status === "clarify") {
      const labels = inference.suggestedFileNames
        .map((fileName) => truthContext.files.find((file) => file.name === fileName)?.label ?? fileName)
        .join(", ");
      const clarifyMessage: TruthMessage = {
        id: `clarify-${Date.now()}-${Math.random()}`,
        role: "assistant",
        content: `${t("truth.agentClarify")}\n${labels}`,
        createdAt: Date.now(),
        kind: "clarification",
        targetFiles: inference.suggestedFileNames,
      };
      setTruthThreads((current) => addTruthMessage(
        addTruthMessage(current, truthKey, userMessage),
        truthKey,
        clarifyMessage,
      ));
      return;
    }
    const resolvedUserMessage = { ...userMessage, targetFiles: inference.fileNames };
    setTruthThreads((current) => addTruthMessage(current, truthKey, resolvedUserMessage));
    setTruthError(null);
    const requestScope = resolveTruthAssistScope(truthContext, inference.fileNames, submitMode);
    if (submitMode === "proposal" && requestScope.kind !== "file") {
      const message = inference.fileNames.length === 1
        ? t("truth.agentSelectWritableFile")
        : t("truth.agentSingleFileProposalOnly");
      setTruthError(message);
      setTruthThreads((current) => addTruthMessage(current, truthKey, {
        id: `truth-scope-${Date.now()}-${Math.random()}`,
        role: "assistant",
        content: message,
        createdAt: Date.now(),
        kind: "chat",
        targetFiles: inference.fileNames,
      }));
      return;
    }
    setTruthSending(true);

    try {
      if (awaitingTruthAnswer && submitMode === "proposal" && text) {
        truthContext.applyInterviewAnswer(interviewQuestion || (lastTruthMessage?.content ?? ""), text);
      }

      const alignmentBlock = buildTruthAlignmentBlock(effectiveAlignment);
      const apiConversation = [
        ...truthThread,
        resolvedUserMessage,
        ...(alignmentBlock ? [{
          role: "user" as const,
          content: alignmentBlock,
          kind: "chat" as const,
          changes: undefined,
        }] : []),
      ].map((item) => ({
        role: item.role,
        content: item.kind === "proposal"
          ? item.changes?.map((change) => `${change.label}: ${change.preview}`).join("\n")
          : item.content,
      }));

      const payload = await fetchJson<TruthAssistResponse>(`/books/${truthContext.bookId}/truth/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTruthAssistRequest({
          fileNames: inference.fileNames,
          instruction,
          conversation: apiConversation,
          mode: submitMode,
          alignment: effectiveAlignment ?? undefined,
          scope: requestScope,
        })),
      });

      if ((payload.mode ?? submitMode) === "question" || payload.question) {
        const question = payload.question?.trim() || payload.content.trim();
        if (!question) {
          throw new Error("No clarifying question returned from assistant");
        }
        const assistantMessage: TruthMessage = {
          id: `truth-question-${Date.now()}-${Math.random()}`,
          role: "assistant",
          content: payload.rationale?.trim() ? `${question}\n\n${payload.rationale.trim()}` : question,
          createdAt: Date.now(),
          kind: "question",
          targetFiles: inference.fileNames,
        };
        setTruthThreads((current) => addTruthMessage(current, truthKey, assistantMessage));
        return;
      }

      const requestedFiles = (payload.changes ?? [])
        .map((change) => change.fileName)
        .filter((fileName): fileName is string => typeof fileName === "string" && fileName.length > 0);
      const baselineEntries = await Promise.all(
        requestedFiles.map(async (fileName) => {
          if (fileName in truthContext.currentContents) {
            return [fileName, truthContext.currentContents[fileName] ?? ""] as const;
          }
          try {
            const detail = await fetchJson<TruthFileDetail>(`/books/${truthContext.bookId}/truth/${fileName}`);
            return [fileName, detail.content ?? ""] as const;
          } catch {
            return [fileName, ""] as const;
          }
        }),
      );
      const baselines = Object.fromEntries(baselineEntries);

      const changes = (payload.changes ?? [])
        .filter((change) => typeof change.fileName === "string" && typeof change.content === "string")
        .map((change) => {
          const file = truthContext.files.find((entry) => entry.name === change.fileName);
          return {
            fileName: change.fileName,
            label: change.label || file?.label || change.fileName,
            beforeContent: baselines[change.fileName] ?? "",
            content: change.content,
            preview: makeTruthPreview(change.content),
          } satisfies TruthProposalChange;
        });

      if (changes.length === 0) {
        throw new Error("No proposal returned from assistant");
      }

      const assistantMessage: TruthMessage = {
        id: `truth-assistant-${Date.now()}-${Math.random()}`,
        role: "assistant",
        content: changes.map((change) => `${change.label}\n${change.preview}`).join("\n\n"),
        createdAt: Date.now(),
        kind: "proposal",
        targetFiles: changes.map((change) => change.fileName),
        changes,
      };
      setTruthThreads((current) => addTruthMessage(current, truthKey, assistantMessage));
    } catch (cause) {
      setTruthError(cause instanceof Error ? cause.message : `${cause}`);
    } finally {
      setTruthSending(false);
    }
  };

  const handleSubmit = async (modeOverride?: TruthSubmitMode) => {
    const text = truthMode ? trimmedTruthInput : input.trim();
    const truthSubmitMode = truthMode
      ? (modeOverride ?? (awaitingTruthAnswer ? "proposal" : "question"))
      : "proposal";
    if ((truthMode && truthSending) || (!truthMode && loading)) return;
    if (!truthMode && !text) return;
    if (truthMode && truthSubmitMode === "proposal" && awaitingTruthAnswer && !text) return;
    if (
      truthMode
      && !text
      && truthSubmitMode === "question"
      && !truthContext?.alignment?.askFirst
      && !truthContext?.alignment?.unknowns.length
      && !truthContext?.detailFile
      && !truthContext?.workspaceTargetFile
    ) return;

    setInput("");
    if (truthMode) {
      await handleTruthSubmit(text, truthSubmitMode);
      return;
    }
    await handleGeneralSubmit(text);
  };

  const handleQuickCommand = (command: string) => {
    setInput(command);
    setTimeout(() => {
      void handleSubmit();
    }, 50);
  };

  const TIPS_ZH = [
    "写下一章", "审计第5章", "帮我创建一本都市修仙小说",
    "扫描市场趋势", "导出全书为 epub", "分析文风 → 导入到我的书",
    "导入已有章节续写", "创建一个玄幻题材的同人", "修订第5章，spot-fix",
  ];
  const TIPS_EN = [
    "write next chapter", "audit chapter 5", "create a LitRPG novel",
    "scan market trends", "export book as epub", "analyze style → import",
    "import chapters to continue", "create a progression fantasy fanfic", "revise chapter 5, spot-fix",
  ];
  const tips = isZh ? TIPS_ZH : TIPS_EN;
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * tips.length));

  useEffect(() => {
    if (input || truthMode) return;
    const timer = setInterval(() => setTipIndex((i) => (i + 1) % tips.length), 8000);
    return () => clearInterval(timer);
  }, [input, tips.length, truthMode]);

  const truthHeaderTitle = truthMode ? t("truth.agentTitle") : "InkOS Assistant";
  const activeTruthWriteFile = truthContext?.writeScope?.kind === "file"
    ? truthContext.writeScope.fileName
    : null;
  const truthScopeLabel = activeTruthWriteFile
    ? truthContext?.files.find((file) => file.name === activeTruthWriteFile)?.label ?? activeTruthWriteFile
    : t("truth.readOnly");
  const truthScopeHint = truthContext?.writeScope?.kind === "file"
    ? t("truth.agentHint")
    : t("truth.agentReadOnlyHint");

  return (
    <div
      style={{ width: open ? width : 0 }}
      className={cn(
        "relative h-full shrink-0",
        isResizing ? "opacity-100 transition-none" : "chat-panel-enter",
        open ? "opacity-100" : "opacity-0",
      )}
    >
      {open && (
        <>
          {onResizeStart ? (
            <div
              role="separator"
              tabIndex={0}
              onMouseDown={(event) => {
                event.preventDefault();
                onResizeStart(event.clientX);
              }}
              onKeyDown={(event) => {
                if (!onResizeNudge) {
                  return;
                }
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  onResizeNudge(32);
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  onResizeNudge(-32);
                }
              }}
              className="absolute inset-y-0 left-0 z-20 hidden w-4 items-center justify-center bg-transparent cursor-col-resize touch-none outline-none lg:flex"
              aria-label="Resize assistant panel"
              title="Resize assistant panel"
              aria-controls="inkos-assistant-panel"
              aria-orientation="vertical"
              aria-valuemin={truthMode ? 420 : 320}
              aria-valuenow={width}
            >
              <span className={`h-24 w-[3px] rounded-full transition-colors ${isResizing ? "bg-primary/70" : "bg-border/80 hover:bg-primary/50"}`} />
            </div>
          ) : null}

          <aside
            id="inkos-assistant-panel"
            aria-label={truthHeaderTitle}
            aria-busy={loading || truthSending}
            className="h-full flex flex-col overflow-hidden border-l border-border/40 bg-background/80 backdrop-blur-md"
          >
          <div className="h-12 shrink-0 px-4 flex items-center justify-between border-b border-border/40">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <Sparkles size={15} className="text-primary chat-icon-glow" />
                {(loading || truthSending) && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full animate-ping" />
                )}
              </div>
              <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground">
                {truthHeaderTitle}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (truthMode) {
                    setTruthThreads((current) => clearTruthThread(current, truthKey));
                    setTruthError(null);
                    return;
                  }
                  setMessages([]);
                }}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors group"
                title="Clear conversation"
                aria-label="Clear conversation"
              >
                <Trash2 size={14} className="group-hover:animate-[shake_0.3s_ease-in-out]" />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary transition-colors group"
                title="Close panel"
                aria-label="Close panel"
              >
                <PanelRightClose size={14} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          </div>

          <div className="shrink-0 border-b border-border/30 px-4 py-3">
            <div className="rounded-xl border border-border/40 bg-background/60 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    {t("app.llmSettings")}
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <span className="rounded-full border border-border/40 bg-card/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {projectProvider ? shortLabelForProvider(projectProvider) : "-"}
                    </span>
                    <span className="truncate text-xs text-foreground/85">
                      {projectProvider ? compactModelLabel(projectProvider, projectModel || "-") : "-"}
                    </span>
                  </div>
                </div>
                {onOpenConfig ? (
                  <button
                    type="button"
                    onClick={onOpenConfig}
                    className="rounded-lg border border-border/40 bg-card/70 p-2 text-muted-foreground transition-colors hover:text-foreground"
                    title={t("app.llmSettings")}
                    aria-label={t("app.llmSettings")}
                  >
                    <Settings2 size={14} />
                  </button>
                ) : null}
              </div>

              {assistantLlmError ? (
                <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" aria-live="assertive">
                  {assistantLlmError}
                </div>
              ) : null}

              <div className="mt-3 space-y-2">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">{t("config.model")}</span>
                  <input
                    list={assistantModelListId}
                    value={assistantLlmForm.model}
                    onChange={(event) => setAssistantLlmForm((current) => ({ ...current, model: event.target.value }))}
                    placeholder={defaultModelForProvider(projectProvider, llmCapabilities) || t("config.model")}
                    disabled={!projectProvider || assistantLlmSaving}
                    className="w-full rounded-lg border border-border/40 bg-card/70 px-3 py-2 text-sm outline-none transition-colors focus:border-primary/40"
                  />
                  <datalist id={assistantModelListId}>
                    {assistantModelSuggestions.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </label>

                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">{t("config.reasoningLevel")}</span>
                    <select
                      value={assistantSupportsReasoning ? assistantLlmForm.reasoningEffort : ""}
                      onChange={(event) => setAssistantLlmForm((current) => ({
                        ...current,
                        reasoningEffort: event.target.value as ReasoningEffort,
                      }))}
                      disabled={!assistantSupportsReasoning || assistantLlmSaving}
                      className="w-full rounded-lg border border-border/40 bg-card/70 px-3 py-2 text-sm outline-none transition-colors focus:border-primary/40 disabled:opacity-60"
                    >
                      <option value="">{assistantSupportsReasoning ? t("config.default") : t("config.reasoningUnsupported")}</option>
                      {assistantReasoningEfforts.map((effort) => (
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
                  </label>

                  <button
                    type="button"
                    onClick={() => void saveAssistantLlm()}
                    disabled={assistantLlmSaving || !assistantLlmDirty || !projectProvider}
                    className="self-end rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {assistantLlmSaving ? t("config.saving") : t("config.save")}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {(loading || truthSending) && (
            <div className="shrink-0 px-4 py-2 border-b border-border/30 bg-primary/[0.03] fade-in" aria-live="polite">
              <div className="flex items-center gap-2.5">
                <StatusIcon phase={truthMode ? t("truth.aiWorking") : currentPhase} />
                <span className="text-xs font-medium text-primary truncate flex-1">
                  {truthMode ? t("truth.aiWorking") : currentPhase}
                </span>
                <div className="flex gap-1">
                  <span className="w-1 h-1 bg-primary/40 rounded-full chat-typing-dot" />
                  <span className="w-1 h-1 bg-primary/40 rounded-full chat-typing-dot" />
                  <span className="w-1 h-1 bg-primary/40 rounded-full chat-typing-dot" />
                </div>
              </div>
            </div>
          )}

          {truthMode && truthContext ? (
            <div className="shrink-0 border-b border-border/30 px-4 py-3">
              <div className="rounded-xl border border-border/40 bg-background/60 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{t("truth.writeScope")}</div>
                <div className="mt-1 text-sm font-medium text-foreground">{truthScopeLabel}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {truthScopeHint}
                </div>
                {truthAlignmentSummary.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {truthAlignmentSummary.map((item) => (
                      <span
                        key={`alignment-${item}`}
                        className="rounded-full border border-border/40 bg-card/70 px-2 py-1 text-[10px] font-medium text-muted-foreground"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                )}
                {truthContext.alignment?.mustDecide && (
                  <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-5 text-foreground/85">
                    <span className="font-medium text-primary">{t("truth.mustDecide")}: </span>
                    {truthContext.alignment.mustDecide}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <div
            ref={scrollRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
          >
            {truthMode ? (
              <>
                {truthThread.length === 0 && !truthSending && <EmptyState truthMode t={t} />}
                {truthThread.map((message) => (
                  <TruthMessageCard
                    key={message.id}
                    message={message}
                    t={t}
                    onApplySuggestion={(fileName, content) => truthContext?.applySuggestion(fileName, content)}
                    onApplyAll={(changes) => {
                      for (const change of changes) {
                        truthContext?.applySuggestion(change.fileName, change.content);
                      }
                    }}
                  />
                ))}
                {truthSending && <ThinkingBubble />}
              </>
            ) : (
              <>
                {messages.length === 0 && !loading && <EmptyState truthMode={false} t={t} />}
                {messages.map((msg) => (
                  <MessageBubble key={msg.timestamp} msg={msg} />
                ))}
                {loading && !messages.some((m) => m.content.startsWith("⋯")) && <ThinkingBubble />}
              </>
            )}
          </div>

          {!truthMode && (
            <div className="shrink-0 px-3 py-2 border-t border-border/30 flex gap-1.5 overflow-x-auto">
              <QuickChip
                icon={<Zap size={11} />}
                label={t("dash.writeNext")}
                onClick={() => handleQuickCommand(isZh ? "写下一章" : "write next")}
              />
              <QuickChip
                icon={<Search size={11} />}
                label={t("book.audit")}
                onClick={() => handleQuickCommand(isZh ? "审计第1章" : "audit chapter 1")}
              />
              <QuickChip
                icon={<FileOutput size={11} />}
                label={t("book.export")}
                onClick={() => handleQuickCommand(isZh ? "导出全书" : "export book as epub")}
              />
              <QuickChip
                icon={<TrendingUp size={11} />}
                label={t("nav.radar")}
                onClick={() => handleQuickCommand(isZh ? "扫描市场趋势" : "scan market trends")}
              />
            </div>
          )}

          <div className="shrink-0 p-3 border-t border-border/40">
            {truthError ? (
              <div className="mb-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive" aria-live="assertive">
                {t("truth.aiError")}: {truthError}
              </div>
            ) : null}

            {truthMode ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleSubmit("question")}
                  disabled={truthSending || !canRequestTruthQuestion}
                  className="inline-flex items-center gap-1 rounded-lg border border-border/40 bg-background/70 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary disabled:opacity-40"
                >
                  <CircleHelp size={12} />
                  {t("truth.agentAskFirst")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmit("proposal")}
                  disabled={truthSending || !canRequestTruthProposal}
                  className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-40"
                >
                  <WandSparkles size={12} />
                  {t("truth.agentGenerateProposal")}
                </button>
              </div>
            ) : null}

            <div className="flex items-end gap-2 rounded-xl bg-secondary/30 border border-border/40 px-3 py-1.5 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
              <MessageSquare size={14} className="text-muted-foreground/50 shrink-0 mb-2" />
              {truthMode ? (
                <textarea
                  ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void handleSubmit();
                    }
                  }}
                  placeholder={awaitingTruthAnswer ? t("truth.agentAnswerPlaceholder") : t("truth.agentInputPlaceholder")}
                  disabled={truthSending}
                  className="min-h-[96px] flex-1 bg-transparent py-2 text-sm leading-relaxed placeholder:text-muted-foreground/50 outline-none ring-0 shadow-none disabled:opacity-50 resize-none"
                  style={{ outline: "none", boxShadow: "none" }}
                />
              ) : (
                <input
                  ref={inputRef as React.RefObject<HTMLInputElement>}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSubmit();
                    }
                  }}
                  placeholder={t("common.enterCommand")}
                  disabled={loading}
                  className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/50 outline-none ring-0 shadow-none disabled:opacity-50"
                  style={{ outline: "none", boxShadow: "none" }}
                />
              )}
              <button
                onClick={() => void handleSubmit()}
                disabled={truthMode ? truthSending || (awaitingTruthAnswer ? !canRequestTruthProposal : !canRequestTruthQuestion) : !input.trim() || loading}
                className="mb-1 w-7 h-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-20 disabled:scale-100 shadow-sm shadow-primary/20"
              >
                {(loading || truthSending) ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ArrowUp size={14} strokeWidth={2.5} />
                )}
              </button>
            </div>

            {truthMode ? (
              <div className="mt-1.5 px-1 flex items-center gap-1.5">
                <Lightbulb size={10} className="text-muted-foreground/30 shrink-0" />
                <span className="text-[10px] text-muted-foreground/50">
                  {awaitingTruthAnswer ? t("truth.agentAwaitingAnswer") : t("truth.agentInterviewHint")}
                </span>
              </div>
            ) : !input ? (
              <div className="mt-1.5 px-1 flex items-center gap-1.5">
                <Lightbulb size={10} className="text-muted-foreground/30 shrink-0" />
                <span className="text-[9px] text-muted-foreground/40 truncate fade-in" key={tipIndex}>
                  {tips[tipIndex]}
                </span>
              </div>
            ) : null}
          </div>
          </aside>
        </>
      )}
    </div>
  );
}
