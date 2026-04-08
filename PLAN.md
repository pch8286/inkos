# Korean Support Implementation Plan

## Progress Status (2026-04-08)

- [x] 언어 타입/스키마/기본값: `ko | zh | en`, 기본값 `ko`
- [x] Studio UI/API: 언어 선택, i18n, genre/platform 계약
- [x] CLI: `--lang ko` 기본값 반영, 다국어 출력, 플랫폼 표시
- [x] Core pipeline: 한국어 휴리스틱, 길이계산(`ko_chars`) 포함
- [x] 한국 장르 추가: `modern-fantasy`, `fantasy`, `murim`, `romance-fantasy`, `korean-other`
- [x] 한국 플랫폼 프리셋: `naver-series`, `kakao-page`, `munpia`, `novelpia`
- [x] 문서 갱신: `README.md`, `README.en.md`

## Alignment Update (2026-04-08)

사용자 기준:

- 1순위 사용자는 개인 한국 웹소설 작가
- 평가 기준은 UI 번역보다 full workflow 동작
- 핵심 품질은 번역보다 한국 웹소설 문체/리듬 현지화
- 장르별 집필 감각 차이가 실제로 반영되어야 함
- 플랫폼 프리셋은 단순 메타데이터가 아니라 heuristics 에 영향을 줘야 함
- 성공 기준은 `현대판타지/판타지/무협` 1화가 한국 웹소설처럼 읽히는 것
- 중국어/영어 규칙이 한국어 집필에 섞이면 안 됨

현재 정렬성 판단:

- `Full workflow`: 대체로 정렬됨
  - `ko` 기본값, 생성/집필/검토/수정/빌드/테스트 경로는 동작 확인
- `언어 분리`: 부분 정렬
  - writer/observer 쪽 `ko` 분리는 반영됐지만, core 전역에는 아직 `en` 대 `non-en` 또는 `zh/en` 기반 분기가 남아 있음
- `장르별 감각`: 부분 정렬
  - 한국 장르 프로필은 추가됐지만, 실제 1화 출력 품질을 기준으로 캘리브레이션한 상태는 아님
- `플랫폼 heuristics`: 미정렬
  - 현재는 플랫폼이 선택/표시/프롬프트 문구에는 반영되지만, 실질적인 cadence/hook density/회차 길이 규칙으로 구조화돼 있지는 않음
- `5000자/회차 기준`: 미확정
  - 현재 `ko_chars` 는 공백 제외 글자 수로 동작하지만, 플랫폼별 공용 기준과 카운팅 관례는 별도 리서치가 필요함

즉, 현재 구현은 `한국어를 쓸 수 있는 상태`에는 도달했지만, `한국 웹소설 작가용으로 문체와 플랫폼 감각까지 맞춘 상태`까지는 아직 추가 작업이 필요하다.

## Goal

InkOS에 한국어를 1급 언어로 추가한다.

- 집필 언어의 기본값을 `ko`로 변경한다.
- 언어 선택지는 `ko`, `zh`, `en`을 유지한다.
- 한국어 UI를 추가하되, 우선순위는 집필 파이프라인 완성이다.
- 한국 웹소설 플랫폼과 장르, 휴리스틱까지 포함해 실제 사용 가능한 수준으로 마무리한다.

## Fixed Decisions

- Primary scope: 한국어 소설 집필 지원
- Secondary scope: Studio UI 한국어 지원
- Default language: `ko`
- Supported languages after change: `ko`, `zh`, `en`
- Korean length metric: 공백 제외 글자 수
- Korean platform presets:
  - `naver-series`
  - `kakao-page`
  - `munpia`
  - `novelpia`
- Quality scope: 한국어 휴리스틱 정교화 포함
- Acceptance priority: full workflow > UI 한국어화
- Success bar: 한국 장르 1화가 한국 웹소설처럼 읽히는지로 판정
- Separation rule: `ko` 집필 규칙은 `zh/en` 규칙과 분리 유지

## Scope

### Included

- 공용 언어 타입 및 스키마 확장
- 프로젝트/책/장르/런타임 상태의 `ko` 지원
- Studio API 및 UI의 `ko` 지원
- CLI의 `--lang ko` 지원
- 한국어 기본 문서/상태 파일 생성
- 한국어 프롬프트 분기 추가
- 내장 한국 장르 추가
- 한국어 AI-tell / fatigue / cadence 휴리스틱 추가
- 테스트 및 문서 갱신

### Excluded for now

- 기존 장르 체계 전면 재설계
- 플랫폼별 업로드 자동화
- 한국어 외 추가 언어 확장

## Workstreams

### 1. Language Foundation

- Status: 완료

- `zh | en` 고정 타입을 `ko | zh | en`으로 확장
- 언어 관련 helper를 도입해 `zh 아니면 en` 식 분기 제거
- 기본 프로젝트 언어를 `ko`로 변경

Targets:

- `packages/core/src/models/*`
- `packages/core/src/state/*`
- `packages/studio/src/shared/contracts.ts`
- `packages/studio/src/api/*`
- `packages/cli/src/*`

