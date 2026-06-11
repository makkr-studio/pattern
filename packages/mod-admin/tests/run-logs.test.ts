import { describe, it, expect } from "vitest";
import { Engine, type Workflow } from "@pattern/core";
import { MemoryTraceSink } from "../src/index.js";

/** The data path the Runs page's Logs panel reads: ctx.log → span events → sink. */
describe("run logs reach the trace sink", () => {
  it("core.log emits log.<level> span events retained with the run", async () => {
    const engine = new Engine();
    const sink = new MemoryTraceSink();
    engine.onTrace(sink);

    const wf: Workflow = {
      id: "logs-demo",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["value"] } },
        { id: "log", op: "core.log", config: { level: "warn", message: "checkpoint reached" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "value" }, to: { node: "log", port: "value" } },
        { from: { node: "log", port: "value" }, to: { node: "out", port: "value" } },
      ],
    };
    engine.registerWorkflow(wf);
    const res = await engine.run("logs-demo", { input: { value: 42 } });
    expect(res.status).toBe("ok");

    const run = sink.list()[0]!;
    const detail = sink.get(run.runId)!;
    const events = detail.spans.flatMap((s) => s.events.filter((e) => e.name.startsWith("log.")));
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe("log.warn");
    expect(events[0]!.attributes?.message).toBe("checkpoint reached");
    // The principal rides the summary — what the user-details run stats read.
    expect(run.principal).toEqual({ kind: "anonymous" });
  });
});
