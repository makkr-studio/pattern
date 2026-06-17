#!/usr/bin/env node
/**
 * create-pattern — the Pattern project scaffolder (§15). The front door of the DX.
 *
 *   npm create pattern@latest
 *   pnpm create pattern my-app --modpack studio
 *
 * Projects are scaffolded from **modpacks** — curated sets of mods for a use
 * case (blank slate / headless backend / studio with the admin). Interactive by
 * default (banner → modpack → package manager → install), with graceful
 * non-TTY/CI degradation: everything is flag-driven, no prompts, no animation,
 * fully scriptable. Dev-time-only deps, so it can be rich.
 *
 * Every modpack ships AGENTS.md + CLAUDE.md — the contract sheet a coding agent
 * needs to add ops, routes, workflows, and admin pages without guessing.
 */

import { cp, readdir, readFile, rename, rm, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates", import.meta.url));

interface NextCtx {
  name: string;
  runCmd: string;
  installed: boolean;
  installLine: string;
  auth: boolean;
  examples: boolean;
}

interface Modpack {
  id: string;
  label: string;
  /** One-liner shown as the select hint. */
  hint: string;
  /** Technical one-liner under the card title — what this actually is. */
  tagline: string;
  /** The mods the pack wires up (display names; roles from MOD_ROLES). */
  mods: string[];
  /** Names the actual example artifacts — for the examples question + card. */
  exampleSummary: string;
  /** Endpoints the running app exposes (the card's "serves" line). */
  serves: (examples: boolean) => string[];
  /** Env vars the pack needs (the card's "needs" line). */
  env: string[];
  /** Key generated paths shown as the card's file tree. */
  generates: (examples: boolean) => string[];
  /** A workflow file to render as an inline graph (when examples are on). */
  showcase?: string;
  /**
   * Auth is a DIMENSION, not a pack: packs that serve HTTP can opt into the
   * identity brick (magic-link login, users/sessions, secured admin). Absent
   * → the question is never asked (blank has no HTTP host).
   */
  auth?: { default: boolean };
  /**
   * Docs is a DIMENSION too: any pack serving HTTP can ship `/docs` — the
   * Pattern handbook + a live op reference, where every installed mod
   * contributes its own chapter. Absent → never asked (blank has no host).
   */
  docs?: { default: boolean };
  /** Tailored next steps once scaffolded. */
  next: (ctx: NextCtx) => string[];
}

/** What the auth toggle adds (pack card lines + config wiring). */
const AUTH_MODS = ["@pattern/mod-identity", "@pattern/mod-auth-magic-link"];

/** What the docs toggle adds: self-reflecting documentation at /docs. */
const DOCS_MOD = "@pattern/mod-docs";

/** One-line technical role per mod — shown beside each in the manifest card. */
const MOD_ROLES: Record<string, string> = {
  "@pattern/mod-admin": "visual editor, run traces, /admin control plane",
  "@pattern/mod-agents": "agent ops: agent · run · tools · guardrail",
  "@pattern/mod-agents-openai": "OpenAI provider for the agent ops",
  "@pattern/mod-agents(-openai)": "agent ops (agent · run · tools) on OpenAI",
  "@pattern/mod-store": "durable state (sqlite): conversations, blobs, leases",
  "@pattern/mod-vault": "encrypted secrets — holds OPENAI_API_KEY",
  "@pattern/mod-chat": "the /chat product; its turn pipeline is a workflow",
  "@pattern/mod-identity": "users, sessions, roles → scopes",
  "@pattern/mod-auth-magic-link": "magic-link login (console fallback in dev)",
  "@pattern/mod-docs": "/docs: handbook + a live op reference",
  "./mods/quotes.mjs (app-local)": "app-local: example ops + an admin page",
  "./mods/uppercase.mjs (app-local)": "app-local: the app.shout op",
};

/** Ladder order (ascending capability) for the picker + --list. */
const LADDER = ["blank", "headless", "studio", "agentic", "agent-chat"];

const MODPACKS: Modpack[] = [
  {
    id: "blank",
    label: "Engine only",
    hint: "no web server, no UI — run a workflow from code and watch it print; best for learning or embedding",
    tagline: "the engine in-process — run workflows from code, no server",
    mods: [],
    exampleSummary: "one runnable example workflow (greeting)",
    serves: () => [],
    env: [],
    generates: (ex) => (ex ? ["workflows/greeting.json", "src/index.ts"] : ["workflows/ (your workflows)", "src/index.ts"]),
    showcase: "workflows/greeting.json",
    next: ({ name, runCmd, installed, installLine, examples }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        `${pc.dim("$")} ${runCmd} dev   ${pc.dim(examples ? "— runs the greeting workflow, prints the result" : "— boots the engine")}`,
        ...(examples
          ? [`${pc.cyan("→")} edit ${pc.bold("workflows/greeting.json")} ${pc.dim("(hot-reloaded), or wire in core.string.* / core.math.* ops")}`]
          : ["", `${pc.cyan("→")} add a workflow in ${pc.bold("workflows/")} ${pc.dim("(see AGENTS.md), then engine.run() it from src/index.ts")}`]),
      ].filter((l) => l !== ""),
  },
  {
    id: "headless",
    label: "Headless server",
    hint: "a running server, no UI — serve HTTP, WebSocket, scheduled or CLI workflows; routes are JSON",
    tagline: "the engine + the HTTP/WS/CLI host — serve workflows as endpoints, no UI",
    mods: ["./mods/uppercase.mjs (app-local)"],
    exampleSummary: "4 example routes (hello/echo/shout/health) + the app.shout mod",
    serves: (ex) => (ex ? ["/hello/:name", "/echo", "/shout/:text", "/health"] : []),
    env: [],
    generates: (ex) =>
      ex
        ? ["workflows/hello.json + echo, shout, health", "mods/uppercase.mjs", "src/index.ts"]
        : ["workflows/ (your routes)", "mods/ (your ops)", "src/index.ts"],
    showcase: "workflows/hello.json",
    // APIs often start behind a gateway — opt in with one keystroke.
    auth: { default: false },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth, examples }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        ...(examples
          ? [
              `${pc.cyan("→")} curl localhost:3000/hello/world`,
              `${pc.cyan("→")} curl -XPOST localhost:3000/echo -H 'content-type: application/json' -d '{"message":"hi"}'`,
            ]
          : [`${pc.cyan("→")} add a route: a workflow with ${pc.bold("boundary.http.request → boundary.http.response")} in workflows/ (see AGENTS.md)`]),
        ...(auth
          ? [`${pc.cyan("→")} curl localhost:3000/whoami ${pc.dim("— 401 until you sign in (first boot prints a one-time link)")}`]
          : []),
      ].filter((l) => l !== ""),
  },
  {
    id: "studio",
    label: "Studio",
    hint: "a visual workspace at /admin — build, version, run & trace workflows in the browser (recommended)",
    tagline: "the engine + mod-admin — a visual editor, run traces & a versioned workflow store at /admin",
    mods: ["@pattern/mod-admin", "./mods/quotes.mjs (app-local)"],
    exampleSummary: "3 editable example workflows + an app-local mod (ops + an admin page)",
    serves: () => ["/admin"],
    env: [],
    generates: (ex) =>
      ex
        ? ["3 seeded workflows (in the admin store)", "mods/quotes.mjs", "src/index.ts"]
        : ["workflows/ (file workflows)", "mods/ (your ops)", "src/index.ts"],
    // Secure-by-default is the philosophy — the flagship pack ships locked.
    auth: { default: true },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth, examples }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        ...(auth
          ? [
              `${pc.cyan("→")} first boot prints a ${pc.bold("one-time admin link")} in the console — open it, you're the owner`,
              `${pc.cyan("→")} then ${pc.bold("http://localhost:3000/admin")} ${pc.dim("(sign-in links print to the console too)")}`,
            ]
          : [`${pc.cyan("→")} open ${pc.bold("http://localhost:3000/admin")}`]),
        examples
          ? `${pc.cyan("→")} the editor opens with 3 example workflows — fork one, or ${pc.dim("curl localhost:3000/hello/world")}`
          : `${pc.cyan("→")} build your first workflow in the editor ${pc.dim("(or drop JSON in workflows/ — see AGENTS.md)")}`,
      ].filter((l) => l !== ""),
  },
  {
    id: "agentic",
    label: "Studio + Agents",
    hint: "build agentic workflows in the editor — agent/run/tools ops + vault + store; no chat UI",
    tagline: "Studio + the agent stack — build agentic workflows (agent · run · tools) in the editor",
    mods: [
      "@pattern/mod-agents(-openai)",
      "@pattern/mod-store",
      "@pattern/mod-vault",
      "@pattern/mod-admin",
    ],
    exampleSummary: "an agentic workflow (POST /ask → agent + tool) + a get_time tool",
    serves: (ex) => (ex ? ["/admin", "/ask"] : ["/admin"]),
    env: ["OPENAI_API_KEY", "PATTERN_VAULT_KEY"],
    generates: (ex) =>
      ex
        ? ["workflows/agent-answer.json", "workflows/tool-time.json", "src/index.ts", ".env.example"]
        : ["workflows/ (your agentic flows)", "src/index.ts", ".env.example"],
    showcase: "workflows/agent-answer.json",
    auth: { default: true },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth, examples }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        `${pc.dim("$")} cp .env.example .env ${pc.dim("— set OPENAI_API_KEY (or store it on the admin Secrets page)")}`,
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        ...(auth
          ? [`${pc.cyan("→")} admin is locked — first boot prints a one-time owner link; then ${pc.bold("http://localhost:3000/admin")}`]
          : [`${pc.cyan("→")} open ${pc.bold("http://localhost:3000/admin")}`]),
        examples
          ? `${pc.cyan("→")} curl -XPOST localhost:3000/ask -H 'content-type: application/json' -d '{"question":"what time is it?"}' ${pc.dim("— the agent calls get_time (a linked sub-run)")}`
          : `${pc.cyan("→")} build an agentic workflow: ${pc.bold("agents.agent → agents.run")} (see AGENTS.md)`,
      ].filter((l) => l !== ""),
  },
  {
    id: "agent-chat",
    label: "Studio + Agentic Chat",
    hint: "a chat product at /chat — tools, guardrails, HITL — the turn pipeline is an agentic workflow",
    tagline: "Studio + Agents + mod-chat — the /chat product whose turn pipeline is an agentic workflow",
    mods: [
      "@pattern/mod-chat",
      "@pattern/mod-agents(-openai)",
      "@pattern/mod-store",
      "@pattern/mod-vault",
      "@pattern/mod-admin",
    ],
    exampleSummary: "two example chat tools (get_time, get_weather)",
    serves: () => ["/chat", "/admin"],
    env: ["OPENAI_API_KEY", "PATTERN_VAULT_KEY"],
    generates: (ex) =>
      ex
        ? ["workflows/tool-time.json", "workflows/tool-weather.json", "src/index.ts", ".env.example"]
        : ["workflows/ (your tools)", "src/index.ts", ".env.example"],
    showcase: "workflows/tool-time.json",
    auth: { default: true },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth, examples }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        `${pc.dim("$")} cp .env.example .env ${pc.dim("— set OPENAI_API_KEY (or store it on the admin Secrets page)")}`,
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        `${pc.cyan("→")} chat at ${pc.bold("http://localhost:3000/chat")}`,
        ...(auth
          ? [`${pc.cyan("→")} admin is locked — first boot prints a one-time owner link`]
          : [`${pc.cyan("→")} admin at ${pc.bold("http://localhost:3000/admin")}`]),
        examples
          ? `${pc.cyan("→")} ask it ${pc.bold('"what time is it?"')} ${pc.dim("— the agent calls the get_time tool (a linked sub-run)")}`
          : `${pc.cyan("→")} add a tool workflow (see AGENTS.md), then ask the agent to call it`,
      ].filter((l) => l !== ""),
  },
];

