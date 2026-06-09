import { describe, it, expect } from "vitest";
import { Engine, resolvePorts, type Workflow } from "@pattern/core";

/**
 * Run a single op with the given config + value inputs, returning its outputs.
 * Builds a tiny manual→op→return.named workflow around it.
 */
async function callOp(opType: string, config: unknown, inputs: Record<string, unknown> = {}) {
  const engine = new Engine();
  const op = engine.ops.get(opType);
  if (!op) throw new Error(`no op ${opType}`);
  const outPorts = Object.keys(resolvePorts(op.outputs, config));
  const inKeys = Object.keys(inputs);
  const wf: Workflow = {
    id: `t-${opType}`,
    nodes: [
      { id: "t", op: "boundary.manual", config: { outputs: inKeys.length ? inKeys : ["_"] } },
      { id: "op", op: opType, config: config as any },
      { id: "out", op: "boundary.return.named", config: { inputs: outPorts.length ? outPorts : ["_"] } },
    ],
    edges: [
      ...inKeys.map((k) => ({ from: { node: "t", port: k }, to: { node: "op", port: k } })),
      ...outPorts.map((pp) => ({ from: { node: "op", port: pp }, to: { node: "out", port: pp } })),
      ...(inKeys.length === 0 ? [{ from: { node: "t", port: "out" }, to: { node: "op", port: "in" } }] : []),
    ],
  };
  engine.registerWorkflow(wf);
  const res = await engine.run(wf, { input: inputs });
  if (res.status === "error") throw res.error;
  return Object.values(res.outputs)[0] as Record<string, unknown>;
}

describe("op catalog (§12)", () => {
  it("strings", async () => {
    expect((await callOp("core.string.upper", {}, { value: "hi" })).out).toBe("HI");
    expect((await callOp("core.string.split", { separator: "," }, { value: "a,b,c" })).out).toEqual(["a", "b", "c"]);
    expect((await callOp("core.string.template", { template: "Hi {{ who }}" }, { data: { who: "x" } })).out).toBe("Hi x");
    expect((await callOp("core.string.replace", { search: "a", replacement: "z" }, { value: "banana" })).out).toBe("bznznz");
  });

  it("objects", async () => {
    expect((await callOp("core.object.get", { path: "a.b" }, { object: { a: { b: 7 } } })).out).toBe(7);
    expect((await callOp("core.object.set", { path: "a.b" }, { object: {}, value: 9 })).out).toEqual({ a: { b: 9 } });
    expect((await callOp("core.object.merge", {}, { a: { x: 1 }, b: { y: 2 } })).out).toEqual({ x: 1, y: 2 });
    expect((await callOp("core.object.keys", {}, { object: { a: 1, b: 2 } })).out).toEqual(["a", "b"]);
  });

  it("arrays + higher-order", async () => {
    expect((await callOp("core.array.unique", {}, { values: [1, 1, 2, 3, 3] })).out).toEqual([1, 2, 3]);
    expect((await callOp("core.array.chunk", { size: 2 }, { values: [1, 2, 3, 4, 5] })).out).toEqual([[1, 2], [3, 4], [5]]);
    expect((await callOp("core.array.groupBy", { path: "k" }, { values: [{ k: "a" }, { k: "b" }, { k: "a" }] })).out).toEqual({
      a: [{ k: "a" }, { k: "a" }],
      b: [{ k: "b" }],
    });
    expect((await callOp("core.array.range", { end: 4 }, {})).out).toEqual([0, 1, 2, 3]);
  });

  it("data & encoding", async () => {
    expect((await callOp("core.json.parse", {}, { text: '{"a":1}' })).out).toEqual({ a: 1 });
    expect((await callOp("core.json.stringify", {}, { value: { a: 1 } })).out).toBe('{"a":1}');
    const b64 = (await callOp("core.encode.base64", {}, { value: "héllo" })).out as string;
    expect((await callOp("core.decode.base64", {}, { value: b64 })).out).toBe("héllo");
    expect((await callOp("core.query.parse", {}, { query: "?a=1&b=2" })).out).toEqual({ a: "1", b: "2" });
  });

  it("crypto / hash (deterministic for fixed input)", async () => {
    const h = (await callOp("core.hash", { algorithm: "SHA-256", encoding: "hex" }, { value: "abc" })).out;
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("control: switch selects a case", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "switch",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["v"] } },
        { id: "sw", op: "core.flow.switch", config: { cases: ["red", "green"] } },
        { id: "r", op: "core.const.string", config: { value: "is-red" } },
        { id: "g", op: "core.const.string", config: { value: "is-green" } },
        { id: "d", op: "core.const.string", config: { value: "other" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "v" }, to: { node: "sw", port: "value" } },
        { from: { node: "sw", port: "case.0" }, to: { node: "r", port: "in" } },
        { from: { node: "sw", port: "case.1" }, to: { node: "g", port: "in" } },
        { from: { node: "sw", port: "default" }, to: { node: "d", port: "in" } },
        { from: { node: "r", port: "out" }, to: { node: "out", port: "value" } },
        { from: { node: "g", port: "out" }, to: { node: "out", port: "value" } },
        { from: { node: "d", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    engine.registerWorkflow(wf);
    expect(Object.values((await engine.run(wf, { input: { v: "green" } })).outputs)[0]).toEqual({ value: "is-green" });
    expect(Object.values((await engine.run(wf, { input: { v: "blue" } })).outputs)[0]).toEqual({ value: "other" });
  });

  it("determinism: identical inputs → identical outputs", async () => {
    const a = await callOp("core.string.template", { template: "{{ x }}-{{ x }}" }, { data: { x: 5 } });
    const b = await callOp("core.string.template", { template: "{{ x }}-{{ x }}" }, { data: { x: 5 } });
    expect(a).toEqual(b);
    expect(a.out).toBe("5-5");
  });
});
