/**
 * http-api — an HTTP server built from workflows.
 *
 * Each route binds an inbound request to a `boundary.http.request` trigger and
 * writes the `boundary.http.response` out-gate. The runtime adapter
 * (`@pattern/runtime-node`) is the host; the engine + workflows are platform-neutral.
 */
import { Engine, type Workflow } from "@pattern/core";
import { createHttpHost } from "@pattern/runtime-node";

// GET /hello/:name  →  { message: "Hello, <name>!" }
const hello: Workflow = {
  id: "hello",
  nodes: [
    { id: "in", op: "boundary.http.request" },
    { id: "name", op: "core.object.get", config: { path: "name" } },
    { id: "msg", op: "core.string.template", config: { template: "Hello, {{ name }}!" } },
    { id: "body", op: "core.object.build", config: { keys: ["message"] } },
    { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
  ],
  edges: [
    { from: { node: "in", port: "params" }, to: { node: "name", port: "object" } },
    { from: { node: "in", port: "params" }, to: { node: "msg", port: "data" } },
    { from: { node: "msg", port: "out" }, to: { node: "body", port: "message" } },
    { from: { node: "body", port: "out" }, to: { node: "out", port: "body" } },
  ],
};

// POST /echo  →  echoes the JSON body back
const echo: Workflow = {
  id: "echo",
  nodes: [
    { id: "in", op: "boundary.http.request", config: { method: "POST" } },
    { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
  ],
  edges: [{ from: { node: "in", port: "body" }, to: { node: "out", port: "body" } }],
};

const engine = new Engine();
engine.registerWorkflow(hello);
engine.registerWorkflow(echo);

const host = createHttpHost(engine, {
  routes: [
    { method: "GET", path: "/hello/:name", workflow: "hello" },
    { method: "POST", path: "/echo", workflow: "echo" },
  ],
});

const { port } = await host.listen(Number(process.env.PORT ?? 3000));
console.log(`▶ http://localhost:${port}  (GET /hello/:name, POST /echo)`);
