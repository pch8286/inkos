import { chatWithTools, type AgentMessage, type ToolDefinition } from "../llm/provider.js";
import { PipelineRunner, type PipelineConfig } from "./runner.js";
import type { Platform, Genre } from "../models/book.js";
import { DEFAULT_REVISE_MODE, type ReviseMode } from "../agents/reviser.js";
import { isWritingLanguage, type WritingLanguage } from "../models/language.js";

/** Tool definitions for the agent loop. */
const TOOLS: ReadonlyArray<ToolDefinition> = [
  {
    name: "write_draft",
    description: "Write the next chapter draft only. Continue strictly from the latest chapter; do not fill historical gaps or choose an arbitrary chapter number.",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "Book ID" },
        guidance: { type: "string", description: "Optional chapter guidance in natural language" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "plan_chapter",
    description: "Generate the next chapter intent before writing. Use this to inspect goals, required beats, and conflicts.",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "Book ID" },
        guidance: { type: "string", description: "Optional extra guidance for this chapter" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "compose_chapter",
    description: "Build runtime context, rule stack, and trace artifacts for the next chapter before drafting.",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "Book ID" },
        guidance: { type: "string", description: "Optional extra guidance for this chapter" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "audit_chapter",
    description: "Audit a chapter for continuity, characterization, numerical consistency, hooks, and related issues.",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "Book ID" },
        chapterNumber: { type: "number", description: "Chapter number; audits the latest chapter when omitted" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "revise_chapter",
    description: "Revise an existing chapter for prose quality without changing plot direction. This is not for filling missing chapters or changing chapter numbers.",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "Book ID" },
        chapterNumber: { type: "number", description: "Chapter number; revises the latest chapter when omitted" },
        mode: { type: "string", enum: ["polish", "rewrite", "rework", "spot-fix", "anti-detect"], description: `Revision mode (default ${DEFAULT_REVISE_MODE})` },
      },
      required: ["bookId"],
    },
  },
  {
    name: "scan_market",
    description: "Scan live market trends from platform rankings and analyze the results.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "create_book",
    description: "Create a new book and generate its foundation, including story bible, volume outline, and book rules.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Book title" },
        genre: { type: "string", description: "Genre ID; uses language defaults when omitted" },
        platform: { type: "string", description: "Platform ID; uses language defaults when omitted" },
        language: {
          type: "string",
          enum: ["ko", "zh", "en"],
          description: "Writing language; defaults to ko",
        },
        brief: { type: "string", description: "Creative brief or requirements in natural language" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_author_intent",
    description: "Replace the long-term book intent document `author_intent.md`.",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "Book ID" },
        content: { type: "string", description: "Full new content for author_intent.md" },
      },
      required: ["bookId", "content"],
    },
  },
  {
    name: "update_current_focus",
    description: "Replace the short-horizon steering document `current_focus.md` for the next few chapters.",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "Book ID" },
        content: { type: "string", description: "Full new content for current_focus.md" },
      },
      required: ["bookId", "content"],
    },
  },
  {
    name: "get_book_status",
    description: "Return a book status overview, including chapter count, total words, and recent audit state.",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "Book ID" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "read_truth_files",
    description: "Read the book's long-term memory files plus story bible and volume outline.",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "Book ID" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "list_books",
    description: "List all books in the project.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "write_full_pipeline",
    description: "Run the full pipeline: write draft, audit it, and auto-revise if needed.",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "Book ID" },
        count: { type: "number", description: "How many consecutive chapters to generate (default 1)" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "web_fetch",
    description: "Fetch readable text content from a URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        maxChars: { type: "number", description: "Maximum characters to return (default 8000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "import_style",
    description: "Generate a style guide from reference text and save `style_profile.json` plus `style_guide.md`.",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "Target book ID" },
        referenceText: { type: "string", description: "Reference text (at least 2000 characters)" },
      },
      required: ["bookId", "referenceText"],
    },
  },
  {
    name: "import_canon",
    description: "Import canon from a parent book into `parent_canon.md` for spinoff writing and audit modes.",
    parameters: {
      type: "object",
      properties: {
        targetBookId: { type: "string", description: "Spinoff book ID" },
        parentBookId: { type: "string", description: "Parent canon book ID" },
      },
      required: ["targetBookId", "parentBookId"],
    },
  },
  {
    name: "import_chapters",
    description: "Whole-book reimport. Split an existing manuscript into chapters, analyze them, and rebuild truth files. Not for patching a single missing chapter.",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "Target book ID" },
        text: { type: "string", description: "Full manuscript text containing multiple chapters" },
        splitPattern: { type: "string", description: "Optional chapter split regex" },
      },
      required: ["bookId", "text"],
    },
  },
  {
    name: "write_truth_file",
    description: "Replace a truth file with full new content. Use for planned rule or outline edits, not for hacking progress or filling missing chapters.",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string", description: "Book ID" },
        fileName: { type: "string", description: "Truth file name, such as volume_outline.md or story_bible.md" },
        content: { type: "string", description: "Full replacement content" },
      },
      required: ["bookId", "fileName", "content"],
    },
  },
];

