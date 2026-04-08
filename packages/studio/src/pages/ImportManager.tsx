import { useEffect, useState } from "react";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useI18n } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import type { StudioLanguage } from "../shared/language";
import { FileInput, BookCopy, Feather } from "lucide-react";

interface BookSummary {
  readonly id: string;
  readonly title: string;
}

interface Nav { toDashboard: () => void }

type Tab = "chapters" | "canon" | "fanfic";

function defaultFanficGenreForLanguage(language: StudioLanguage): string {
  return language === "ko" ? "korean-other" : "other";
}

function fanficGenresForLanguage(language: StudioLanguage): ReadonlyArray<{ value: string; label: string }> {
  if (language === "en") {
    return [
      { value: "other", label: "Other" },
      { value: "fantasy", label: "Fantasy" },
      { value: "romantasy", label: "Romantasy" },
      { value: "isekai", label: "Isekai" },
    ];
  }
  if (language === "zh") {
    return [
      { value: "other", label: "通用" },
      { value: "xuanhuan", label: "玄幻" },
      { value: "urban", label: "都市" },
      { value: "xianxia", label: "仙侠" },
    ];
  }
  return [
    { value: "korean-other", label: "일반" },
    { value: "modern-fantasy", label: "현대판타지" },
    { value: "fantasy", label: "판타지" },
    { value: "murim", label: "무협" },
    { value: "romance-fantasy", label: "로맨스판타지" },
  ];
}

export function ImportManager({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { lang } = useI18n();
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const [tab, setTab] = useState<Tab>("chapters");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  // Chapters state
  const [chText, setChText] = useState("");
  const [chBookId, setChBookId] = useState("");
  const [chSplitRegex, setChSplitRegex] = useState("");

  // Canon state
  const [canonTarget, setCanonTarget] = useState("");
  const [canonFrom, setCanonFrom] = useState("");

  // Fanfic state
  const [ffTitle, setFfTitle] = useState("");
  const [ffText, setFfText] = useState("");
  const [ffMode, setFfMode] = useState("canon");
  const [ffLang, setFfLang] = useState<StudioLanguage>(lang);
  const [ffGenre, setFfGenre] = useState(defaultFanficGenreForLanguage(lang));
  const fanficGenres = fanficGenresForLanguage(ffLang);

  useEffect(() => {
    setFfGenre((current) => {
      const available = fanficGenresForLanguage(ffLang).map((genre) => genre.value);
      return available.includes(current) ? current : (available[0] ?? "");
    });
  }, [ffLang]);

  const handleImportChapters = async () => {
    if (!chText.trim() || !chBookId) return;
    setLoading(true);
    setStatus("");
    try {
      const data = await fetchJson<{ importedCount?: number }>(`/books/${chBookId}/import/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chText, splitRegex: chSplitRegex || undefined }),
      });
      setStatus(`Imported ${data.importedCount} chapters`);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleImportCanon = async () => {
    if (!canonTarget || !canonFrom) return;
    setLoading(true);
    setStatus("");
    try {
      await postApi(`/books/${canonTarget}/import/canon`, { fromBookId: canonFrom });
      setStatus("Canon imported successfully!");
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleFanficInit = async () => {
    if (!ffTitle.trim() || !ffText.trim()) return;
    setLoading(true);
    setStatus("");
    try {
      const data = await fetchJson<{ bookId?: string }>("/fanfic/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: ffTitle, sourceText: ffText, mode: ffMode,
          genre: ffGenre, language: ffLang,
        }),
      });
      setStatus(`Fanfic created: ${data.bookId}`);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "chapters", label: t("import.chapters"), icon: <FileInput size={14} /> },
    { id: "canon", label: t("import.canon"), icon: <BookCopy size={14} /> },
    { id: "fanfic", label: t("import.fanfic"), icon: <Feather size={14} /> },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("nav.import")}</span>
      </div>

      <h1 className="font-serif text-3xl flex items-center gap-3">
        <FileInput size={28} className="text-primary" />
        {t("import.title")}
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-secondary/30 rounded-lg p-1 w-fit">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => { setTab(tb.id); setStatus(""); }}
            className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${
              tab === tb.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tb.icon} {tb.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className={`border ${c.cardStatic} rounded-lg p-6 space-y-4`}>
        {tab === "chapters" && (
          <>
            <select value={chBookId} onChange={(e) => setChBookId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
              <option value="">{t("import.selectTarget")}</option>
              {booksData?.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <input
              type="text" value={chSplitRegex} onChange={(e) => setChSplitRegex(e.target.value)}
              placeholder={t("import.splitRegex")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm font-mono"
            />
            <textarea value={chText} onChange={(e) => setChText(e.target.value)} rows={10}
              placeholder={t("import.pasteChapters")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm resize-none font-mono"
            />
            <button onClick={handleImportChapters} disabled={loading || !chBookId || !chText.trim()}
              className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30`}>
              {loading ? t("import.importing") : t("import.chapters")}
            </button>
          </>
        )}

        {tab === "canon" && (
          <>
            <select value={canonFrom} onChange={(e) => setCanonFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
              <option value="">{t("import.selectSource")}</option>
              {booksData?.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <select value={canonTarget} onChange={(e) => setCanonTarget(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
              <option value="">{t("import.selectDerivative")}</option>
              {booksData?.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <button onClick={handleImportCanon} disabled={loading || !canonTarget || !canonFrom}
              className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30`}>
              {loading ? t("import.importing") : t("import.canon")}
            </button>
          </>
        )}

        {tab === "fanfic" && (
          <>
            <input type="text" value={ffTitle} onChange={(e) => setFfTitle(e.target.value)}
              placeholder={t("import.fanficTitle")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
            />
            <div className="grid grid-cols-3 gap-3">
              <select value={ffMode} onChange={(e) => setFfMode(e.target.value)}
                className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
                <option value="canon">Canon</option>
                <option value="au">AU</option>
                <option value="ooc">OOC</option>
                <option value="cp">CP</option>
              </select>
              <select value={ffGenre} onChange={(e) => setFfGenre(e.target.value)}
                className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
                {fanficGenres.map((genre) => (
                  <option key={genre.value} value={genre.value}>{genre.label}</option>
                ))}
              </select>
              <select value={ffLang} onChange={(e) => setFfLang(e.target.value as StudioLanguage)}
                className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
                <option value="ko">한국어</option>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <textarea value={ffText} onChange={(e) => setFfText(e.target.value)} rows={10}
              placeholder={t("import.pasteMaterial")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm resize-none font-mono"
            />
            <button onClick={handleFanficInit} disabled={loading || !ffTitle.trim() || !ffText.trim()}
              className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30`}>
              {loading ? t("import.creating") : t("import.fanfic")}
            </button>
          </>
        )}

        {status && (
          <div className={`text-sm px-3 py-2 rounded-lg ${status.startsWith("Error") ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-600"}`}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
