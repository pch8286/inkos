import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";

type AppModule = typeof import("./App");
type RuntimeNav = { toCockpit: (bookId?: string) => void };

let appModule: AppModule;

beforeAll(async () => {
  appModule = await import("./App");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

function renderNode(node: unknown): void {
  if (node == null || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      renderNode(child);
    }
    return;
  }

  if (typeof node === "object" && "type" in node && "props" in node) {
    const element = node as {
      readonly type: unknown;
      readonly props: {
        readonly children?: unknown;
      };
    };

    if (typeof element.type === "function") {
      renderNode(element.type(element.props));
      return;
    }

    renderNode(element.props.children);
  }
}

function renderComponent(Component: () => unknown): void {
  renderNode({ type: Component, props: {} });
}

async function loadRuntimeApp(options: {
  readonly pathname: string;
  readonly search: string;
  readonly ready?: boolean;
}): Promise<{
  readonly App: AppModule["App"];
  readonly assignSpy: ReturnType<typeof vi.fn>;
  readonly replaceSpy: ReturnType<typeof vi.fn>;
  readonly routeSetter: ReturnType<typeof vi.fn>;
  readonly capturedNav: () => RuntimeNav | undefined;
}> {
  vi.resetModules();

  let callIndex = 0;
  let sidebarNav: RuntimeNav | undefined;

  const replaceSpy = vi.fn();
  const assignSpy = vi.fn();
  const routeSetter = vi.fn();
  const ready = options.ready ?? false;

  const windowMock = {
    location: {
      pathname: options.pathname,
      search: options.search,
      hash: "",
      replace: replaceSpy,
      assign: assignSpy,
    },
    history: {
      replaceState: vi.fn(),
    },
    innerWidth: 1440,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const documentMock = {
    documentElement: {
      classList: {
        toggle: vi.fn(),
      },
      lang: "en",
    },
    body: {
      style: {
        cursor: "",
        userSelect: "",
      },
    },
  };

  vi.stubGlobal("window", windowMock);
  vi.stubGlobal("document", documentMock);

  vi.doMock("react", async () => {
    const actual = await vi.importActual<typeof import("react")>("react");

    return {
      ...actual,
      useState: (initial: unknown) => {
        const stateIndex = callIndex++;
        const setter = stateIndex === 0 ? routeSetter : vi.fn();
        const resolvedInitial = typeof initial === "function" ? initial() : initial;
        const value = stateIndex === 2 ? ready : resolvedInitial;
        return [value, setter];
      },
      useEffect: (effect: () => void | (() => void)) => {
        effect();
      },
      useMemo: <T,>(factory: () => T) => factory(),
      useRef: <T,>(value: T) => ({ current: value }),
    };
  });

  const NullComponent = () => null;

  vi.doMock("./components/Sidebar", () => ({
    Sidebar: ({ nav }: { readonly nav: RuntimeNav }) => {
      sidebarNav = nav;
      return null;
    },
  }));
  vi.doMock("./components/ChatBar", () => ({ ChatPanel: NullComponent }));
  vi.doMock("./pages/Dashboard", () => ({ Dashboard: NullComponent }));
  vi.doMock("./pages/BootstrapView", () => ({ BootstrapView: NullComponent }));
  vi.doMock("./pages/BookDetail", () => ({ BookDetail: NullComponent }));
  vi.doMock("./pages/BookCreate", () => ({ BookCreate: NullComponent }));
  vi.doMock("./pages/ChapterReader", () => ({ ChapterReader: NullComponent }));
  vi.doMock("./pages/Analytics", () => ({ Analytics: NullComponent }));
  vi.doMock("./pages/ConfigView", () => ({ ConfigView: NullComponent }));
  vi.doMock("./pages/TruthFiles", () => ({ TruthFiles: NullComponent }));
  vi.doMock("./pages/DaemonControl", () => ({ DaemonControl: NullComponent }));
  vi.doMock("./pages/LogViewer", () => ({ LogViewer: NullComponent }));
  vi.doMock("./pages/GenreManager", () => ({ GenreManager: NullComponent }));
  vi.doMock("./pages/StyleManager", () => ({ StyleManager: NullComponent }));
  vi.doMock("./pages/ImportManager", () => ({ ImportManager: NullComponent }));
  vi.doMock("./pages/RadarView", () => ({ RadarView: NullComponent }));
  vi.doMock("./pages/DoctorView", () => ({ DoctorView: NullComponent }));
  vi.doMock("./pages/LanguageSelector", () => ({ LanguageSelector: NullComponent }));
  vi.doMock("./hooks/use-sse", () => ({
    useSSE: () => ({ messages: [] }),
  }));
  vi.doMock("./hooks/use-theme", () => ({
    useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
  }));
  vi.doMock("./hooks/use-i18n", () => ({
    useI18n: () => ({ t: (key: string) => key, lang: "en" }),
  }));
  vi.doMock("./hooks/use-api", () => ({
    postApi: vi.fn(),
    useApi: (path: string) => {
      if (path === "/bootstrap") {
        return {
          data: {
            root: "/tmp/demo",
            suggestedProjectName: "demo",
            projectInitialized: true,
            globalConfig: {
              exists: true,
              language: "en",
              provider: "codex-cli",
              model: "gpt-5.4",
              baseUrl: "",
              apiKeySet: false,
              auth: {
                geminiCli: {
                  available: true,
                  authenticated: true,
                  credentialPath: "~/.gemini",
                  command: "gemini",
                },
                codexCli: {
                  available: true,
                  authenticated: true,
                  credentialPath: "~/.codex",
                  command: "codex",
                },
              },
            },
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      if (path === "/project") {
        return {
          data: {
            language: "en",
            languageExplicit: true,
            provider: "codex-cli",
            model: "gpt-5.4",
            baseUrl: "",
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      if (path === "/activity") {
        return {
          data: { entries: [] },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      return {
        data: null,
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    },
  }));
  vi.doMock("./shared/activity-feed", () => ({
    buildActivityFeedEntries: () => [],
  }));
  vi.doMock("./shared/llm", () => ({
    compactModelLabel: () => "gpt-5.4",
    defaultModelForProvider: () => "gpt-5.4",
    labelForProvider: () => "Codex CLI",
    shortLabelForProvider: () => "COD",
  }));
  vi.doMock("./shared/browser-storage", () => ({
    getBrowserStorage: () => undefined,
    readBrowserJson: () => null,
    writeBrowserJson: vi.fn(),
  }));
  vi.doMock("lucide-react", () => ({
    Sun: NullComponent,
    Moon: NullComponent,
    Bell: NullComponent,
    MessageSquare: NullComponent,
    PanelLeftOpen: NullComponent,
    SlidersHorizontal: NullComponent,
  }));

  const runtimeApp = await import("./App");

  return {
    App: runtimeApp.App,
    assignSpy,
    replaceSpy,
    routeSetter,
    capturedNav: () => sidebarNav,
  };
}

describe("route search helpers", () => {
  it("parses cockpit route without a selected book", () => {
    expect(appModule.parseRouteFromSearch("?page=cockpit")).toEqual({ page: "cockpit" });
  });

  it("parses cockpit route with a selected book", () => {
    expect(appModule.parseRouteFromSearch("?page=cockpit&bookId=alpha")).toEqual({
      page: "cockpit",
      bookId: "alpha",
    });
  });

  it("serializes cockpit routes into query strings", () => {
    expect(appModule.buildRouteSearch({ page: "cockpit", bookId: "alpha" })).toBe("?page=cockpit&bookId=alpha");
    expect(appModule.buildRouteSearch({ page: "dashboard" })).toBe("");
  });
});

describe("legacy cockpit redirect", () => {
  it("builds a standalone cockpit redirect for the legacy cockpit route", () => {
    expect(appModule.buildLegacyCockpitRedirectUrl("/", { page: "cockpit", bookId: "alpha" }))
      .toBe("/cockpit/?bookId=alpha");
  });

  it("returns null for normal studio routes", () => {
    expect(appModule.buildLegacyCockpitRedirectUrl("/tenant-a/", { page: "dashboard" })).toBeNull();
  });
});

describe("App runtime cockpit navigation", () => {
  it("redirects legacy cockpit query routes to the standalone cockpit entrypoint", async () => {
    const { App, replaceSpy } = await loadRuntimeApp({
      pathname: "/tenant-a/",
      search: "?page=cockpit&bookId=alpha",
    });

    renderComponent(App);

    expect(replaceSpy).toHaveBeenCalledWith("/tenant-a/cockpit/?bookId=alpha");
  });

  it("navigates Studio shell cockpit actions with window.location.assign", async () => {
    const { App, assignSpy, routeSetter, capturedNav } = await loadRuntimeApp({
      pathname: "/tenant-a/",
      search: "",
      ready: true,
    });

    renderComponent(App);
    capturedNav()?.toCockpit("beta");

    expect(assignSpy).toHaveBeenCalledWith("/tenant-a/cockpit/?bookId=beta");
    expect(routeSetter).not.toHaveBeenCalled();
  });
});

describe("deriveActiveBookId", () => {
  it("returns the current book across book-centered routes", () => {
    expect(appModule.deriveActiveBookId({ page: "cockpit", bookId: "alpha" })).toBe("alpha");
    expect(appModule.deriveActiveBookId({ page: "book", bookId: "alpha" })).toBe("alpha");
    expect(appModule.deriveActiveBookId({ page: "chapter", bookId: "beta", chapterNumber: 3 })).toBe("beta");
    expect(appModule.deriveActiveBookId({ page: "truth", bookId: "gamma" })).toBe("gamma");
    expect(appModule.deriveActiveBookId({ page: "analytics", bookId: "delta" })).toBe("delta");
  });

  it("returns undefined for non-book routes", () => {
    expect(appModule.deriveActiveBookId({ page: "dashboard" })).toBeUndefined();
    expect(appModule.deriveActiveBookId({ page: "config" })).toBeUndefined();
    expect(appModule.deriveActiveBookId({ page: "style" })).toBeUndefined();
  });
});

describe("deriveActiveLlm", () => {
  it("prefers the initialized project's active provider/model", () => {
    expect(appModule.deriveActiveLlm(
      {
        root: "/tmp/demo",
        suggestedProjectName: "demo",
        projectInitialized: true,
        globalConfig: {
          exists: true,
          language: "ko",
          provider: "gemini-cli",
          model: "gemini-2.5-pro",
          baseUrl: "",
          apiKeySet: false,
          auth: {
            geminiCli: { available: true, authenticated: true, credentialPath: "~/.gemini", command: "gemini" },
            codexCli: { available: true, authenticated: true, credentialPath: "~/.codex", command: "codex" },
          },
        },
      },
      { language: "ko", languageExplicit: true, provider: "codex-cli", model: "gpt-5.4", baseUrl: "" },
    )).toEqual({
      provider: "codex-cli",
      model: "gpt-5.4",
      source: "project",
    });
  });

  it("falls back to global defaults before project initialization", () => {
    expect(appModule.deriveActiveLlm(
      {
        root: "/tmp/demo",
        suggestedProjectName: "demo",
        projectInitialized: false,
        globalConfig: {
          exists: true,
          language: "ko",
          provider: "gemini-cli",
          model: "auto-gemini-3",
          baseUrl: "",
          apiKeySet: false,
          auth: {
            geminiCli: { available: true, authenticated: true, credentialPath: "~/.gemini", command: "gemini" },
            codexCli: { available: true, authenticated: true, credentialPath: "~/.codex", command: "codex" },
          },
        },
      },
      undefined,
    )).toEqual({
      provider: "gemini-cli",
      model: "auto-gemini-3",
      source: "global",
    });
  });
});

describe("header alerts", () => {
  it("counts unread actionable SSE events and ignores ping/progress noise", () => {
    const messages = [
      { event: "ping", data: null, timestamp: 100 },
      { event: "log", data: { message: "noise" }, timestamp: 105 },
      { event: "llm:progress", data: { phase: "write" }, timestamp: 110 },
      { event: "write:start", data: { bookId: "alpha" }, timestamp: 120 },
      { event: "write:complete", data: { bookId: "alpha" }, timestamp: 140 },
    ];

    expect(appModule.deriveUnreadAlertCount(messages, 0)).toBe(2);
    expect(appModule.deriveUnreadAlertCount(messages, 125)).toBe(1);
  });

  it("tracks the latest actionable event timestamp", () => {
    const messages = [
      { event: "ping", data: null, timestamp: 100 },
      { event: "log", data: { message: "Started" }, timestamp: 155 },
      { event: "llm:progress", data: { phase: "audit" }, timestamp: 180 },
      { event: "audit:complete", data: { bookId: "alpha" }, timestamp: 210 },
    ];

    expect(appModule.deriveLatestAlertTimestamp(messages)).toBe(210);
  });
});

describe("assistant pane sizing", () => {
  it("clamps pane widths by mode and viewport", () => {
    expect(appModule.clampAssistantPaneWidth(200, { viewportWidth: 1440 })).toBe(320);
    expect(appModule.clampAssistantPaneWidth(900, { viewportWidth: 1440 })).toBe(560);
    expect(appModule.clampAssistantPaneWidth(900, { truthMode: true, viewportWidth: 1440 })).toBe(760);
    expect(appModule.clampAssistantPaneWidth(900, { truthMode: true, viewportWidth: 700 })).toBe(652);
  });

  it("fills missing stored widths with defaults", () => {
    expect(appModule.resolveAssistantPaneWidths({ general: 430 }, 1440)).toEqual({
      general: 430,
      truth: 540,
    });
  });
});
