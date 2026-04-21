import { fetchJson, useApi, postApi } from "../hooks/use-api";
import { useEffect, useMemo, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { useColors } from "../hooks/use-colors";
import { deriveBookActivity, shouldRefetchBookView } from "../hooks/use-book-activity";
import {
  ChapterRejectDialog,
  summarizeChapterRejectionInstructions,
  toggleChapterRejectionInstruction,
  validateChapterRejectDraft,
} from "../components/ChapterRejectDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { localizeChapterTitle } from "../shared/chapter-title";
import { resolveStudioLanguage } from "../shared/language";
import { pickValidValue, platformLabelForLanguage, platformOptionsForLanguage } from "../shared/book-create-form";
import type { BookDetailPayload, ChapterRejectionExecutionMode, ChapterRejectionInstruction } from "../shared/contracts";
import {
  ChevronLeft,
  Zap,
  FileText,
  CheckCheck,
  BarChart2,
  Download,
  Search,
  Wand2,
  Eye,
  Database,
  Check,
  X,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  Trash2,
  Save,
  AlertTriangle,
  ClipboardList
} from "lucide-react";

type ChapterMeta = BookDetailPayload["chapters"][number];

type ReviseMode = "spot-fix" | "polish" | "rewrite" | "rework" | "anti-detect";
type ExportFormat = "txt" | "md" | "epub";
type BookStatus = "active" | "paused" | "outlining" | "completed" | "dropped";

interface EpisodeStarterDraft {
  readonly direction: string;
  readonly conti: string;
  readonly avoid: string;
}

interface Nav {
  toDashboard: () => void;
  toChapter: (bookId: string, num: number) => void;
  toAnalytics: (bookId: string) => void;
}

function translateChapterStatus(status: string, t: TFunction): string {
  const map: Record<string, () => string> = {
    "ready-for-review": () => t("chapter.readyForReview"),
    "approved": () => t("chapter.approved"),
    "rejected": () => t("chapter.rejected"),
    "drafted": () => t("chapter.drafted"),
    "needs-revision": () => t("chapter.needsRevision"),
    "imported": () => t("chapter.imported"),
    "audit-failed": () => t("chapter.auditFailed"),
  };
  return map[status]?.() ?? status;
}

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  "ready-for-review": { color: "text-amber-500 bg-amber-500/10", icon: <Eye size={12} /> },
  approved: { color: "text-emerald-500 bg-emerald-500/10", icon: <Check size={12} /> },
  rejected: { color: "text-destructive bg-destructive/10", icon: <RotateCcw size={12} /> },
  drafted: { color: "text-muted-foreground bg-muted/20", icon: <FileText size={12} /> },
  "needs-revision": { color: "text-destructive bg-destructive/10", icon: <RotateCcw size={12} /> },
  imported: { color: "text-blue-500 bg-blue-500/10", icon: <Download size={12} /> },
};

function summarizeStructuralGateMessages(messages: ReadonlyArray<{ readonly message: string }>): string {
  return messages.slice(0, 2).map((item) => item.message).join(" · ");
}

function structuralGateBlockedLabel(language: "ko" | "zh" | "en", chapterNumber: number): string {
  if (language === "ko") {
    return `구조 게이트 차단: ${chapterNumber}화`;
  }
  if (language === "zh") {
    return `结构门禁拦截：第${chapterNumber}章`;
  }
  return `Structural gate blocked Chapter ${chapterNumber}`;
}

function structuralGateNoteLabel(language: "ko" | "zh" | "en"): string {
  if (language === "ko") {
    return "구조 게이트";
  }
  if (language === "zh") {
    return "结构门禁";
  }
  return "Structural gate";
}

function rejectionWorkflowLabel(
  language: "ko" | "zh" | "en",
  runStatus: "idle" | "running" | "completed" | "failed",
): string {
  if (language === "en") {
    if (runStatus === "running") return "Rejected · Rework Running";
    if (runStatus === "failed") return "Rejected · Rework Failed";
    if (runStatus === "completed") return "Rejected · Rework Applied";
    return "Rejected · Rework Queued";
  }
  if (language === "zh") {
    if (runStatus === "running") return "已驳回 · 返工进行中";
    if (runStatus === "failed") return "已驳回 · 返工失败";
    if (runStatus === "completed") return "已驳回 · 已应用返工";
    return "已驳回 · 等待返工";
  }
  if (runStatus === "running") return "반려됨 · 재작업 진행 중";
  if (runStatus === "failed") return "반려됨 · 재작업 실패";
  if (runStatus === "completed") return "반려됨 · 재작업 반영됨";
  return "반려됨 · 재작업 대기";
}

function reworkBannerLabel(language: "ko" | "zh" | "en", chapterNumber: number): string {
  if (language === "en") {
    return `Rework Running · Chapter ${chapterNumber}`;
  }
  if (language === "zh") {
    return `返工进行中 · 第${chapterNumber}章`;
  }
  return `재작업 진행 중 · ${chapterNumber}화`;
}

