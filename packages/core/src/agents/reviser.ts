import { BaseAgent } from "./base.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import type { LengthSpec } from "../models/length-governance.js";
import type { AuditIssue } from "./continuity.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import { readGenreProfile, readBookLanguage, readBookRules } from "./rules-reader.js";
import { countChapterLength } from "../utils/length-metrics.js";
import { buildGovernedMemoryEvidenceBlocks } from "../utils/governed-context.js";
import { filterSummaries } from "../utils/context-filter.js";
import { resolveWritingLanguage, type WritingLanguage } from "../models/language.js";
import {
  buildGovernedCharacterMatrixWorkingSet,
  buildGovernedHookWorkingSet,
  mergeTableMarkdownByKey,
} from "../utils/governed-working-set.js";
import { applySpotFixPatches, parseSpotFixPatches } from "../utils/spot-fix-patches.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type ReviseMode = "polish" | "rewrite" | "rework" | "anti-detect" | "spot-fix";

export const DEFAULT_REVISE_MODE: ReviseMode = "spot-fix";

export interface ReviseOutput {
  readonly revisedContent: string;
  readonly wordCount: number;
  readonly fixedIssues: ReadonlyArray<string>;
  readonly updatedState: string;
  readonly updatedLedger: string;
  readonly updatedHooks: string;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

const MODE_DESCRIPTIONS: Record<ReviseMode, string> = {
  polish: "润色：只改表达、节奏、段落呼吸，不改事实与剧情结论。禁止：增删段落、改变人名/地名/物品名、增加新情节或新对话、改变因果关系。只允许：替换用词、调整句序、修改标点节奏",
  rewrite: "改写：允许重组问题段落、调整画面和叙述力度，但优先保留原文的绝大部分句段。除非问题跨越整章，否则禁止整章推倒重写；只能围绕问题段落及其直接上下文改写，同时保留核心事实与人物动机",
  rework: "重写：可重构场景推进和冲突组织，但不改主设定和大事件结果",
  "anti-detect": `反检测改写：在保持剧情不变的前提下，降低AI生成可检测性。

改写手法（附正例）：
1. 打破句式规律：连续短句 → 长短交替，句式不可预测
2. 口语化替代：✗"然而事情并没有那么简单" → ✓"哪有那么便宜的事"
3. 减少"了"字密度：✗"他走了过去，拿了杯子" → ✓"他走过去，端起杯子"
4. 转折词降频：✗"虽然…但是…" → ✓ 用角色内心吐槽或直接动作切换
5. 情绪外化：✗"他感到愤怒" → ✓"他捏碎了茶杯，滚烫的茶水流过指缝"
6. 删掉叙述者结论：✗"这一刻他终于明白了力量" → ✓ 只写行动，让读者自己感受
7. 群像反应具体化：✗"全场震惊" → ✓"老陈的烟掉在裤子上，烫得他跳起来"
8. 段落长度差异化：不再等长段落，有的段只有一句话，有的段七八行
9. 消灭"不禁""仿佛""宛如"等AI标记词：换成具体感官描写`,
  "spot-fix": "定点修复：只修改审稿意见指出的具体句子或段落，其余所有内容必须原封不动保留。修改范围限定在问题句子及其前后各一句。禁止改动无关段落",
};

const MODE_DESCRIPTIONS_KO: Record<ReviseMode, string> = {
  polish: "윤문: 표현, 호흡, 단락 리듬만 다듬고 사실관계와 전개 결론은 바꾸지 않는다. 단락 추가/삭제, 고유명사 변경, 새 사건/새 대사 추가, 인과관계 변경은 금지한다.",
  rewrite: "개작: 문제가 있는 단락을 재배치하고 장면 밀도를 조정할 수 있지만, 원문의 대부분은 보존한다. 문제가 장 전체를 덮지 않는 한 통째 재작성은 금지한다.",
  rework: "재구성: 장면 추진과 충돌 배치를 다시 짤 수 있지만, 핵심 설정과 큰 사건의 결과는 바꾸지 않는다.",
  "anti-detect": `반탐지 개작: 줄거리와 사실은 유지하되, 기계적으로 보이는 문장 규칙성을 줄인다.

개작 원칙:
1. 문장 길이와 리듬을 섞는다
2. 추상 설명보다 구체적인 반응과 감각을 쓴다
3. 서술자의 결론 문장을 줄이고 장면으로 체감시킨다
4. 군중 반응은 뭉뚱그리지 말고 개별 반응으로 나눈다
5. 반복되는 전환어와 AI 표식어를 구체적 표현으로 바꾼다`,
  "spot-fix": "정밀 수정: 심사에서 지적한 문장과 단락만 국소적으로 손본다. 문제 구절과 그 앞뒤 한 문장 범위 안에서만 수정하고, 무관한 단락은 그대로 둔다.",
};

const POSITIVE_SCENE_GUIDANCE_KO = [
  "중요한 감정 변화는 감정 이름보다 손이 멈추는지, 말끝이 흐려지는지, 시선이 피하는지 같은 변화로 먼저 드러낸다",
  "장면의 큰 형상과 위치 관계를 먼저 세우고, 세부는 그다음에 둔다",
  "과밀한 문장은 앞비트와 뒷비트로 나눠, 독자가 먼저 형상이나 행동을 잡고 다음 비트에서 세부를 따라오게 한다",
  "이상함은 '뭔가 어색했다' 같은 추상 판정보다 눈에 바로 걸리는 어긋남으로 먼저 보여 준다",
  "처음 등장하는 사물이나 장식은 독자가 기본 형태를 잡은 뒤에 세부 명사를 붙인다",
  "인물의 자세 변화와 손동작은 왜 그렇게 움직이는지 보이도록 직전 시각 정보와 연결한다",
  "관계 변화는 짧은 직접 공방이나 망설임, 시선 회피 같은 장면 증거로 고친다",
  "군중 반응은 요약하지 말고 1-2명의 구체적 반응으로 바꾼다",
  "설명은 장면을 잇는 연결용으로 압축하고, 핵심 비트는 장면 안에서 체감되게 고친다",
  "서술 시간이 장면 중요도와 어긋나면 선택, 대가, 폭로, 관계 변화, 위협 신호는 확대하고 이동, 반복 절차, 이미 이해된 정보는 압축한다",
  "서술자의 판정 문장은 가능한 한 결과, 이미지, 행동으로 치환한다",
  "그는/그가/자신이 같은 3인칭 주어 반복은 이름, 직함, 무주어 행동문, 직접 감각 반응으로 분산한다",
  "감각 자체가 주어가 되는 도입문이 반복되면 자세, 닿은 면, 시야에 걸리는 구조, 감각을 일으킨 원인 중 하나로 시작점을 바꾼다",
  "감각을 항목처럼 요약한 문장은 움직임, 접촉 지점, 시선 이동에 붙인다",
  "장면 안 원인 없이 떠 있는 감각 비유는 더 예쁜 비유로 바꾸지 말고 감각의 원인, 물리적 변화, 인물 반응으로 고친다",
  "짧은 문단이 연속되면 효과 비트만 남기고 인접한 행동-관찰-반응은 한 문단으로 묶는다",
  "소품의 의미 해설은 사용 방식, 실패, 손에 익은 정도, 상대 반응으로 바꾼다",
  "시점 인물이 모르는 정보나 남의 속마음을 새로 해설하지 않는다",
  "처음 등장하는 고유명사는 관계, 기능, 위협 중 하나를 붙여 자연스럽게 고친다",
  "장면의 갈등은 인물의 욕망과 방해가 부딪히는 방향으로 보강한다",
  "대사와 지문 중 더 짧고 자연스러운 쪽으로 정보 전달 방식을 고른다",
  "부사가 눈에 띄면 먼저 동사가 약한지 확인하고, 속도나 감정은 움직임 자체와 선택으로 바꾼다",
  "회차 끝의 회고형 선언이나 판세 비유는 마지막 행동, 되돌릴 수 없는 결과, 상대 반응으로 바꾼다",
].join("\n");

const POSITIVE_SCENE_GUIDANCE_ZH = [
  "重要情绪变化优先用动作、感官、语气变化来显现，而不是先贴情绪标签",
  "先让读者看清场景的大轮廓和位置关系，再落到局部细节",
  "句子一旦过密，就拆成前后两个节拍，让读者先抓住形状或动作，再跟上细节",
  "异常感优先写成读者能立刻看见的错位，不先用“哪里不对劲”这类抽象判断顶上去",
  "初次出现的器物、肢体或装饰，先交代基本形状，再补局部名词和细节",
  "人物俯身、伸手、停步等动作，要让读者先看懂动作缘由，再写微动作本身",
  "关系变化尽量改成一小段带阻力的直接交锋、迟疑或回避来承载",
  "群体反应用1-2个具体个体反应替代笼统概括",
  "说明段负责衔接、定位、压缩时间，关键一拍要落回可感的场景里",
  "叙述者结论句尽量改写成可观察后果、画面或动作",
].join("\n");

export class ReviserAgent extends BaseAgent {
  get name(): string {
    return "reviser";
  }

