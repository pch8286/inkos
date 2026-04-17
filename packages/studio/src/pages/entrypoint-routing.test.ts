import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function loadSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const dashboardSource = loadSource("./Dashboard.tsx");
const sidebarSource = loadSource("../components/Sidebar.tsx");
const cockpitSource = loadSource("./Cockpit.tsx");
const appSource = loadSource("../App.tsx");
const bookCreateSource = loadSource("./BookCreate.tsx");
const cockpitMainSource = loadSource("../cockpit-main.tsx");
const cockpitStandaloneSource = loadSource("../CockpitStandaloneApp.tsx");
const cockpitIndexSource = loadSource("../../cockpit/index.html");
const i18nSource = loadSource("../hooks/use-i18n.ts");

describe("entrypoint wiring in source", () => {
  it("routes dashboard new-book calls to cockpit navigation", () => {
    expect(dashboardSource).toContain("onClick={nav.toCockpit}");
    expect(dashboardSource).toContain('t("nav.openCockpit")');
    expect(dashboardSource).toContain('title={t("dash.quickStepCockpit")}');
    expect(dashboardSource).not.toContain("onClick={nav.toBookCreate}");
  });

  it("points sidebar quick create affordance to cockpit", () => {
    expect(sidebarSource).toContain("onClick={nav.toCockpit}");
    expect(sidebarSource).toContain('title={t("nav.openCockpit")}');
    expect(sidebarSource).not.toContain("onClick={nav.toBookCreate}");
    expect(sidebarSource).toContain('label={t("nav.cockpit")}');
  });

  it("marks legacy book creation path and keeps create page secondary", () => {
    expect(cockpitSource).toContain('label={t("cockpit.legacyCreate")}');
    expect(cockpitSource).toContain("nav.toBookCreate?.()");
    expect(bookCreateSource).toContain('t("create.legacyTitle")');
    expect(bookCreateSource).toContain('t("bread.legacyCreate")');
    expect(bookCreateSource).toContain('t("create.legacySubmit")');
  });

  it("adds new copy keys for cockpit-first entry and legacy creation labels", () => {
    const expectedKeys = [
      "\"nav.openCockpit\"",
      "\"dash.quickStepCockpit\"",
      "\"create.legacyTitle\"",
      "\"bread.legacyCreate\"",
      "\"create.legacySubmit\"",
      "\"cockpit.legacyCreate\"",
    ];

    for (const key of expectedKeys) {
      expect(i18nSource).toContain(key);
    }
  });

  it("keeps Cockpit independent of importing BookCreate module", () => {
    expect(cockpitSource).not.toContain('from "./BookCreate"');
  });

  it("adds a dedicated cockpit frontend entry", () => {
    expect(cockpitMainSource).toContain("CockpitStandaloneApp");
    expect(cockpitIndexSource).toContain("/src/cockpit-main.tsx");
    expect(cockpitIndexSource).toContain("<title");
  });

  it("builds CockpitStandaloneApp without importing App, Sidebar, or ChatPanel", () => {
    expect(cockpitStandaloneSource).not.toContain('from "./App"');
    expect(cockpitStandaloneSource).not.toContain("from \"./components/Sidebar\"");
    expect(cockpitStandaloneSource).not.toContain("from \"./components/ChatBar\"");
    expect(cockpitStandaloneSource).not.toContain("<Sidebar");
    expect(cockpitStandaloneSource).not.toContain("<ChatPanel");
  });

  it("wires cockpit entry to pass URL bookId into Cockpit", () => {
    expect(cockpitStandaloneSource).toContain("resolveBookIdFromSearch");
    expect(cockpitStandaloneSource).toContain("initialBookId={initialBookId}");
    expect(cockpitStandaloneSource).toContain("window.location.search");
    expect(cockpitStandaloneSource).toContain("<Cockpit");
  });

  it("keeps the legacy cockpit route as a redirect instead of rendering embedded cockpit UI", () => {
    expect(appSource).not.toContain('from "./pages/Cockpit"');
    expect(appSource).toContain("function LegacyCockpitRedirect");
    expect(appSource).toContain("window.location.replace(");
    expect(appSource).toContain("window.location.assign(");
    expect(appSource).toContain("buildStandaloneCockpitUrl(");
    expect(appSource).not.toContain('{route.page === "cockpit" && <Cockpit');
  });
});
