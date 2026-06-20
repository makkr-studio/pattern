/**
 * hello-workflow — the smallest Pattern program.
 *
 * Workflows are *data*: they live as JSON in `workflows/`, declared in
 * `pattern.config.json`. `loadProject` reads them, installs any mods, and hands
 * back a ready `engine`. Here we run the `greeting` workflow once.
 *
 * Edit `workflows/greeting.json` (no rebuild needed with `npm run dev`) — change
 * the template, or wire in more ops (`core.string.*`, `core.math.*`, `core.flow.*`).
 */
import { loadProject } from "@pattern-js/runtime-node";

const { engine } = await loadProject();

const result = await engine.run("greeting", { input: { name: { name: "world" } } });
console.log(result.outputs); // { out: { value: "Hello, world! 👋" } }
