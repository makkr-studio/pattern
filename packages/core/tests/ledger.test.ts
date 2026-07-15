import { describe, it, expect } from "vitest";
import {
  Engine,
  MemoryRunLedger,
  RUN_LEDGER,
  decodeLedgerValue,
  encodeLedgerValue,
  ledgerWorkflowHash,
  type Workflow,
} from "@pattern-js/core";

const durableWf = (extra?: Partial<Workflow>): Workflow =>
  ({
    id: "d",
    durable: true,
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: ["user"] } },
      { id: "greet", op: "core.string.template", config: { template: "Hello, {{ name }}!" } },
      { id: "out", op: "boundary.return" },
    ],
    edges: [
      { from: { node: "in", port: "user" }, to: { node: "greet", port: "data" } },
      { from: { node: "greet", port: "out" }, to: { node: "out", port: "value" } },
    ],
    ...extra,
  }) as Workflow;

function engineWithLedger() {
  const engine = new Engine();
  const ledger = new MemoryRunLedger();
  engine.provideService(RUN_LEDGER, ledger);
  return { engine, ledger };
}

describe("RunLedger capture", () => {
  it("records header, exact node outputs, pulses, and the terminal status", async () => {
    const { engine, ledger } = engineWithLedger();
    engine.registerWorkflow(durableWf());
    const res = await engine.run("d", { input: { user: { name: "Ada" } } });
    expect(res.status).toBe("ok");
    const rec = await ledger.get(res.runId);
    expect(rec).not.toBeNull();
    expect(rec!.header.workflowId).toBe("d");
    expect(rec!.header.status).toBe("ok");
    expect(decodeLedgerValue(rec!.header.input.user!)).toEqual({ name: "Ada" });
    expect(rec!.header.workflowHash).toHaveLength(16);
    const greet = rec!.nodes.find((n) => n.nodeId === "greet");
    expect(greet?.status).toBe("done");
    expect(decodeLedgerValue(greet!.outputs!.out!)).toBe("Hello, Ada!");
    expect(greet!.pulsed).toContain("out");
    const out = rec!.nodes.find((n) => n.nodeId === "out");
    expect(out?.status).toBe("done");
    expect(decodeLedgerValue(out!.outputs!.value!)).toBe("Hello, Ada!");
  });

  it("a non-durable workflow records nothing", async () => {
    const { engine, ledger } = engineWithLedger();
    engine.registerWorkflow(durableWf({ id: "plain", durable: undefined }));
    const res = await engine.run("plain", { input: { user: { name: "x" } } });
    expect(res.status).toBe("ok");
    expect(await ledger.get(res.runId)).toBeNull();
  });

  it("a failing run records done ancestors, the errored node, and the header error", async () => {
    const { engine, ledger } = engineWithLedger();
    engine.registerOp({
      type: "t.boom",
      inputs: { value: { kind: "value", required: true } },
      outputs: { out: { kind: "value" } },
      execute: () => {
        throw new Error("kaput");
      },
    });
    engine.registerWorkflow({
      id: "df",
      durable: true,
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
        { id: "ok1", op: "core.string.template", config: { template: "{{ v }}" } },
        { id: "bad", op: "t.boom" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "v" }, to: { node: "ok1", port: "data" } },
        { from: { node: "ok1", port: "out" }, to: { node: "bad", port: "value" } },
        { from: { node: "bad", port: "out" }, to: { node: "out", port: "value" } },
      ],
    } as Workflow);
    const res = await engine.run("df", { input: { v: "hi" } });
    expect(res.status).toBe("error");
    const rec = (await ledger.get(res.runId))!;
    expect(rec.header.status).toBe("error");
    expect(rec.header.error?.nodeId).toBe("bad");
    expect(rec.nodes.find((n) => n.nodeId === "ok1")?.status).toBe("done");
    expect(rec.nodes.find((n) => n.nodeId === "bad")?.status).toBe("error");
  });

  it("records the chosen branch as pulsed and the unpicked path as skipped", async () => {
    const { engine, ledger } = engineWithLedger();
    engine.registerWorkflow({
      id: "db",
      durable: true,
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["flag"] } },
        { id: "b", op: "core.flow.branch" },
        { id: "yes", op: "core.const.json", config: { value: "picked" } },
        { id: "no", op: "core.const.json", config: { value: "not picked" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "flag" }, to: { node: "b", port: "condition" } },
        { from: { node: "b", port: "then" }, to: { node: "yes", port: "in" } },
        { from: { node: "b", port: "else" }, to: { node: "no", port: "in" } },
        { from: { node: "yes", port: "out" }, to: { node: "out", port: "value" } },
      ],
    } as Workflow);
    const res = await engine.run("db", { input: { flag: true } });
    expect(res.status).toBe("ok");
    const rec = (await ledger.get(res.runId))!;
    const b = rec.nodes.find((n) => n.nodeId === "b")!;
    expect(b.pulsed).toContain("then");
    expect(b.pulsed).not.toContain("else");
    expect(rec.nodes.find((n) => n.nodeId === "no")?.status).toBe("skipped");
    expect(rec.nodes.find((n) => n.nodeId === "yes")?.status).toBe("done");
  });

  it("a streaming node is recorded unseedable, value siblings still captured", async () => {
    const { engine, ledger } = engineWithLedger();
    engine.registerWorkflow({
      id: "ds",
      durable: true,
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
        { id: "feed", op: "core.stream.emit" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "v" }, to: { node: "feed", port: "in" } },
        { from: { node: "in", port: "v" }, to: { node: "out", port: "value" } },
      ],
    } as Workflow);
    const res = await engine.run("ds", { input: { v: [1, 2, 3] } });
    expect(res.status).toBe("ok");
    const rec = (await ledger.get(res.runId))!;
    const feed = rec.nodes.find((n) => n.nodeId === "feed")!;
    expect(feed.status).toBe("done");
    expect(feed.streaming).toBe(true);
  });
});

describe("ledger value codec", () => {
  it("roundtrips structured values, bytes, and big payloads exactly", () => {
    const big = "x".repeat(1_000_000);
    const v = { s: big, n: 42, deep: { arr: [1, "two", null] }, bytes: new Uint8Array([0, 127, 255]) };
    const decoded = decodeLedgerValue(encodeLedgerValue(v)) as typeof v;
    expect(decoded.s).toBe(big);
    expect(decoded.deep.arr).toEqual([1, "two", null]);
    expect(decoded.bytes).toBeInstanceOf(Uint8Array);
    expect([...decoded.bytes]).toEqual([0, 127, 255]);
  });

  it("marks streams, functions, and cycles unserializable instead of throwing", () => {
    expect(encodeLedgerValue(new ReadableStream())).toEqual({ unserializable: true });
    expect(encodeLedgerValue({ f: () => 1 })).toEqual({ unserializable: true });
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(encodeLedgerValue(cyc)).toEqual({ unserializable: true });
  });
});

describe("ledger workflow hash", () => {
  it("ignores layout and durable/offload, changes with config", () => {
    const a = durableWf();
    const b = durableWf({ durable: undefined, offload: true });
    (b.nodes[1] as { ui?: unknown }).ui = { x: 999, y: 999 };
    expect(ledgerWorkflowHash(a)).toBe(ledgerWorkflowHash(b));
    const c = durableWf();
    (c.nodes[1] as { config?: unknown }).config = { template: "Bye, {{ name }}!" };
    expect(ledgerWorkflowHash(a)).not.toBe(ledgerWorkflowHash(c));
  });
});
