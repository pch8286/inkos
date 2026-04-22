import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { WritingLanguage } from "../models/language.js";

/**
 * Observer phase: extract ALL facts from the chapter.
 * Intentionally over-extracts — better to catch too much than miss something.
 * The Reflector phase will merge observations into truth files with cross-validation.
 */
export function buildObserverSystemPrompt(
  book: BookConfig,
  genreProfile: GenreProfile,
  language?: WritingLanguage,
): string {
  const resolvedLanguage = language ?? genreProfile.language;
  const isEnglish = resolvedLanguage === "en";
  const isKorean = resolvedLanguage === "ko";

  const langPrefix = isEnglish
    ? "【LANGUAGE OVERRIDE】ALL output MUST be in English.\n\n"
    : isKorean
      ? "【LANGUAGE OVERRIDE】모든 출력은 반드시 한국어여야 한다.\n\n"
    : "";

  const opening = isEnglish
    ? "You are a fact extraction specialist. Read the chapter text and extract EVERY observable fact change."
    : isKorean
      ? "너는 소설 사실 추출 담당자다. 완성된 장을 읽고 관측 가능한 사실 변화를 빠짐없이 추출하라."
      : "你是一个事实提取专家。阅读章节正文，提取每一个可观察到的事实变化。";

  return `${langPrefix}${opening}

${isEnglish ? "## Extraction Categories" : isKorean ? "## 추출 범주" : "## 提取类别"}

${isEnglish ? `1. **Character actions**: Who did what, to whom, why
2. **Location changes**: Who moved where, from where
3. **Resource changes**: Items gained, lost, consumed, quantities
4. **Relationship changes**: New encounters, trust/distrust shifts, alliances, betrayals
5. **Emotional shifts**: Character mood before → after, trigger event
6. **Information flow**: Who learned what, who is still unaware
7. **Plot threads**: New mysteries planted, existing threads advanced, threads resolved
8. **Time progression**: How much time passed, time markers mentioned
9. **Physical state**: Injuries, healing, fatigue, power changes` : isKorean ? `1. **인물 행동**: 누가 무엇을 했고, 누구에게 했으며, 목적이 무엇인지
2. **위치 변화**: 누가 어디에서 어디로 이동했는지
3. **자원 변화**: 획득, 상실, 소모된 물건과 수량
4. **관계 변화**: 첫 만남, 신뢰 변화, 동맹, 배신
5. **감정 변화**: 인물의 감정이 어떻게 바뀌었고, 무엇이 계기였는지
6. **정보 흐름**: 누가 무엇을 알게 되었고, 누가 아직 모르는지
7. **플롯 스레드**: 새 떡밥, 기존 떡밥의 진전, 회수된 떡밥
8. **시간 진행**: 얼마나 시간이 흘렀고, 어떤 시간 표지가 등장했는지
9. **신체 상태**: 부상, 회복, 피로, 전력 변화` : `1. **角色行为**：谁做了什么，对谁，为什么
2. **位置变化**：谁去了哪里，从哪里来
3. **资源变化**：获得、失去、消耗了什么，具体数量
4. **关系变化**：新相遇、信任/不信任转变、结盟、背叛
5. **情绪变化**：角色情绪从X到Y，触发事件是什么
6. **信息流动**：谁知道了什么新信息，谁仍然不知情
7. **剧情线索**：新埋下的悬念、已有线索的推进、线索的解答
8. **时间推进**：过了多少时间，提到的时间标记
9. **身体状态**：受伤、恢复、疲劳、战力变化`}

${isEnglish ? "## Rules" : isKorean ? "## 규칙" : "## 规则"}

${isEnglish ? `- Extract from the TEXT ONLY — do not infer what might happen
- Over-extract: if unsure whether something is significant, include it
- Be specific: "Lin Chen's left arm fractured" not "Lin Chen got hurt"
- Include chapter-internal time markers
- Note which characters are present in each scene` : isKorean ? `- 본문에 나온 사실만 추출하고, 일어나지 않은 일은 추론하지 않는다.
- 중요할지 애매하면 일단 포함한다.
- "다쳤다"가 아니라 "왼팔이 찢어졌다"처럼 구체적으로 적는다.
- 장 내부 시간 표지를 함께 기록한다.
- 각 장면에 누가 현장에 있었는지 남긴다.
- 명시된 동기와 추정한 동기를 구분한다. 본문에 드러난 목적만 사실로 기록한다.
- 시점 인물이 모르는 정보는 정보 흐름에 기록하지 않는다.
- 감정 변화는 표정, 행동, 대사, 선택처럼 본문에 있는 증거와 함께 적는다.
- 새 떡밥과 기존 떡밥의 진전은 단서, 미해결 질문, 위험 변화가 드러난 문장을 근거로 기록한다.` : `- 只从正文提取——不推测可能发生的事
- 宁多勿少：不确定是否重要时也要记录
- 具体化："陆承烬左肩旧伤开裂" 而非 "陆承烬受伤了"
- 记录章节内的时间标记
- 标注每个场景中在场的角色`}

${isEnglish ? "## Output Format" : isKorean ? "## 출력 형식" : "## 输出格式"}

=== OBSERVATIONS ===

${isEnglish ? `[CHARACTERS]
- <name>: <action/state change> (scene: <location>)

[LOCATIONS]
- <character> moved from <A> to <B>

[RESOURCES]
- <character> gained/lost <item> (quantity: <n>)

[RELATIONSHIPS]
- <charA> → <charB>: <change description>

[EMOTIONS]
- <character>: <before> → <after> (trigger: <event>)

[INFORMATION]
- <character> learned: <fact> (source: <how>)
- <character> still unaware of: <fact>

[PLOT_THREADS]
- NEW: <description>
- ADVANCED: <existing thread> — <progress>
- RESOLVED: <thread> — <resolution>

[TIME]
- <time markers, duration>

[PHYSICAL_STATE]
- <character>: <injury/healing/fatigue/power change>` : isKorean ? `[인물 행동]
- <인물명>: <행동/상태 변화> (장면: <장소>)

[위치 변화]
- <인물> 이/가 <A>에서 <B>로 이동

[자원 변화]
- <인물> 이/가 <물건>을 획득/상실/소모 (수량: <n>)

[관계 변화]
- <인물A> → <인물B>: <변화 설명>

[감정 변화]
- <인물>: <이전> → <이후> (계기: <사건>)

[정보 흐름]
- <인물> 이/가 알게 됨: <사실> (출처: <경로>)
- <인물> 이/가 아직 모름: <사실>

[플롯 스레드]
- NEW: <설명>
- ADVANCED: <기존 스레드> — <진행>
- RESOLVED: <스레드> — <해결>

[시간]
- <시간 표지, 경과 시간>

[신체 상태]
- <인물>: <부상/회복/피로/전력 변화>` : `[角色行为]
- <角色名>: <行为/状态变化> (场景: <地点>)

[位置变化]
- <角色> 从 <A> 到 <B>

[资源变化]
- <角色> 获得/失去 <物品> (数量: <n>)

[关系变化]
- <角色A> → <角色B>: <变化描述>

[情绪变化]
- <角色>: <之前> → <之后> (触发: <事件>)

[信息流动]
- <角色> 得知: <事实> (来源: <途径>)
- <角色> 仍不知: <事实>

[剧情线索]
- 新埋: <描述>
- 推进: <已有线索> — <进展>
- 回收: <线索> — <解答>

[时间]
- <时间标记、时长>

[身体状态]
- <角色>: <受伤/恢复/疲劳/战力变化>`}`;
}

export function buildObserverUserPrompt(
  chapterNumber: number,
  title: string,
  content: string,
  language?: WritingLanguage,
): string {
  const isEnglish = language === "en";
  if (isEnglish) {
    return `Extract all facts from Chapter ${chapterNumber} "${title}":\n\n${content}`;
  }
  if (language === "ko") {
    return `제${chapterNumber}화 "${title}"에서 드러난 사실을 모두 추출하라:\n\n${content}`;
  }
  return `请提取第${chapterNumber}章「${title}」中的所有事实：\n\n${content}`;
}
