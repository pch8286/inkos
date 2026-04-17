import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TFunction } from "../../hooks/use-i18n";
import type { CockpitStatusStrip } from "../cockpit-status-strip";
import {
  CockpitMainConversation,
  getComposerQueueShortcut,
  summarizeQueuedComposerEntries,
} from "./CockpitMainConversation";

const t = ((key: string) => {
  if (key === "cockpit.statusLatestEvent") return "Latest Event";
  if (key === "cockpit.statusStage") return "Stage";
  if (key === "cockpit.pendingChanges") return "Pending Changes";
  return key;
}) as TFunction;

const BaseStatusChip = ({ label, value }: { readonly label?: string; readonly value: string }) =>
  React.createElement("span", { "data-chip": `${label ?? "none"}:${value}` }, `${label ?? "none"}:${value}`);

const ScopeChip = ({ label, value }: { readonly label: string; readonly value: string }) =>
  React.createElement("span", { "data-chip": `${label}:${value}` }, `${label}:${value}`);

const ActionButton = ({ label }: { readonly label: string }) =>
  React.createElement("button", { type: "button" }, label);

const MessageBubble = () => React.createElement("div");

const buildStatusStrip = (status: Partial<CockpitStatusStrip>): CockpitStatusStrip => ({
  providerLabel: "codex-cli",
  modelLabel: "gpt-5.4",
  reasoningLabel: null,
  stage: "working",
  targetLabel: "Book",
  latestEvent: null,
  latestEventIsError: false,
  isLive: false,
  liveStage: null,
  liveDetail: null,
  progressMode: "none",
  progressValue: null,
  ...status,
});

