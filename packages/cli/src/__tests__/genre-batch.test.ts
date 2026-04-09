import { describe, expect, it } from "vitest";
import { parseGenreProfile } from "@actalk/inkos-core";
import { parseGenreBatchMarkdown, renderGenreProfileMarkdown } from "../commands/genre-batch.js";

describe("genre batch import", () => {
  it("parses Korean markdown spec blocks into genre profiles", () => {
    const raw = [
      "## G01",
      "",
      "**ID**: G01",
      "**이름**: 몬스터/이세계 전생물",
      "**Chapter Types (comma-separated)**: 탄생, 생존, 포식",
      "**Fatigue Words (comma-separated)**: 최강, 치트, 사기",
      "**Numerical 사용여부**: 제한적 사용",
      "**Power scaling 사용여부**: 사용",
      "**Era Research 사용여부**: 미사용",
      "**Pacing Rule**: 생존 이후에는 반드시 대가를 보여준다.",
      "",
      "**Rules (Markdown)**:",
      "",
      "* **기본 룰**",
      "  * 비인간 신체는 사고방식에 영향을 줘야 한다.",
      "",
      "---",
      "",
      "## G05",
      "",
      "**ID**: G05",
      "**이름**: 착각물",
      "**Chapter Types (comma-separated)**: 오독의 씨앗, 제3자 해석",
      "**Fatigue Words (comma-separated)**: 오해, 설마",
      "**Numerical 사용여부**: 미사용",
      "**Power scaling 사용여부**: 미사용",
      "**Era Research 사용여부**: 미사용",
      "**Pacing Rule**: 같은 패턴의 착각 2회 연속 금지.",
      "",
      "**Rules (Markdown)**:",
      "",
      "* **기본 룰**",
      "  * 오독은 양쪽 모두 납득 가능해야 한다.",
    ].join("\n");

    const profiles = parseGenreBatchMarkdown(raw);

    expect(profiles).toHaveLength(2);
    expect(profiles[0]).toMatchObject({
      id: "g01",
      name: "몬스터/이세계 전생물",
      chapterTypes: ["탄생", "생존", "포식"],
      fatigueWords: ["최강", "치트", "사기"],
      numericalSystem: false,
      powerScaling: true,
      eraResearch: false,
    });
    expect(profiles[0]?.body).toContain("## 메타 설정");
    expect(profiles[1]).toMatchObject({
      id: "g05",
      name: "착각물",
      numericalSystem: false,
      powerScaling: false,
      eraResearch: false,
    });
  });

  it("renders imported profiles into valid InkOS genre markdown", () => {
    const [profile] = parseGenreBatchMarkdown([
      "## G07",
      "",
      "**ID**: G07",
      "**이름**: 2차 마법 세계대전물",
      "**Chapter Types (comma-separated)**: 작전 브리핑, 공습, 시가전",
      "**Fatigue Words (comma-separated)**: 절대병기, 운명",
      "**Numerical 사용여부**: 사용",
      "**Power scaling 사용여부**: 제한적 사용",
      "**Era Research 사용여부**: 사용",
      "**Pacing Rule**: 대규모 전투 뒤에는 반드시 후방 산업을 붙인다.",
      "",
      "**Rules (Markdown)**:",
      "",
      "* **기본 룰**",
      "  * 마법은 군수 체계에 편입되어야 한다.",
    ].join("\n"));

    const rendered = renderGenreProfileMarkdown(profile!);
    const parsed = parseGenreProfile(rendered);

    expect(parsed.profile).toMatchObject({
      id: "g07",
      name: "2차 마법 세계대전물",
      language: "ko",
      numericalSystem: true,
      powerScaling: true,
      eraResearch: true,
    });
    expect(parsed.body).toContain("마법은 군수 체계에 편입되어야 한다.");
  });
});