function episodeStarterWarningLabel(code: string, language: "ko" | "zh" | "en"): string {
  if (language === "en") {
    if (code === "EPISODE_STARTER_LONG_CONTI") return "Scene beats are long. Consider narrowing this to the few beats the draft must hit.";
    if (code === "EPISODE_STARTER_OVER_BUDGET") return "The starter is large enough to crowd the draft prompt.";
    if (code === "EPISODE_STARTER_POSSIBLE_CONFLICT") return "This may conflict with existing binder or outline material.";
    return code;
  }
  if (language === "zh") {
    if (code === "EPISODE_STARTER_LONG_CONTI") return "分镜偏长。建议只保留草稿必须命中的几个节拍。";
    if (code === "EPISODE_STARTER_OVER_BUDGET") return "启动卡内容过长，可能挤占草稿提示空间。";
    if (code === "EPISODE_STARTER_POSSIBLE_CONFLICT") return "可能与现有设定或大纲冲突。";
    return code;
  }
  if (code === "EPISODE_STARTER_LONG_CONTI") return "콘티가 깁니다. 초고가 꼭 맞혀야 할 비트만 남기는 편이 좋습니다.";
  if (code === "EPISODE_STARTER_OVER_BUDGET") return "스타터 내용이 길어 초고 프롬프트 공간을 많이 차지할 수 있습니다.";
  if (code === "EPISODE_STARTER_POSSIBLE_CONFLICT") return "기존 설정집이나 아웃라인과 충돌할 수 있습니다.";
  return code;
}

function summarizeEpisodeStarterWarnings(warnings: ReadonlyArray<string>, language: "ko" | "zh" | "en"): string {
  return warnings.map((warning) => episodeStarterWarningLabel(warning, language)).join("\n");
}

function collectLocalEpisodeStarterWarnings(draft: EpisodeStarterDraft): string[] {
  const warnings = new Set<string>();
  const contiLines = draft.conti.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const totalLength = draft.direction.length + draft.conti.length + draft.avoid.length;
  const combined = `${draft.direction}\n${draft.conti}\n${draft.avoid}`;
  if (contiLines.length > 12 || draft.conti.length > 1600) warnings.add("EPISODE_STARTER_LONG_CONTI");
  if (totalLength > 2400) warnings.add("EPISODE_STARTER_OVER_BUDGET");
  if (/(기존\s*설정|설정집|정전|canon|outline|아웃라인|스토리\s*바이블).{0,20}(무시|반대|충돌|갈아엎|리셋|바꿔|override|ignore|contradict)/iu.test(combined)) {
    warnings.add("EPISODE_STARTER_POSSIBLE_CONFLICT");
  }
  return [...warnings];
}