/** Old template ids → modpacks, so existing scripts keep working. */
const LEGACY_IDS: Record<string, string> = {
  "hello-workflow": "blank",
  "http-api": "headless",
};

const PMS = ["npm", "pnpm", "yarn", "bun"] as const;
type Pm = (typeof PMS)[number];

interface Flags {
  name?: string;
  modpack?: string;
  pm?: Pm;
  install: boolean;
  git: boolean;
  yes: boolean;
  list: boolean;
  /** undefined = ask (interactive) / pack default (headless). */
  auth?: boolean;
  /** Same tri-state as auth. */
  docs?: boolean;
  /** undefined = ask (interactive) / default ON (headless). */
  examples?: boolean;
  /** Print the manifest for the resolved selection and write nothing. */
  dryRun: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { install: true, git: true, yes: false, list: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--modpack" || a === "-m" || a === "--template" || a === "-t") flags.modpack = argv[++i];
    else if (a === "--pm") flags.pm = argv[++i] as Pm;
    else if (a === "--no-install") flags.install = false;
    else if (a === "--no-git") flags.git = false;
    else if (a === "--auth") flags.auth = true;
    else if (a === "--no-auth") flags.auth = false;
    else if (a === "--docs") flags.docs = true;
    else if (a === "--no-docs") flags.docs = false;
    else if (a === "--examples") flags.examples = true;
    else if (a === "--no-examples") flags.examples = false;
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--list" || a === "-l") flags.list = true;
    else if (a === "--dry-run" || a === "--dry") flags.dryRun = true;
    else if (!a.startsWith("-") && !flags.name) flags.name = a;
  }
  if (flags.modpack && LEGACY_IDS[flags.modpack]) flags.modpack = LEGACY_IDS[flags.modpack];
  return flags;
}

