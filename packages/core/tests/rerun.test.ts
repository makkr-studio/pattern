import { describe, it, expect } from "vitest";
import { Engine, MemoryRunLedger, RUN_LEDGER, ResumeBlockedError, type Workflow } from "@pattern-js/core";

/**
 * The durable-resume harness: in → send (external, counts) → shaky (fails
 * until `healed`) → out. Run fails after the send happened once; resume must
 * NOT send again.
 */
function harness() {
  const engine = new Engine();
  const ledger = new MemoryRunLedger();
  engine.provideService(RUN_LEDGER, ledger);
  let sends = 0;
  let healed = false;
  engine.registerOp({
    type: "t.send",
    effects: "external",
    inputs: { value: { kind: "value", required: true } },
    outputs: { out: { kind: "value" } },
    execute: async (ctx) => {
      sends++;
      return { out: `sent:${await ctx.input.value("value")}` };
    },
  });
  engine.registerOp({
    type: "t.shaky",
    inputs: { value: { kind: "value", required: true } },
    outputs: { out: { kind: "value" } },
    execute: async (ctx) => {
      // Pull the input FIRST (like a real op), then fail — so the upstream
      // node completes before the run tears down.
      const v = await ctx.input.value("value");
      if (!healed) throw new Error("downstream is down");
      return { out: `ok:${v}` };
    },
  });
  const wf: Workflow = {
    id: "pay",
    durable: true,
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
      { id: "send", op: "t.send" },
      { id: "shaky", op: "t.shaky" },
      { id: "out", op: "boundary.return" },
    ],
    edges: [
      { from: { node: "in", port: "v" }, to: { node: "send", port: "value" } },
      { from: { node: "send", port: "out" }, to: { node: "shaky", port: "value" } },
      { from: { node: "shaky", port: "out" }, to: { node: "out", port: "value" } },
    ],
  } as Workflow;
  engine.registerWorkflow(wf);
  return { engine, ledger, wf, sends: () => sends, heal: () => (healed = true) };
}

describe("engine.rerun — resume from failure", () => {
  it("seeds the completed frontier: the external node runs EXACTLY once across fail+resume", async () => {
    const h = harness();
    const first = await h.engine.run("pay", { input: { v: "invoice-1" } });
    expect(first.status).toBe("error");
    expect(h.sends()).toBe(1);

    h.heal();
    const { runId: newRunId, result } = await h.engine.rerun(first.runId);
    const second = await result;
    expect(second.status).toBe("ok");
    expect(newRunId).not.toBe(first.runId);
    // The whole point: the send did NOT repeat.
    expect(h.sends()).toBe(1);
    // And the value flowed from the SEEDED record into the re-run frontier.
    expect((Object.values(second.outputs)[0] as { value: string }).value).toBe("ok:sent:invoice-1");
    // Lineage recorded; the resumed run is itself resumable.
    const rec = (await h.ledger.get(newRunId))!;
    expect(rec.header.resumedFrom).toBe(first.runId);
    expect(rec.header.status).toBe("ok");
    expect(rec.nodes.find((n) => n.nodeId === "send")?.status).toBe("done");
  });

  it("refuses to resume through an ambiguous started external node — unless confirmed", async () => {
    const h = harness();
    const first = await h.engine.run("pay", { input: { v: "x" } });
    // Forge the crash-mid-execute shape: the send STARTED but never finished.
    h.ledger.nodeFinished({ runId: first.runId, nodeId: "send", status: "started" });
    h.heal();
    await expect(h.engine.rerun(first.runId)).rejects.toThrow(ResumeBlockedError);
    await expect(h.engine.rerun(first.runId)).rejects.toThrow(/"send"/);
    const { result } = await h.engine.rerun(first.runId, { confirmExternal: true });
    const second = await result;
    expect(second.status).toBe("ok");
    expect(h.sends()).toBe(2); // confirmed re-run really re-sent
  });

  it("pins the workflow structure: a changed doc refuses to resume", async () => {
    const h = harness();
    const first = await h.engine.run("pay", { input: { v: "x" } });
    const changed = JSON.parse(JSON.stringify(h.wf)) as Workflow;
    changed.nodes.find((n) => n.id === "shaky")!.config = { anything: true };
    h.engine.registerWorkflow(changed);
    await expect(h.engine.rerun(first.runId)).rejects.toThrow(/changed since/);
  });

  it("an ok run resumes only from start; unknown runs name the durable fix", async () => {
    const h = harness();
    h.heal();
    const fine = await h.engine.run("pay", { input: { v: "y" } });
    expect(fine.status).toBe("ok");
    await expect(h.engine.rerun(fine.runId)).rejects.toThrow(/completed fine/);
    await expect(h.engine.rerun("nope")).rejects.toThrow(/durable: true/);
  });

  it('from: "start" replays the recorded input as a fresh full run', async () => {
    const h = harness();
    h.heal();
    const first = await h.engine.run("pay", { input: { v: "replay-me" } });
    expect(h.sends()).toBe(1);
    const { result } = await h.engine.rerun(first.runId, { from: "start" });
    const second = await result;
    expect(second.status).toBe("ok");
    expect(h.sends()).toBe(2); // full re-execution
    expect((Object.values(second.outputs)[0] as { value: string }).value).toBe("ok:sent:replay-me");
  });

  it("resume keeps the unpicked branch skipped", async () => {
    const engine = new Engine();
    const ledger = new MemoryRunLedger();
    engine.provideService(RUN_LEDGER, ledger);
    let elseRuns = 0;
    let healed = false;
    engine.registerOp({
      type: "t.elseSpy",
      inputs: { value: { kind: "value", required: true } },
      outputs: { out: { kind: "value" } },
      execute: async (ctx) => {
        elseRuns++;
        return { out: await ctx.input.value("value") };
      },
    });
    engine.registerOp({
      type: "t.shaky2",
      inputs: { value: { kind: "value", required: true } },
      outputs: { out: { kind: "value" } },
      execute: async (ctx) => {
        const v = await ctx.input.value("value");
        if (!healed) throw new Error("nope");
        return { out: v };
      },
    });
    engine.registerWorkflow({
      id: "br",
      durable: true,
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["flag"] } },
        { id: "b", op: "core.flow.branch" },
        { id: "yes", op: "core.const.json", config: { value: "picked" } },
        { id: "no", op: "t.elseSpy" },
        { id: "after", op: "t.shaky2" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "flag" }, to: { node: "b", port: "condition" } },
        { from: { node: "b", port: "then" }, to: { node: "yes", port: "in" } },
        { from: { node: "b", port: "else" }, to: { node: "no", port: "in" } },
        { from: { node: "in", port: "flag" }, to: { node: "no", port: "value" } },
        { from: { node: "yes", port: "out" }, to: { node: "after", port: "value" } },
        { from: { node: "after", port: "out" }, to: { node: "out", port: "value" } },
      ],
    } as Workflow);
    const first = await engine.run("br", { input: { flag: true } });
    expect(first.status).toBe("error");
    healed = true;
    const { result } = await engine.rerun(first.runId);
    const second = await result;
    expect(second.status).toBe("ok");
    expect(elseRuns).toBe(0); // the unpicked branch stayed skipped through resume
    expect((Object.values(second.outputs)[0] as { value: string }).value).toBe("picked");
  });
});
