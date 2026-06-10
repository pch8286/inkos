import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileText,
  Loader2,
  PauseCircle,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { fetchJson, postApi, useApi } from "../hooks/use-api";
import type {
  AdaptiveTickKindPayload,
  AdaptiveTickPayload,
  MovementCandidatePayload,
  MovementCandidateStatusPayload,
  PressureLevelPayload,
  ProtagonistVisibilityPayload,
  SceneContractPayload,
  StorySpinePayload,
  StoryWorldLabPayload,
  WorldPressurePayload,
  WorldPressureTypePayload,
} from "../shared/contracts";
import {
  buildDefaultStorySpine,
  buildTickRequest,
  canCompileSceneContract,
  groupMovementCandidates,
  hasSelectedConflictRisk,
  linesValue,
  parseLines,
  statusLabelForChapter,
} from "./story-world-state";

interface StoryWorldLabProps {
  readonly bookId: string;
  readonly onOpenBook: () => void;
}

interface StorySpineForm {
  readonly protagonistId: string;
  readonly currentGoal: string;
  readonly currentQuestion: string;
  readonly emotionalState: string;
  readonly activeChoices: string;
  readonly constraints: string;
}

interface SceneContractForm {
  readonly chapter: string;
  readonly pov: string;
  readonly location: string;
  readonly outlineNode: string;
  readonly sceneGoal: string;
  readonly mustInclude: string;
  readonly mustAvoid: string;
  readonly styleEmphasis: string;
  readonly endingState: string;
}

type Operation = "story-spine" | "world-pressures" | "tick" | "scene-contract";

interface CompileFeedback {
  readonly contractId: string;
  readonly status: "success" | "error";
  readonly message: string;
  readonly runtimePath?: string;
  readonly intentMarkdown?: string;
}

const PRESSURE_TYPE_OPTIONS: ReadonlyArray<WorldPressureTypePayload> = [
  "faction",
  "character",
  "location",
  "hook",
  "environment",
];

const PRESSURE_LEVEL_OPTIONS: ReadonlyArray<PressureLevelPayload> = ["low", "medium", "high"];
const PROTAGONIST_VISIBILITY_OPTIONS: ReadonlyArray<ProtagonistVisibilityPayload> = ["yes", "partial", "no"];

const TICK_KIND_OPTIONS: ReadonlyArray<{
  readonly value: AdaptiveTickKindPayload;
  readonly label: string;
  readonly placeholder: string;
}> = [
  {
    value: "protagonist_action",
    label: "Action",
    placeholder: "What does the protagonist do?",
  },
  {
    value: "protagonist_inaction",
    label: "Inaction",
    placeholder: "What does the protagonist leave unresolved?",
  },
  {
    value: "elapsed_time",
    label: "Elapsed time",
    placeholder: "What changes while time passes?",
  },
  {
    value: "direction_override",
    label: "Direction",
    placeholder: "What movement should the world bend toward?",
  },
];

function storySpineToForm(storySpine: StorySpinePayload | null): StorySpineForm {
  const source = storySpine ?? buildDefaultStorySpine();
  return {
    protagonistId: source.protagonistId,
    currentGoal: source.currentGoal,
    currentQuestion: source.currentQuestion,
    emotionalState: linesValue(source.emotionalState),
    activeChoices: linesValue(source.activeChoices),
    constraints: linesValue(source.constraints),
  };
}

function formToStorySpine(form: StorySpineForm): StorySpinePayload {
  return {
    protagonistId: form.protagonistId.trim(),
    currentGoal: form.currentGoal.trim(),
    currentQuestion: form.currentQuestion.trim(),
    emotionalState: parseLines(form.emotionalState),
    activeChoices: parseLines(form.activeChoices),
    constraints: parseLines(form.constraints),
  };
}

function pressureToForm(pressure: WorldPressurePayload): WorldPressurePayload {
  return { ...pressure };
}

function createPressure(): WorldPressurePayload {
  return {
    id: createClientId("pressure"),
    type: "faction",
    label: "",
    currentMotion: "",
    pressureLevel: "medium",
    visibleToProtagonist: "partial",
  };
}