function banner(): void {
  const lines = ["┌─┐┌─┐┌┬┐┌┬┐┌─┐┬─┐┌┐┌", "├─┘├─┤ │  │ ├┤ ├┬┘│││", "┴  ┴ ┴ ┴  ┴ └─┘┴└─┘└┘"];
  const colors = [pc.magenta, pc.magentaBright ?? pc.magenta, pc.cyan];
  console.log("");
  lines.forEach((l, i) => console.log("  " + (colors[i] ?? pc.cyan)(l)));
  console.log("  " + pc.dim("workflows as data · ops as code · mods all the way down\n"));
}

function detectPm(): Pm {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("yarn")) return "yarn";
  if (ua.startsWith("bun")) return "bun";
  return "npm";
}

/** Resolve the display-name → npm-name (drops the "(app-local)" annotation). */
function modPath(display: string): string {
  return display.replace(/\s*\(app-local\)\s*$/, "");
}

/**
 * The manifest card: a computed, accurate preview of exactly what gets wired
 * and generated — mods + their roles, the file tree, the endpoints served, the
 * env it needs. Everything here is derived from the actual selections.
 */
function packCard(pack: Modpack, auth: boolean, docs: boolean, examples: boolean): string {
  // Mods, in install order: identity first (infra), pack mods, docs last.
  const packMods = examples ? pack.mods : pack.mods.filter((m) => !m.includes("(app-local)"));
  const modList = [...(auth ? AUTH_MODS : []), ...packMods, ...(docs ? [DOCS_MOD] : [])];
  const roleOf = (m: string) => MOD_ROLES[m] ?? "";
  const width = Math.max(0, ...modList.map((m) => modPath(m).length));
  const modLines = modList.length
    ? modList.map((m) => `  ${pc.magenta(modPath(m).padEnd(width))}  ${pc.dim(roleOf(m))}`)
    : [`  ${pc.dim("none — just the engine, in-process")}`];

  const files = pack.generates(examples);
  const fileLines = files.map((f) => `  ${pc.cyan("›")} ${f}`);

  const serves = [...pack.serves(examples), ...(docs ? ["/docs"] : []), ...(auth && pack.id === "headless" && examples ? ["/whoami"] : [])];
  const env = pack.env;

  const blocks: string[] = [`${pc.dim(pack.tagline)}`, "", pc.bold("mods"), ...modLines, "", pc.bold("generates"), ...fileLines];
  if (serves.length) blocks.push("", `${pc.bold("serves")}   ${serves.map((s) => pc.cyan(s)).join(pc.dim(" · "))}`);
  if (env.length) {
    const hint = env.includes("PATTERN_VAULT_KEY") ? pc.dim("  (vault key: openssl rand -base64 32)") : "";
    blocks.push(`${pc.bold("needs")}    ${env.map((e) => pc.magenta(e)).join(pc.dim(" · "))}${hint}`);
  }
  blocks.push("", `${pc.green("✦")} AGENTS.md + CLAUDE.md — the recipes your coding agent reads`);
  return blocks.join("\n");
}

