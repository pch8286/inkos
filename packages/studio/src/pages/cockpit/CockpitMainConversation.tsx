import { Fragment, type KeyboardEvent } from "react";
import type { TFunction } from "../../hooks/use-i18n";
import type { ReactNode } from "react";
import type { CockpitMode } from "../cockpit-ui-state";
import type { ComposerAction, } from "../cockpit-parsing";
import type { QueuedComposerEntry } from "../cockpit-queue-state";
import type { CockpitStatusStrip } from "../cockpit-status-strip";
import type { CockpitMessage } from "../cockpit-shared";
import {
  Bot,
  Check,
  Lightbulb,
  PenSquare,
  Sparkles,
  Wand2,
} from "lucide-react";
import { CockpitLiveStatusStrip } from "./CockpitLiveStatusStrip";

interface ChipItem {
  readonly label: string;
  readonly value: string;
  readonly accent?: boolean;
}

interface ActionButtonProps {
  readonly disabled?: boolean;
  readonly className?: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}

interface ScopeChipProps {
  readonly label: string;
  readonly value: string;
  readonly accent?: boolean;
}

interface StatusPillProps {
  readonly label?: string;
  readonly value: string;
  readonly accent?: boolean;
}

interface MessageBubbleProps {
  readonly message: CockpitMessage;
}

interface QuickStartPanel {
  readonly badge: string;
  readonly title: string;
  readonly status: string;
  readonly description: string;
  readonly note: string;
  readonly missingInfoLabel: string;
  readonly missingInfo: ReadonlyArray<string>;
  readonly actions: ReadonlyArray<ReactNode>;
}

interface ClassNames {
  readonly btnPrimary: string;
  readonly btnSecondary: string;
  readonly input: string;
  readonly error: string;
}

interface CockpitMainConversationProps {
  readonly t: TFunction;
  readonly mode: CockpitMode;
  readonly busy: boolean;
  readonly error: string | null;
  readonly input: string;
  readonly scopeChips: ReadonlyArray<ChipItem>;
  readonly hasPendingChanges: boolean;
  readonly statusPills: ReadonlyArray<ChipItem>;
  readonly status: CockpitStatusStrip;
  readonly activeMessages: ReadonlyArray<CockpitMessage>;
  readonly quickStartPanel: QuickStartPanel | null;
  readonly composerInputId: string;
  readonly composerHintId: string;
  readonly composerHint: string;
  readonly canUseBinder: boolean;
  readonly canUseDraft: boolean;
  readonly hasPendingProposalChanges: boolean;
  readonly queuedComposerEntries: ReadonlyArray<QueuedComposerEntry>;
  readonly onInputChange: (value: string) => void;
  readonly onQueueComposerInput: () => void;
  readonly onRestoreQueuedComposerInput: () => void;
  readonly onSubmit: (action?: ComposerAction) => Promise<void> | void;
  readonly onApplyAll: () => void;
  readonly classes: ClassNames;
  readonly ActionButton: (props: ActionButtonProps) => ReactNode;
  readonly ScopeChip: (props: ScopeChipProps) => ReactNode;
  readonly StatusPill: (props: StatusPillProps) => ReactNode;
  readonly MessageBubble: (props: MessageBubbleProps) => ReactNode;
}

