import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BookConfig } from "../models/book.js";
import { PlannerAgent } from "../agents/planner.js";

describe("PlannerAgent", () => {
  let root: string;
  let bookDir: string;
  let storyDir: string;
  let book: BookConfig;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-planner-test-"));
    bookDir = join(root, "books", "planner-book");
    storyDir = join(bookDir, "story");
    await mkdir(join(storyDir, "runtime"), { recursive: true });

    book = {
      id: "planner-book",
      title: "Planner Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 3000,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\nKeep the book emotionally centered on the mentor-student bond.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        "# Current Focus\n\nBring the focus back to the mentor conflict before opening new subplots.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "story_bible.md"),
        "# Story Bible\n\n- The jade seal cannot be destroyed.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n\n## Chapter 3\nTrack the merchant guild's escape route.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "book_rules.md"),
        "---\nprohibitions:\n  - Do not reveal the mastermind\n---\n\n# Book Rules\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        "# Current State\n\n- Lin Yue still hides the broken oath token.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        "# Chapter Summaries\n\n| 2 | Trial fallout | Mentor left without explanation |\n",
        "utf-8",
      ),
    ]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("uses current focus as the chapter goal when no outline node is available", async () => {
    await writeFile(
      join(storyDir, "volume_outline.md"),
      "# Volume Outline\n",
      "utf-8",
    );

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.goal).toContain("mentor conflict");
    await expect(readFile(result.runtimePath, "utf-8")).resolves.toContain("mentor conflict");
  });

  it("uses the episode starter direction instead of its markdown note as the chapter goal", async () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
      externalContext: [
        "# 이번 화 스타터",
        "",
        "> 짧은 초고 입력 문서다. Book Detail에서 초고를 쓸 때 current_focus.md보다 우선한다.",
        "",
        "## 이번 화 방향성",
        "",
        "주인공이 조사 콘티의 첫 단서를 따라가며 빚 독촉자를 직접 만난다.",
        "",
        "## 이번 화 콘티",
        "",
        "- 골목 입구에서 오래된 표식을 발견한다.",
        "- 빚 독촉자가 거래 조건을 꺼낸다.",
        "",
        "## 피할 것",
        "",
        "세계관 설명으로 시작하지 않는다.",
      ].join("\n"),
    });

    expect(result.intent.goal).toBe("주인공이 조사 콘티의 첫 단서를 따라가며 빚 독촉자를 직접 만난다.");
    expect(result.intent.goal).not.toContain("짧은 초고 입력 문서");
  });

  it("prefers a matched outline node over ordinary current focus text", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "Pull the next chapter back toward the mentor fallout instead of the guild route.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Chapter 3",
          "Track the merchant guild's escape route through the western canal.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.outlineNode).toContain("merchant guild's escape route");
    expect(result.intent.goal).toContain("merchant guild's escape route");
    expect(result.intent.goal).not.toContain("mentor fallout");
    expect(result.intent.conflicts).toEqual([]);
  });

  it("lets explicit local override focus beat the matched outline node", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "Keep pressure on the guild route in the background.",
          "",
          "## Local Override",
          "",
          "Stay inside the mentor debt confrontation first and delay the canal pursuit by one chapter.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Chapter 3",
          "Track the merchant guild's escape route through the western canal.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.outlineNode).toContain("merchant guild's escape route");
    expect(result.intent.goal).toContain("mentor debt confrontation");
    expect(result.intent.goal).not.toContain("merchant guild's escape route");
    expect(result.intent.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "outline_vs_current_focus",
        resolution: "allow explicit current focus override",
      }),
    ]));
  });

  it("keeps external context above both outline anchors and current focus", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "Pull the next chapter back toward the mentor fallout instead of the guild route.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Chapter 3",
          "Track the merchant guild's escape route through the western canal.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
      externalContext: "Ignore the canal pursuit for now and force the next chapter into the mentor debt confrontation.",
    });

    expect(result.intent.goal).toContain("mentor debt confrontation");
    expect(result.intent.goal).not.toContain("merchant guild's escape route");
    expect(result.intent.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "outline_vs_request",
        resolution: "allow local outline deferral",
      }),
    ]));
  });

  it("emits structured directives when fallback planning, chapter type repetition, and title collapse stack up", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Chapter 8",
          "Expose the registry clerk's hidden ledger in the floodgate archive.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Ledger in Rain | Taryn | Taryn checks the first false folio | None | hook advanced | tight | investigation |",
          "| 2 | Ledger at Dusk | Taryn | Taryn questions the dock clerk | None | hook advanced | tight | investigation |",
          "| 3 | Ledger Below | Taryn | Taryn searches the under-archive | None | hook advanced | tight | investigation |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 4,
    });

    expect(result.intent.arcDirective).toContain("fallback");
    expect(result.intent.sceneDirective).toContain("investigation");
    expect(result.intent.titleDirective?.toLowerCase()).toContain("ledger");
    expect(result.intent.moodDirective).toBeUndefined();
  });

  it("emits a mood directive when recent chapters are all high-tension", async () => {
    book = {
      ...book,
      genre: "other",
      language: "zh",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n\n## Chapter 5\n进入新的地点。\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | 暗巷追踪 | 周谨川 | 追踪目标 | None | none | 紧张、压抑 | 悬念验证章 |",
          "| 2 | 旧楼对峙 | 周谨川 | 对峙 | None | none | 冷硬、逼仄 | 冲突章 |",
          "| 3 | 夜色围堵 | 周谨川 | 围堵 | None | none | 肃杀、凝重 | 追击章 |",
          "| 4 | 地下通道 | 周谨川 | 逃脱 | None | none | 压迫、窒息 | 逃亡章 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 5,
    });

    expect(result.intent.moodDirective).toBeDefined();
    expect(result.intent.moodDirective).toContain("降调");
    expect(result.intent.moodDirective).toContain("日常");
  });

  it("does not emit a mood directive when recent moods are varied", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n\n## Chapter 5\nMove to the harbor.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Morning Calm | Taryn | A quiet walk | None | none | warm, gentle | slice-of-life |",
          "| 2 | Sudden Rain | Taryn | Storm arrives | None | none | tense, ominous | tension |",
          "| 3 | Harbor Light | Taryn | Finds shelter | None | none | hopeful, light | transition |",
          "| 4 | The Letter | Taryn | Reads bad news | None | none | melancholy, reflective | introspection |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 5,
    });

    expect(result.intent.moodDirective).toBeUndefined();
  });

  it("ignores the default current_focus placeholder and falls back to author intent when no chapter outline is available", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n",
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.goal).toContain("mentor-student bond");
    expect(result.intent.goal).not.toContain("Describe what the next 1-3 chapters should prioritize");
  });

  it("uses bullet-style volume outline chapter nodes as the fallback goal when control docs are placeholders", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "## Volume 1",
          "**Chapter range:** 1-8",
          "",
          "**Key turning points:**",
          "- **Chapter 3:** Track the merchant guild's escape route through the western canal.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.outlineNode).toContain("merchant guild's escape route");
    expect(result.intent.goal).toContain("merchant guild's escape route");
    expect(result.intent.goal).not.toContain("Advance chapter 3 with clear narrative focus.");
  });

  it("uses the next paragraph for bold standalone English chapter labels instead of capturing markdown markers", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "## Volume 1 - The Dead Examiner",
          "**Chapter Range:** 1-12",
          "",
          "**Key Turning Points:**",
          "- Ch1: Renn dies after summoning Taryn to review irregular treaty folios.",
          "",
          "### Golden First Three Chapters Rule",
          "",
          "**Chapter 2:**",
          "Show Taryn's edge through action, not exposition. He uses registry numbering logic to identify which folios are decoys and which conceal a ledger fragment.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 2,
    });

    expect(result.intent.outlineNode).toContain("Show Taryn's edge through action");
    expect(result.intent.outlineNode).not.toBe("**");
    expect(result.intent.goal).toContain("Show Taryn's edge through action");
    expect(result.intent.goal).not.toBe("**");
  });

  it("does not confuse Chapter 1 with Chapter 10 when matching exact English chapter labels", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "### Chapter 10",
          "This late-volume node should not be selected for chapter one.",
          "",
          "### Chapter 1",
          "Open with the dead examiner and the sealed folio dispute.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 1,
    });

    expect(result.intent.outlineNode).toContain("dead examiner");
    expect(result.intent.outlineNode).not.toContain("late-volume");
    expect(result.intent.goal).toContain("dead examiner");
  });

  it("uses inline Chinese exact chapter labels with a title suffix", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "第 7 章：在码头接头并截住逃跑账房。",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 7,
    });

    expect(result.intent.outlineNode).toContain("在码头接头");
    expect(result.intent.goal).toContain("在码头接头");
    expect(result.intent.goal).not.toContain("Describe the long-horizon vision");
  });

  it("uses standalone Chinese chapter-range labels when the chapter falls inside the range", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "第1-6章",
          "Stay with the early city setup and mentor fallout.",
          "",
          "第7-20章",
          "Track the merchant guild's escape route through the western canal.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 7,
    });

    expect(result.intent.outlineNode).toContain("merchant guild's escape route");
    expect(result.intent.goal).toContain("merchant guild's escape route");
    expect(result.intent.goal).not.toContain("Describe the long-horizon vision");
  });

  it("uses standalone English chapter-range labels at the start of the range", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "Chapter 1-3",
          "Keep the opening pressure on the first examiner.",
          "",
          "Chapter 4-6",
          "Recover the sealed ledger before dawn.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 4,
    });

    expect(result.intent.outlineNode).toContain("sealed ledger");
    expect(result.intent.goal).toContain("sealed ledger");
    expect(result.intent.outlineNode).not.toContain("6");
    expect(result.intent.goal).not.toContain("Describe the long-horizon vision");
  });

  it("uses the next paragraph for bold standalone English chapter-range labels instead of bleeding into the next range", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "**Chapter 1-3:**",
          "Keep the opening pressure on the first examiner.",
          "",
          "**Chapter 4-6:**",
          "Recover the sealed ledger before dawn.",
          "",
          "**Chapter 7-9:**",
          "Trigger the registry fire and expose the false witness.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 4,
    });

    expect(result.intent.outlineNode).toContain("sealed ledger");
    expect(result.intent.outlineNode).not.toContain("registry fire");
    expect(result.intent.goal).toContain("sealed ledger");
  });

  it("falls back to the first outline directive when no standalone range matches", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "第1-6章",
          "Stay with the early city setup and mentor fallout.",
          "",
          "第7-20章",
          "Track the merchant guild's escape route through the western canal.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 25,
    });

    expect(result.intent.outlineNode).toContain("Stay with the early city setup");
    expect(result.intent.goal).toContain("Stay with the early city setup");
    expect(result.intent.outlineNode).not.toBe("第1-6章");
    expect(result.intent.goal).not.toContain("merchant guild's escape route");
  });

  it("preserves hard facts from state and canon in mustKeep", async () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.mustKeep).toContain("Lin Yue still hides the broken oath token.");
    expect(result.intent.mustKeep).toContain("The jade seal cannot be destroyed.");
  });

  it("records conflicts when the external request diverges from the outline", async () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
      externalContext: "Ignore the guild chase and bring the focus back to mentor conflict.",
    });

    expect(result.intent.conflicts).toHaveLength(1);
    expect(result.intent.conflicts[0]?.type).toBe("outline_vs_request");
    await expect(readFile(result.runtimePath, "utf-8")).resolves.toContain("outline_vs_request");
  });

  it("writes compact memory snapshots instead of inlining the full history", async () => {
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
          "| 2 | City Watch | Patrols sweep the market | Search widens | None | guild-route advanced | urgent | investigation |",
          "| 3 | Seal Vault | Lin Yue finds the seal vault | The jade seal returns | Seal secured | old-seal resolved | solemn | reveal |",
          "| 4 | Empty Road | The group loses the convoy | Doubts grow | Travel fatigue | none | grim | travel |",
          "| 5 | Burned Shrine | Shrine clues point nowhere | Friction rises | Lin Yue distrusts allies | none | bitter | setback |",
          "| 6 | Quiet Ledger | Merchant records stay hidden | No breakthrough | Cash runs thin | none | weary | transition |",
          "| 7 | Broken Letter | A torn letter mentions the mentor | Suspicion returns | Lin Yue reopens the old oath | mentor-oath seeded | uneasy | mystery |",
          "| 8 | River Camp | Lin Yue meets old witnesses | Mentor debt becomes personal | Lin Yue cannot let go | mentor-oath advanced | raw | confrontation |",
          "| 9 | Trial Echo | The trial fallout resurfaces | Mentor left without explanation | Oath token matters again | mentor-oath advanced | aching | fallout |",
          "| 10 | Locked Gate | Lin Yue chooses the mentor line over the guild line | Mentor conflict takes priority | Oath token is still hidden | mentor-oath advanced | focused | decision |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 11,
      externalContext: "Bring the focus back to the mentor oath conflict with Lin Yue.",
    });

    const intentMarkdown = await readFile(result.runtimePath, "utf-8");
    expect(intentMarkdown).toContain("mentor-oath");
    expect(intentMarkdown).toContain("| 10 | Locked Gate |");
    expect(intentMarkdown).not.toContain("| 1 | Guild Trail |");
    expect(intentMarkdown).not.toContain("| old-seal | 3 | artifact | resolved |");
  });

  it("renders English memory snapshot headers for English books", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };
    await Promise.all([
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-oath | 8 | relationship | open | 9 | 11 | Mentor oath debt with Lin Yue |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 10 | Locked Gate | Lin Yue | Lin Yue chooses the mentor line over the guild line | Mentor conflict takes priority | mentor-oath advanced | focused | decision |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 11,
      externalContext: "Bring the focus back to the mentor oath conflict with Lin Yue.",
    });

    const intentMarkdown = await readFile(result.runtimePath, "utf-8");
    expect(intentMarkdown).toContain("| hook_id | start_chapter | type | status | last_advanced | expected_payoff | payoff_timing | notes |");
    expect(intentMarkdown).toContain("| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |");
    expect(intentMarkdown).not.toContain("| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |");
    expect(intentMarkdown).not.toContain("| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |");
  });

  it("derives structured current_focus markdown into goal, avoids, and style emphasis", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "- Bring the focus back to Lin Yue's private confrontation with the mentor debt.",
          "- Keep the chapter centered on a missing record, not a whole-conspiracy overview.",
          "- Surface one concrete evidence trail the next chapter can pursue.",
          "",
          "## Avoid",
          "",
          "- Do not turn this chapter into a citywide survey of every faction.",
          "- Do not use summary-heavy moralizing paragraphs.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "story_bible.md"),
        [
          "# Story Bible",
          "",
          "- --",
          "- The jade seal cannot be destroyed.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n",
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 2,
    });

    expect(result.intent.goal).toContain("private confrontation");
    expect(result.intent.goal).toContain("missing record");
    expect(result.intent.mustAvoid).toEqual(expect.arrayContaining([
      "Do not turn this chapter into a citywide survey of every faction.",
      "Do not use summary-heavy moralizing paragraphs.",
    ]));
    expect(result.intent.mustAvoid).not.toContain(
      "Keep the chapter centered on a missing record, not a whole-conspiracy overview.",
    );
    expect(result.intent.styleEmphasis).toEqual(expect.arrayContaining([
      "Bring the focus back to Lin Yue's private confrontation with the mentor debt.",
      "Surface one concrete evidence trail the next chapter can pursue.",
    ]));
    expect(result.intent.mustKeep).not.toContain("--");
  });

  it("emits hook agenda into chapter intent and runtime markdown", async () => {
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 25,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 25,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
          hooks: [
            {
              hookId: "recent-route",
              startChapter: 23,
              type: "route",
              status: "open",
              lastAdvancedChapter: 25,
              expectedPayoff: "Recent route payoff",
              notes: "Recent route remains active.",
            },
            {
              hookId: "ready-payoff",
              startChapter: 12,
              type: "mystery",
              status: "progressing",
              lastAdvancedChapter: 24,
              expectedPayoff: "Reveal the hidden room mastermind",
              notes: "The chapter is close to the reveal point.",
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
        }, null, 2),
        "utf-8",
      ),
    ]);

    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 26,
      externalContext: "Keep the chapter on the mainline debt conflict.",
    });

    expect(result.intent.hookAgenda.mustAdvance).toEqual(["stale-debt", "ready-payoff"]);
    expect(result.intent.hookAgenda.eligibleResolve).toEqual(["ready-payoff"]);
    expect(result.intent.hookAgenda.staleDebt).toEqual(["stale-debt"]);
    expect(result.intent.hookAgenda.avoidNewHookFamilies).toContain("relationship");
    expect(result.intent.hookAgenda.pressureMap).toEqual([]);

    const intentMarkdown = await readFile(result.runtimePath, "utf-8");
    expect(intentMarkdown).toContain("## Hook Agenda");
    expect(intentMarkdown).toContain("ready-payoff");
    expect(intentMarkdown).toContain("stale-debt");
  });

  it("extracts Korean narrative-engine and opening directives from prose author intent", async () => {
    book = {
      ...book,
      genre: "other",
      language: "ko",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        [
          "# 작가 의도",
          "",
          "핵심 엔진은 주인공의 진지한 마왕 컨셉 행동이 주변에 의해 거대한 대계로 오해되고, 그 오해가 실제 정치적 성과를 낳는 구조다.",
          "톤은 진지 7, 블랙코미디 3이다.",
          "초반에는 빙의 직후 첫 착각극을 세우고, 이후 용사 파티 잠입으로 이어지는 구조를 바탕으로 설계한다.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# 현재 포커스",
          "",
          "## 현재 중점",
          "",
          "1화에서는 빙의 사실과 마왕 역할 유지 공포를 먼저 드러낸다.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# 볼륨 아웃라인\n",
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 1,
    });

    expect(result.intent.engineDirectives.join("\n")).toContain("오해");
    expect(result.intent.engineDirectives.join("\n")).toContain("마왕 컨셉");
    expect(result.intent.moodDirective).toContain("블랙코미디 3");
    expect(result.intent.sceneDirective).toContain("첫 착각극");
    await expect(readFile(result.runtimePath, "utf-8")).resolves.toContain("## Narrative Engine");
  });

  it("extracts chapter-one directives from markdown tables instead of falling back to header rows", async () => {
    book = {
      ...book,
      genre: "other",
      language: "ko",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        [
          "# 작가 의도",
          "",
          "정치 판타지/착각물/다크 판타지/잠입 서사 성격이 강하다.",
          "미래에 토벌당할 마왕의 몸에 빙의한 주인공은 세계 정복 자체보다 마왕이라는 역할을 끝까지 유지한 채 세계의 판을 물밑에서 주무르는 데 더 큰 흥미를 느낀다.",
          "핵심 엔진은 주인공의 진지한 마왕 컨셉 행동이 주변에 의해 거대한 대계로 오해되고, 그 오해가 실제 정치적 성과를 낳는 구조다.",
          "초반에는 빙의 직후 첫 착각극을 세우고, 이후 용사 파티 잠입으로 이어지는 구조를 바탕으로 설계한다.",
          "",
        ].join("\n"),
        "utf-8",
      ),
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
        join(storyDir, "volume_outline.md"),
        [
          "# 볼륨 아웃라인",
          "",
          "| 권 제목 | 화수 범위 | 핵심 갈등 | 주요 전환점 | 회수 목표 |",
          "| --- | --- | --- | --- | --- |",
          "| 1권 왕좌 위 첫날 | 1-20 | 빙의 직후 약함을 숨기고 첫 궁정 심판을 버텨야 한다 | 첫 심판에서 하급 기록관 네렌을 살리고 승전 귀족을 처형해 궁정을 얼린다; 브라카스와 첫 공개 충돌 | 왕좌 이미지 확립 |",
          "",
          "### 초반 3화 설계",
          "- **1화**: 흑요궁 혈좌조회 한가운데서 시작한다. 카시르는 빙의 직후, 반역 혐의로 끌려온 하급 기록관 네렌과 전공을 내세운 귀족 장수 중 누구를 살리고 누구를 버릴지 즉시 판결해야 한다.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 1,
    });

    expect(result.intent.goal).toContain("흑요궁 혈좌조회");
    expect(result.intent.goal).not.toContain("| 권 제목 |");
    expect(result.intent.outlineNode).toContain("흑요궁 혈좌조회");
    expect(result.intent.sceneDirective).toContain("빙의 직후");
    expect(result.intent.sceneDirective).toContain("첫 착각극");
  });

  it("builds stale debt agenda from broader active hooks than the retrieval subset", async () => {
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 25,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 25,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
          hooks: [
            {
              hookId: "recent-route",
              startChapter: 23,
              type: "route",
              status: "open",
              lastAdvancedChapter: 25,
              expectedPayoff: "Recent route payoff",
              notes: "Keep the route central.",
            },
            {
              hookId: "recent-guild",
              startChapter: 22,
              type: "politics",
              status: "progressing",
              lastAdvancedChapter: 24,
              expectedPayoff: "Guild pressure payoff",
              notes: "Guild pressure remains active.",
            },
            {
              hookId: "recent-token",
              startChapter: 21,
              type: "artifact",
              status: "open",
              lastAdvancedChapter: 23,
              expectedPayoff: "Token route payoff",
              notes: "Token route remains active.",
            },
            {
              hookId: "stale-omega",
              startChapter: 3,
              type: "relationship",
              status: "open",
              lastAdvancedChapter: 8,
              expectedPayoff: "Old debt payoff",
              notes: "Dormant unresolved line.",
            },
            {
              hookId: "stale-sable",
              startChapter: 4,
              type: "mystery",
              status: "open",
              lastAdvancedChapter: 9,
              expectedPayoff: "Archive payoff",
              notes: "Another dormant unresolved line.",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
    ]);

    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 26,
      externalContext: "Keep the chapter on the route pressure.",
    });

    expect(result.intent.hookAgenda.mustAdvance).toEqual(["stale-omega", "stale-sable"]);
    expect(result.intent.hookAgenda.staleDebt).toEqual(["stale-omega", "stale-sable"]);
    expect(result.intent.hookAgenda.avoidNewHookFamilies).toEqual(expect.arrayContaining([
      "relationship",
      "mystery",
    ]));
    expect(result.intent.hookAgenda.pressureMap).toEqual([]);
  });

  it("renders hook budget from total active hooks instead of the selected hook snapshot", async () => {
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    const hooks = Array.from({ length: 12 }, (_, index) => ({
      hookId: `hook-${index + 1}`,
      startChapter: index + 1,
      type: index < 6 ? "route" : "mystery",
      status: "open",
      lastAdvancedChapter: index < 6 ? 25 - index : 12 - index,
      expectedPayoff: index < 6 ? "Route debt payoff" : "Dormant mystery payoff",
      notes: index < 6
        ? `Route pressure thread ${index + 1} stays relevant.`
        : `Dormant thread ${index + 1} should not be selected into the primary context.`,
    }));

    await Promise.all([
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 25,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 25,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({ hooks }, null, 2),
        "utf-8",
      ),
    ]);

    book = {
      ...book,
      genre: "other",
      language: "en",
      targetChapters: 40,
    };

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 26,
      externalContext: "Keep the chapter on the route pressure.",
    });

    const intentMarkdown = await readFile(result.runtimePath, "utf-8");
    expect(intentMarkdown).toContain("12 active hooks");
    expect(intentMarkdown).not.toContain("8 active hooks");
  });

  it("builds cadence directives in Korean for Korean books", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const directives = (planner as unknown as {
      buildStructuredDirectives: (input: {
        chapterNumber: number;
        language?: string;
        volumeOutline: string;
        outlineNode: string | undefined;
        matchedOutlineAnchor: boolean;
        chapterSummaries: string;
      }) => {
        sceneDirective?: string;
        moodDirective?: string;
        titleDirective?: string;
      };
    }).buildStructuredDirectives({
      chapterNumber: 5,
      language: "ko",
      volumeOutline: "# 볼륨 아웃라인\n",
      outlineNode: "주인공이 첫 군단 간부를 포섭한다.",
      matchedOutlineAnchor: false,
      chapterSummaries: [
        "# 회차 요약",
        "",
        "| 회차 | 제목 | 등장인물 | 핵심 사건 | 상태 변화 | 복선 동향 | 정서 | 회차 유형 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 피의 계약 | 한지한 | 대치가 시작된다 | 마왕의 경계심이 오른다 | 첫 계약 복선 | 긴장 | 대치 |",
        "| 2 | 피의 맹세 | 한지한 | 다시 대치한다 | 신뢰가 흔들린다 | 맹세 복선 | 긴장 | 대치 |",
        "| 3 | 피의 문장 | 한지한 | 또다시 대치한다 | 압박이 누적된다 | 문장 복선 | 긴장 | 대치 |",
        "| 4 | 피의 밤 | 한지한 | 밀실 대치가 이어진다 | 주도권이 흔들린다 | 밤의 복선 | 긴장 | 대치 |",
      ].join("\n"),
    });

    expect(directives.sceneDirective).toContain("이번 화는 장면 그릇");
    expect(directives.moodDirective).toContain("독자가 숨 돌릴 틈");
    expect(directives.titleDirective).toContain("제목을 또");
  });
});
