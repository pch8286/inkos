import type { ReactNode } from "react";
import type { TFunction } from "../../hooks/use-i18n";
import type { ReasoningEffort } from "../../shared/llm";
import { makeTruthPreview, buildTruthLineDiff, summarizeTruthDiff } from "../../shared/truth-assistant";
import type { BookSetupSessionPayload } from "../../shared/contracts";
import type { BookSetupSessionSummary } from "../cockpit-shared";
import type { InspectorTab } from "../cockpit-shared";
import type { SetupPrimaryAction } from "../cockpit-ui-state";
import type { SetupAutoCreatePhase } from "../cockpit-setup-autocreate";
import type { ReactElement } from "react";
import { ArrowRight, BookOpen, Check, RefreshCcw, Sparkles } from "lucide-react";

interface CockpitStatusActivity {
  readonly event: string;
  readonly data: unknown;
  readonly timestamp: number;
}

interface SetupNoteData {
  readonly chosen: ReadonlyArray<string>;
  readonly openQuestions: ReadonlyArray<string>;
  readonly creativeBriefPreview: string;
}

interface SectionButtonProps {
  readonly disabled?: boolean;
  readonly className?: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}

interface TabButtonProps {
  readonly tabId: string;
  readonly panelId: string;
  readonly active: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly badge?: number;
  readonly onClick: () => void;
}

interface SetupPanelData {
  readonly loadingRecentSetupSessions: boolean;
  readonly recentSetupSessions: ReadonlyArray<BookSetupSessionSummary>;
  readonly setupRecoveryError: string | null;
  readonly onResumeSetupSession: (session: BookSetupSessionSummary) => void;
  readonly setupModelSuggestions: ReadonlyArray<string>;
  readonly setupModelListId: string;
  readonly setupSupportsReasoning: boolean;
  readonly setupLlmSaving: boolean;
  readonly setupLlmError: string | null;
  readonly setupLlmFormModel: string;
  readonly setupLlmFormReasoningEffort: ReasoningEffort;
  readonly projectProviderLabel: string;
  readonly projectModelLabel: string;
  readonly projectModelPlaceholder: string;
  readonly onSetSetupLlmFormModel: (value: string) => void;
  readonly onSetSetupLlmFormReasoningEffort: (value: ReasoningEffort) => void;
  readonly onSaveSetupLlm: () => void;
  readonly setupReasons: ReadonlyArray<ReasoningEffort>;
  readonly setupReasoningEfforts: ReadonlyArray<ReasoningEffort>;
  readonly setupTitle: string;
  readonly setupGenre: string;
  readonly setupPlatform: string;
  readonly setupWords: string;
  readonly setupTargetChapters: string;
  readonly setupBrief: string;
  readonly onSetSetupTitle: (value: string) => void;
  readonly onSetSetupGenre: (value: string) => void;
  readonly onSetSetupPlatform: (value: string) => void;
  readonly onSetSetupWords: (value: string) => void;
  readonly onSetSetupTargetChapters: (value: string) => void;
  readonly onSetSetupBrief: (value: string) => void;
  readonly genres: ReadonlyArray<{ id: string; name: string }>;
  readonly platformOptions: ReadonlyArray<{ value: string; label: string }>;
  readonly onLegacyCreate: (() => void) | null;
  readonly setupNotes: SetupNoteData;
  readonly setupMissingInfoLabels: ReadonlyArray<string>;
  readonly setupDiscussionLabel: string;
  readonly setupStatusLabel: string;
  readonly setupSession: BookSetupSessionPayload | null;
  readonly setupDraftDirty: boolean;
  readonly setupProposalDelta: ReadonlyArray<string>;
  readonly setupPrimaryAction: SetupPrimaryAction;
  readonly secondarySetupActions: ReadonlyArray<SetupPrimaryAction>;
  readonly foundationPreviewTabs: ReadonlyArray<{ key: string; label: string; content: string }>;
  readonly selectedFoundationPreviewKey: string;
  readonly onSetSelectedFoundationPreviewKey: (key: string) => void;
  readonly renderSetupActionButton: (action: SetupPrimaryAction, primary?: boolean) => ReactNode;
  readonly resumingSetupSessionId: string;
  readonly autoCreatePhase: SetupAutoCreatePhase | null;
  readonly autoCreateFailedPhase: SetupAutoCreatePhase | null;
  readonly onRetryAutoCreate: () => void;
}

