import { describe, it, expect } from "vitest";
import { parseGenreProfile } from "../models/genre-profile.js";

describe("parseGenreProfile", () => {
  it("infers Korean language from frontmatter name when language is missing", () => {
    const raw = `---
name: 현대판타지
id: test-korean
chapterTypes: ["setup", "conflict"]
fatigueWords: ["반복", "중단"]
auditDimensions: [1, 2]
---
현대 판타지의 주인공이 밤을 가로질러 성채에 도착한다.`;

    const parsed = parseGenreProfile(raw);
    expect(parsed.profile.language).toBe("ko");
    expect(parsed.profile.id).toBe("test-korean");
  });

  it("keeps explicit Chinese language in frontmatter", () => {
    const raw = `---
name: 仙侠
id: test-zh
language: zh
chapterTypes: ["start", "battle"]
fatigueWords: ["修炼", "渡劫"]
auditDimensions: [3, 4]
---
이 본문은 한국어가 섞여 있지만 zh로 고정되어야 함.`;

    const parsed = parseGenreProfile(raw);
    expect(parsed.profile.language).toBe("zh");
    expect(parsed.profile.name).toBe("仙侠");
  });

  it("infers Chinese when Chinese text is present in body", () => {
    const raw = `---
name: Test
id: test-chinese-body
chapterTypes: ["start", "battle"]
fatigueWords: ["修炼"]
auditDimensions: [5]
---
这是一个中文体例的示例章节。`;

    const parsed = parseGenreProfile(raw);
    expect(parsed.profile.language).toBe("zh");
  });
});
