import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BookConfig } from "../models/book.js";
import type { PlanChapterOutput } from "../agents/planner.js";
import { ComposerAgent } from "../agents/composer.js";

const require = createRequire(import.meta.url);
const hasNodeSqlite = (() => {
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

describe("ComposerAgent", () => {
  let root: string;
  let bookDir: string;
  let storyDir: string;
  let book: BookConfig;
  let plan: PlanChapterOutput;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-composer-test-"));
    bookDir = join(root, "books", "composer-book");
    storyDir = join(bookDir, "story");
    await mkdir(join(storyDir, "runtime"), { recursive: true });

    book = {
      id: "composer-book",
      title: "Composer Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 3000,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    await Promise.all([
      writeFile(join(storyDir, "author_intent.md"), "# Author Intent\n\nKeep the pressure on the mentor conflict.\n", "utf-8"),
      writeFile(join(storyDir, "current_focus.md"), "# Current Focus\n\nBring the focus back to the mentor conflict.\n", "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 4\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
    ]);

    const runtimePath = join(storyDir, "runtime", "chapter-0004.intent.md");
    await writeFile(runtimePath, "# Chapter Intent\n\n## Goal\nBring the focus back to the mentor conflict.\n", "utf-8");

    plan = {
      intent: {
        chapter: 4,
        goal: "Bring the focus back to the mentor conflict.",
        outlineNode: "Track the merchant guild trail.",
        engineDirectives: [],
        mustKeep: [
          "Lin Yue still hides the broken oath token.",
          "The jade seal cannot be destroyed.",
        ],
        mustAvoid: ["Do not reveal the mastermind."],
        styleEmphasis: ["character conflict", "tight POV"],
        conflicts: [
          {
            type: "outline_vs_request",
            resolution: "allow local outline deferral",
          },
        ],
        hookAgenda: {
          pressureMap: [],
          mustAdvance: [],
          eligibleResolve: [],
          staleDebt: [],
          avoidNewHookFamilies: [],
        },
      },
      intentMarkdown: "# Chapter Intent\n",
      plannerInputs: [
        join(storyDir, "author_intent.md"),
        join(storyDir, "current_focus.md"),
        join(storyDir, "story_bible.md"),
        join(storyDir, "volume_outline.md"),
        join(storyDir, "current_state.md"),
      ],
      runtimePath,
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("selects only the relevant context and writes a context package", async () => {
    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
    });

    const selectedSources = result.contextPackage.selectedContext.map((entry) => entry.source);
    expect(selectedSources.slice(0, 5)).toEqual([
      "story/current_focus.md",
      "story/author_intent.md",
      "story/current_state.md",
      "story/story_bible.md",
      "story/volume_outline.md",
    ]);
    expect(selectedSources.some((source) => source.startsWith("story/pending_hooks.md"))).toBe(true);
    expect(selectedSources).not.toContain("story/style_guide.md");
    await expect(readFile(result.contextPath, "utf-8")).resolves.toContain("current_focus.md");
  });

  it("extracts a multi-item story bible digest for governed context instead of a single line", async () => {
    await writeFile(
      join(storyDir, "story_bible.md"),
      [
        "# Story Bible",
        "",
        "## Core Rules",
        "- The jade seal cannot be destroyed.",
        "- Every guild oath leaves a scar on the palm.",
        "",
        "## Factions",
        "- The river guild never enters shrine ground armed.",
        "",
      ].join("\n"),
      "utf-8",
    );

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
    });

    const storyBibleEntry = result.contextPackage.selectedContext.find((entry) => entry.source === "story/story_bible.md");
    expect(storyBibleEntry?.excerpt).toContain("The jade seal cannot be destroyed.");
    expect(storyBibleEntry?.excerpt).toContain("Every guild oath leaves a scar on the palm.");
    expect(storyBibleEntry?.excerpt).toContain("The river guild never enters shrine ground armed.");
  });

  it("extracts a multi-line author intent digest instead of keeping only the first sentence", async () => {
    await writeFile(
      join(storyDir, "author_intent.md"),
      [
        "# 작가 의도",
        "",
        "핵심 엔진은 주인공의 진지한 마왕 컨셉 행동이 주변에 의해 거대한 대계로 오해되고, 그 오해가 실제 정치적 성과를 낳는 구조다.",
        "톤은 진지 7, 블랙코미디 3이다.",
        "초반에는 빙의 직후 첫 착각극을 반드시 세운 뒤 용사 파티 잠입으로 이어져야 한다.",
        "",
      ].join("\n"),
      "utf-8",
    );

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 1,
      plan,
    });

    const authorIntentEntry = result.contextPackage.selectedContext.find((entry) => entry.source === "story/author_intent.md");
    expect(authorIntentEntry?.excerpt).toContain("핵심 엔진");
    expect(authorIntentEntry?.excerpt).toContain("블랙코미디 3");
    expect(authorIntentEntry?.excerpt).toContain("첫 착각극");
  });

  it("skips placeholder focus text and table headers when composing governed context", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# 현재 포커스",
          "",
          "## 현재 중점",
          "",
          "(앞으로 1-3화에서 가장 우선해야 할 전개를 적는다.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "# 현재 상태",
          "",
          "| 항목 | 값 |",
          "| --- | --- |",
          "| 현재 위치 | 흑요궁 알현실 왕좌 뒤 비밀 공간 |",
          "| 현재 목표 | 왕좌 밑에 손을 넣은 궁정 내부자를 특정한다. |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# 볼륨 아웃라인",
          "",
          "| 권 제목 | 화수 범위 | 핵심 갈등 | 주요 전환점 | 회수 목표 |",
          "| --- | --- | --- | --- | --- |",
          "| 1권 왕좌 위 첫날 | 1-20 | 빙의 직후 약함을 숨기고 첫 궁정 심판을 버텨야 한다 | 첫 심판에서 네렌을 살린다 | 왕좌 이미지 확립 |",
          "",
          "### 초반 3화 설계",
          "- **1화**: 흑요궁 혈좌조회 한가운데서 시작한다.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    plan = {
      ...plan,
      intent: {
        ...plan.intent,
        chapter: 1,
        goal: "흑요궁 혈좌조회 한가운데서 첫 심판을 연다.",
        outlineNode: "흑요궁 혈좌조회 한가운데서 시작한다.",
        conflicts: [],
      },
    };

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 1,
      plan,
    });

    const currentFocusEntry = result.contextPackage.selectedContext.find((entry) => entry.source === "story/current_focus.md");
    const currentStateEntry = result.contextPackage.selectedContext.find((entry) => entry.source === "story/current_state.md");
    const volumeOutlineEntry = result.contextPackage.selectedContext.find((entry) => entry.source === "story/volume_outline.md");

    expect(currentFocusEntry?.excerpt).toBeUndefined();
    expect(currentStateEntry?.excerpt).toContain("현재 위치");
    expect(currentStateEntry?.excerpt).not.toBe("| 항목 | 값 |");
    expect(volumeOutlineEntry?.excerpt).toContain("흑요궁 혈좌조회");
    expect(volumeOutlineEntry?.excerpt).not.toBe("| 권 제목 | 화수 범위 | 핵심 갈등 | 주요 전환점 | 회수 목표 |");
  });

  it("emits a rule stack with hard, soft, and diagnostic sections", async () => {
    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
    });

    expect(result.ruleStack.sections.hard).toContain("story_bible");
    expect(result.ruleStack.sections.soft).toContain("author_intent");
    expect(result.ruleStack.sections.diagnostic).toContain("anti_ai_checks");
    expect(result.ruleStack.activeOverrides).toHaveLength(1);
  });

  it("writes trace output describing planner inputs and selected sources", async () => {
    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
    });

    expect(result.trace.plannerInputs).toEqual(plan.plannerInputs);
    expect(result.trace.selectedSources).toContain("story/current_focus.md");
    expect(result.trace.notes).toContain("allow local outline deferral");
    await expect(readFile(result.tracePath, "utf-8")).resolves.toContain("allow local outline deferral");
  });

  it("retrieves summary and hook evidence chunks instead of whole long memory files", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| guild-route | 1 | mystery | open | 2 | 6 | Merchant guild trail |",
          "| mentor-oath | 8 | relationship | open | 9 | 11 | Mentor oath debt with Lin Yue |",
          "| old-seal | 3 | artifact | resolved | 3 | 3 | Jade seal already recovered |",
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
          "| 7 | Broken Letter | Lin Yue | A torn letter mentions the mentor | Lin Yue reopens the old oath | mentor-oath seeded | uneasy | mystery |",
          "| 8 | River Camp | Lin Yue, Mentor Witness | Mentor debt becomes personal | Lin Yue cannot let go | mentor-oath advanced | raw | confrontation |",
          "| 9 | Trial Echo | Lin Yue | Mentor left without explanation | Oath token matters again | mentor-oath advanced | aching | fallout |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const longRangePlan: PlanChapterOutput = {
      ...plan,
      intent: {
        ...plan.intent,
        chapter: 10,
        goal: "Bring the focus back to the mentor oath conflict.",
        outlineNode: "Track the merchant guild trail.",
      },
    };

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 10,
      plan: longRangePlan,
    });

    const selectedSources = result.contextPackage.selectedContext.map((entry) => entry.source);
    expect(selectedSources).toContain("story/pending_hooks.md#mentor-oath");
    expect(selectedSources).toContain("story/chapter_summaries.md#9");
    expect(selectedSources).not.toContain("story/pending_hooks.md");
    if (hasNodeSqlite) {
      await expect(stat(join(storyDir, "memory.db"))).resolves.toBeTruthy();
    }
  });

  it("surfaces stale unresolved hook evidence in governed context selection", async () => {
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 25,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 25,
        facts: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({
        rows: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "hooks.json"), JSON.stringify({
        hooks: [
          {
            hookId: "recent-route",
            startChapter: 22,
            type: "route",
            status: "open",
            lastAdvancedChapter: 24,
            expectedPayoff: "Recent route payoff",
            notes: "Recent but not critical.",
          },
          {
            hookId: "stale-debt",
            startChapter: 3,
            type: "relationship",
            status: "open",
            lastAdvancedChapter: 8,
            expectedPayoff: "Mentor debt payoff",
            notes: "Long-stale but still unresolved.",
          },
        ],
      }, null, 2), "utf-8"),
    ]);

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 26,
      plan: {
        ...plan,
        intent: {
          ...plan.intent,
          chapter: 26,
          goal: "Keep the chapter on the mainline debt conflict.",
        },
      },
    });

    const selectedSources = result.contextPackage.selectedContext.map((entry) => entry.source);
    expect(selectedSources).toContain("story/pending_hooks.md#recent-route");
    expect(selectedSources).toContain("story/pending_hooks.md#stale-debt");
  });

  it("adds current-state fact evidence retrieved from sqlite-backed memory", async () => {
    await writeFile(
      join(storyDir, "current_state.md"),
      [
        "# Current State",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| Current Chapter | 9 |",
        "| Current Location | Ashen ferry crossing |",
        "| Protagonist State | Lin Yue hides the broken oath token and the old wound has reopened. |",
        "| Current Goal | Find the vanished mentor before the guild covers its tracks. |",
        "| Current Conflict | Mentor debt with the vanished teacher blocks every choice. |",
        "",
      ].join("\n"),
      "utf-8",
    );

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book: {
        ...book,
        language: "zh",
      },
      bookDir,
      chapterNumber: 10,
      plan: {
        ...plan,
        intent: {
          ...plan.intent,
          chapter: 10,
          goal: "Bring the focus back to the vanished mentor conflict.",
        },
      },
    });

    const factEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/current_state.md#current-conflict",
    );

    expect(factEntry).toBeDefined();
    expect(factEntry?.excerpt).toContain("Current Conflict");
    expect(factEntry?.excerpt).toContain("Mentor debt with the vanished teacher");
  });

  it("adds relevant volume-summary evidence for long-span retrieval after consolidation", async () => {
    await writeFile(
      join(storyDir, "volume_summaries.md"),
      [
        "# Volume Summaries",
        "",
        "## Volume 1 (Ch.1-40)",
        "",
        "Lin Yue's mentor oath becomes the core unresolved debt, while the guild route keeps trying to pull him away from the mainline.",
        "",
        "## Volume 2 (Ch.41-80)",
        "",
        "The guild route dominates logistics noise, but the mentor debt recedes into the background.",
        "",
      ].join("\n"),
      "utf-8",
    );

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 81,
      plan: {
        ...plan,
        intent: {
          ...plan.intent,
          chapter: 81,
          goal: "Bring the focus back to the mentor oath conflict.",
        },
      },
    });

    const volumeEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source.startsWith("story/volume_summaries.md#"),
    );

    expect(volumeEntry).toBeDefined();
    expect(volumeEntry?.excerpt).toContain("mentor oath");
  });

  it("adds explicit title history, mood trail, and canon evidence for governed writing", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Ledger in Rain | Lin Yue | First ledger clue appears | None | none | tight | investigation |",
          "| 2 | Ledger at Dusk | Lin Yue | Second ledger clue appears | None | none | tight | investigation |",
          "| 3 | Harbor Ledger | Lin Yue | Third ledger clue appears | None | none | tight | investigation |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "parent_canon.md"),
        "# Parent Canon\n\nThe mentor does not learn about the archive fire until volume two.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "fanfic_canon.md"),
        "# Fanfic Canon\n\nMara may diverge from the archive route, but the oath debt logic must stay intact.\n",
        "utf-8",
      ),
    ]);

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
    });

    const selectedSources = result.contextPackage.selectedContext.map((entry) => entry.source);
    expect(selectedSources).toContain("story/chapter_summaries.md#recent_titles");
    expect(selectedSources).toContain("story/chapter_summaries.md#recent_mood_type_trail");
    expect(selectedSources).toContain("story/parent_canon.md");
    expect(selectedSources).toContain("story/fanfic_canon.md");

    const titleEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/chapter_summaries.md#recent_titles",
    );
    const moodEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/chapter_summaries.md#recent_mood_type_trail",
    );
    const parentCanonEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/parent_canon.md",
    );
    const fanficCanonEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/fanfic_canon.md",
    );

    expect(titleEntry?.excerpt).toContain("Ledger in Rain");
    expect(moodEntry?.excerpt).toContain("tight / investigation");
    expect(parentCanonEntry?.excerpt).toContain("archive fire");
    expect(fanficCanonEntry?.excerpt).toContain("oath debt logic");
  });

  it("includes dedicated audit drift guidance instead of relying on current_state pollution", async () => {
    await writeFile(
      join(storyDir, "audit_drift.md"),
      [
        "# Audit Drift",
        "",
        "## 审计纠偏（自动生成，下一章写作前参照）",
        "",
        "> - [warning] 节奏单调: 最近4章章节类型持续停留在“调查章”。",
      ].join("\n"),
      "utf-8",
    );

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
    });

    const driftEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/audit_drift.md",
    );
    expect(driftEntry).toBeDefined();
    expect(driftEntry?.excerpt).toContain("节奏单调");
  });

  it("emits hook debt briefs for agenda-targeted hooks", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-oath | 8 | relationship | progressing | 9 | 揭开师债为何断裂 | 慢烧 | 师债需要跨更大弧线回收 |",
          "| guild-route | 1 | mystery | open | 2 | 查清商会路线背后的买家 | 近期 | 商会路线仍在旁支干扰 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 7 | Broken Letter | Lin Yue | A torn letter mentions the mentor | Lin Yue reopens the old oath | mentor-oath seeded | uneasy | mystery |",
          "| 8 | River Camp | Lin Yue | Mentor debt becomes personal | Lin Yue cannot let go | mentor-oath advanced | raw | confrontation |",
          "| 9 | Trial Echo | Lin Yue | Mentor left without explanation | Oath token matters again | mentor-oath advanced | aching | fallout |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book: {
        ...book,
        language: "zh",
      },
      bookDir,
      chapterNumber: 10,
      plan: {
        ...plan,
        intent: {
          ...plan.intent,
          chapter: 10,
          goal: "Bring the focus back to the mentor oath conflict.",
          hookAgenda: {
            pressureMap: [{
              hookId: "mentor-oath",
              type: "relationship",
              payoffTiming: "slow-burn",
              phase: "middle",
              pressure: "high",
              movement: "partial-payoff",
              reason: "stale-promise",
              blockSiblingHooks: true,
            }],
            mustAdvance: ["mentor-oath"],
            eligibleResolve: [],
            staleDebt: [],
            avoidNewHookFamilies: ["relationship"],
          },
        },
      },
    });

    const hookDebtEntry = result.contextPackage.selectedContext.find((entry) => entry.source === "runtime/hook_debt#mentor-oath");
    expect(hookDebtEntry).toBeDefined();
    expect(hookDebtEntry?.excerpt).toContain("mentor-oath");
    expect(hookDebtEntry?.excerpt).toContain("主要旧债");
    expect(hookDebtEntry?.excerpt).toContain("读者承诺");
    expect(hookDebtEntry?.excerpt).toContain("River Camp");
    expect(hookDebtEntry?.excerpt).toContain("Trial Echo");
  });

  it("localizes hook debt briefs for Korean governed context", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | 시작 화 | 유형 | 상태 | 최근 진행 | 예상 회수 | 회수 리듬 | 비고 |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-oath | 8 | relationship | progressing | 9 | 사제의 빚이 왜 끊겼는지 드러낸다 | slow | 오래 밀린 관계 부채 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 8 | 강가 야영 | 리엔 | 스승의 빚이 개인적 문제가 된다 | 리엔이 물러서지 못한다 | mentor-oath advanced | raw | confrontation |",
          "| 9 | 재판의 메아리 | 리엔 | 스승이 말없이 떠난 이유가 다시 걸린다 | 맹세패가 다시 중요해진다 | mentor-oath advanced | aching | fallout |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book: {
        ...book,
        language: "ko",
      },
      bookDir,
      chapterNumber: 10,
      plan: {
        ...plan,
        intent: {
          ...plan.intent,
          chapter: 10,
          goal: "스승의 빚 갈등을 다시 전면에 놓는다.",
          hookAgenda: {
            pressureMap: [{
              hookId: "mentor-oath",
              type: "relationship",
              payoffTiming: "slow-burn",
              phase: "middle",
              pressure: "high",
              movement: "partial-payoff",
              reason: "stale-promise",
              blockSiblingHooks: true,
            }],
            mustAdvance: ["mentor-oath"],
            eligibleResolve: [],
            staleDebt: [],
            avoidNewHookFamilies: ["relationship"],
          },
        },
      },
    });

    const hookDebtEntry = result.contextPackage.selectedContext.find((entry) => entry.source === "runtime/hook_debt#mentor-oath");
    expect(hookDebtEntry).toBeDefined();
    expect(hookDebtEntry?.reason).toContain("복선 부채 브리프");
    expect(hookDebtEntry?.excerpt).toContain("주요 부채");
    expect(hookDebtEntry?.excerpt).toContain("독자 약속");
    expect(hookDebtEntry?.excerpt).toContain("처음 심은 장면");
    expect(hookDebtEntry?.excerpt).toContain("최근 진전");
    expect(hookDebtEntry?.excerpt).not.toContain("读者承诺");
    expect(hookDebtEntry?.excerpt).not.toContain("主要旧债");
  });
});
