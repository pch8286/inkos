import { describe, it, expect } from "vitest";
import { analyzeAITells } from "../agents/ai-tells.js";

describe("analyzeAITells", () => {
  it("returns no issues for varied paragraph lengths", () => {
    const content = [
      "短段。",
      "",
      "这是一个中等长度的段落，包含一些描述性的内容，让这个段落稍微长一些。",
      "",
      "很长的段落。这个段落包含了大量的内容，描述了各种各样的场景和人物。角色们在这里进行了激烈的讨论，关于未来的计划和当前的困境。他们需要找到一种方式来解决眼前的问题。",
    ].join("\n");

    const result = analyzeAITells(content);
    const paraIssues = result.issues.filter((i) => i.category === "段落等长");
    expect(paraIssues).toHaveLength(0);
  });

  it("detects uniform paragraph lengths (dim 20)", () => {
    // Generate paragraphs of nearly identical length
    const para = "这是一个测试段落的内容，长度大约相同。";
    const content = [para, "", para, "", para, "", para].join("\n");

    const result = analyzeAITells(content);
    const paraIssues = result.issues.filter((i) => i.category === "段落等长");
    expect(paraIssues.length).toBeGreaterThan(0);
    expect(paraIssues[0]!.severity).toBe("warning");
  });

  it("detects Korean hedge density with warning", () => {
    const content = Array.from({ length: 20 }, () => "그는 어쩌면 마치 그 순간의 그림자를 더듬어 보았다. ")
      .join("");

    const result = analyzeAITells(content);
    const hedgeIssues = result.issues.filter((i) => i.category === "완곡어 밀도");
    expect(hedgeIssues.length).toBeGreaterThan(0);
  });

  it("detects high hedge word density (dim 21)", () => {
    const content = [
      "他似乎觉得这件事可能不太对劲。",
      "",
      "或许他应该大概去看看。似乎有什么东西在那里。",
      "",
      "可能是一种错觉，大概只是风声。某种程度上他也不太确定。",
    ].join("\n");

    const result = analyzeAITells(content);
    const hedgeIssues = result.issues.filter((i) => i.category === "套话密度");
    expect(hedgeIssues.length).toBeGreaterThan(0);
  });

  it("detects formulaic transition repetition (dim 22)", () => {
    const content = [
      "第一段内容。然而事情并不简单。",
      "",
      "第二段内容。然而他没有放弃。",
      "",
      "第三段内容。然而命运弄人。",
    ].join("\n");

    const result = analyzeAITells(content);
    const transIssues = result.issues.filter((i) => i.category === "公式化转折");
    expect(transIssues.length).toBeGreaterThan(0);
    expect(transIssues[0]!.description).toContain("然而");
  });

  it("detects list-like sentence structure (dim 23)", () => {
    const content = [
      "他看着远方的山峰。他看着脚下的深渊。他看着身旁的同伴。他看着手中的剑。",
    ].join("\n");

    const result = analyzeAITells(content);
    const listIssues = result.issues.filter((i) => i.category === "列表式结构");
    expect(listIssues.length).toBeGreaterThan(0);
    expect(listIssues[0]!.severity).toBe("info");
  });

  it("detects Korean list-like sentence structure (dim 23)", () => {
    const content = [
      "그는 바닥을 천천히 확인했다.",
      "그는 창문을 향해 한 발짝 다가갔다.",
      "그는 어둠 속의 실루엣을 바라봤다.",
      "그는 손끝의 떨림을 참고 칼자루를 움켜쥐었다.",
    ].join("\n");

    const result = analyzeAITells(content);
    const listIssues = result.issues.filter((i) => i.category === "목록형 문장 구조");
    expect(listIssues.length).toBeGreaterThan(0);
  });

  it("detects Korean abstract triad cadence", () => {
    const content = [
      "죽었거나, 들어왔거나, 빙의했거나.",
      "",
      "발화, 기록, 집행.",
      "",
      "그 세 가지가 맞물리면 현실이 된다.",
    ].join("\n");

    const result = analyzeAITells(content, "ko");
    const triadIssues = result.issues.filter((i) => i.category === "추상 삼단 리듬");
    expect(triadIssues.length).toBeGreaterThan(0);
    expect(triadIssues[0]!.suggestion).toContain("인물의 행동");
  });

  it("detects repeated Korean negative abstraction", () => {
    const content = [
      "이 몸은 그냥 강한 몸이 아니다.",
      "그 반응은 착각이 아니었다.",
      "그건 선택이 아니라 판결이었다.",
    ].join("\n");

    const result = analyzeAITells(content, "ko");
    const negativeIssues = result.issues.filter((i) => i.category === "부정 병렬 추상화");
    expect(negativeIssues.length).toBeGreaterThan(0);
    expect(negativeIssues[0]!.suggestion).toContain("눈에 보이는 차이");
  });

  it("detects Korean scene-note fragments leaking into prose", () => {
    const content = [
      "몸.",
      "장소.",
      "주변 반응.",
      "적대 여부.",
    ].join("\n");

    const result = analyzeAITells(content, "ko");
    const checklistIssues = result.issues.filter((i) => i.category === "메모식 장면 체크리스트");
    expect(checklistIssues.length).toBeGreaterThan(0);
    expect(checklistIssues[0]!.suggestion).toContain("작법 메모처럼 나누지 말고");
  });

  it("detects dense Korean adverb stacking", () => {
    const content = [
      "그는 갑자기 빠르게 고개를 들고 조용히 뒤로 물러났다.",
      "그녀는 천천히 조심스럽게 문을 열고 완전히 안쪽으로 들어갔다.",
      "병사는 분명히 크게 놀라며 바로 검을 뽑았다.",
    ].join("\n");

    const result = analyzeAITells(content, "ko");
    const adverbIssues = result.issues.filter((i) => i.category === "부사 과밀");
    expect(adverbIssues.length).toBeGreaterThan(0);
    expect(adverbIssues[0]!.suggestion).toContain("부사를 먼저 지우고");
  });

  it("detects retrospective Korean closing declarations", () => {
    const content = [
      "카르세리온은 왕좌 아래 선 신하들을 내려다보았다.",
      "그리고 나는 방금, 마왕의 이름으로 첫 수를 두었다.",
    ].join("\n");

    const result = analyzeAITells(content, "ko");
    const closingIssues = result.issues.filter((i) => i.category === "선언형 클로징");
    expect(closingIssues.length).toBeGreaterThan(0);
    expect(closingIssues[0]!.suggestion).toContain("마지막 행동");
  });

  it("detects AI-like Korean stock sensory metaphors", () => {
    const content = [
      "문틈 너머에서 누군가 웃었다.",
      "어린아이처럼 얇은 소리였는데, 그 안에 쇠 긁는 울림이 섞여 있었다.",
      "도윤은 문고리에서 손을 떼지 못했다.",
    ].join("\n");

    const result = analyzeAITells(content, "ko");
    const sensoryIssues = result.issues.filter((i) => i.category === "AI식 감각 비유");
    expect(sensoryIssues.length).toBeGreaterThan(0);
    expect(sensoryIssues[0]!.description).toContain("쇠 긁는 울림");
    expect(sensoryIssues[0]!.suggestion).toContain("장면 안 원인");
  });

  it("detects Korean one-beat paragraph fragmentation", () => {
    const content = [
      "도윤은 구조 요청 버튼 위에 엄지를 올렸다.",
      "",
      "03:58.",
      "",
      "임시 파티장 권한.",
      "",
      "대답은 없었다.",
      "",
      "낡은 사진이었다.",
      "",
      "서도윤.",
      "",
      "문 너머에서 손잡이가 내려갔다.",
    ].join("\n");

    const result = analyzeAITells(content, "ko");
    const paragraphIssues = result.issues.filter((i) => i.category === "문단 과분할");
    expect(paragraphIssues.length).toBeGreaterThan(0);
    expect(paragraphIssues[0]!.suggestion).toContain("행동-관찰-반응");
  });

  it("detects Korean prop meaning exposition", () => {
    const content = [
      "도윤은 호출 버튼에서 손을 뗐다.",
      "허리춤의 접이식 단검을 펴자, 손잡이의 낡은 고무가 손바닥에 달라붙었다.",
      "훈련장 지급품이었다. 몬스터를 베기보다, 겁먹은 사람 앞에서 헌터처럼 보이게 만드는 물건.",
    ].join("\n");

    const result = analyzeAITells(content, "ko");
    const propIssues = result.issues.filter((i) => i.category === "소품 의미 해설");
    expect(propIssues.length).toBeGreaterThan(0);
    expect(propIssues[0]!.suggestion).toContain("사용 방식");
    expect(propIssues[0]!.suggestion).toContain("상대 반응");
  });

  it("returns no issues for content with fewer than 3 paragraphs", () => {
    const content = "只有一段话。";
    const result = analyzeAITells(content);
    expect(result.issues).toHaveLength(0);
  });

  it("returns no issues for clean varied text", () => {
    const content = [
      "陈风一脚踩碎了脚下的石板。碎石飞溅，打在旁边的墙壁上发出清脆的声响。",
      "",
      "短暂的沉默。空气中弥漫着灰尘的味道，呛得他咳嗽了两声。远处传来脚步声。",
      "",
      "\"谁？\"他低喝一声，手已经按上了腰间的刀柄。指尖触到冰凉的金属，心跳稍微稳了一些。黑暗中，一双眼睛正盯着他。那目光冰冷得像冬夜的寒风，带着审视和一丝不易察觉的警惕。",
    ].join("\n");

    const result = analyzeAITells(content);
    // Should have no or few issues for natural-looking text
    const warningIssues = result.issues.filter((i) => i.severity === "warning");
    expect(warningIssues).toHaveLength(0);
  });
});
