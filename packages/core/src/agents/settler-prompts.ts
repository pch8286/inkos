import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import type { WritingLanguage } from "../models/language.js";

export function buildSettlerSystemPrompt(
  book: BookConfig,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
  language?: WritingLanguage,
): string {
  const resolvedLang = language ?? genreProfile.language;
  const isEnglish = resolvedLang === "en";
  const isKorean = resolvedLang === "ko";
  const numericalBlock = genreProfile.numericalSystem
    ? isKorean
      ? `\n- 이 장르는 수치/자원 체계가 있으므로 UPDATED_LEDGER에 본문에 나온 모든 자원 변동을 추적한다.
- 수치 검산 원칙: 기초값 + 증감 = 기말값이 맞아야 한다.`
      : `\n- 本题材有数值/资源体系，你必须在 UPDATED_LEDGER 中追踪正文中出现的所有资源变动
- 数值验算铁律：期初 + 增量 = 期末，三项必须可验算`
    : isKorean
      ? `\n- 이 장르는 수치 시스템이 없으므로 UPDATED_LEDGER는 비워 둔다.`
      : `\n- 本题材无数值系统，UPDATED_LEDGER 留空`;

  const hookRules = isKorean
    ? `
## 복선 추적 규칙

- 새 복선: 본문에 후속 회차로 이어질 미해결 질문이 있고, 회수 방향이 구체적으로 보일 때만 newHookCandidates에 올린다. 기존 복선의 재표현, 반복 언급, 추상 요약으로 새 복선을 만들지 않는다.
- 복선 언급: 기존 복선이 다시 등장했지만 새 사실, 이해 변화, 위험 상승, 범위 축소가 없으면 mention에만 둔다.
- 복선 진전: 새 증거, 관계 변화, 위험 상승, 독자/인물의 이해 변화가 있으면 upsert로 상태와 notes를 갱신하고 lastAdvancedChapter를 현재 화로 둔다.
- 복선 회수: 본문에서 명확히 밝혀지거나 해결되거나 더 이상 성립하지 않으면 resolve에 둔다.
- 복선 연기: 본문이 그 선을 뒤로 미루거나 배경으로 돌린다는 사실을 보여 줄 때만 defer에 둔다. 오래 지났다는 이유만으로 기계적으로 연기하지 않는다.
- brand-new unresolved thread는 hookId를 직접 만들지 말고 newHookCandidates에 넣는다.
- payoffTiming은 회차 번호 대신 immediate / near-term / mid-arc / slow-burn / endgame만 사용한다.
- 철칙: 다시 언급, 말 바꿔 반복, 추상 복기는 진전이 아니다. 상태가 실제로 변했을 때만 진전으로 기록한다.`
    : `
## 伏笔追踪规则（严格执行）

- 新伏笔：只有当正文中出现一个会延续到后续章节、且有具体回收方向的未解问题时，才新增 hook_id。不要为旧 hook 的换说法、重述、抽象总结再开新 hook
- 提及伏笔：已有伏笔在本章被提到，但没有新增信息、没有改变读者或角色对该问题的理解 → 放入 mention 数组，不要更新最近推进
- 推进伏笔：已有伏笔在本章出现了新的事实、证据、关系变化、风险升级或范围收缩 → **必须**更新"最近推进"列为当前章节号，更新状态和备注
- 回收伏笔：伏笔在本章被明确揭示、解决、或不再成立 → 状态改为"已回收"，备注回收方式
- 延后伏笔：只有当正文明确显示该线被主动搁置、转入后台、或被剧情压后时，才标注"延后"；不要因为“已经过了几章”就机械延后
- brand-new unresolved thread：不要直接发明新的 hookId。把候选放进 newHookCandidates，由系统决定它是映射到旧 hook、变成真正新 hook，还是被拒绝为重述
- payoffTiming 使用语义节奏，不用硬写章节号：只允许 immediate / near-term / mid-arc / slow-burn / endgame
- **铁律**：不要把“再次提到”“换个说法重述”“抽象复盘”当成推进。只有状态真的变了，才更新最近推进。只是出现过的旧 hook，放进 mention 数组。`;

  const fullCastBlock = bookRules?.enableFullCastTracking
    ? isKorean
      ? `\n## 전원 추적\nPOST_SETTLEMENT에는 본화 등장 인물, 인물 간 관계 변화, 미등장 언급 인물을 함께 요약한다.`
      : `\n## 全员追踪\nPOST_SETTLEMENT 必须额外包含：本章出场角色清单、角色间关系变动、未出场但被提及的角色。`
    : "";

  const langPrefix = isEnglish
    ? `【LANGUAGE OVERRIDE】ALL output (state card, hooks, summaries, subplots, emotional arcs, character matrix) MUST be in English. The === TAG === markers remain unchanged.\n\n`
    : isKorean
      ? `【언어 강제】모든 설명 문장과 추적 파일 내용은 한국어로 작성하세요. === TAG === 마커와 JSON 키는 그대로 유지합니다.\n\n`
      : "";

  if (isKorean) {
    return `${langPrefix}너는 상태 추적 분석가다. 새 회차 본문과 현재 truth file을 바탕으로 업데이트된 truth file 증분을 만든다.

## 작업 모드

너는 창작자가 아니다. 해야 할 일은 다음과 같다.
1. 본문에 명시된 사실과 관측 로그를 기준으로 상태 변화를 추출한다.
2. 현재 추적 파일을 기준으로 증분 업데이트만 만든다.
3. 반드시 === TAG === 형식으로 출력한다.

## 분석 차원

본문에서 다음 정보를 추출한다.
- 인물의 등장, 퇴장, 상태 변화
- 위치 이동과 장면 전환
- 물건/자원 획득, 상실, 소모
- 복선의 생성, 진전, 회수, 언급
- 감정선 변화
- 서브플롯 진전
- 관계 변화와 인물의 실제 정보 경계

## 책 정보

- 제목: ${book.title}
- 장르: ${genreProfile.name} (${book.genre})
- 플랫폼: ${book.platform}
${numericalBlock}
${hookRules}${fullCastBlock}

## 출력 형식

${buildSettlerOutputFormat(genreProfile, resolvedLang)}

## 핵심 규칙

1. 상태 카드와 복선 풀은 현재 추적 파일을 기반으로 증분 업데이트한다. 처음부터 다시 쓰지 않는다.
2. 본문에 나온 사실 변화는 대응되는 추적 파일에 반영한다.
3. 수치 변화, 위치 변화, 관계 변화, 정보 변화는 빠뜨리지 않는다.
4. 인물 상호작용 매트릭스의 정보 경계는 정확해야 한다. 인물의 실제 정보 경계를 유지한다. 인물은 현장에 있거나 전달받은 사실만 안다.
5. 감정선과 관계 변화는 본문 속 행동, 표정, 대사, 선택의 증거가 있을 때만 갱신한다.
6. 복선 갱신은 관측 로그나 본문에서 확인되는 단서, 질문, 위험 변화, 이해 변화에 근거한다.

## 철칙: 본문에서 실제로 일어난 일만 기록한다

- 본문에 명시된 사건과 상태 변화만 추출한다. 추론, 예측, 보강 설정을 추가하지 않는다.
- 본문이 문 앞에 도착했다고만 쓰면 상태 카드에 방 안으로 들어갔다고 쓰지 않는다.
- 가능성이나 암시는 확정 사실이 아니라 미해결 복선 후보로 분류한다.
- 권차 개요나 계획에서 본문이 아직 도달하지 않은 내용을 상태 카드에 보충하지 않는다.
- 기존 hooks 중 본문과 무관한 항목은 삭제하거나 고치지 않는다.
- 1화에서는 초기 추적 파일에 대강 생성된 내용이 있을 수 있으므로, 본문이 실제로 지지하는 내용만 유지한다.
- 복선 예외: 본문에 미해결 질문, 갈등, 비밀, 단서가 명확히 심기면 hooks에 기록한다. 이것은 추론이 아니라 본문 속 서사 약속의 추출이다.`;
  }

  return `${langPrefix}你是状态追踪分析师。给定新章节正文和当前 truth 文件，你的任务是产出更新后的 truth 文件。

## 工作模式

你不是在写作。你的任务是：
1. 仔细阅读正文，提取所有状态变化
2. 基于"当前追踪文件"做增量更新
3. 严格按照 === TAG === 格式输出

## 分析维度

从正文中提取以下信息：
- 角色出场、退场、状态变化（受伤/突破/死亡等）
- 位置移动、场景转换
- 物品/资源的获得与消耗
- 伏笔的埋设、推进、回收
- 情感弧线变化
- 支线进展
- 角色间关系变化、新的信息边界

## 书籍信息

- 标题：${book.title}
- 题材：${genreProfile.name}（${book.genre}）
- 平台：${book.platform}
${numericalBlock}
${hookRules}${fullCastBlock}

## 输出格式（必须严格遵循）

${buildSettlerOutputFormat(genreProfile, resolvedLang)}

## 关键规则

1. 状态卡和伏笔池必须基于"当前追踪文件"做增量更新，不是从零开始
2. 正文中的每一个事实性变化都必须反映在对应的追踪文件中
3. 不要遗漏细节：数值变化、位置变化、关系变化、信息变化都要记录
4. 角色交互矩阵中的"信息边界"要准确——角色只知道他在场时发生的事

## 铁律：只记录正文中实际发生的事（严格执行）

- **只提取正文中明确描写的事件和状态变化**。不要推断、预测、或补充正文没有写到的内容
- 如果正文只写到角色走到门口还没进去，状态卡就不能写"角色已进入房间"
- 如果正文只暗示了某种可能性但没有确认，不要把它当作已发生的事实记录
- 不要从卷纲或大纲中补充正文尚未到达的剧情到状态卡
- 不要删除或修改已有 hooks 中与本章无关的内容——只更新本章正文涉及的 hooks
- 第 1 章尤其注意：初始追踪文件可能包含从大纲预生成的内容，只保留正文实际支持的部分，不要保留正文未涉及的预设
- **伏笔例外**：正文中出现的未解疑问、悬念、伏笔线索必须在 hooks 中记录。这不是"推断"，而是"提取正文中的叙事承诺"。如果正文暗示了一个谜题/冲突/秘密但没有解答，那就是一个 hook，必须记录`;
}

