import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "index.css"), "utf-8");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("studio theme css", () => {
  it("does not force the studio shell and cockpit page to dark tokens outside dark mode", () => {
    expect(css).not.toMatch(/\.studio-shell,\s*\.studio-cockpit-page\s*\{[^}]*--background/s);
    expect(css).toMatch(/\.dark\s+\.studio-shell,\s*\.dark\s+\.studio-cockpit-page\s*\{[^}]*--background/s);
  });

  it("keeps light and dark palettes grounded in separate low-glare references", () => {
    expect(css).toContain("#f6f8fa");
    expect(css).toContain("#1f2328");
    expect(css).toContain("#1e2227");
    expect(css).toContain("#abb2bf");
  });

  it("uses subdued dark-mode action and reader preview surfaces", () => {
    expect(css).toMatch(/\.dark\s*\{[^}]*--studio-cta-start:\s*#3f5f4a;[^}]*--studio-cta-end:\s*#2f5663;[^}]*--studio-cta-text:\s*#f8f8f2;/s);
    expect(css).toMatch(/\.dark\s+\.book-workspace-preview-main\s+\.paper-sheet\s*\{[^}]*background:\s*#242932;[^}]*color:\s*#c8ccd4;/s);
  });

  it("keeps Korean fallbacks in cockpit monospace surfaces", () => {
    expect(css).toMatch(/html:lang\(ko\)\s*\{[^}]*--font-mono:\s*system-ui,[^;]*'Noto Sans KR'[^;]*'Apple SD Gothic Neo'[^;]*'Malgun Gothic'/s);
    expect(css).toMatch(/\.studio-cockpit-work-log\s*\{[^}]*font-family:\s*var\(--font-mono\);/s);
    expect(css).toMatch(/\.studio-command-chip\s*\{[^}]*font-family:\s*var\(--font-mono\);/s);
  });

  it("uses theme-aware cockpit surface tints instead of darkening light mode with black", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--studio-cockpit-chrome:\s*#f6f8fa;[^}]*--studio-cockpit-field:\s*#ffffff;/s);
    expect(css).toMatch(/\.dark\s*\{[^}]*--studio-cockpit-chrome:\s*#111418;[^}]*--studio-cockpit-field:\s*#171b20;/s);

    expect(css).toMatch(/\.studio-cockpit-select-chip,\s*\.studio-cockpit-search\s*\{[^}]*var\(--studio-cockpit-(?:chrome|field)\)/s);

    for (const selector of [
      ".studio-cockpit-shell",
      ".studio-cockpit-commandline-input",
      ".studio-cockpit-left",
      ".studio-cockpit-right",
      ".studio-cockpit-log",
      ".studio-cockpit-composer",
      ".studio-cockpit-system-dots button",
    ]) {
      expect(css).toMatch(new RegExp(`${escapeRegExp(selector)}\\s*\\{[^}]*var\\(--studio-cockpit-(?:chrome|field)\\)`, "s"));
    }
  });

  it("right-aligns user cockpit messages in normal block flow", () => {
    expect(css).toMatch(/\.studio-cockpit-message\.is-user\s*\{[^}]*margin-left:\s*auto;/s);
  });
});
