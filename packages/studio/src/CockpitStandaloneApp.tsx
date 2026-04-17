import { useEffect, useMemo, useState } from "react";
import { Cockpit } from "./pages/Cockpit";
import { BootstrapView } from "./pages/BootstrapView";
import { LanguageSelector } from "./pages/LanguageSelector";
import { useSSE } from "./hooks/use-sse";
import { useTheme } from "./hooks/use-theme";
import { useI18n } from "./hooks/use-i18n";
import { postApi, useApi } from "./hooks/use-api";
import { buildStudioEntrypointUrl } from "./shared/cockpit-entrypoint";
import type { BootstrapSummary } from "./shared/contracts";

interface Nav {
  readonly toDashboard: () => void;
  readonly toBook: (bookId: string) => void;
  readonly toTruth: (bookId: string) => void;
  readonly toBookCreate?: () => void;
}

export function resolveBookIdFromSearch(search: string): string | undefined {
  return new URLSearchParams(search).get("bookId")?.trim() || undefined;
}

function navigateToStudioPage(
  page: "book" | "truth" | "book-create" | "cockpit" | "dashboard",
  options?: Readonly<{ readonly bookId?: string }>,
) {
  if (typeof window === "undefined") {
    return;
  }

  const query: Record<string, string> = page === "dashboard" ? {} : { page };
  if (options?.bookId) {
    query.bookId = options.bookId;
  }
  window.location.assign(buildStudioEntrypointUrl(window.location.pathname, query));
}

export function CockpitStandaloneApp() {
  const sse = useSSE();
  const { theme } = useTheme();
  const { t, lang } = useI18n();
  const { data: bootstrap, loading: bootstrapLoading, error: bootstrapError, refetch: refetchBootstrap } = useApi<BootstrapSummary>("/bootstrap");
  const { data: project, refetch: refetchProject } = useApi<{
    language: string;
    languageExplicit: boolean;
    provider: string;
    model: string;
    baseUrl: string;
  }>("/project");
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  const [ready, setReady] = useState(false);
  const initialBookId = useMemo(
    () => (typeof window === "undefined" ? undefined : resolveBookIdFromSearch(window.location.search)),
    [],
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (!bootstrapLoading && bootstrap && !bootstrap.projectInitialized) {
      setReady(true);
      setShowLanguageSelector(false);
      return;
    }
    if (bootstrap?.projectInitialized && !project) {
      setReady(false);
      return;
    }
    if (project) {
      if (!project.languageExplicit) {
        setShowLanguageSelector(true);
      }
      setReady(true);
    }
  }, [bootstrap, bootstrapLoading, project]);

  const nav: Nav = useMemo(() => ({
    toDashboard: () => {
      navigateToStudioPage("dashboard", undefined);
    },
    toBook: (bookId) => {
      navigateToStudioPage("book", { bookId });
    },
    toTruth: (bookId) => {
      navigateToStudioPage("truth", { bookId });
    },
    toBookCreate: () => {
      navigateToStudioPage("book-create");
    },
  }), []);

  if (bootstrapError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-8 text-center text-destructive">
        {bootstrapError}
      </div>
    );
  }

  if (!ready || bootstrapLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-border/30 border-t-ring rounded-full animate-spin" />
      </div>
    );
  }

  if (bootstrap && !bootstrap.projectInitialized) {
    return (
      <BootstrapView
        bootstrap={bootstrap}
        theme={theme}
        t={t}
        onInitialized={() => {
          refetchBootstrap();
          refetchProject();
        }}
      />
    );
  }

  if (showLanguageSelector) {
    return (
      <LanguageSelector
        onSelect={async (selectedLang) => {
          await postApi("/project/language", { language: selectedLang });
          setShowLanguageSelector(false);
          void refetchProject();
        }}
      />
    );
  }

  return (
    <Cockpit
      nav={nav}
      theme={theme}
      t={t}
      sse={sse}
      initialBookId={initialBookId}
    />
  );
}
