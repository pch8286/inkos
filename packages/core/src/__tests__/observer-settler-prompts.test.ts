import { describe, expect, it } from "vitest";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { buildObserverSystemPrompt, buildObserverUserPrompt } from "../agents/observer-prompts.js";
import { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "../agents/settler-prompts.js";

const BOOK: BookConfig = {
  id: "ko-book",
  title: "한국어 책",
  platform: "naver-series",
  genre: "modern-fantasy",
  status: "active",
  targetChapters: 80,
  chapterWordCount: 2200,
  language: "ko",
  createdAt: "2026-04-22T00:00:00.000Z",
  updatedAt: "2026-04-22T00:00:00.000Z",
};

const GENRE: GenreProfile = {
  id: "modern-fantasy",
  name: "현대판타지",
  language: "ko",
  chapterTypes: ["각성", "갈등"],
  fatigueWords: [],
  numericalSystem: false,
  powerScaling: true,
  eraResearch: false,
  pacingRule: "",
  satisfactionTypes: [],
  auditDimensions: [],
};

describe("observer and settler prompts", () => {
  it("keeps Korean observer prompts natural and fact-only", () => {
    const systemPrompt = buildObserverSystemPrompt(BOOK, GENRE, "ko");
    const userPrompt = buildObserverUserPrompt(3, "검은 문", "본문", "ko");

    expect(systemPrompt).toContain("너는 소설 사실 추출 담당자다.");
    expect(systemPrompt).not.toContain("담당자다。");
    expect(systemPrompt).toContain("명시된 동기와 추정한 동기를 구분한다");
    expect(systemPrompt).toContain("시점 인물이 모르는 정보는 정보 흐름에 기록하지 않는다");
    expect(systemPrompt).toContain("감정 변화는 표정, 행동, 대사, 선택처럼 본문에 있는 증거와 함께 적는다");
    expect(systemPrompt).toContain("새 떡밥과 기존 떡밥의 진전은 단서, 미해결 질문, 위험 변화가 드러난 문장을 근거로 기록한다");
    expect(userPrompt).toContain("제3화 \"검은 문\"에서 드러난 사실을 모두 추출하라");
  });

  it("localizes Korean settler prompts instead of falling back to Chinese", () => {
    const systemPrompt = buildSettlerSystemPrompt(BOOK, GENRE, null, "ko");
    const userPrompt = buildSettlerUserPrompt({
      chapterNumber: 3,
      title: "검은 문",
      content: "본문",
      currentState: "# 현재 상태",
      ledger: "",
      hooks: "# 복선 풀",
      chapterSummaries: "# 회차 요약",
      subplotBoard: "# 서브플롯",
      emotionalArcs: "# 감정선",
      characterMatrix: "# 인물 매트릭스",
      volumeOutline: "# 볼륨 아웃라인",
      observations: "관측 로그",
      selectedEvidenceBlock: "선택 근거",
      language: "ko",
    });

    expect(systemPrompt).toContain("너는 상태 추적 분석가다");
    expect(systemPrompt).toContain("본문에 명시된 사실과 관측 로그를 기준으로");
    expect(systemPrompt).toContain("인물의 실제 정보 경계를 유지한다");
    expect(systemPrompt).toContain("감정선과 관계 변화는 본문 속 행동, 표정, 대사, 선택의 증거가 있을 때만 갱신한다");
    expect(systemPrompt).toContain("복선 갱신은 관측 로그나 본문에서 확인되는 단서, 질문, 위험 변화, 이해 변화에 근거한다");
    expect(systemPrompt).not.toContain("你是状态追踪分析师");
    expect(systemPrompt).not.toContain("伏笔追踪规则");

    expect(userPrompt).toContain("제3화 \"검은 문\"의 본문을 분석해 모든 추적 파일을 갱신하세요.");
    expect(userPrompt).toContain("## 관측 로그");
    expect(userPrompt).toContain("## 현재 상태 카드");
    expect(userPrompt).toContain("## 현재 복선 풀");
    expect(userPrompt).not.toContain("请分析第3章");
    expect(userPrompt).not.toContain("## 当前状态卡");
  });
});
