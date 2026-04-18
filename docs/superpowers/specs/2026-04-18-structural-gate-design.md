# Structural Gate Design

## Goal

`write next`와 스튜디오 생성 흐름에 항상 실행되는 LLM 기반 `Structural Gate`를 추가해, 설정집 핵심 요구 반영 실패와 치명적 서사 연결 오류를 저장 전에 차단한다. 하드 실패는 자동 수정 후 재심하고, 여전히 실패하면 챕터 저장을 중단한다. 본문 품질 문제는 소프트 리포트로 남겨 사용자 반려 판단에 넘긴다.

## Why

현재 파이프라인은 `writer -> audit/revise` 축으로 문체, 연속성, AI tell 문제를 다루지만, 다음 류의 실패를 저장 전에 강하게 막지 못한다.

- 설정집 핵심 요구가 초안에 반영되지 않음
- planner/composer 입력이 실제 장면으로 연결되지 않음
- 초반부나 장면 전환에서 독자가 따라갈 수 없는 치명적 연결 끊김이 발생함

이 문제는 “돌아가지만 이상한 초안”을 생산하고, 회귀가 생겨도 테스트가 잡지 못하는 경우가 많다. 따라서 저장 전 `fail-closed` 구조가 필요하다.

## Non-Goals

- 문체, 훅 세기, 설명 밀도, 가독성 전반을 하드 실패로 막지 않는다
- 설정집 핵심 요구를 별도 수동 체크리스트 파일로 강제하지 않는다
- 기존 `reviser`를 판정기까지 겸하는 self-approval 구조로 바꾸지 않는다

## User Policy

### Hard Fail

다음은 항상 하드 실패 대상이다.

- 설정집 핵심 요구 반영 실패
- 입력-반영 구조 위반
- 앞뒤 장면이 전화처럼 연결되지 않는 치명적 서사 단절

### Soft Findings

다음은 저장은 허용하되 리포트로 남긴다.

- 오프닝 훅이 약함
- 설명 밀도/독자 이해 난도 문제
- 장면 설득력 부족
- 독자가 반려할 수 있는 품질 경고

## Recommended Architecture

새 agent `StructuralGateAgent`를 추가한다. 책임은 “하드 실패 전용 구조 심사”다. 기존 `ContinuityAuditor`와 `ReviserAgent`는 유지한다.

권장 흐름:

1. `WriterAgent`가 초안을 생성한다.
2. `StructuralGateAgent`가 초안과 governed control input을 읽고 하드 실패/소프트 결과를 구조화해 반환한다.
3. 하드 실패가 있으면 `ReviserAgent(spot-fix)`에 구조 위반 이슈만 전달해 국소 수정한다.
4. 수정본을 `StructuralGateAgent`가 재심한다.
5. 재심도 실패하면 챕터 저장을 중단한다.
6. 구조 통과 후 기존 `ContinuityAuditor`는 소프트 품질 리포트 중심으로 동작한다.

핵심 원칙은 다음과 같다.

- 판정기와 수정기를 분리한다.
- 하드 실패와 소프트 품질을 분리한다.
- 저장 차단 권한은 gate에 둔다.

## Pipeline Placement

삽입 위치는 기존 `chapter-review-cycle` 안이 가장 자연스럽다.

현재 흐름:

- `writer`
- post-write regex/rule checks
- `auditor`
- 필요 시 `reviser`
- 저장

변경 후 흐름:

- `writer`
- post-write regex/rule checks
- `structural-gate`
- 필요 시 `reviser(spot-fix for structural issues)`
- `structural-gate` 재심
- 구조 통과 시 `auditor`
- 저장

즉, `structural-gate`는 기존 audit보다 앞에 선다. 이유는 하드 실패를 soft quality와 섞지 않고, 저장 중단 여부를 먼저 결정해야 하기 때문이다.

## Gate Inputs

근거는 유연 해석형으로 간다. 별도 체크리스트 파일 없이, 아래 자료를 그대로 제공하고 모델이 핵심 요구를 추출해 판정한다.

- `chapterIntent`
- `contextPackage`
- `ruleStack`
- `author_intent.md`
- `current_focus.md`
- `volume_outline.md`
- `story_bible.md`
- `current_state.md`
- draft content

`contextPackage`를 우선 근거로 사용하되, 필요 시 원문 truth files를 함께 보여 준다. 이렇게 해야 planner/composer 축약이 불완전할 때도 gate가 원문 기준으로 이상 징후를 감지할 수 있다.

## Gate Outputs

출력은 JSON 파싱 가능한 구조로 고정한다.

Proposed shape:

```json
{
  "passed": false,
  "summary": "설정집의 1화 도입 요구가 초안에 직접 장면화되지 않았다.",
  "appliedRequirements": [
    "마왕 역할 유지 공포",
    "궁정 착각극"
  ],
  "missingRequirements": [
    "빙의 직후 정보 제시",
    "1화 도입 연결"
  ],
  "criticalIssues": [
    {
      "code": "missing_foundation_requirement",
      "title": "설정집 핵심 요구 반영 실패",
      "description": "1화 도입에서 빙의 직후 정보가 빠져 독자가 상황을 따라가기 어렵다.",
      "suggestion": "초반 2-4문단 안에서 빙의 직후의 자기 인식과 현재 공간 진입 경위를 장면으로 보강한다.",
      "evidence": [
        "author_intent.md: 초반에는 빙의와 왕좌 위 첫 착각극",
        "volume_outline.md: 1화는 흑요궁 혈좌조회 한가운데서 시작"
      ]
    }
  ],
  "softFindings": [
    {
      "code": "opening_pressure_weak",
      "title": "오프닝 압박 약함",
      "description": "첫 장면의 위기감은 있으나 독자 훅이 더 선명할 수 있다.",
      "suggestion": "판결 전 선택지가 왜 치명적인지 한 박자 더 또렷하게 제시한다."
    }
  ]
}
```