interface FocusPanelData {
  readonly heading: string;
  readonly title: string;
  readonly content: string;
}

interface ChangesPanelData {
  readonly selectedTruthFile: string;
  readonly truthFileContent: string;
  readonly changes: ReadonlyArray<{ fileName: string; label: string; content: string }>;
  readonly onApplyChange: (fileName: string, content: string) => void;
}

interface TabIds {
  readonly focusTabId: string;
  readonly changesTabId: string;
  readonly setupTabId: string;
  readonly activityTabId: string;
  readonly focusPanelId: string;
  readonly changesPanelId: string;
  readonly setupPanelId: string;
  readonly activityPanelId: string;
}

interface ClassNames {
  readonly btnPrimary: string;
  readonly btnSecondary: string;
  readonly input: string;
  readonly error: string;
}

interface CockpitInspectorPanelProps {
  readonly t: TFunction;
  readonly inspectorTab: InspectorTab;
  readonly setInspectorTab: (tab: InspectorTab) => void;
  readonly hasPendingChanges: boolean;
  readonly pendingChangesCount: number;
  readonly selectedBookLabel: string;
  readonly setupStatusLabelFallback: string;
  readonly focusPanel: FocusPanelData;
  readonly focusPanelEmptyLabel: string;
  readonly setupTabEmptyLabel: string;
  readonly changesPanel: ChangesPanelData;
  readonly setupPanel: SetupPanelData;
  readonly activityEntries: ReadonlyArray<CockpitStatusActivity>;
  readonly activityEmptyLabel: string;
  readonly classNames: ClassNames;
  readonly ids: TabIds;
  readonly InspectorTabButton: (props: TabButtonProps) => ReactNode;
  readonly ActionButton: (props: SectionButtonProps) => ReactNode;
}

function deriveSetupStatusTag({ draftDirty, setupSession }: { draftDirty: boolean; setupSession: BookSetupSessionPayload | null }) {
  if (!setupSession) return "";
  return `${setupSession.status} · ${setupSession.bookId} · r${setupSession.revision}`;
}

function makeActivityDataPreview(data: unknown): string {
  return makeTruthPreview(JSON.stringify(data ?? {}, null, 2), 140);
}

