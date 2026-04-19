import type {
  ChapterRejectionExecutionMode,
  ChapterRejectionInstruction,
} from "../shared/contracts";

const STRONG_REJECTION_INSTRUCTIONS = new Set<ChapterRejectionInstruction>([
  "restructure",
  "heavy-rewrite",
  "full-rewrite",
]);

const REJECTION_INSTRUCTION_OPTIONS: ReadonlyArray<ChapterRejectionInstruction> = [
  "polish",
  "targeted-fix",
  "tone-adjust",
  "restructure",
  "heavy-rewrite",
  "full-rewrite",
];

function chapterRejectDialogTitle(language: "ko" | "zh" | "en"): string {
  if (language === "en") return "Reject and queue rework";
  if (language === "zh") return "驳回并安排返工";
  return "반려 및 재작업 지시";
}

function editorNoteLabel(language: "ko" | "zh" | "en"): string {
  if (language === "en") return "Editor Note";
  if (language === "zh") return "编辑备注";
  return "의견서";
}

function editorNotePlaceholder(language: "ko" | "zh" | "en"): string {
  if (language === "en") return "Explain what must change before this chapter comes back.";
  if (language === "zh") return "具体说明为什么驳回，以及这章返回前必须修改什么。";
  return "왜 반려하는지, 무엇을 고쳐야 하는지 구체적으로 적어 주세요.";
}

function reworkInstructionLabel(language: "ko" | "zh" | "en"): string {
  if (language === "en") return "Rework Instructions";
  if (language === "zh") return "返工指示";
  return "수정 지시";
}

function reworkInstructionHint(language: "ko" | "zh" | "en"): string {
  if (language === "en") return "Strong rewrite options replace other selections automatically.";
  if (language === "zh") return "选择强重写选项后，其他选项会自动取消。";
  return "강한 재작성 항목을 고르면 다른 옵션은 자동으로 해제됩니다.";
}

function rejectionSummaryLabel(language: "ko" | "zh" | "en"): string {
  if (language === "en") return "Summary";
  if (language === "zh") return "摘要";
  return "요약";
}

function emptyInstructionSummary(language: "ko" | "zh" | "en"): string {
  if (language === "en") return "Choose at least one instruction.";
  if (language === "zh") return "请至少选择一项返工指示。";
  return "수정 지시를 선택해 주세요.";
}

function saveOnlyLabel(language: "ko" | "zh" | "en", submittingMode: ChapterRejectionExecutionMode | null): string {
  if (submittingMode === "save-only") {
    if (language === "en") return "Saving...";
    if (language === "zh") return "保存中...";
    return "저장 중...";
  }
  if (language === "en") return "Save Only";
  if (language === "zh") return "仅保存";
  return "지시만 저장";
}

function cancelLabel(language: "ko" | "zh" | "en"): string {
  if (language === "en") return "Cancel";
  if (language === "zh") return "取消";
  return "취소";
}

function startNowLabel(language: "ko" | "zh" | "en", submittingMode: ChapterRejectionExecutionMode | null): string {
  if (submittingMode === "start-now") {
    if (language === "en") return "Starting...";
    if (language === "zh") return "启动中...";
    return "시작 중...";
  }
  if (language === "en") return "Start Now";
  if (language === "zh") return "立即开始";
  return "즉시 시작";
}

export function chapterRejectionInstructionLabel(
  language: "ko" | "zh" | "en",
  instruction: ChapterRejectionInstruction,
): string {
  const ko: Record<ChapterRejectionInstruction, string> = {
    polish: "부분 윤문",
    "targeted-fix": "지적한 부분만 수정",
    "tone-adjust": "톤/문체 조정",
    restructure: "구성 재정리",
    "heavy-rewrite": "거의 다시 쓰기",
    "full-rewrite": "처음부터 다시 쓰기",
  };
  const en: Record<ChapterRejectionInstruction, string> = {
    polish: "Polish",
    "targeted-fix": "Targeted Fixes",
    "tone-adjust": "Tone Adjustment",
    restructure: "Restructure",
    "heavy-rewrite": "Heavy Rewrite",
    "full-rewrite": "Full Rewrite",
  };
  const zh: Record<ChapterRejectionInstruction, string> = {
    polish: "局部润色",
    "targeted-fix": "只改指出的问题",
    "tone-adjust": "语气/文风调整",
    restructure: "结构重整",
    "heavy-rewrite": "大幅重写",
    "full-rewrite": "整章重写",
  };

  if (language === "en") return en[instruction];
  if (language === "zh") return zh[instruction];
  return ko[instruction];
}

export function summarizeChapterRejectionInstructions(
  language: "ko" | "zh" | "en",
  instructions: ReadonlyArray<ChapterRejectionInstruction>,
): string {
  return instructions.map((instruction) => chapterRejectionInstructionLabel(language, instruction)).join(" + ");
}