export interface AgentLoopOptions {
  readonly onToolCall?: (name: string, args: Record<string, unknown>) => void;
  readonly onToolResult?: (name: string, result: string) => void;
  readonly onMessage?: (content: string) => void;
  readonly maxTurns?: number;
}

export function buildAgentSystemPrompt(): string {
  return `You are the InkOS fiction-writing agent. The user is a novelist, and you manage the workflow from book creation to finished chapters.

## Tools

| Tool | Purpose |
|------|---------|
| list_books | List all books |
| get_book_status | Inspect chapter count, word count, and audit state |
| read_truth_files | Read long-term memory plus story bible, outline, and book rules |
| create_book | Create a new book and generate its foundation from the genre profile |
| plan_chapter | Generate the next chapter intent before drafting |
| compose_chapter | Build runtime context and rule stack before drafting |
| write_draft | Write only the next chapter after the latest existing chapter |
| audit_chapter | Audit a chapter across continuity, heuristics, and quality dimensions |
| revise_chapter | Revise an existing chapter without changing plot direction |
| update_author_intent | Replace the long-term book intent document |
| update_current_focus | Replace the short-horizon steering document |
| write_full_pipeline | Run write → audit → revise in one step |
| scan_market | Analyze live platform market trends |
| web_fetch | Fetch readable text from a URL |
| import_style | Build a style guide from reference text |
| import_canon | Import canon from a parent book for spinoff mode |
| import_chapters | Reimport a full manuscript and rebuild truth files |
| write_truth_file | Replace a truth file in full |

## Long-Term Memory

Each book has two steering documents:
- **author_intent.md** — what this book wants to become over the long run
- **current_focus.md** — where the next 1-3 chapters should focus

Seven long-term memory files provide the factual basis for writing and auditing:
- **current_state.md** — current locations, relationships, known facts, and conflicts
- **particle_ledger.md** — items and resources with accountable deltas
- **pending_hooks.md** — planted hooks, progress, and expected payoff cadence
- **chapter_summaries.md** — compressed per-chapter summaries
- **subplot_board.md** — subplot progress board
- **emotional_arcs.md** — character emotional arcs
- **character_matrix.md** — interaction matrix and information boundaries

## Pipeline Logic

- If audit_chapter returns passed=true, revision is unnecessary.
- If audit_chapter returns passed=false with critical issues, use revise_chapter, then optionally audit again.
- write_full_pipeline automatically runs write → audit → revise and is best when no manual intervention is needed.

## Rules

- If the user provides a concept or genre without explicitly asking for market scanning, skip scan_market and go straight to create_book.
- If the user already gave a title or bookId, act directly instead of calling list_books first.
- Briefly report progress after each major step.
- If the user wants to pull focus back to a specific thread, prefer update_current_focus, then plan_chapter or compose_chapter, then decide whether to draft.
- When the brief, spec, or chapter guidance is ambiguous enough that the draft direction could change, briefly align with the user first: restate your current understanding, name the ambiguity, and propose a default direction.
- If plan_chapter or compose_chapter reports needsUserAlignment=true, briefly align with the user first and wait for confirmation or corrected guidance.
- Do not call write_draft or write_full_pipeline while that ambiguity is unresolved.
- Style imitation flow: reference text → import_style → future drafting uses the generated style guide.
- Spinoff flow: create_book → import_canon → normal drafting.
- Continuation flow from existing manuscript: import_chapters → write_draft.

## Hard Constraints

- Never use write_draft to fill historical gaps. It can only write the next chapter after the latest existing chapter.
- Never use import_chapters to patch a single missing chapter. It is a whole-book reimport tool.
- Never use write_truth_file to hack current_state.md progress and force the system to jump chapters.
- Never use revise_chapter to create missing chapters or change chapter numbers.
- If the user asks to fill chapter N or says chapter N is empty, inspect real state first with get_book_status and read_truth_files.
- Do not call writing tools before you have confirmed the book state.`;
}

