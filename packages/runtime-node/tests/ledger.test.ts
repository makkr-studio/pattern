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
      resumedFrom: "r0",
      rootRunId: "r-root",
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
    ledger.nodeStarted("r1", "n2", Date.now());
    ledger.nodeFinished({ runId: "r1", nodeId: "n2", status: "error", error: { message: "refused", noEffect: true }, endedAt: Date.now() });
    ledger.end("r1", "error", { message: "boom", nodeId: "n1" });

    const rec = (await ledger.get("r1"))!;
    expect(rec.header.status).toBe("error");
    expect(rec.header.error).toEqual({ message: "boom", nodeId: "n1" });
    // Lineage + the effect verdict survive the round trip (resume reads both).
    expect(rec.header.resumedFrom).toBe("r0");
    expect(rec.header.rootRunId).toBe("r-root");
    expect(rec.nodes.find((n) => n.nodeId === "n2")).toMatchObject({ status: "error", error: { message: "refused", noEffect: true } });
    const input = decodeLedgerValue(rec.header.input.v!) as { big: string; bytes: Uint8Array };
    expect(input.big).toBe(big);
    expect([...input.bytes]).toEqual([7, 8]);
    const n1 = rec.nodes.find((n) => n.nodeId === "n1")!;
    expect(n1.status).toBe("done");
    expect(decodeLedgerValue(n1.outputs!.out!)).toBe(big);
    expect(n1.pulsed).toEqual(["out"]);
    ledger.close();
  });

  it("grows the 0.5.0-era schema in place — a ledger file from before root_run_id/error opens and records both", async () => {
    const path = tmpDb();
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
    const raw = new DatabaseSync(path);
    raw.exec(`
      CREATE TABLE ledger_runs (run_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, workflow_hash TEXT NOT NULL,
        trigger_node TEXT NOT NULL, input TEXT NOT NULL, params TEXT, principal TEXT NOT NULL, parent_run_id TEXT,
        resumed_from TEXT, status TEXT NOT NULL, error TEXT, started_at REAL NOT NULL, ended_at REAL);
      CREATE TABLE ledger_nodes (run_id TEXT NOT NULL, node_id TEXT NOT NULL, status TEXT NOT NULL, outputs TEXT,
        pulsed TEXT, streaming INTEGER NOT NULL DEFAULT 0, unserializable INTEGER NOT NULL DEFAULT 0,
        started_at REAL, ended_at REAL, PRIMARY KEY (run_id, node_id));
      INSERT INTO ledger_runs VALUES ('old', 'wf', 'h', 'in', '{}', NULL, '{"kind":"anonymous"}', NULL, NULL, 'error', NULL, 1, 2);
    `);
    raw.close();

    const ledger = createRunLedger(path);
    // The pre-existing row reads back (new columns null → undefined)…
    const old = (await ledger.get("old"))!;
    expect(old.header.rootRunId).toBeUndefined();
    // …and new writes use the grown columns.
    ledger.begin({ runId: "new", workflowId: "wf", workflowHash: "h", triggerNodeId: "in", input: {}, principal: { kind: "anonymous" }, rootRunId: "old", status: "running", startedAt: Date.now() });
    ledger.nodeFinished({ runId: "new", nodeId: "n", status: "error", error: { message: "x" }, endedAt: Date.now() });
    const rec = (await ledger.get("new"))!;
    expect(rec.header.rootRunId).toBe("old");
    expect(rec.nodes[0]?.error).toEqual({ message: "x" });
    ledger.close();
  });

  it("the crash sweep goes by OWNER liveness, not run age — a dead process's young run is swept, a live sibling's long run is not", async () => {
    const path = tmpDb();
    const base = {
      workflowId: "wf",
      workflowHash: "h",
      triggerNodeId: "in",
      input: {},
      principal: { kind: "anonymous" } as const,
      status: "running" as const,
    };
    const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // A process that DIES: it beats once at open and never again (a huge
    // heartbeat period stands in for the crash), so its heartbeat goes stale
    // even though its run is seconds old.
    const dead = createRunLedger(path, { heartbeatMs: 3_600_000, staleMs: 40 });
    dead.begin({ ...base, runId: "young-but-orphaned", startedAt: Date.now() });
    // A process that LIVES beside us: heartbeats fast, and its run has been going for ten minutes.
    const alive = createRunLedger(path, { heartbeatMs: 5, staleMs: 40 });
    alive.begin({ ...base, runId: "long-but-alive", startedAt: Date.now() - 600_000 });
    // A row from before ownership existed (owner NULL): the age rule still applies.
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
    const raw = new DatabaseSync(path);
    raw.exec("PRAGMA busy_timeout = 5000");
    for (const [id, started] of [
      ["legacy-old", Date.now() - 120_000],
      ["legacy-fresh", Date.now()],
    ] as const) {
      raw
        .prepare(
          "INSERT INTO ledger_runs (run_id, workflow_id, workflow_hash, trigger_node, input, principal, status, started_at) VALUES (?, 'wf', 'h', 'in', '{}', '{\"kind\":\"anonymous\"}', 'running', ?)",
        )
        .run(id, started);
    }
    raw.close();
    await tick(60); // the dead owner's beat is now stale; the live one keeps beating

    const booting = createRunLedger(path, { heartbeatMs: 5, staleMs: 40 }); // reopen = boot sweep
    expect((await booting.get("young-but-orphaned"))!.header).toMatchObject({ status: "error", error: { message: expect.stringContaining("interrupted") } });
    expect((await booting.get("long-but-alive"))!.header.status).toBe("running"); // its owner is alive — age is irrelevant
    expect((await booting.get("legacy-old"))!.header.status).toBe("error"); // owner-less → the one-minute rule
    expect((await booting.get("legacy-fresh"))!.header.status).toBe("running");

    // The sibling exits cleanly (its owner row goes) while its run is still
    // "running" — the periodic sweep, not a restart, catches it.
    alive.close();
    await tick(30);
    expect((await booting.get("long-but-alive"))!.header.status).toBe("error");

    // Our own runs are never our orphans, however long they take.
    booting.begin({ ...base, runId: "mine", startedAt: Date.now() - 3_600_000 });
    booting.sweep();
    expect((await booting.get("mine"))!.header.status).toBe("running");
    dead.close();
    booting.close();
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
