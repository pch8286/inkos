import { describe, expect, it } from "vitest";
import { resolveConfirmDialogPortalTarget } from "./ConfirmDialog";

describe("ConfirmDialog helpers", () => {
  it("uses document.body as the portal target when available", () => {
    const body = { nodeName: "BODY" } as unknown as HTMLElement;
    const ownerDocument = { body } as Document;

    expect(resolveConfirmDialogPortalTarget(ownerDocument)).toBe(body);
  });

  it("falls back to inline rendering when no document body exists", () => {
    expect(resolveConfirmDialogPortalTarget(undefined)).toBeNull();
    expect(resolveConfirmDialogPortalTarget({ body: null } as unknown as Document)).toBeNull();
  });
});