describe("getComposerQueueShortcut", () => {
  it("queues the composer value on plain Enter", () => {
    expect(getComposerQueueShortcut({
      busy: false,
      input: "next request",
      key: "Enter",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toBe("queue");
  });

  it("uses Tab as a queue shortcut only when the composer has text", () => {
    expect(getComposerQueueShortcut({
      busy: false,
      input: "queued",
      key: "Tab",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toBe("queue");

    expect(getComposerQueueShortcut({
      busy: false,
      input: "   ",
      key: "Tab",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toBeNull();
  });

  it("restores the latest queued item on Shift+ArrowLeft and Alt+ArrowLeft", () => {
    expect(getComposerQueueShortcut({
      busy: false,
      input: "",
      key: "ArrowLeft",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
    })).toBe("restore");

    expect(getComposerQueueShortcut({
      busy: false,
      input: "",
      key: "ArrowLeft",
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toBe("restore");
  });
});

describe("summarizeQueuedComposerEntries", () => {
  it("shows the latest queued items first and trims to three", () => {
    expect(summarizeQueuedComposerEntries([
      { id: "q1", action: "discuss", text: "one", createdAt: 1 },
      { id: "q2", action: "ask", text: "two", createdAt: 2 },
      { id: "q3", action: "draft", text: "three", createdAt: 3 },
      { id: "q4", action: "write-next", text: "four", createdAt: 4 },
    ])).toEqual([
      { id: "q4", action: "write-next", text: "four", createdAt: 4 },
      { id: "q3", action: "draft", text: "three", createdAt: 3 },
      { id: "q2", action: "ask", text: "two", createdAt: 2 },
    ]);
  });
});

describe("CockpitMainConversation", () => {
  it("renders a live status strip with determinate progress in the conversation path", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CockpitMainConversation, {
        t,
        mode: "discuss",
        busy: false,
        error: null,
        input: "",
        scopeChips: [
          { label: "Scope", value: "Discuss" },
          { label: "Target", value: "Novel" },
        ],
        hasPendingChanges: false,
        statusPills: [{ label: "Stage", value: "Creating", accent: true }],
        status: buildStatusStrip({
          stage: "creating",
          latestEvent: "book:create:progress · foundation.md",
          latestEventIsError: false,
          isLive: true,
          liveStage: "creating",
          liveDetail: "foundation.md",
          progressMode: "determinate",
          progressValue: 85,
        }),
        activeMessages: [],
        quickStartPanel: null,
        composerInputId: "composer",
        composerHintId: "composer-hint",
        composerHint: "Try writing a prompt",
        canUseBinder: false,
        canUseDraft: false,
        hasPendingProposalChanges: false,
        queuedComposerEntries: [],
        onInputChange: () => undefined,
        onQueueComposerInput: () => undefined,
        onRestoreQueuedComposerInput: () => undefined,
        onSubmit: () => undefined,
        onApplyAll: () => undefined,
        classes: { btnPrimary: "", btnSecondary: "", input: "", error: "" },
        ActionButton,
        ScopeChip,
        StatusPill: BaseStatusChip,
        MessageBubble,
      }),
    );

    expect(markup).toContain('class="studio-cockpit-status-strip studio-cockpit-live-status-strip mb-3"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain(">LIVE<");
    expect(markup).toContain("foundation.md");
    expect(markup).toContain('data-progress-mode="determinate"');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="85"');
    expect(markup).toContain('aria-valuemin="0"');
    expect(markup).toContain('aria-valuemax="100"');
  });

  it("falls back to latest error event without LIVE when latest event is an error", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CockpitMainConversation, {
        t,
        mode: "discuss",
        busy: false,
        error: null,
        input: "",
        scopeChips: [
          { label: "Scope", value: "Discuss" },
          { label: "Target", value: "Novel" },
        ],
        hasPendingChanges: false,
        statusPills: [{ label: "Stage", value: "Working" }],
        status: buildStatusStrip({
          stage: "working",
          latestEvent: "draft:error · unable to continue",
          latestEventIsError: true,
          isLive: true,
          liveStage: "working",
          liveDetail: "draft:error · unable to continue",
          progressMode: "indeterminate",
          progressValue: null,
        }),
        activeMessages: [],
        quickStartPanel: null,
        composerInputId: "composer",
        composerHintId: "composer-hint",
        composerHint: "Try writing a prompt",
        canUseBinder: false,
        canUseDraft: false,
        hasPendingProposalChanges: false,
        queuedComposerEntries: [],
        onInputChange: () => undefined,
        onQueueComposerInput: () => undefined,
        onRestoreQueuedComposerInput: () => undefined,
        onSubmit: () => undefined,
        onApplyAll: () => undefined,
        classes: { btnPrimary: "", btnSecondary: "", input: "", error: "" },
        ActionButton,
        ScopeChip,
        StatusPill: BaseStatusChip,
        MessageBubble,
      }),
    );

    expect(markup).toContain('class="studio-cockpit-status-strip studio-cockpit-live-status-strip mb-3"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain(">LIVE<");
    expect(markup).toContain("Latest Event");
    expect(markup).toContain("draft:error · unable to continue");
    expect(markup).not.toContain("studio-cockpit-live-status-row");
  });

  it("keeps the live strip when a non-error update mentions error as plain text", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CockpitMainConversation, {
        t,
        mode: "discuss",
        busy: false,
        error: null,
        input: "",
        scopeChips: [
          { label: "Scope", value: "Discuss" },
          { label: "Target", value: "Novel" },
        ],
        hasPendingChanges: false,
        statusPills: [{ label: "Stage", value: "Working" }],
        status: buildStatusStrip({
          stage: "working",
          latestEvent: "draft:log · retrying after previous error",
          latestEventIsError: false,
          isLive: true,
          liveStage: "working",
          liveDetail: "draft:log · retrying after previous error",
          progressMode: "indeterminate",
          progressValue: null,
        }),
        activeMessages: [],
        quickStartPanel: null,
        composerInputId: "composer",
        composerHintId: "composer-hint",
        composerHint: "Try writing a prompt",
        canUseBinder: false,
        canUseDraft: false,
        hasPendingProposalChanges: false,
        queuedComposerEntries: [],
        onInputChange: () => undefined,
        onQueueComposerInput: () => undefined,
        onRestoreQueuedComposerInput: () => undefined,
        onSubmit: () => undefined,
        onApplyAll: () => undefined,
        classes: { btnPrimary: "", btnSecondary: "", input: "", error: "" },
        ActionButton,
        ScopeChip,
        StatusPill: BaseStatusChip,
        MessageBubble,
      }),
    );

    expect(markup).toContain(">LIVE<");
    expect(markup).toContain("draft:log · retrying after previous error");
  });

  it("keeps the standard latest event strip for non-live updates", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CockpitMainConversation, {
        t,
        mode: "discuss",
        busy: false,
        error: null,
        input: "",
        scopeChips: [
          { label: "Scope", value: "Discuss" },
          { label: "Target", value: "Novel" },
        ],
        hasPendingChanges: false,
        statusPills: [{ label: "Stage", value: "Ready" }],
        status: buildStatusStrip({
          stage: "ready",
          latestEvent: "draft:done · chapter 12",
          latestEventIsError: false,
          isLive: false,
          liveStage: null,
          liveDetail: null,
          progressMode: "none",
          progressValue: null,
        }),
        activeMessages: [],
        quickStartPanel: null,
        composerInputId: "composer",
        composerHintId: "composer-hint",
        composerHint: "Try writing a prompt",
        canUseBinder: false,
        canUseDraft: false,
        hasPendingProposalChanges: false,
        queuedComposerEntries: [],
        onInputChange: () => undefined,
        onQueueComposerInput: () => undefined,
        onRestoreQueuedComposerInput: () => undefined,
        onSubmit: () => undefined,
        onApplyAll: () => undefined,
        classes: { btnPrimary: "", btnSecondary: "", input: "", error: "" },
        ActionButton,
        ScopeChip,
        StatusPill: BaseStatusChip,
        MessageBubble,
      }),
    );

    expect(markup).toContain("Latest Event");
    expect(markup).toContain("draft:done · chapter 12");
    expect(markup).not.toContain(">LIVE<");
  });
});
