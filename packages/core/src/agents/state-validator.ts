import { BaseAgent } from "./base.js";
import type { WritingLanguage } from "../models/language.js";

export interface ValidationWarning {
  readonly category: string;
  readonly description: string;
}

export interface ValidationResult {
  readonly warnings: ReadonlyArray<ValidationWarning>;
  readonly passed: boolean;
}

/**
 * Validates Settler output by comparing old and new truth files via LLM.
 * Catches contradictions, missing state changes, and temporal inconsistencies.
 *
 * Uses a minimal verdict protocol instead of requiring structured JSON:
 *   Line 1: PASS or FAIL
 *   Remaining lines: free-form warnings (one per line, optional category prefix)
 */
export class StateValidatorAgent extends BaseAgent {
  get name(): string {
    return "state-validator";
  }

  async validate(
    chapterContent: string,
    chapterNumber: number,
    oldState: string,
    newState: string,
    oldHooks: string,
    newHooks: string,
    language: WritingLanguage = "ko",
  ): Promise<ValidationResult> {
    const stateDiff = this.computeDiff(oldState, newState, "State Card");
    const hooksDiff = this.computeDiff(oldHooks, newHooks, "Hooks Pool");

    // Skip validation if nothing changed
    if (!stateDiff && !hooksDiff) {
      return { warnings: [], passed: true };
    }

    const langInstruction = language === "en"
      ? "Respond in English."
      : language === "ko"
        ? "한국어로 답하세요."
        : "用中文回答。";

    const systemPrompt = language === "ko"
      ? `당신은 소설 작성 시스템의 연속성 검증자입니다. ${langInstruction}

회차 본문과 truth files(상태 카드 + 훅 풀)에 적용된 변경 사항을 비교해 모순을 점검하세요:

1. 본문에 근거 없는 상태 변화 — truth file은 바뀌었다고 하지만 본문이 그 변화를 묘사하지 않음
2. 누락된 상태 변화 — 본문에는 사건이 있는데 truth file이 반영하지 않음
3. 시간상 불가능한 변화 — 이동 전환 없이 장소가 바뀌거나, 시간 경과 없이 부상이 회복됨
4. 훅 이상 — 훅이 회수 표시 없이 사라지거나, 새 훅이 본문 근거 없이 생김
5. 소급 편집 — truth file 변경이 이번 화가 아니라 이전 화에서 일어난 일처럼 처리됨

출력 형식(JSON 아님):
- 첫 줄: PASS 또는 FAIL만 출력
- 다음 줄: 경고를 한 줄에 하나씩 쓰고, 필요하면 [category] 접두사를 붙임
- 문제가 전혀 없으면 PASS만 출력

예:
PASS
[unsupported_change] 상태 카드가 숲으로 이동했다고 하지만 본문은 이동 의도만 보여 줌
[minor] H03 훅은 언급이 짧지만 진행으로 볼 여지가 있음

하드 모순이 있으면:
FAIL
[contradiction] 상태에는 인물이 사망했다고 되어 있지만 본문에서는 말하고 있음
[unsupported_change] 새 장소가 본문 어디에도 언급되지 않음

중요: FAIL은 본문과 직접 충돌하는 하드 모순에만 사용하세요. 다음은 FAIL이 아니라 PASS와 경고로 처리합니다:
- 본문보다 약간 앞선 추정
- 상태 카드가 포착하지 못한 누락 세부사항
- 본문에서 합리적으로 추론 가능한 내용
- 본문과 충돌하지 않는 훅 관리 차이`
      : `You are a continuity validator for a novel writing system. ${langInstruction}

Given the chapter text and the CHANGES made to truth files (state card + hooks pool), check for contradictions:

1. State change without narrative support — truth file says something changed but the chapter text doesn't describe it
2. Missing state change — chapter text describes something happening but the truth file didn't capture it
3. Temporal impossibility — character moves locations without transition, injury heals without time passing
4. Hook anomaly — a hook disappeared without being marked resolved, or a new hook has no basis in the chapter
5. Retroactive edit — truth file change implies something happened in a PREVIOUS chapter, not the current one

Output format (simple, NOT JSON):
- First line: exactly PASS or FAIL (nothing else on this line)
- Following lines: one warning per line, optionally prefixed with [category]
- If no issues at all, just output: PASS

Example:
PASS
[unsupported_change] State card says character moved to the forest, but text only shows intent
[minor] Hook H03 advanced but text mention is brief

Or if there are hard contradictions:
FAIL
[contradiction] State says character is dead but chapter text shows them speaking
[unsupported_change] New location not mentioned anywhere in chapter text

IMPORTANT: Output FAIL ONLY for hard contradictions — facts that directly conflict with the chapter text. Do NOT fail for:
- Slightly ahead-of-text inferences
- Missing details that the state card didn't capture
- Reasonable extrapolations from text
- Hook management differences that don't contradict text
These should be warnings with PASS, not FAIL.`;

    const userPrompt = language === "ko"
      ? `제${chapterNumber}화 검증:

## 상태 카드 변경
${stateDiff || "(변경 없음)"}

## 훅 풀 변경
${hooksDiff || "(변경 없음)"}

## 회차 본문 참고
${chapterContent.slice(0, 6000)}`
      : `Chapter ${chapterNumber} validation:

## State Card Changes
${stateDiff || "(no changes)"}

## Hooks Pool Changes
${hooksDiff || "(no changes)"}

## Chapter Text (for reference)
${chapterContent.slice(0, 6000)}`;

    try {
      const response = await this.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        { temperature: 0.1, maxTokens: 2048 },
      );

      return this.parseResult(response.content);
    } catch (error) {
      this.log?.warn(`State validation failed: ${error}`);
      throw error;
    }
  }

  private computeDiff(oldText: string, newText: string, label: string): string | null {
    if (oldText === newText) return null;

    const oldLines = oldText.split("\n").filter((l) => l.trim());
    const newLines = newText.split("\n").filter((l) => l.trim());

    const added = newLines.filter((l) => !oldLines.includes(l));
    const removed = oldLines.filter((l) => !newLines.includes(l));

    if (added.length === 0 && removed.length === 0) return null;

    const parts = [`### ${label}`];
    if (removed.length > 0) parts.push("Removed:\n" + removed.map((l) => `- ${l}`).join("\n"));
    if (added.length > 0) parts.push("Added:\n" + added.map((l) => `+ ${l}`).join("\n"));
    return parts.join("\n");
  }

  private parseResult(content: string): ValidationResult {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("LLM returned empty response");
    }

    const jsonResult = this.tryParseJsonResult(trimmed);
    if (jsonResult) {
      return jsonResult;
    }

    const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      throw new Error("LLM returned empty response");
    }

    const verdictLine = lines[0]!;
    if (!/^(PASS|FAIL)$/i.test(verdictLine)) {
      throw new Error("State validator returned invalid response");
    }
    const passed = /^PASS$/i.test(verdictLine);

    const warnings: ValidationWarning[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (/^(PASS|FAIL)$/i.test(line)) continue;

      const categoryMatch = line.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (categoryMatch) {
        warnings.push({
          category: categoryMatch[1]!.trim(),
          description: categoryMatch[2]!.trim(),
        });
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        warnings.push({
          category: "general",
          description: line.slice(2).trim(),
        });
      } else if (line.length > 5) {
        warnings.push({
          category: "general",
          description: line,
        });
      }
    }

    return { warnings, passed };
  }

  private tryParseJsonResult(text: string): ValidationResult | null {
    const direct = this.tryParseExactJsonResult(text);
    if (direct) {
      return direct;
    }

    const candidate = extractBalancedJsonObject(text);
    if (!candidate) {
      return null;
    }
    return this.tryParseExactJsonResult(candidate);
  }

  private tryParseExactJsonResult(text: string): ValidationResult | null {
    try {
      const parsed = JSON.parse(text) as {
        warnings?: Array<{ category?: string; description?: string }>;
        passed?: boolean;
      };
      if (typeof parsed.passed !== "boolean") return null;
      return {
        warnings: (parsed.warnings ?? []).map((w) => ({
          category: w.category ?? "unknown",
          description: w.description ?? "",
        })),
        passed: parsed.passed,
      };
    } catch {
      return null;
    }
  }
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  return null;
}
