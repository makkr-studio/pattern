import { describe, expect, it } from "vitest";
import { Engine, type TraceSink, type Workflow } from "@pattern-js/core";
import { agentsMod, type TurnEvent } from "@pattern-js/mod-agents";
import { agentsOpenAIMod } from "../src/mod.js";
import { MODEL_PROVIDER_SERVICE } from "../src/well-known.js";
import { scriptedProvider, type ScriptedTurn } from "./scripted-model.js";

/**
 * The full SDK loop against a scripted model — no API key, no network.
 * Covers: streamed text, workflow tools as linked sub-runs, guardrail trips
 * as turn content, HITL interruption → resume, history threading.
 */

const weatherTool: Workflow = {
  id: "tool-weather",
  nodes: [
    {
      id: "in",
      op: "boundary.tool",
      config: {
        name: "get_weather",
        description: "Current weather for a city",
        params: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    },
    { id: "tpl", op: "core.string.template", config: { template: "sunny in {{city}}" } },
    { id: "out", op: "boundary.tool.return" },
  ],
  edges: [
    { from: { node: "in", port: "args" }, to: { node: "tpl", port: "data" } },
    { from: { node: "tpl", port: "out" }, to: { node: "out", port: "result" } },
  ],
};

/** Trigger → agent → run → events accumulated + outputs returned. */
function runnerWorkflow(opts: { tools?: boolean; maxTurns?: number } = {}): Workflow {
  return {
    id: "agent-run",
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: ["input", "history"] } },
      ...(opts.tools ? [{ id: "tools", op: "agents.tools.workflows", config: {} }] : []),
      {
        id: "agent",
        op: "agents.agent",
        config: { name: "assistant", instructions: "Be helpful." },
      },
      { id: "run", op: "agents.run", config: opts.maxTurns ? { maxTurns: opts.maxTurns } : {} },
      { id: "collect", op: "core.stream.accumulate", config: { mode: "array" } },
      {
        id: "out",
        op: "boundary.return.named",
        config: { inputs: ["events", "output", "history", "stopReason", "stateToken"] },
      },
    ],
    edges: [
      ...(opts.tools
        ? [
            { from: { node: "in", port: "out" }, to: { node: "tools", port: "in" } },
            { from: { node: "tools", port: "toolset" }, to: { node: "agent", port: "tools" } },
          ]
        : [{ from: { node: "in", port: "out" }, to: { node: "agent", port: "in" } }]),
      { from: { node: "agent", port: "agent" }, to: { node: "run", port: "agent" } },
      { from: { node: "in", port: "input" }, to: { node: "run", port: "input" } },
      { from: { node: "in", port: "history" }, to: { node: "run", port: "history" } },
      { from: { node: "run", port: "events" }, to: { node: "collect", port: "in" } },
      { from: { node: "collect", port: "out" }, to: { node: "out", port: "events" } },
      { from: { node: "run", port: "output" }, to: { node: "out", port: "output" } },
      { from: { node: "run", port: "history" }, to: { node: "out", port: "history" } },
      { from: { node: "run", port: "stopReason" }, to: { node: "out", port: "stopReason" } },
      { from: { node: "run", port: "stateToken" }, to: { node: "out", port: "stateToken" } },
    ],
  };
}

async function boot(turns: ScriptedTurn[]) {
  const engine = new Engine();
  await engine.useAsync(agentsMod());
  await engine.useAsync(agentsOpenAIMod());
  const provider = scriptedProvider(turns);
  engine.provideService(MODEL_PROVIDER_SERVICE, provider);
  return { engine, provider };
}

const merged = (res: { outputs: Record<string, Record<string, unknown>> }) =>
  Object.assign({}, ...Object.values(res.outputs)) as {
    events: TurnEvent[];
    output: unknown;
    history: unknown[];
    stopReason: string;
    stateToken: string | null;
  };

