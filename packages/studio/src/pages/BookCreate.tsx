import { useEffect, useRef, useState } from "react";
import { createIdempotencyKey, fetchJson, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { resolveStudioLanguage, type StudioLanguage } from "../shared/language";
import { defaultChapterWordsForLanguage, pickValidValue, platformOptionsForLanguage } from "../shared/book-create-form";

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
}

interface GenreInfo {
  readonly id: string;
  readonly name: string;
  readonly source: "project" | "builtin";
  readonly language: StudioLanguage;
}

interface WaitForBookReadyOptions {
  readonly fetchBook?: (bookId: string) => Promise<unknown>;
  readonly fetchStatus?: (bookId: string) => Promise<{
    status: string;
    error?: string;
    stage?: string | null;
    message?: string | null;
    history?: ReadonlyArray<{
      timestamp: string;
      kind: "start" | "stage" | "info" | "error";
      label: string;
      detail?: string | null;
    }>;
  }>;
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  readonly waitImpl?: (ms: number) => Promise<void>;
  readonly onStatus?: (status: {
    status: string;
    error?: string;
    stage?: string | null;
    message?: string | null;
    history?: ReadonlyArray<{
      timestamp: string;
      kind: "start" | "stage" | "info" | "error";
      label: string;
      detail?: string | null;
    }>;
  }) => void;
}

const DEFAULT_BOOK_READY_MAX_ATTEMPTS = 120;
const DEFAULT_BOOK_READY_DELAY_MS = 250;

export async function waitForBookReady(
  bookId: string,
  options: WaitForBookReadyOptions = {},
): Promise<void> {
  const fetchBook = options.fetchBook ?? ((id: string) => fetchJson(`/books/${id}`));
  const fetchStatus = options.fetchStatus ?? ((id: string) => fetchJson<{ status: string; error?: string }>(`/books/${id}/create-status`));
  const maxAttempts = options.maxAttempts ?? DEFAULT_BOOK_READY_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_BOOK_READY_DELAY_MS;
  const waitImpl = options.waitImpl ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));

  let lastError: unknown;
  let lastKnownStatus: string | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await fetchBook(bookId);
      return;
    } catch (error) {
      lastError = error;
      try {
        const status = await fetchStatus(bookId);
        lastKnownStatus = status.status;
        options.onStatus?.(status);
        if (status.status === "error") {
          throw new Error(status.error ?? `Book "${bookId}" failed to create`);
        }
      } catch (statusError) {
        if (statusError instanceof Error && statusError.message !== "404 Not Found") {
          throw statusError;
        }
      }
      if (attempt === maxAttempts - 1) {
        if (lastKnownStatus === "creating") {
          break;
        }
        throw error;
      }
      await waitImpl(delayMs);
    }
  }

  if (lastKnownStatus === "creating") {
    throw new Error(`Book "${bookId}" is still being created. Wait a moment and refresh.`);
  }

  throw lastError instanceof Error ? lastError : new Error(`Book "${bookId}" was not ready`);
}

function buildBookCreateRequestFingerprint(input: {
  readonly title: string;
  readonly genre: string;
  readonly language: StudioLanguage;
  readonly platform: string;
  readonly chapterWordCount: number;
  readonly targetChapters: number;
}): string {
  return JSON.stringify({
    title: input.title.trim(),
    genre: input.genre,
    language: input.language,
    platform: input.platform,
    chapterWordCount: input.chapterWordCount,
    targetChapters: input.targetChapters,
  });
}