function buildSettlerOutputFormat(gp: GenreProfile, language: WritingLanguage = "zh"): string {
  const isKorean = language === "ko";
  const chapterTypeExample = gp.chapterTypes.length > 0
    ? gp.chapterTypes[0]
    : isKorean
      ? "메인 전개"
      : "主线推进";

  if (isKorean) {
    return `=== POST_SETTLEMENT ===
이번 화의 상태 변동, 복선 처리, 정산 주의사항을 간단히 요약한다. Markdown 표나 bullet을 써도 된다.

=== RUNTIME_STATE_DELTA ===
반드시 JSON만 출력한다. Markdown 설명을 붙이지 않는다.
\`\`\`json
{
  "chapter": 12,
  "currentStatePatch": {
    "currentLocation": "선택",
    "protagonistState": "선택",
    "currentGoal": "선택",
    "currentConstraint": "선택",
    "currentAlliances": "선택",
    "currentConflict": "선택"
  },
  "hookOps": {
    "upsert": [
      {
        "hookId": "mentor-oath",
        "startChapter": 8,
        "type": "relationship",
        "status": "progressing",
        "lastAdvancedChapter": 12,
        "expectedPayoff": "스승의 빚 진실 공개",
        "payoffTiming": "slow-burn",
        "notes": "이번 화에서 왜 진전/연기/회수되었는지"
      }
    ],
    "mention": ["이번 화에서 언급만 되고 실제 진전은 없는 hookId"],
    "resolve": ["회수된 hookId"],
    "defer": ["연기로 표시할 hookId"]
  },
  "newHookCandidates": [
    {
      "type": "mystery",
      "expectedPayoff": "새 복선의 향후 회수 방향",
      "payoffTiming": "near-term",
      "notes": "이번 화에서 새 미해결 질문이 된 이유"
    }
  ],
  "chapterSummary": {
    "chapter": 12,
    "title": "본화 제목",
    "characters": "인물1,인물2",
    "events": "핵심 사건 한 문장",
    "stateChanges": "상태 변화 한 문장",
    "hookActivity": "mentor-oath advanced",
    "mood": "긴장",
    "chapterType": "${chapterTypeExample}"
  },
  "subplotOps": [],
  "emotionalArcOps": [],
  "characterMatrixOps": [],
  "notes": []
}
\`\`\`

규칙:
1. 증분만 출력하고 전체 truth files를 다시 쓰지 않는다.
2. 모든 chapter 필드는 정수여야 한다.
3. hookOps.upsert에는 현재 복선 풀에 이미 존재하는 hookId만 쓴다.
4. 완전히 새 미해결 스레드는 newHookCandidates에 넣고 hookId를 직접 만들지 않는다.
5. 기존 hook이 언급만 되고 상태 변화가 없으면 mention에 둔다.
6. 이번 화에서 기존 hook이 진전되면 lastAdvancedChapter는 현재 화 번호여야 한다.
7. 회수 또는 연기는 resolve / defer 배열에 넣는다.
8. chapterSummary.chapter는 현재 화 번호와 같아야 한다.`;
  }

  return `=== POST_SETTLEMENT ===
（简要说明本章有哪些状态变动、伏笔推进、结算注意事项；允许 Markdown 表格或要点）

=== RUNTIME_STATE_DELTA ===
（必须输出 JSON，不要输出 Markdown，不要加解释）
\`\`\`json
{
  "chapter": 12,
  "currentStatePatch": {
    "currentLocation": "可选",
    "protagonistState": "可选",
    "currentGoal": "可选",
    "currentConstraint": "可选",
    "currentAlliances": "可选",
    "currentConflict": "可选"
  },
  "hookOps": {
    "upsert": [
      {
        "hookId": "mentor-oath",
        "startChapter": 8,
        "type": "relationship",
        "status": "progressing",
        "lastAdvancedChapter": 12,
        "expectedPayoff": "揭开师债真相",
        "payoffTiming": "slow-burn",
        "notes": "本章为何推进/延后/回收"
      }
    ],
    "mention": ["本章只是被提到、没有真实推进的 hookId"],
    "resolve": ["已回收的 hookId"],
    "defer": ["需要标记延后的 hookId"]
  },
  "newHookCandidates": [
    {
      "type": "mystery",
      "expectedPayoff": "新伏笔未来要回收到哪里",
      "payoffTiming": "near-term",
      "notes": "本章为什么会形成新的未解问题"
    }
  ],
  "chapterSummary": {
    "chapter": 12,
    "title": "本章标题",
    "characters": "角色1,角色2",
    "events": "一句话概括关键事件",
    "stateChanges": "一句话概括状态变化",
    "hookActivity": "mentor-oath advanced",
    "mood": "紧绷",
    "chapterType": "${chapterTypeExample}"
  },
  "subplotOps": [],
  "emotionalArcOps": [],
  "characterMatrixOps": [],
  "notes": []
}
\`\`\`

规则：
1. 只输出增量，不要重写完整 truth files
2. 所有章节号字段都必须是整数，不能写自然语言
3. hookOps.upsert 里只能写“当前伏笔池里已经存在”的 hookId，不允许发明新的 hookId
4. brand-new unresolved thread 一律写进 newHookCandidates，不要自造 hookId
5. 如果旧 hook 只是被提到、没有真实状态变化，把它放进 mention，不要更新 lastAdvancedChapter
6. 如果本章推进了旧 hook，lastAdvancedChapter 必须等于当前章号
7. 如果回收或延后 hook，必须放在 resolve / defer 数组里
8. chapterSummary.chapter 必须等于当前章节号`;
}

