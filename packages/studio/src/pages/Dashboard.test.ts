import { describe, expect, it } from "vitest";
import { resolveBookMenuPortalTarget } from "./Dashboard";

describe("Dashboard book menu helpers", () => {
  it("uses document.body as the menu portal target when available", () => {
    const body = { nodeName: "BODY" } as unknown as HTMLElement;
    const ownerDocument = { body } as Document;

    expect(resolveBookMenuPortalTarget(ownerDocument)).toBe(body);
  });

  it("falls back to inline rendering when no document body exists", () => {
    expect(resolveBookMenuPortalTarget(undefined)).toBeNull();
    expect(resolveBookMenuPortalTarget({ body: null } as unknown as Document)).toBeNull();
  });
});
