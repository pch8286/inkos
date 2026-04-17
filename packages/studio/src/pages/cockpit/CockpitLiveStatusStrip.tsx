import React from "react";
import type { ReactNode } from "react";
import type { TFunction } from "../../hooks/use-i18n";
import type { CockpitStatusStrip } from "../cockpit-status-strip";

interface StatusPillProps {
  readonly label?: string;
  readonly value: string;
  readonly accent?: boolean;
}

interface CockpitLiveStatusStripProps {
  readonly t: TFunction;
  readonly status: CockpitStatusStrip;
  readonly statusPills: ReadonlyArray<StatusPillProps>;
  readonly StatusPill: (props: StatusPillProps) => ReactNode;
}

export function CockpitLiveStatusStrip({
  t,
  status,
  statusPills,
  StatusPill,
}: CockpitLiveStatusStripProps) {
  const isLive = status.isLive && !status.latestEventIsError;
  const hasProgress = status.progressMode !== "none";
  const progressStyle = status.progressMode === "determinate" && status.progressValue !== null
    ? ({ "--cockpit-live-progress": `${status.progressValue}%` } as React.CSSProperties)
    : undefined;

  return (
    <div className="studio-cockpit-live-status-strip">
      <div className="studio-cockpit-status-pills">
        {statusPills.map((pill) => (
          <StatusPill key={`${pill.label}-${pill.value}`} label={pill.label} value={pill.value} accent={pill.accent} />
        ))}
      </div>

      {isLive ? (
        <>
          <div className="studio-cockpit-live-status-row">
            <span className="studio-cockpit-live-status-badge">LIVE</span>
            <span className="studio-cockpit-live-status-stage">{t(`cockpit.stage.${status.liveStage}`)}</span>
            {status.liveDetail ? <span className="studio-cockpit-live-status-detail">{status.liveDetail}</span> : null}
          </div>
          {hasProgress ? (
            <div className="studio-cockpit-live-progress" data-progress-mode={status.progressMode} style={progressStyle} />
          ) : null}
        </>
      ) : status.latestEvent ? (
        <div className="studio-cockpit-status-event">
          <span className="studio-cockpit-status-event-label">{t("cockpit.statusLatestEvent")}</span>
          <span className="truncate">{status.latestEvent}</span>
        </div>
      ) : null}
    </div>
  );
}
