import { describe, expect, it } from "vitest";
import { splitCommand, stdioInvocation } from "../src/pool.js";

/**
 * Stdio MCP invocation is forgiving on purpose: a `command` may be a bare
 * executable OR a whole command line pasted verbatim (Docker Desktop hands you
 * "docker mcp gateway run --profile X"), and neither a trailing space nor a
 * blank arg should turn into a spawn ENOENT.
 */
describe("stdio MCP command parsing", () => {
  it("tokenizes a pasted command line into command + args", () => {
    expect(stdioInvocation("docker mcp gateway run --profile profile_default")).toEqual({
      command: "docker",
      args: ["mcp", "gateway", "run", "--profile", "profile_default"],
    });
  });

  it("ignores leading/trailing whitespace and blank args (the trailing-space trap)", () => {
    expect(stdioInvocation("  docker mcp gateway run  ", ["", " --profile ", "X"])).toEqual({
      command: "docker",
      args: ["mcp", "gateway", "run", "--profile", "X"],
    });
  });

  it("keeps a bare executable with explicit args (the split form) unchanged", () => {
    expect(stdioInvocation("docker", ["mcp", "gateway", "run"])).toEqual({
      command: "docker",
      args: ["mcp", "gateway", "run"],
    });
  });

  it("merges tokens from a partially-split command with explicit args", () => {
    expect(stdioInvocation("docker mcp gateway", ["run", "--profile", "X"])).toEqual({
      command: "docker",
      args: ["mcp", "gateway", "run", "--profile", "X"],
    });
  });

  it("honors quotes so an arg with spaces survives", () => {
    expect(splitCommand(`mybin --msg "hello world" '/a b/c'`)).toEqual(["mybin", "--msg", "hello world", "/a b/c"]);
  });

  it("throws a clear error when there's no command at all", () => {
    expect(() => stdioInvocation("   ")).toThrow(/needs a command/);
  });
});
