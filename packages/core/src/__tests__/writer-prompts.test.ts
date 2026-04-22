import { describe, expect, it } from "vitest";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { LengthSpecSchema } from "../models/length-governance.js";
import { buildWriterSystemPrompt } from "../agents/writer-prompts.js";

const BOOK: BookConfig = {
  id: "prompt-book",
  title: "Prompt Book",
  platform: "tomato",
  genre: "other",
  status: "active",
  targetChapters: 20,
  chapterWordCount: 3000,
  createdAt: "2026-03-22T00:00:00.000Z",
  updatedAt: "2026-03-22T00:00:00.000Z",
};

const GENRE: GenreProfile = {
  id: "other",
  name: "综合",
  language: "zh",
  chapterTypes: ["setup", "conflict"],
  fatigueWords: [],
  numericalSystem: false,
  powerScaling: false,
  eraResearch: false,
  pacingRule: "",
  satisfactionTypes: [],
  auditDimensions: [],
};

describe("buildWriterSystemPrompt", () => {
  it("demotes always-on methodology blocks in governed mode", () => {
    const prompt = buildWriterSystemPrompt(
      BOOK,
      GENRE,
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "zh",
      "governed",
    );

    expect(prompt).toContain("## 输入治理契约");
    expect(prompt).toContain("卷纲是默认规划");
    expect(prompt).not.toContain("## 六步走人物心理分析");
    expect(prompt).not.toContain("## 读者心理学框架");
    expect(prompt).not.toContain("## 黄金三章规则");
  });

  it("uses target-range wording when a length spec is provided", () => {
    const lengthSpec = LengthSpecSchema.parse({
      target: 2200,
      softMin: 1900,
      softMax: 2500,
      hardMin: 1600,
      hardMax: 2800,
      countingMode: "zh_chars",
      normalizeMode: "none",
    });

    const prompt = buildWriterSystemPrompt(
      BOOK,
      GENRE,
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "zh",
      "governed",
      lengthSpec,
    );

    expect(prompt).toContain("目标字数：2200");
    expect(prompt).toContain("允许区间：1900-2500");
    expect(prompt).not.toContain("正文不少于2200字");
  });

  it("keeps creative writer output focused on title and prose only", () => {
    const prompt = buildWriterSystemPrompt(
      BOOK,
      GENRE,
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "zh",
      "governed",
    );

    expect(prompt).toContain("=== CHAPTER_TITLE ===");
    expect(prompt).toContain("=== CHAPTER_CONTENT ===");
    expect(prompt).not.toContain("=== PRE_WRITE_CHECK ===");
    expect(prompt).not.toContain("POST_SETTLEMENT");
    expect(prompt).toContain("Planner/Composer");
    expect(prompt).toContain("只输出 CHAPTER_TITLE 和 CHAPTER_CONTENT");
  });

  it("keeps hard guardrails and book/style constraints in governed mode", () => {
    const prompt = buildWriterSystemPrompt(
      BOOK,
      GENRE,
      null,
      "# Book Rules\n\n- Do not reveal the mastermind.",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "zh",
      "governed",
    );

    expect(prompt).toContain("## 核心规则");
    expect(prompt).toContain("## 硬性禁令");
    expect(prompt).toContain("你是负责生成正文的 writer");
    expect(prompt).toContain("重要场景先让读者看清大轮廓和空间关系，再落到局部细节");
    expect(prompt).toContain("人物停步、俯身、伸手、偏头等动作前");
    expect(prompt).toContain("Do not reveal the mastermind");
    expect(prompt).toContain("Keep the prose restrained");
  });

  it("tells governed English prompts to obey variance briefs and include resistance-bearing exchanges", () => {
    const prompt = buildWriterSystemPrompt(
      {
        ...BOOK,
        language: "en",
      },
      {
        ...GENRE,
        language: "en",
        name: "General",
      },
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "en",
      "governed",
    );

    expect(prompt).toContain("English Variance Brief");
    expect(prompt).toContain("resistance-bearing exchange");
    expect(prompt).toContain("You are drafting new prose, not auditing or patching old prose");
    expect(prompt).toContain("Scene anchors before micro-detail");
    expect(prompt).toContain("Action needs a visible trigger");
  });

  it("uses Korean contract branch for Korean mode and avoids non-Korean guidance headers", () => {
    const prompt = buildWriterSystemPrompt(
      {
        ...BOOK,
        language: "ko",
      },
      {
        ...GENRE,
        language: "ko",
        name: "현대판타지",
      },
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "ko",
      "governed",
    );

    expect(prompt).toContain("## 분량 가이드");
    expect(prompt).toContain("## 입력 거버넌스 계약");
    expect(prompt).toContain("## 핵심 규칙");
    expect(prompt).toContain("너는 한국어 웹소설 초고를 작성하는 writer다");
    expect(prompt).toContain("독자가 먼저 큰 형상과 위치 관계를 잡도록 장면을 세우고");
    expect(prompt).toContain("인물의 행동은 그 행동을 촉발한 시각 정보, 압박, 목표와 자연스럽게 연결한다");
    expect(prompt).toContain("장면마다 초점 대상을 먼저 정하고");
    expect(prompt).toContain("문단마다 가장 강하게 남길 핵심 디테일 1개를 정하고");
    expect(prompt).toContain("한 문장은 하나의 핵심 시각 단위를 중심에 두고");
    expect(prompt).toContain("묘사 뒤에는 짧은 행동, 반응, 판단을 붙여 호흡을 전진시킨다");
    expect(prompt).toContain("전경에는 결정적 디테일을 두고, 중경과 배경은 기능이 보이도록 간결하게 정리한다");
    expect(prompt).toContain("장면마다 1-2개의 결정적 디테일을 남기고");
    expect(prompt).toContain("평문 문장으로 장면을 연결하고");
    expect(prompt).toContain("속도를 올리는 구간에서는 동작, 선택, 대사를 앞세우고");
    expect(prompt).toContain("독자가 장면에서 바로 읽을 수 있는 감정과 의도는 행동, 표정, 대사, 감각의 증거로 먼저 전달한다");
    expect(prompt).toContain("행동과 표정이 이미 전달한 감정은 다음 설명문 대신 다음 반응이나 선택으로 이어 준다");
    expect(prompt).toContain("한국어는 주어를 자연스럽게 생략할 수 있다");
    expect(prompt).toContain("이름, 직함, 무주어 문장, 직접 행동문으로 분산한다");
    expect(prompt).toContain("한 문단 안에서 같은 인물 주어를 반복하지 않는다");
    expect(prompt).toContain("감각으로 시작할 때는 어떤 감각을 먼저 쓸지 의식적으로 선택한다");
    expect(prompt).toContain("냄새가 먼저 들어왔다");
    expect(prompt).toContain("감각 자체를 주어로 세우는 문장을 반복하지 않는다");
    expect(prompt).toContain("자신이 누워 있지 않다는 것을 알았다");
    expect(prompt).not.toContain("## 금지사항");
    expect(prompt).not.toContain("## Input Governance Contract");
    expect(prompt).not.toContain("## Length Guidance");
    expect(prompt).not.toContain("## 输入治理契约");
  });
});
