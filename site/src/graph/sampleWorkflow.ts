import type { MiniGraph } from "./types";

/**
 * The Level 1 workflow: GET /hello/:name. This single source of truth is used by
 * the scroll-morph (graph → JSON) and by the MiniEditor's Level 1 quest, so the
 * graph the visitor builds and the JSON they see are always the same thing.
 * Mirrors the real create-pattern `headless/workflows/hello.json`.
 */
export const level1Graph: MiniGraph = {
  nodes: [
    {
      id: "in",
      op: "boundary.http.request",
      title: "GET /hello/:name",
      boundary: "trigger",
      inputs: [],
      outputs: [
        { name: "params", kind: "value", schemaType: "object" },
        { name: "query", kind: "value", schemaType: "object" },
        { name: "body", kind: "value", schemaType: "object" },
      ],
      pos: { x: 0, y: 70 },
    },
    {
      id: "msg",
      op: "core.string.template",
      title: "Template",
      inputs: [{ name: "data", kind: "value", schemaType: "object", required: true }],
      outputs: [{ name: "out", kind: "value", schemaType: "string" }],
      pos: { x: 290, y: 0 },
    },
    {
      id: "body",
      op: "core.object.build",
      title: "Build object",
      inputs: [{ name: "message", kind: "value", schemaType: "string" }],
      outputs: [{ name: "out", kind: "value", schemaType: "object" }],
      pos: { x: 290, y: 175 },
    },
    {
      id: "out",
      op: "boundary.http.response",
      title: "Respond",
      boundary: "outgate",
      inputs: [{ name: "body", kind: "value", schemaType: "object" }],
      outputs: [],
      pos: { x: 580, y: 95 },
    },
  ],
  edges: [
    { id: "e1", from: { node: "in", port: "params" }, to: { node: "msg", port: "data" }, kind: "value" },
    { id: "e2", from: { node: "msg", port: "out" }, to: { node: "body", port: "message" }, kind: "value" },
    { id: "e3", from: { node: "body", port: "out" }, to: { node: "out", port: "body" }, kind: "value" },
  ],
};

/** The same workflow as the JSON document the engine loads. */
export const level1Doc = {
  $schema: "pattern/workflow/v1",
  id: "hello",
  name: "GET /hello/:name",
  nodes: [
    { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/hello/:name", cors: true } },
    { id: "msg", op: "core.string.template", config: { template: "Hello, {{ name }}!" } },
    { id: "body", op: "core.object.build", config: { keys: ["message"] } },
    { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
  ],
  edges: [
    { from: { node: "in", port: "params" }, to: { node: "msg", port: "data" } },
    { from: { node: "msg", port: "out" }, to: { node: "body", port: "message" } },
    { from: { node: "body", port: "out" }, to: { node: "out", port: "body" } },
  ],
};

/**
 * Level 2: a streaming agent. POST /ask runs an agent and streams its tokens
 * back. The `events` output is a STREAM (violet), which is the wow: tokens flow
 * along that wire live. Mirrors the create-pattern `agentic` template's shape.
 */
export const level2Graph: MiniGraph = {
  nodes: [
    {
      id: "in",
      op: "boundary.http.request",
      title: "POST /ask",
      boundary: "trigger",
      inputs: [],
      outputs: [{ name: "body", kind: "value", schemaType: "object" }],
      pos: { x: 0, y: 80 },
    },
    {
      id: "agent",
      op: "agents.agent",
      title: "Agent",
      configInputs: [],
      inputs: [],
      outputs: [{ name: "agent", kind: "value", schemaType: "object" }],
      pos: { x: 0, y: 250 },
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
      pos: { x: 300, y: 150 },
    },
    {
      id: "out",
      op: "boundary.http.response",
      title: "Stream response",
      boundary: "outgate",
      inputs: [{ name: "stream", kind: "stream", schemaType: "object" }],
      outputs: [],
      pos: { x: 600, y: 160 },
    },
  ],
  edges: [
    { id: "e1", from: { node: "in", port: "body" }, to: { node: "run", port: "input" }, kind: "value" },
    { id: "e2", from: { node: "agent", port: "agent" }, to: { node: "run", port: "agent" }, kind: "value" },
    { id: "e3", from: { node: "run", port: "events" }, to: { node: "out", port: "stream" }, kind: "stream" },
  ],
};

export const level2Doc = {
  $schema: "pattern/workflow/v1",
  id: "ask",
  name: "POST /ask — streaming agent",
  nodes: [
    { id: "in", op: "boundary.http.request", config: { method: "POST", path: "/ask" } },
    { id: "agent", op: "agents.agent", config: { name: "assistant", instructions: "You are concise and helpful.", model: "gpt-4.1-mini" } },
    { id: "run", op: "agents.run" },
    { id: "out", op: "boundary.http.response", config: { mode: "sse" } },
  ],
  edges: [
    { from: { node: "in", port: "body" }, to: { node: "run", port: "input" } },
    { from: { node: "agent", port: "agent" }, to: { node: "run", port: "agent" } },
    { from: { node: "run", port: "events" }, to: { node: "out", port: "stream" } },
  ],
};