/** Resolve the orthogonal dimensions from flags + pack defaults (no prompts). */
function resolveDims(pack: Modpack, flags: Flags): { auth: boolean; docs: boolean; examples: boolean } {
  return {
    auth: pack.auth ? (flags.auth ?? pack.auth.default) : false,
    docs: pack.docs ? (flags.docs ?? pack.docs.default) : false,
    examples: flags.examples ?? true,
  };
}

/** --dry-run: print exactly what WOULD be wired & generated, write nothing. */
function previewManifest(flags: Flags): void {
  banner();
  const pack = packOrThrow(flags.modpack ?? "studio");
  const { auth, docs, examples } = resolveDims(pack, flags);
  console.log(
    `  ${pc.bold(pack.label)} ${pc.dim(`(${pack.id}${examples ? "" : ", no examples"}${auth ? ", auth" : ""}${docs ? ", docs" : ""})`)}\n`,
  );
  console.log(
    packCard(pack, auth, docs, examples)
      .split("\n")
      .map((l) => "  " + l)
      .join("\n"),
  );
  console.log("\n  " + pc.dim("dry run — nothing written. Drop --dry-run to scaffold."));
}

/** Render the seeded showcase workflow as a terminal graph (examples + installed). */
function showcaseGraph(name: string, pack: Modpack, examples: boolean, installed: boolean): string | null {
  if (!examples || !pack.showcase || !installed) return null;
  const dir = resolve(process.cwd(), name);
  try {
    const res = spawnSync("npx", ["pattern", "graph", pack.showcase], { cwd: dir, encoding: "utf8" });
    if (res.status === 0 && res.stdout?.trim()) return res.stdout.replace(/\s+$/, "");
  } catch {
    /* the inline graph is a nicety — never block scaffolding on it */
  }
  return null;
}

