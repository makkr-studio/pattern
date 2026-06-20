import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, type SpanData, type TraceStore, type Workflow } from "@pattern-js/core";
import { MemoryTraceStore, createTraceStore, openSqliteTraceStore } from "@pattern-js/runtime-node";

/**
 * The durable trace store: a SQLite backend that mirrors the in-memory one
 * behind core's `TraceStore`, persists spans incl. events + I/O (so Replay reads
 * from disk), survives a "restart", retains a bounded window, and records runs
 * from any process that writes the file (the CLI path).
 */

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
});

const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "pattern-trace-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** A shared mutable clock so the run's stamped start time matches our synthetic
 *  span/ready/end times (the store stamps `now()` on onRunStart). */
const clock = { t: 0 };

/** Feed one canonical streaming run (start → ready → a node span with events +
 *  io → end) through a store's TraceSink side. */
function driveStreamingRun(store: TraceStore, ids: { runId: string; traceId: string }, t0 = 1000): void {
  clock.t = t0;
  store.onRunStart!({ runId: ids.runId, traceId: ids.traceId, workflowId: "demo", trigger: "in", principal: { kind: "anonymous" } });
  store.onRunReady!({ runId: ids.runId, traceId: ids.traceId, status: "ok", at: t0 + 2 });
  const span: SpanData = {
    traceId: ids.traceId,
    spanId: `${ids.runId}-gen`,
    name: "gen",
    startTime: t0,
    endTime: t0 + 500,
    attributes: { "pattern.node.id": "gen" },
    status: "ok",
    events: [
      { name: "started", time: t0, attributes: { blockedMs: 0 } },
      { name: "stream.chunk", time: t0 + 10, attributes: { port: "tok", seq: 0, preview: "he" } },
      { name: "stream.chunk", time: t0 + 20, attributes: { port: "tok", seq: 1, preview: "llo" } },
    ],
    io: { outputs: { tok: { kind: "stream", head: [], count: 2, truncated: true } } },
  };
  store.onSpanEnd!(span);
  store.onRunEnd!({ runId: ids.runId, traceId: ids.traceId, status: "ok", at: t0 + 500, endedBy: "drain" });
}

describe("trace store", () => {
  it("sqlite persists a run with spans, events, and I/O — at parity with memory", async () => {
    const mem = new MemoryTraceStore({ now: () => clock.t });
    const sql = await openSqliteTraceStore(":memory:", { now: () => clock.t });
    cleanup.push(() => void sql.close());

    for (const store of [mem, sql]) driveStreamingRun(store, { runId: "r1", traceId: "t1" });

    for (const store of [mem, sql]) {
      const list = await store.list();
      expect(list).toHaveLength(1);
      expect(list[0]!.workflowId).toBe("demo");
      expect(list[0]!.status).toBe("ok");
      expect(list[0]!.readyMs).toBe(2);
      expect(list[0]!.durationMs).toBe(500);
      expect(list[0]!.endedBy).toBe("drain");

      const detail = await store.get("r1");
      expect(detail).not.toBeNull();
      expect(detail!.spans).toHaveLength(1);
      const chunks = detail!.spans[0]!.events!.filter((e) => e.name === "stream.chunk");
      expect(chunks).toHaveLength(2); // events survive the round-trip → replay works
      expect(chunks[0]!.attributes?.preview).toBe("he");
      expect(detail!.spans[0]!.io?.outputs?.tok?.kind).toBe("stream"); // I/O sample survives
    }
  });

  it("survives a restart — reopen the same file and the run is still there", async () => {
    const path = join(tmp(), "traces.db");
    const first = await openSqliteTraceStore(path, { now: () => clock.t });
    driveStreamingRun(first, { runId: "persisted", traceId: "tp" });
    await first.close();

    const reopened = await openSqliteTraceStore(path);
    cleanup.push(() => void reopened.close());
    const detail = await reopened.get("persisted");
    expect(detail).not.toBeNull();
    expect(detail!.summary.durationMs).toBe(500);
    expect(detail!.spans[0]!.events!.some((e) => e.name === "stream.chunk")).toBe(true);
  });

  it("retains a bounded window — the oldest finished run is pruned + its spans", async () => {
    const sql = await openSqliteTraceStore(":memory:", { capacity: 2, now: () => clock.t });
    cleanup.push(() => void sql.close());
    driveStreamingRun(sql, { runId: "a", traceId: "ta" }, 1000);
    driveStreamingRun(sql, { runId: "b", traceId: "tb" }, 2000);
    driveStreamingRun(sql, { runId: "c", traceId: "tc" }, 3000);

    const list = await sql.list();
    expect(list.map((r) => r.runId).sort()).toEqual(["b", "c"]); // 'a' pruned
    expect(await sql.get("a")).toBeNull();
    const b = await sql.get("b");
    expect(b!.spans).toHaveLength(1); // surviving spans intact
  });

  it("createTraceStore: explicit memory + sqlite kinds", async () => {
    const mem = await createTraceStore({ kind: "memory" });
    expect(mem).toBeInstanceOf(MemoryTraceStore);
    const sql = await createTraceStore({ kind: "sqlite", path: ":memory:", now: () => clock.t });
    cleanup.push(() => void sql.close());
    driveStreamingRun(sql, { runId: "x", traceId: "tx" });
    expect((await sql.list())[0]!.runId).toBe("x");
  });

  it("records a CLI (boundary.cli) run into the store — the cross-process path", async () => {
    const { runCli } = await import("@pattern-js/runtime-node");
    const engine = new Engine();
    const store = await openSqliteTraceStore(":memory:");
    cleanup.push(() => void store.close());
    engine.onTrace(store);
    const wf: Workflow = {
      id: "cli-demo",
      nodes: [
        { id: "cli", op: "boundary.cli" },
        { id: "exit", op: "boundary.cli.exit" },
      ],
      edges: [{ from: { node: "cli", port: "args" }, to: { node: "exit", port: "stdout" } }],
    };
    engine.registerWorkflow(wf);
    const code = await runCli(engine, wf, { argv: ["hello", "world"], stdin: new ReadableStream() });
    expect(code).toBe(0);

    const runs = await store.list();
    expect(runs.some((r) => r.workflowId === "cli-demo" && r.status === "ok")).toBe(true);
  });
});