describe("agents.run against a scripted model", () => {
  it("streams text deltas and settles output/history/done", async () => {
    const { engine } = await boot([{ kind: "text", text: "Hello Benoit!", deltas: ["Hello ", "Benoit!"] }]);
    engine.registerWorkflow(runnerWorkflow());
    const res = await engine.run("agent-run", { input: { input: "hi" } });
    expect(res.status).toBe("ok");
    const out = merged(res as never);
    expect(out.output).toBe("Hello Benoit!");
    expect(out.stopReason).toBe("complete");
    expect(out.events.map((e) => e.type)).toEqual(["text.delta", "text.delta", "text.done", "done"]);
    expect(out.events.at(-1)).toMatchObject({ type: "done", stopReason: "complete" });
    // History: original user input + the assistant message.
    expect(out.history.length).toBeGreaterThanOrEqual(2);
  });

  it("executes workflow tools as LINKED SUB-RUNS and reports tool.activity", async () => {
    const { engine } = await boot([
      { kind: "tool_call", name: "get_weather", callId: "call_1", args: { city: "Paris" } },
      { kind: "text", text: "It is sunny in Paris." },
    ]);
    engine.registerWorkflow(weatherTool);
    engine.registerWorkflow(runnerWorkflow({ tools: true }));

    const starts: Array<{ workflowId: string; parent?: { workflowId: string } }> = [];
    const sink: TraceSink = { onRunStart: (r) => starts.push(r as never) };
    engine.onTrace(sink);

    const res = await engine.run("agent-run", { input: { input: "weather in paris?" } });
    expect(res.status).toBe("ok");
    const out = merged(res as never);
    expect(out.output).toBe("It is sunny in Paris.");

    const toolEvents = out.events.filter((e) => e.type === "tool.activity");
    expect(toolEvents).toMatchObject([
      { phase: "start", toolName: "get_weather", args: { city: "Paris" } },
      { phase: "done", toolName: "get_weather", result: "sunny in Paris" },
    ]);

    // The tool ran as a child run of the agent workflow (round-11 linkage).
    const toolRun = starts.find((s) => s.workflowId === "tool-weather");
    expect(toolRun?.parent?.workflowId).toBe("agent-run");
  });

  it("turns a guardrail trip into turn CONTENT (error event + soft outputs)", async () => {
    const { engine } = await boot([{ kind: "text", text: "should never stream" }]);
    // Guardrail tool: trips on any input.
    engine.registerWorkflow({
      id: "guardrail-block",
      nodes: [
        { id: "in", op: "boundary.tool", config: { name: "block_everything" } },
        { id: "obj", op: "core.const.object", config: { value: { tripwire: true, info: "blocked" } } },
        { id: "out", op: "boundary.tool.return" },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "obj", port: "in" } },
        { from: { node: "obj", port: "out" }, to: { node: "out", port: "result" } },
      ],
    });
    engine.registerWorkflow({
      id: "guarded-run",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["input"] } },
        { id: "g", op: "agents.guardrail", config: { tool: "block_everything", direction: "input" } },
        { id: "agent", op: "agents.agent", config: { name: "a", instructions: "x" } },
        { id: "run", op: "agents.run" },
        { id: "collect", op: "core.stream.accumulate", config: { mode: "array" } },
        { id: "out", op: "boundary.return.named", config: { inputs: ["events", "stopReason"] } },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "g", port: "in" } },
        { from: { node: "g", port: "guardrail" }, to: { node: "agent", port: "guardrails" } },
        { from: { node: "agent", port: "agent" }, to: { node: "run", port: "agent" } },
        { from: { node: "in", port: "input" }, to: { node: "run", port: "input" } },
        { from: { node: "run", port: "events" }, to: { node: "collect", port: "in" } },
        { from: { node: "collect", port: "out" }, to: { node: "out", port: "events" } },
        { from: { node: "run", port: "stopReason" }, to: { node: "out", port: "stopReason" } },
      ],
    });

    const res = await engine.run("guarded-run", { input: { input: "anything" } });
    expect(res.status).toBe("ok"); // errors are turn content, not run failures
    const out = merged(res as never);
    expect(out.stopReason).toBe("error");
    const types = (out.events as TurnEvent[]).map((e) => e.type);
    expect(types).toContain("error");
    expect(types.at(-1)).toBe("done");
    const err = (out.events as TurnEvent[]).find((e) => e.type === "error") as { code?: string };
    expect(err.code).toBe("guardrail.input");
  });

  it("HITL: needsApproval interrupts with a stateToken, resume completes", async () => {
    const { engine } = await boot([
      { kind: "tool_call", name: "get_weather", callId: "call_appr", args: { city: "Nice" } },
      { kind: "text", text: "Approved: sunny in Nice." },
    ]);
    // Approval-gated variant of the weather tool.
    engine.registerWorkflow({
      ...weatherTool,
      id: "tool-weather-gated",
      nodes: weatherTool.nodes.map((n) =>
        n.id === "in" ? { ...n, config: { ...(n.config as object), needsApproval: true } } : n,
      ),
    });
    engine.registerWorkflow(runnerWorkflow({ tools: true }));

    const first = await engine.run("agent-run", { input: { input: "weather in nice?" } });
    expect(first.status).toBe("ok");
    const out1 = merged(first as never);
    expect(out1.stopReason).toBe("interrupted");
    const approval = (out1.events as TurnEvent[]).find((e) => e.type === "approval.request") as Extract<
      TurnEvent,
      { type: "approval.request" }
    >;
    expect(approval).toBeDefined();
    expect(approval.interruption.toolName).toBe("get_weather");
    expect(out1.stateToken).toBeTruthy();

    // Resume with the approval — the SAME descriptor reifies the same agent.
    engine.registerWorkflow({
      id: "agent-resume",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["stateToken", "decisions"] } },
        { id: "tools", op: "agents.tools.workflows", config: {} },
        { id: "agent", op: "agents.agent", config: { name: "assistant", instructions: "Be helpful." } },
        { id: "resume", op: "agents.run.resume" },
        { id: "collect", op: "core.stream.accumulate", config: { mode: "array" } },
        { id: "out", op: "boundary.return.named", config: { inputs: ["events", "output", "stopReason"] } },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "tools", port: "in" } },
        { from: { node: "tools", port: "toolset" }, to: { node: "agent", port: "tools" } },
        { from: { node: "agent", port: "agent" }, to: { node: "resume", port: "agent" } },
        { from: { node: "in", port: "stateToken" }, to: { node: "resume", port: "stateToken" } },
        { from: { node: "in", port: "decisions" }, to: { node: "resume", port: "decisions" } },
        { from: { node: "resume", port: "events" }, to: { node: "collect", port: "in" } },
        { from: { node: "collect", port: "out" }, to: { node: "out", port: "events" } },
        { from: { node: "resume", port: "output" }, to: { node: "out", port: "output" } },
        { from: { node: "resume", port: "stopReason" }, to: { node: "out", port: "stopReason" } },
      ],
    });
    const second = await engine.run("agent-resume", {
      input: {
        stateToken: out1.stateToken,
        decisions: [{ id: approval.interruption.id, approved: true }],
      },
    });
    expect(second.status).toBe("ok");
    const out2 = merged(second as never);
    expect(out2.stopReason).toBe("complete");
    expect(out2.output).toBe("Approved: sunny in Nice.");
    // The gated tool actually executed after approval.
    const toolDone = (out2.events as TurnEvent[]).find(
      (e) => e.type === "tool.activity" && (e as { phase: string }).phase === "done",
    );
    expect(toolDone).toMatchObject({ result: "sunny in Nice" });
  });

  it("threads history into the next model call", async () => {
    const { engine, provider } = await boot([{ kind: "text", text: "second answer" }]);
    engine.registerWorkflow(runnerWorkflow());
    const history = [
      { role: "user", content: "first question" },
      { role: "assistant", status: "completed", content: [{ type: "output_text", text: "first answer" }] },
    ];
    const res = await engine.run("agent-run", { input: { input: "second question", history } });
    expect(res.status).toBe("ok");
    const request = provider.model.requests[0]!;
    const items = request.input as Array<{ role?: string }>;
    expect(items.length).toBe(3); // two history items + the new user turn
    const out = merged(res as never);
    expect(out.history.length).toBeGreaterThanOrEqual(4);
  });

  it("model failure mid-turn = error event + done(error), run still ok", async () => {
    const { engine } = await boot([{ kind: "throw", message: "rate limited" }]);
    engine.registerWorkflow(runnerWorkflow());
    const res = await engine.run("agent-run", { input: { input: "hi" } });
    expect(res.status).toBe("ok");
    const out = merged(res as never);
    expect(out.stopReason).toBe("error");
    expect((out.events as TurnEvent[]).map((e) => e.type)).toEqual(["error", "done"]);
    expect((out.events[0] as { message: string }).message).toContain("rate limited");
  });

  it("fails LOUDLY pre-flight when no API key and no provider override", async () => {
    const engine = new Engine();
    await engine.useAsync(agentsMod());
    await engine.useAsync(agentsOpenAIMod());
    engine.registerWorkflow(runnerWorkflow());
    const res = await engine.run("agent-run", { input: { input: "hi" } });
    expect(res.status).toBe("error");
    expect(String(res.error)).toContain("OPENAI_API_KEY");
  });
});
