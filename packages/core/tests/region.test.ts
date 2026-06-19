import { describe, it, expect } from "vitest";
import { Engine, type Workflow } from "../src/index.js";
import { analyzeStreamRegions, buildRegionBody } from "../src/streams/region.js";

const ops = new Engine().ops;

/** each → get(delta.text) → upper → collect */
const simple: Workflow = {
  id: "r",
  nodes: [
    { id: "e", op: "core.stream.each" },
    { id: "get", op: "core.object.get", config: { path: "delta.text" } },
    { id: "up", op: "core.string.upper" },
    { id: "c", op: "core.stream.collect" },
  ],
  edges: [
    { from: { node: "e", port: "item" }, to: { node: "get", port: "object" } },
    { from: { node: "get", port: "out" }, to: { node: "up", port: "value" } },
    { from: { node: "up", port: "out" }, to: { node: "c", port: "value" } },
  ],
};

describe("stream region analysis", () => {
  it("identifies members, valueFrom, and no issues for a clean region", () => {
    const { regions, issues } = analyzeStreamRegions(simple, ops);
    expect(issues).toEqual([]);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.members.slice().sort()).toEqual(["get", "up"]);
    expect(regions[0]!.valueFrom).toEqual({ node: "up", port: "out" });
    expect(regions[0]!.captures).toEqual([]);
  });

  it("lowers to an inline body: trigger(item,index) → members(original ids) → return(value)", () => {
    const region = analyzeStreamRegions(simple, ops).regions[0]!;
    const body = buildRegionBody(simple, region);
    const ids = body.nodes.map((n) => n.id);
    expect(ids).toContain("get");
    expect(ids).toContain("up");
    expect(body.nodes.find((n) => n.op === "boundary.manual")!.config).toMatchObject({ outputs: ["item", "index"] });
    // item flows from the trigger into the first member; value flows to the return.
    expect(body.edges).toContainEqual({ from: { node: "__region_in", port: "item" }, to: { node: "get", port: "object" } });
    expect(body.edges).toContainEqual({ from: { node: "up", port: "out" }, to: { node: "__region_out", port: "value" } });
  });

  it("captures a value pulled in from outside the region (computed once)", () => {
    const wf: Workflow = {
      id: "cap",
      nodes: [
        { id: "k", op: "core.const.string", config: { value: "·" } },
        { id: "e", op: "core.stream.each" },
        { id: "tpl", op: "core.string.template", config: { template: "{{ a }}{{ b }}" } },
        { id: "c", op: "core.stream.collect" },
      ],
      edges: [
        { from: { node: "e", port: "item" }, to: { node: "tpl", port: "data" } },
        { from: { node: "k", port: "out" }, to: { node: "tpl", port: "sep" } }, // outside → member = capture
        { from: { node: "tpl", port: "out" }, to: { node: "c", port: "value" } },
      ],
    };
    const { regions, issues } = analyzeStreamRegions(wf, ops);
    expect(issues).toEqual([]);
    expect(regions[0]!.captures).toEqual([{ fromNode: "k", fromPort: "out", name: "cap0" }]);
    const body = buildRegionBody(wf, regions[0]!);
    // the capture is exposed by the body trigger and rewired into the member.
    expect(body.nodes.find((n) => n.op === "boundary.manual")!.config).toMatchObject({ outputs: ["item", "index", "cap0"] });
    expect(body.edges).toContainEqual({ from: { node: "__region_in", port: "cap0" }, to: { node: "tpl", port: "sep" } });
  });

  it("rejects a stream op inside the region, an unpaired each, and an escaping value", () => {
    const streamInside: Workflow = {
      id: "bad1",
      nodes: [
        { id: "e", op: "core.stream.each" },
        { id: "em", op: "core.stream.emit" }, // stream op — illegal member
        { id: "acc", op: "core.stream.accumulate", config: { mode: "array" } },
        { id: "c", op: "core.stream.collect" },
      ],
      edges: [
        { from: { node: "e", port: "item" }, to: { node: "em", port: "in" } },
        { from: { node: "em", port: "out" }, to: { node: "acc", port: "in" } },
        { from: { node: "acc", port: "out" }, to: { node: "c", port: "value" } },
      ],
    };
    expect(analyzeStreamRegions(streamInside, ops).issues.length).toBeGreaterThan(0);

    const unpaired: Workflow = { id: "bad2", nodes: [{ id: "e", op: "core.stream.each" }], edges: [] };
    expect(analyzeStreamRegions(unpaired, ops).issues[0]!.message).toMatch(/no matching core\.stream\.collect/);

    const escaping: Workflow = {
      id: "bad3",
      nodes: [
        { id: "e", op: "core.stream.each" },
        { id: "get", op: "core.object.get", config: { path: "x" } },
        { id: "out", op: "core.string.upper" }, // consumes a member output but sits OUTSIDE
        { id: "c", op: "core.stream.collect" },
      ],
      edges: [
        { from: { node: "e", port: "item" }, to: { node: "get", port: "object" } },
        { from: { node: "get", port: "out" }, to: { node: "c", port: "value" } },
        { from: { node: "get", port: "out" }, to: { node: "out", port: "value" } }, // escapes
      ],
    };
    expect(analyzeStreamRegions(escaping, ops).issues.some((i) => /escapes/.test(i.message))).toBe(true);
  });
});
