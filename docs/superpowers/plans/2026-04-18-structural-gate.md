# Structural Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-on LLM-based structural gate that blocks chapter persistence on foundation-reflection failures or fatal narrative disconnects, while preserving soft quality findings as reviewable output.

**Architecture:** Introduce a dedicated `StructuralGateAgent` and result schema in core, run it before the existing audit/revise cycle, and persist gate artifacts in runtime. Reuse `ReviserAgent` for spot-fix remediation, then re-run the gate before allowing chapter save. Surface soft findings through pipeline results first, then expose them to CLI/Studio.

**Tech Stack:** TypeScript, Vitest, existing InkOS agent pipeline, governed input artifacts (`chapterIntent`, `contextPackage`, `ruleStack`), existing `ReviserAgent` and `PipelineRunner`.

---

## File Map

### New files

- `packages/core/src/agents/structural-gate.ts`
  Purpose: LLM prompt construction, response parsing, structured gate result handling.
- `packages/core/src/models/structural-gate.ts`
  Purpose: Zod schemas and shared result types for hard-fail and soft findings.
- `packages/core/src/__tests__/structural-gate.test.ts`
  Purpose: unit tests for prompt/parser/result classification and fixture-driven gate scenarios.

### Modified files

- `packages/core/src/pipeline/chapter-review-cycle.ts`
  Purpose: insert `structural-gate -> reviser(spot-fix) -> structural-gate` before continuity audit.
- `packages/core/src/pipeline/runner.ts`
  Purpose: wire the new gate into `writeNextChapter`, persist runtime artifacts, and propagate soft findings/hard failure summaries.
- `packages/core/src/index.ts`
  Purpose: export new agent/model types if needed.
- `packages/core/src/__tests__/pipeline-runner.test.ts`
  Purpose: integration coverage for save-blocking, revise-and-retry, and soft-finding pass-through.
- `packages/cli/src/commands/write.ts`
  Purpose: print structural gate failures and soft findings in CLI output.
- `packages/studio/src/shared/contracts.ts`
  Purpose: add structural gate fields to shared API contract shapes.
- `packages/studio/src/api/server.ts`
  Purpose: return structural gate results in API payloads/events.
- `packages/studio/src/pages/BookDetail.tsx`
  Purpose: show soft findings / gate-failed status in generation results on one concrete review surface.

### Existing files to inspect before editing

- `packages/core/src/agents/reviser.ts`
- `packages/core/src/agents/continuity.ts`
- `packages/core/src/agents/writer.ts`
- `packages/core/src/models/input-governance.ts`
- `packages/core/src/models/runtime-state.ts`
- `packages/core/src/__tests__/planner.test.ts`
- `packages/core/src/__tests__/composer.test.ts`

---

### Task 1: Add Structural Gate Schema And Agent

**Files:**
- Create: `packages/core/src/models/structural-gate.ts`
- Create: `packages/core/src/agents/structural-gate.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/structural-gate.test.ts`

- [ ] **Step 1: Write the failing schema/parser tests**

Add tests covering:
- valid gate payload parsing
- invalid payload rejection
- distinction between `criticalIssues` and `softFindings`
- fixture case for “foundation requirement missing”
- fixture case for “soft-only findings should still pass”

Example test skeleton:

```ts
it("fails when a required foundation beat is missing from chapter one", async () => {
  const result = await agent.inspectDraft({
    chapterNumber: 1,
    chapterIntent: "# Chapter Intent ...",
    contextPackage,
    ruleStack,
    rawTruth: {
      authorIntent: "초반에는 빙의와 왕좌 위 첫 착각극...",
      currentFocus: "(앞으로 1-3화...)",
      volumeOutline: "- **1화**: 흑요궁 혈좌조회 한가운데서 시작한다...",
      storyBible: "...",
      currentState: "...",
    },
    draft: "검은 궁전의 알현실은...",
  });

  expect(result.passed).toBe(false);
  expect(result.criticalIssues[0]?.code).toBe("missing_foundation_requirement");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/structural-gate.test.ts`

Expected: FAIL because `StructuralGateAgent` and/or schema do not exist yet.

- [ ] **Step 3: Implement the minimal schema and agent**

Implement:
- Zod schemas for result payload
- agent input type carrying governed artifacts + raw truth sources + draft
- system/user prompt that asks for:
  - applied requirements
  - missing requirements
  - critical issues
  - soft findings
  - pass/fail
- parser with strict fallback erroring on malformed output

Key rule: the agent must treat foundation-reflection failures and fatal narrative disconnects as blocking, but leave quality-only issues soft.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/__tests__/structural-gate.test.ts`

Expected: PASS

- [ ] **Step 5: Typecheck core**

Run: `pnpm typecheck`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/models/structural-gate.ts \
        packages/core/src/agents/structural-gate.ts \
        packages/core/src/index.ts \
        packages/core/src/__tests__/structural-gate.test.ts
git commit -m "feat: add structural gate agent"
```

