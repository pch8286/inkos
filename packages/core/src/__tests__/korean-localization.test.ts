import { describe, expect, it } from "vitest";
import {
  inferFactSubject,
  isCurrentChapterLabel,
  isStateTableHeaderRow,
} from "../utils/story-markdown.js";
import { normalizeHookPayoffTiming } from "../utils/hook-lifecycle.js";

describe("Korean localization helpers", () => {
  it("recognizes Korean current_state table labels", () => {
    expect(isStateTableHeaderRow(["항목", "값"])).toBe(true);
    expect(isCurrentChapterLabel("현재 화")).toBe(true);
    expect(isCurrentChapterLabel("현재 회차")).toBe(true);
    expect(inferFactSubject("현재 목표")).toBe("protagonist");
    expect(inferFactSubject("현재 제약")).toBe("protagonist");
    expect(inferFactSubject("현재 관계 구도")).toBe("protagonist");
    expect(inferFactSubject("현재 갈등")).toBe("protagonist");
  });

  it("normalizes Korean hook payoff timing labels", () => {
    expect(normalizeHookPayoffTiming("즉시")).toBe("immediate");
    expect(normalizeHookPayoffTiming("근시일")).toBe("near-term");
    expect(normalizeHookPayoffTiming("중반부")).toBe("mid-arc");
    expect(normalizeHookPayoffTiming("장기 누적")).toBe("slow-burn");
    expect(normalizeHookPayoffTiming("종막")).toBe("endgame");
  });
});
