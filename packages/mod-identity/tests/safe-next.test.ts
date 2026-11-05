import { describe, it, expect } from "vitest";
import { safeNextPath } from "../src/pages/html.js";

describe("safeNextPath — the post-login open-redirect guard", () => {
  it("keeps same-origin paths, query and hash included", () => {
    expect(safeNextPath("/pro")).toBe("/pro");
    expect(safeNextPath("/a/b?x=1#h")).toBe("/a/b?x=1#h");
  });

  it("refuses everything a browser would resolve to another origin", () => {
    for (const evil of [
      "//evil.com",
      "https://evil.com",
      "/\\evil.com", // a backslash reads as "/"
      "/\t/evil.com", // tabs and newlines are dropped
      "/\n/evil.com",
      "evil.com",
      "",
      undefined,
      42,
    ]) {
      expect(safeNextPath(evil)).toBe("/");
    }
  });
});