function listPacks(): void {
  console.log(`\n${pc.bold("Modpacks")} — a ladder; each rung adds one capability:\n`);
  for (const pack of LADDER.map((id) => packOrThrow(id))) {
    const authNote = pack.auth ? pc.dim(`  (auth: ${pack.auth.default ? "on" : "off"}, docs: ${pack.docs?.default ? "on" : "off"} by default)`) : "";
    console.log(`  ${pc.cyan(pack.id.padEnd(12))}${pack.label} — ${pc.dim(pack.hint)}${authNote}`);
  }
  console.log(
    `\n  ${pc.dim("npm create pattern@latest my-app -- --modpack <id> [--auth|--no-auth] [--docs|--no-docs] [--examples|--no-examples]")}`,
  );
  console.log(`  ${pc.dim("examples are included by default — pass --no-examples for a clean scaffold.")}\n`);
}

async function copyTemplate(packId: string, targetDir: string, name: string): Promise<void> {
  const src = join(TEMPLATES_DIR, packId);
  await cp(src, targetDir, { recursive: true });
  // _gitignore → .gitignore (npm strips .gitignore from published packages).
  if (existsSync(join(targetDir, "_gitignore"))) {
    await rename(join(targetDir, "_gitignore"), join(targetDir, ".gitignore"));
  }
  // _env.example → .env.example (same npm-stripping dance for dotfiles).
  if (existsSync(join(targetDir, "_env.example"))) {
    await rename(join(targetDir, "_env.example"), join(targetDir, ".env.example"));
  }
  // Replace {{name}} placeholders in text files.
  await replacePlaceholders(targetDir, { name });
}

async function replacePlaceholders(dir: string, vars: Record<string, string>): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      await replacePlaceholders(full, vars);
    } else {
      const s = await stat(full);
      if (s.size > 1_000_000) continue;
      let text: string;
      try {
        text = await readFile(full, "utf8");
      } catch {
        continue;
      }
      // Note: no inner whitespace — `{{name}}` is a scaffold var, while the
      // Pattern runtime template syntax `{{ name }}` (with spaces) is preserved.
      const replaced = text.replace(/\{\{(\w+)\}\}/g, (m, key) => vars[key] ?? m);
      if (replaced !== text) await writeFile(full, replaced);
    }
  }
}

function packOrThrow(id: string): Modpack {
  const pack = MODPACKS.find((t) => t.id === id);
  if (!pack) throw new Error(`unknown modpack "${id}" (have: ${MODPACKS.map((t) => t.id).join(", ")})`);
  return pack;
}

/** A protected route demoing requireAuth + the trigger's `user` port (headless). */
const WHOAMI_WORKFLOW = `{
  "$schema": "pattern/workflow/v1",
  "id": "whoami",
  "name": "GET /whoami (protected)",
  "nodes": [
    {
      "id": "in",
      "op": "boundary.http.request",
      "config": { "method": "GET", "path": "/whoami", "requireAuth": true },
      "comment": "requireAuth gates the route; the user port carries the signed-in identity."
    },
    { "id": "out", "op": "boundary.http.response", "config": { "mode": "buffered" } }
  ],
  "edges": [
    { "from": { "node": "in", "port": "user" }, "to": { "node": "out", "port": "body" } }
  ]
}
`;

/**
 * Flip the auth dimension on: wire the identity mods into the manifest and
 * the config (FIRST in the list — they're infrastructure), and give headless
 * packs a protected /whoami route so the value is curl-able in minute one.
 */