---

### Task 2: Insert Structural Gate Into Chapter Review Cycle

**Files:**
- Modify: `packages/core/src/pipeline/chapter-review-cycle.ts`
- Modify: `packages/core/src/pipeline/runner.ts`
- Modify: `packages/core/src/agents/writer.ts`
- Test: `packages/core/src/__tests__/pipeline-runner.test.ts`

- [ ] **Step 1: Write the failing pipeline tests**

Add tests for:
- gate failure blocks chapter persistence
- gate failure triggers `ReviserAgent` spot-fix once
- re-gate success allows save
- re-gate failure still blocks save
- soft findings only do not block save

Example test skeleton:

```ts
it("does not persist chapter files when the structural gate still fails after spot-fix", async () => {
  structuralGateSpy
    .mockResolvedValueOnce(failingGateResult)
    .mockResolvedValueOnce(failingGateResult);

  await expect(runner.writeNextChapter(bookId)).rejects.toThrow(/structural-gate/i);
  await expect(stat(savedChapterPath)).rejects.toThrow();
});
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run: `pnpm test src/__tests__/pipeline-runner.test.ts -- --runInBand`

Expected: FAIL because no structural gate stage is wired yet.

- [ ] **Step 3: Implement structural gate orchestration**

Implement:
- create gate agent in runner context
- run gate after writer output normalization / post-write checks
- if gate returns critical issues:
  - call reviser in `spot-fix`
  - re-run gate on revised content
- if gate still fails:
  - throw a dedicated error
  - do not save chapter or truth files
- if gate passes:
  - continue to continuity audit
- carry `softFindings` forward in result object

Keep responsibilities clean:
- gate judges structure
- reviser edits
- continuity auditor remains soft-quality-focused

Gate/reviser contract:
- pass only `criticalIssues` into `ReviserAgent`
- never pass `softFindings` into the blocking remediation path
- the gate always performs the final blocking decision after reviser output
- reviser output is never treated as implicitly approved without a second gate pass

- [ ] **Step 4: Persist runtime gate artifact**

Write a runtime artifact such as:

`story/runtime/chapter-0001.structural-gate.json`

Include:
- first-pass gate result
- second-pass gate result if present
- whether reviser ran
- final blocking status

- [ ] **Step 5: Run targeted pipeline tests**

Run: `pnpm test src/__tests__/pipeline-runner.test.ts`

Expected: PASS for new structural gate scenarios

- [ ] **Step 6: Run focused regression tests**

Run:

```bash
pnpm test src/__tests__/planner.test.ts src/__tests__/composer.test.ts src/__tests__/pipeline-runner.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/pipeline/chapter-review-cycle.ts \
        packages/core/src/pipeline/runner.ts \
        packages/core/src/agents/writer.ts \
        packages/core/src/__tests__/pipeline-runner.test.ts
git commit -m "feat: enforce structural gate before save"
```

---

### Task 3: Expose Structural Gate Results To CLI And Studio

**Files:**
- Modify: `packages/cli/src/commands/write.ts`
- Modify: `packages/studio/src/shared/contracts.ts`
- Modify: `packages/studio/src/api/server.ts`
- Modify: `packages/studio/src/pages/BookDetail.tsx`
- Test: `packages/studio/src/api/server.test.ts`
- Test: `packages/studio/src/pages/BookDetail.test.tsx`

- [ ] **Step 1: Write failing output/contract tests**

Add tests for:
- CLI output on hard-fail summary
- API response includes structural gate summary and soft findings
- Studio contract types accept gate fields
- Book detail view renders structural gate soft findings or blocked status from the API result

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @actalk/inkos-core test -- src/__tests__/pipeline-runner.test.ts
pnpm --filter @actalk/inkos-studio test -- src/api/server.test.ts src/pages/BookDetail.test.tsx
```

Expected: FAIL because structural gate fields are not exposed yet.

- [ ] **Step 3: Implement contract and presentation wiring**

Implement:
- extend shared result contracts with:
  - `structuralGatePassed`
  - `structuralGateSummary`
  - `structuralGateSoftFindings`
  - optional runtime artifact path or metadata
- ensure CLI prints:
  - blocking reason on failure
  - soft findings summary on success
- ensure Studio surfaces:
  - gate-failed status in run result
  - soft findings as reviewable items, not blockers

