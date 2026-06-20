/**
 * http-api — an HTTP server built entirely from declarative workflows.
 *
 * Routes are NOT registered in code. Each `workflows/*.json` declares its own
 * route in the `boundary.http.request` op config (method, path, port, cors,
 * body/query schema). `loadProject` loads the mods + workflows; `start()` derives
 * the routes and opens a server per declared port.
 *
 * Ports: a route uses its op `config.port` if set, otherwise the default —
 * `PORT` env var, falling back to 3000. Here `/health` declares port 3001 while
 * the rest use the default, so `start()` opens two servers.
 *
 * Add a route by dropping a new `.json` in `workflows/` — with `npm run dev` the
 * server reloads and the route is live. (Workflows can equally come from a DB at
 * runtime via `engine.registerWorkflow` / `updateWorkflow` / `unregisterWorkflow`.)
 */
import { loadProject } from "@pattern-js/runtime-node";

const { start } = await loadProject();
const { ports } = await start();

console.log(`▶ listening on ${ports.map((p) => `http://localhost:${p}`).join(", ")}`);
console.log("  GET  /hello/:name       (default port)");
console.log("  POST /echo              (default port; JSON body: { message })");
console.log("  GET  /shout/:text       (default port; uses the app-local mod op)");
console.log("  GET  /health            (port 3001)");
