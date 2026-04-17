import { describe, expect, it } from "vitest";
import { getCockpitCreateActionErrorKey } from "./Cockpit";

describe("getCockpitCreateActionErrorKey", () => {
  it("blocks /create when the new setup flow is not active", () => {
    expect(getCockpitCreateActionErrorKey(false)).toBe("cockpit.createRequiresOpenSetup");
  });

  it("allows /create when the new setup flow is active", () => {
    expect(getCockpitCreateActionErrorKey(true)).toBeNull();
  });
});