## Hard-Fail Heuristics

모델은 아래 기준 중 하나라도 충족하면 `passed=false`를 반환해야 한다.

### 1. Foundation Requirement Missing

- 설정집, 1화 설계, current focus가 요구한 핵심 비트가 초안에 직접 장면화되지 않음
- 단순 분위기 일치나 일부 키워드 포함은 통과 근거가 아님

### 2. Input Reflection Failure

- planner/composer가 제공한 장면 의도와 실제 본문이 다른 장면을 씀
- 초안이 표 헤더/플레이스홀더/빈 템플릿에 사실상 끌려간 흔적이 있음

### 3. Fatal Narrative Disconnect

- 직전 정보와 장면이 자연스럽게 연결되지 않음
- 독자가 공간/상황/인물 이해를 위해 반드시 필요한 접속 정보가 빠져 있음
- “이전 문장과 다음 장면이 전화처럼 연결되지 않는다” 수준의 비약이 발생함

## Reviser Integration

구조 위반이 발생하면 `ReviserAgent`는 기존 `spot-fix` 모드로 재사용한다. 다만 입력 이슈는 `criticalIssues`만 전달한다.

추가 원칙:

- 구조 위반 수정은 국소 보강을 우선한다
- 설정집 요구를 맞추기 위해 장 전체를 새로 쓰는 건 허용하지 않는다
- `spot-fix`로 해결 불가능하면 재심에서 계속 실패하고 저장이 중단되어야 한다

## Runtime Artifacts

각 챕터마다 runtime 결과를 남긴다.

- `story/runtime/chapter-XXXX.structural-gate.json`

포함 내용:

- gate result full payload
- first pass / second pass 여부
- reviser 개입 여부
- final blocking status

이 아티팩트는 회귀 디버깅과 fixture 기반 테스트의 기준점이 된다.

## CLI / Studio Behavior

### CLI

`write next`는 기본적으로 항상 gate를 탄다.

- gate 하드 실패 + 수정 불가: 명령 실패, 챕터 미저장
- gate 통과 + soft findings 있음: 저장은 성공, 소프트 리포트 출력

출력 예시:

- `Structural gate failed: 2 critical issues`
- `Structural gate passed with 3 soft findings`

### Studio

- 생성 과정에서 동일한 gate를 탄다
- 하드 실패면 저장/반영 차단
- soft findings는 반려 후보 패널 또는 activity feed에 노출

## Testing Strategy

### Unit Tests

새 `structural-gate` agent 자체를 fixture 기반으로 검증한다.

- 설정집 핵심 요구 미반영 fixture
- 1화 도입 누락 fixture
- 표 헤더/플레이스홀더 오염 fixture
- 치명적 장면 연결 끊김 fixture
- soft-only 품질 이슈 fixture

검증 포인트:

- `passed` 값
- `criticalIssues` / `softFindings` 분리
- `missingRequirements`와 `appliedRequirements`가 기대와 맞는지

### Pipeline Tests

`PipelineRunner` / `chapter-review-cycle` 수준에서 검증한다.

- gate 실패 시 챕터 파일이 저장되지 않는지
- reviser 후 재심 성공 시만 저장되는지
- soft findings만 있을 때는 저장되는지
- runtime artifact가 생성되는지

### Regression Fixtures

실제 한국 웹소설 fixture를 최소 1개 둔다. 이번 `first_novel`과 같은 문제를 재현 가능한 fixture로 정리한다.

fixture 목적:

- 추상 테스트가 놓치는 “실전 구조 위반” 회귀 방지
- 설정집/아웃라인/초안의 불일치를 전체 흐름으로 재현

## Risks

### False Positives

유연 해석형 gate는 오탐 가능성이 있다. 따라서 하드 실패 기준은 “설정집과 초안 불일치” 일반론이 아니라, 독자 이해와 장면 연결을 무너뜨리는 치명적 사례에 한정해야 한다.

### Prompt Bloat

truth files 전체를 다 넘기면 프롬프트가 비대해질 수 있다. 우선은 `contextPackage + selected raw truth files` 전략으로 시작하고, 필요 시 후속 최적화한다.

### Self-Approval Regression

gate를 reviser 안에 넣으면 다시 자기 수정안을 자기가 통과시키게 된다. 구조상 금지한다.

## Acceptance Criteria

다음을 만족하면 설계가 완료된 것으로 본다.

- `write next`와 스튜디오 생성이 항상 structural gate를 거친다
- 하드 실패는 reviser 재시도 후에도 남아 있으면 저장이 차단된다
- soft findings는 저장을 막지 않고 사용자 반려 후보로 남는다
- gate 결과가 runtime artifact로 남는다
- 실전 fixture 기반 회귀 테스트가 추가된다

## Recommended Implementation Sequence

1. `StructuralGateAgent`와 결과 스키마 추가
2. gate prompt / parser / runtime artifact 구현
3. `chapter-review-cycle`에 gate + revise + re-gate 연결
4. CLI/Studio 노출
5. unit + pipeline + regression fixture 테스트 추가