export async function runAgentLoop(
  config: PipelineConfig,
  instruction: string,
  options?: AgentLoopOptions,
): Promise<string> {
  const pipeline = new PipelineRunner(config);
  const { StateManager } = await import("../state/manager.js");
  const state = new StateManager(config.projectRoot);

  const messages: AgentMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt(),
    },
    { role: "user", content: instruction },
  ];

  const maxTurns = options?.maxTurns ?? 20;
  let lastAssistantMessage = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    const result = await chatWithTools(config.client, config.model, messages, TOOLS, {
      projectRoot: config.projectRoot,
    });

    // Push assistant message to history
    messages.push({
      role: "assistant" as const,
      content: result.content || null,
      ...(result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {}),
    });

    if (result.content) {
      lastAssistantMessage = result.content;
      options?.onMessage?.(result.content);
    }

    // If no tool calls, we're done
    if (result.toolCalls.length === 0) break;

    // Execute tool calls
    for (const toolCall of result.toolCalls) {
      let toolResult: string;
      try {
        const args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
        options?.onToolCall?.(toolCall.name, args);
        toolResult = await executeTool(pipeline, state, config, toolCall.name, args);
      } catch (e) {
        toolResult = JSON.stringify({ error: String(e) });
      }

      options?.onToolResult?.(toolCall.name, toolResult);
      messages.push({ role: "tool" as const, toolCallId: toolCall.id, content: toolResult });
    }
  }

  return lastAssistantMessage;
}

