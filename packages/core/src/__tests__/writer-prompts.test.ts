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
    expect(prompt).toContain("한 문장은 하나의 핵심 행동이나 이미지 단위를 중심에 두고");
    expect(prompt).toContain("묘사 뒤에는 짧은 행동, 반응, 판단을 붙여 호흡을 전진시킨다");
    expect(prompt).toContain("전경에는 결정적 디테일을 두고, 중경과 배경은 기능이 보이도록 간결하게 정리한다");
    expect(prompt).toContain("서술 시간은 사건이 실제로 걸린 시간이 아니라 장면의 기능과 독자 체감 중요도에 맞춰 배분한다");
    expect(prompt).toContain("선택, 대가, 폭로, 관계 변화, 위협 신호, 회수 비트는 확대하고");
    expect(prompt).toContain("이동, 반복 절차, 이미 이해된 정보, 변화 없는 배경은 압축한다");
    expect(prompt).toContain("묘사의 길이는 대상의 화려함이 아니라 장면에서 일으키는 변화량에 맞춘다");
    expect(prompt).toContain("선택이나 대가가 생기는 지점은 행동·감각·반응을 붙여 호흡을 늦춘다");
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
    expect(prompt).toContain("감각을 항목처럼 요약하지 않는다");
    expect(prompt).toContain("인물의 움직임, 접촉 지점, 시선 이동에 붙여서 쓴다");
    expect(prompt).toContain("손바닥을 바닥에 짚자 차가운 기운이 손목까지 올라왔다");
    expect(prompt).not.toContain("카르세리온이 팔을 짚자");
    expect(prompt).toContain("자신이 누워 있지 않다는 것을 알았다");
    expect(prompt).toContain("시점 인물이 알 수 없는 정보나 남의 속마음을 서술자가 먼저 해설하지 않는다");
    expect(prompt).toContain("서술자의 판단이 장면 밖에서 끼어들면 시점이 흐려진다");
    expect(prompt).toContain("처음 등장하는 고유명사는 이름만 던지지 말고 관계, 기능, 위협 중 하나를 함께 붙인다");
    expect(prompt).toContain("도입 첫 문장은 장면의 읽기 순서를 먼저 잡는다");
    expect(prompt).toContain("가장 먼저 처리할 정보");
    expect(prompt).toContain("시야, 생각, 소리, 접촉감, 행동 중 장면에 가장 자연스러운 입구");
    expect(prompt).toContain("목 안쪽이 긁혔다처럼 몸 안쪽 감각을 쓸 때는 감각의 원인 이미지와 확인 행동");
    expect(prompt).toContain("신체 감각은 원인, 확인 행동, 다음 선택과 이어질 때 가장 자연스럽다");
    expect(prompt).toContain("감각 단어를 나열하기보다 인물이 움직이며 닿고 보고 듣는 순서에 묻어 둔다");
    expect(prompt).not.toContain("각성/빙의/낯선 몸 장면");
    expect(prompt).toContain("깨달음은 실패한 행동, 다른 인물이 물러서거나 무기를 잡는 장면, 짧은 생각 중 하나로 착지시킨다");
    expect(prompt).toContain("자극 -> 해석 -> 반응 순서를 기본값으로 둔다");
    expect(prompt).toContain("인물의 반응이 먼저 튀어나오면 독자가 원인을 뒤늦게 찾게 된다");
    expect(prompt).toContain("다인 장면의 압박은 행동, 대사, 침묵, 반응이 서로 밀고 당기는 교환으로 만든다");
    expect(prompt).toContain("초반부에서는 고유명사, 조직명, 세계관 용어를 한꺼번에 쏟지 않는다");
    expect(prompt).toContain("제목이나 설정이 약속한 재미는 설명보다 구체적 행동으로 먼저 증명한다");
    expect(prompt).toContain("정보는 필요한 순간에만 넣고, 행동이나 결과를 먼저 보여 준 뒤 이유를 짧게 붙인다");
    expect(prompt).toContain("대사와 지문은 더 짧고 자연스러운 쪽을 고른다");
    expect(prompt).toContain("설정 대사는 실제 상황의 목표, 오해, 위협, 거래 안에서 흘린다");
    expect(prompt).toContain("지문은 복잡한 배경이나 규칙을 짧게 정리할 때 쓴다");
    expect(prompt).not.toContain("대화는 설명문을 대신하는 정보 운반책이 아니라");
    expect(prompt).toContain("그리고, 그러나, 그런데, 하지만 같은 접속사가 이어지면");
    expect(prompt).toContain("피동과 명사화가 문장을 흐리면 능동 동사로 바꾼다");
    expect(prompt).toContain("장면의 갈등은 인물의 욕망과 방해가 부딪히는 지점에서 시작한다");
    expect(prompt).toContain("Planner의 회차 계약을 본문으로 구현한다");
    expect(prompt).toContain("작은 보상 1개와 다음 화를 여는 질문 1개");
    expect(prompt).toContain("장면은 욕망 / 행동 / 변화가 보이게 쓴다");
    expect(prompt).toContain("목표 / 방해 / 전환");
    expect(prompt).toContain("주인공의 능동적 선택과 그 대가");
    expect(prompt).toContain("대사는 정보 설명보다 압박, 회피, 협상, 은폐의 행위로 작동하게 한다");
    expect(prompt).toContain("의미/아크는 교훈문이 아니라 선택이 남긴 흔적으로 남긴다");
    expect(prompt).toContain("장면 사이 전환은 원인 -> 반응 -> 새 상황으로 이어진다");
    expect(prompt).toContain("새 정보 / 재맥락화 / 미해결 질문의 비율");
    expect(prompt).toContain("다인 장면은 목표, 레버리지, 저항 방식");
    expect(prompt).toContain("동선, 시야, 출입구, 손에 든 물건");
    expect(prompt).toContain("반복되는 사물이나 제스처는 상태가 달라질 때만 강조한다");
    expect(prompt).toContain("서술 거리는 장면 목적에 맞게 조절하고");
    expect(prompt).toContain("내면은 선택 직전과 직후에만 가까이 들이고");
    expect(prompt).toContain("장면 중 목표가 꺾이면 같은 수를 반복하지 말고 즉시 전술을 바꾼다");
    expect(prompt).toContain("대사는 말한 뜻보다 말하지 않은 뜻이 더 크게 읽히게 쓴다");
    expect(prompt).toContain("반전은 선언이 아니라 새로 드러난 물증, 태도 변화, 공간의 의미 전환");
    expect(prompt).toContain("장면의 첫 문장은 직전 화 요약이 아니라 이번 화의 현재 좌표를 먼저 세운다");
    expect(prompt).toContain("이전 화를 되짚어야 할 때는 요약 문단으로 복습하지 말고");
    expect(prompt).toContain("한 장면은 하나의 시점 계약을 지킨다");
    expect(prompt).toContain("각 장면은 하나의 질문으로 시작해 하나의 답 또는 더 날카로운 새 질문으로 끝난다");
    expect(prompt).toContain("갈등은 단순한 방해가 아니라 서로 양립할 수 없는 가치의 충돌이어야 한다");
    expect(prompt).toContain("한 장면에 핵심 전환은 1개만 두고");
    expect(prompt).toContain("대사와 행동은 누가 우위인지, 누가 양보했는지, 누가 빚졌는지를 남기는 지위 거래");
    expect(prompt).toContain("주인공의 강함은 정보, 준비, 대가, 선택의 결과로 보이게 하고");
    expect(prompt).toContain("댓글 유도용 메타 질문이나 답정너 빈칸을 남기지 않는다");
    expect(prompt).toContain("비밀은 숨김이고, 거짓말은 적극적 왜곡이다");
    expect(prompt).toContain("한 비트에서 독자가 스스로 맞춰야 할 것은 하나만 남기고");
    expect(prompt).toContain("변화가 없는 이동과 요약은 압축하고");
    expect(prompt).toContain("서술 시간은 사건이 실제로 걸린 시간이 아니라 장면의 기능과 독자 체감 중요도에 맞춰 배분한다");
    expect(prompt).toContain("압박이 세질수록 말투는 무너지는 게 아니라");
    expect(prompt).toContain("감각은 고르게 나누지 말고, 한 비트마다 주감각 하나를 먼저 세운 뒤");
    expect(prompt).toContain("감각 비유는 장면 안 원인, 물리적 변화, 인물 반응과 이어질 때만 쓴다");
    expect(prompt).toContain("감각의 발생 원인, 물리적 변화, 인물 반응");
    expect(prompt).toContain("짧은 문단은 결정타, 전환, 대사, 시간 압박 같은 효과 비트에만 아껴 쓴다");
    expect(prompt).toContain("인접한 행동-관찰-반응은 한 문단 안에서 처리한다");
    expect(prompt).toContain("소품의 의미를 서술자가 바로 해설하지 않는다");
    expect(prompt).toContain("사용 방식, 실패, 손에 익은 정도, 상대 반응");
    expect(prompt).toContain("선택 직전에는 생각보다 몸의 움직임이 먼저 보이게 쓴다");
    expect(prompt).toContain("같은 콜백은 같은 문장으로 반복하지 말고 의미가 바뀐 각도로 되돌린다");
    expect(prompt).toContain("인물, 사건, 배경 중 둘 이상이 서로 영향을 주지 않으면 장면이 흩어진다");
    expect(prompt).toContain("두 인물 이상의 동작과 반응이 한 문장에 붙으면");
    expect(prompt).toContain("추상어 세 개를 독립 문단으로 세운 뒤 그 세 가지가 맞물린다고 정리하는 리듬");
    expect(prompt).toContain("좋은 비트는 구체적 행동, 소리, 즉각적인 짧은 생각으로 닫는다");
    expect(prompt).toContain("작법 메모의 재료명이나 체크 항목을 본문 문장으로 내보내지 않는다");
    expect(prompt).toContain("누가 물러서거나 무기를 잡는 행동처럼 장면 안 사건으로 흡수한다");
    expect(prompt).toContain("부사가 눈에 띄면 먼저 동사가 약한지 확인한다");
    expect(prompt).toContain("걷는지, 비틀거리는지, 미끄러지는지, 멈춰 서는지처럼 움직임 자체를 바꾼다");
    expect(prompt).toContain("회차 끝을 선언문으로 닫지 않는다");
    expect(prompt).toContain("마지막 줄은 인물이 실제로 한 선택, 되돌릴 수 없는 결과, 상대가 보인 즉각 반응 중 하나로 남긴다");
    expect(prompt).not.toContain("그리고 나는 방금");
    expect(prompt).not.toContain("첫 수를 두었다");
    expect(prompt).not.toContain("몸. 장소. 주변 반응. 적대 여부.");
    expect(prompt).not.toContain("시점 인물의 몸, 공간 앵커");
    expect(prompt).not.toContain("구체적 행동, 주변 반응, 결과 장면");
    expect(prompt).not.toContain("쇠 긁는 울림");
    expect(prompt).not.toContain("금속성 소리");
    expect(prompt).not.toContain("공기가 얼어붙었다");
    expect(prompt).not.toContain("칼날 같은 시선");
    expect(prompt).not.toContain("훈련장 지급품이었다");
    expect(prompt).not.toContain("헌터처럼 보이게 만드는 물건");
    expect(prompt).toContain("## 출력 형식");
    expect(prompt).toContain("장 제목");
    expect(prompt).toContain("본문");
    expect(prompt).toContain("CHAPTER_TITLE");
    expect(prompt).toContain("CHAPTER_CONTENT");
    expect(prompt).not.toContain("## 금지사항");
    expect(prompt).not.toContain("## Input Governance Contract");
    expect(prompt).not.toContain("## Length Guidance");
    expect(prompt).not.toContain("## 输入治理契约");
    expect(prompt).not.toContain("## 输出格式");
    expect(prompt).not.toContain("章节标题");
    expect(prompt).not.toContain("正文内容");
    expect(prompt).not.toContain("请勿输出");
  });
});
