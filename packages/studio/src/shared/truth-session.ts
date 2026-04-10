import type { BinderMode } from "./truth-assistant";
import { getBrowserStorage, readBrowserJson, removeBrowserValue, writeBrowserJson } from "./browser-storage";

export type TruthSessionEditorMode = "structured" | "markdown";

export interface StoredTruthDraft {
  readonly content: string;
  readonly originalContent: string;
}

export interface StoredTruthAlignmentDraft {
  readonly knownFacts: string;
  readonly unknowns: string;
  readonly mustDecide: string;
  readonly askFirst: string;
}

export interface StoredTruthSession {
  readonly version: 1;
  readonly drafts: Readonly<Record<string, StoredTruthDraft>>;
  readonly alignmentDrafts: Readonly<Record<string, StoredTruthAlignmentDraft>>;
  readonly ui: {
    readonly activeMode: BinderMode;
    readonly selected: string | null;
    readonly editMode: boolean;
    readonly editorMode: TruthSessionEditorMode;
    readonly workspaceTargetFile: string;
  };
}

export interface StoredTruthThreadChange {
  readonly fileName: string;
  readonly label: string;
  readonly beforeContent: string;
  readonly content: string;
  readonly preview: string;
}

export interface StoredTruthThreadMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt: number;
  readonly kind: "chat" | "proposal" | "clarification" | "question";
  readonly targetFiles: ReadonlyArray<string>;
  readonly changes?: ReadonlyArray<StoredTruthThreadChange>;
}

export interface StoredTruthThreads {
  readonly version: 1;
  readonly threads: Readonly<Record<string, ReadonlyArray<StoredTruthThreadMessage>>>;
}

const TRUTH_SESSION_PREFIX = "inkos:truth-session:v1:";
const TRUTH_THREADS_PREFIX = "inkos:truth-threads:v1:";

function truthSessionKey(bookId: string): string {
  return `${TRUTH_SESSION_PREFIX}${bookId}`;
}

function truthThreadsKey(bookId: string): string {
  return `${TRUTH_THREADS_PREFIX}${bookId}`;
}

export function readStoredTruthSession(bookId: string): StoredTruthSession | null {
  const parsed = readBrowserJson<StoredTruthSession>(getBrowserStorage(), truthSessionKey(bookId));
  return parsed?.version === 1 ? parsed : null;
}

export function writeStoredTruthSession(bookId: string, session: StoredTruthSession): void {
  writeBrowserJson(getBrowserStorage(), truthSessionKey(bookId), session);
}

export function clearStoredTruthSession(bookId: string): void {
  removeBrowserValue(getBrowserStorage(), truthSessionKey(bookId));
}

export function readStoredTruthThreads(bookId: string): StoredTruthThreads | null {
  const parsed = readBrowserJson<StoredTruthThreads>(getBrowserStorage(), truthThreadsKey(bookId));
  return parsed?.version === 1 ? parsed : null;
}

export function writeStoredTruthThreads(bookId: string, threads: StoredTruthThreads): void {
  writeBrowserJson(getBrowserStorage(), truthThreadsKey(bookId), threads);
}

export function clearStoredTruthThreads(bookId: string): void {
  removeBrowserValue(getBrowserStorage(), truthThreadsKey(bookId));
}
