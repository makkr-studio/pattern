#!/usr/bin/env node
/**
 * `pattern` — the dev CLI (§15).
 *
 *   pattern graph <file.json>   Validate a workflow and print its graph.
 *   pattern dev [entry]         Run an entry with file-watch hot-reload.
 *   pattern validate <file>     Validate a workflow document; report issues.
 *
 * `dev` shells out to `node --watch` (Node ≥20 runs .ts via type-stripping on
 * recent versions). The admin UI is a future mod; until then `graph` is how you
 * inspect a workflow in-terminal.
 */

import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { Engine, formatGraph, collectIssues } from "@pattern/core";

const pc = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "graph":
      return cmdGraph(rest[0]);
    case "validate":
      return cmdValidate(rest[0]);
    case "dev":
      return cmdDev(rest[0]);
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

  ${pc.cyan("pattern graph")} <file.json>     print a workflow's graph
  ${pc.cyan("pattern validate")} <file.json>  validate a workflow document
  ${pc.cyan("pattern dev")} [entry]           run an entry with --watch hot-reload
`);
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

function cmdGraph(file: string | undefined): void {
  const doc = loadWorkflow(file);
  const engine = new Engine();
  const { ok, workflow, issues } = collectIssues(doc, engine.ops);
  if (workflow) console.log(formatGraph(workflow, engine.ops));
  if (!ok) {
    console.log("");
    console.log(pc.red(`${issues.length} validation issue(s):`));
    for (const i of issues) console.log(`  ${pc.red("•")} ${i.message}`);
    process.exit(1);
  }
}

function cmdValidate(file: string | undefined): void {
  const doc = loadWorkflow(file);
  const engine = new Engine();
  const { ok, issues } = collectIssues(doc, engine.ops);
  if (ok) {
    console.log(pc.green("✓ workflow is valid"));
    return;
  }
  console.log(pc.red(`✗ ${issues.length} issue(s):`));
  for (const i of issues) {
    const loc = [i.nodeId && `node "${i.nodeId}"`, i.port && `port "${i.port}"`].filter(Boolean).join(", ");
    console.log(`  ${pc.red("•")} ${i.message}${loc ? pc.dim(` (${loc})`) : ""}`);
  }
  process.exit(1);
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

main();