async function applyAuth(targetDir: string, packId: string): Promise<void> {
  const pkgPath = join(targetDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { dependencies: Record<string, string> };
  for (const mod of AUTH_MODS) pkg.dependencies[mod] = "^0.1.0";
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const cfgPath = join(targetDir, "pattern.config.json");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as { mods: string[] };
  cfg.mods = [...AUTH_MODS, ...cfg.mods];
  await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

  if (packId === "headless") {
    await writeFile(join(targetDir, "workflows", "whoami.json"), WHOAMI_WORKFLOW);
  }
}

/** Flip the docs dimension on: /docs joins the manifest + config (last — it documents the rest). */
async function applyDocs(targetDir: string): Promise<void> {
  const pkgPath = join(targetDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { dependencies: Record<string, string> };
  pkg.dependencies[DOCS_MOD] = "^0.1.0";
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const cfgPath = join(targetDir, "pattern.config.json");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as { mods: string[] };
  cfg.mods = [...cfg.mods, DOCS_MOD];
  await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
}

// ── Examples dimension ───────────────────────────────────────────────────────
// "Examples" = the demo CUSTOM content (sample workflows, example tools,
// app-local demo mods). The platform mods and their built-in workflows always
// stay and always run. `--no-examples` strips the demos and leaves a runnable
// skeleton + notes on how to add your own.

const NOTE_WORKFLOWS = `# workflows/

Drop \`*.json\` workflow files here — each registers at boot (hot-reloaded by
\`npm run dev\`). See AGENTS.md for the workflow-JSON shape, and \`npx pattern ops\`
for every op you can wire.
`;

const NOTE_TOOLS = `# workflows/

Tool workflows live here — a workflow with a \`boundary.tool\` trigger and a
\`boundary.tool.return\` out-gate. The agent picks up every tool automatically
(via \`agents.tools.workflows\`). See AGENTS.md for the recipe.
`;

const NOTE_AGENTIC = `# workflows/

Agentic workflows live here — a graph that wires an agent (\`agents.agent\`)
into a runner (\`agents.run\`), plus tools (each a workflow with a
\`boundary.tool\` trigger). Build them in the editor at /admin or drop JSON
here. See AGENTS.md for the shape.
`;

const NOTE_MODS = `# mods/

App-local mods live here — a single \`.mjs\` (or \`.ts\`) file contributing ops
(and, with mod-admin, an admin page). List each in \`pattern.config.json\` →
\`mods\`. See AGENTS.md.
`;

const BLANK_INDEX = `/**
 * __NAME__ — the smallest Pattern program (engine only, no server).
 *
 * Workflows are *data*: drop a JSON graph in \`workflows/\` (declared in
 * \`pattern.config.json\`) and \`loadProject\` hands back a ready \`engine\`. See
 * AGENTS.md for the shape, and \`npx pattern ops\` for every op you can wire.
 */
import { loadProject } from "@pattern/runtime-node";

const { engine } = await loadProject();
void engine;

// Add a workflow in \`workflows/\`, then run it:
//   const result = await engine.run("<your-workflow-id>", { input: { /* … */ } });
//   console.log(result.outputs);
console.log("engine ready — add a workflow in workflows/ (see AGENTS.md), then call engine.run().");
`;

const HEADLESS_INDEX = `/**
 * __NAME__ — a server built from declarative workflows (HTTP, WS, scheduled, CLI).
 *
 * Triggers live in workflow config, not code: a \`boundary.http.request\`,
 * \`boundary.ws.*\`, \`boundary.schedule\` or \`boundary.cli\` op declares the
 * route/trigger; \`start()\` derives them and opens a server per declared port.
 * Drop a \`.json\` in \`workflows/\` (see AGENTS.md); \`npm run dev\` reloads it.
 */
import { loadProject } from "@pattern/runtime-node";

const { start } = await loadProject();
const { ports } = await start();

console.log(
  ports.length
    ? \`▶ listening on \${ports.map((p) => \`http://localhost:\${p}\`).join(", ")}\`
    : "▶ engine ready — no routes yet. Add one in workflows/ (see AGENTS.md).",
);
`;

const STUDIO_INDEX = `/**
 * __NAME__ — a Pattern engine wearing its admin.
 *
 * \`@pattern/mod-admin\` gives you the visual control plane at /admin (editor,
 * runs, observability). Author workflows there — they're versioned into
 * \`./.pattern\` (commit it: it's your deployable workflow store). Add app-local
 * ops or an admin page with a mod in \`mods/\` (see AGENTS.md).
 */
import { loadProject } from "@pattern/runtime-node";

const { start } = await loadProject();

const { ports } = await start();
const base = \`http://localhost:\${ports[0]}\`;

console.log(\`◆ __NAME__\`);
console.log(\`  Admin   \${base}/admin\`);
`;

interface ExampleSpec {
  workflows?: string[];
  mods?: string[];
  configMods?: string[];
  src?: string[];
  index?: string;
  notes?: Record<string, string>;
}

const EXAMPLES: Record<string, ExampleSpec> = {
  blank: {
    workflows: ["greeting.json"],
    index: BLANK_INDEX,
    notes: { "workflows/README.md": NOTE_WORKFLOWS },
  },
  headless: {
    workflows: ["hello.json", "echo.json", "shout.json", "health.json"],
    mods: ["uppercase.mjs"],
    configMods: ["./mods/uppercase.mjs"],
    index: HEADLESS_INDEX,
    notes: { "workflows/README.md": NOTE_WORKFLOWS, "mods/README.md": NOTE_MODS },
  },
  studio: {
    mods: ["quotes.mjs"],
    configMods: ["./mods/quotes.mjs"],
    src: ["examples.ts"],
    index: STUDIO_INDEX,
    // workflows/README.md already ships in the studio template — keep it.
    notes: { "mods/README.md": NOTE_MODS },
  },
  agentic: {
    workflows: ["agent-answer.json", "tool-time.json"],
    notes: { "workflows/README.md": NOTE_AGENTIC },
  },
  "agent-chat": {
    workflows: ["tool-time.json", "tool-weather.json"],
    notes: { "workflows/README.md": NOTE_TOOLS },
  },
};

/**
 * Strip a pack's demo content, leaving a runnable skeleton + notes. The
 * platform mods (admin, chat, …) and their built-in workflows are untouched.
 */
async function applyNoExamples(targetDir: string, packId: string, name: string): Promise<void> {
  const spec = EXAMPLES[packId];
  if (!spec) return;

  for (const f of spec.workflows ?? []) await rm(join(targetDir, "workflows", f), { force: true });
  for (const f of spec.mods ?? []) await rm(join(targetDir, "mods", f), { force: true });
  for (const f of spec.src ?? []) await rm(join(targetDir, "src", f), { force: true });

  if (spec.configMods?.length) {
    const cfgPath = join(targetDir, "pattern.config.json");
    const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as { mods: string[] };
    cfg.mods = cfg.mods.filter((m) => !spec.configMods!.includes(m));
    await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  }

  // Swap in an example-free entrypoint where the shipped one runs/prints demos.
  if (spec.index) {
    await writeFile(join(targetDir, "src", "index.ts"), spec.index.replaceAll("__NAME__", name));
  }

  // Leave a short note in any otherwise-empty scaffold dir (never clobber one
  // the template already ships).
  for (const [rel, body] of Object.entries(spec.notes ?? {})) {
    const full = join(targetDir, ...rel.split("/"));
    if (!existsSync(full)) await writeFile(full, body);
  }
}

async function runInteractive(flags: Flags): Promise<void> {
  banner();
  p.intro(pc.bgMagenta(pc.black(" create-pattern ")));

  const name =
    flags.name ??
    (await p.text({
      message: "Project name?",
      placeholder: "my-pattern-app",
      defaultValue: "my-pattern-app",
      validate: (v) => (v && /^[a-z0-9-_.]+$/i.test(v) ? undefined : "use letters, numbers, - _ ."),
    }))!;
  if (p.isCancel(name)) return cancel();

  if (!flags.modpack) {
    p.note(
      [
        `${pc.dim("Each rung adds one capability over the one before:")}`,
        `${pc.cyan("Engine only")}            the engine, in-process — no server`,
        `${pc.cyan("Headless server")}        + the HTTP/WS/CLI host — serve workflows, no UI`,
        `${pc.cyan("Studio")}                 + mod-admin — a visual editor & run traces at /admin`,
        `${pc.cyan("Studio + Agents")}        + the agent stack — build agentic workflows`,
        `${pc.cyan("Studio + Agentic Chat")}  + mod-chat — the /chat product`,
      ].join("\n"),
      "The ladder",
    );
  }
  const packId =
    flags.modpack ??
    (await p.select({
      message: "Pick a modpack",
      initialValue: "studio",
      options: LADDER.map((id) => packOrThrow(id)).map((t) => ({ value: t.id, label: t.label, hint: t.hint })),
    }))!;
  if (p.isCancel(packId)) return cancel();
  const pack = packOrThrow(String(packId));

  // Auth is orthogonal to the pack — asked only where it makes sense.
  let auth = false;
  if (pack.auth) {
    if (flags.auth !== undefined) {
      auth = flags.auth;
    } else {
      const answer = await p.confirm({
        message: `Add authentication? ${pc.dim("magic-link login, users & sessions" + (pack.id === "studio" ? " — locks the admin" : ""))}`,
        initialValue: pack.auth.default,
      });
      if (p.isCancel(answer)) return cancel();
      auth = answer;
    }
  }

  // Docs is orthogonal too — same tri-state as auth.
  let docs = false;
  if (pack.docs) {
    if (flags.docs !== undefined) {
      docs = flags.docs;
    } else {
      const answer = await p.confirm({
        message: `Add documentation? ${pc.dim("/docs — the handbook + a live op reference; every mod's chapter")}`,
        initialValue: pack.docs.default,
      });
      if (p.isCancel(answer)) return cancel();
      docs = answer;
    }
  }

  // Examples are a dimension on every pack: the platform always runs, this
  // only toggles the demo content (sample workflows, tools, app-local mods).
  let examples = true;
  if (flags.examples !== undefined) {
    examples = flags.examples;
  } else {
    const answer = await p.confirm({
      message: `Include examples? ${pc.dim(pack.exampleSummary + " — off = a clean scaffold + notes")}`,
      initialValue: true,
    });
    if (p.isCancel(answer)) return cancel();
    examples = answer;
  }

  // The pack card: what this modpack actually wires up.
  p.note(packCard(pack, auth, docs, examples), `${pack.label} modpack`);

  const pm =
    flags.pm ??
    (await p.select({
      message: "Package manager",
      initialValue: detectPm(),
      options: PMS.map((m) => ({ value: m, label: m })),
    }))!;
  if (p.isCancel(pm)) return cancel();

  const install = flags.yes ? flags.install : !p.isCancel(await p.confirm({ message: `Install deps with ${pm}?`, initialValue: flags.install }));

  await scaffold({ name: String(name), pack: pack.id, pm: pm as Pm, install, git: flags.git, auth, docs, examples });

  const runCmd = pm === "npm" ? "npm run" : String(pm);
  p.note(
    [
      ...pack.next({ name: String(name), runCmd, installed: install, installLine: `${pc.dim("$")} ${pm} install`, auth, examples }),
      ...(docs ? [`${pc.cyan("→")} docs: ${pc.bold("http://localhost:3000/docs")} ${pc.dim("(public — DOCS_REQUIRE_AUTH gates it)")}`] : []),
    ].join("\n"),
    "Next steps",
  );
  // The example you'll touch first, as a graph — workflows are data, so show it.
  const graph = showcaseGraph(String(name), pack, examples, install);
  if (graph) p.note(graph, `${pack.showcase} ${pc.dim("· open this first")}`);
  p.note(
    [
      `${pc.dim("Workflows are JSON graphs of typed ops; ops carry the code; mods bundle both.")}`,
      `${pc.dim("$")} npx pattern ops          ${pc.dim("every op you can wire — never guess")}`,
      `${pc.dim("$")} npx pattern graph <wf>   ${pc.dim("any workflow, as a terminal graph")}`,
      "",
      `${pc.green("✦")} Coding with an agent? It reads ${pc.bold("AGENTS.md")} — ops, routes & admin pages, by recipe.`,
    ].join("\n"),
    "Good to know",
  );
  p.outro(pc.green("Done — happy building! ✦"));
}

async function runHeadless(flags: Flags): Promise<void> {
  const name = flags.name ?? "my-pattern-app";
  const pack = packOrThrow(flags.modpack ?? "studio");
  const pm = flags.pm ?? detectPm();
  // No prompt to ask — flags win, else the pack's default (studio ships locked).
  const auth = pack.auth ? (flags.auth ?? pack.auth.default) : false;
  const docs = pack.docs ? (flags.docs ?? pack.docs.default) : false;
  const examples = flags.examples ?? true;
  console.log(
    `create-pattern: scaffolding "${name}" with the "${pack.id}" modpack (${pm}${examples ? "" : ", no examples"}${auth ? ", auth on" : ""}${docs ? ", docs on" : ""})`,
  );
  await scaffold({ name, pack: pack.id, pm, install: flags.install, git: flags.git, auth, docs, examples });
  console.log(`Done. Next: cd ${name} && ${pm === "npm" ? "npm run" : pm} dev`);
  if (auth) console.log(`First boot prints a one-time admin link in the console (magic links print there too).`);
  for (const ep of [...pack.serves(examples), ...(docs ? ["/docs"] : [])]) console.log(`  serves http://localhost:3000${ep}`);
  const graph = showcaseGraph(name, pack, examples, flags.install);
  if (graph) {
    console.log(`\n${pack.showcase} (open this first):\n`);
    console.log(graph);
  }
}

async function scaffold(opts: { name: string; pack: string; pm: Pm; install: boolean; git: boolean; auth: boolean; docs: boolean; examples: boolean }): Promise<void> {
  const targetDir = resolve(process.cwd(), opts.name);
  if (existsSync(targetDir) && (await readdir(targetDir)).length > 0) {
    throw new Error(`directory "${opts.name}" already exists and is not empty`);
  }

  const spin = process.stdout.isTTY ? p.spinner() : undefined;
  spin?.start(`Unpacking the ${opts.pack} modpack`);
  await copyTemplate(opts.pack, targetDir, opts.name);
  // Strip examples BEFORE auth (so auth's /whoami route survives the strip).
  if (!opts.examples) await applyNoExamples(targetDir, opts.pack, opts.name);
  if (opts.auth) await applyAuth(targetDir, opts.pack);
  if (opts.docs) await applyDocs(targetDir);
  spin?.stop(`Modpack unpacked (${opts.pack}${opts.examples ? "" : ", no examples"}${opts.auth ? " + auth" : ""}${opts.docs ? " + docs" : ""})`);

  if (opts.git) {
    spawnSync("git", ["init", "-q"], { cwd: targetDir });
  }
  if (opts.install) {
    spin?.start(`Installing with ${opts.pm}`);
    const res = spawnSync(opts.pm, ["install"], { cwd: targetDir, stdio: spin ? "ignore" : "inherit" });
    if (res.status !== 0) spin?.stop(pc.yellow("install skipped/failed — run it manually"));
    else spin?.stop("Dependencies installed");
  }
}

function cancel(): void {
  p.cancel("Cancelled.");
  process.exit(0);
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.list) return listPacks();
  if (flags.dryRun) return previewManifest(flags);
  const interactive = process.stdout.isTTY && !flags.yes;
  try {
    if (interactive) await runInteractive(flags);
    else await runHeadless(flags);
  } catch (err) {
    console.error(pc.red(`\n✗ ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}

void main();
