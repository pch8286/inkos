import { describe, expect, it } from "vitest";
import {
  buildTruthAliases,
  computeTruthMentions,
  mergeInterviewAnswerIntoAlignmentContext,
  mergeInterviewAnswerIntoAlignmentDraft,
} from "./truth-workspace";

describe("buildTruthAliases", () => {
  it("uses label, title, filename, and headings without duplicates", () => {
    expect(buildTruthAliases({
      name: "author_intent.md",
      label: "작가 의도",
      title: "작가 의도",
      sectionHeadings: ["통치 원칙", "통치 원칙"],
    })).toEqual(["작가 의도", "author intent", "통치 원칙"]);
  });
});

describe("mergeInterviewAnswerIntoAlignmentDraft", () => {
  it("moves answered uncertainty into known facts and clears the first question", () => {
    expect(mergeInterviewAnswerIntoAlignmentDraft({
      knownFacts: "왕권과 제도의 충돌을 다룬다.",
      unknowns: "주인공의 통치 원칙이 흐리다.",
      mustDecide: "",
      askFirst: "주인공의 통치 원칙은 무엇인가?",
    }, {
      question: "주인공의 통치 원칙은 무엇인가?",
      answer: "질서를 지키되 통치 비용을 숨기지 않는다.",
    })).toEqual({
      knownFacts: "왕권과 제도의 충돌을 다룬다.\n질서를 지키되 통치 비용을 숨기지 않는다.",
      unknowns: "",
      mustDecide: "질서를 지키되 통치 비용을 숨기지 않는다.",
      askFirst: "",
    });
  });

  it("also updates mustDecide for decision-oriented questions", () => {
    expect(mergeInterviewAnswerIntoAlignmentContext({
      knownFacts: ["왕권과 제도의 충돌을 다룬다."],
      unknowns: ["작품의 통치 기준이 흐리다."],
      mustDecide: "",
      askFirst: "이번 문서에서 통치 기준은 무엇이어야 하나?",
    }, {
      question: "이번 문서에서 통치 기준은 무엇이어야 하나?",
      answer: "질서를 유지하되 비용과 균열을 반드시 드러낸다.",
    })).toEqual({
      knownFacts: ["왕권과 제도의 충돌을 다룬다.", "질서를 유지하되 비용과 균열을 반드시 드러낸다."],
      unknowns: [],
      mustDecide: "질서를 유지하되 비용과 균열을 반드시 드러낸다.",
      askFirst: "",
    });
  });
});

describe("computeTruthMentions", () => {
  it("finds outgoing mentions and backlinks from binder content", () => {
    expect(computeTruthMentions({
      selectedFileName: "author_intent.md",
      selectedLabel: "작가 의도",
      selectedTitle: "작가 의도",
      selectedHeadings: ["통치 원칙"],
      files: [
        { name: "author_intent.md", label: "작가 의도" },
        { name: "current_focus.md", label: "현재 포커스" },
        { name: "story_bible.md", label: "스토리 바이블" },
      ],
      contentByFile: {
        "author_intent.md": "이번 권은 현재 포커스와 스토리 바이블을 함께 정렬한다.",
        "current_focus.md": "작가 의도에 맞춰 귀족 의회를 압박한다.",
        "story_bible.md": "마왕국은 이동하지 않는다.",
      },
    })).toEqual({
      outgoing: [
        {
          fileName: "story_bible.md",
          label: "스토리 바이블",
          matches: ["스토리 바이블"],
          excerpt: "이번 권은 현재 포커스와 스토리 바이블을 함께 정렬한다.",
        },
        {
          fileName: "current_focus.md",
          label: "현재 포커스",
          matches: ["현재 포커스"],
          excerpt: "이번 권은 현재 포커스와 스토리 바이블을 함께 정렬한다.",
        },
      ],
      backlinks: [
        {
          fileName: "current_focus.md",
          label: "현재 포커스",
          matches: ["작가 의도"],
          excerpt: "작가 의도에 맞춰 귀족 의회를 압박한다.",
        },
      ],
    });
  });
});
