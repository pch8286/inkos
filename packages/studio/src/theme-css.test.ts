import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "index.css"), "utf-8");

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
});
