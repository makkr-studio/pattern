import { describe, it, expect, vi, afterEach } from "vitest";
import { ENGINE_INTROSPECT, Engine } from "@pattern-js/core";
import { identityMod } from "../src/index.js";

afterEach(() => vi.restoreAllMocks());

const printed = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => String(c[0])).join("\n");

describe("the first-admin bootstrap link", () => {
  it("is minted and printed when the app serves", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await new Engine().useAsync(identityMod({ storage: "memory" }));
    expect(printed(log)).toMatch(/\/auth\/bootstrap\?t=/);
  });

  it("is not minted by an inspection (pattern ops / validate / run)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const engine = new Engine();
    engine.provideService(ENGINE_INTROSPECT, true);
    await engine.useAsync(identityMod({ storage: "memory" }));
    expect(printed(log)).not.toMatch(/bootstrap/);
  });
});