function createClientId(prefix: string): string {
  const generated = globalThis.crypto?.randomUUID?.();
  if (generated) return `${prefix}-${generated}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parsePositiveChapter(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function labelForStatus(status: MovementCandidateStatusPayload): string {
  if (status === "candidate") return "Candidate";
  if (status === "approved") return "Approved";
  if (status === "hold") return "Hold";
  return "Rejected";
}

function labelForConflict(level: MovementCandidatePayload["conflictLevel"]): string {
  if (level === "none") return "No conflict";
  if (level === "minor") return "Minor conflict";
  return "Major conflict";
}

function policyLabel(policy: SceneContractPayload["conflictPolicy"]): string {
  if (policy === "draft_rewrite_allowed") return "Draft rewrite";
  if (policy === "serialized_forward_only") return "Forward only";
  return "Edition retcon";
}

function fieldClassName(additional = ""): string {
  return `w-full rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 ${additional}`;
}

function selectClassName(additional = ""): string {
  return `h-9 rounded-lg border border-border/70 bg-background px-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 ${additional}`;
}

function actionButtonClassName(tone: "neutral" | "approve" | "hold" | "reject" = "neutral"): string {
  const tones = {
    neutral: "border-border/70 bg-secondary/50 text-foreground hover:bg-secondary",
    approve: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300",
    hold: "border-amber-500/35 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300",
    reject: "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15",
  };
  return `inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition disabled:pointer-events-none disabled:opacity-50 ${tones[tone]}`;
}

function Section({
  title,
  meta,
  children,
  actions,
}: {
  readonly title: string;
  readonly meta?: string;
  readonly children: React.ReactNode;
  readonly actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-background/70">
      <div className="flex flex-col gap-3 border-b border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {meta && <div className="mt-1 text-xs text-muted-foreground">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function StatusLine({ message, tone = "neutral" }: { readonly message: string; readonly tone?: "neutral" | "error" | "success" | "warn" }) {
  const toneClass = tone === "error"
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "warn"
        ? "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-border/60 bg-secondary/40 text-muted-foreground";
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm leading-6 whitespace-pre-line ${toneClass}`}>
      {message}
    </div>
  );
}

