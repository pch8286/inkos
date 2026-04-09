import { useState, useRef, useEffect, useMemo } from "react";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { cn } from "../lib/utils";
import { fetchJson, postApi } from "../hooks/use-api";
import type { TruthAssistResponse, TruthFileDetail } from "../shared/contracts";
import type { TruthAssistantContext } from "../shared/truth-assistant";
import {
  buildTruthLineDiff,
  inferTruthTargets,
  makeTruthPreview,
  normalizeTruthText,
  summarizeTruthDiff,
  truthThreadKey,
} from "../shared/truth-assistant";
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
type TruthMessageKind = "chat" | "proposal" | "clarification";

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
    return (
      <article
        className={`rounded-xl border px-3 py-3 ${isUser ? "border-secondary/40 bg-secondary/50" : "border-border/50 bg-background/40"}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {isUser ? "You" : "Assistant"}
          </span>
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
  t,
  sse,
  activeBookId,
  truthContext,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
  readonly activeBookId?: string;
  readonly truthContext?: TruthAssistantContext | null;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ReadonlyArray<ChatMessage>>([]);
  const [truthThreads, setTruthThreads] = useState<TruthThreads>({});
  const [loading, setLoading] = useState(false);
  const [truthSending, setTruthSending] = useState(false);
  const [truthError, setTruthError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const truthMode = Boolean(truthContext);
  const truthKey = truthContext ? truthThreadKey(truthContext) : "";
  const truthThread = useMemo(() => truthContext ? (truthThreads[truthKey] ?? []) : [], [truthContext, truthKey, truthThreads]);

  useEffect(() => {
    setTruthError(null);
  }, [truthKey, truthMode]);

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

  const handleTruthSubmit = async (text: string) => {
    if (!truthContext) return;

    const userMessage: TruthMessage = {
      id: `truth-user-${Date.now()}-${Math.random()}`,
      role: "user",
      content: text,
      createdAt: Date.now(),
      kind: "chat",
      targetFiles: [],
    };

    const inference = inferTruthTargets(text, truthContext);
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
    setTruthSending(true);

    if (!truthContext.detailFile && inference.fileNames[0]) {
      truthContext.setWorkspaceTargetFile(inference.fileNames[0]!);
    }

    try {
      const apiConversation = [...truthThread, resolvedUserMessage].map((item) => ({
        role: item.role,
        content: item.kind === "proposal"
          ? item.changes?.map((change) => `${change.label}: ${change.preview}`).join("\n")
          : item.content,
      }));

      const payload = await fetchJson<TruthAssistResponse>(`/books/${truthContext.bookId}/truth/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: inference.fileNames.length === 1 ? inference.fileNames[0] : undefined,
          fileNames: inference.fileNames.length > 1 ? inference.fileNames : undefined,
          instruction: text,
          conversation: apiConversation,
        }),
      });

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

  const handleSubmit = async () => {
    const text = truthMode ? normalizeTruthText(input) : input.trim();
    if (!text) return;
    if ((truthMode && truthSending) || (!truthMode && loading)) return;

    setInput("");
    if (truthMode) {
      await handleTruthSubmit(text);
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
  const truthScopeLabel = truthContext?.detailFile
    ? truthContext.files.find((file) => file.name === truthContext.detailFile)?.label ?? truthContext.detailFile
    : truthContext?.mode === "workspace"
      ? t("truth.workspaceTitle")
      : t("truth.overviewTitle");

  return (
    <aside
      className={cn(
        "h-full flex flex-col border-l border-border/40 bg-background/80 backdrop-blur-md chat-panel-enter shrink-0 overflow-hidden",
        open ? (truthMode ? "w-[500px] xl:w-[540px] opacity-100" : "w-[380px] opacity-100") : "w-0 opacity-0",
      )}
    >
      {open && (
        <>
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
              >
                <Trash2 size={14} className="group-hover:animate-[shake_0.3s_ease-in-out]" />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary transition-colors group"
                title="Close panel"
              >
                <PanelRightClose size={14} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          </div>

          {(loading || truthSending) && (
            <div className="shrink-0 px-4 py-2 border-b border-border/30 bg-primary/[0.03] fade-in">
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
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {truthContext.detailFile ? t("truth.agentTargetLocked") : t("truth.agentAutoScope")}
                </div>
                <div className="mt-1 text-sm font-medium text-foreground">{truthScopeLabel}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t("truth.agentHint")}
                </div>
              </div>
            </div>
          ) : null}

          <div
            ref={scrollRef}
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
              <div className="mb-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {t("truth.aiError")}: {truthError}
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
                  placeholder={t("truth.agentInputPlaceholder")}
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
                disabled={truthMode ? !normalizeTruthText(input) || truthSending : !input.trim() || loading}
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
                  {t("truth.agentAutoScope")}
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
        </>
      )}
    </aside>
  );
}
