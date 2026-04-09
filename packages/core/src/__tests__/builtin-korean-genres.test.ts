import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGenreProfile } from "../models/genre-profile.js";
import { getBuiltinGenresDir } from "../agents/rules-reader.js";

describe("builtin Korean genre profiles", () => {
  it("parses newly added Korean built-in genre files", async () => {
    const builtinDir = getBuiltinGenresDir();
    const ids = ["g01", "g02", "g03", "g04", "g05", "g06", "g07"];

    for (const id of ids) {
      const raw = await readFile(join(builtinDir, `${id}.md`), "utf-8");
      const parsed = parseGenreProfile(raw);

      expect(parsed.profile.id).toBe(id);
      expect(parsed.profile.language).toBe("ko");
      expect(parsed.profile.name.length).toBeGreaterThan(0);
      expect(parsed.profile.chapterTypes.length).toBeGreaterThan(0);
      expect(parsed.profile.auditDimensions.length).toBeGreaterThan(0);
      expect(parsed.body.length).toBeGreaterThan(0);
    }
  });
});