export function StoryWorldLab({ bookId, onOpenBook }: StoryWorldLabProps) {
  const { data: lab, loading, error, refetch } = useApi<StoryWorldLabPayload>(`/books/${bookId}/lab`);
  const [storySpineForm, setStorySpineForm] = useState<StorySpineForm>(() => storySpineToForm(null));
  const [worldPressureForms, setWorldPressureForms] = useState<WorldPressurePayload[]>([]);
  const [tickChapter, setTickChapter] = useState("1");
  const [tickKind, setTickKind] = useState<AdaptiveTickKindPayload>("protagonist_action");
  const [tickActionText, setTickActionText] = useState("");
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [sceneForm, setSceneForm] = useState<SceneContractForm>({
    chapter: "1",
    pov: "",
    location: "",
    outlineNode: "",
    sceneGoal: "",
    mustInclude: "",
    mustAvoid: "",
    styleEmphasis: "",
    endingState: "",
  });
  const [busyOperation, setBusyOperation] = useState<Operation | null>(null);
  const [candidateBusyId, setCandidateBusyId] = useState<string | null>(null);
  const [compileBusyId, setCompileBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ readonly tone: "success" | "error" | "warn"; readonly text: string } | null>(null);
  const [compileFeedback, setCompileFeedback] = useState<CompileFeedback | null>(null);

  useEffect(() => {
    if (!lab) return;
    setStorySpineForm(storySpineToForm(lab.storySpine));
    setWorldPressureForms(lab.worldPressures.map(pressureToForm));
    setSelectedCandidateIds((current) => current.filter((id) => (
      lab.movementCandidates.some((candidate) => candidate.id === id && candidate.status === "approved")
    )));
  }, [lab]);

  const candidates = lab?.movementCandidates ?? [];
  const groupedCandidates = useMemo(() => groupMovementCandidates(candidates), [candidates]);
  const selectedConflictRisk = useMemo(
    () => hasSelectedConflictRisk(candidates, selectedCandidateIds),
    [candidates, selectedCandidateIds],
  );
  const selectedCandidatesReady = useMemo(
    () => canCompileSceneContract(candidates, selectedCandidateIds),
    [candidates, selectedCandidateIds],
  );
  const selectedTickKind = TICK_KIND_OPTIONS.find((option) => option.value === tickKind) ?? TICK_KIND_OPTIONS[0];

  const runOperation = async (operation: Operation, action: () => Promise<void>) => {
    setBusyOperation(operation);
    setMessage(null);
    try {
      await action();
    } catch (caught) {
      setMessage({ tone: "error", text: errorMessage(caught) });
    } finally {
      setBusyOperation(null);
    }
  };

  const saveStorySpine = () => runOperation("story-spine", async () => {
    const response = await fetchJson<{ storySpine: StorySpinePayload }>(`/books/${bookId}/lab/story-spine`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formToStorySpine(storySpineForm)),
    });
    setStorySpineForm(storySpineToForm(response.storySpine));
    setMessage({ tone: "success", text: "Story Spine saved." });
    await refetch();
  });

  const saveWorldPressures = () => runOperation("world-pressures", async () => {
    const worldPressures = worldPressureForms.map((pressure) => ({
      ...pressure,
      label: pressure.label.trim(),
      currentMotion: pressure.currentMotion.trim(),
    })).filter((pressure) => pressure.label || pressure.currentMotion);
    const response = await fetchJson<{ worldPressures: ReadonlyArray<WorldPressurePayload> }>(`/books/${bookId}/lab/world-pressures`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worldPressures }),
    });
    setWorldPressureForms(response.worldPressures.map(pressureToForm));
    setMessage({ tone: "success", text: "World pressures saved." });
    await refetch();
  });

  const createTick = () => runOperation("tick", async () => {
    const chapter = parsePositiveChapter(tickChapter);
    if (!chapter) {
      setMessage({ tone: "error", text: "Chapter must be a positive integer." });
      return;
    }
    if (!tickActionText.trim()) {
      setMessage({ tone: "error", text: "Tick text is required." });
      return;
    }
    await postApi<{ tick: AdaptiveTickPayload; movementCandidates: ReadonlyArray<MovementCandidatePayload> }>(
      `/books/${bookId}/lab/ticks`,
      buildTickRequest({ chapter, kind: tickKind, actionText: tickActionText }),
    );
    setTickActionText("");
    setMessage({ tone: "success", text: "Adaptive tick created." });
    await refetch();
  });

  const updateCandidateStatus = async (candidate: MovementCandidatePayload, status: MovementCandidateStatusPayload) => {
    setCandidateBusyId(candidate.id);
    setMessage(null);
    try {
      await fetchJson<{ movementCandidate: MovementCandidatePayload; movementCandidates: ReadonlyArray<MovementCandidatePayload> }>(
        `/books/${bookId}/lab/movement-candidates/${candidate.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (status !== "approved") {
        setSelectedCandidateIds((current) => current.filter((id) => id !== candidate.id));
      }
      setMessage({ tone: "success", text: `Candidate marked ${labelForStatus(status).toLowerCase()}.` });
      await refetch();
    } catch (caught) {
      setMessage({ tone: "error", text: errorMessage(caught) });
    } finally {
      setCandidateBusyId(null);
    }
  };

  const toggleCandidateSelection = (candidate: MovementCandidatePayload) => {
    if (candidate.status !== "approved") return;
    setSelectedCandidateIds((current) => (
      current.includes(candidate.id)
        ? current.filter((id) => id !== candidate.id)
        : [...current, candidate.id]
    ));
  };

  const createSceneContract = () => runOperation("scene-contract", async () => {
    const chapter = parsePositiveChapter(sceneForm.chapter);
    if (!chapter) {
      setMessage({ tone: "error", text: "Scene chapter must be a positive integer." });
      return;
    }
    if (!canCompileSceneContract(candidates, selectedCandidateIds)) {
      setMessage({ tone: "error", text: "Selected candidates must be approved before creating a scene contract." });
      return;
    }

    const response = await postApi<{ sceneContract: SceneContractPayload }>(`/books/${bookId}/lab/scene-contracts`, {
      chapter,
      pov: sceneForm.pov,
      location: sceneForm.location,
      outlineNode: sceneForm.outlineNode,
      sceneGoal: parseLines(sceneForm.sceneGoal),
      mustInclude: parseLines(sceneForm.mustInclude),
      mustAvoid: parseLines(sceneForm.mustAvoid),
      styleEmphasis: parseLines(sceneForm.styleEmphasis),
      movementCandidateIds: selectedCandidateIds,
      endingState: parseLines(sceneForm.endingState),
    });
    setCompileFeedback(null);
    setMessage({ tone: "success", text: `Scene contract ${response.sceneContract.id} created.` });
    await refetch();
  });

  const compileSceneContract = async (contract: SceneContractPayload) => {
    setCompileBusyId(contract.id);
    setMessage(null);
    setCompileFeedback(null);
    try {
      const response = await postApi<{ runtimePath: string; intentMarkdown: string }>(
        `/books/${bookId}/lab/scene-contracts/${contract.id}/compile`,
      );
      setCompileFeedback({
        contractId: contract.id,
        status: "success",
        message: "Intent compiled.",
        runtimePath: response.runtimePath,
        intentMarkdown: response.intentMarkdown,
      });
    } catch (caught) {
      setCompileFeedback({
        contractId: contract.id,
        status: "error",
        message: errorMessage(caught),
      });
    } finally {
      setCompileBusyId(null);
    }
  };

  const updateWorldPressure = (id: string, patch: Partial<WorldPressurePayload>) => {
    setWorldPressureForms((current) => current.map((pressure) => (
      pressure.id === id ? { ...pressure, ...patch } : pressure
    )));
  };

  if (loading && !lab) {
    return (
      <div className="flex min-h-[24rem] items-center justify-center rounded-lg border border-border/60 bg-background/70 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading lab
      </div>
    );
  }

  if (error && !lab) {
    return (
      <div className="space-y-4 rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-destructive">
        <div className="font-medium">Could not load Story World Lab.</div>
        <div className="text-sm leading-6">{error}</div>
        <button type="button" onClick={() => void refetch()} className={actionButtonClassName("reject")}>
          <RefreshCw size={14} />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <button type="button" onClick={onOpenBook} className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft size={13} />
              Book
            </button>
            <span>/</span>
            <span>Story World Lab</span>
          </div>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-foreground">Story World Lab</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border/60 bg-secondary/40 px-2.5 py-1 text-xs text-muted-foreground">
            {lab?.projectMode === "serialized" ? "Serialized" : "Draft"}
          </span>
          <button type="button" onClick={() => void refetch()} className={actionButtonClassName("neutral")}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {message && <StatusLine tone={message.tone} message={message.text} />}
      {error && lab && <StatusLine tone="warn" message={error} />}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <Section
            title="Story Spine"
            meta={lab?.storySpine ? "Current driver" : "Not saved"}
            actions={(
              <button
                type="button"
                onClick={saveStorySpine}
                disabled={busyOperation === "story-spine"}
                className={actionButtonClassName("approve")}
              >
                {busyOperation === "story-spine" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save size={14} />}
                Save
              </button>
            )}
          >
            <div className="grid gap-3 lg:grid-cols-3">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Protagonist</span>
                <input
                  value={storySpineForm.protagonistId}
                  onChange={(event) => setStorySpineForm((current) => ({ ...current, protagonistId: event.target.value }))}
                  className={fieldClassName()}
                />
              </label>
              <label className="space-y-1.5 lg:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">Current goal</span>
                <input
                  value={storySpineForm.currentGoal}
                  onChange={(event) => setStorySpineForm((current) => ({ ...current, currentGoal: event.target.value }))}
                  className={fieldClassName()}
                />
              </label>
              <label className="space-y-1.5 lg:col-span-3">
                <span className="text-xs font-medium text-muted-foreground">Current question</span>
                <input
                  value={storySpineForm.currentQuestion}
                  onChange={(event) => setStorySpineForm((current) => ({ ...current, currentQuestion: event.target.value }))}
                  className={fieldClassName()}
                />
              </label>
              <LineTextArea
                label="Emotional state"
                value={storySpineForm.emotionalState}
                onChange={(value) => setStorySpineForm((current) => ({ ...current, emotionalState: value }))}
              />
              <LineTextArea
                label="Active choices"
                value={storySpineForm.activeChoices}
                onChange={(value) => setStorySpineForm((current) => ({ ...current, activeChoices: value }))}
              />
              <LineTextArea
                label="Constraints"
                value={storySpineForm.constraints}
                onChange={(value) => setStorySpineForm((current) => ({ ...current, constraints: value }))}
              />
            </div>
          </Section>

          <Section
            title="World Pressures"
            meta={`${worldPressureForms.length} tracked`}
            actions={(
              <>
                <button type="button" onClick={() => setWorldPressureForms((current) => [...current, createPressure()])} className={actionButtonClassName("neutral")}>
                  <Plus size={14} />
                  Add
                </button>
                <button
                  type="button"
                  onClick={saveWorldPressures}
                  disabled={busyOperation === "world-pressures"}
                  className={actionButtonClassName("approve")}
                >
                  {busyOperation === "world-pressures" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save size={14} />}
                  Save
                </button>
              </>
            )}
          >
            <div className="space-y-3">
              {worldPressureForms.length === 0 && (
                <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
                  No world pressures.
                </div>
              )}
              {worldPressureForms.map((pressure) => (
                <div key={pressure.id} className="grid gap-2 rounded-lg border border-border/50 bg-secondary/20 p-3 lg:grid-cols-[9rem_minmax(0,1fr)_8rem_8rem_2rem]">
                  <select
                    value={pressure.type}
                    onChange={(event) => updateWorldPressure(pressure.id, { type: event.target.value as WorldPressureTypePayload })}
                    className={selectClassName()}
                    aria-label="Pressure type"
                  >
                    {PRESSURE_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <div className="grid gap-2 md:grid-cols-2">
                    <input
                      value={pressure.label}
                      onChange={(event) => updateWorldPressure(pressure.id, { label: event.target.value })}
                      placeholder="Label"
                      className={fieldClassName()}
                    />
                    <input
                      value={pressure.currentMotion}
                      onChange={(event) => updateWorldPressure(pressure.id, { currentMotion: event.target.value })}
                      placeholder="Current motion"
                      className={fieldClassName()}
                    />
                  </div>
                  <select
                    value={pressure.pressureLevel}
                    onChange={(event) => updateWorldPressure(pressure.id, { pressureLevel: event.target.value as PressureLevelPayload })}
                    className={selectClassName()}
                    aria-label="Pressure level"
                  >
                    {PRESSURE_LEVEL_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <select
                    value={pressure.visibleToProtagonist}
                    onChange={(event) => updateWorldPressure(pressure.id, { visibleToProtagonist: event.target.value as ProtagonistVisibilityPayload })}
                    className={selectClassName()}
                    aria-label="Protagonist visibility"
                  >
                    {PROTAGONIST_VISIBILITY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => setWorldPressureForms((current) => current.filter((entry) => entry.id !== pressure.id))}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground hover:text-destructive"
                    aria-label="Remove pressure"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Adaptive Tick" meta={`${lab?.ticks.length ?? 0} ticks`}>
            <div className="grid gap-3 lg:grid-cols-[6rem_11rem_minmax(0,1fr)_8rem]">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Chapter</span>
                <input
                  type="number"
                  min={1}
                  value={tickChapter}
                  onChange={(event) => setTickChapter(event.target.value)}
                  className={fieldClassName()}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Kind</span>
                <select
                  value={tickKind}
                  onChange={(event) => setTickKind(event.target.value as AdaptiveTickKindPayload)}
                  className={selectClassName("w-full")}
                >
                  {TICK_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Movement</span>
                <textarea
                  value={tickActionText}
                  onChange={(event) => setTickActionText(event.target.value)}
                  placeholder={selectedTickKind.placeholder}
                  rows={3}
                  className={fieldClassName("min-h-[5.25rem] resize-y")}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={createTick}
                  disabled={busyOperation === "tick"}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-brand/30 bg-brand px-3 text-sm font-medium text-brand-foreground shadow-sm shadow-brand/20 transition hover:brightness-[1.03] disabled:pointer-events-none disabled:opacity-50"
                >
                  {busyOperation === "tick" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles size={15} />}
                  Create
                </button>
              </div>
            </div>
          </Section>

          <Section title="Movement Candidates" meta={`${candidates.length} total`}>
            <div className="grid gap-4 xl:grid-cols-2">
              <CandidateGroup
                title="Candidate"
                candidates={groupedCandidates.candidate}
                selectedCandidateIds={selectedCandidateIds}
                candidateBusyId={candidateBusyId}
                onToggle={toggleCandidateSelection}
                onStatus={updateCandidateStatus}
              />
              <CandidateGroup
                title="Approved"
                candidates={groupedCandidates.approved}
                selectedCandidateIds={selectedCandidateIds}
                candidateBusyId={candidateBusyId}
                onToggle={toggleCandidateSelection}
                onStatus={updateCandidateStatus}
              />
              <CandidateGroup
                title="Hold"
                candidates={groupedCandidates.hold}
                selectedCandidateIds={selectedCandidateIds}
                candidateBusyId={candidateBusyId}
                onToggle={toggleCandidateSelection}
                onStatus={updateCandidateStatus}
              />
              <CandidateGroup
                title="Rejected"
                candidates={groupedCandidates.rejected}
                selectedCandidateIds={selectedCandidateIds}
                candidateBusyId={candidateBusyId}
                onToggle={toggleCandidateSelection}
                onStatus={updateCandidateStatus}
              />
            </div>
          </Section>

          <Section
            title="Scene Contract"
            meta={`${selectedCandidateIds.length} selected`}
            actions={(
              <button
                type="button"
                onClick={createSceneContract}
                disabled={busyOperation === "scene-contract"}
                className={actionButtonClassName("approve")}
              >
                {busyOperation === "scene-contract" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText size={14} />}
                Create
              </button>
            )}
          >
            <div className="space-y-3">
              {!selectedCandidatesReady && selectedCandidateIds.length > 0 && (
                <StatusLine tone="error" message="Only approved candidates can be used for a scene contract." />
              )}
              {selectedConflictRisk && (
                <StatusLine tone="warn" message="Selected candidates carry conflict risk. Compile may return warnings or blockers." />
              )}
              <div className="grid gap-3 lg:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)]">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Chapter</span>
                  <input
                    type="number"
                    min={1}
                    value={sceneForm.chapter}
                    onChange={(event) => setSceneForm((current) => ({ ...current, chapter: event.target.value }))}
                    className={fieldClassName()}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">POV</span>
                  <input
                    value={sceneForm.pov}
                    onChange={(event) => setSceneForm((current) => ({ ...current, pov: event.target.value }))}
                    className={fieldClassName()}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Location</span>
                  <input
                    value={sceneForm.location}
                    onChange={(event) => setSceneForm((current) => ({ ...current, location: event.target.value }))}
                    className={fieldClassName()}
                  />
                </label>
                <label className="space-y-1.5 lg:col-span-3">
                  <span className="text-xs font-medium text-muted-foreground">Outline node</span>
                  <input
                    value={sceneForm.outlineNode}
                    onChange={(event) => setSceneForm((current) => ({ ...current, outlineNode: event.target.value }))}
                    className={fieldClassName()}
                  />
                </label>
                <LineTextArea
                  label="Scene goal"
                  value={sceneForm.sceneGoal}
                  onChange={(value) => setSceneForm((current) => ({ ...current, sceneGoal: value }))}
                />
                <LineTextArea
                  label="Must include"
                  value={sceneForm.mustInclude}
                  onChange={(value) => setSceneForm((current) => ({ ...current, mustInclude: value }))}
                />
                <LineTextArea
                  label="Must avoid"
                  value={sceneForm.mustAvoid}
                  onChange={(value) => setSceneForm((current) => ({ ...current, mustAvoid: value }))}
                />
                <LineTextArea
                  label="Style emphasis"
                  value={sceneForm.styleEmphasis}
                  onChange={(value) => setSceneForm((current) => ({ ...current, styleEmphasis: value }))}
                />
                <LineTextArea
                  label="Ending state"
                  value={sceneForm.endingState}
                  onChange={(value) => setSceneForm((current) => ({ ...current, endingState: value }))}
                />
              </div>
            </div>
          </Section>

          <Section title="Scene Contracts" meta={`${lab?.sceneContracts.length ?? 0} contracts`}>
            <div className="space-y-3">
              {(lab?.sceneContracts.length ?? 0) === 0 && (
                <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
                  No scene contracts.
                </div>
              )}
              {lab?.sceneContracts.map((contract) => {
                const compileReady = canCompileSceneContract(candidates, contract.movementCandidateIds);
                const contractRisk = hasSelectedConflictRisk(candidates, contract.movementCandidateIds);
                const feedback = compileFeedback?.contractId === contract.id ? compileFeedback : null;
                return (
                  <div key={contract.id} className="rounded-lg border border-border/55 bg-secondary/20 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">Chapter {contract.chapter}</span>
                          <Badge>{policyLabel(contract.conflictPolicy)}</Badge>
                          {contractRisk && <Badge tone="warn">Conflict risk</Badge>}
                          {!compileReady && <Badge tone="danger">Needs approval</Badge>}
                        </div>
                        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                          <span className="truncate">POV: {contract.pov || "-"}</span>
                          <span className="truncate">Location: {contract.location || "-"}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {contract.movementCandidateIds.length} candidates / {contract.sourceTickIds.length} ticks
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void compileSceneContract(contract)}
                        disabled={!compileReady || compileBusyId === contract.id}
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-brand/30 bg-brand px-3 text-xs font-medium text-brand-foreground shadow-sm shadow-brand/20 transition hover:brightness-[1.03] disabled:pointer-events-none disabled:opacity-50"
                      >
                        {compileBusyId === contract.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles size={14} />}
                        Compile
                      </button>
                    </div>
                    {feedback && (
                      <div className="mt-3">
                        <StatusLine tone={feedback.status === "success" ? "success" : "error"} message={feedback.message} />
                        {feedback.runtimePath && (
                          <div className="mt-2 rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                            {feedback.runtimePath}
                          </div>
                        )}
                        {feedback.intentMarkdown && (
                          <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border/50 bg-background/70 p-3 text-xs leading-5 text-foreground whitespace-pre-wrap">
                            {feedback.intentMarkdown}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        <aside className="space-y-5">
          <Section title="Chapter Status" meta={`${lab?.chapterStatus.length ?? 0} tracked`}>
            <div className="space-y-2">
              {(lab?.chapterStatus.length ?? 0) === 0 && (
                <div className="text-sm text-muted-foreground">No chapter status records.</div>
              )}
              {lab?.chapterStatus.map((entry) => (
                <div key={entry.chapter} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-sm">
                  <span className="font-medium text-foreground">Chapter {entry.chapter}</span>
                  <Badge tone={entry.status === "published" ? "danger" : entry.status === "locked" ? "warn" : "neutral"}>
                    {statusLabelForChapter(entry.status)}
                  </Badge>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Recent Ticks" meta={`${lab?.ticks.length ?? 0} total`}>
            <div className="space-y-2">
              {(lab?.ticks.length ?? 0) === 0 && <div className="text-sm text-muted-foreground">No ticks.</div>}
              {lab?.ticks.slice(-5).reverse().map((tick) => (
                <div key={tick.id} className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>Chapter {tick.chapter}</span>
                    <span>{tick.kind}</span>
                  </div>
                  <div className="mt-1 text-sm leading-6 text-foreground">
                    {tick.protagonistAction ?? tick.protagonistInaction ?? tick.elapsedTime ?? tick.userDirection ?? "-"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{tick.candidates.length} candidates</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Impact Reports" meta={`${lab?.impactReports.length ?? 0} reports`}>
            <div className="space-y-2">
              {(lab?.impactReports.length ?? 0) === 0 && <div className="text-sm text-muted-foreground">No impact reports.</div>}
              {lab?.impactReports.slice(-5).reverse().map((report) => (
                <div key={`${report.movementCandidateId}-${report.updatedAt}`} className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={report.conflictLevel === "major" ? "danger" : report.conflictLevel === "minor" ? "warn" : "neutral"}>
                      {labelForConflict(report.conflictLevel)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{report.affectedChapters.join(", ") || "-"}</span>
                  </div>
                  {report.notes.length > 0 && (
                    <div className="mt-2 text-xs leading-5 text-muted-foreground">
                      {report.notes.join(" / ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Selected">
            <div className="space-y-2">
              {selectedCandidateIds.length === 0 && <div className="text-sm text-muted-foreground">No selected candidates.</div>}
              {selectedCandidateIds.map((id) => {
                const candidate = candidates.find((entry) => entry.id === id);
                return (
                  <div key={id} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-foreground">{candidate?.text ?? id}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedCandidateIds((current) => current.filter((entry) => entry !== id))}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="Remove selected candidate"
                    >
                      <XCircle size={14} />
                    </button>
                  </div>
                );
              })}
              {!selectedCandidatesReady && selectedCandidateIds.length > 0 && (
                <div className="flex items-start gap-2 text-xs leading-5 text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Approval preflight failed.
                </div>
              )}
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}

function LineTextArea({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className={fieldClassName("min-h-[5.25rem] resize-y")}
      />
    </label>
  );
}

function CandidateGroup({
  title,
  candidates,
  selectedCandidateIds,
  candidateBusyId,
  onToggle,
  onStatus,
}: {
  readonly title: string;
  readonly candidates: ReadonlyArray<MovementCandidatePayload>;
  readonly selectedCandidateIds: ReadonlyArray<string>;
  readonly candidateBusyId: string | null;
  readonly onToggle: (candidate: MovementCandidatePayload) => void;
  readonly onStatus: (candidate: MovementCandidatePayload, status: MovementCandidateStatusPayload) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">{candidates.length}</span>
      </div>
      {candidates.length === 0 && (
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-sm text-muted-foreground">
          Empty
        </div>
      )}
      {candidates.map((candidate) => (
        <div key={candidate.id} className="rounded-lg border border-border/50 bg-secondary/20 p-3">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={selectedCandidateIds.includes(candidate.id)}
              disabled={candidate.status !== "approved"}
              onChange={() => onToggle(candidate)}
              className="mt-1 h-4 w-4 rounded border-border text-brand focus:ring-ring"
              aria-label="Select movement candidate"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm leading-6 text-foreground">{candidate.text}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge>{candidate.relevance}</Badge>
                <Badge>{candidate.visibility}</Badge>
                <Badge tone={candidate.risk === "high" ? "danger" : candidate.risk === "medium" ? "warn" : "neutral"}>
                  {candidate.risk} risk
                </Badge>
                <Badge tone={candidate.conflictLevel === "major" ? "danger" : candidate.conflictLevel === "minor" ? "warn" : "neutral"}>
                  {labelForConflict(candidate.conflictLevel)}
                </Badge>
              </div>
              <div className="mt-2 text-xs leading-5 text-muted-foreground">
                Chapters {candidate.affectedChapters.join(", ") || "-"} / {candidate.affectedStateKeys.join(", ") || "-"}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <CandidateStatusButton
              candidate={candidate}
              status="approved"
              busy={candidateBusyId === candidate.id}
              onStatus={onStatus}
            />
            <CandidateStatusButton
              candidate={candidate}
              status="hold"
              busy={candidateBusyId === candidate.id}
              onStatus={onStatus}
            />
            <CandidateStatusButton
              candidate={candidate}
              status="rejected"
              busy={candidateBusyId === candidate.id}
              onStatus={onStatus}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function CandidateStatusButton({
  candidate,
  status,
  busy,
  onStatus,
}: {
  readonly candidate: MovementCandidatePayload;
  readonly status: MovementCandidateStatusPayload;
  readonly busy: boolean;
  readonly onStatus: (candidate: MovementCandidatePayload, status: MovementCandidateStatusPayload) => void;
}) {
  const tone = status === "approved" ? "approve" : status === "hold" ? "hold" : "reject";
  const icon = status === "approved"
    ? <Check size={14} />
    : status === "hold"
      ? <PauseCircle size={14} />
      : <XCircle size={14} />;
  return (
    <button
      type="button"
      disabled={busy || candidate.status === status}
      onClick={() => onStatus(candidate, status)}
      className={actionButtonClassName(tone)}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {labelForStatus(status)}
    </button>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  readonly children: React.ReactNode;
  readonly tone?: "neutral" | "warn" | "danger";
}) {
  const toneClass = tone === "danger"
    ? "border-destructive/30 bg-destructive/10 text-destructive"
    : tone === "warn"
      ? "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : "border-border/60 bg-background/70 text-muted-foreground";
  return (
    <span className={`inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium ${toneClass}`}>
      {children}
    </span>
  );
}
