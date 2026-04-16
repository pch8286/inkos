import { describe, expect, it } from "vitest";
import { buildCockpitEntrypointUrl } from "./CockpitStandaloneApp";

describe("buildCockpitEntrypointUrl", () => {
  it("derives studio root from the current cockpit entry path", () => {
    expect(buildCockpitEntrypointUrl("/cockpit/")).toBe("/");
  });

  it("strips the trailing cockpit segment for mounted deployments with details", () => {
    expect(buildCockpitEntrypointUrl("/tenant-a/cockpit/", { page: "book", bookId: "alpha" }))
      .toBe("/tenant-a/?page=book&bookId=alpha");
  });

  it("normalizes a missing trailing slash on mounted cockpit entry paths", () => {
    expect(buildCockpitEntrypointUrl("/tenant-a/cockpit", { page: "truth", bookId: "beta" }))
      .toBe("/tenant-a/?page=truth&bookId=beta");
  });
});
