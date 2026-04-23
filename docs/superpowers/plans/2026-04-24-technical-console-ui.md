# Technical Console UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert InkOS Cockpit and Studio chrome to the approved technical-console direction.

**Architecture:** Keep Cockpit's existing orchestration and hooks intact. Refine the presentational component split already in place, replacing the hero-style header with an operational console header and moving visual behavior into reusable CSS classes/tokens. Use focused SSR-style component tests to pin markup and accessibility contracts before changing presentation.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Tailwind CSS v4, existing `useColors`, existing Cockpit components, lucide-react.

---

## File Structure

- Modify: `packages/studio/src/pages/cockpit/CockpitHeaderSection.tsx`
  - Responsibility: render the compact top console header/status strip for Cockpit.
- Modify: `packages/studio/src/pages/cockpit/CockpitMainConversation.tsx`
  - Responsibility: render the central work log and command composer with console semantics and slash-command chips.
- Modify: `packages/studio/src/pages/Cockpit.tsx`
  - Responsibility: keep orchestration, update only small presentational helpers such as `MessageBubble`, `ScopeChip`, `StatusPill`, `ActionButton`, and header props if needed.
- Modify: `packages/studio/src/components/Sidebar.tsx`
  - Responsibility: align Studio navigation chrome with the console palette while preserving navigation behavior.
- Modify: `packages/studio/src/hooks/use-colors.ts`
  - Responsibility: map existing semantic class names to technical-console button/input treatments.
- Modify: `packages/studio/src/index.css`
  - Responsibility: global palette, shared `studio-*` utility classes, Cockpit shell layout, responsive behavior, and message/composer styling.
- Test: `packages/studio/src/pages/cockpit/CockpitHeaderSection.test.tsx`
  - Responsibility: pin the new top console header and verify it no longer emits hero media markup.
- Test: `packages/studio/src/pages/cockpit/CockpitMainConversation.test.ts`
  - Responsibility: extend existing tests for command composer slash chips, `role="log"`, and stable live strip behavior.
- Test: `packages/studio/src/pages/Cockpit.test.ts`
  - Responsibility: add or preserve high-level Cockpit smoke coverage only if markup changes affect existing assumptions.

## Dirty Worktree Guard

The current workspace already contains uncommitted user changes in Cockpit and related files. Before each task:

```bash
git status --short
```

Expected: existing unrelated user changes may remain. Do not revert them. Only stage files touched by the current task.

---

### Task 1: Pin The Technical Console Header Contract

**Files:**
- Create: `packages/studio/src/pages/cockpit/CockpitHeaderSection.test.tsx`
- Modify later: `packages/studio/src/pages/cockpit/CockpitHeaderSection.tsx`

- [ ] **Step 1: Write the failing header test**

Create `packages/studio/src/pages/cockpit/CockpitHeaderSection.test.tsx` with:

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TFunction } from "../../hooks/use-i18n";
import { CockpitHeaderSection } from "./CockpitHeaderSection";