export function CockpitInspectorPanel({
  t,
  inspectorTab,
  setInspectorTab,
  hasPendingChanges,
  pendingChangesCount,
  selectedBookLabel,
  setupStatusLabelFallback,
  focusPanel,
  focusPanelEmptyLabel,
  changesPanel,
  setupPanel,
  activityEntries,
  activityEmptyLabel,
  classNames,
  ids,
  InspectorTabButton,
  ActionButton,
}: CockpitInspectorPanelProps) {
  const activeFoundationPreview = setupPanel.foundationPreviewTabs.find((entry) => entry.key === setupPanel.selectedFoundationPreviewKey)
    ?? setupPanel.foundationPreviewTabs[0]
    ?? null;

  return (
    <aside className="studio-cockpit-right studio-cockpit-rail xl:pr-1">
      <div className="rounded-[1.6rem] border border-border/50 bg-card/70 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("cockpit.currentContext")}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{selectedBookLabel}</div>
          </div>
          {hasPendingChanges ? (
            <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
              {pendingChangesCount}
            </span>
          ) : null}
        </div>

        <div className="studio-inspector-tabbar" role="tablist" aria-label={t("cockpit.currentContext")}>
          <InspectorTabButton
            tabId={ids.focusTabId}
            panelId={ids.focusPanelId}
            active={inspectorTab === "focus"}
            icon={<BookOpen size={13} />}
            label={t("cockpit.currentContext")}
            onClick={() => setInspectorTab("focus")}
          />
          <InspectorTabButton
            tabId={ids.changesTabId}
            panelId={ids.changesPanelId}
            active={inspectorTab === "changes"}
            icon={<Check size={13} />}
            label={t("cockpit.pendingChanges")}
            badge={hasPendingChanges ? pendingChangesCount : undefined}
            onClick={() => setInspectorTab("changes")}
          />
          <InspectorTabButton
            tabId={ids.setupTabId}
            panelId={ids.setupPanelId}
            active={inspectorTab === "setup"}
            icon={<Sparkles size={13} />}
            label={t("cockpit.setupTitle")}
            onClick={() => setInspectorTab("setup")}
          />
          <InspectorTabButton
            tabId={ids.activityTabId}
            panelId={ids.activityPanelId}
            active={inspectorTab === "activity"}
            icon={<RefreshCcw size={13} />}
            label={t("cockpit.activity")}
            onClick={() => setInspectorTab("activity")}
          />
        </div>

        <div className="mt-4">
          {inspectorTab === "focus" && (
            <div className="space-y-4" role="tabpanel" id={ids.focusPanelId} aria-labelledby={ids.focusTabId}>
              <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {focusPanel.heading}
                </div>
                {focusPanel.content ? (
                  <div className="rounded-xl border border-border/50 bg-background/70 px-4 py-4">
                    <div className="mb-2 font-medium text-foreground">{focusPanel.title}</div>
                    <div className="max-h-[24rem] overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-foreground/85">
                      {focusPanel.content.slice(0, 1600)}
                      {focusPanel.content.length > 1600 ? "…" : ""}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border/60 bg-background/50 px-4 py-8 text-center text-sm text-muted-foreground">
                    {focusPanelEmptyLabel}
                  </div>
                )}
              </div>
            </div>
          )}

          {inspectorTab === "changes" && (
            changesPanel.changes.length > 0 ? (
              <div className="space-y-4" role="tabpanel" id={ids.changesPanelId} aria-labelledby={ids.changesTabId}>
                {changesPanel.changes.map((change) => {
                  const before = change.fileName === changesPanel.selectedTruthFile ? changesPanel.truthFileContent : "";
                  const diff = buildTruthLineDiff(before, change.content);
                  const summary = summarizeTruthDiff(diff);

                  return (
                    <div key={change.fileName} className="rounded-2xl border border-border/50 bg-background/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-foreground">{change.label}</div>
                          <div className="text-xs text-muted-foreground">+{summary.added} / -{summary.removed}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => changesPanel.onApplyChange(change.fileName, change.content)}
                          className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${classNames.btnPrimary}`}
                        >
                          <Check size={13} />
                          {t("cockpit.apply")}
                        </button>
                      </div>

                      <div className="mt-3 max-h-[18rem] overflow-y-auto rounded-xl border border-border/50 bg-background/70 px-3 py-3 font-mono text-xs leading-6">
                        {diff.map((line, index) => (
                          <div
                            key={`${change.fileName}-${index}`}
                            className={
                              line.type === "add"
                                ? "text-emerald-300"
                                : line.type === "remove"
                                  ? "text-rose-300"
                                  : line.type === "skip"
                                    ? "text-muted-foreground italic"
                                    : "text-foreground/75"
                            }
                          >
                            {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                            {line.text}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border/60 bg-background/50 px-4 py-8 text-center text-sm leading-7 text-muted-foreground" role="tabpanel" id={ids.changesPanelId} aria-labelledby={ids.changesTabId}>
                {t("cockpit.commandHint")}
              </div>
            )
          )}

          {inspectorTab === "setup" && (
            <div className="space-y-4" role="tabpanel" id={ids.setupPanelId} aria-labelledby={ids.setupTabId}>
              <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                <div className="mb-3 flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  <span>{t("cockpit.setupRecoveryTitle")}</span>
                  {setupPanel.loadingRecentSetupSessions ? <RefreshCcw size={12} className="animate-spin" /> : null}
                </div>
                <div className="mb-3 text-xs leading-6 text-muted-foreground">{t("cockpit.setupRecoveryHint")}</div>

                {setupPanel.setupRecoveryError ? (
                  <div className={`rounded-xl border px-3 py-2 text-xs ${classNames.error}`}>
                    {setupPanel.setupRecoveryError}
                  </div>
                ) : null}

                {setupPanel.recentSetupSessions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 bg-background/50 px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("cockpit.setupRecoveryEmpty")}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {setupPanel.recentSetupSessions.map((session) => {
                      const sessionLabel = session.updatedAt || session.createdAt;
                      return (
                        <div key={session.id} className="rounded-2xl border border-border/50 bg-background/70 px-3 py-3">
                          <div className="mb-2 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">{session.title}</div>
                              <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                                <span className="rounded-full studio-badge-soft px-2 py-1 uppercase tracking-[0.12em]">{session.status}</span>
                                <span>{session.genre}</span>
                                <span>·</span>
                                <span>{session.platform}</span>
                                <span>·</span>
                                <span>{`${session.chapterWordCount}/${session.targetChapters} ch`}</span>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">{sessionLabel}</div>
                              {session.brief ? (
                                <div className="mt-2 text-xs leading-5 text-muted-foreground">{makeTruthPreview(session.brief, 78)}</div>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => setupPanel.onResumeSetupSession(session)}
                              disabled={setupPanel.resumingSetupSessionId === session.id}
                              className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${
                                setupPanel.resumingSetupSessionId === session.id
                                  ? "cursor-not-allowed opacity-45"
                                  : classNames.btnSecondary
                              }`}
                            >
                              {setupPanel.resumingSetupSessionId === session.id ? <RefreshCcw size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
                              {t("cockpit.resumeSetup")}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{t("app.llmSettings")}</div>
                  <div className="text-xs font-medium text-muted-foreground">{setupPanel.projectProviderLabel}</div>
                </div>
                <div className="mb-3 text-xs leading-6 text-muted-foreground">{t("cockpit.setupLlmHint")}</div>

                {setupPanel.setupLlmError ? (
                  <div className={`mb-3 rounded-xl border px-3 py-2 text-xs ${classNames.error}`}>
                    {setupPanel.setupLlmError}
                  </div>
                ) : null}

                <div className="space-y-3">
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">{t("config.model")}</span>
                    <input
                      list={setupPanel.setupModelListId}
                      value={setupPanel.setupLlmFormModel}
                      onChange={(event) => setupPanel.onSetSetupLlmFormModel(event.target.value)}
                      placeholder={setupPanel.projectModelPlaceholder}
                      disabled={!setupPanel.projectProviderLabel || setupPanel.setupLlmSaving}
                      className={`w-full rounded-xl px-3 py-2.5 text-sm outline-none ${classNames.input}`}
                    />
                    <datalist id={setupPanel.setupModelListId}>
                      {setupPanel.setupModelSuggestions.map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                  </label>

                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                    <label className="block space-y-1">
                      <span className="text-[11px] font-medium text-muted-foreground">{t("config.reasoningLevel")}</span>
                      <select
                        value={setupPanel.setupSupportsReasoning ? setupPanel.setupLlmFormReasoningEffort : ""}
                        onChange={(event) => setupPanel.onSetSetupLlmFormReasoningEffort(event.target.value as ReasoningEffort)}
                        disabled={!setupPanel.setupSupportsReasoning || setupPanel.setupLlmSaving}
                        className={`rounded-xl px-3 py-2.5 text-sm outline-none ${classNames.input} disabled:opacity-60`}
                      >
                        <option value="">{setupPanel.setupSupportsReasoning ? t("config.default") : t("config.reasoningUnsupported")}</option>
                        {setupPanel.setupReasons.map((reasoning) => (
                          <option key={reasoning} value={reasoning}>
                            {reasoning === "none"
                              ? t("config.reasoningNone")
                              : reasoning === "minimal"
                                ? t("config.reasoningMinimal")
                                : reasoning === "low"
                                  ? t("config.reasoningLow")
                                  : reasoning === "medium"
                                    ? t("config.reasoningMedium")
                                    : reasoning === "high"
                                      ? t("config.reasoningHigh")
                                      : t("config.reasoningXHigh")}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button
                      type="button"
                      onClick={() => setupPanel.onSaveSetupLlm()}
                      disabled={setupPanel.setupLlmSaving || !setupPanel.setupLlmFormModel || !setupPanel.projectProviderLabel}
                      className={`self-end rounded-xl px-3 py-2 text-sm font-semibold ${
                        setupPanel.setupLlmSaving || !setupPanel.setupLlmFormModel || !setupPanel.projectProviderLabel
                          ? "cursor-not-allowed opacity-45"
                          : classNames.btnPrimary
                      }`}
                    >
                      {setupPanel.setupLlmSaving ? t("config.saving") : t("config.save")}
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    {t("cockpit.setupTitle")}
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                      setupPanel.setupSession?.status === "approved" ? "studio-badge-ok" : "studio-badge-soft"
                    }`}
                  >
                    {setupPanel.setupDiscussionLabel}
                  </span>
                </div>
                <div className="mb-3 text-xs leading-6 text-muted-foreground">{t("cockpit.setupReadyHint")}</div>
                {setupPanel.setupDraftDirty ? (
                  <div className={`mb-3 rounded-xl border px-3 py-2 text-xs ${classNames.error}`}>
                    {t("cockpit.setupDraftChanged")}
                  </div>
                ) : null}
                {setupPanel.autoCreatePhase ? (
                  <div className="mb-3 rounded-xl border border-border/50 bg-background/70 px-3 py-3 text-xs leading-6 text-muted-foreground">
                    {t(`cockpit.autoCreatePhase.${setupPanel.autoCreatePhase}`)}
                  </div>
                ) : null}
                {setupPanel.autoCreateFailedPhase ? (
                  <div className={`mb-3 rounded-xl border px-3 py-3 text-xs ${classNames.error}`}>
                    <div className="font-semibold text-foreground">{t("cockpit.autoCreateFailed")}</div>
                    <div className="mt-1 leading-6 text-foreground/80">
                      {t(`cockpit.autoCreatePhase.${setupPanel.autoCreateFailedPhase}`)}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ActionButton
                        className={classNames.btnPrimary}
                        icon={<Sparkles size={14} />}
                        label={t("cockpit.autoCreateRetry")}
                        onClick={() => setupPanel.onRetryAutoCreate()}
                      />
                      {setupPanel.renderSetupActionButton("discuss")}
                    </div>
                  </div>
                ) : null}
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
                      {setupPanel.setupStatusLabel || setupStatusLabelFallback}
                    </span>
                    {setupPanel.setupSession?.previousProposal ? (
                      <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
                        {t("cockpit.setupWhatChanged")}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {setupPanel.renderSetupActionButton(setupPanel.setupPrimaryAction, true)}
                    {setupPanel.secondarySetupActions.length > 0 ? (
                      <div className="studio-cockpit-secondary-actions">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          {t("cockpit.setupSecondaryActions")}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {setupPanel.secondarySetupActions.map((action) => (
                            setupPanel.renderSetupActionButton(action)
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {setupPanel.onLegacyCreate ? (
                      <ActionButton
                        className={classNames.btnSecondary}
                        icon={<ArrowRight size={14} />}
                        label={t("cockpit.legacyCreate")}
                        onClick={() => setupPanel.onLegacyCreate?.()}
                      />
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{t("cockpit.setupNotes")}</div>
                <div className="space-y-3">
                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("cockpit.setupChosen")}</div>
                    <div className="flex flex-wrap gap-2">
                      {(setupPanel.setupNotes.chosen.length > 0 ? setupPanel.setupNotes.chosen : ["-"]).map((item) => (
                        <span key={`chosen-${item}`} className="rounded-full studio-badge-soft px-2 py-1 text-[11px] text-foreground/85">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("cockpit.setupMissingInfo")}</div>
                    <div className="flex flex-wrap gap-2">
                      {(setupPanel.setupMissingInfoLabels.length > 0 ? setupPanel.setupMissingInfoLabels : ["-"]).map((item) => (
                        <span key={`missing-${item}`} className="rounded-full border border-border/40 bg-card/70 px-2 py-1 text-[11px] text-muted-foreground">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("cockpit.setupOpenQuestions")}</div>
                    <div className="space-y-1">
                      {(setupPanel.setupNotes.openQuestions.length > 0 ? setupPanel.setupNotes.openQuestions : ["-"]).map((item) => (
                        <div key={`question-${item}`} className="text-sm leading-6 text-foreground/85">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("cockpit.setupCreativeBrief")}</div>
                    <div className="rounded-xl border border-border/50 bg-background/70 px-3 py-3 text-sm leading-6 text-foreground/85">
                      {setupPanel.setupNotes.creativeBriefPreview || "-"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{t("cockpit.setupWhatChanged")}</div>
                {setupPanel.setupProposalDelta.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {setupPanel.setupProposalDelta.map((item) => (
                      <span key={`delta-${item}`} className="rounded-full studio-badge-soft px-2 py-1 text-[11px] text-foreground/85">
                        {item}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm leading-6 text-muted-foreground">{t("cockpit.setupNoDelta")}</div>
                )}
              </div>

              <details className="rounded-2xl border border-border/50 bg-background/60 p-3">
                <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {t("cockpit.setupProposalDetails")}
                </summary>
                <div className="mt-3">
                  <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{t("cockpit.setupProposalTitle")}</div>
                  <div className="mb-3 text-xs leading-6 text-muted-foreground">{t("cockpit.approvalGate")}</div>
                  {setupPanel.setupSession ? (
                    <div className="max-h-[19rem] overflow-y-auto whitespace-pre-wrap rounded-xl border border-border/50 bg-background/70 px-3 py-3 text-sm leading-7 text-foreground/88">
                      {setupPanel.setupSession.proposal.content}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border/60 bg-background/50 px-3 py-6 text-sm leading-7 text-muted-foreground">
                      {t("cockpit.setupProposalEmpty")}
                    </div>
                  )}
                </div>
              </details>

              <details className="rounded-2xl border border-border/50 bg-background/60 p-3">
                <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {t("cockpit.foundationPreviewDetails")}
                </summary>
                <div className="mt-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{t("cockpit.foundationPreviewTitle")}</div>
                    {setupPanel.setupSession?.foundationPreview ? (
                      <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
                        exact preview
                      </span>
                    ) : null}
                  </div>
                  <div className="mb-3 text-xs leading-6 text-muted-foreground">{t("cockpit.foundationGate")}</div>

                  {setupPanel.setupSession?.foundationPreview && activeFoundationPreview ? (
                    <>
                      <div className="mb-3 flex flex-wrap gap-2">
                        {setupPanel.foundationPreviewTabs.map((entry) => (
                          <button
                            key={entry.key}
                            type="button"
                            onClick={() => setupPanel.onSetSelectedFoundationPreviewKey(entry.key)}
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${setupPanel.selectedFoundationPreviewKey === entry.key ? classNames.btnPrimary : classNames.btnSecondary}`}
                          >
                            {entry.label}
                          </button>
                        ))}
                      </div>
                      <div className="max-h-[22rem] overflow-y-auto whitespace-pre-wrap rounded-xl border border-border/50 bg-background/70 px-3 py-3 text-sm leading-7 text-foreground/88">
                        {activeFoundationPreview.content}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border/60 bg-background/50 px-3 py-6 text-sm leading-7 text-muted-foreground">
                      {t("cockpit.foundationPreviewEmpty")}
                    </div>
                  )}
                </div>
              </details>
            </div>
          )}

          {inspectorTab === "activity" && (
            <div className="space-y-2" role="tabpanel" id={ids.activityPanelId} aria-labelledby={ids.activityTabId}>
              {activityEntries.length > 0 ? activityEntries.map((entry, index) => (
                <div key={`${entry.event}-${entry.timestamp}-${index}`} className="rounded-xl border border-border/50 bg-background/60 px-3 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{entry.event}</div>
                  <div className="mt-1 text-sm text-foreground/85">{makeActivityDataPreview(entry.data)}</div>
                </div>
              )) : (
                <div className="rounded-xl border border-dashed border-border/60 bg-background/50 px-3 py-6 text-center text-sm text-muted-foreground">
                  {activityEmptyLabel}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
