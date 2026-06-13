import { describe, expect, it } from "vitest";
import { buildFlow, FRAME_TYPE, makeFrameNode, tidyLayout, toDoc } from "../src/app/editor/graph";
import type { WorkflowDoc } from "@pattern/admin-sdk";

/**
 * Frames are PURE ANNOTATION: they round-trip through the canvas untouched,
 * never enter doc.nodes, and auto-tidy refuses to move them.
 */
describe("editor frames", () => {
  const doc: WorkflowDoc = {
    id: "framed",
    nodes: [
      { id: "a", op: "core.flow.noop", ui: { x: 100, y: 100 } },
      { id: "b", op: "core.flow.noop", ui: { x: 400, y: 100 } },
    ],
    edges: [],
    frames: [{ id: "f1", label: "Setup", comment: "the boring part", x: 60, y: 40, w: 480, h: 240, hue: 190 }],
  };

  it("round-trips frames through buildFlow → toDoc", () => {
    const flow = buildFlow(doc, new Map());
    const frameNode = flow.nodes.find((n) => n.type === FRAME_TYPE)!;
    expect(frameNode).toBeTruthy();
    expect(frameNode.zIndex).toBe(-10);
    expect(frameNode.data.frame).toMatchObject({ label: "Setup", comment: "the boring part", hue: 190 });

    const back = toDoc(doc, flow.nodes, flow.edges);
    expect(back.frames).toEqual(doc.frames);
    expect(back.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]); // frames never leak into nodes
  });

  it("omits frames entirely when the canvas has none", () => {
    const flow = buildFlow({ ...doc, frames: undefined }, new Map());
    const back = toDoc(doc, flow.nodes, flow.edges);
    expect(back.frames).toBeUndefined();
  });

  it("tidy never moves frames", () => {
    const flow = buildFlow(doc, new Map());
    const layout = tidyLayout(flow.nodes, flow.edges);
    expect(layout.has("frame:f1")).toBe(false);
    expect(layout.has("a")).toBe(true);
  });

  it("makeFrameNode mints a selected, low-z frame at the given rect", () => {
    const n = makeFrameNode({ x: 10, y: 20, w: 300, h: 200 }, "New");
    expect(n.type).toBe(FRAME_TYPE);
    expect(n.id.startsWith("frame:")).toBe(true);
    expect(n.selected).toBe(true);
    expect(n.width).toBe(300);
  });
});