### 2. Studio Surface

- Status: 완료

- 첫 진입 언어 선택 화면에 한국어 추가
- i18n 문자열에 `ko` 추가
- 설정/책 생성/장르 관리 화면을 `ko` 기준으로 동작하게 수정
- 한국 플랫폼 프리셋 노출

Targets:

- `packages/studio/src/hooks/use-i18n.ts`
- `packages/studio/src/pages/LanguageSelector.tsx`
- `packages/studio/src/pages/BookCreate.tsx`
- `packages/studio/src/pages/GenreManager.tsx`
- `packages/studio/src/pages/ConfigView.tsx`

### 3. CLI and Config

- Status: 완료

- `--lang ko` 허용
- CLI 출력 문구 한국어 추가
- export 메타데이터의 언어 코드 처리 분리
- 한국어 플랫폼/장르가 CLI에서 정상 노출되도록 수정

Targets:

- `packages/cli/src/commands/*`
- `packages/cli/src/localization.ts`
- `packages/cli/src/progress-text.ts`

### 4. Core Writing Pipeline

- Status: 완료

- 한국어를 독립 언어 분기로 처리
- 기본 제어 문서와 상태 마크다운을 한국어로 생성
- 프롬프트와 출력 파서를 한국어 기준으로 점검
- 분량 계산을 한국어 문자 수 기준으로 정리

Targets:

- `packages/core/src/agents/*`
- `packages/core/src/pipeline/*`
- `packages/core/src/utils/length-metrics.ts`
- `packages/core/src/utils/story-markdown.ts`

### 5. Built-in Korean Genres

- Status: 완료

초기 내장 장르 후보:

- `modern-fantasy`
- `fantasy`
- `murim`
- `romance-fantasy`
- `korean-other`

작업 내용:

- 장르 frontmatter에 `language: ko` 추가
- 한국 플랫폼 감각에 맞는 chapter types 설계
- fatigue words, pacing rule, satisfaction types, audit dimensions 보정

Targets:

- `packages/core/genres/*.md`

### 6. Korean Heuristics

- Status: 완료

- 한국어 완곡 표현, 전환어, 반복 시작 패턴 정의
- 제목/장면/분위기 반복 감지에서 한국어 분기 추가
- 장기 피로도와 cadence 분석을 한국어 환경에 맞게 보정
- 오탐이 과해지지 않도록 threshold를 보수적으로 시작

Targets:

- `packages/core/src/agents/ai-tells.ts`
- `packages/core/src/utils/long-span-fatigue.ts`
- `packages/core/src/utils/chapter-cadence.ts`
- 관련 audit/reviser/planner 경로

### 7. Test and Docs

- Status: 완료

- 언어 스키마 회귀 테스트
- `ko` 프로젝트/책 생성 테스트
- Studio API 계약 테스트
- CLI 언어 해석 테스트
- 한국어 휴리스틱 테스트
- README 및 예시 명령 갱신

Targets:

- `packages/core/src/__tests__/*`
- `packages/studio/src/**/*.test.ts`
- `README.md`
- `README.en.md`

### 8. Alignment Hardening

- Status: 진행 중

- `ko` 모드가 아직 `zh/en` 이분법 잔재를 타는 경로를 추가 정리
- 한국 웹소설 기준의 writer/auditor/reviser 문체 분기 확장
- 장르별 1화 샘플을 뽑아 현판/판타지/무협 감각 차이를 캘리브레이션
- 생성 결과가 "한국어로 출력된다" 수준이 아니라 "한국 웹소설처럼 읽힌다" 기준을 만족하도록 튜닝
- core agent tool 경로의 중국어 기본값/slug 규칙 제거

완료된 배치:

- `packages/core/src/pipeline/agent.ts`
  - agent tool 설명/시스템 프롬프트의 중국어 기본 경로를 영어 기준으로 정리
  - `create_book` 기본값을 언어별로 분리하고 `ko` 기본값 및 한글 slug 보존 반영
  - `en` 기본 장르를 CLI 기본값과 맞춰 `progression` 으로 정렬
- `packages/core/src/agents/chapter-analyzer.ts`
  - 한국어 분석 프롬프트, 제어 입력 블록, placeholder/title/headings 정리
  - 한국어 요약표 헤더와 outline 탐색 경로 보정
- `packages/core/src/agents/continuity.ts`
  - 한국어 감사 프롬프트/제어 블록/parse-failure fallback 분리
  - 장르 라벨, 복선/감정선/볼륨 아웃라인 등 한국어 heading 보정
- `packages/core/src/agents/foundation-reviewer.ts`
  - 원작 정전/문체 참조 섹션을 언어별 heading 으로 분리
- `packages/core/src/pipeline/runner.ts`
  - `ko` fallback 이 중국어로 떨어지지 않도록 로컬라이즈 fallback 정리
  - foundation review/import 경로에서 `ko` 언어 유지

남은 작업:

