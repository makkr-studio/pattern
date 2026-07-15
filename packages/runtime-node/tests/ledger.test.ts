import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunLedger, loadProject } from "@pattern-js/runtime-node";
import {
  RUN_LEDGER,
  decodeLedgerValue,
  encodeLedgerValue,
  type RunLedger,
  type Workflow,
} from "@pattern-js/core";

const tmpDb = () => join(mkdtempSync(join(tmpdir(), "pattern-ledger-")), "ledger.db");

describe("sqlite RunLedger", () => {
  it("roundtrips a run exactly — big values, bytes, pulses, error shape", async () => {
    const path = tmpDb();
    const ledger = createRunLedger(path);
    const big = "y".repeat(1_000_000);
    ledger.begin({
      runId: "r1",
      workflowId: "wf",
      workflowHash: "abc123",
      triggerNodeId: "in",
      input: { v: encodeLedgerValue({ big, bytes: new Uint8Array([7, 8]) }) },
      principal: { kind: "anonymous" },
      status: "running",
      startedAt: Date.now(),
    });
    ledger.nodeStarted("r1", "n1", Date.now());
    ledger.nodeFinished({
      runId: "r1",
      nodeId: "n1",
      status: "done",
      outputs: { out: encodeLedgerValue(big) },
      pulsed: ["out"],
      endedAt: Date.now(),
    });
    ledger.end("r1", "error", { message: "boom", nodeId: "n1" });

    const rec = (await ledger.get("r1"))!;
    expect(rec.header.status).toBe("error");
    expect(rec.header.error).toEqual({ message: "boom", nodeId: "n1" });
    const input = decodeLedgerValue(rec.header.input.v!) as { big: string; bytes: Uint8Array };
    expect(input.big).toBe(big);
    expect([...input.bytes]).toEqual([7, 8]);
    const n1 = rec.nodes.find((n) => n.nodeId === "n1")!;
    expect(n1.status).toBe("done");
    expect(decodeLedgerValue(n1.outputs!.out!)).toBe(big);
    expect(n1.pulsed).toEqual(["out"]);
    ledger.close();
  });

  it("boot sweep converts stale running runs to resumable interrupted errors", async () => {
    const path = tmpDb();
    const first = createRunLedger(path);
    const base = {
      workflowId: "wf",
      workflowHash: "h",
      triggerNodeId: "in",
      input: {},
      principal: { kind: "anonymous" } as const,
      status: "running" as const,
    };
    first.begin({ ...base, runId: "stale", startedAt: Date.now() - 120_000 });
    first.begin({ ...base, runId: "fresh", startedAt: Date.now() });
    first.close();

    const second = createRunLedger(path); // reopen = boot
    const stale = (await second.get("stale"))!;
    const fresh = (await second.get("fresh"))!;
    expect(stale.header.status).toBe("error");
    expect(stale.header.error?.message).toContain("interrupted");
    // The one-minute grace protects a concurrent process's live run.
    expect(fresh.header.status).toBe("running");
    second.close();
  });

  it("prunes oldest terminal runs beyond keep, never live ones", async () => {
    const ledger = createRunLedger(tmpDb(), { keep: 2 });
    const base = {
      workflowId: "wf",
      workflowHash: "h",
      triggerNodeId: "in",
      input: {},
      principal: { kind: "anonymous" } as const,
      status: "running" as const,
    };
    for (let i = 0; i < 5; i++) {
      ledger.begin({ ...base, runId: `r${i}`, startedAt: 1000 + i });
      ledger.end(`r${i}`, "ok");
    }
    ledger.begin({ ...base, runId: "live", startedAt: 1 }); // oldest, but running
    ledger.prune();
    expect(await ledger.get("r0")).toBeNull();
    expect(await ledger.get("r4")).not.toBeNull();
    expect((await ledger.get("live"))!.header.status).toBe("running");
    ledger.close();
  });
});

describe("worker ledger bridge", () => {
  const modPath = fileURLToPath(new URL("./fixtures/project/mods/whereami.mjs", import.meta.url));

  const durableOffloaded: Workflow = {
    id: "durable-offloaded",
    durable: true,
    offload: true,
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
      { id: "where", op: "app.whereami" },
      { id: "out", op: "boundary.return" },
    ],
    edges: [
      { from: { node: "in", port: "v" }, to: { node: "where", port: "in" } },
      { from: { node: "where", port: "threadId" }, to: { node: "out", port: "value" } },
    ],
  } as Workflow;

  it("an offloaded durable run lands its records in the HOST ledger", async () => {
    const project = await loadProject({
      mods: [modPath],
      workers: 1,
      durable: { path: tmpDb() },
    });
    const { engine } = project;
    const { close } = await project.start();
    try {
      engine.registerWorkflow(durableOffloaded);
      const res = await engine.run("durable-offloaded", { input: { v: 1 } });
      expect(res.status).toBe("ok");

      const ledger = engine.service<RunLedger>(RUN_LEDGER)!;
      // The bridge is async (postMessage) — poll briefly for the terminal record.
      let rec: Awaited<ReturnType<RunLedger["get"]>> = null;
      for (let i = 0; i < 50 && rec?.header.status !== "ok"; i++) {
        rec = await ledger.get(res.runId);
        if (rec?.header.status !== "ok") await new Promise((r) => setTimeout(r, 20));
      }
      expect(rec).not.toBeNull();
      expect(rec!.header.status).toBe("ok");
      expect(rec!.header.workflowId).toBe("durable-offloaded");
      const where = rec!.nodes.find((n) => n.nodeId === "where")!;
      expect(where.status).toBe("done");
      expect(typeof decodeLedgerValue(where.outputs!.threadId!)).toBe("number");
    } finally {
      await close();
    }
  });
});
