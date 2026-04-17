import type { ComposerAction } from "./cockpit-parsing";

export interface QueuedComposerEntry {
  readonly id: string;
  readonly action: ComposerAction;
  readonly text: string;
  readonly createdAt: number;
}

export type CockpitComposerQueueState = Record<string, ReadonlyArray<QueuedComposerEntry>>;

function canQueueEmptyText(action: ComposerAction) {
  return action === "draft" || action === "write-next" || action === "create";
}

function compactQueueState(
  state: CockpitComposerQueueState,
  threadKey: string,
  entries: ReadonlyArray<QueuedComposerEntry>,
): CockpitComposerQueueState {
  if (entries.length > 0) {
    return {
      ...state,
      [threadKey]: entries,
    };
  }

  if (!(threadKey in state)) {
    return state;
  }

  const next = { ...state };
  delete next[threadKey];
  return next;
}

export function appendQueuedComposerEntry(
  state: CockpitComposerQueueState,
  input: {
    readonly threadKey: string;
    readonly action: ComposerAction;
    readonly text: string;
    readonly now?: number;
  },
): CockpitComposerQueueState {
  const text = input.text.trim();
  if (!text && !canQueueEmptyText(input.action)) {
    return state;
  }

  const createdAt = input.now ?? Date.now();
  const entry: QueuedComposerEntry = {
    id: `${input.threadKey}:${createdAt}`,
    action: input.action,
    text,
    createdAt,
  };

  return {
    ...state,
    [input.threadKey]: [...(state[input.threadKey] ?? []), entry],
  };
}

export function shiftNextQueuedComposerEntry(
  state: CockpitComposerQueueState,
  threadKey: string,
): { readonly state: CockpitComposerQueueState; readonly entry: QueuedComposerEntry | null } {
  const entries = state[threadKey] ?? [];
  const entry = entries[0] ?? null;
  if (!entry) {
    return { state, entry: null };
  }

  return {
    entry,
    state: compactQueueState(state, threadKey, entries.slice(1)),
  };
}

export function popLastQueuedComposerEntry(
  state: CockpitComposerQueueState,
  threadKey: string,
): { readonly state: CockpitComposerQueueState; readonly entry: QueuedComposerEntry | null } {
  const entries = state[threadKey] ?? [];
  const entry = entries[entries.length - 1] ?? null;
  if (!entry) {
    return { state, entry: null };
  }

  return {
    entry,
    state: compactQueueState(state, threadKey, entries.slice(0, -1)),
  };
}
