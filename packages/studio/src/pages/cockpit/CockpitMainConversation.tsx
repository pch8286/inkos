import type { KeyboardEvent } from "react";
import type { TFunction } from "../../hooks/use-i18n";
import type { ReactNode } from "react";
import type { CockpitMode } from "../cockpit-ui-state";
import type { ComposerAction, } from "../cockpit-parsing";
import type { CockpitMessage } from "../cockpit-shared";
import {
  ArrowRight,
  Bot,
  Check,
  Lightbulb,
  PenSquare,
  Sparkles,
  Wand2,
} from "lucide-react";

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
  readonly statusLatestEvent: string | null;
  readonly activeMessages: ReadonlyArray<CockpitMessage>;
  readonly composerInputId: string;
  readonly composerHintId: string;
  readonly composerHint: string;
  readonly canUseBinder: boolean;
  readonly canUseDraft: boolean;
  readonly hasPendingProposalChanges: boolean;
  readonly onInputChange: (value: string) => void;
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
  statusLatestEvent,
  activeMessages,
  composerInputId,
  composerHintId,
  composerHint,
  canUseBinder,
  canUseDraft,
  hasPendingProposalChanges,
  onInputChange,
  onSubmit,
  onApplyAll,
  classes,
  ActionButton,
  ScopeChip,
  StatusPill,
  MessageBubble,
}: CockpitMainConversationProps) {
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void onSubmit();
    }
  };

  return (
    <div className="studio-cockpit-main rounded-[1.9rem] border border-border/50 bg-card/70 p-4 md:p-5">
      <div className="mb-4 space-y-4 border-b border-border/50 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("cockpit.scope")}
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground">
              {scopeChips[0]?.value}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {scopeChips[1]?.value}
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
          className="min-h-[clamp(12rem,28vh,18rem)] flex-1 space-y-3 overflow-y-auto pr-1"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {activeMessages.length === 0 ? (
            <div className="rounded-[1.35rem] border border-dashed border-border/60 bg-background/55 px-5 py-7 text-center text-sm leading-7 text-muted-foreground">
              {t("cockpit.messagesEmpty")}
            </div>
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

          <div className="studio-cockpit-status-strip mb-3" role="status" aria-live="polite">
            <div className="studio-cockpit-status-pills">
              {statusPills.map((pill) => (
                <StatusPill key={`${pill.label}-${pill.value}`} label={pill.label} value={pill.value} accent={pill.accent} />
              ))}
            </div>
            {statusLatestEvent ? (
              <div className="studio-cockpit-status-event">
                <span className="studio-cockpit-status-event-label">{t("cockpit.statusLatestEvent")}</span>
                <span className="truncate">{statusLatestEvent}</span>
              </div>
            ) : null}
          </div>

          <div className="rounded-[1.35rem] border border-border/50 bg-background/55 p-3">
            <label
              htmlFor={composerInputId}
              className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              {t("cockpit.composerLabel")}
            </label>
            <textarea
              id={composerInputId}
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              aria-describedby={composerHintId}
              placeholder={t("common.enterCommand")}
              className={`min-h-[112px] w-full rounded-[1.15rem] border-0 bg-transparent px-3 py-3 text-sm leading-7 outline-none ${classes.input}`}
            />

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