  async reviseChapter(
    bookDir: string,
    chapterContent: string,
    chapterNumber: number,
    issues: ReadonlyArray<AuditIssue>,
    mode: ReviseMode = DEFAULT_REVISE_MODE,
    genre?: string,
    options?: {
      chapterIntent?: string;
      contextPackage?: ContextPackage;
      ruleStack?: RuleStack;
      lengthSpec?: LengthSpec;
    },
  ): Promise<ReviseOutput> {
    const [currentState, ledger, hooks, styleGuideRaw, volumeOutline, storyBible, characterMatrix, chapterSummaries, parentCanon, fanficCanon] = await Promise.all([
      this.readFileSafe(join(bookDir, "story/current_state.md")),
      this.readFileSafe(join(bookDir, "story/particle_ledger.md")),
      this.readFileSafe(join(bookDir, "story/pending_hooks.md")),
      this.readFileSafe(join(bookDir, "story/style_guide.md")),
      this.readFileSafe(join(bookDir, "story/volume_outline.md")),
      this.readFileSafe(join(bookDir, "story/story_bible.md")),
      this.readFileSafe(join(bookDir, "story/character_matrix.md")),
      this.readFileSafe(join(bookDir, "story/chapter_summaries.md")),
      this.readFileSafe(join(bookDir, "story/parent_canon.md")),
      this.readFileSafe(join(bookDir, "story/fanfic_canon.md")),
    ]);

    // Load genre profile and book rules
    const genreId = genre ?? "other";
    const [{ profile: gp }, bookLanguage] = await Promise.all([
      readGenreProfile(this.ctx.projectRoot, genreId),
      readBookLanguage(bookDir),
    ]);
    const parsedRules = await readBookRules(bookDir);
    const bookRules = parsedRules?.rules ?? null;

    // Fallback: use book_rules body when style_guide.md doesn't exist
    const resolvedLanguage = resolveWritingLanguage(bookLanguage ?? gp.language);
    const isEnglish = resolvedLanguage === "en";
    const isKorean = resolvedLanguage === "ko";
    const styleGuide = styleGuideRaw !== "(文件不存在)"
      ? styleGuideRaw
      : (parsedRules?.body ?? (isKorean ? "(문체 가이드 없음)" : "(无文风指南)"));

    const issueList = issues
      .map((i) => isKorean
        ? `- [${i.severity}] ${i.category}: ${i.description}\n  제안: ${i.suggestion}`
        : `- [${i.severity}] ${i.category}: ${i.description}\n  建议: ${i.suggestion}`)
      .join("\n");

    const modeDesc = isKorean ? MODE_DESCRIPTIONS_KO[mode] : MODE_DESCRIPTIONS[mode];
    const numericalRule = gp.numericalSystem
      ? (isKorean
        ? "\n3. 수치 오류는 정확히 바로잡고 앞뒤 장부와 대조한다"
        : "\n3. 数值错误必须精确修正，前后对账")
      : "";
    const protagonistBlock = bookRules?.protagonist
      ? (isKorean
        ? `\n\n주인공 인물 잠금: ${bookRules.protagonist.name}, ${bookRules.protagonist.personalityLock.join(", ")}. 수정은 이 인물 축을 벗어나면 안 된다.`
        : `\n\n主角人设锁定：${bookRules.protagonist.name}，${bookRules.protagonist.personalityLock.join("、")}。修改不得违反人设。`)
      : "";
    const lengthGuardrail = options?.lengthSpec
      ? (isKorean
        ? "\n8. 장 분량은 목표 구간 안에 최대한 유지한다. 핵심 문제를 고치기 위해 꼭 필요할 때만 소폭 이탈을 허용한다"
        : "\n8. 保持章节字数在目标区间内；只有在修复关键问题确实需要时才允许轻微偏离")
      : "";
    const langPrefix = isEnglish
      ? mode === "spot-fix"
        ? `【LANGUAGE OVERRIDE】ALL output (FIXED_ISSUES, PATCHES, UPDATED_STATE, UPDATED_HOOKS) MUST be in English. Every TARGET_TEXT and REPLACEMENT_TEXT must be written entirely in English.\n\n`
        : `【LANGUAGE OVERRIDE】ALL output (FIXED_ISSUES, REVISED_CONTENT, UPDATED_STATE, UPDATED_HOOKS) MUST be in English. The revised chapter content must be written entirely in English.\n\n`
      : "";
    const governedMode = Boolean(options?.chapterIntent && options?.contextPackage && options?.ruleStack);
    const hooksWorkingSet = governedMode && options?.contextPackage
      ? buildGovernedHookWorkingSet({
          hooksMarkdown: hooks,
          contextPackage: options.contextPackage,
          chapterNumber,
          language: resolvedLanguage,
        })
      : hooks;
    const chapterSummariesWorkingSet = governedMode
      ? filterSummaries(chapterSummaries, chapterNumber)
      : chapterSummaries;
    const characterMatrixWorkingSet = governedMode
      ? buildGovernedCharacterMatrixWorkingSet({
          matrixMarkdown: characterMatrix,
          chapterIntent: options?.chapterIntent ?? volumeOutline,
          contextPackage: options!.contextPackage!,
          protagonistName: bookRules?.protagonist?.name,
        })
      : characterMatrix;

    const outputFormat = mode === "spot-fix"
      ? isKorean
        ? `=== FIXED_ISSUES ===
(무엇을 고쳤는지 한 줄씩 정리한다. 안전한 정밀 수정이 불가능하면 그 사실도 여기에 적는다)

=== PATCHES ===
(교체가 필요한 국소 패치만 출력한다. 장 전체 재작성은 금지한다. 아래 형식을 반복해서 쓴다)
--- PATCH 1 ---
TARGET_TEXT:
(원문에서 정확히 복사한, 유일하게 식별되는 문장 또는 단락)
REPLACEMENT_TEXT:
(교체 후 국소 텍스트)
--- END PATCH ---

=== UPDATED_STATE ===
(수정 후 전체 상태 카드)
${gp.numericalSystem ? "\n=== UPDATED_LEDGER ===\n(수정 후 전체 자원 장부)" : ""}
=== UPDATED_HOOKS ===
(수정 후 전체 복선 풀)`
        : `=== FIXED_ISSUES ===
(逐条说明修正了什么，一行一条；如果无法安全定点修复，也在这里说明)

=== PATCHES ===
(只输出需要替换的局部补丁，不得输出整章重写。格式如下，可重复多个 PATCH 区块)
--- PATCH 1 ---
TARGET_TEXT:
(必须从原文中精确复制、且能唯一命中的原句或原段)
REPLACEMENT_TEXT:
(替换后的局部文本)
--- END PATCH ---

=== UPDATED_STATE ===
(更新后的完整状态卡)
${gp.numericalSystem ? "\n=== UPDATED_LEDGER ===\n(更新后的完整资源账本)" : ""}
=== UPDATED_HOOKS ===
(更新后的完整伏笔池)`
      : isKorean
        ? `=== FIXED_ISSUES ===
(무엇을 고쳤는지 한 줄씩 정리한다)

=== REVISED_CONTENT ===
(수정된 전체 본문)

=== UPDATED_STATE ===
(수정 후 전체 상태 카드)
${gp.numericalSystem ? "\n=== UPDATED_LEDGER ===\n(수정 후 전체 자원 장부)" : ""}
=== UPDATED_HOOKS ===
(수정 후 전체 복선 풀)`
        : `=== FIXED_ISSUES ===
(逐条说明修正了什么，一行一条)

=== REVISED_CONTENT ===
(修正后的完整正文)

=== UPDATED_STATE ===
(更新后的完整状态卡)
${gp.numericalSystem ? "\n=== UPDATED_LEDGER ===\n(更新后的完整资源账本)" : ""}
=== UPDATED_HOOKS ===
(更新后的完整伏笔池)`;

    const systemPrompt = isKorean
      ? `${langPrefix}당신은 ${gp.name} 장르를 다루는 전문 웹소설 수정 에디터다. 심사 이슈를 바탕으로 해당 화를 정확하게 손본다. 당신의 역할은 새로 멋을 부리는 것이 아니라, 독자가 걸린 지점을 최소 수정으로 통과 가능하게 바꾸는 것이다.${protagonistBlock}

수정 모드: ${modeDesc}

수정 원칙:
1. 모드에 맞는 수정 폭을 지킨다
2. 표면만 다듬지 말고 문제의 원인을 바로잡는다${numericalRule}
3. 다음 장면 강화 원칙을 우선한다
${POSITIVE_SCENE_GUIDANCE_KO}
4. 수정 우선순위는 구조 -> 인물/갈등 -> 장면 -> 문장 순서로 판단한다
5. 회차의 작은 보상과 다음 질문이 사라진 경우, 문장 윤문보다 장면 재배치나 rewrite/rework가 필요한지 먼저 판단한다
6. 주인공의 능동적 선택과 그 대가가 빠졌다면, 새 장식보다 기존 사건의 선택과 결과를 선명하게 만든다
7. 장면의 욕망 / 행동 / 변화가 빠진 문제는 단어 교체로 덮지 말고 목표, 방해, 전환을 보강한다
8. 문제의 원인이 정보 제시 순서라면, 세부를 늘리기보다 순서를 다시 배열해 독자가 먼저 그림을 잡게 만든다
9. spot-fix는 단일 원인, 국소 수정, 사건 순서 불변일 때만 선택한다
10. polish는 사실과 구조는 맞고 문장만 거슬릴 때 선택한다
11. rewrite는 장면 배열이나 인과 재배치가 필요할 때 선택한다
12. rework는 갈등 구조 자체가 흔들릴 때 선택한다
13. 핵심 앵커 장면, 고유명사, 대사 한 비트는 반드시 유지한다
14. 한 단계 낮은 모드로 해결 가능하면 더 큰 모드를 쓰지 말고, 필요한 최소 단위만 고치세요.
15. 독자가 먼저 잃는 것은 사실 -> 순서 -> 공간 -> 관계 -> 원인 -> 감정 순서로 판단하세요.
16. 문체 보존과 연속성 수정이 충돌하면 연속성을 우선하고, 문체는 독서 흐름을 해치지 않는 범위에서만 조정하세요.
17. 각 이슈마다 수정 전 실패 조건과 수정 후 통과 조건을 한 쌍으로 확인한 뒤에만 고치세요.
18. 수정 후에는 원래 문제를 다시 확인하고, 새 모순·새 고유명사·새 훅·새 정보 누출이 생기지 않았는지 재검사하세요.
19. 수정 전 실패 조건과 수정 후 통과 조건을 관찰 가능한 문장으로 한 쌍씩 적는다.
20. 모드별 편집 거리 예산을 지킨다: spot-fix는 문장/인접 문장, polish는 어구 수준, rewrite는 단락 수준, rework는 장면 수준.
21. 보이지 않는 가정부터 점검하고, 본문에 없는 전제는 사실처럼 쓰지 않는다.
22. 회차마다 독자가 품게 될 질문을 해결됨/보류/새로 열린 질문으로 나눠 정리한다.
23. 각 수정은 이슈 → 근거 → 패치 → 보존 항목 순서로 추적 가능해야 한다.
24. 수정 큐는 하드 모순 → 인과 붕괴 → 정보 누락 → 장면 구조 → 문장/리듬 순서로 처리한다. 상위 문제가 남아 있으면 하위 수정은 보류한다.
25. 수정 결과가 원래 문제를 가리거나 새 모순을 만들면 즉시 롤백한다. 안전하게 국소 수정할 수 없으면 PATCHES를 비우고 상위 모드로 넘긴다.
26. 장면이 이미 독해를 막지 않으면 굳이 손대지 않는다. 고칠지 말지는 결함 크기와 독자 손해를 기준으로 판단하고, 불필요한 미용 수정은 하지 않는다.
27. author_intent.md와 current_focus.md는 사실 충돌이 없는 한 최우선으로 보존한다. 문장을 더 그럴듯하게 만드는 대신, 작가가 원래 밀고 있던 질문과 보상 축을 지켜라.
28. 수정이 끝나면 변경 전/후 diff의 고친 구간만 다시 읽고, 원래 문제를 정확히 해결했는지와 새 부작용이 없는지를 각각 확인한다.
29. 복선 상태는 반드시 복선 풀과 동기화한다
30. 줄거리 방향과 핵심 충돌은 바꾸지 않는다
31. 원문의 언어 톤과 호흡은 유지하되, 더 자연스럽게 다듬는다
32. 수정 후 상태 카드${gp.numericalSystem ? ", 자원 장부" : ""}, 복선 풀을 함께 갱신한다
${lengthGuardrail}
${mode === "spot-fix" ? "\n33. spot-fix는 국소 패치만 출력한다. 장 전체 재작성은 금지한다\n34. TARGET_TEXT는 반드시 원문에서 유일하게 찾을 수 있어야 한다. 안전한 정밀 수정이 불가능하면 PATCHES를 비워 두고 그 이유를 적는다" : ""}

출력 형식:

${outputFormat}`
      : `${langPrefix}你是一位专业的${gp.name}网络小说修稿编辑。你的任务是根据审稿意见对章节进行修正。你的职责不是把全文改得更华丽，而是用尽量小的改动，让读者原本卡顿的地方重新顺畅可见。${protagonistBlock}

修稿模式：${modeDesc}

修稿原则：
1. 按模式控制修改幅度
2. 修根因，不做表面润色${numericalRule}
3. 优先遵循以下场景强化原则
${POSITIVE_SCENE_GUIDANCE_ZH}
4. 如果问题出在信息投放顺序，就重排顺序，让读者先看清再看细部，而不是盲目加形容词
5. 伏笔状态必须与伏笔池同步
6. 不改变剧情走向和核心冲突
7. 保持原文的语言风格和节奏
8. 修改后同步更新状态卡${gp.numericalSystem ? "、账本" : ""}、伏笔池
${lengthGuardrail}
${mode === "spot-fix" ? "\n9. spot-fix 只能输出局部补丁，禁止输出整章改写；TARGET_TEXT 必须能在原文中唯一命中\n10. 如果需要大面积改写，说明无法安全 spot-fix，并让 PATCHES 留空" : ""}

输出格式：

${outputFormat}`;

    const ledgerBlock = gp.numericalSystem
      ? `\n## ${isKorean ? "자원 장부" : "资源账本"}\n${ledger}`
      : "";
    const governedMemoryBlocks = options?.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(options.contextPackage, resolvedLanguage)
      : undefined;
    const hookDebtBlock = governedMemoryBlocks?.hookDebtBlock ?? "";
    const hooksBlock = governedMemoryBlocks?.hooksBlock
      ?? `\n## ${isKorean ? "복선 풀" : "伏笔池"}\n${hooksWorkingSet}\n`;
    const outlineBlock = volumeOutline !== "(文件不存在)"
      ? `\n## ${isKorean ? "볼륨 아웃라인" : "卷纲"}\n${volumeOutline}\n`
      : "";
    const bibleBlock = !governedMode && storyBible !== "(文件不存在)"
      ? `\n## ${isKorean ? "세계관 설정" : "世界观设定"}\n${storyBible}\n`
      : "";
    const matrixBlock = characterMatrixWorkingSet !== "(文件不存在)"
      ? `\n## ${isKorean ? "인물 상호작용 매트릭스" : "角色交互矩阵"}\n${characterMatrixWorkingSet}\n`
      : "";
    const summariesBlock = governedMemoryBlocks?.summariesBlock
      ?? (chapterSummariesWorkingSet !== "(文件不存在)"
        ? `\n## ${isKorean ? "회차 요약" : "章节摘要"}\n${chapterSummariesWorkingSet}\n`
        : "");
    const volumeSummariesBlock = governedMemoryBlocks?.volumeSummariesBlock ?? "";

    const hasParentCanon = parentCanon !== "(文件不存在)";
    const hasFanficCanon = fanficCanon !== "(文件不存在)";

    const canonBlock = hasParentCanon
      ? isKorean
        ? `\n## 정전 참조 (수정 전용)\n이 책은 외전 성격의 작품이다. 수정 시 정전 설정을 기준으로 삼고, 정전 사실은 바꾸지 않는다.\n${parentCanon}\n`
        : `\n## 正传正典参照（修稿专用）\n本书为番外作品。修改时参照正典约束，不可改变正典事实。\n${parentCanon}\n`
      : "";

    const fanficCanonBlock = hasFanficCanon
      ? isKorean
        ? `\n## 팬픽 원전 참조 (수정 전용)\n이 책은 동인 성격의 작품이다. 수정 시 원전 인물 설정과 세계 규칙을 기준으로 삼고, 원전 사실과 어투를 해치지 않는다.\n${fanficCanon}\n`
        : `\n## 同人正典参照（修稿专用）\n本书为同人作品。修改时参照正典角色档案和世界规则，不可违反正典事实。角色对话必须保留原作语癖。\n${fanficCanon}\n`
      : "";
    const reducedControlBlock = options?.chapterIntent && options.contextPackage && options.ruleStack
      ? this.buildReducedControlBlock(options.chapterIntent, options.contextPackage, options.ruleStack, resolvedLanguage)
      : "";
    const lengthGuidanceBlock = options?.lengthSpec
      ? isKorean
        ? `\n## 분량 가드레일\n목표 글자 수: ${options.lengthSpec.target}\n권장 구간: ${options.lengthSpec.softMin}-${options.lengthSpec.softMax}\n한계 구간: ${options.lengthSpec.hardMin}-${options.lengthSpec.hardMax}\n수정 후 분량이 권장 구간을 벗어나면, 장황한 설명·반복 동작·정보 밀도 낮은 문장부터 줄이고 새 지선이나 핵심 사실 삭제는 금지한다.\n`
        : `\n## 字数护栏\n目标字数：${options.lengthSpec.target}\n允许区间：${options.lengthSpec.softMin}-${options.lengthSpec.softMax}\n极限区间：${options.lengthSpec.hardMin}-${options.lengthSpec.hardMax}\n如果修正后超出允许区间，请优先压缩冗余解释、重复动作和弱信息句，不得新增支线或删掉核心事实。\n`
      : "";
    const styleGuideBlock = reducedControlBlock.length === 0
      ? `\n## ${isKorean ? "문체 가이드" : "文风指南"}\n${styleGuide}`
      : "";

    const userPrompt = isKorean
      ? `제${chapterNumber}화를 수정해 주세요.

## 심사 이슈
${issueList}

## 현재 상태 카드
${currentState}
${ledgerBlock}
${hookDebtBlock}${hooksBlock}${volumeSummariesBlock}${reducedControlBlock || outlineBlock}${bibleBlock}${matrixBlock}${summariesBlock}${canonBlock}${fanficCanonBlock}${styleGuideBlock}${lengthGuidanceBlock}

## 수정 대상 원문
${chapterContent}`
      : `请修正第${chapterNumber}章。

## 审稿问题
${issueList}

## 当前状态卡
${currentState}
${ledgerBlock}
${hookDebtBlock}${hooksBlock}${volumeSummariesBlock}${reducedControlBlock || outlineBlock}${bibleBlock}${matrixBlock}${summariesBlock}${canonBlock}${fanficCanonBlock}${styleGuideBlock}${lengthGuidanceBlock}

## 待修正章节
${chapterContent}`;

    const maxTokens = mode === "spot-fix" ? 8192 : 16384;

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.3, maxTokens },
    );

