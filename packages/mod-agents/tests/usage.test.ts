import { describe, expect, it } from "vitest";
import { Engine, type Workflow } from "@pattern-js/core";
import { agentsMod, AI_MODEL_SERVICE, type TurnEvent } from "../src/index.js";
import { scriptedModelService, type ScriptedTurn } from "./scripted-model-service.js";

/**
 * Token accounting through the agent loop (0.5): every model step's finish
 * chunk feeds the turn total, which rides agents.run's `usage` output and the
 * terminal `done` event. Providers that report nothing keep both absent.
 */

const echoTool: Workflow = {
  id: "tool-echo",
  nodes: [
    {
      id: "in",
      op: "boundary.tool",
      config: { name: "echo", description: "Echo", params: { type: "object", properties: {} } },
    },
    { id: "tpl", op: "core.string.template", config: { template: "echoed" } },
    { id: "out", op: "boundary.tool.return" },
  ],
  edges: [
    { from: { node: "in", port: "args" }, to: { node: "tpl", port: "data" } },
    { from: { node: "tpl", port: "out" }, to: { node: "out", port: "result" } },
  ],
};

function runnerWorkflow(tools = false): Workflow {
  return {
    id: "agent-run",
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: ["input"] } },
      ...(tools ? [{ id: "tools", op: "agents.tools.workflows", config: {} }] : []),
      { id: "agent", op: "agents.agent", config: { name: "assistant", instructions: "Be helpful." } },
      { id: "run", op: "agents.run" },
      { id: "collect", op: "core.stream.accumulate", config: { mode: "array" } },
      { id: "out", op: "boundary.return.named", config: { inputs: ["events", "output", "usage"] } },
    ],
    edges: [
      ...(tools
        ? [
            { from: { node: "in", port: "out" }, to: { node: "tools", port: "in" } },
            { from: { node: "tools", port: "toolset" }, to: { node: "agent", port: "tools" } },
          ]
        : [{ from: { node: "in", port: "out" }, to: { node: "agent", port: "in" } }]),
      { from: { node: "agent", port: "agent" }, to: { node: "run", port: "agent" } },
      { from: { node: "in", port: "input" }, to: { node: "run", port: "input" } },
      { from: { node: "run", port: "events" }, to: { node: "collect", port: "in" } },
      { from: { node: "collect", port: "out" }, to: { node: "out", port: "events" } },
      { from: { node: "run", port: "output" }, to: { node: "out", port: "output" } },
      { from: { node: "run", port: "usage" }, to: { node: "out", port: "usage" } },
    ],
  };
}

async function boot(turns: ScriptedTurn[]) {
  const engine = new Engine();
  await engine.useAsync(agentsMod());
  engine.provideService(AI_MODEL_SERVICE, scriptedModelService(turns));
  return engine;
}

const merged = (res: { outputs: Record<string, Record<string, unknown>> }) =>
  Object.assign({}, ...Object.values(res.outputs)) as {
    events: TurnEvent[];
    output: unknown;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  };

describe("agent turn usage accounting", () => {
  it("sums every model step and reports the total on the output and the done event", async () => {
    const engine = await boot([
      { kind: "tool_call", name: "echo", callId: "c1", args: {}, usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } },
      { kind: "text", text: "All done.", usage: { inputTokens: 140, outputTokens: 6, totalTokens: 146 } },
    ]);
    engine.registerWorkflow(echoTool);
    engine.registerWorkflow(runnerWorkflow(true));
    const res = await engine.run("agent-run", { input: { input: "go" } });
    expect(res.status).toBe("ok");
    const out = merged(res as never);
    expect(out.usage).toEqual({ inputTokens: 240, outputTokens: 16, totalTokens: 256 });
    const done = out.events.at(-1) as TurnEvent & { usage?: unknown };
    expect(done).toMatchObject({ type: "done", stopReason: "complete" });
    expect(done.usage).toEqual({ inputTokens: 240, outputTokens: 16, totalTokens: 256 });
  });

  it("tolerates partial reports and stays absent when nothing was reported", async () => {
    const engine = await boot([{ kind: "text", text: "quiet model" }]);
    engine.registerWorkflow(runnerWorkflow());
    const res = await engine.run("agent-run", { input: { input: "hi" } });
    const out = merged(res as never);
    expect(out.usage).toBeUndefined();
    const done = out.events.at(-1) as TurnEvent & { usage?: unknown };
    expect(done.usage).toBeUndefined();

    const engine2 = await boot([{ kind: "text", text: "partial", usage: { outputTokens: 7 } }]);
    engine2.registerWorkflow(runnerWorkflow());
    const res2 = await engine2.run("agent-run", { input: { input: "hi" } });
    const out2 = merged(res2 as never);
    expect(out2.usage).toEqual({ outputTokens: 7 });
  });
});