export function CockpitMainConversation({
  t,
  mode,
  busy,
  error,
  input,
  scopeChips,
  hasPendingChanges,
  statusPills,
  status,
  activeMessages,
  quickStartPanel,
  composerInputId,
  composerHintId,
  composerHint,
  canUseBinder,
  canUseDraft,
  hasPendingProposalChanges,
  queuedComposerEntries,
  onInputChange,
  onQueueComposerInput,
  onRestoreQueuedComposerInput,
  onSubmit,
  onApplyAll,
  classes,
  ActionButton,
  ScopeChip,
  StatusPill,
  MessageBubble,
}: CockpitMainConversationProps) {
  const statusIsErrorFirst = status.latestEventIsError;
  const queuePreviewEntries = summarizeQueuedComposerEntries(queuedComposerEntries);

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const shortcut = getComposerQueueShortcut({
      busy,
      input,
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });
    if (shortcut === "queue") {
      event.preventDefault();
      onQueueComposerInput();
      return;
    }
    if (shortcut === "restore") {
      event.preventDefault();
      onRestoreQueuedComposerInput();
      return;
    }
    if (busy) {
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void onSubmit();
    }
  };

  return (
    <div className="studio-cockpit-main studio-cockpit-panel rounded-[1.9rem] p-4 md:p-5">
      <div className="mb-4 space-y-4 border-b border-border/50 pb-4">
        <div className="studio-cockpit-briefing">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("cockpit.scope")}
            </div>
            <div className="mt-2 text-[clamp(1.35rem,2.2vw,1.8rem)] font-semibold text-foreground">
              {scopeChips[0]?.value}
            </div>
            <div className="mt-1 text-sm leading-6 text-muted-foreground">
              {scopeChips[1]?.value}
            </div>
          </div>

          <div className="studio-cockpit-briefing-note">
            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              {status.latestEvent ? t("cockpit.statusLatestEvent") : t("cockpit.pendingChanges")}
            </div>
            <div className="mt-2 text-sm leading-6 text-foreground/84">
              {status.latestEvent || (hasPendingChanges ? t("cockpit.applyAll") : composerHint)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {scopeChips.map((chip) => (
            <ScopeChip key={`${chip.label}:${chip.value}`} label={chip.label} value={chip.value} accent={chip.accent} />
          ))}
        </div>
      </div>

      <div className="flex min-h-[clamp(22rem,50vh,30rem)] flex-col">
        <div
          className="studio-cockpit-log min-h-[clamp(12rem,28vh,18rem)] flex-1 space-y-3 overflow-y-auto pr-1"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {activeMessages.length === 0 ? (
            quickStartPanel ? (
              <div className="studio-cockpit-empty-state">
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full studio-badge-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {quickStartPanel.badge}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-lg font-semibold text-foreground">{quickStartPanel.title}</div>
                    <span className="rounded-full studio-badge-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
                      {quickStartPanel.status}
                    </span>
                  </div>
                  <div className="text-sm leading-7 text-foreground/82">
                    {quickStartPanel.description}
                  </div>
                </div>

                <div className="studio-cockpit-empty-state-note text-sm leading-7 text-foreground/80">
                  {quickStartPanel.note}
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {quickStartPanel.missingInfoLabel}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(quickStartPanel.missingInfo.length > 0 ? quickStartPanel.missingInfo : ["-"]).map((item) => (
                      <span key={`quick-start-${item}`} className="rounded-full border border-border/40 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {quickStartPanel.actions.map((action, index) => (
                    <Fragment key={`quick-start-action-${index}`}>{action}</Fragment>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-[1.35rem] border border-dashed border-border/60 bg-background/55 px-5 py-7 text-center text-sm leading-7 text-muted-foreground">
                {t("cockpit.messagesEmpty")}
              </div>
            )
          ) : (
            activeMessages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))
          )}
        </div>

        <div className="mt-5 border-t border-border/50 pt-4">
          {error ? (
            <div className={`mb-3 rounded-xl border px-4 py-3 text-sm ${classes.error}`}>
              {error}
            </div>
          ) : null}
          {!error && statusIsErrorFirst ? (
            <div className={`mb-3 rounded-xl border px-4 py-3 text-sm ${classes.error}`}>
              {status.latestEvent}
            </div>
          ) : null}

          <CockpitLiveStatusStrip
            t={t}
            status={status}
            statusPills={statusPills}
            StatusPill={StatusPill}
          />

          <div className="studio-cockpit-composer rounded-[1.35rem] border border-border/50 bg-background/55 p-3">
            <label
              htmlFor={composerInputId}
              className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              {t("cockpit.composerLabel")}
            </label>
            <textarea
              id={composerInputId}
              disabled={busy}
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              aria-describedby={composerHintId}
              placeholder={t("common.enterCommand")}
              className={`min-h-[112px] w-full rounded-[1.15rem] border-0 bg-transparent px-3 py-3 text-sm leading-7 outline-none ${classes.input}`}
            />
            <div className="mt-3 space-y-2">
              <div className="studio-cockpit-queue-meta text-[11px] leading-5 text-muted-foreground">
                {t("cockpit.queueShortcutHint")}
              </div>
              {queuePreviewEntries.length ? (
                <div className="studio-cockpit-queue">
                  <div className="studio-cockpit-queue-header">
                    <span>{t("cockpit.queueNextTurns")}</span>
                    <span className="rounded-full studio-badge-soft px-2 py-0.5 text-[10px] font-semibold">
                      {queuedComposerEntries.length}
                    </span>
                  </div>
                  <div className="studio-cockpit-queue-list">
                    {queuePreviewEntries.map((entry) => (
                      <div key={entry.id} className="studio-cockpit-queue-item">
                        <span className="studio-cockpit-queue-item-action">
                          {entry.action}
                        </span>
                        <span className="truncate">
                          {entry.text || `/${entry.action}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div id={composerHintId} className="studio-cockpit-mode-hint text-xs leading-6 text-muted-foreground">
                {composerHint}
              </div>
              <div className="flex flex-wrap gap-2">
                {mode === "binder" ? (
                  <>
                    <ActionButton
                      disabled={busy || !canUseBinder}
                      className={classes.btnPrimary}
                      icon={<Lightbulb size={14} />}
                      label={t("cockpit.ask")}
                      onClick={() => void onSubmit("ask")}
                    />
                    <ActionButton
                      disabled={busy || !canUseBinder}
                      className={classes.btnSecondary}
                      icon={<Wand2 size={14} />}
                      label={t("cockpit.propose")}
                      onClick={() => void onSubmit("propose")}
                    />
                    {hasPendingProposalChanges ? (
                      <ActionButton
                        disabled={busy}
                        className={classes.btnSecondary}
                        icon={<Check size={14} />}
                        label={t("cockpit.applyAll")}
                        onClick={() => onApplyAll()}
                      />
                    ) : null}
                  </>
                ) : mode === "draft" ? (
                  <>
                    <ActionButton
                      disabled={busy || !canUseDraft}
                      className={classes.btnPrimary}
                      icon={<PenSquare size={14} />}
                      label={t("cockpit.generateDraft")}
                      onClick={() => void onSubmit("draft")}
                    />
                    <ActionButton
                      disabled={busy || !canUseDraft}
                      className={classes.btnSecondary}
                      icon={<Sparkles size={14} />}
                      label={t("cockpit.writeNext")}
                      onClick={() => void onSubmit("write-next")}
                    />
                  </>
                ) : (
                  <ActionButton
                    disabled={busy}
                    className={classes.btnPrimary}
                    icon={<Bot size={14} />}
                    label={t("cockpit.discuss")}
                    onClick={() => void onSubmit("discuss")}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function getComposerQueueShortcut(input: {
  readonly busy: boolean;
  readonly input: string;
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): "queue" | "restore" | null {
  if (input.busy) {
    return null;
  }

  if (
    input.key === "Enter"
    && input.input.trim()
    && !input.altKey
    && !input.ctrlKey
    && !input.metaKey
    && !input.shiftKey
  ) {
    return "queue";
  }

  if (input.key === "Tab" && input.input.trim()) {
    return "queue";
  }

  if (input.key === "ArrowLeft" && (input.shiftKey || input.altKey)) {
    return "restore";
  }

  return null;
}

export function summarizeQueuedComposerEntries(entries: ReadonlyArray<QueuedComposerEntry>): ReadonlyArray<QueuedComposerEntry> {
  return [...entries].slice(-3).reverse();
}