    const output = this.parseOutput(response.content, gp, mode, chapterContent);
    const mergedOutput = governedMode
      ? {
          ...output,
          updatedHooks: mergeTableMarkdownByKey(hooks, output.updatedHooks, [0]),
        }
      : output;
    const wordCount = options?.lengthSpec
      ? countChapterLength(mergedOutput.revisedContent, options.lengthSpec.countingMode)
      : mergedOutput.wordCount;
    return { ...mergedOutput, wordCount, tokenUsage: response.usage };
  }

  private parseOutput(
    content: string,
    gp: GenreProfile,
    mode: ReviseMode,
    originalChapter: string,
  ): ReviseOutput {
    const extract = (tag: string): string => {
      const regex = new RegExp(
        `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
      );
      const match = content.match(regex);
      return match?.[1]?.trim() ?? "";
    };

    const fixedRaw = extract("FIXED_ISSUES");
    const fixedIssues = fixedRaw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (mode === "spot-fix") {
      const patches = parseSpotFixPatches(extract("PATCHES"));
      const patchResult = applySpotFixPatches(originalChapter, patches);

      return {
        revisedContent: patchResult.revisedContent,
        wordCount: patchResult.revisedContent.length,
        fixedIssues: patchResult.applied ? fixedIssues : [],
        updatedState: extract("UPDATED_STATE") || "(状态卡未更新)",
        updatedLedger: gp.numericalSystem
          ? (extract("UPDATED_LEDGER") || "(账本未更新)")
          : "",
        updatedHooks: extract("UPDATED_HOOKS") || "(伏笔池未更新)",
      };
    }

    const revisedContent = extract("REVISED_CONTENT");

    return {
      revisedContent,
      wordCount: revisedContent.length,
      fixedIssues,
      updatedState: extract("UPDATED_STATE") || "(状态卡未更新)",
      updatedLedger: gp.numericalSystem
        ? (extract("UPDATED_LEDGER") || "(账本未更新)")
        : "",
      updatedHooks: extract("UPDATED_HOOKS") || "(伏笔池未更新)",
    };
  }

  private async readFileSafe(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件不存在)";
    }
  }

  private buildReducedControlBlock(
    chapterIntent: string,
    contextPackage: ContextPackage,
    ruleStack: RuleStack,
    language: WritingLanguage,
  ): string {
    const selectedContext = contextPackage.selectedContext
      .map((entry) => `- ${entry.source}: ${entry.reason}${entry.excerpt ? ` | ${entry.excerpt}` : ""}`)
      .join("\n");
    const overrides = ruleStack.activeOverrides.length > 0
      ? ruleStack.activeOverrides
        .map((override) => `- ${override.from} -> ${override.to}: ${override.reason} (${override.target})`)
        .join("\n")
      : "- none";

    if (language === "en") {
      return `\n## Chapter Control Inputs (compiled by Planner/Composer)
${chapterIntent}

### Selected Context
${selectedContext || "- none"}

### Rule Stack
- Hard guardrails: ${ruleStack.sections.hard.join(", ") || "(none)"}
- Soft constraints: ${ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic rules: ${ruleStack.sections.diagnostic.join(", ") || "(none)"}

### Active Overrides
${overrides}\n`;
    }

    if (language === "ko") {
      return `\n## 본장 제어 입력 (Planner/Composer가 편집)
${chapterIntent}

### 선택된 컨텍스트
${selectedContext || "- none"}

### 규칙 스택
- 하드 가드레일: ${ruleStack.sections.hard.join(", ") || "(없음)"}
- 소프트 제약: ${ruleStack.sections.soft.join(", ") || "(없음)"}
- 진단 규칙: ${ruleStack.sections.diagnostic.join(", ") || "(없음)"}

### 현재 오버라이드
${overrides}\n`;
    }

    return `\n## 本章控制输入（由 Planner/Composer 编译）
${chapterIntent}

### 已选上下文
${selectedContext || "- none"}

### 规则栈
- 硬护栏：${ruleStack.sections.hard.join("、") || "(无)"}
- 软约束：${ruleStack.sections.soft.join("、") || "(无)"}
- 诊断规则：${ruleStack.sections.diagnostic.join("、") || "(无)"}

### 当前覆盖
${overrides}\n`;
  }
}
