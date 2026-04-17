import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TFunction } from "../../hooks/use-i18n";
import type { CockpitStatusStrip } from "../cockpit-status-strip";
import { CockpitLiveStatusStrip } from "./CockpitLiveStatusStrip";

const t = ((key: string) => {
  if (key === "cockpit.stage.creating") return "Creating";
  if (key === "cockpit.stage.working") return "Working";
  if (key === "cockpit.statusLatestEvent") return "Latest Event";
  return key;
}) as TFunction;

const StatusPill = ({ label, value }: { readonly label?: string; readonly value: string }) =>
  React.createElement("span", { "data-pill": `${label ?? "none"}:${value}` }, value);

const createStatus = (status: Omit<CockpitStatusStrip, "providerLabel" | "modelLabel">) =>
  ({
    providerLabel: "codex",
    modelLabel: "gpt-5.4",
    ...status,
  }) as CockpitStatusStrip;

describe("CockpitLiveStatusStrip", () => {
  it("renders a compact live strip with determinate progress", () => {
    const html = renderToStaticMarkup(
      React.createElement(CockpitLiveStatusStrip, {
        t,
        statusPills: [{ label: "Stage", value: "Creating", accent: true }],
        status: createStatus({
          reasoningLabel: "xhigh",
          stage: "creating",
          targetLabel: "Book",
          latestEvent: "book:create:progress · foundation.md",
          latestEventIsError: false,
          isLive: true,
          liveStage: "creating",
          liveDetail: "foundation.md",
          progressMode: "determinate",
          progressValue: 85,
        }),
        StatusPill,
      }),
    );

    expect(html).toContain("LIVE");
    expect(html).toContain("Creating");
    expect(html).toContain('data-progress-mode="determinate"');
    expect(html).toContain("--cockpit-live-progress:85%");
  });

  it("renders indeterminate progress for generic work", () => {
    const html = renderToStaticMarkup(
      React.createElement(CockpitLiveStatusStrip, {
        t,
        statusPills: [],
        status: createStatus({
          reasoningLabel: null,
          stage: "working",
          targetLabel: "Book",
          latestEvent: "draft:start · chapter 12",
          latestEventIsError: false,
          isLive: true,
          liveStage: "working",
          liveDetail: "draft:start · chapter 12",
          progressMode: "indeterminate",
          progressValue: null,
        }),
        StatusPill,
      }),
    );

    expect(html).toContain('data-progress-mode="indeterminate"');
    expect(html).toContain("Working");
  });

  it("suppresses live styling when the latest event is an error", () => {
    const html = renderToStaticMarkup(
      React.createElement(CockpitLiveStatusStrip, {
        t,
        statusPills: [],
        status: createStatus({
          reasoningLabel: null,
          stage: "working",
          targetLabel: "Book",
          latestEvent: "draft:error · agent crashed",
          latestEventIsError: true,
          isLive: true,
          liveStage: "working",
          liveDetail: "draft:error · agent crashed",
          progressMode: "indeterminate",
          progressValue: null,
        }),
        StatusPill,
      }),
    );

    expect(html).not.toContain(">LIVE<");
    expect(html).toContain("draft:error · agent crashed");
  });
});
