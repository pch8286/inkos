import { getBrowserStorage, readBrowserJson, removeBrowserValue, writeBrowserJson } from "./browser-storage";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type AiSessionKind = "cockpit" | "chatbar" | "truth";

export interface PersistedAiSessionRecord<Payload = unknown> {
  readonly version: 1;
  readonly sessionId: string;
  readonly kind: AiSessionKind;
  readonly bookId: string | null;
  readonly scopeKey: string;
  readonly updatedAt: number;
  readonly payload: Payload;
}

export interface AiSessionBodyStore {
  load(sessionId: string): Promise<unknown | null>;
  save(record: PersistedAiSessionRecord): Promise<void>;
  delete(sessionId: string): Promise<void>;
  list(): Promise<ReadonlyArray<unknown>>;
}

export interface AiSessionStoreDeps {
  readonly bodyStore?: AiSessionBodyStore;
  readonly indexedDbFactory?: IDBFactory | null;
  readonly storage?: StorageLike | null;
  readonly now?: () => number;
}

const AI_SESSION_DB_NAME = "inkos-ai-sessions";
const AI_SESSION_DB_VERSION = 1;
const AI_SESSION_STORE_NAME = "sessions";
const AI_SESSION_POINTER_PREFIX = "inkos:ai-session:pointer:v1:";
const AI_SESSION_FALLBACK_KEY = "inkos:ai-session:fallback:v1";

export const AI_SESSION_RETENTION_MS = 1000 * 60 * 60 * 24 * 30;
const AI_SESSION_MAX_PER_KIND = 12;

let defaultBodyStorePromise: Promise<AiSessionBodyStore> | null = null;

export function buildAiSessionPointerKey(scopeKey: string): string {
  return `${AI_SESSION_POINTER_PREFIX}${scopeKey}`;
}

export function readAiSessionPointer(scopeKey: string, storage: StorageLike | null | undefined = getBrowserStorage()): string | null {
  const raw = storage?.getItem(buildAiSessionPointerKey(scopeKey))?.trim();
  return raw ? raw : null;
}

export function writeAiSessionPointer(scopeKey: string, sessionId: string, storage: StorageLike | null | undefined = getBrowserStorage()): void {
  try {
    storage?.setItem(buildAiSessionPointerKey(scopeKey), sessionId);
  } catch {
    // Ignore storage write failures and keep runtime state only.
  }
}

export function clearAiSessionPointer(scopeKey: string, storage: StorageLike | null | undefined = getBrowserStorage()): void {
  removeBrowserValue(storage ?? null, buildAiSessionPointerKey(scopeKey));
}

export function createInMemoryAiSessionBodyStore(): AiSessionBodyStore {
  const records = new Map<string, PersistedAiSessionRecord>();

  return {
    async load(sessionId) {
      return records.get(sessionId) ?? null;
    },
    async save(record) {
      records.set(record.sessionId, record);
    },
    async delete(sessionId) {
      records.delete(sessionId);
    },
    async list() {
      return [...records.values()];
    },
  };
}

export async function loadAiSessionRecord<Payload = unknown>(
  sessionId: string,
  deps?: AiSessionStoreDeps,
): Promise<PersistedAiSessionRecord<Payload> | null> {
  const bodyStore = await resolveAiSessionBodyStore(deps);
  const value = await bodyStore.load(sessionId);
  return isPersistedAiSessionRecord(value) ? (value as PersistedAiSessionRecord<Payload>) : null;
}

export async function saveAiSessionRecord(
  record: PersistedAiSessionRecord,
  deps?: AiSessionStoreDeps,
): Promise<void> {
  if (!isPersistedAiSessionRecord(record)) {
    return;
  }
  const bodyStore = await resolveAiSessionBodyStore(deps);
  await bodyStore.save(record);
  await pruneAiSessionRecords(deps);
}

export async function deleteAiSessionRecord(sessionId: string, deps?: AiSessionStoreDeps): Promise<void> {
  const bodyStore = await resolveAiSessionBodyStore(deps);
  await bodyStore.delete(sessionId);
}

export async function pruneAiSessionRecords(
  deps?: AiSessionStoreDeps,
  options?: {
    readonly maxPerKind?: number;
    readonly maxAgeMs?: number;
  },
): Promise<void> {
  const now = deps?.now?.() ?? Date.now();
  const maxPerKind = options?.maxPerKind ?? AI_SESSION_MAX_PER_KIND;
  const maxAgeMs = options?.maxAgeMs ?? AI_SESSION_RETENTION_MS;
  const bodyStore = await resolveAiSessionBodyStore(deps);
  const records = (await bodyStore.list()).filter(isPersistedAiSessionRecord);

  const byKind = new Map<AiSessionKind, PersistedAiSessionRecord[]>();
  for (const record of records) {
    const bucket = byKind.get(record.kind) ?? [];
    bucket.push(record);
    byKind.set(record.kind, bucket);
  }

  const deletions = new Set<string>();

  for (const bucket of byKind.values()) {
    bucket.sort((left, right) => right.updatedAt - left.updatedAt);

    for (const record of bucket) {
      if (now - record.updatedAt > maxAgeMs) {
        deletions.add(record.sessionId);
      }
    }

    const kept = bucket.filter((record) => !deletions.has(record.sessionId));
    for (const overflow of kept.slice(maxPerKind)) {
      deletions.add(overflow.sessionId);
    }
  }

  await Promise.all([...deletions].map((sessionId) => bodyStore.delete(sessionId)));
}

