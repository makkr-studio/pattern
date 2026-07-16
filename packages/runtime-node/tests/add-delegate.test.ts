/**
 * `pattern add` delegation planning — pure unit (no npx is ever spawned):
 * the spec must come from the PROJECT's @pattern-js generation, so a grown
 * app gets layer definitions that match what it runs.
 */
import { describe, expect, it } from "vitest";
import { planAddDelegation } from "@pattern-js/runtime-node";

describe("pattern add delegation", () => {
  it("derives the create-pattern spec from the project's own range", () => {
    const plan = planAddDelegation(JSON.stringify({ dependencies: { "@pattern-js/core": "^0.5.0" } }), ["billing", "--no-examples"]);
    expect(plan.spec).toBe("create-pattern@^0.5.0");
    expect(plan.argv).toEqual(["--yes", "create-pattern@^0.5.0", "add", "billing", "--no-examples"]);
    expect(plan.warning).toBeUndefined();
  });

  it("prefers core, falls back to runtime-node, then any @pattern-js dep", () => {
    expect(planAddDelegation(JSON.stringify({ dependencies: { "@pattern-js/runtime-node": "^0.4.0" } }), []).spec).toBe("create-pattern@^0.4.0");
    expect(planAddDelegation(JSON.stringify({ dependencies: { "@pattern-js/mod-email": "~0.3.2" } }), []).spec).toBe("create-pattern@~0.3.2");
  });

  it("falls back to latest with a warning when the range is underivable", () => {
    for (const text of [null, "{not json", JSON.stringify({ dependencies: { express: "^4.0.0" } })]) {
      const plan = planAddDelegation(text, ["chat"]);
      expect(plan.spec).toBe("create-pattern@latest");
      expect(plan.warning).toBeTruthy();
    }
  });
});
