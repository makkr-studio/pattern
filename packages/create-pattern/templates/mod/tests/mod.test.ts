import { test, expect } from "vitest";
import { Engine } from "@pattern-js/core";
import mod from "../src/index.js";

/**
 * A fast pre-publish smoke test: the mod installs into a bare engine without
 * throwing, and exposes its name. Extend it to assert your ops register and your
 * routes respond (run the engine and call them).
 */
test("the mod installs into an engine", () => {
  const engine = new Engine();
  engine.use(mod);
  expect(mod.name).toBe("{{pkgName}}");
});