- `writer-prompts`, `writer`, `reviser`, `planner` 전반의 문체/리듬 캘리브레이션
- 장르별 샘플 생성 기준의 acceptance tuning
- 한국 플랫폼별 cadence/hook density preset 구조화

Targets:

- `packages/core/src/agents/writer-prompts.ts`
- `packages/core/src/agents/continuity.ts`
- `packages/core/src/agents/chapter-analyzer.ts`
- `packages/core/src/agents/reviser.ts`
- `packages/core/src/agents/foundation-reviewer.ts`
- `packages/core/src/agents/planner.ts`
- `packages/core/src/pipeline/agent.ts`

### 9. Platform Heuristics

- Status: 미착수

- 플랫폼별 기본 cadence, hook 강도, 회차 압축도, 엔딩 cliffhanger 성향을 구조화
- `naver-series`, `kakao-page`, `munpia`, `novelpia` 를 단순 enum 이 아니라 집필 preset 으로 취급
- preset 을 프로젝트/책/장르 레벨에서 override 가능하게 설계

Targets:

- `packages/core/src/models/book.ts`
- `packages/core/src/models/project.ts`
- `packages/core/src/agents/architect.ts`
- `packages/core/src/agents/writer-prompts.ts`
- `packages/studio/src/pages/BookCreate.tsx`
- `packages/studio/src/pages/ConfigView.tsx`

### 10. Korean Market Research

- Status: 미착수

- 한국 웹소설 플랫폼별 회차 분량 관행과 5000자 기준 조사
- 공식 문서가 없으면 플랫폼 공지/작가 가이드/공모전 요강/실제 연재 관행을 구분해서 정리
- 조사 결과를 heuristic preset 과 acceptance rubric 에 반영

Targets:

- `PLAN.md`
- `README.md`
- 추가 리서치 문서 (`docs/` 또는 루트 메모 문서)

### 11. Acceptance Harness

- Status: 미착수

- 한국 장르별 1화 생성 smoke test 시나리오 정의
- 사람 검수용 rubric 추가: 도입 속도, 모바일 문단감, hook 강도, 장르 기대 충족, 중국어/영어 잔재 여부
- 최소한 `modern-fantasy`, `fantasy`, `murim` 은 샘플 생성 후 품질 검토 루프 수행

Targets:

- `packages/core/src/__tests__/*`
- 수동 검수 문서

## Execution Order

### Phase 1. Foundation

- 언어 타입/스키마/API/default 정리
- `ko`가 영어 fallback으로 떨어지는 경로 제거

### Phase 2. Product Surface

- Studio + CLI + 플랫폼 + 언어 선택 화면 반영
- 한국어 기본 문서 생성 확인

### Phase 3. Writing Quality

- 한국 장르 추가
- 한국어 프롬프트/휴리스틱 추가
- 테스트와 문서 마무리

### Phase 4. Alignment Hardening

- `ko` 전용 문체/리듬 분기 확대
- 장르별 1화 샘플 평가
- 중국어/영어 규칙 혼입 제거

### Phase 5. Platform Calibration

- 플랫폼별 회차 감각 리서치
- preset 설계 및 override 경로 추가
- 5000자/회차 기준 및 카운팅 관례 정리

## Main Risks

- `zh/en` 이분법 분기가 넓게 퍼져 있어 누락 시 일부 경로가 영어로 fallback될 수 있음
- 한국어 휴리스틱은 초기에 오탐 가능성이 있음
- 플랫폼 enum 추가 시 기존 `other` 전제 코드와 충돌 가능성이 있음
- 장르 추가만으로 충분치 않고 프롬프트 문체 튜닝이 필요할 수 있음
- 플랫폼 프리셋이 실제 집필 제어에 연결되지 않으면 "지원"이 표면적 기능에 그칠 수 있음
- 5000자 기준이 플랫폼마다 다르거나 비공식 관행일 수 있어, 잘못 고정하면 사용감이 어긋날 수 있음
- CLI/Studio와 별개로 agent tool 경로가 따로 drift 하면 한국어 기본값이 다시 깨질 수 있음

## Done Criteria

- 새 프로젝트 기본 언어가 `ko`
- Studio와 CLI에서 `ko` 선택 가능
- 한국어 책 생성, 다음 장 작성, 검토, 수정까지 end-to-end 동작
- 내장 한국 장르가 노출되고 생성 가능
- 한국 플랫폼 프리셋이 선택 가능
- 한국어 분량 계산이 공백 제외 글자 수로 동작
- 한국어 휴리스틱 테스트가 추가되고 통과
- 기존 `zh/en` 회귀 테스트가 유지
- `modern-fantasy`, `fantasy`, `murim` 기준 1화 샘플이 한국 웹소설처럼 읽히는지 수동 검수 통과
- 플랫폼 프리셋이 실제 집필 heuristics 에 영향을 주고 override 가능
- `ko` 집필 경로에서 `zh/en` 전용 규칙/문구 혼입이 핵심 경로에서 제거
