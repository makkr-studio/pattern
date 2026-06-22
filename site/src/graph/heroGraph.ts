import type { MiniGraph } from "./types";

/**
 * The ambient graph behind the hero: a small "agent app" workflow with all three
 * edge kinds on show (value cyan, stream violet). It is rendered as a static
 * layer with a travelling neon pulse, never interactive.
 */
export const heroGraph: MiniGraph = {
  nodes: [
    {
      id: "in",
      op: "boundary.http.request",
      title: "HTTP request",
      boundary: "trigger",
      inputs: [],
      outputs: [
        { name: "params", kind: "value", schemaType: "object" },
        { name: "body", kind: "value", schemaType: "object" },
      ],
      pos: { x: 0, y: 80 },
    },
    {
      id: "tmpl",
      op: "core.string.template",
      title: "Template",
      inputs: [{ name: "data", kind: "value", schemaType: "object", required: true }],
      outputs: [{ name: "out", kind: "value", schemaType: "string" }],
      pos: { x: 250, y: 10 },
    },
    {
      id: "agent",
      op: "agents.agent",
      title: "Agent",
      inputs: [{ name: "tools", kind: "value", schemaType: "object" }],
      outputs: [{ name: "agent", kind: "value", schemaType: "object" }],
      pos: { x: 250, y: 190 },
    },
    {
      id: "run",
      op: "agents.run",
      title: "Run agent",
      inputs: [
        { name: "agent", kind: "value", schemaType: "object", required: true },
        { name: "input", kind: "value", schemaType: "string", required: true },
      ],
      outputs: [
        { name: "events", kind: "stream", schemaType: "object" },
        { name: "output", kind: "value", schemaType: "string" },
      ],
      pos: { x: 510, y: 110 },
    },
    {
      id: "out",
      op: "boundary.http.response",
      title: "HTTP response",
      boundary: "outgate",
      inputs: [
        { name: "body", kind: "value", schemaType: "object" },
        { name: "stream", kind: "stream", schemaType: "object" },
      ],
      outputs: [],
      pos: { x: 780, y: 120 },
    },
  ],
  edges: [
    { id: "e1", from: { node: "in", port: "params" }, to: { node: "tmpl", port: "data" }, kind: "value" },
    { id: "e2", from: { node: "tmpl", port: "out" }, to: { node: "run", port: "input" }, kind: "value" },
    { id: "e3", from: { node: "agent", port: "agent" }, to: { node: "run", port: "agent" }, kind: "value" },
    { id: "e4", from: { node: "run", port: "events" }, to: { node: "out", port: "stream" }, kind: "stream" },
    { id: "e5", from: { node: "run", port: "output" }, to: { node: "out", port: "body" }, kind: "value" },
  ],
};