const t = ((key: string) => {
  const labels: Record<string, string> = {
    "nav.cockpit": "Cockpit",
    "cockpit.title": "InkOS Cockpit",
    "cockpit.subtitle": "Conversation-first writing console",
    "cockpit.scope": "Scope",
    "cockpit.statusStage": "Stage",
    "cockpit.statusTarget": "Target",
    "cockpit.selectBook": "Books",
    "cockpit.currentContext": "Context",
    "cockpit.openBook": "Open Book",
    "cockpit.openBinder": "Open Binder",
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
  onRefresh: () => undefined,
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
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- src/pages/cockpit/CockpitHeaderSection.test.tsx
```

Expected: FAIL because `studio-cockpit-console-header`, `studio-cockpit-console-title`, and `studio-cockpit-console-status-grid` are not rendered yet.

- [ ] **Step 3: Commit only the failing test if your workflow requires red commits**

Default for this repo is to keep commits passing. Do not commit this red state unless explicitly requested.

---

### Task 2: Replace Cockpit Hero With Console Header

**Files:**
- Modify: `packages/studio/src/pages/cockpit/CockpitHeaderSection.tsx`
- Modify: `packages/studio/src/index.css`
- Test: `packages/studio/src/pages/cockpit/CockpitHeaderSection.test.tsx`

- [ ] **Step 1: Remove the hero image import and render a console header**

In `packages/studio/src/pages/cockpit/CockpitHeaderSection.tsx`, remove:

```tsx
const heroImageUrl = new URL("../../assets/cockpit-hero-v1.png", import.meta.url).href;
```

Replace the `return (` block with:

```tsx
  return (
    <section className="studio-cockpit-console-header">
      <div className="studio-cockpit-console-titlebar">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 studio-console-eyebrow">
            <MessageSquareText size={14} />
            {t("nav.cockpit")}
          </div>
          <h1 className="studio-cockpit-console-title">
            {t("cockpit.title")}
          </h1>
          <p className="studio-cockpit-console-subtitle">
            {t("cockpit.subtitle")}
          </p>
        </div>

        <div className="studio-cockpit-console-context" aria-label={t("cockpit.currentContext")}>
          <span>{t("cockpit.currentContext")}</span>
          <strong>{selectedBookLabel}</strong>
          <em>{statusModelLabel}</em>
        </div>
      </div>

      <div className="studio-cockpit-console-status-grid">
        <div className="studio-cockpit-console-cell">
          <span>{t("cockpit.scope")}</span>
          <strong>{modeLabel}</strong>
        </div>
        <div className="studio-cockpit-console-cell">
          <span>{t("cockpit.statusStage")}</span>
          <strong>{statusStageLabel}</strong>
        </div>
        <div className="studio-cockpit-console-cell">
          <span>{t("cockpit.statusTarget")}</span>
          <strong>{statusTargetLabel}</strong>
        </div>
        <div className="studio-cockpit-console-cell">
          <span>{t("cockpit.selectBook")}</span>
          <strong>{bookCount}</strong>
        </div>
      </div>

      <div className="studio-cockpit-console-actions">
        <button
          onClick={onRefresh}
          className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${classes.btnSecondary}`}
        >
          <RefreshCcw size={14} />
          {t("common.refresh")}
        </button>
        {selectedBookId ? (
          <>
            <button
              onClick={() => nav.toBook(selectedBookId)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${classes.btnSecondary}`}
            >
              <BookOpen size={14} />
              {t("cockpit.openBook")}
            </button>
            <button
              onClick={() => nav.toTruth(selectedBookId)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${classes.btnPrimary}`}
            >
              <FileText size={14} />
              {t("cockpit.openBinder")}
            </button>
          </>
        ) : null}
      </div>

      {(booksLoading || booksError || createJobs.length > 0) ? (
        <div className="studio-cockpit-console-events" role="status" aria-live="polite">
          {booksLoading ? (
            <div className="studio-console-event">
              <Loader2 size={13} className="animate-spin" />
              {t("common.loading")}
            </div>
          ) : null}
          {booksError ? (
            <div className={`studio-console-event ${classes.error}`}>
              {booksError}
            </div>
          ) : null}
          {createJobs.map((job) => (
            <div key={job.bookId} className="studio-console-event">
              <span className={job.status === "error" ? "studio-badge-warn" : "studio-badge-ok"}>
                {job.status === "error" ? t("dash.createFailed") : t("dash.createRunning")}
              </span>
              <strong>{job.title}</strong>
              <span>{(job.error || job.stage || job.message || t("create.creatingHint")).split("\n")[0]}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
```

- [ ] **Step 2: Add console header CSS**

In `packages/studio/src/index.css`, add these rules near the Cockpit layout utilities and keep the old `.studio-cockpit-hero*` rules temporarily until no references remain:

```css
.studio-cockpit-console-header {
  display: grid;
  gap: 0.85rem;
  border: 1px solid color-mix(in oklch, var(--border) 72%, transparent);
  border-radius: 0.8rem;
  background:
    linear-gradient(180deg, color-mix(in oklch, var(--card) 92%, transparent), color-mix(in oklch, var(--background) 84%, transparent));
  box-shadow: 0 18px 42px -34px color-mix(in oklch, var(--foreground) 30%, transparent);
}

.studio-cockpit-console-titlebar {
  display: grid;
  gap: 1rem;
  align-items: start;
  padding: 1rem 1rem 0;
}

.studio-console-eyebrow {
  min-height: 1.5rem;
  border: 1px solid color-mix(in oklch, var(--studio-chip-border) 58%, transparent);
  border-radius: 999px;
  padding: 0.22rem 0.6rem;
  color: var(--studio-state-text);
  font-family: var(--font-mono);
  font-size: 0.67rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.studio-cockpit-console-title {
  margin-top: 0.55rem;
  font-family: var(--font-mono);
  font-size: clamp(1.45rem, 2.2vw, 2rem);
  font-weight: 700;
  line-height: 1.08;
  letter-spacing: 0;
}

.studio-cockpit-console-subtitle {
  margin-top: 0.45rem;
  max-width: 58rem;
  color: color-mix(in oklch, var(--foreground) 72%, var(--muted-foreground));
  font-size: 0.85rem;
  line-height: 1.65;
}

.studio-cockpit-console-context {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
  border: 1px solid color-mix(in oklch, var(--border) 64%, transparent);
  border-radius: 0.65rem;
  background: color-mix(in oklch, var(--background) 74%, transparent);
  padding: 0.75rem 0.85rem;
}

.studio-cockpit-console-context span,
.studio-cockpit-console-cell span {
  color: var(--muted-foreground);
  font-family: var(--font-mono);
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  line-height: 1.35;
  text-transform: uppercase;
}

.studio-cockpit-console-context strong,
.studio-cockpit-console-cell strong {
  min-width: 0;
  overflow: hidden;
  color: var(--foreground);
  font-size: 0.88rem;
  font-weight: 700;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-cockpit-console-context em {
  overflow: hidden;
  color: color-mix(in oklch, var(--foreground) 64%, var(--muted-foreground));
  font-family: var(--font-mono);
  font-size: 0.74rem;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-cockpit-console-status-grid {
  display: grid;
  border-top: 1px solid color-mix(in oklch, var(--border) 62%, transparent);
  border-bottom: 1px solid color-mix(in oklch, var(--border) 62%, transparent);
}

.studio-cockpit-console-cell {
  min-width: 0;
  padding: 0.72rem 1rem;
  border-top: 1px solid color-mix(in oklch, var(--border) 42%, transparent);
}

.studio-cockpit-console-cell:first-child {
  border-top: 0;
}

.studio-cockpit-console-actions,
.studio-cockpit-console-events {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0 1rem 1rem;
}

.studio-console-event {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid color-mix(in oklch, var(--border) 62%, transparent);
  border-radius: 0.6rem;
  background: color-mix(in oklch, var(--background) 72%, transparent);
  padding: 0.45rem 0.65rem;
  color: color-mix(in oklch, var(--foreground) 78%, var(--muted-foreground));
  font-family: var(--font-mono);
  font-size: 0.72rem;
  line-height: 1.45;
}

.studio-console-event strong,
.studio-console-event span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (min-width: 768px) {
  .studio-cockpit-console-titlebar {
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
  }

  .studio-cockpit-console-status-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .studio-cockpit-console-cell {
    border-left: 1px solid color-mix(in oklch, var(--border) 48%, transparent);
    border-top: 0;
  }

  .studio-cockpit-console-cell:first-child {
    border-left: 0;
  }
}
```

- [ ] **Step 3: Run the header test**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- src/pages/cockpit/CockpitHeaderSection.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run a targeted Cockpit smoke test**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- src/pages/Cockpit.test.ts src/CockpitStandaloneApp.test.ts
```

Expected: PASS. If it fails because snapshots or text assumptions changed, update only the assertions that refer to header markup.

- [ ] **Step 5: Commit the header conversion**

```bash
git add packages/studio/src/pages/cockpit/CockpitHeaderSection.tsx \
  packages/studio/src/pages/cockpit/CockpitHeaderSection.test.tsx \
  packages/studio/src/index.css
git commit -m "feat: convert cockpit header to console shell"
```

---

### Task 3: Convert Main Conversation To Work Log And Command Composer

**Files:**
- Modify: `packages/studio/src/pages/cockpit/CockpitMainConversation.tsx`
- Modify: `packages/studio/src/pages/Cockpit.tsx`
- Modify: `packages/studio/src/index.css`
- Test: `packages/studio/src/pages/cockpit/CockpitMainConversation.test.ts`

- [ ] **Step 1: Add failing tests for the command composer and log semantics**

Append this test case to `packages/studio/src/pages/cockpit/CockpitMainConversation.test.ts` inside `describe("CockpitMainConversation", () => { ... })`:

```tsx
  it("renders the console work log and command composer with slash command chips", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CockpitMainConversation, {
        t,
        mode: "draft",
        busy: false,
        error: null,
        input: "",
        scopeChips: [
          { label: "Scope", value: "Draft", accent: true },
          { label: "Target", value: "Chapter 12" },
        ],
        hasPendingChanges: false,
        statusPills: [{ label: "Stage", value: "Working" }],
        status: buildStatusStrip({
          latestEvent: "draft:ready · Chapter 12",
          latestEventIsError: false,
        }),
        activeMessages: [],
        quickStartPanel: null,
        composerInputId: "composer",
        composerHintId: "composer-hint",
        composerHint: "Use /draft or /queue",
        canUseBinder: true,
        canUseDraft: true,
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

    expect(markup).toContain("studio-cockpit-work-log");
    expect(markup).toContain('role="log"');
    expect(markup).toContain("studio-cockpit-command-composer");
    expect(markup).toContain("studio-command-chip");
    expect(markup).toContain("/draft");
    expect(markup).toContain("/propose");
    expect(markup).toContain("/ask");
    expect(markup).toContain("/binder");
    expect(markup).toContain("/queue");
    expect(markup).toContain("/diff");
    expect(markup).toContain("/log");
    expect(markup).toContain("/help");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- src/pages/cockpit/CockpitMainConversation.test.ts
```

Expected: FAIL because `studio-cockpit-work-log`, `studio-cockpit-command-composer`, and command chips are not rendered yet.

- [ ] **Step 3: Add command chip rendering**

In `packages/studio/src/pages/cockpit/CockpitMainConversation.tsx`, add this constant above `export function CockpitMainConversation`:

```tsx
const COMMAND_CHIPS = ["/draft", "/propose", "/ask", "/context", "/binder", "/queue", "/diff", "/log", "/help"] as const;
```

Replace the current log container class:

```tsx
className="studio-cockpit-log min-h-[clamp(12rem,28vh,18rem)] flex-1 space-y-3 overflow-y-auto pr-1"
```

with:

```tsx
className="studio-cockpit-log studio-cockpit-work-log min-h-[clamp(12rem,28vh,18rem)] flex-1 space-y-2 overflow-y-auto pr-1"
```

Replace:

```tsx
<div className="studio-cockpit-composer rounded-[1.35rem] border border-border/50 bg-background/55 p-3">
```

with:

```tsx
<div className="studio-cockpit-composer studio-cockpit-command-composer rounded-lg border border-border/60 bg-background/70 p-3">
```

Add this command-chip block immediately after the queue preview block and before the composer action row:

```tsx
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Command shortcuts">
              {COMMAND_CHIPS.map((command) => (
                <span key={command} className="studio-command-chip">
                  {command}
                </span>
              ))}
            </div>
```

- [ ] **Step 4: Flatten message bubbles in `Cockpit.tsx`**

Replace the body of `MessageBubble` in `packages/studio/src/pages/Cockpit.tsx` with:

```tsx
function MessageBubble({ message }: { readonly message: CockpitMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const roleLabel = isUser ? "USER" : isSystem ? "SYSTEM" : "INKOS";

  return (
    <div className={`studio-cockpit-message ${isUser ? "is-user" : isSystem ? "is-system" : "is-assistant"}`}>
      <div className="studio-cockpit-message-meta">
        <span>{roleLabel}</span>
      </div>
      <div className="studio-cockpit-message-body whitespace-pre-wrap break-words">
        {message.content}
      </div>
    </div>
  );
}
```

This intentionally removes the chat-bubble left/right alignment and makes the log read like a console timeline.

- [ ] **Step 5: Add CSS for the work log, command chips, and flat messages**

In `packages/studio/src/index.css`, update or append:

```css
.studio-cockpit-work-log {
  border: 1px solid color-mix(in oklch, var(--border) 58%, transparent);
  border-radius: 0.75rem;
  background: color-mix(in oklch, var(--background) 72%, transparent);
  padding: 0.75rem;
}

.studio-cockpit-command-composer {
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--studio-chip-accent) 18%, transparent),
    0 14px 30px -26px color-mix(in oklch, var(--studio-state-text) 36%, transparent);
}

.studio-command-chip {
  display: inline-flex;
  align-items: center;
  min-height: 1.45rem;
  border: 1px solid color-mix(in oklch, var(--studio-chip-accent) 42%, transparent);
  border-radius: 0.35rem;
  background: color-mix(in oklch, var(--studio-chip-accent) 16%, transparent);
  color: var(--studio-state-text);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 1;
  padding: 0.25rem 0.45rem;
}

.studio-cockpit-message {
  display: grid;
  gap: 0.45rem;
  width: 100%;
  border-radius: 0.55rem;
  border: 1px solid color-mix(in oklch, var(--border) 56%, transparent);
  background: color-mix(in oklch, var(--card) 70%, transparent);
  padding: 0.75rem 0.85rem;
  backdrop-filter: none;
}

.studio-cockpit-message-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--studio-state-text);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.studio-cockpit-message-body {
  color: color-mix(in oklch, var(--foreground) 84%, var(--muted-foreground));
  font-size: 0.85rem;
  line-height: 1.7;
}

.studio-cockpit-message.is-user {
  border-color: color-mix(in oklch, var(--studio-chip-accent) 48%, transparent);
  background: color-mix(in oklch, var(--studio-chip-accent) 12%, var(--card));
  color: var(--foreground);
  box-shadow: none;
}

.studio-cockpit-message.is-assistant {
  background: color-mix(in oklch, var(--card) 78%, transparent);
  color: var(--foreground);
}

.studio-cockpit-message.is-system {
  border-style: dashed;
  background: color-mix(in oklch, var(--background) 78%, transparent);
  color: var(--muted-foreground);
}
```

If duplicate `.studio-cockpit-message*` rules exist earlier, replace them rather than leaving conflicting definitions.

- [ ] **Step 6: Run the targeted conversation tests**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- src/pages/cockpit/CockpitMainConversation.test.ts src/pages/cockpit/CockpitLiveStatusStrip.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the work-log and composer conversion**

```bash
git add packages/studio/src/pages/cockpit/CockpitMainConversation.tsx \
  packages/studio/src/pages/cockpit/CockpitMainConversation.test.ts \
  packages/studio/src/pages/Cockpit.tsx \
  packages/studio/src/index.css
git commit -m "feat: restyle cockpit as command work log"
```

---

### Task 4: Align Studio Tokens And Sidebar Chrome

**Files:**
- Modify: `packages/studio/src/index.css`
- Modify: `packages/studio/src/hooks/use-colors.ts`
- Modify: `packages/studio/src/components/Sidebar.tsx`

- [ ] **Step 1: Update the global light and dark theme tokens**

In `packages/studio/src/index.css`, replace the light-mode `:root` color block values for shared Studio tokens with:

```css
  --background: oklch(0.96 0.006 235);
  --background-radial: linear-gradient(180deg, oklch(0.975 0.004 235), oklch(0.945 0.007 235));
  --foreground: oklch(0.16 0.018 240);
  --card: oklch(0.995 0.002 235);
  --card-foreground: oklch(0.16 0.018 240);
  --popover: oklch(0.995 0.002 235);
  --popover-foreground: oklch(0.16 0.018 240);
  --primary: oklch(0.56 0.11 172);
  --primary-foreground: oklch(0.98 0.004 180);
  --brand: oklch(0.68 0.12 166);
  --brand-foreground: oklch(0.11 0.018 235);
  --secondary: oklch(0.91 0.008 235);
  --secondary-foreground: oklch(0.22 0.018 240);
  --muted: oklch(0.9 0.007 235);
  --muted-foreground: oklch(0.44 0.018 240);
  --accent: oklch(0.9 0.025 170);
  --accent-foreground: oklch(0.2 0.035 170);
  --destructive: oklch(0.54 0.18 25);
  --destructive-foreground: oklch(0.98 0 0);
  --studio-cta-start: oklch(0.67 0.12 164);
  --studio-cta-end: oklch(0.58 0.12 180);
  --studio-cta-text: oklch(0.985 0.004 180);
  --studio-chip: oklch(0.91 0.01 235);
  --studio-chip-border: oklch(0.68 0.025 235);
  --studio-chip-text: oklch(0.28 0.018 240);
  --studio-chip-accent: oklch(0.84 0.055 168);
  --studio-chip-accent-text: oklch(0.19 0.04 170);
  --studio-state-ok: oklch(0.62 0.15 154);
  --studio-state-warn: oklch(0.72 0.15 82);
  --studio-state-text: oklch(0.31 0.08 170);
  --border: oklch(0.78 0.012 235);
  --input: oklch(0.88 0.009 235);
  --ring: oklch(0.56 0.11 172);
```

Replace the `.dark` token values with:

```css
  --background: oklch(0.13 0.012 238);
  --background-radial: linear-gradient(180deg, oklch(0.17 0.015 238), oklch(0.105 0.01 238));
  --foreground: oklch(0.93 0.006 220);
  --card: oklch(0.18 0.014 238);
  --card-foreground: oklch(0.93 0.006 220);
  --popover: oklch(0.18 0.014 238);
  --popover-foreground: oklch(0.93 0.006 220);
  --primary: oklch(0.72 0.15 163);
  --primary-foreground: oklch(0.1 0.012 238);
  --brand: oklch(0.68 0.15 166);
  --brand-foreground: oklch(0.08 0.01 238);
  --secondary: oklch(0.23 0.018 238);
  --secondary-foreground: oklch(0.9 0.006 220);
  --muted: oklch(0.24 0.016 238);
  --muted-foreground: oklch(0.7 0.012 225);
  --accent: oklch(0.26 0.045 170);
  --accent-foreground: oklch(0.87 0.08 164);
  --destructive: oklch(0.58 0.2 25);
  --destructive-foreground: oklch(0.98 0 0);
  --studio-cta-start: oklch(0.68 0.15 164);
  --studio-cta-end: oklch(0.58 0.14 184);
  --studio-cta-text: oklch(0.08 0.012 238);
  --studio-chip: oklch(0.22 0.018 238);
  --studio-chip-border: oklch(0.36 0.026 232);
  --studio-chip-text: oklch(0.78 0.014 225);
  --studio-chip-accent: oklch(0.3 0.07 166);
  --studio-chip-accent-text: oklch(0.86 0.095 164);
  --studio-state-ok: oklch(0.72 0.16 154);
  --studio-state-warn: oklch(0.76 0.15 82);
  --studio-state-text: oklch(0.78 0.12 164);
  --border: oklch(0.31 0.02 238);
  --input: oklch(0.25 0.018 238);
  --ring: oklch(0.72 0.15 163);
```

- [ ] **Step 2: Make shared buttons less decorative**

In `packages/studio/src/index.css`, replace `.studio-cta` and `.studio-cta:hover` with:

```css
.studio-cta {
  border: 1px solid color-mix(in oklch, var(--studio-state-text) 48%, transparent);
  background: linear-gradient(180deg, var(--studio-cta-start), var(--studio-cta-end));
  color: var(--studio-cta-text);
  text-shadow: none;
  box-shadow: 0 10px 22px -18px color-mix(in oklch, var(--studio-state-text) 48%, transparent);
  transition: border-color 0.18s ease, filter 0.18s ease, transform 0.18s ease;
}

.studio-cta:hover {
  border-color: color-mix(in oklch, var(--studio-state-text) 68%, transparent);
  filter: brightness(1.05);
  transform: translateY(-1px);
}
```

- [ ] **Step 3: Update `useColors` semantic mappings**

In `packages/studio/src/hooks/use-colors.ts`, replace the returned `input`, `btnPrimary`, `btnSecondary`, and `code` mappings with:

```ts
    input: "bg-input/45 border border-border text-foreground focus:border-[color:var(--studio-state-text)] focus:ring-2 focus:ring-[color:var(--studio-state-text)]/20 transition-all duration-200",
    btnPrimary: "studio-cta rounded-md transition-all shadow-sm",
    btnSecondary: "studio-chip rounded-md transition-all",
    code: "bg-background/70 border border-border/60 text-foreground/82 font-mono",
```

Leave other keys unchanged.

- [ ] **Step 4: Tighten Sidebar chrome without changing nav behavior**

In `packages/studio/src/components/Sidebar.tsx`:

Replace the `<aside>` class string with:

```tsx
<aside className={`fixed inset-y-0 left-0 z-50 flex h-full w-[280px] max-w-[86vw] flex-col overflow-hidden border-r border-border bg-background/96 backdrop-blur-md select-none transition-transform duration-300 md:static md:z-auto md:w-[260px] md:max-w-none md:translate-x-0 ${
  mobileOpen ? "translate-x-0" : "-translate-x-full"
}`}>
```

Replace the logo icon wrapper class:

```tsx
className="w-8 h-8 rounded-lg studio-chip-accent flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform"
```

with:

```tsx
className="flex h-8 w-8 items-center justify-center rounded-md border border-[color:var(--studio-state-text)]/40 bg-[color:var(--studio-state-text)]/12 text-[color:var(--studio-state-text)] transition-transform group-hover:scale-105"
```

Replace every navigation item rounded class inside `SidebarItem` from `rounded-lg` to `rounded-md`, keeping the active/inactive logic unchanged.

- [ ] **Step 5: Run smoke tests that cover route/sidebar-adjacent behavior**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- src/App.test.ts src/pages/entrypoint-routing.test.ts src/CockpitStandaloneApp.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit shared token alignment**

```bash
git add packages/studio/src/index.css \
  packages/studio/src/hooks/use-colors.ts \
  packages/studio/src/components/Sidebar.tsx
git commit -m "style: align studio chrome with technical console"
```

---

### Task 5: Responsive And Regression Verification

**Files:**
- Modify only if verification finds a focused issue:
  - `packages/studio/src/index.css`
  - `packages/studio/src/pages/cockpit/*.tsx`

- [ ] **Step 1: Run focused Cockpit tests**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- \
  src/pages/cockpit/CockpitHeaderSection.test.tsx \
  src/pages/cockpit/CockpitMainConversation.test.ts \
  src/pages/cockpit/CockpitLiveStatusStrip.test.ts \
  src/pages/cockpit-ui-state.test.ts \
  src/pages/cockpit-status-strip.test.ts \
  src/pages/cockpit-queue-state.test.ts \
  src/pages/cockpit-parsing.test.ts \
  src/pages/Cockpit.test.ts \
  src/CockpitStandaloneApp.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run Studio typecheck**

Run:

```bash
pnpm --filter @actalk/inkos-studio typecheck
```

Expected: PASS. If it fails in files outside the changed Studio UI scope, capture the exact failing file and error in the final implementation summary and do not patch unrelated code.

- [ ] **Step 3: Build the Studio client/server package**

Run:

```bash
pnpm --filter @actalk/inkos-studio build
```

Expected: PASS and both `packages/studio/dist/index.html` and `packages/studio/dist/cockpit/index.html` exist.

- [ ] **Step 4: Start the dev server for visual verification**

Run:

```bash
pnpm --filter @actalk/inkos-studio dev
```

Expected: Vite serves Studio on `http://localhost:4567`. Keep the session running for the next step. If port 4567 is occupied, run:

```bash
pnpm --filter @actalk/inkos-studio dev -- --port 4568
```

- [ ] **Step 5: Verify desktop and mobile manually or with browser tooling**

Open:

```text
http://localhost:4567/cockpit/
http://localhost:4567/
```

Check:

- Cockpit opens as a technical console, not an atmospheric hero.
- Left rail, central work log, composer, and right inspector are visible on desktop.
- At mobile width around 390px, the panes stack without horizontal scrolling.
- Korean labels do not overlap or clip in buttons/chips.
- Studio sidebar uses the same graphite/cyan/amber visual system.

- [ ] **Step 6: Commit any verification-only responsive fixes**

If Step 5 required CSS fixes, commit them separately:

```bash
git add packages/studio/src/index.css packages/studio/src/pages/cockpit/*.tsx
git commit -m "fix: polish cockpit console responsiveness"
```

If no fixes were required, skip this commit.

---

## Self-Review Notes

Spec coverage:

- Cockpit hero removal: Task 1 and Task 2.
- Technical-console layout hierarchy: Task 2 and Task 3.
- Command composer and slash commands: Task 3.
- Studio graphite/cyan/amber token alignment: Task 4.
- Existing routing/data behavior preserved: Tasks 2-5 use presentational files and targeted route tests.
- Error/accessibility/responsive requirements: Tasks 1, 3, and 5.

No placeholders remain in executable steps. All commands use repo-local package scripts and exact file paths.
