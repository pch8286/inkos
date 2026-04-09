import { describe, expect, it } from "vitest";
import { countCharacters, parseTruthMarkdown, serializeTruthMarkdown } from "./truth-editor";

describe("truth markdown parser", () => {
  it("parses sectioned markdown into editable blocks", () => {
    const source = `# 스토리 바이블\n\n## 세계관\n\n세계의 법칙은 엄격히 유지된다.\n\n## 주인공\n\n주인공은 성장한다.`;
    const parsed = parseTruthMarkdown(source);
    expect(parsed).toMatchObject({
      frontmatter: "",
      title: "스토리 바이블",
      leadText: "",
      sections: [
        { heading: "세계관", text: "세계의 법칙은 엄격히 유지된다." },
        { heading: "주인공", text: "주인공은 성장한다." },
      ],
    });
  });

  it("parses documents without subsections as a single body block", () => {
    const source = "# 작가 의도\n\n이 작품은 장기적으로 세계권력의 균형을 다룬다.\n";
    const parsed = parseTruthMarkdown(source);
    expect(parsed).toMatchObject({
      frontmatter: "",
      title: "작가 의도",
      leadText: "이 작품은 장기적으로 세계권력의 균형을 다룬다.",
      sections: [],
    });
  });

  it("parses frontmatter and markdown tables into structured sections", () => {
    const parsed = parseTruthMarkdown(
      `---\nversion: "1.0"\n---\n\n# 캐릭터 상호작용 매트릭스\n\n### 캐릭터 프로필\n\n| 캐릭터 | 핵심 태그 |\n| --- | --- |\n| 한지한 | 냉정 |\n`,
    );
    expect(parsed).toMatchObject({
      frontmatter: '---\nversion: "1.0"\n---',
      title: "캐릭터 상호작용 매트릭스",
      sections: [
        {
          heading: "캐릭터 프로필",
          headingLevel: 3,
          tableHeaders: ["캐릭터", "핵심 태그"],
          tableRows: [["한지한", "냉정"]],
        },
      ],
    });
  });

  it("serializes structured blocks back to markdown with headings and tables", () => {
    const markdown = serializeTruthMarkdown({
      frontmatter: "",
      title: "현재 포커스",
      leadText: "",
      sections: [
        {
          id: "0",
          heading: "현재 중점",
          headingLevel: 2,
          text: "회귀 후 3화에 회수를 회수한다.",
          tableHeaders: [],
          tableRows: [],
        },
        {
          id: "1",
          heading: "체크리스트",
          headingLevel: 2,
          text: "",
          tableHeaders: ["항목", "상태"],
          tableRows: [["초반 훅", "진행 중"]],
        },
      ],
    });
    expect(markdown).toBe(
      "# 현재 포커스\n\n## 현재 중점\n\n회귀 후 3화에 회수를 회수한다.\n\n## 체크리스트\n\n| 항목 | 상태 |\n| --- | --- |\n| 초반 훅 | 진행 중 |\n",
    );
  });

  it("serializes legacy plain text documents without changing to heading form", () => {
    const markdown = serializeTruthMarkdown({
      frontmatter: "",
      title: "작가 의도",
      leadText: "기본 방향을 설명한다.",
      sections: [],
    });
    expect(markdown).toBe("# 작가 의도\n\n기본 방향을 설명한다.\n");
  });

  it("counts markdown character length for editor status", () => {
    expect(countCharacters("abc")).toBe(3);
    expect(countCharacters("# 제목\n\n본문")).toBe(8);
  });
});
