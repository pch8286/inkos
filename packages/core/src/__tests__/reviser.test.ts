import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviserAgent } from "../agents/reviser.js";
import { buildLengthSpec } from "../utils/length-metrics.js";
import type { AuditIssue } from "../agents/continuity.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

const CRITICAL_ISSUE: AuditIssue = {
  severity: "critical",
  category: "continuity",
  description: "Fix the broken continuity",
  suggestion: "Repair the contradiction",
};

describe("ReviserAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers book language override when building revision prompts", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-lang-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    await writeFile(
      join(bookDir, "book.json"),
      JSON.stringify({
        id: "english-book",
        title: "English Book",
        genre: "xuanhuan",
        platform: "royalroad",
        chapterWordCount: 800,
        targetChapters: 60,
        status: "active",
        language: "en",
        createdAt: "2026-03-23T00:00:00.000Z",
        updatedAt: "2026-03-23T00:00:00.000Z",
      }, null, 2),
      "utf-8",
    );

    const agent = new ReviserAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== REVISED_CONTENT ===",
        "Revised chapter content.",
        "",
        "=== UPDATED_STATE ===",
        "State card",
        "",
        "=== UPDATED_HOOKS ===",
        "Hooks board",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(bookDir, "Original chapter content.", 1, [CRITICAL_ISSUE], "rewrite", "xuanhuan");

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";

      expect(systemPrompt).toContain("MUST be in English");
      expect(systemPrompt).toContain("written entirely in English");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps rewrite mode local-first instead of encouraging full-chapter replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-rewrite-guardrail-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "原始正文。",
        "REPLACEMENT_TEXT:",
        "修订后的正文。",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "状态卡",
        "",
        "=== UPDATED_HOOKS ===",
        "伏笔池",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(bookDir, "原始正文。", 1, [CRITICAL_ISSUE], "rewrite", "xuanhuan");

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";

      expect(systemPrompt).toContain("尽量小的改动");
      expect(systemPrompt).toContain("优先保留原文的绝大部分句段");
      expect(systemPrompt).toContain("除非问题跨越整章");
      expect(systemPrompt).toContain("先让读者看清场景的大轮廓和位置关系，再落到局部细节");
      expect(systemPrompt).toContain("人物俯身、伸手、停步等动作，要让读者先看懂动作缘由");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tells the model to preserve the target range when a length spec is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "原始正文。",
        "REPLACEMENT_TEXT:",
        "修订后的正文。",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "状态卡",
        "",
        "=== UPDATED_HOOKS ===",
        "伏笔池",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(
        bookDir,
        "原始正文。",
        1,
        [CRITICAL_ISSUE],
        "spot-fix",
        "xuanhuan",
        {
          lengthSpec: buildLengthSpec(220, "zh"),
        },
      );

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";
      const userPrompt = messages?.[1]?.content ?? "";

      expect(systemPrompt).toContain("保持章节字数在目标区间内");
      expect(systemPrompt).toContain("=== PATCHES ===");
      expect(systemPrompt).not.toContain("=== REVISED_CONTENT ===");
      expect(userPrompt).toContain("目标字数：220");
      expect(userPrompt).toContain("允许区间：190-250");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("teaches Korean spot-fix revisions through concrete scene upgrades", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-positive-ko-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });
    await writeFile(
      join(bookDir, "book.json"),
      JSON.stringify({
        id: "korean-book",
        title: "Korean Book",
        genre: "modern-fantasy",
        platform: "naver-series",
        chapterWordCount: 220,
        targetChapters: 60,
        status: "active",
        language: "ko",
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
      }, null, 2),
      "utf-8",
    );

    const agent = new ReviserAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "원문 본문",
        "REPLACEMENT_TEXT:",
        "수정된 본문",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "상태 카드",
        "",
        "=== UPDATED_HOOKS ===",
        "복선 풀",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(bookDir, "원문 본문", 3, [CRITICAL_ISSUE], "spot-fix", "modern-fantasy");

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";

      expect(systemPrompt).toContain("독자가 걸린 지점을 최소 수정으로 통과 가능하게 바꾸는 것");
      expect(systemPrompt).toContain("중요한 감정 변화는 감정 이름보다 손이 멈추는지, 말끝이 흐려지는지, 시선이 피하는지 같은 변화로 먼저 드러낸다");
      expect(systemPrompt).toContain("장면의 큰 형상과 위치 관계를 먼저 세우고, 세부는 그다음에 둔다");
      expect(systemPrompt).toContain("인물의 자세 변화와 손동작은 왜 그렇게 움직이는지 보이도록 직전 시각 정보와 연결한다");
      expect(systemPrompt).toContain("관계 변화는 짧은 직접 공방이나 망설임, 시선 회피 같은 장면 증거로 고친다");
      expect(systemPrompt).toContain("설명은 장면을 잇는 연결용으로 압축하고, 핵심 비트는 장면 안에서 체감되게 고친다");
      expect(systemPrompt).toContain("과밀한 문장은 앞비트와 뒷비트로 나눠");
      expect(systemPrompt).toContain("시점 인물이 모르는 정보나 남의 속마음을 새로 해설하지 않는다");
      expect(systemPrompt).toContain("처음 등장하는 고유명사는 관계, 기능, 위협 중 하나를 붙여 자연스럽게 고친다");
      expect(systemPrompt).toContain("장면의 갈등은 인물의 욕망과 방해가 부딪히는 방향으로 보강한다");
      expect(systemPrompt).toContain("대사와 지문 중 더 짧고 자연스러운 쪽으로 정보 전달 방식을 고른다");
      expect(systemPrompt).toContain("감각을 항목처럼 요약한 문장은 움직임, 접촉 지점, 시선 이동에 붙인다");
      expect(systemPrompt).toContain("장면 안 원인 없이 떠 있는 감각 비유");
      expect(systemPrompt).toContain("더 예쁜 비유로 바꾸지 말고 감각의 원인, 물리적 변화, 인물 반응으로 고친다");
      expect(systemPrompt).toContain("서술 시간이 장면 중요도와 어긋나면 선택, 대가, 폭로, 관계 변화, 위협 신호는 확대하고");
      expect(systemPrompt).toContain("이동, 반복 절차, 이미 이해된 정보는 압축한다");
      expect(systemPrompt).toContain("짧은 문단이 연속되면 효과 비트만 남기고 인접한 행동-관찰-반응은 한 문단으로 묶는다");
      expect(systemPrompt).toContain("소품의 의미 해설은 사용 방식, 실패, 손에 익은 정도, 상대 반응으로 바꾼다");
      expect(systemPrompt).toContain("회차 끝의 회고형 선언이나 판세 비유는 마지막 행동, 되돌릴 수 없는 결과, 상대 반응으로 바꾼다");
      expect(systemPrompt).toContain("수정 우선순위는 구조 -> 인물/갈등 -> 장면 -> 문장 순서로 판단한다");
      expect(systemPrompt).toContain("회차의 작은 보상과 다음 질문이 사라진 경우");
      expect(systemPrompt).toContain("주인공의 능동적 선택과 그 대가");
      expect(systemPrompt).toContain("장면의 욕망 / 행동 / 변화가 빠진 문제");
      expect(systemPrompt).toContain("문장 윤문보다 장면 재배치나 rewrite/rework가 필요한지 먼저 판단한다");
      expect(systemPrompt).toContain("spot-fix는 단일 원인, 국소 수정, 사건 순서 불변일 때만 선택한다");
      expect(systemPrompt).toContain("polish는 사실과 구조는 맞고 문장만 거슬릴 때 선택한다");
      expect(systemPrompt).toContain("rewrite는 장면 배열이나 인과 재배치가 필요할 때 선택한다");
      expect(systemPrompt).toContain("rework는 갈등 구조 자체가 흔들릴 때 선택한다");
      expect(systemPrompt).toContain("핵심 앵커 장면, 고유명사, 대사 한 비트는 반드시 유지한다");
      expect(systemPrompt).toContain("한 단계 낮은 모드로 해결 가능하면 더 큰 모드를 쓰지 말고");
      expect(systemPrompt).toContain("독자가 먼저 잃는 것은 사실 -> 순서 -> 공간 -> 관계 -> 원인 -> 감정 순서로 판단하세요");
      expect(systemPrompt).toContain("문체 보존과 연속성 수정이 충돌하면 연속성을 우선하고");
      expect(systemPrompt).toContain("각 이슈마다 수정 전 실패 조건과 수정 후 통과 조건을 한 쌍으로 확인한 뒤");
      expect(systemPrompt).toContain("수정 후에는 원래 문제를 다시 확인하고, 새 모순·새 고유명사·새 훅·새 정보 누출");
      expect(systemPrompt).toContain("수정 전 실패 조건과 수정 후 통과 조건을 관찰 가능한 문장으로 한 쌍씩 적는다");
      expect(systemPrompt).toContain("모드별 편집 거리 예산을 지킨다");
      expect(systemPrompt).toContain("보이지 않는 가정부터 점검하고, 본문에 없는 전제는 사실처럼 쓰지 않는다");
      expect(systemPrompt).toContain("회차마다 독자가 품게 될 질문을 해결됨/보류/새로 열린 질문으로 나눠 정리한다");
      expect(systemPrompt).toContain("각 수정은 이슈 → 근거 → 패치 → 보존 항목 순서로 추적 가능해야 한다");
      expect(systemPrompt).toContain("수정 큐는 하드 모순 → 인과 붕괴 → 정보 누락 → 장면 구조 → 문장/리듬 순서");
      expect(systemPrompt).toContain("수정 결과가 원래 문제를 가리거나 새 모순을 만들면 즉시 롤백한다");
      expect(systemPrompt).toContain("장면이 이미 독해를 막지 않으면 굳이 손대지 않는다");
      expect(systemPrompt).toContain("author_intent.md와 current_focus.md는 사실 충돌이 없는 한 최우선으로 보존한다");
      expect(systemPrompt).toContain("수정이 끝나면 변경 전/후 diff의 고친 구간만 다시 읽고");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps anti-detect mode aligned with positive scene guidance instead of ban-only language", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-positive-antidetect-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });
    await writeFile(
      join(bookDir, "book.json"),
      JSON.stringify({
        id: "korean-book",
        title: "Korean Book",
        genre: "modern-fantasy",
        platform: "naver-series",
        chapterWordCount: 220,
        targetChapters: 60,
        status: "active",
        language: "ko",
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
      }, null, 2),
      "utf-8",
    );

    const agent = new ReviserAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== REVISED_CONTENT ===",
        "수정된 본문",
        "",
        "=== UPDATED_STATE ===",
        "상태 카드",
        "",
        "=== UPDATED_HOOKS ===",
        "복선 풀",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(bookDir, "원문 본문", 3, [CRITICAL_ISSUE], "anti-detect", "modern-fantasy");

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";

      expect(systemPrompt).toContain("구체적인 반응과 감각");
      expect(systemPrompt).toContain("장면으로 체감");
      expect(systemPrompt).toContain("군중 반응은 뭉뚱그리지 말고 개별 반응");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reconstructs revised content from spot-fix patches and preserves untouched text", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-spotfix-patch-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- 收紧了开头动作句。",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "林越没有立刻进去。",
        "REPLACEMENT_TEXT:",
        "林越先停在门槛外，侧耳听了一息。",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "状态卡",
        "",
        "=== UPDATED_HOOKS ===",
        "伏笔池",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    const original = [
      "门轴轻轻响了一下。",
      "林越没有立刻进去。",
      "",
      "巷子尽头的风还在吹。",
      "他把手按在潮冷的门框上，没有出声。",
      "更远处传来极轻的脚步回响，又很快断掉。",
    ].join("\n");

    try {
      const result = await agent.reviseChapter(
        bookDir,
        original,
        1,
        [CRITICAL_ISSUE],
        "spot-fix",
        "xuanhuan",
      );

      expect(result.revisedContent).toBe([
        "门轴轻轻响了一下。",
        "林越先停在门槛外，侧耳听了一息。",
        "",
        "巷子尽头的风还在吹。",
        "他把手按在潮冷的门框上，没有出声。",
        "更远处传来极轻的脚步回响，又很快断掉。",
      ].join("\n"));
      expect(result.fixedIssues).toEqual(["- 收紧了开头动作句。"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses selected summary and hook evidence instead of full long-history markdown in governed mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-governed-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| guild-route | 1 | mystery | open | 2 | 6 | Merchant guild trail |",
          "| mentor-oath | 8 | relationship | open | 99 | 101 | Mentor oath debt with Lin Yue |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 1 | Guild Trail | Merchant guild flees west | Route clues only | None | guild-route seeded | tense | action |",
          "| 99 | Trial Echo | Lin Yue | Mentor left without explanation | Oath token matters again | mentor-oath advanced | aching | fallout |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 100\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(
        join(storyDir, "story_bible.md"),
        [
          "# Story Bible",
          "",
          "- The jade seal cannot be destroyed.",
          "- Guildmaster Ren secretly forged the harbor roster in chapter 140.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "character_matrix.md"),
        [
          "# 角色交互矩阵",
          "",
          "### 角色档案",
          "| 角色 | 核心标签 | 反差细节 | 说话风格 | 性格底色 | 与主角关系 | 核心动机 | 当前目标 |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| Lin Yue | oath | restraint | clipped | stubborn | self | repay debt | find mentor |",
          "| Guildmaster Ren | guild | swagger | loud | opportunistic | rival | stall Mara | seize seal |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
    ]);

    const agent = new ReviserAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "原始正文。",
        "REPLACEMENT_TEXT:",
        "修订后的正文。",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "状态卡",
        "",
        "=== UPDATED_HOOKS ===",
        "伏笔池",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(
        bookDir,
        "原始正文。",
        100,
        [CRITICAL_ISSUE],
        "spot-fix",
        "xuanhuan",
        {
          chapterIntent: "# Chapter Intent\n\n## Goal\nBring the focus back to the mentor oath conflict.\n",
          contextPackage: {
            chapter: 100,
            selectedContext: [
              {
                source: "story/story_bible.md",
                reason: "Preserve canon constraints referenced by mustKeep.",
                excerpt: "The jade seal cannot be destroyed.",
              },
              {
                source: "story/volume_outline.md",
                reason: "Anchor the default planning node for this chapter.",
                excerpt: "Track the mentor oath fallout.",
              },
              {
                source: "story/chapter_summaries.md#99",
                reason: "Relevant episodic memory.",
                excerpt: "Trial Echo | Mentor left without explanation | mentor-oath advanced",
              },
              {
                source: "story/pending_hooks.md#mentor-oath",
                reason: "Carry forward unresolved hook.",
                excerpt: "relationship | open | 101 | Mentor oath debt with Lin Yue",
              },
            ],
          },
          ruleStack: {
            layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
            sections: {
              hard: ["current_state"],
              soft: ["current_focus"],
              diagnostic: ["continuity_audit"],
            },
            overrideEdges: [],
            activeOverrides: [],
          },
          lengthSpec: buildLengthSpec(220, "zh"),
        },
      );

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const userPrompt = messages?.[1]?.content ?? "";

      expect(userPrompt).toContain("story/chapter_summaries.md#99");
      expect(userPrompt).toContain("story/pending_hooks.md#mentor-oath");
      expect(userPrompt).toContain("story/story_bible.md");
      expect(userPrompt).toContain("story/volume_outline.md");
      expect(userPrompt).not.toContain("| 1 | Guild Trail |");
      expect(userPrompt).not.toContain("guild-route | 1 | mystery");
      expect(userPrompt).not.toContain("Guildmaster Ren secretly forged the harbor roster in chapter 140.");
      expect(userPrompt).not.toContain("| Guildmaster Ren | guild | swagger | loud | opportunistic | rival | stall Mara | seize seal |");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses Korean reviser prompts for Korean books", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-ko-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });
    await writeFile(join(bookDir, "book.json"), JSON.stringify({ language: "ko" }, null, 2), "utf-8");

    const agent = new ReviserAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== REVISED_CONTENT ===",
        "수정된 본문",
        "",
        "=== UPDATED_STATE ===",
        "상태 카드",
        "",
        "=== UPDATED_HOOKS ===",
        "복선 풀",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(bookDir, "원문 본문", 3, [CRITICAL_ISSUE], "rewrite", "xuanhuan");

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";
      const userPrompt = messages?.[1]?.content ?? "";

      expect(systemPrompt).toContain("전문 웹소설 수정 에디터");
      expect(systemPrompt).toContain("수정 모드");
      expect(userPrompt).toContain("## 심사 이슈");
      expect(userPrompt).toContain("## 수정 대상 원문");
      expect(userPrompt).not.toContain("## 审稿问题");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renders Korean governed control inputs without Chinese headings", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-governed-ko-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "korean-book",
          title: "Korean Book",
          genre: "other",
          platform: "naver-series",
          chapterWordCount: 2200,
          targetChapters: 60,
          status: "active",
          language: "ko",
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      ),
      writeFile(join(storyDir, "current_state.md"), "# 현재 상태\n\n- 마왕의 몸에 빙의했다.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 복선\n\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# 회차 요약\n\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# 권별 아웃라인\n\n## 5화\n왕좌의 오해를 유지한다.\n", "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# 설정\n\n- 옥새는 부서지지 않는다.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# 스타일\n\n- 절제된 문장.\n", "utf-8"),
    ]);

    const agent = new ReviserAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "원문.",
        "REPLACEMENT_TEXT:",
        "수정문.",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "상태",
        "",
        "=== UPDATED_HOOKS ===",
        "복선",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(
        bookDir,
        "원문.",
        5,
        [CRITICAL_ISSUE],
        "spot-fix",
        "other",
        {
          chapterIntent: "# 본장 의도\n\n## 목표\n왕좌의 오해를 유지한다.\n",
          contextPackage: {
            chapter: 5,
            selectedContext: [{
              source: "story/volume_outline.md",
              reason: "이번 화 기본 노드",
              excerpt: "왕좌의 오해를 유지한다.",
            }],
          },
          ruleStack: {
            layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
            sections: {
              hard: ["current_state"],
              soft: ["current_focus"],
              diagnostic: ["continuity_audit"],
            },
            overrideEdges: [],
            activeOverrides: [],
          },
          lengthSpec: buildLengthSpec(2200, "ko"),
        },
      );

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const userPrompt = messages?.[1]?.content ?? "";

      expect(userPrompt).toContain("## 본장 제어 입력");
      expect(userPrompt).toContain("### 선택된 컨텍스트");
      expect(userPrompt).toContain("### 규칙 스택");
      expect(userPrompt).toContain("- 하드 가드레일:");
      expect(userPrompt).toContain("- 소프트 제약:");
      expect(userPrompt).toContain("- 진단 규칙:");
      expect(userPrompt).toContain("### 현재 오버라이드");
      expect(userPrompt).not.toContain("## 本章控制输入");
      expect(userPrompt).not.toContain("### 已选上下文");
      expect(userPrompt).not.toContain("- 硬护栏：");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
