interface BrowserStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function getBrowserStorage(): BrowserStorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readBrowserJson<T>(storage: Pick<BrowserStorageLike, "getItem"> | null | undefined, key: string): T | null {
  const raw = storage?.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeBrowserJson(storage: Pick<BrowserStorageLike, "setItem"> | null | undefined, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore local storage failures and keep the in-memory state.
  }
}

export function removeBrowserValue(storage: Pick<BrowserStorageLike, "removeItem"> | null | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Ignore local storage failures and keep the in-memory state.
  }
}