Keep UI changes narrow. Use `BookDetail` as the single required Studio review surface for this feature. Do not add activity feed integration in this task.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
pnpm --filter @actalk/inkos-studio test -- src/api/server.test.ts src/pages/BookDetail.test.tsx
```

Expected: PASS

- [ ] **Step 5: Run app typechecks**

Run:

```bash
pnpm --filter @actalk/inkos-core typecheck
pnpm --filter @actalk/inkos-studio typecheck
pnpm --filter @actalk/inkos typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/write.ts \
        packages/studio/src/shared/contracts.ts \
        packages/studio/src/api/server.ts \
        packages/studio/src/pages/BookDetail.tsx \
        packages/studio/src/pages/BookDetail.test.tsx \
        packages/studio/src/api/server.test.ts
git commit -m "feat: surface structural gate results"
```

---

### Task 4: Add Regression Fixtures For Real Novel Failure Modes

**Files:**
- Modify: `packages/core/src/__tests__/pipeline-runner.test.ts`
- Test: `packages/core/src/__tests__/structural-gate.test.ts`

- [ ] **Step 1: Write fixture-backed failing regression cases**

Add fixture scenarios based on the real Korean novel failure class:
- chapter one intent extracted correctly, but draft still omits required opening beat
- draft opens in palace audience hall without enough connective bridge for a first chapter
- governed input and gate judgments align on missing foundation requirement

- [ ] **Step 2: Run targeted regression suite and observe failure**

Run:

```bash
pnpm test src/__tests__/structural-gate.test.ts src/__tests__/pipeline-runner.test.ts
```

Expected: FAIL until fixture expectations and full pipeline behavior line up.

- [ ] **Step 3: Refine prompts or parsing only as needed**

If tests fail due to ambiguous agent output:
- tighten structural gate prompt wording
- tighten parser expectations
- avoid broad pipeline churn

Do not weaken the hard-fail policy just to make tests pass.

- [ ] **Step 4: Re-run the regression suite**

Run:

```bash
pnpm test src/__tests__/structural-gate.test.ts src/__tests__/pipeline-runner.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/__tests__/structural-gate.test.ts \
        packages/core/src/__tests__/pipeline-runner.test.ts
git commit -m "test: add structural gate regression fixtures"
```

---

### Task 4.5: Add Studio Fail-Closed Regression For API Path

**Files:**
- Modify: `packages/studio/src/api/server.test.ts`
- Modify: `packages/studio/src/api/server.ts`

- [ ] **Step 1: Add a failing Studio/API regression**

Write one integration-style server test that exercises the Studio generation/save path and proves:
- structural gate hard failure is returned to the client
- chapter persistence is blocked
- no success payload is emitted for a blocked run

- [ ] **Step 2: Run the server test to verify it fails**

Run: `pnpm --filter @actalk/inkos-studio test -- src/api/server.test.ts`

Expected: FAIL until the server/API path propagates structural gate blocking correctly.

- [ ] **Step 3: Implement the minimal server-path fix**

Ensure the Studio API path:
- returns structural gate failure metadata
- does not report the blocked run as saved/generated successfully
- preserves soft findings on non-blocking success

- [ ] **Step 4: Re-run the server test**

Run: `pnpm --filter @actalk/inkos-studio test -- src/api/server.test.ts`

Expected: PASS

- [ ] **Step 5: Fold into the Task 3 commit if still in progress, otherwise commit separately**

```bash
git add packages/studio/src/api/server.ts \
        packages/studio/src/api/server.test.ts
git commit -m "test: cover studio structural gate blocking"
```

---

### Task 5: Full Verification And Final Review

**Files:**
- Review only: working tree changes from Tasks 1-4

- [ ] **Step 1: Run full core test suite**

Run: `pnpm --filter @actalk/inkos-core test`

Expected: PASS

- [ ] **Step 2: Run affected package tests**

Run:

```bash
pnpm --filter @actalk/inkos-studio test
pnpm --filter @actalk/inkos test
```

Expected: PASS or no regressions in touched areas

- [ ] **Step 3: Run full typecheck**

Run: `pnpm typecheck`

Expected: PASS

- [ ] **Step 4: Manual smoke on a real governed book fixture**

Run a local smoke using the first-novel style project or an equivalent governed fixture:

```bash
node --input-type=module - <<'EOF'
// invoke PipelineRunner.writeNextChapter against a controlled fixture book
EOF
```

Verify:
- hard-fail draft does not save
- soft-only draft saves with findings
- runtime structural gate artifact is produced

- [ ] **Step 5: Final commit**

```bash
git add packages/core packages/cli packages/studio
git commit -m "feat: add fail-closed structural gate"
```

---

## Review Checklist For Plan Reviewer

- Does the plan keep structural judgment separate from reviser edits?
- Does it preserve `fail-closed` behavior for hard failures?
- Does it avoid turning soft quality findings into save blockers?
- Does it include runtime artifact persistence and regression fixtures?
- Are the tests strong enough to prevent the original Korean chapter-one regression from returning?