export function BookCreate({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data: genreData } = useApi<{ genres: ReadonlyArray<GenreInfo> }>("/genres");
  const { data: project } = useApi<{ language: string }>("/project");
  const mountedRef = useRef(true);
  const createAttemptRef = useRef<{ readonly fingerprint: string; readonly key: string } | null>(null);

  const projectLang = resolveStudioLanguage(project?.language);

  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [platform, setPlatform] = useState("");
  const [chapterWords, setChapterWords] = useState(defaultChapterWordsForLanguage(projectLang));
  const [chapterWordsTouched, setChapterWordsTouched] = useState(false);
  const [targetChapters, setTargetChapters] = useState("200");
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState<{
    stage?: string | null;
    message?: string | null;
    bookId?: string;
    history?: ReadonlyArray<{
      timestamp: string;
      kind: "start" | "stage" | "info" | "error";
      label: string;
      detail?: string | null;
    }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter genres by project language + custom genres (always show)
  const allGenres = genreData?.genres ?? [];
  const genres = allGenres.filter((g) => g.language === projectLang || g.source === "project");
  const platforms = platformOptionsForLanguage(projectLang);
  const genreSignature = genres.map((g) => g.id).join("|");
  const platformSignature = platforms.map((p) => `${p.value}:${p.label}`).join("|");

  useEffect(() => {
    setGenre((current) => pickValidValue(current, genres.map((g) => g.id)));
  }, [genreSignature]);

  useEffect(() => {
    setPlatform((current) => pickValidValue(current, platforms.map((p) => p.value)));
  }, [platformSignature]);

  useEffect(() => {
    if (!chapterWordsTouched) {
      setChapterWords(defaultChapterWordsForLanguage(projectLang));
    }
  }, [projectLang, chapterWordsTouched]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleCreate = async () => {
    if (!title.trim()) {
      setError(t("create.titleRequired"));
      return;
    }
    if (!genre) {
      setError(t("create.genreRequired"));
      return;
    }
    setCreating(true);
    setError(null);
    setCreateProgress(null);
    try {
      const request = {
        title: title.trim(),
        genre,
        language: projectLang,
        platform,
        chapterWordCount: parseInt(chapterWords, 10),
        targetChapters: parseInt(targetChapters, 10),
      } as const;
      const fingerprint = buildBookCreateRequestFingerprint(request);
      const currentAttempt = createAttemptRef.current;
      const idempotencyKey = currentAttempt?.fingerprint === fingerprint
        ? currentAttempt.key
        : createIdempotencyKey();
      createAttemptRef.current = { fingerprint, key: idempotencyKey };

      const result = await postApi<{ bookId: string }>("/books/create", request, {
        headers: { "Idempotency-Key": idempotencyKey },
      });
      if (mountedRef.current) {
        setCreateProgress({ bookId: result.bookId });
      }
      await waitForBookReady(result.bookId, {
        onStatus: (status) => {
          if (!mountedRef.current) return;
          setCreateProgress({
            bookId: result.bookId,
            stage: status.stage ?? null,
            message: status.message ?? null,
            history: status.history ?? [],
          });
        },
      });
      if (mountedRef.current) {
        nav.toBook(result.bookId);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to create book");
      }
    } finally {
      if (mountedRef.current) {
        setCreating(false);
      }
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span className="text-border">/</span>
        <span>{t("bread.legacyCreate")}</span>
      </div>

      <h1 className="font-serif text-3xl">{t("create.legacyTitle")}</h1>

      {error && (
        <div className={`border ${c.error} rounded-md px-4 py-3`}>
          {error}
        </div>
      )}

      {creating && createProgress && (
        <div className={`border ${c.cardStatic} rounded-xl px-4 py-4 text-sm`}>
          <div className="font-semibold text-foreground">
            {createProgress.bookId ? `"${createProgress.bookId}"` : t("create.creating")}
          </div>
          <div className="mt-2 text-muted-foreground leading-6">
            {createProgress.stage || createProgress.message || t("create.creatingHint")}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {t("create.backgroundHint")}
          </div>
          {createProgress.history && createProgress.history.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-border/50 pt-3">
              {createProgress.history.slice(-4).reverse().map((entry) => (
                <div key={`${entry.timestamp}-${entry.kind}-${entry.label}`} className="rounded-lg bg-secondary/35 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {entry.label}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  {entry.detail && (
                    <div className="mt-1 text-xs leading-5 text-foreground/80">
                      {entry.detail}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-5">
        {/* Title */}
        <div>
          <label className="block text-sm text-muted-foreground mb-2">{t("create.bookTitle")}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none text-base`}
            placeholder={t("create.placeholder")}
          />
        </div>

        {/* Genre — filtered by language */}
        <div>
          <label className="block text-sm text-muted-foreground mb-2">{t("create.genre")}</label>
          <div className="grid grid-cols-3 gap-2">
            {genres.map((g) => (
              <button
                key={g.id}
                onClick={() => setGenre(g.id)}
                className={`px-3 py-2.5 rounded-md text-sm text-left transition-all ${
                  genre === g.id
                    ? "studio-surface-active font-medium"
                    : "bg-secondary text-secondary-foreground border border-transparent studio-surface-hover"
                }`}
              >
                {g.name}
                {g.source === "project" && <span className="text-xs text-muted-foreground ml-1">✦</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Platform — filtered by language */}
        <div>
          <label className="block text-sm text-muted-foreground mb-2">
            {t("create.platform")}
          </label>
          <div className="flex gap-2">
            {platforms.map((p) => (
              <button
                key={p.value}
                onClick={() => setPlatform(p.value)}
                className={`px-3 py-2 rounded-md text-sm transition-all ${
                  platform === p.value
                    ? "studio-surface-active"
                    : "bg-secondary text-secondary-foreground border border-transparent studio-surface-hover"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Word count + chapters */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-2">{t("create.wordsPerChapter")}</label>
            <input
              type="number"
              value={chapterWords}
              onChange={(e) => {
                setChapterWordsTouched(true);
                setChapterWords(e.target.value);
              }}
              className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none`}
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-2">{t("create.targetChapters")}</label>
            <input
              type="number"
              value={targetChapters}
              onChange={(e) => setTargetChapters(e.target.value)}
              className={`w-full ${c.input} rounded-md px-4 py-3 focus:outline-none`}
            />
          </div>
        </div>
      </div>

      <button
        onClick={handleCreate}
        disabled={creating || !title.trim()}
        className={`w-full px-4 py-3 ${c.btnPrimary} rounded-md disabled:opacity-50 font-medium text-base`}
      >
        {creating ? t("create.creating") : t("create.legacySubmit")}
      </button>
    </div>
  );
}
