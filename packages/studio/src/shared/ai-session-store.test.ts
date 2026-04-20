import { describe, expect, it } from "vitest";
import {
  AI_SESSION_RETENTION_MS,
  buildAiSessionPointerKey,
  createInMemoryAiSessionBodyStore,
  deleteAiSessionRecord,
  loadAiSessionRecord,
  pruneAiSessionRecords,
  readAiSessionPointer,
  saveAiSessionRecord,
  writeAiSessionPointer,
  type PersistedAiSessionRecord,
} from "./ai-session-store";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function makeRecord(
  overrides?: Partial<PersistedAiSessionRecord<{ readonly marker: string }>>,
): PersistedAiSessionRecord<{ readonly marker: string }> {
  return {
    version: 1,
    sessionId: overrides?.sessionId ?? "studio:cockpit",
    kind: overrides?.kind ?? "cockpit",
    bookId: overrides?.bookId ?? "book-1",
    scopeKey: overrides?.scopeKey ?? "cockpit",
    updatedAt: overrides?.updatedAt ?? Date.now(),
    payload: overrides?.payload ?? { marker: "alpha" },
  };
}

describe("ai-session-store", () => {
  it("saves, loads, and deletes persisted session records", async () => {
    const bodyStore = createInMemoryAiSessionBodyStore();
    const record = makeRecord({ updatedAt: 1_717_171_717_171 });

    await saveAiSessionRecord(record, {
      bodyStore,
      now: () => 1_717_171_717_171,
    });

    await expect(loadAiSessionRecord<{ readonly marker: string }>("studio:cockpit", { bodyStore })).resolves.toEqual(
      record,
    );

    await deleteAiSessionRecord("studio:cockpit", { bodyStore });

    await expect(loadAiSessionRecord("studio:cockpit", { bodyStore })).resolves.toBeNull();
  });

  it("stores lightweight restore pointers separately from session bodies", () => {
    const storage = new MemoryStorage();

    writeAiSessionPointer("cockpit", "studio:cockpit", storage);

    expect(readAiSessionPointer("cockpit", storage)).toBe("studio:cockpit");
    expect(buildAiSessionPointerKey("cockpit")).toBe("inkos:ai-session:pointer:v1:cockpit");
  });

  it("prunes stale records and older overflow records per kind", async () => {
    const now = 1_717_171_717_171;
    const bodyStore = createInMemoryAiSessionBodyStore();

    await saveAiSessionRecord(makeRecord({
      sessionId: "studio:cockpit:newest",
      updatedAt: now,
      payload: { marker: "newest" },
    }), { bodyStore, now: () => now });
    await saveAiSessionRecord(makeRecord({
      sessionId: "studio:cockpit:older",
      updatedAt: now - 1_000,
      payload: { marker: "older" },
    }), { bodyStore, now: () => now });
    await saveAiSessionRecord(makeRecord({
      sessionId: "studio:truth:stale",
      kind: "truth",
      scopeKey: "truth",
      updatedAt: 1,
      payload: { marker: "stale" },
    }), { bodyStore, now: () => now });

    await pruneAiSessionRecords({
      bodyStore,
      now: () => now,
    }, {
      maxPerKind: 1,
      maxAgeMs: AI_SESSION_RETENTION_MS,
    });

    await expect(loadAiSessionRecord("studio:cockpit:newest", { bodyStore })).resolves.toEqual(makeRecord({
      sessionId: "studio:cockpit:newest",
      updatedAt: now,
      payload: { marker: "newest" },
    }));
    await expect(loadAiSessionRecord("studio:cockpit:older", { bodyStore })).resolves.toBeNull();
    await expect(loadAiSessionRecord("studio:truth:stale", { bodyStore })).resolves.toBeNull();
  });

  it("ignores incompatible persisted payloads", async () => {
    const bodyStore = createInMemoryAiSessionBodyStore();

    await bodyStore.save({
      version: 99,
      sessionId: "broken",
      kind: "cockpit",
      bookId: null,
      scopeKey: "broken",
      updatedAt: 1,
      payload: { marker: "broken" },
    } as unknown as PersistedAiSessionRecord);

    await expect(loadAiSessionRecord("broken", { bodyStore })).resolves.toBeNull();
  });
});