export async function executeAgentTool(
  pipeline: PipelineRunner,
  state: import("../state/manager.js").StateManager,
  config: PipelineConfig,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "plan_chapter": {
      const result = await pipeline.planChapter(
        args.bookId as string,
        args.guidance as string | undefined,
      );
      return JSON.stringify(result);
    }

    case "compose_chapter": {
      const result = await pipeline.composeChapter(
        args.bookId as string,
        args.guidance as string | undefined,
      );
      return JSON.stringify(result);
    }

    case "write_draft": {
      const bookId = args.bookId as string;
      const writeGuardError = await getSequentialWriteGuardError(state, bookId, "write_draft");
      if (writeGuardError) {
        return JSON.stringify({ error: writeGuardError });
      }
      const result = await pipeline.writeDraft(
        bookId,
        args.guidance as string | undefined,
      );
      return JSON.stringify(result);
    }

    case "audit_chapter": {
      const result = await pipeline.auditDraft(
        args.bookId as string,
        args.chapterNumber as number | undefined,
      );
      return JSON.stringify(result);
    }

    case "revise_chapter": {
      // Guard: target chapter must exist and have content
      const bookId = args.bookId as string;
      const chapterNum = args.chapterNumber as number | undefined;
      if (chapterNum !== undefined) {
        const index = await state.loadChapterIndex(bookId);
        const chapter = index.find((ch) => ch.number === chapterNum);
        if (!chapter) {
          return JSON.stringify({ error: `第${chapterNum}章不存在。revise_chapter 只能修订已有章节，不能用来补写缺失章节。请用 get_book_status 确认。` });
        }
        if (chapter.wordCount === 0) {
          return JSON.stringify({ error: `第${chapterNum}章内容为空（0字）。revise_chapter 不能修订空章节。` });
        }
      }
      const result = await pipeline.reviseDraft(
        bookId,
        chapterNum,
        (args.mode as ReviseMode) ?? DEFAULT_REVISE_MODE,
      );
      return JSON.stringify(result);
    }

    case "scan_market": {
      const result = await pipeline.runRadar();
      return JSON.stringify(result);
    }

    case "create_book": {
      const now = new Date().toISOString();
      const title = args.title as string;
      const language = resolveCreateBookLanguage(args.language);
      const bookId = slugifyBookId(title);

      const book = {
        id: bookId,
        title,
        platform: resolveCreateBookPlatform(args.platform, language),
        genre: resolveCreateBookGenre(args.genre, language),
        language,
        status: "outlining" as const,
        targetChapters: 200,
        chapterWordCount: 3000,
        createdAt: now,
        updatedAt: now,
      };

      const brief = args.brief as string | undefined;
      if (brief) {
        const contextPipeline = new PipelineRunner({ ...config, externalContext: brief });
        await contextPipeline.initBook(book);
      } else {
        await pipeline.initBook(book);
      }

      return JSON.stringify({ bookId, title, status: "created" });
    }

    case "get_book_status": {
      const result = await pipeline.getBookStatus(args.bookId as string);
      return JSON.stringify(result);
    }

    case "update_author_intent": {
      await state.ensureControlDocuments(args.bookId as string);
      const { writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const storyDir = join(state.bookDir(args.bookId as string), "story");
      await writeFile(join(storyDir, "author_intent.md"), args.content as string, "utf-8");
      return JSON.stringify({ bookId: args.bookId, file: "story/author_intent.md", written: true });
    }

    case "update_current_focus": {
      await state.ensureControlDocuments(args.bookId as string);
      const { writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const storyDir = join(state.bookDir(args.bookId as string), "story");
      await writeFile(join(storyDir, "current_focus.md"), args.content as string, "utf-8");
      return JSON.stringify({ bookId: args.bookId, file: "story/current_focus.md", written: true });
    }

    case "read_truth_files": {
      const result = await pipeline.readTruthFiles(args.bookId as string);
      return JSON.stringify(result);
    }

    case "list_books": {
      const bookIds = await state.listBooks();
      const books = await Promise.all(
        bookIds.map(async (id) => {
          try {
            return await pipeline.getBookStatus(id);
          } catch {
            return { bookId: id, error: "failed to load" };
          }
        }),
      );
      return JSON.stringify(books);
    }

    case "write_full_pipeline": {
      const bookId = args.bookId as string;
      const writeGuardError = await getSequentialWriteGuardError(state, bookId, "write_full_pipeline");
      if (writeGuardError) {
        return JSON.stringify({ error: writeGuardError });
      }
      const count = (args.count as number) ?? 1;
      const results = [];
      for (let i = 0; i < count; i++) {
        const result = await pipeline.writeNextChapter(bookId);
        results.push(result);
      }
      return JSON.stringify(results);
    }

    case "web_fetch": {
      const { fetchUrl } = await import("../utils/web-search.js");
      const text = await fetchUrl(args.url as string, (args.maxChars as number) ?? 8000);
      return JSON.stringify({ url: args.url, content: text });
    }

    case "import_style": {
      const guide = await pipeline.generateStyleGuide(
        args.bookId as string,
        args.referenceText as string,
      );
      return JSON.stringify({
        bookId: args.bookId,
        statsProfile: "story/style_profile.json",
        styleGuide: "story/style_guide.md",
        guidePreview: guide.slice(0, 500),
      });
    }

    case "import_canon": {
      const canon = await pipeline.importCanon(
        args.targetBookId as string,
        args.parentBookId as string,
      );
      return JSON.stringify({
        targetBookId: args.targetBookId,
        parentBookId: args.parentBookId,
        output: "story/parent_canon.md",
        canonPreview: canon.slice(0, 500),
      });
    }

    case "import_chapters": {
      const { splitChapters } = await import("../utils/chapter-splitter.js");
      const chapters = splitChapters(
        args.text as string,
        args.splitPattern as string | undefined,
      );
      if (chapters.length === 0) {
        return JSON.stringify({ error: "No chapters found. Check text format or provide a splitPattern." });
      }
      // Guard: import_chapters is a whole-book reimport, not a single-chapter patch
      if (chapters.length === 1) {
        return JSON.stringify({ error: "import_chapters 是整书重导工具，需要至少 2 个章节。如果只想补一章，请用 write_draft 续写或 revise_chapter 修订。" });
      }
      const result = await pipeline.importChapters({
        bookId: args.bookId as string,
        chapters: [...chapters],
      });
      return JSON.stringify(result);
    }

    case "write_truth_file": {
      const bookId = args.bookId as string;
      const fileName = args.fileName as string;
      const content = args.content as string;

      // Whitelist allowed truth files
      const ALLOWED_FILES = [
        "story_bible.md", "volume_outline.md", "book_rules.md",
        "current_state.md", "particle_ledger.md", "pending_hooks.md",
        "chapter_summaries.md", "subplot_board.md", "emotional_arcs.md",
        "character_matrix.md", "style_guide.md",
      ];

      if (!ALLOWED_FILES.includes(fileName)) {
        return JSON.stringify({ error: `不允许修改文件 "${fileName}"。允许的文件：${ALLOWED_FILES.join(", ")}` });
      }

      // Guard: block chapter progress manipulation via current_state.md
      if (fileName === "current_state.md" && containsProgressManipulation(content)) {
        return JSON.stringify({ error: "不允许通过 write_truth_file 修改 current_state.md 中的章节进度。章节进度由系统自动管理。" });
      }

      const { writeFile, mkdir } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const bookDir = new (await import("../state/manager.js")).StateManager(config.projectRoot).bookDir(bookId);
      const storyDir = join(bookDir, "story");
      await mkdir(storyDir, { recursive: true });
      await writeFile(join(storyDir, fileName), content, "utf-8");

      return JSON.stringify({
        bookId,
        file: `story/${fileName}`,
        written: true,
        size: content.length,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

async function executeTool(
  pipeline: PipelineRunner,
  state: import("../state/manager.js").StateManager,
  config: PipelineConfig,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  return executeAgentTool(pipeline, state, config, name, args);
}

async function getSequentialWriteGuardError(
  state: import("../state/manager.js").StateManager,
  bookId: string,
  toolName: "write_draft" | "write_full_pipeline",
): Promise<string | null> {
  const nextNum = await state.getNextChapterNumber(bookId);
  const index = await state.loadChapterIndex(bookId);
  if (index.length === 0) return null;
  const lastIndexedChapter = index[index.length - 1]!.number;
  if (lastIndexedChapter === nextNum - 1) return null;
  return `${toolName} 只能续写下一章（当前应写第${nextNum}章）。检测到章节索引与运行时进度不一致，请先用 get_book_status 确认状态。`;
}

function containsProgressManipulation(content: string): boolean {
  const patterns = [
    /\blastAppliedChapter\b/i,
    /\|\s*Current Chapter\s*\|\s*\d+\s*\|/i,
    /\|\s*当前章(?:节)?\s*\|\s*\d+\s*\|/,
    /\bCurrent Chapter\b\s*[:：]\s*\d+/i,
    /当前章(?:节)?\s*[:：]\s*\d+/,
    /\bprogress\b\s*[:：]\s*\d+/i,
    /进度\s*[:：]\s*\d+/,
  ];
  return patterns.some((pattern) => pattern.test(content));
}

const CREATE_BOOK_DEFAULTS: Record<WritingLanguage, { platform: Platform; genre: Genre }> = {
  ko: {
    platform: "naver-series",
    genre: "modern-fantasy",
  },
  zh: {
    platform: "tomato",
    genre: "xuanhuan",
  },
  en: {
    platform: "other",
    genre: "progression",
  },
};

function resolveCreateBookLanguage(language: unknown): WritingLanguage {
  const value = typeof language === "string" ? language : undefined;
  return isWritingLanguage(value)
    ? value
    : "ko";
}

function resolveCreateBookPlatform(platform: unknown, language: WritingLanguage): Platform {
  if (typeof platform === "string") {
    switch (platform) {
      case "tomato":
      case "feilu":
      case "qidian":
      case "naver-series":
      case "kakao-page":
      case "munpia":
      case "novelpia":
      case "other":
        return platform;
      default:
        break;
    }
  }

  return CREATE_BOOK_DEFAULTS[language].platform;
}

function resolveCreateBookGenre(genre: unknown, language: WritingLanguage): Genre {
  if (typeof genre === "string" && genre.trim()) {
    return genre;
  }
  return CREATE_BOOK_DEFAULTS[language].genre;
}

function slugifyBookId(title: string): string {
  const slug = title
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff\u3130-\u318f\u1100-\u11ff\uac00-\ud7a3]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);

  if (slug) {
    return slug;
  }

  return `book-${Date.now().toString(36)}`;
}

/** Export tool definitions so external systems can reference them. */
export { TOOLS as AGENT_TOOLS };
