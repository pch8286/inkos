import { describe, expect, it } from "vitest";
import {
  buildStandaloneCockpitUrl,
  buildStudioEntrypointUrl,
} from "./shared/cockpit-entrypoint";

describe("buildStudioEntrypointUrl", () => {
  it("derives studio root from the current cockpit entry path", () => {
    expect(buildStudioEntrypointUrl("/cockpit/")).toBe("/");
  });

  it("strips the trailing cockpit segment for mounted deployments with details", () => {
    expect(buildStudioEntrypointUrl("/tenant-a/cockpit/", { page: "book", bookId: "alpha" }))
      .toBe("/tenant-a/?page=book&bookId=alpha");
  });
});

describe("buildStandaloneCockpitUrl", () => {
  it("builds the cockpit shell path from the studio root and keeps bookId", () => {
    expect(buildStandaloneCockpitUrl("/", { bookId: "alpha" })).toBe("/cockpit/?bookId=alpha");
  });

  it("builds the cockpit shell path for mounted deployments", () => {
    expect(buildStandaloneCockpitUrl("/tenant-a/", { bookId: "beta" }))
      .toBe("/tenant-a/cockpit/?bookId=beta");
  });

  it("normalizes missing trailing slashes", () => {
    expect(buildStandaloneCockpitUrl("/tenant-a")).toBe("/tenant-a/cockpit/");
  });
});
