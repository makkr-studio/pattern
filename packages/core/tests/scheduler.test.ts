import { describe, it, expect } from "vitest";
import { Engine, type Workflow } from "@pattern/core";

/** Build + run a workflow on a fresh engine, returning the first out-gate result. */
async function run(wf: Workflow, input: Record<string, unknown> = {}, params?: Record<string, unknown>) {
  const engine = new Engine();
  engine.registerWorkflow(wf);
  const res = await engine.run(wf, { input, params });
  if (res.status === "error") throw res.error;
  return Object.values(res.outputs)[0] ?? {};
}

describe("scheduler — value edges", () => {
  it("runs a value-only chain (trigger → add → return), pulling in a const ancestor", async () => {
    const wf: Workflow = {
      id: "add",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["a"] } },
        { id: "b", op: "core.const.number", config: { value: 3 } },
        { id: "sum", op: "core.math.add" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "a" }, to: { node: "sum", port: "a" } },
        { from: { node: "b", port: "out" }, to: { node: "sum", port: "b" } },
        { from: { node: "sum", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    expect(await run(wf, { a: 2 })).toEqual({ value: 5 });
  });

  it("reads run-scoped params via core.input", async () => {
    const wf: Workflow = {
      id: "params",
      nodes: [
        { id: "t", op: "boundary.manual" },
        { id: "name", op: "core.input", config: { name: "name", default: "world" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "name", port: "out" }, to: { node: "out", port: "value" } },
        // The trigger drives the out-gate (source-only graph): control edge.
        { from: { node: "t", port: "out" }, to: { node: "out", port: "in" } },
      ],
    };
    expect(await run(wf, {}, { name: "Pattern" })).toEqual({ value: "Pattern" });
    expect(await run(wf, {}, {})).toEqual({ value: "world" });
  });

  it("seeds trigger outputs from input", async () => {
    const wf: Workflow = {
      id: "echo",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["x"] } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [{ from: { node: "t", port: "x" }, to: { node: "out", port: "value" } }],
    };
    expect(await run(wf, { x: 42 })).toEqual({ value: 42 });
  });
});

describe("scheduler — control edges", () => {
  it("sequences side-effecting nodes via control pulses", async () => {
    const wf: Workflow = {
      id: "seq",
      nodes: [
        { id: "t", op: "boundary.manual" },
        { id: "a", op: "core.log", config: { message: "a" } },
        { id: "b", op: "core.log", config: { message: "b" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "value" }, to: { node: "a", port: "value" } },
        { from: { node: "a", port: "value" }, to: { node: "b", port: "value" } },
        { from: { node: "a", port: "out" }, to: { node: "b", port: "in" } },
        { from: { node: "b", port: "value" }, to: { node: "out", port: "value" } },
      ],
    };
    expect(await run(wf, { value: "hi" })).toEqual({ value: "hi" });
  });

  it("selects a branch and skips the untaken path", async () => {
    const wf: Workflow = {
      id: "branch",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["cond"] } },
        { id: "br", op: "core.flow.branch" },
        { id: "yes", op: "core.const.string", config: { value: "yes" } },
        { id: "no", op: "core.const.string", config: { value: "no" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "cond" }, to: { node: "br", port: "condition" } },
        { from: { node: "br", port: "then" }, to: { node: "yes", port: "in" } },
        { from: { node: "br", port: "else" }, to: { node: "no", port: "in" } },
        { from: { node: "yes", port: "out" }, to: { node: "out", port: "value" } },
        { from: { node: "no", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    // Only the taken branch resolves the out-gate input; the engine must not hang.
    expect(await run(wf, { cond: true })).toEqual({ value: "yes" });
    expect(await run(wf, { cond: false })).toEqual({ value: "no" });
  });
});

describe("scheduler — stream edges", () => {
  it("runs emit → accumulate (value↔stream bridge)", async () => {
    const wf: Workflow = {
      id: "stream",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["items"] } },
        { id: "emit", op: "core.stream.emit" },
        { id: "acc", op: "core.stream.accumulate", config: { mode: "array" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "items" }, to: { node: "emit", port: "in" } },
        { from: { node: "emit", port: "out" }, to: { node: "acc", port: "in" } },
        { from: { node: "acc", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    expect(await run(wf, { items: [1, 2, 3] })).toEqual({ value: [1, 2, 3] });
  });

  it("splits a stream into two branches and accumulates both", async () => {
    const wf: Workflow = {
      id: "split",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["items"] } },
        { id: "emit", op: "core.stream.emit" },
        { id: "split", op: "core.stream.split", config: { branches: 2 } },
        { id: "acc0", op: "core.stream.accumulate", config: { mode: "array" } },
        { id: "acc1", op: "core.stream.accumulate", config: { mode: "array" } },
        { id: "out", op: "boundary.return.named", config: { inputs: ["a", "b"] } },
      ],
      edges: [
        { from: { node: "t", port: "items" }, to: { node: "emit", port: "in" } },
        { from: { node: "emit", port: "out" }, to: { node: "split", port: "in" } },
        { from: { node: "split", port: "out.0" }, to: { node: "acc0", port: "in" } },
        { from: { node: "split", port: "out.1" }, to: { node: "acc1", port: "in" } },
        { from: { node: "acc0", port: "out" }, to: { node: "out", port: "a" } },
        { from: { node: "acc1", port: "out" }, to: { node: "out", port: "b" } },
      ],
    };
    expect(await run(wf, { items: [1, 2, 3] })).toEqual({ a: [1, 2, 3], b: [1, 2, 3] });
  });
});

describe("scheduler — errors", () => {
  it("fails the run when a node throws", async () => {
    const wf: Workflow = {
      id: "boom",
      nodes: [
        { id: "t", op: "boundary.manual" },
        { id: "x", op: "core.flow.throw", config: { message: "kaboom" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "value" }, to: { node: "x", port: "data" } },
        { from: { node: "x", port: "out" }, to: { node: "out", port: "in" } },
      ],
    };
    const engine = new Engine();
    engine.registerWorkflow(wf);
    const res = await engine.run(wf, { input: { value: 1 } });
    expect(res.status).toBe("error");
    expect(String((res.error as any)?.message)).toContain("kaboom");
  });
});