export function buildSettlerUserPrompt(params: {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly currentState: string;
  readonly ledger: string;
  readonly hooks: string;
  readonly chapterSummaries: string;
  readonly subplotBoard: string;
  readonly emotionalArcs: string;
  readonly characterMatrix: string;
  readonly volumeOutline: string;
  readonly observations?: string;
  readonly selectedEvidenceBlock?: string;
  readonly governedControlBlock?: string;
  readonly validationFeedback?: string;
  readonly language?: WritingLanguage;
}): string {
  const isKorean = params.language === "ko";
  const ledgerBlock = params.ledger
    ? isKorean
      ? `\n## 현재 자원 장부\n${params.ledger}\n`
      : `\n## 当前资源账本\n${params.ledger}\n`
    : "";

  const summariesBlock = params.chapterSummaries !== "(文件尚未创建)"
    ? isKorean
      ? `\n## 기존 회차 요약\n${params.chapterSummaries}\n`
      : `\n## 已有章节摘要\n${params.chapterSummaries}\n`
    : "";

  const subplotBlock = params.subplotBoard !== "(文件尚未创建)"
    ? isKorean
      ? `\n## 현재 서브플롯 보드\n${params.subplotBoard}\n`
      : `\n## 当前支线进度板\n${params.subplotBoard}\n`
    : "";

  const emotionalBlock = params.emotionalArcs !== "(文件尚未创建)"
    ? isKorean
      ? `\n## 현재 감정선\n${params.emotionalArcs}\n`
      : `\n## 当前情感弧线\n${params.emotionalArcs}\n`
    : "";

  const matrixBlock = params.characterMatrix !== "(文件尚未创建)"
    ? isKorean
      ? `\n## 현재 인물 상호작용 매트릭스\n${params.characterMatrix}\n`
      : `\n## 当前角色交互矩阵\n${params.characterMatrix}\n`
    : "";

  const observationsBlock = params.observations
    ? isKorean
      ? `\n## 관측 로그\n${params.observations}\n\n위 관측 로그와 본문을 기준으로 모든 추적 파일을 갱신하세요. 관측 로그의 각 변화가 대응되는 파일에 반영되어야 합니다.\n`
      : `\n## 观察日志（由 Observer 提取，包含本章所有事实变化）\n${params.observations}\n\n基于以上观察日志和正文，更新所有追踪文件。确保观察日志中的每一项变化都反映在对应的文件中。\n`
    : "";
  const selectedEvidenceBlock = params.selectedEvidenceBlock
    ? isKorean
      ? `\n## 선택된 장기 근거\n${params.selectedEvidenceBlock}\n`
      : `\n## 已选长程证据\n${params.selectedEvidenceBlock}\n`
    : "";
  const controlBlock = params.governedControlBlock ?? "";
  const outlineBlock = controlBlock.length === 0
    ? isKorean
      ? `\n## 볼륨 아웃라인\n${params.volumeOutline}\n`
      : `\n## 卷纲\n${params.volumeOutline}\n`
    : "";
  const validationFeedbackBlock = params.validationFeedback
    ? isKorean
      ? `\n## 상태 검증 피드백\n${params.validationFeedback}\n\n이 모순을 엄격히 바로잡으세요. truth files만 수정하고, 본문을 다시 쓰거나 본문에 없는 새 사실을 도입하지 마세요.\n`
      : `\n## 状态校验反馈\n${params.validationFeedback}\n\n请严格纠正这些矛盾，只修正 truth files，不要改写正文，不要引入正文中不存在的新事实。\n`
    : "";

  if (isKorean) {
    return `제${params.chapterNumber}화 "${params.title}"의 본문을 분석해 모든 추적 파일을 갱신하세요.
${observationsBlock}
${validationFeedbackBlock}
## 본문

${params.content}
${controlBlock}

## 현재 상태 카드
${params.currentState}
${ledgerBlock}
## 현재 복선 풀
${params.hooks}
${selectedEvidenceBlock}${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}
${outlineBlock}

반드시 === TAG === 형식으로 정산 결과를 출력하세요.`;
  }

  return `请分析第${params.chapterNumber}章「${params.title}」的正文，更新所有追踪文件。
${observationsBlock}
${validationFeedbackBlock}
## 本章正文

${params.content}
${controlBlock}

## 当前状态卡
${params.currentState}
${ledgerBlock}
## 当前伏笔池
${params.hooks}
${selectedEvidenceBlock}${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}
${outlineBlock}

请严格按照 === TAG === 格式输出结算结果。`;
}
