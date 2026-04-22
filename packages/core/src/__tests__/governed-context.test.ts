import { describe, expect, it } from "vitest";
import { buildGovernedMemoryEvidenceBlocks } from "../utils/governed-context.js";

describe("buildGovernedMemoryEvidenceBlocks", () => {
  it("renders Korean evidence headings for Korean governed prompts", () => {
    const blocks = buildGovernedMemoryEvidenceBlocks({
      chapter: 7,
      selectedContext: [
        {
          source: "story/pending_hooks.md#mentor-oath",
          reason: "Carry hook",
          excerpt: "스승의 맹세가 아직 풀리지 않았다.",
        },
        {
          source: "story/chapter_summaries.md#6",
          reason: "Recent memory",
          excerpt: "주인공이 맹세의 대가를 확인했다.",
        },
        {
          source: "story/volume_summaries.md#v1",
          reason: "Arc memory",
          excerpt: "1권은 맹세 부채를 중심으로 진행된다.",
        },
        {
          source: "story/chapter_summaries.md#recent_titles",
          reason: "Title history",
          excerpt: "5: 검은 맹세 | 6: 피의 문",
        },
        {
          source: "story/chapter_summaries.md#recent_mood_type_trail",
          reason: "Mood trail",
          excerpt: "5: 긴장 / 대치 | 6: 긴장 / 대치",
        },
        {
          source: "story/fanfic_canon.md",
          reason: "Canon",
          excerpt: "원작의 맹세 규칙은 유지한다.",
        },
      ],
    }, "ko");

    const rendered = [
      blocks.hooksBlock,
      blocks.summariesBlock,
      blocks.volumeSummariesBlock,
      blocks.titleHistoryBlock,
      blocks.moodTrailBlock,
      blocks.canonBlock,
    ].join("\n");

    expect(rendered).toContain("## 선택된 복선 근거");
    expect(rendered).toContain("## 선택된 회차 요약 근거");
    expect(rendered).toContain("## 선택된 권 요약 근거");
    expect(rendered).toContain("## 최근 제목 기록");
    expect(rendered).toContain("## 최근 감정선 / 회차 유형 흐름");
    expect(rendered).toContain("## 원작/정전 근거");
    expect(rendered).not.toContain("已选伏笔证据");
    expect(rendered).not.toContain("近期标题历史");
  });
});