export function toggleChapterRejectionInstruction(
  current: ReadonlyArray<ChapterRejectionInstruction>,
  instruction: ChapterRejectionInstruction,
): ReadonlyArray<ChapterRejectionInstruction> {
  if (current.includes(instruction)) {
    return current.filter((item) => item !== instruction);
  }

  if (STRONG_REJECTION_INSTRUCTIONS.has(instruction)) {
    return [instruction];
  }

  return [...current.filter((item) => !STRONG_REJECTION_INSTRUCTIONS.has(item)), instruction];
}

export function validateChapterRejectDraft(
  language: "ko" | "zh" | "en",
  editorNote: string,
  instructions: ReadonlyArray<ChapterRejectionInstruction>,
): string | null {
  if (editorNote.trim().length === 0) {
    if (language === "en") return "Editor note is required.";
    if (language === "zh") return "驳回前必须填写编辑备注。";
    return "의견서를 입력해야 반려할 수 있습니다.";
  }
  if (instructions.length === 0) {
    if (language === "en") return "Choose at least one rework instruction.";
    if (language === "zh") return "请至少选择一项返工指示。";
    return "최소 한 개의 수정 지시를 선택하세요.";
  }
  return null;
}

export function ChapterRejectDialog({
  open,
  language,
  chapterLabel,
  editorNote,
  instructions,
  submittingMode,
  error,
  onClose,
  onEditorNoteChange,
  onToggleInstruction,
  onSubmit,
}: {
  open: boolean;
  language: "ko" | "zh" | "en";
  chapterLabel: string;
  editorNote: string;
  instructions: ReadonlyArray<ChapterRejectionInstruction>;
  submittingMode: ChapterRejectionExecutionMode | null;
  error: string | null;
  onClose: () => void;
  onEditorNoteChange: (value: string) => void;
  onToggleInstruction: (instruction: ChapterRejectionInstruction) => void;
  onSubmit: (executionMode: ChapterRejectionExecutionMode) => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-background shadow-2xl shadow-primary/10">
        <div className="border-b border-border/50 px-6 py-5">
          <h3 className="text-lg font-semibold">{chapterRejectDialogTitle(language)}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{chapterLabel}</p>
        </div>
        <div className="space-y-5 px-6 py-5">
          <section className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {editorNoteLabel(language)}
            </label>
            <textarea
              value={editorNote}
              onChange={(event) => onEditorNoteChange(event.target.value)}
              rows={5}
              className="w-full rounded-xl border border-border/50 bg-secondary/20 px-3 py-3 text-sm outline-none focus:border-[color:var(--studio-state-text)]"
              placeholder={editorNotePlaceholder(language)}
            />
          </section>
          <section className="space-y-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {reworkInstructionLabel(language)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{reworkInstructionHint(language)}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {REJECTION_INSTRUCTION_OPTIONS.map((instruction) => {
                const selected = instructions.includes(instruction);
                return (
                  <label
                    key={instruction}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm transition-all ${
                      selected
                        ? "border-[color:var(--studio-state-text)] bg-secondary/60"
                        : "border-border/50 bg-secondary/20"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleInstruction(instruction)}
                    />
                    <span>{chapterRejectionInstructionLabel(language, instruction)}</span>
                  </label>
                );
              })}
            </div>
          </section>
          <section className="rounded-xl border border-border/50 bg-secondary/20 px-4 py-3 text-sm">
            <p className="font-semibold text-foreground">{rejectionSummaryLabel(language)}</p>
            <p className="mt-1 text-muted-foreground">
              {instructions.length > 0
                ? summarizeChapterRejectionInstructions(language, instructions)
                : emptyInstructionSummary(language)}
            </p>
          </section>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border/50 bg-muted/30 px-6 py-4 sm:flex-row sm:justify-end">
          <button
            onClick={onClose}
            disabled={submittingMode !== null}
            className="rounded-xl border border-border/50 bg-secondary px-4 py-2.5 text-sm font-medium text-foreground disabled:opacity-50"
          >
            {cancelLabel(language)}
          </button>
          <button
            onClick={() => onSubmit("save-only")}
            disabled={submittingMode !== null}
            className="rounded-xl border border-border/50 bg-background px-4 py-2.5 text-sm font-semibold text-foreground disabled:opacity-50"
          >
            {saveOnlyLabel(language, submittingMode)}
          </button>
          <button
            onClick={() => onSubmit("start-now")}
            disabled={submittingMode !== null}
            className="rounded-xl bg-destructive px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {startNowLabel(language, submittingMode)}
          </button>
        </div>
      </div>
    </div>
  );
}
