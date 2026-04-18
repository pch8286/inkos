import { BaseAgent } from "./base.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import {
  StructuralGateResultSchema,
  type StructuralGateResult,
} from "../models/structural-gate.js";
import type { LLMMessage } from "../llm/provider.js";

export interface StructuralGateInput {
  readonly chapterNumber: number;
  readonly chapterTitle?: string;
  readonly chapterIntent?: string;
  readonly contextPackage?: ContextPackage;
  readonly ruleStack?: RuleStack;
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
  readonly currentState: string;
  readonly pendingHooks: string;
  readonly draftContent: string;
}

export class StructuralGateAgent extends BaseAgent {
  get name(): string {
    return "structural-gate";
  }

  async evaluateStructuralGate(input: StructuralGateInput): Promise<StructuralGateResult> {
    const messages = this.buildPrompt(input);
    const response = await this.chat(messages, { temperature: 0.2, maxTokens: 4096 });
    return parseStructuralGateResult(response.content);
  }

  private buildPrompt(input: StructuralGateInput): ReadonlyArray<LLMMessage> {
    const systemPrompt = [
      "You are a structural gate for draft chapters.",
      "Evaluate whether the draft is structurally ready to proceed.",
      "Return ONLY valid JSON that matches the required schema.",
      "Use critical findings for hard structural failures.",
      "Use soft findings for quality concerns that do not block progress.",
      "The `passed` field must be true only when there are no critical findings.",
      input.chapterNumber === 1
        ? "Chapter 1 foundation requirement: the opening must establish the story contract, immediate pressure, and the reason the story continues. Missing this is a critical failure."
        : "For non-opening chapters, judge whether the draft preserves the established structural contract and advances the chapter's local objective.",
      "Do not add prose outside the JSON object.",
    ].join("\n");

    const userPrompt = [
      `## Chapter ${input.chapterNumber}${input.chapterTitle ? `: ${input.chapterTitle}` : ""}`,
      input.chapterIntent ? `\n## Chapter Intent\n${input.chapterIntent.trim()}` : "",
      input.contextPackage ? buildContextPackageBlock(input.contextPackage) : "",
      input.ruleStack ? buildRuleStackBlock(input.ruleStack) : "",
      `\n## Story Bible\n${sliceBlock(input.storyBible, 4000)}`,
      `\n## Volume Outline\n${sliceBlock(input.volumeOutline, 4000)}`,
      `\n## Book Rules\n${sliceBlock(input.bookRules, 2500)}`,
      `\n## Current State\n${sliceBlock(input.currentState, 2000)}`,
      `\n## Pending Hooks\n${sliceBlock(input.pendingHooks, 2000)}`,
      `\n## Draft Content\n${sliceBlock(input.draftContent, 8000)}`,
      "\n## Output Schema",
      JSON.stringify(
        {
          passed: false,
          summary: "string",
          criticalFindings: [
            {
              severity: "critical",
              code: "missing-foundation-requirement",
              message: "string",
              evidence: "string",
              location: "string",
            },
          ],
          softFindings: [
            {
              severity: "soft",
              code: "clarity-gap",
              message: "string",
              evidence: "string",
              location: "string",
            },
          ],
        },
        null,
        2,
      ),
    ]
      .filter(Boolean)
      .join("\n");

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
  }
}

export function parseStructuralGateResult(content: string): StructuralGateResult {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Structural gate returned an empty response");
  }

  const candidate = extractJsonCandidate(trimmed);
  if (!candidate) {
    throw new Error("Structural gate response was not valid JSON");
  }

  try {
    return StructuralGateResultSchema.parse(JSON.parse(candidate));
  } catch (error) {
    throw new Error(`Structural gate response failed validation: ${error}`);
  }
}

function extractJsonCandidate(text: string): string | null {
  if (text.startsWith("```")) {
    const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match?.[1]?.trim() ?? null;
  }

  const direct = extractBalancedJsonObject(text);
  if (direct) {
    return direct;
  }

  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    const block = codeBlockMatch[1]!.trim();
    return extractBalancedJsonObject(block) ?? block;
  }

  return null;
}

function buildContextPackageBlock(contextPackage: ContextPackage): string {
  const lines = contextPackage.selectedContext.length > 0
    ? contextPackage.selectedContext.map((entry) =>
      `- ${entry.source}: ${entry.reason}${entry.excerpt ? ` | ${entry.excerpt}` : ""}`,
    )
    : ["- none"];

  return [
    "## Governed Context Package",
    `Chapter: ${contextPackage.chapter}`,
    ...lines,
  ].join("\n");
}

function buildRuleStackBlock(ruleStack: RuleStack): string {
  const formatSection = (heading: string, items: ReadonlyArray<string>): string => [
    heading,
    ...(items.length > 0 ? items.map((item) => `- ${item}`) : ["- none"]),
  ].join("\n");

  const formatLayer = (layer: RuleStack["layers"][number]): string => [
    `- id: ${layer.id}`,
    `  name: ${layer.name}`,
    `  precedence: ${layer.precedence}`,
    `  scope: ${layer.scope}`,
  ].join("\n");

  const formatEdge = (edge: RuleStack["overrideEdges"][number]): string => [
    `- from: ${edge.from}`,
    `  to: ${edge.to}`,
    `  allowed: ${edge.allowed}`,
    `  scope: ${edge.scope}`,
  ].join("\n");

  const formatOverride = (override: RuleStack["activeOverrides"][number]): string => [
    `- from: ${override.from}`,
    `  to: ${override.to}`,
    `  target: ${override.target}`,
    `  reason: ${override.reason}`,
  ].join("\n");

  return [
    "## Governed Rule Stack",
    "### Layers",
    ...(ruleStack.layers.length > 0 ? ruleStack.layers.map(formatLayer) : ["- none"]),
    formatSection("### Hard", ruleStack.sections.hard),
    formatSection("### Soft", ruleStack.sections.soft),
    formatSection("### Diagnostic", ruleStack.sections.diagnostic),
    "### Override Edges",
    ...(ruleStack.overrideEdges.length > 0 ? ruleStack.overrideEdges.map(formatEdge) : ["- none"]),
    "### Active Overrides",
    ...(ruleStack.activeOverrides.length > 0 ? ruleStack.activeOverrides.map(formatOverride) : ["- none"]),
  ].join("\n");
}

function sliceBlock(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
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
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}
