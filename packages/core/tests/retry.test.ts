import { describe, it, expect } from "vitest";
import { CollectingTraceSink, Engine, collectIssues, type Workflow } from "@pattern-js/core";

/** An op that fails its first `failures` executions, then returns "done". */
function flakyOp(type: string, failures: number) {
  let calls = 0;
  const op = {
    type,
    inputs: {},
    outputs: { out: { kind: "value" as const } },
    execute: () => {
      calls++;
      if (calls <= failures) throw new Error(`flaky failure #${calls}`);
      return { out: "done" };
    },
  };
  return { op, calls: () => calls };
}

const wfWith = (opType: string, retry?: unknown): Workflow =>
  ({
    id: "w",
    nodes: [
      { id: "in", op: "boundary.manual" },
      { id: "n", op: opType, ...(retry ? { retry } : {}) },
      { id: "out", op: "boundary.return" },
    ],
    edges: [
      { from: { node: "in", port: "out" }, to: { node: "n", port: "in" } },
      { from: { node: "n", port: "out" }, to: { node: "out", port: "value" } },
    ],
  }) as Workflow;

describe("per-node retry", () => {
  it("re-runs a flaky op and records the attempts on the trace", async () => {
    const engine = new Engine();
    const { op, calls } = flakyOp("t.flaky", 2);
    engine.registerOp(op);
    const sink = new CollectingTraceSink();
    engine.onTrace(sink);
    engine.registerWorkflow(wfWith("t.flaky", { attempts: 3, backoffMs: 1 }));
    const res = await engine.run("w", { input: {} });
    expect(res.status).toBe("ok");
    expect(calls()).toBe(3);
    const span = sink.spans.find((s) => s.attributes["pattern.node.id"] === "n");
    expect(span).toBeDefined();
    const retries = span!.events.filter((e) => e.name === "retry");
    expect(retries).toHaveLength(2);
    expect(retries[0]!.attributes).toMatchObject({ attempt: 1 });
    expect(span!.attributes["retry.attempts"]).toBe(3);
  });

  it("exhausted attempts fail the run with the last error", async () => {
    const engine = new Engine();
    const { op, calls } = flakyOp("t.hopeless", 99);
    engine.registerOp(op);
    engine.registerWorkflow(wfWith("t.hopeless", { attempts: 2, backoffMs: 1 }));
    const res = await engine.run("w", { input: {} });
    expect(res.status).toBe("error");
    expect(calls()).toBe(2);
    expect(String(res.error)).toContain("flaky failure #2");
  });

  it("without retry config nothing retries (failure is a value)", async () => {
    const engine = new Engine();
    const { op, calls } = flakyOp("t.once", 99);
    engine.registerOp(op);
    engine.registerWorkflow(wfWith("t.once"));
    const res = await engine.run("w", { input: {} });
    expect(res.status).toBe("error");
    expect(calls()).toBe(1);
  });

  it("a skip is control flow, never a retried failure", async () => {
    const engine = new Engine();
    let executions = 0;
    engine.registerOp({
      type: "t.counting",
      inputs: { value: { kind: "value", required: true } },
      outputs: { out: { kind: "value" } },
      execute: async (ctx) => {
        executions++;
        return { out: await ctx.input.value("value") };
      },
    });
    // branch picks `then`; the retried node hangs off `else` → it must SKIP,
    // not error, and must not burn retry attempts doing so.
    const wf: Workflow = {
      id: "w2",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["flag"] } },
        { id: "b", op: "core.flow.branch" },
        { id: "yes", op: "core.const.json", config: { value: "picked" } },
        { id: "no", op: "t.counting", retry: { attempts: 5, backoffMs: 1 } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "flag" }, to: { node: "b", port: "condition" } },
        { from: { node: "b", port: "then" }, to: { node: "yes", port: "in" } },
        { from: { node: "b", port: "else" }, to: { node: "no", port: "in" } },
        { from: { node: "in", port: "flag" }, to: { node: "no", port: "value" } },
        { from: { node: "yes", port: "out" }, to: { node: "out", port: "value" } },
      ],
    } as Workflow;
    engine.registerWorkflow(wf);
    const res = await engine.run("w2", { input: { flag: true } });
    expect(res.status).toBe("ok");
    expect(executions).toBe(0);
  });

  it("cancel during backoff settles promptly as canceled", async () => {
    const engine = new Engine();
    const { op } = flakyOp("t.slowflaky", 99);
    engine.registerOp(op);
    engine.registerWorkflow(wfWith("t.slowflaky", { attempts: 10, backoffMs: 5_000 }));
    const started = Date.now();
    const result = engine.run("w", { input: {} });
    await new Promise((r) => setTimeout(r, 20)); // first attempt failed; now backing off
    const [runId] = engine.inflightRunIds();
    engine.cancelRun(runId!);
    const res = await result;
    expect(res.status).toBe("canceled");
    expect(Date.now() - started).toBeLessThan(2_000); // did not sit out the 5s backoff
  });
});

describe("retry validator warnings", () => {
  it("warns on retrying an external-effects op, stays advisory", () => {
    const engine = new Engine();
    const wf = {
      id: "warn1",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
        { id: "emit", op: "core.event.emit", config: { event: "x" }, retry: { attempts: 3 } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "v" }, to: { node: "emit", port: "payload" } },
        { from: { node: "in", port: "v" }, to: { node: "out", port: "value" } },
      ],
    };
    const { ok, issues } = collectIssues(wf, engine.ops);
    expect(ok).toBe(true); // warning never blocks
    expect(issues.some((i) => i.code === "retry_external_effects" && i.severity === "warning")).toBe(true);
  });

  it("warns on retrying a node with a wired stream input", () => {
    const engine = new Engine();
    const wf = {
      id: "warn2",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
        { id: "feed", op: "core.stream.emit" },
        { id: "tpl", op: "core.stream.template", config: { template: "{{ a }}" }, retry: { attempts: 2 } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "v" }, to: { node: "feed", port: "in" } },
        { from: { node: "feed", port: "out" }, to: { node: "tpl", port: "in" } },
        { from: { node: "in", port: "v" }, to: { node: "out", port: "value" } },
      ],
    };
    const { ok, issues } = collectIssues(wf, engine.ops);
    expect(ok).toBe(true);
    expect(issues.some((i) => i.code === "retry_stream_input")).toBe(true);
  });
});
