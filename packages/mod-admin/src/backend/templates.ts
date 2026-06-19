/**
 * @pattern/mod-admin — built-in workflow templates (admin internals §15.6).
 *
 * "New from template" clones one of these JSON docs into the editor. Mods
 * contribute more via their frontend/ops; these are the starting set.
 */

import type { Workflow } from "@pattern/core";

export interface Template {
  id: string;
  name: string;
  description: string;
  doc: Workflow;
}

export const builtinTemplates: Template[] = [
  {
    id: "http-endpoint",
    name: "HTTP endpoint",
    description: "GET route that returns a templated greeting.",
    doc: {
      id: "new-endpoint",
      name: "New endpoint",
      nodes: [
        { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/hello/:name" }, ui: { x: 40, y: 80 } },
        { id: "msg", op: "core.string.template", config: { template: "Hello, {{ name }}!" }, ui: { x: 320, y: 80 } },
        { id: "out", op: "boundary.http.response", ui: { x: 600, y: 80 } },
      ],
      edges: [
        { from: { node: "in", port: "params" }, to: { node: "msg", port: "data" } },
        { from: { node: "msg", port: "out" }, to: { node: "out", port: "body" } },
      ],
    },
  },
  {
    id: "sse-stream",
    name: "SSE stream",
    description: "Server-Sent Events endpoint streaming values to the client.",
    doc: {
      id: "new-sse",
      name: "New SSE stream",
      nodes: [
        { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/stream" }, ui: { x: 40, y: 80 } },
        {
          id: "vals",
          op: "core.const.array",
          config: { value: ["hello", "from", "an", "SSE", "stream"] },
          comment: "Replace with your real producer (e.g. an agent's token stream).",
          ui: { x: 300, y: 80 },
        },
        { id: "emit", op: "core.stream.emit", ui: { x: 560, y: 80 } },
        { id: "out", op: "boundary.http.response", config: { mode: "sse" }, ui: { x: 820, y: 80 } },
      ],
      edges: [
        { from: { node: "vals", port: "out" }, to: { node: "emit", port: "in" } },
        { from: { node: "emit", port: "out" }, to: { node: "out", port: "stream" } },
      ],
    },
  },
  {
    id: "cron-job",
    name: "Scheduled job",
    description: "Runs on an interval and discards its result.",
    doc: {
      id: "new-cron",
      name: "New scheduled job",
      nodes: [
        { id: "tick", op: "boundary.schedule", config: { intervalMs: 60000 }, ui: { x: 40, y: 80 } },
        { id: "log", op: "core.flow.noop", title: "do work", ui: { x: 360, y: 80 } },
      ],
      edges: [{ from: { node: "tick", port: "out" }, to: { node: "log", port: "in" } }],
    },
  },
  {
    id: "event-listener",
    name: "Event listener",
    description: "Fire-and-forget subscriber to a named event.",
    doc: {
      id: "new-listener",
      name: "New event listener",
      nodes: [
        { id: "on", op: "boundary.event", config: { event: "something.happened" }, ui: { x: 40, y: 80 } },
        { id: "handle", op: "core.flow.noop", title: "handle", ui: { x: 360, y: 80 } },
      ],
      edges: [{ from: { node: "on", port: "out" }, to: { node: "handle", port: "in" } }],
    },
  },
];
