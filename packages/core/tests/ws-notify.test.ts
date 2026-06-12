import { describe, expect, it } from "vitest";
import { Engine, InMemoryConnectionRegistry, type Workflow } from "../src/index.js";

/** core.ws.notify wraps broadcast in the documented envelope. */
describe("core.ws.notify", () => {
  it("pushes {kind:'notify', type, payload, ts} to the room", async () => {
    const connections = new InMemoryConnectionRegistry();
    connections.attach("c1");
    await connections.join("c1", "user:42");

    const engine = new Engine({ connections });
    const wf: Workflow = {
      id: "notify-demo",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["payload"] } },
        { id: "notify", op: "core.ws.notify", config: {} },
        { id: "room", op: "core.const.string", config: { value: "user:42" } },
        { id: "type", op: "core.const.string", config: { value: "chat.turn.updated" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "room", port: "out" }, to: { node: "notify", port: "room" } },
        { from: { node: "type", port: "out" }, to: { node: "notify", port: "type" } },
        { from: { node: "in", port: "payload" }, to: { node: "notify", port: "payload" } },
        { from: { node: "in", port: "payload" }, to: { node: "out", port: "value" } },
      ],
    };
    engine.registerWorkflow(wf);
    const res = await engine.run("notify-demo", { input: { payload: { conversationId: "c-9" } } });
    expect(res.status).toBe("ok");

    const box = connections.outbox.get("c1")!;
    expect(box).toHaveLength(1);
    expect(box[0]).toMatchObject({
      kind: "notify",
      type: "chat.turn.updated",
      payload: { conversationId: "c-9" },
    });
    expect(typeof (box[0] as { ts: number }).ts).toBe("number");
  });
});
