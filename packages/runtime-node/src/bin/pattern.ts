#!/usr/bin/env node
/**
 * `pattern` — the dev CLI (§15).
 *
 *   pattern ops [query]         List/inspect every op the project can use.
 *   pattern graph <file.json>   Validate a workflow and print its graph.
 *   pattern validate <file>     Validate a workflow document; report issues.
 *   pattern dev [entry]         Run an entry with file-watch hot-reload.
 *
 * `ops`/`graph`/`validate` are **project-aware**: when a `pattern.config.json`
 * is present in the cwd its mods are loaded first, so app-local and npm mod ops
 * (`app.*`, `admin.*`, …) resolve exactly as they will at runtime. This is the
 * terminal ground truth — coding agents are told to consult it instead of
 * guessing op names (see the scaffolded AGENTS.md).
 *
 * `dev` shells out to `node --watch` (Node ≥20 runs .ts via type-stripping on
 * recent versions).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  Engine,
  formatGraph,
  collectIssues,
  resolvePorts,
  resolveControlOuts,
  z,
  type OpDefinition,
  type PortSpec,
  type Workflow,
} from "@pattern-js/core";
import { loadMods } from "../mods.js";
import { loadWorkflowDir, loadDotEnv } from "../project.js";
import { runCli } from "../cli.js";
import { createTraceStore } from "../trace/index.js";

const pc = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "ops":
      return cmdOps(rest[0]);
    case "graph":
      return cmdGraph(rest[0]);
    case "validate":
      return cmdValidate(rest[0]);
    case "run":
      return cmdRun(rest);
    case "mcp":
      return cmdMcp();
    case "dev":
      return cmdDev(rest[0]);
    case "load":
      return cmdLoad(rest);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return usage();
    default:
      console.error(pc.red(`unknown command "${cmd}"`));
      usage();
      process.exit(1);
  }
}

function usage(): void {
  console.log(`${pc.bold("pattern")} — workflow dev CLI

  ${pc.cyan("pattern ops")}                   list every available op (project mods included)
  ${pc.cyan("pattern ops")} <query>           filter by prefix, or full detail on an exact type
  ${pc.cyan("pattern graph")} <file.json>     print a workflow's graph
  ${pc.cyan("pattern validate")} <file.json>  validate a workflow document
  ${pc.cyan("pattern run")} <file.json|id> [-- args]  run a boundary.cli workflow once by file or id (records to the trace store)
  ${pc.cyan("pattern mcp")}                   serve this project's tool workflows to a local MCP client over stdio
  ${pc.cyan("pattern dev")} [entry]           run an entry with --watch hot-reload
  ${pc.cyan("pattern load")} <scenario.json>  open-loop load test with engine flight-recording
                              ${pc.dim("--sweep  find max sustainable rps   --url <u>  target a running server")}
                              ${pc.dim("--out <file>  write the JSON report   --p99 <ms>  sweep knee budget")}
`);
}

/**
 * Build an engine the way the project will at runtime: the project's `.env`
 * loaded (so mod setup — the vault reading PATTERN_VAULT_KEY, mod-ai resolving
 * provider keys like OPENAI_API_KEY — and `$env` config see it, just like `loadProject`), then core
 * ops + every mod declared in `pattern.config.json` (when present). Workflows are
 * *not* registered and no server starts — this is introspection (+ `pattern run`).
 */
async function projectEngine(): Promise<Engine> {
  loadDotEnv(process.cwd());
  const engine = new Engine({ env: process.env });
  if (existsSync("pattern.config.json")) {
    try {
      const config = JSON.parse(readFileSync("pattern.config.json", "utf8")) as { mods?: string[] };
      if (config.mods?.length) await loadMods(engine, config.mods, { baseDir: process.cwd() });
    } catch (err) {
      console.error(pc.yellow(`! could not load project mods: ${(err as Error).message}`));
    }
  }
  return engine;
}