function isPersistedAiSessionRecord(value: unknown): value is PersistedAiSessionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.version === 1
    && typeof record.sessionId === "string"
    && typeof record.scopeKey === "string"
    && typeof record.updatedAt === "number"
    && (record.kind === "cockpit" || record.kind === "chatbar" || record.kind === "truth")
    && "payload" in record
    && (typeof record.bookId === "string" || record.bookId === null);
}

async function resolveAiSessionBodyStore(deps?: AiSessionStoreDeps): Promise<AiSessionBodyStore> {
  if (deps?.bodyStore) {
    return deps.bodyStore;
  }

  if (!defaultBodyStorePromise) {
    defaultBodyStorePromise = createDefaultAiSessionBodyStore({
      indexedDbFactory: deps?.indexedDbFactory,
      storage: deps?.storage,
    });
  }
  return defaultBodyStorePromise;
}

async function createDefaultAiSessionBodyStore(input?: {
  readonly indexedDbFactory?: IDBFactory | null;
  readonly storage?: StorageLike | null;
}): Promise<AiSessionBodyStore> {
  const indexedDbFactory = input?.indexedDbFactory
    ?? (typeof indexedDB !== "undefined" ? indexedDB : null);
  if (indexedDbFactory) {
    try {
      return await createIndexedDbAiSessionBodyStore(indexedDbFactory);
    } catch {
      // Fall back to localStorage-backed bodies if IndexedDB is unavailable.
    }
  }
  return createLocalStorageAiSessionBodyStore(input?.storage ?? getBrowserStorage());
}

async function createIndexedDbAiSessionBodyStore(indexedDbFactory: IDBFactory): Promise<AiSessionBodyStore> {
  const database = await openAiSessionDatabase(indexedDbFactory);

  return {
    async load(sessionId) {
      return await runObjectStoreRequest(database, "readonly", (store) => store.get(sessionId));
    },
    async save(record) {
      await runObjectStoreRequest(database, "readwrite", (store) => store.put(record));
    },
    async delete(sessionId) {
      await runObjectStoreRequest(database, "readwrite", (store) => store.delete(sessionId));
    },
    async list() {
      return await runObjectStoreRequest(database, "readonly", (store) => store.getAll());
    },
  };
}

function openAiSessionDatabase(indexedDbFactory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDbFactory.open(AI_SESSION_DB_NAME, AI_SESSION_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(AI_SESSION_STORE_NAME)) {
        database.createObjectStore(AI_SESSION_STORE_NAME, { keyPath: "sessionId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open AI session database."));
  });
}

function runObjectStoreRequest<Result>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<Result>,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AI_SESSION_STORE_NAME, mode);
    const store = transaction.objectStore(AI_SESSION_STORE_NAME);
    const request = operation(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("AI session database request failed."));
    transaction.onerror = () => reject(transaction.error ?? new Error("AI session database transaction failed."));
  });
}

function createLocalStorageAiSessionBodyStore(storage: StorageLike | null | undefined): AiSessionBodyStore {
  return {
    async load(sessionId) {
      const records = readLocalFallbackRecords(storage);
      return records[sessionId] ?? null;
    },
    async save(record) {
      const records = readLocalFallbackRecords(storage);
      writeBrowserJson(storage ?? null, AI_SESSION_FALLBACK_KEY, {
        ...records,
        [record.sessionId]: record,
      });
    },
    async delete(sessionId) {
      const records = readLocalFallbackRecords(storage);
      if (!(sessionId in records)) {
        return;
      }
      const next = { ...records };
      delete next[sessionId];
      writeBrowserJson(storage ?? null, AI_SESSION_FALLBACK_KEY, next);
    },
    async list() {
      return Object.values(readLocalFallbackRecords(storage));
    },
  };
}

function readLocalFallbackRecords(storage: StorageLike | null | undefined): Record<string, PersistedAiSessionRecord> {
  const parsed = readBrowserJson<Record<string, PersistedAiSessionRecord>>(storage ?? null, AI_SESSION_FALLBACK_KEY);
  return parsed && typeof parsed === "object" ? parsed : {};
}
