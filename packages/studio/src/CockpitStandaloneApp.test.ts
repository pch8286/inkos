import { describe, expect, it } from "vitest";
import { resolveBookIdFromSearch } from "./CockpitStandaloneApp";

describe("resolveBookIdFromSearch", () => {
  it("returns the trimmed bookId from the current search string", () => {
    expect(resolveBookIdFromSearch("?bookId=%20alpha%20")).toBe("alpha");
  });

  it("returns undefined when bookId is missing or blank", () => {
    expect(resolveBookIdFromSearch("")).toBeUndefined();
    expect(resolveBookIdFromSearch("?bookId=%20%20")).toBeUndefined();
  });
});