function loadWorkflow(file: string | undefined): unknown {
  if (!file) {
    console.error(pc.red("expected a workflow file path"));
    process.exit(1);
  }
  if (!existsSync(file)) {
    console.error(pc.red(`file not found: ${file}`));
    process.exit(1);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

async function cmdGraph(file: string | undefined): Promise<void> {
  const doc = loadWorkflow(file);
  const engine = await projectEngine();
  const { ok, workflow, issues } = collectIssues(doc, engine.ops);
  if (workflow) console.log(formatGraph(workflow, engine.ops));
  if (!ok) {
    console.log("");
    console.log(pc.red(`${issues.length} validation issue(s):`));
    for (const i of issues) console.log(`  ${pc.red("•")} ${i.message}`);
    process.exit(1);
  }
}

async function cmdValidate(file: string | undefined): Promise<void> {
  const doc = loadWorkflow(file);
  const engine = await projectEngine();
  const { ok, issues } = collectIssues(doc, engine.ops);
  const warnings = issues.filter((i) => i.severity === "warning");
  const errors = issues.filter((i) => i.severity !== "warning");
  const line = (i: (typeof issues)[number], mark: string) => {
    const loc = [i.nodeId && `node "${i.nodeId}"`, i.port && `port "${i.port}"`].filter(Boolean).join(", ");
    console.log(`  ${mark} ${i.message}${loc ? pc.dim(` (${loc})`) : ""}`);
  };
  if (ok) {
    console.log(warnings.length ? pc.green("✓ valid ") + pc.yellow(`(${warnings.length} warning(s))`) : pc.green("✓ workflow is valid"));
    for (const i of warnings) line(i, pc.yellow("⚠"));
    return;
  }
  console.log(pc.red(`✗ ${errors.length} error(s)`) + (warnings.length ? pc.yellow(` + ${warnings.length} warning(s)`) : "") + ":");
  for (const i of errors) line(i, pc.red("•"));
  for (const i of warnings) line(i, pc.yellow("⚠"));
  process.exit(1);
}

/**
 * `pattern run <file.json|id> [-- args]` — run a `boundary.cli` workflow once.
 * The target is an explicit workflow file, OR the **id** of a registered
 * workflow — including one authored in the admin (those load from `.pattern`
 * when the project's mods install) and file workflows under `./workflows`. Loads
 * the project (so app/npm ops + stored workflows resolve), attaches the durable
 * trace store so the run shows up in the admin like any other, runs it (args
 * after `--` reach `args`/`parsed`/stdin), and exits with the CLI exit code.
 */
async function cmdRun(rest: string[]): Promise<void> {
  const dash = rest.indexOf("--");
  const target = dash >= 0 ? rest.slice(0, dash).find((a) => !a.startsWith("-")) : rest[0];
  const argv = dash >= 0 ? rest.slice(dash + 1) : rest.slice(1);
  if (!target) {
    console.error(pc.red("expected a workflow file or id:  pattern run <file.json|id> [-- args]"));
    process.exit(1);
  }

  // Loads the mods → the admin's control plane registers stored (admin-authored)
  // workflows from `.pattern` during its `ready` hook.
  const engine = await projectEngine();
  // CLI runs are one-shot and interactive — sample I/O so their replay has data.
  engine.setIoSampling(true);
  // Also register file-based workflows so `pattern run <id>` resolves those too.
  for (const wf of await loadWorkflowDir(resolve(process.cwd(), "workflows"))) {
    if (!engine.workflows.has(wf.id)) await engine.registerWorkflowAsync(wf).catch(() => {});
  }

  // Resolve the target: an explicit file path wins; otherwise it's a workflow id.
  let doc: Workflow | undefined;
  if (existsSync(target)) {
    try {
      doc = JSON.parse(readFileSync(target, "utf8")) as Workflow;
      await engine.registerWorkflowAsync(doc);
    } catch (err) {
      console.error(pc.red(`✗ ${(err as Error).message}`));
      process.exit(1);
    }
  } else {
    doc = engine.workflows.get(target);
    if (!doc) {
      console.error(pc.red(`no workflow file "${target}", and no registered workflow with id "${target}".`));
      console.error(pc.dim("  Admin-authored workflows load from .pattern — make sure @pattern-js/mod-admin is in your mods."));
      console.error(pc.dim("  `pattern ops` and the admin's Workflows list show what's available."));
      process.exit(1);
    }
  }

  const store = await createTraceStore({ kind: "sqlite", path: resolve(process.cwd(), ".pattern/traces.db") });
  engine.onTrace(store);

  let code = 0;
  try {
    code = await runCli(engine, doc, { argv });
  } catch (err) {
    // The most common case: the workflow has no `boundary.cli` trigger.
    console.error(pc.red(`✗ ${(err as Error).message}`));
    code = 1;
  } finally {
    await store.close();
  }
  process.exit(code);
}

/**
 * `pattern mcp` — serve the project's tool workflows over stdio (§15).
 * Local = trusted: runs execute as an admin-scoped "local-cli" principal, and
 * the restricted pattern_* control-plane tools ARE exposed (point Claude Code
 * or Cursor here and your editor's agent becomes a Pattern author). stdout is
 * reserved for JSON-RPC — everything the project logs is rerouted to stderr.
 */
async function cmdMcp(): Promise<void> {
  // Mods print (bootstrap links, boot notes) with console.log — reroute BEFORE
  // the project loads so no stray line corrupts the JSON-RPC stream.
  console.log = (...args: unknown[]) => console.error(...args);

  const engine = await projectEngine();
  for (const wf of await loadWorkflowDir(resolve(process.cwd(), "workflows"))) {
    if (!engine.workflows.has(wf.id)) await engine.registerWorkflowAsync(wf).catch(() => {});
  }

  // Tool calls show up in the admin's Runs page like any other run.
  const store = await createTraceStore({ kind: "sqlite", path: resolve(process.cwd(), ".pattern/traces.db") });
  engine.onTrace(store);

  let version = "0.0.0";
  try {
    version = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    /* best-effort */
  }

  const { runMcpStdio } = await import("../mcp-stdio.js");
  try {
    await runMcpStdio(engine, { name: "pattern", version });
  } catch (err) {
    console.error(pc.red(`✗ ${(err as Error).message}`));
    await store.close();
    process.exit(1);
  }
  await store.close();
  process.exit(0);
}

// ── pattern ops ──────────────────────────────────────────────────────────────

function firstLine(s: string | undefined): string {
  return (s ?? "").split("\n")[0] ?? "";
}

/** "core.string.template" → "core.string"; "boundary.http.request" → "boundary"; "app.shout" → "app". */
function groupOf(type: string): string {
  const parts = type.split(".");
  if (parts[0] === "core") return parts.slice(0, 2).join(".");
  return parts[0] ?? "misc";
}

function portLine(name: string, spec: PortSpec, dir: "in" | "out"): string {
  const arrow = dir === "in" ? pc.cyan("→") : pc.magenta("←");
  const kind = spec.kind === "value" ? "value" : spec.kind === "stream" ? pc.magenta("stream") : pc.yellow("control");
  const req = spec.required ? pc.yellow(" required") : "";
  const desc = spec.description ? pc.dim(`  ${firstLine(spec.description)}`) : "";
  return `    ${arrow} ${pc.bold(name)}  ${pc.dim(kind)}${req}${desc}`;
}

/** Render a zod config schema's top-level fields (type, default, required). */
function configLines(schema: z.ZodType | undefined): string[] {
  if (!schema) return [];
  let json: { properties?: Record<string, Record<string, unknown>>; required?: string[] };
  try {
    json = z.toJSONSchema(schema, { unrepresentable: "any" } as never) as typeof json;
  } catch {
    return [pc.dim("    (config schema not representable as JSON Schema)")];
  }
  if (!json.properties) return [];
  const requiredKeys = new Set(json.required ?? []);
  return Object.entries(json.properties).map(([key, prop]) => {
    const type = typeof prop.type === "string" ? prop.type : Array.isArray(prop.enum) ? `enum(${prop.enum.join("|")})` : "any";
    const def = prop.default !== undefined ? pc.dim(` = ${JSON.stringify(prop.default)}`) : "";
    const req = requiredKeys.has(key) && prop.default === undefined ? pc.yellow(" required") : "";
    return `    ${pc.bold(key)}  ${pc.dim(type)}${def}${req}`;
  });
}

function printOpDetail(engine: Engine, op: OpDefinition): void {
  console.log("");
  console.log(`  ${pc.bold(pc.cyan(op.type))}${op.boundary ? `  ${pc.yellow(`[${op.boundary}]`)}` : ""}`);
  if (op.description) console.log(`  ${pc.dim(op.description)}`);
  if (op.pair) console.log(`  ${pc.dim("pairs with")} ${pc.cyan(op.pair)}`);

  const configInputs = op.configInputs ? Object.entries(resolvePorts(op.configInputs, {})) : [];
  const inputs = Object.entries(resolvePorts(op.inputs, {}));
  const outputs = Object.entries(resolvePorts(op.outputs, {}));
  const controlOuts = resolveControlOuts(op, {});

  if (inputs.length || configInputs.length) {
    console.log(`  ${pc.dim("inputs:")}`);
    for (const [name, spec] of configInputs) console.log(portLine(name, spec, "in") + pc.dim("  (config port)"));
    for (const [name, spec] of inputs) console.log(portLine(name, spec, "in"));
  }
  if (outputs.length) {
    console.log(`  ${pc.dim("outputs:")}`);
    for (const [name, spec] of outputs) console.log(portLine(name, spec, "out"));
  }
  if (controlOuts.length) console.log(`  ${pc.dim("control-outs:")} ${controlOuts.map((c) => pc.yellow(c)).join(", ")}`);

  const config = configLines(op.config as z.ZodType | undefined);
  if (config.length) {
    console.log(`  ${pc.dim("config:")}`);
    for (const line of config) console.log(line);
  }
  console.log("");
}

async function cmdOps(query: string | undefined): Promise<void> {
  const engine = await projectEngine();
  const all = engine.ops.list().sort((a, b) => a.type.localeCompare(b.type));

  // Exact type → full detail.
  const exact = query && engine.ops.get(query);
  if (exact) return printOpDetail(engine, exact);

  const q = (query ?? "").toLowerCase();
  const matched = q ? all.filter((op) => op.type.toLowerCase().includes(q)) : all;
  if (!matched.length) {
    console.error(pc.red(`no op matches "${query}"`));
    process.exit(1);
  }

  // Single match on a fuzzy query → treat as detail too.
  if (q && matched.length === 1) return printOpDetail(engine, matched[0]!);

  const groups = new Map<string, OpDefinition[]>();
  for (const op of matched) {
    const g = groupOf(op.type);
    groups.set(g, [...(groups.get(g) ?? []), op]);
  }
  const width = Math.max(...matched.map((op) => op.type.length)) + 2;
  console.log("");
  for (const [group, ops] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${pc.bold(group)} ${pc.dim(`(${ops.length})`)}`);
    for (const op of ops) {
      const badge = op.boundary === "trigger" ? pc.yellow("▸ ") : op.boundary === "outgate" ? pc.yellow("◂ ") : "  ";
      console.log(`  ${badge}${pc.cyan(op.type.padEnd(width))}${pc.dim(firstLine(op.description))}`);
    }
    console.log("");
  }
  console.log(pc.dim(`  ${matched.length} ops — \`pattern ops <type>\` for ports + config.\n`));
}

// ── pattern load ─────────────────────────────────────────────────────────────

async function cmdLoad(args: string[]): Promise<void> {
  const { loadScenario, runLoad, resolveScenario } = await import("../load/index.js");
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const file = args.find((a) => !a.startsWith("-") && a !== flag("--url") && a !== flag("--out") && a !== flag("--p99"));
  if (!file) {
    console.error(pc.red("expected a scenario file: pattern load <scenario.json>"));
    process.exit(1);
  }
  let scenario;
  try {
    scenario = loadScenario(resolveScenario(file));
  } catch (err) {
    console.error(pc.red(`✗ ${(err as Error).message}`));
    process.exit(1);
  }
  const sweep = args.includes("--sweep");
  const out = flag("--out");
  const url = flag("--url");
  const p99 = flag("--p99");

  console.log(`${pc.bold("pattern load")} ${pc.dim(file)}${sweep ? pc.yellow("  (saturation sweep)") : ""}`);
  const startedAt = Date.now();
  const report = await runLoad(
    scenario,
    { sweep, out, baseUrl: url, p99BudgetMs: p99 ? Number(p99) : undefined },
    startedAt,
  );
  report.scenario = file;

  if (out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`\n  ${pc.green("✓")} report written to ${pc.cyan(out)}`);
  }
  const anyErrors = report.stages.some((s) => s.errors > 0);
  console.log("");
  process.exit(anyErrors ? 1 : 0);
}

function cmdDev(entryArg: string | undefined): void {
  const candidates = entryArg ? [entryArg] : ["src/index.ts", "src/main.ts", "src/index.js", "index.js"];
  const entry = candidates.find((c) => existsSync(c));
  if (!entry) {
    console.error(pc.red(`no entry found (looked for: ${candidates.join(", ")})`));
    process.exit(1);
  }
  console.log(pc.dim(`pattern dev — watching & running ${entry}`));
  const child = spawn(process.execPath, ["--watch", entry], { stdio: "inherit", env: process.env });
  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => child.kill("SIGINT"));
}

void main();
