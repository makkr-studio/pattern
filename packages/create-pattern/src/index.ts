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

import { cp, readdir, readFile, rename, writeFile, stat } from "node:fs/promises";
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
}

interface Modpack {
  id: string;
  label: string;
  /** One-liner shown as the select hint. */
  hint: string;
  /** The mods the pack wires up (shown in the pack card). */
  mods: string[];
  /** "What's in the box" bullet lines. */
  contents: string[];
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

const MODPACKS: Modpack[] = [
  {
    id: "studio",
    label: "Studio",
    hint: "engine + visual admin — editor, versions, runs, traces (recommended)",
    mods: ["@pattern/mod-admin", "./mods/quotes.mjs (app-local)"],
    contents: [
      "the admin SPA at /admin — edit, version, deploy, replay workflows",
      "3 editable example workflows seeded on first boot",
      "an app-local mod adding ops AND an admin page (the extension surface, live)",
    ],
    // Secure-by-default is the philosophy — the flagship pack ships locked.
    auth: { default: true },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        ...(auth
          ? [
              `${pc.cyan("→")} first boot prints a ${pc.bold("one-time admin link")} in the console — click it, you're the owner`,
              `${pc.cyan("→")} then ${pc.bold("http://localhost:3000/admin")} ${pc.dim("(sign-in links print to the console too)")}`,
            ]
          : [`${pc.cyan("→")} open ${pc.bold("http://localhost:3000/admin")}`]),
        `${pc.cyan("→")} curl localhost:3000/hello/world`,
      ].filter((l) => l !== ""),
  },
  {
    id: "agent-chat",
    label: "Agent chat",
    hint: "a complete AI-agent chat — tools as workflows, HITL approvals, the works",
    mods: [
      "@pattern/mod-chat",
      "@pattern/mod-agents(-openai)",
      "@pattern/mod-store",
      "@pattern/mod-vault",
      "@pattern/mod-admin",
    ],
    contents: [
      "a product chat app at /chat — streaming transcript, tool activity, image input",
      "the turn pipeline is a WORKFLOW: fork it in the admin, add guardrails, swap models",
      "two example tools (get_time, get_weather) — every call is a linked sub-run",
      "vault for the OpenAI API key (encrypted, masked out of run samples)",
    ],
    auth: { default: true },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        `${pc.dim("$")} cp .env.example .env ${pc.dim("— set OPENAI_API_KEY there (or use the admin Secrets page later)")}`,
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        `${pc.cyan("→")} chat at ${pc.bold("http://localhost:3000/chat")}`,
        ...(auth
          ? [`${pc.cyan("→")} the admin (the kitchen) is locked — first boot prints a one-time owner link`]
          : [`${pc.cyan("→")} the admin (the kitchen) at ${pc.bold("http://localhost:3000/admin")}`]),
        `${pc.cyan("→")} ask it ${pc.bold('"what time is it?"')} — watch the tool bud on the strand`,
      ].filter((l) => l !== ""),
  },
  {
    id: "headless",
    label: "Headless backend",
    hint: "declarative HTTP API — routes as JSON, an app-local mod, no UI",
    mods: ["./mods/uppercase.mjs (app-local)"],
    contents: [
      "4 routes declared inside workflow JSON — no route table",
      "JSON-Schema request validation + env-interpolated config",
      "an app-local mod contributing the `app.shout` op",
    ],
    // APIs often start behind a gateway — opt in with one keystroke.
    auth: { default: false },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        `${pc.cyan("→")} curl localhost:3000/hello/world`,
        `${pc.cyan("→")} curl -XPOST localhost:3000/echo -H 'content-type: application/json' -d '{"message":"hi"}'`,
        ...(auth
          ? [
              `${pc.cyan("→")} curl localhost:3000/whoami ${pc.dim("— 401 until you log in (first boot prints a one-time link)")}`,
            ]
          : []),
      ].filter((l) => l !== ""),
  },
  {
    id: "blank",
    label: "Blank slate",
    hint: "only the engine — one workflow, run programmatically",
    mods: [],
    contents: ["the smallest possible Pattern program: one JSON workflow, one `engine.run()`"],
    next: ({ name, runCmd, installed, installLine }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        `${pc.dim("$")} ${runCmd} dev`,
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
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { install: true, git: true, yes: false, list: false };
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
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--list" || a === "-l") flags.list = true;
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

function packCard(pack: Modpack, auth: boolean, docs: boolean): string {
  const modList = [...(auth ? AUTH_MODS : []), ...pack.mods, ...(docs ? [DOCS_MOD] : [])];
  const mods = modList.length ? modList.map((m) => pc.magenta(m)).join(pc.dim(" + ")) : pc.dim("none — just the engine");
  const authLines = auth
    ? [
        `${pc.cyan("◆")} authentication: magic-link login, users & sessions${pack.id === "studio" ? ", the admin locked behind it" : ""}`,
        `${pc.cyan("◆")} first boot prints a one-time link — the first account becomes admin`,
      ]
    : [];
  const docsLines = docs
    ? [`${pc.cyan("◆")} docs at /docs: the Pattern handbook + a live op reference — every mod documents itself`]
    : [];
  return [
    `${pc.dim("mods:")} ${mods}`,
    ...pack.contents.map((line) => `${pc.cyan("◆")} ${line}`),
    ...authLines,
    ...docsLines,
    `${pc.green("✦")} AGENTS.md + CLAUDE.md included — your coding agent knows this project`,
  ].join("\n");
}

function listPacks(): void {
  console.log(`\n${pc.bold("Modpacks")} — curated mod sets per use case:\n`);
  for (const pack of MODPACKS) {
    const authNote = pack.auth ? pc.dim(`  (auth: ${pack.auth.default ? "on" : "off"}, docs: ${pack.docs?.default ? "on" : "off"} by default)`) : "";
    console.log(`  ${pc.cyan(pack.id.padEnd(10))}${pack.label} — ${pc.dim(pack.hint)}${authNote}`);
  }
  console.log(`\n  ${pc.dim("npm create pattern@latest my-app -- --modpack <id> [--auth|--no-auth] [--docs|--no-docs]")}\n`);
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

  const packId =
    flags.modpack ??
    (await p.select({
      message: "Pick a modpack — a curated set of mods for your use case",
      options: MODPACKS.map((t) => ({ value: t.id, label: t.label, hint: t.hint })),
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

  // The pack card: what this modpack actually wires up.
  p.note(packCard(pack, auth, docs), `${pack.label} modpack`);

  const pm =
    flags.pm ??
    (await p.select({
      message: "Package manager",
      initialValue: detectPm(),
      options: PMS.map((m) => ({ value: m, label: m })),
    }))!;
  if (p.isCancel(pm)) return cancel();

  const install = flags.yes ? flags.install : !p.isCancel(await p.confirm({ message: `Install deps with ${pm}?`, initialValue: flags.install }));

  await scaffold({ name: String(name), pack: pack.id, pm: pm as Pm, install, git: flags.git, auth, docs });

  const runCmd = pm === "npm" ? "npm run" : String(pm);
  p.note(
    [
      ...pack.next({ name: String(name), runCmd, installed: install, installLine: `${pc.dim("$")} ${pm} install`, auth }),
      ...(docs ? [`${pc.cyan("→")} docs: ${pc.bold("http://localhost:3000/docs")} ${pc.dim("(public — DOCS_REQUIRE_AUTH gates it)")}`] : []),
    ].join("\n"),
    "Next steps",
  );
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
  console.log(
    `create-pattern: scaffolding "${name}" with the "${pack.id}" modpack (${pm}${auth ? ", auth on" : ""}${docs ? ", docs on" : ""})`,
  );
  await scaffold({ name, pack: pack.id, pm, install: flags.install, git: flags.git, auth, docs });
  console.log(`Done. Next: cd ${name} && ${pm === "npm" ? "npm run" : pm} dev`);
  if (auth) console.log(`First boot prints a one-time admin link in the console (magic links print there too).`);
  if (pack.id === "studio") console.log(`Admin: http://localhost:3000/admin`);
  if (docs) console.log(`Docs: http://localhost:3000/docs`);
}

async function scaffold(opts: { name: string; pack: string; pm: Pm; install: boolean; git: boolean; auth: boolean; docs: boolean }): Promise<void> {
  const targetDir = resolve(process.cwd(), opts.name);
  if (existsSync(targetDir) && (await readdir(targetDir)).length > 0) {
    throw new Error(`directory "${opts.name}" already exists and is not empty`);
  }

  const spin = process.stdout.isTTY ? p.spinner() : undefined;
  spin?.start(`Unpacking the ${opts.pack} modpack`);
  await copyTemplate(opts.pack, targetDir, opts.name);
  if (opts.auth) await applyAuth(targetDir, opts.pack);
  if (opts.docs) await applyDocs(targetDir);
  spin?.stop(`Modpack unpacked (${opts.pack}${opts.auth ? " + auth" : ""}${opts.docs ? " + docs" : ""})`);

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