export function BookDetail({
  bookId,
  nav,
  theme,
  t,
  sse,
}: {
  bookId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
  sse: { messages: ReadonlyArray<SSEMessage> };
}) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<BookDetailPayload>(`/books/${bookId}`);
  const [writeRequestPending, setWriteRequestPending] = useState(false);
  const [draftRequestPending, setDraftRequestPending] = useState(false);
  const [draftCancelSubmitting, setDraftCancelSubmitting] = useState(false);
  const [draftCancelRequested, setDraftCancelRequested] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [chapterDeleteTarget, setChapterDeleteTarget] = useState<ChapterMeta | null>(null);
  const [deletingChapterNumber, setDeletingChapterNumber] = useState<number | null>(null);
  const [rewritingChapters, setRewritingChapters] = useState<ReadonlyArray<number>>([]);
  const [revisingChapters, setRevisingChapters] = useState<ReadonlyArray<number>>([]);
  const [rejectTarget, setRejectTarget] = useState<ChapterMeta | null>(null);
  const [rejectEditorNote, setRejectEditorNote] = useState("");
  const [rejectInstructions, setRejectInstructions] = useState<ReadonlyArray<ChapterRejectionInstruction>>([]);
  const [rejectSubmittingMode, setRejectSubmittingMode] = useState<ChapterRejectionExecutionMode | null>(null);
  const [rejectEditorNoteError, setRejectEditorNoteError] = useState<string | null>(null);
  const [rejectInstructionsError, setRejectInstructionsError] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [startingReworkChapters, setStartingReworkChapters] = useState<ReadonlyArray<number>>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsTitle, setSettingsTitle] = useState<string | null>(null);
  const [settingsWordCount, setSettingsWordCount] = useState<number | null>(null);
  const [settingsTargetChapters, setSettingsTargetChapters] = useState<number | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<BookStatus | null>(null);
  const [settingsPlatform, setSettingsPlatform] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("txt");
  const [exportApprovedOnly, setExportApprovedOnly] = useState(false);
  const [starterDirection, setStarterDirection] = useState(data?.episodeStarter?.direction ?? "");
  const [starterConti, setStarterConti] = useState(data?.episodeStarter?.conti ?? "");
  const [starterAvoid, setStarterAvoid] = useState(data?.episodeStarter?.avoid ?? "");
  const [starterWarnings, setStarterWarnings] = useState<ReadonlyArray<string>>(data?.episodeStarter?.warnings ?? []);
  const [savingStarter, setSavingStarter] = useState(false);
  const activity = useMemo(
    () => deriveBookActivity(sse.messages, bookId, data?.activeRun),
    [bookId, data?.activeRun, sse.messages],
  );
  const writing = writeRequestPending || activity.writing;
  const drafting = draftRequestPending || activity.drafting;
  const draftCancelling = draftCancelSubmitting || draftCancelRequested || activity.draftCancelling;

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;

    const data = recent.data as { bookId?: string } | null;
    if (data?.bookId !== bookId) return;

    if (recent.event === "write:start") {
      setWriteRequestPending(false);
      return;
    }

    if (recent.event === "draft:start") {
      setDraftRequestPending(false);
      setDraftCancelSubmitting(false);
      setDraftCancelRequested(false);
      return;
    }

    if (recent.event === "draft:cancel-requested") {
      setDraftCancelSubmitting(false);
      setDraftCancelRequested(true);
      return;
    }

    if (shouldRefetchBookView(recent, bookId)) {
      setWriteRequestPending(false);
      setDraftRequestPending(false);
      setDraftCancelSubmitting(false);
      setDraftCancelRequested(false);
      refetch();
    }
  }, [bookId, refetch, sse.messages]);

  useEffect(() => {
    if (!data?.episodeStarter) return;
    setStarterDirection(data.episodeStarter.direction);
    setStarterConti(data.episodeStarter.conti);
    setStarterAvoid(data.episodeStarter.avoid);
    setStarterWarnings(data.episodeStarter.warnings);
  }, [data?.episodeStarter]);

  const currentEpisodeStarterDraft = (): EpisodeStarterDraft => ({
    direction: starterDirection.trim(),
    conti: starterConti.trim(),
    avoid: starterAvoid.trim(),
  });

  const handleSaveEpisodeStarter = async () => {
    setSavingStarter(true);
    try {
      const payload = await fetchJson<NonNullable<BookDetailPayload["episodeStarter"]>>(`/books/${bookId}/episode-starter`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentEpisodeStarterDraft()),
      });
      setStarterDirection(payload.direction);
      setStarterConti(payload.conti);
      setStarterAvoid(payload.avoid);
      setStarterWarnings(payload.warnings);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingStarter(false);
    }
  };

  const handleStarterWriteAction = async (action: "draft" | "write-next") => {
    const episodeStarter = currentEpisodeStarterDraft();
    const warnings = collectLocalEpisodeStarterWarnings(episodeStarter);
    const language = data ? resolveStudioLanguage(data.book.language) : "ko";
    if (warnings.length > 0) {
      const prompt = action === "draft"
        ? language === "ko"
          ? "계속 초고를 쓸까요?"
          : language === "zh"
            ? "仍要继续生成草稿吗？"
            : "Continue drafting?"
        : language === "ko"
          ? "계속 다음 화를 쓸까요?"
          : language === "zh"
            ? "仍要继续写下一章吗？"
            : "Continue writing the next chapter?";
      const proceed = window.confirm(`${summarizeEpisodeStarterWarnings(warnings, language)}\n\n${prompt}`);
      if (!proceed) {
        setStarterWarnings(warnings);
        return;
      }
    }

    if (action === "draft") {
      setDraftRequestPending(true);
    } else {
      setWriteRequestPending(true);
    }
    try {
      await postApi(`/books/${bookId}/${action === "draft" ? "draft" : "write-next"}`, {
        episodeStarter,
        confirmEpisodeStarterWarnings: true,
      });
      setStarterWarnings(warnings);
    } catch (e) {
      if (action === "draft") {
        setDraftRequestPending(false);
      } else {
        setWriteRequestPending(false);
      }
      alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const handleCancelDraft = async () => {
    setDraftCancelSubmitting(true);
    try {
      await fetchJson(`/books/${bookId}/draft`, {
        method: "DELETE",
      });
      setDraftCancelRequested(true);
    } catch (e) {
      setDraftCancelRequested(false);
      alert(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setDraftCancelSubmitting(false);
    }
  };

  const handleDeleteBook = async () => {
    setConfirmDeleteOpen(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/books/${bookId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `${res.status}`);
      }
      nav.toDashboard();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const handleRewrite = async (chapterNum: number) => {
    setRewritingChapters((prev) => [...prev, chapterNum]);
    try {
      await postApi(`/books/${bookId}/rewrite/${chapterNum}`);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Rewrite failed");
    } finally {
      setRewritingChapters((prev) => prev.filter((n) => n !== chapterNum));
    }
  };

  const handleDeleteChapter = async () => {
    if (!chapterDeleteTarget) return;

    const targetNumber = chapterDeleteTarget.number;
    setChapterDeleteTarget(null);
    setDeletingChapterNumber(targetNumber);
    try {
      await fetchJson(`/books/${bookId}/chapters/${targetNumber}`, {
        method: "DELETE",
      });
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingChapterNumber(null);
    }
  };

  const handleRevise = async (chapterNum: number, mode: ReviseMode) => {
    setRevisingChapters((prev) => [...prev, chapterNum]);
    try {
      await fetchJson(`/books/${bookId}/revise/${chapterNum}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Revision failed");
    } finally {
      setRevisingChapters((prev) => prev.filter((n) => n !== chapterNum));
    }
  };

  const openRejectDialog = (chapter: ChapterMeta) => {
    setRejectTarget(chapter);
    setRejectEditorNote(chapter.rejection?.editorNote ?? "");
    setRejectInstructions(chapter.rejection?.instructions ?? []);
    setRejectEditorNoteError(null);
    setRejectInstructionsError(null);
    setRejectSubmittingMode(null);
    setRejectError(null);
  };

  const closeRejectDialog = () => {
    setRejectTarget(null);
    setRejectEditorNote("");
    setRejectInstructions([]);
    setRejectEditorNoteError(null);
    setRejectInstructionsError(null);
    setRejectError(null);
  };

  const handleSubmitReject = async (executionMode: ChapterRejectionExecutionMode) => {
    if (!rejectTarget) return;

    const validationErrors = validateChapterRejectDraft(bookLanguage, rejectEditorNote, rejectInstructions);
    setRejectEditorNoteError(validationErrors.editorNote);
    setRejectInstructionsError(validationErrors.instructions);
    if (validationErrors.editorNote || validationErrors.instructions) {
      setRejectError(null);
      return;
    }

    const editorNote = rejectEditorNote.trim();
    setRejectSubmittingMode(executionMode);
    setRejectEditorNoteError(null);
    setRejectInstructionsError(null);
    setRejectError(null);
    try {
      await fetchJson(`/books/${bookId}/chapters/${rejectTarget.number}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editorNote,
          instructions: rejectInstructions,
          executionMode,
        }),
      });
      closeRejectDialog();
      refetch();
    } catch (error) {
      setRejectError(error instanceof Error ? error.message : "Reject failed");
    } finally {
      setRejectSubmittingMode(null);
    }
  };

  const handleStartQueuedRework = async (chapter: ChapterMeta) => {
    if (!chapter.rejection) return;

    setStartingReworkChapters((prev) => [...prev, chapter.number]);
    try {
      await fetchJson(`/books/${bookId}/chapters/${chapter.number}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editorNote: chapter.rejection.editorNote,
          instructions: chapter.rejection.instructions,
          executionMode: "start-now",
        }),
      });
      refetch();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Rework start failed");
    } finally {
      setStartingReworkChapters((prev) => prev.filter((item) => item !== chapter.number));
    }
  };

  const handleSaveSettings = async () => {
    if (!data) return;
    const normalizedTitle = settingsTitle === null ? null : settingsTitle.trim();
    if (normalizedTitle !== null && normalizedTitle.length === 0) {
      alert(t("book.titleRequired"));
      return;
    }
    setSavingSettings(true);
    try {
      const body: Record<string, unknown> = {};
      if (normalizedTitle !== null && normalizedTitle !== book.title) body.title = normalizedTitle;
      if (settingsWordCount !== null) body.chapterWordCount = settingsWordCount;
      if (settingsTargetChapters !== null) body.targetChapters = settingsTargetChapters;
      if (settingsStatus !== null) body.status = settingsStatus;
      if (settingsPlatform !== null) body.platform = settingsPlatform;
      await fetchJson(`/books/${bookId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleApproveAll = async () => {
    if (!data) return;
    const reviewable = data.chapters.filter((ch) => ch.status === "ready-for-review");
    for (const ch of reviewable) {
      await postApi(`/books/${bookId}/chapters/${ch.number}/approve`);
    }
    refetch();
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 space-y-4">
      <div className="w-8 h-8 border-2 border-border/30 border-t-ring rounded-full animate-spin" />
      <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
    </div>
  );

  if (error) return <div className="text-destructive p-8 bg-destructive/5 rounded-xl border border-destructive/20">Error: {error}</div>;
  if (!data) return null;

  const { book, chapters } = data;
  const totalWords = chapters.reduce((sum, ch) => sum + (ch.wordCount ?? 0), 0);
  const reviewCount = chapters.filter((ch) => ch.status === "ready-for-review").length;
  const bookLanguage = resolveStudioLanguage(book.language);
  const chapterDeleteCount = chapterDeleteTarget
    ? chapters.filter((chapter) => chapter.number >= chapterDeleteTarget.number).length
    : 0;
  const chapterDeleteLabel = chapterDeleteTarget
    ? localizeChapterTitle(chapterDeleteTarget.title, chapterDeleteTarget.number, data.book.language as "ko" | "zh" | "en" | undefined)
    : "";
  const availablePlatforms = platformOptionsForLanguage(bookLanguage);
  const availablePlatformValues = availablePlatforms.map((option) => option.value);
  const platformMismatch = !availablePlatformValues.includes(book.platform);
  const fallbackPlatform = pickValidValue(book.platform, availablePlatformValues);

  const currentWordCount = settingsWordCount ?? book.chapterWordCount;
  const currentTargetChapters = settingsTargetChapters ?? book.targetChapters ?? 0;
  const currentStatus = settingsStatus ?? (book.status as BookStatus);
  const currentPlatform = settingsPlatform ?? fallbackPlatform;
  const currentTitle = settingsTitle ?? book.title;
  const activeReworkChapter = activity.activeChapterNumber !== null
    ? chapters.find((chapter) => chapter.number === activity.activeChapterNumber) ?? null
    : null;
  const reworkRunning = activity.revising || activity.rewriting;
  const mutationBusy = writing || drafting || reworkRunning;
  const liveInstructionSummary = activeReworkChapter?.rejection
    ? summarizeChapterRejectionInstructions(bookLanguage, activeReworkChapter.rejection.instructions)
    : null;
  const liveStatusLabel = writing
    ? t("dash.writing")
    : draftCancelling
      ? t("book.cancellingDraft")
      : drafting
        ? t("book.drafting")
        : reworkRunning && activity.activeChapterNumber !== null
          ? reworkBannerLabel(bookLanguage, activity.activeChapterNumber)
          : t("book.drafting");
  const liveProgressLabel = activity.liveDetail
    ? `${liveStatusLabel} ${activity.liveDetail}`
    : liveStatusLabel;
  const liveElapsedSeconds = activity.elapsedMs !== null
    ? Math.max(0, Math.round(activity.elapsedMs / 100) / 10)
    : null;
  const reworkRunningNumbers = new Set<number>([
    ...startingReworkChapters,
    ...(activity.activeChapterNumber !== null && reworkRunning ? [activity.activeChapterNumber] : []),
  ]);

  const exportHref = `/api/books/${bookId}/export?format=${exportFormat}${exportApprovedOnly ? "&approvedOnly=true" : ""}`;

  return (
    <div className="space-y-8 fade-in">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <button
          onClick={nav.toDashboard}
          className={`${c.link} flex items-center gap-1`}
        >
          <ChevronLeft size={14} />
          {t("bread.books")}
        </button>
        <span className="text-border">/</span>
        <span className="text-foreground">{book.title}</span>
      </nav>

      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-border/40 pb-8">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-4xl font-serif font-medium">{book.title}</h1>
            {book.language === "en" && (
              <span className="inline-flex items-center rounded studio-badge-soft px-1.5 py-1 text-[10px] font-bold">EN</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground font-medium">
            <span className="px-2 py-0.5 rounded bg-secondary/50 text-foreground/70 uppercase tracking-wider text-xs">{book.genre}</span>
            <span className="px-2 py-0.5 rounded bg-secondary/50 text-foreground/70 text-xs">
              {platformLabelForLanguage(bookLanguage, book.platform)}
            </span>
            <div className="flex items-center gap-1.5">
              <FileText size={14} />
              <span>{chapters.length} {t("dash.chapters")}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap size={14} />
              <span>{totalWords.toLocaleString()} {t("book.words")}</span>
            </div>
            {book.fanficMode && (
              <span className="flex items-center gap-1 text-purple-500">
                <Sparkles size={12} />
                <span className="italic">fanfic:{book.fanficMode}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleStarterWriteAction("write-next")}
            disabled={mutationBusy}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-bold rounded-xl disabled:opacity-50 ${c.btnPrimary}`}
          >
            {writing ? <div className="w-4 h-4 border-2 border-border/30 border-t-ring rounded-full animate-spin" /> : <Zap size={16} />}
            {writing ? t("dash.writing") : t("book.writeNext")}
          </button>
          <button
            onClick={drafting ? handleCancelDraft : () => handleStarterWriteAction("draft")}
            disabled={writing || draftCancelling || reworkRunning}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-bold rounded-xl transition-all border disabled:opacity-50 ${
              drafting
                ? "bg-destructive/10 text-destructive hover:bg-destructive hover:text-white border-destructive/20"
                : "bg-secondary text-foreground hover:bg-secondary/80 border-border/50"
            }`}
          >
            {drafting
              ? (draftCancelling
                  ? <div className="w-4 h-4 border-2 border-destructive/20 border-t-destructive rounded-full animate-spin" />
                  : <X size={16} />)
              : <Wand2 size={16} />}
            {drafting
              ? (draftCancelling ? t("book.cancellingDraft") : t("book.cancelDraft"))
              : t("book.draftOnly")}
          </button>
          <button
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={deleting || mutationBusy}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-destructive/10 text-destructive rounded-xl hover:bg-destructive hover:text-white transition-all border border-destructive/20 disabled:opacity-50"
          >
            {deleting ? <div className="w-4 h-4 border-2 border-destructive/20 border-t-destructive rounded-full animate-spin" /> : <Trash2 size={16} />}
            {deleting ? t("common.loading") : t("book.deleteBook")}
          </button>
        </div>
      </div>

      {(writing || drafting || reworkRunning || activity.lastError) && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            activity.lastError
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : c.info
          }`}
        >
          {activity.lastError ? (
            <span>
              {t("book.pipelineFailed")}: {activity.lastError}
            </span>
          ) : (
            <div className="space-y-3" role="status" aria-live="polite">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="studio-cockpit-live-status-badge">LIVE</span>
                    <span className="studio-cockpit-live-status-stage">{liveStatusLabel}</span>
                  </div>
                  {activity.liveDetail ? (
                    <p className="studio-cockpit-live-status-detail">{activity.liveDetail}</p>
                  ) : null}
                  {liveInstructionSummary ? (
                    <p className="text-xs font-medium text-muted-foreground">
                      {liveInstructionSummary}
                    </p>
                  ) : null}
                </div>

                {(liveElapsedSeconds !== null || activity.totalChars !== null) ? (
                  <div className="flex flex-wrap gap-2 text-xs font-semibold text-muted-foreground">
                    {liveElapsedSeconds !== null ? (
                      <span className="rounded-full border border-border/50 bg-background/70 px-2.5 py-1">
                        {t("radar.progressElapsed")}: {liveElapsedSeconds}s
                      </span>
                    ) : null}
                    {activity.totalChars !== null ? (
                      <span className="rounded-full border border-border/50 bg-background/70 px-2.5 py-1">
                        {t("radar.progressChars")}: {activity.totalChars.toLocaleString()} {t("truth.chars")}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div
                className="studio-cockpit-live-progress"
                data-progress-mode="indeterminate"
                role="progressbar"
                aria-label={liveProgressLabel}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          )}
        </div>
      )}

      <div className={`rounded-2xl border px-4 py-3 text-sm ${c.info}`}>
        {t("book.actionGuide")}
      </div>

      <section className="rounded-2xl border border-border/40 bg-background/80 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ClipboardList size={16} className="text-muted-foreground" />
              <h2 className="text-sm font-bold">이번 화 스타터</h2>
              {data.episodeStarter?.exists ? (
                <span className="rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                  {bookLanguage === "ko" ? "저장됨" : bookLanguage === "zh" ? "已保存" : "Saved"}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {bookLanguage === "ko"
                ? "설정집을 크게 확정하지 않고, 이번 초고가 반드시 맞힐 방향과 콘티만 짧게 잡습니다."
                : bookLanguage === "zh"
                  ? "不先锁定完整设定，只抓住这次草稿必须命中的方向和分镜。"
                  : "Set only the direction and scene beats this draft must hit."}
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <button
              onClick={handleSaveEpisodeStarter}
              disabled={savingStarter || mutationBusy}
              className="flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/50 px-3 py-2 text-xs font-bold text-muted-foreground transition-all hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              {savingStarter ? <div className="h-3.5 w-3.5 rounded-full border-2 border-border/30 border-t-ring animate-spin" /> : <Save size={14} />}
              {bookLanguage === "ko" ? "스타터 저장" : bookLanguage === "zh" ? "保存启动卡" : "Save Starter"}
            </button>
            <p className="text-[11px] font-medium text-muted-foreground">
              {bookLanguage === "ko"
                ? "상단 초고와 다음 화 버튼에 적용됩니다."
                : bookLanguage === "zh"
                  ? "会应用到顶部的草稿和下一章按钮。"
                  : "Applies to the top Draft and Next Chapter buttons."}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.4fr_1fr]">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">이번 화 방향성</span>
            <textarea
              value={starterDirection}
              onChange={(event) => setStarterDirection(event.target.value)}
              rows={4}
              placeholder="예: 독자가 주인공의 결핍과 첫 선택을 바로 보게 한다."
              className="min-h-28 resize-y rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-sm outline-none focus:border-[color:var(--studio-chip-border)] focus:ring-2 focus:ring-[color:var(--studio-state-text)]/20"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">콘티</span>
            <textarea
              value={starterConti}
              onChange={(event) => setStarterConti(event.target.value)}
              rows={4}
              placeholder="- 첫 장면&#10;- 갈등 비트&#10;- 마지막 훅"
              className="min-h-28 resize-y rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-sm outline-none focus:border-[color:var(--studio-chip-border)] focus:ring-2 focus:ring-[color:var(--studio-state-text)]/20"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">피할 것</span>
            <textarea
              value={starterAvoid}
              onChange={(event) => setStarterAvoid(event.target.value)}
              rows={4}
              placeholder="예: 세계관 설명으로 시작하지 않기."
              className="min-h-28 resize-y rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-sm outline-none focus:border-[color:var(--studio-chip-border)] focus:ring-2 focus:ring-[color:var(--studio-state-text)]/20"
            />
          </label>
        </div>

        {starterWarnings.length > 0 ? (
          <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle size={14} />
              {bookLanguage === "ko" ? "확인 필요" : bookLanguage === "zh" ? "需要确认" : "Needs Review"}
            </div>
            <ul className="mt-1 space-y-1">
              {starterWarnings.map((warning) => (
                <li key={warning}>{episodeStarterWarningLabel(warning, bookLanguage)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {data.pendingStructuralGate ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <div className="font-semibold">
            {structuralGateBlockedLabel(bookLanguage, data.pendingStructuralGate.chapterNumber)}
          </div>
          <p className="mt-1">{data.pendingStructuralGate.summary}</p>
          {data.pendingStructuralGate.criticalFindings.length > 0 ? (
            <p className="mt-2 text-xs text-destructive/80">
              {summarizeStructuralGateMessages(data.pendingStructuralGate.criticalFindings)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Tool Strip */}
      <div className="flex flex-wrap items-center gap-2 py-1">
          {reviewCount > 0 && (
            <button
              onClick={handleApproveAll}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-emerald-500/10 text-emerald-600 rounded-lg hover:bg-emerald-500/20 transition-all border border-emerald-500/20"
            >
              <CheckCheck size={14} />
              {t("book.approveAll")} ({reviewCount})
            </button>
          )}
          <button
            onClick={() => (nav as { toTruth?: (id: string) => void }).toTruth?.(bookId)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary/50 text-muted-foreground rounded-lg hover:text-foreground hover:bg-secondary transition-all border border-border/50"
          >
            <Database size={14} />
            {t("book.truthFiles")}
          </button>
          <button
            onClick={() => nav.toAnalytics(bookId)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary/50 text-muted-foreground rounded-lg hover:text-foreground hover:bg-secondary transition-all border border-border/50"
          >
            <BarChart2 size={14} />
            {t("book.analytics")}
          </button>
          <div className="flex items-center gap-2">
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
              className="px-2 py-2 text-xs font-bold bg-secondary/50 text-muted-foreground rounded-lg border border-border/50 outline-none"
            >
              <option value="txt">TXT</option>
              <option value="md">MD</option>
              <option value="epub">EPUB</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={exportApprovedOnly}
                onChange={(e) => setExportApprovedOnly(e.target.checked)}
                className="rounded border-border/50"
              />
              {t("book.approvedOnly")}
            </label>
            <button
              onClick={async () => {
                try {
                  const data = await fetchJson<{ path?: string; chapters?: number }>(`/books/${bookId}/export-save`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ format: exportFormat, approvedOnly: exportApprovedOnly }),
                  });
                  alert(`${t("common.exportSuccess")}\n${data.path}\n(${data.chapters} ${t("dash.chapters")})`);
                } catch (e) {
                  alert(e instanceof Error ? e.message : "Export failed");
                }
              }}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary/50 text-muted-foreground rounded-lg hover:text-foreground hover:bg-secondary transition-all border border-border/50"
            >
              <Download size={14} />
              {t("book.export")}
            </button>
          </div>
      </div>

      {/* Book Settings */}
      <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">{t("book.settings")}</h2>
        {platformMismatch && (
          <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <div className="font-semibold">{t("book.platformCurrent")}: {book.platform}</div>
            <div className="mt-1">{t("book.platformLegacyHint")}</div>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex min-w-[18rem] flex-1 flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("create.bookTitle")}</label>
            <input
              type="text"
              value={currentTitle}
              onChange={(e) => setSettingsTitle(e.target.value)}
              placeholder={t("create.placeholder")}
              className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-[color:var(--studio-chip-border)] focus:ring-2 focus:ring-[color:var(--studio-state-text)]/20"
            />
            <span className="text-[11px] text-muted-foreground">{t("book.titleHint")}</span>
          </div>
          <div className="flex min-w-[13rem] flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("create.platform")}</label>
            <select
              value={currentPlatform}
              onChange={(e) => setSettingsPlatform(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-[color:var(--studio-chip-border)] focus:ring-2 focus:ring-[color:var(--studio-state-text)]/20"
            >
              {availablePlatforms.map((platformOption) => (
                <option key={platformOption.value} value={platformOption.value}>
                  {platformOption.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("create.wordsPerChapter")}</label>
            <input
              type="number"
              value={currentWordCount}
              onChange={(e) => setSettingsWordCount(Number(e.target.value))}
              className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-[color:var(--studio-chip-border)] focus:ring-2 focus:ring-[color:var(--studio-state-text)]/20 w-32"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("create.targetChapters")}</label>
            <input
              type="number"
              value={currentTargetChapters}
              onChange={(e) => setSettingsTargetChapters(Number(e.target.value))}
              className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-[color:var(--studio-chip-border)] focus:ring-2 focus:ring-[color:var(--studio-state-text)]/20 w-32"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.status")}</label>
            <select
              value={currentStatus}
              onChange={(e) => setSettingsStatus(e.target.value as BookStatus)}
              className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-[color:var(--studio-chip-border)] focus:ring-2 focus:ring-[color:var(--studio-state-text)]/20"
            >
              <option value="active">{t("book.statusActive")}</option>
              <option value="paused">{t("book.statusPaused")}</option>
              <option value="outlining">{t("book.statusOutlining")}</option>
              <option value="completed">{t("book.statusCompleted")}</option>
              <option value="dropped">{t("book.statusDropped")}</option>
            </select>
          </div>
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg disabled:opacity-50 ${c.btnPrimary}`}
          >
            {savingSettings ? <div className="w-4 h-4 border-2 border-border/30 border-t-ring rounded-full animate-spin" /> : <Save size={14} />}
            {savingSettings ? t("book.saving") : t("book.save")}
          </button>
        </div>
      </div>

      {/* Chapters Table */}
      <div className="paper-sheet rounded-2xl overflow-hidden border border-border/40 shadow-xl shadow-primary/5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b border-border/50">
                <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground w-16">#</th>
                <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("book.manuscriptTitle")}</th>
                <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground w-28">{t("book.words")}</th>
                <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground w-36">{t("book.status")}</th>
                <th className="text-right px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("book.curate")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {chapters.map((ch, index) => {
                const staggerClass = `stagger-${Math.min(index + 1, 5)}`;
                const isQueuedRework = ch.status === "rejected" && ch.rejection?.lastRunStatus === "idle";
                const isRunningRework = reworkRunningNumbers.has(ch.number);
                const reworkLabel = ch.rejection
                  ? rejectionWorkflowLabel(bookLanguage, isRunningRework ? "running" : ch.rejection.lastRunStatus)
                  : null;
                const reworkSummary = ch.rejection
                  ? summarizeChapterRejectionInstructions(bookLanguage, ch.rejection.instructions)
                  : null;
                return (
                <tr key={ch.number} className={`group hover:bg-muted/30 transition-colors fade-in ${staggerClass}`}>
                  <td className="px-6 py-4 text-muted-foreground/60 font-mono text-xs">{ch.number.toString().padStart(2, '0')}</td>
                  <td className="px-6 py-4">
                    <div>
                      <button
                        onClick={() => nav.toChapter(bookId, ch.number)}
                        className="font-serif text-lg font-medium transition-colors text-left hover:text-[color:var(--studio-state-text)]"
                      >
                        {localizeChapterTitle(ch.title, ch.number, data.book.language as "ko" | "zh" | "en" | undefined)}
                      </button>
                      {ch.structuralGate?.softFindings.length ? (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                          {`${structuralGateNoteLabel(bookLanguage)}: ${summarizeStructuralGateMessages(ch.structuralGate.softFindings)}`}
                        </p>
                      ) : null}
                      {reworkLabel ? (
                        <p className={`mt-1 text-xs font-semibold ${isRunningRework ? "text-[color:var(--studio-state-text)]" : "text-muted-foreground"}`}>
                          {reworkLabel}
                        </p>
                      ) : null}
                      {reworkSummary ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {reworkSummary}
                        </p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground font-medium tabular-nums text-xs">{(ch.wordCount ?? 0).toLocaleString()}</td>
                  <td className="px-6 py-4">
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight ${STATUS_CONFIG[ch.status]?.color ?? "bg-muted text-muted-foreground"}`}>
                      {STATUS_CONFIG[ch.status]?.icon}
                      {translateChapterStatus(ch.status, t)}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      {ch.status === "ready-for-review" && (
                        <>
                          <button
                            onClick={async () => { await postApi(`/books/${bookId}/chapters/${ch.number}/approve`); refetch(); }}
                            disabled={mutationBusy}
                            className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500 hover:text-white transition-all shadow-sm disabled:opacity-50"
                            title={t("book.approve")}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={() => openRejectDialog(ch)}
                            disabled={mutationBusy}
                            className="p-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive hover:text-white transition-all shadow-sm disabled:opacity-50"
                            title={t("book.reject")}
                          >
                            <X size={14} />
                          </button>
                        </>
                      )}
                      {ch.rejection ? (
                        <>
                          <button
                            onClick={() => openRejectDialog(ch)}
                            className="p-2 rounded-lg studio-icon-btn transition-all shadow-sm"
                            title={bookLanguage === "ko" ? "반려 지시 보기" : "View rework brief"}
                          >
                            <Search size={14} />
                          </button>
                          {isQueuedRework ? (
                            <button
                              onClick={() => handleStartQueuedRework(ch)}
                              disabled={mutationBusy || startingReworkChapters.includes(ch.number)}
                              className="p-2 rounded-lg studio-icon-btn transition-all shadow-sm disabled:opacity-50"
                              title={bookLanguage === "ko" ? "저장된 지시로 재작업 시작" : "Start rework"}
                            >
                              {startingReworkChapters.includes(ch.number)
                                ? <div className="w-3.5 h-3.5 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
                                : <Wand2 size={14} />}
                            </button>
                          ) : null}
                        </>
                      ) : null}
                      <button
                        onClick={async () => {
                          const auditResult = await fetchJson<{ passed?: boolean; issues?: unknown[] }>(`/books/${bookId}/audit/${ch.number}`, { method: "POST" });
                          alert(auditResult.passed ? "Audit passed" : `Audit failed: ${auditResult.issues?.length ?? 0} issues`);
                          refetch();
                        }}
                        disabled={mutationBusy}
                        className="p-2 rounded-lg studio-icon-btn transition-all shadow-sm disabled:opacity-50"
                        title={t("book.audit")}
                      >
                        <ShieldCheck size={14} />
                      </button>
                      <button
                        onClick={() => handleRewrite(ch.number)}
                        disabled={mutationBusy || rewritingChapters.includes(ch.number)}
                        className="p-2 rounded-lg studio-icon-btn transition-all shadow-sm disabled:opacity-50"
                        title={t("book.rewrite")}
                      >
                        {rewritingChapters.includes(ch.number)
                          ? <div className="w-3.5 h-3.5 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
                          : <RotateCcw size={14} />}
                      </button>
                      <select
                        disabled={mutationBusy || revisingChapters.includes(ch.number)}
                        value=""
                        onChange={(e) => {
                          const mode = e.target.value as ReviseMode;
                          if (mode) handleRevise(ch.number, mode);
                        }}
                        className="px-2 py-1.5 text-[11px] font-bold rounded-lg studio-chip border border-border/50 outline-none transition-all disabled:opacity-50 cursor-pointer"
                        title="Revise with AI"
                      >
                        <option value="" disabled>{revisingChapters.includes(ch.number) ? t("common.loading") : t("book.curate")}</option>
                        <option value="spot-fix">{t("book.spotFix")}</option>
                        <option value="polish">{t("book.polish")}</option>
                        <option value="rewrite">{t("book.rewrite")}</option>
                        <option value="rework">{t("book.rework")}</option>
                        <option value="anti-detect">{t("book.antiDetect")}</option>
                      </select>
                      <button
                        onClick={() => setChapterDeleteTarget(ch)}
                        disabled={deletingChapterNumber !== null || mutationBusy}
                        className="p-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive hover:text-white transition-all shadow-sm disabled:opacity-50"
                        title={t("book.deleteChapter")}
                      >
                        {deletingChapterNumber === ch.number
                          ? <div className="w-3.5 h-3.5 border-2 border-destructive/20 border-t-destructive rounded-full animate-spin" />
                          : <Trash2 size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {chapters.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 rounded-full bg-muted/20 flex items-center justify-center mb-4">
               <FileText size={20} className="text-muted-foreground/40" />
            </div>
            <p className="text-sm italic font-serif text-muted-foreground">
              {t("book.noChapters")}
            </p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t("book.deleteBook")}
        message={t("book.confirmDelete")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={handleDeleteBook}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
      <ConfirmDialog
        open={chapterDeleteTarget !== null}
        title={t("book.deleteChapter")}
        message={`${chapterDeleteLabel}\n\n${chapterDeleteCount > 1 ? t("book.confirmDeleteChapterCascade") : t("book.confirmDeleteChapter")}\n\n${t("book.deleteChapterStateWarning")}`}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={handleDeleteChapter}
        onCancel={() => setChapterDeleteTarget(null)}
      />
      <ChapterRejectDialog
        open={rejectTarget !== null}
        language={bookLanguage}
        chapterLabel={rejectTarget
          ? localizeChapterTitle(rejectTarget.title, rejectTarget.number, data.book.language as "ko" | "zh" | "en" | undefined)
          : ""}
        editorNote={rejectEditorNote}
        instructions={rejectInstructions}
        submittingMode={rejectSubmittingMode}
        error={rejectError}
        editorNoteError={rejectEditorNoteError}
        instructionsError={rejectInstructionsError}
        onClose={closeRejectDialog}
        onEditorNoteChange={(value) => {
          setRejectEditorNote(value);
          if (rejectEditorNoteError) {
            setRejectEditorNoteError(null);
          }
          if (rejectError) {
            setRejectError(null);
          }
        }}
        onToggleInstruction={(instruction) => {
          setRejectInstructions((current) => toggleChapterRejectionInstruction(current, instruction));
          if (rejectInstructionsError) {
            setRejectInstructionsError(null);
          }
          if (rejectError) {
            setRejectError(null);
          }
        }}
        onSubmit={(executionMode) => {
          void handleSubmitReject(executionMode);
        }}
      />
    </div>
  );
}
