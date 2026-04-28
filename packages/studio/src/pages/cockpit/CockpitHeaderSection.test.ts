import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TFunction } from "../../hooks/use-i18n";
import { CockpitHeaderSection } from "./CockpitHeaderSection";

const t = ((key: string) => {
  const labels: Record<string, string> = {
    "nav.cockpit": "Cockpit",
    "nav.studio": "Studio",
    "cockpit.title": "InkOS Cockpit",
    "cockpit.subtitle": "Conversation-first writing console",
    "cockpit.scope": "Scope",
    "cockpit.statusStage": "Stage",
    "cockpit.statusTarget": "Target",
    "cockpit.selectBook": "Books",
    "cockpit.currentContext": "Context",
    "cockpit.openBook": "Open Book",
    "cockpit.openBinder": "Open Binder",
    "cockpit.runDraftAction": "Run Draft",
    "cockpit.searchPlaceholder": "Search cockpit",
    "common.refresh": "Refresh",
    "common.loading": "Loading",
    "dash.createFailed": "Create Failed",
    "dash.createRunning": "Creating",
    "create.creatingHint": "Creating book",
  };
  return labels[key] ?? key;
}) as TFunction;

const baseProps = {
  t,
  nav: {
    toDashboard: () => undefined,
    toBook: () => undefined,
    toTruth: () => undefined,
  },
  booksLoading: false,
  booksError: null,
  createJobs: [],
  bookCount: 3,
  selectedBookLabel: "달빛 아래, 이야기꾼",
  modeLabel: "Draft",
  statusStageLabel: "Working",
  statusTargetLabel: "Chapter 12",
  statusModelLabel: "OpenRouter / claude-3.5-sonnet",
  selectedBookId: "book-1",
  runLabel: "Run Draft",
  onRun: () => undefined,
  onRefresh: () => undefined,
  searchQuery: "",
  onSearchQueryChange: () => undefined,
  classes: { btnPrimary: "primary", btnSecondary: "secondary", error: "error" },
};

describe("CockpitHeaderSection", () => {
  it("renders the compact technical-console header without hero media", () => {
    const html = renderToStaticMarkup(React.createElement(CockpitHeaderSection, baseProps));

    expect(html).toContain("studio-cockpit-console-header");
    expect(html).toContain("studio-cockpit-console-title");
    expect(html).toContain("studio-cockpit-console-status-grid");
    expect(html).toContain("InkOS Cockpit");
    expect(html).toContain("OpenRouter / claude-3.5-sonnet");
    expect(html).toContain("달빛 아래, 이야기꾼");
    expect(html).not.toContain("studio-cockpit-hero-media");
    expect(html).not.toContain("cockpit-hero-v1");
  });

  it("renders top console chips as clickable controls", () => {
    const html = renderToStaticMarkup(React.createElement(CockpitHeaderSection, {
      ...baseProps,
      onFocusWorkspace: () => undefined,
    }));

    expect(html).toContain('type="button" class="studio-cockpit-select-chip"');
    expect(html).toContain('aria-label="Workspace: 달빛 아래, 이야기꾼"');
    expect(html).toContain('aria-label="Refresh environment data: Production"');
    expect(html).toContain('class="studio-cockpit-search"');
    expect(html).not.toContain("lucide-chevron-down");
  });

  it("renders Search as an actual cockpit search field", () => {
    const html = renderToStaticMarkup(React.createElement(CockpitHeaderSection, {
      ...baseProps,
      searchQuery: "moon",
      onSearchQueryChange: () => undefined,
    }));

    expect(html).toContain('role="search"');
    expect(html).toContain('aria-label="Search"');
    expect(html).toContain('value="moon"');
    expect(html).toContain('placeholder="Search cockpit"');
  });

  it("renders a Studio return action from the standalone cockpit shell", () => {
    const html = renderToStaticMarkup(React.createElement(CockpitHeaderSection, baseProps));

    expect(html).toContain("Studio");
    expect(html).toContain('aria-label="Studio"');
  });

  it("labels the commandline run button with the current executable action", () => {
    const html = renderToStaticMarkup(React.createElement(CockpitHeaderSection, baseProps));

    expect(html).toContain("Run Draft");
    expect(html).not.toContain(">Run</button>");
  });

  it("can disable the commandline run button when the current action is blocked", () => {
    const html = renderToStaticMarkup(React.createElement(CockpitHeaderSection, {
      ...baseProps,
      runDisabled: true,
    }));

    expect(html).toContain('disabled="" class="studio-cockpit-launch-button primary"');
  });

  it("keeps loading, error, and create job notices as compact console events", () => {
    const html = renderToStaticMarkup(React.createElement(CockpitHeaderSection, {
      ...baseProps,
      booksLoading: true,
      booksError: "Failed to load books",
      createJobs: [{
        bookId: "new-book",
        title: "New Console Book",
        status: "creating",
        stage: "foundation",
        message: "Writing foundation",
      }],
    }));

    expect(html).toContain("studio-cockpit-console-events");
    expect(html).toContain("Loading");
    expect(html).toContain("Failed to load books");
    expect(html).toContain("New Console Book");
    expect(html).toContain("foundation");
  });
});
