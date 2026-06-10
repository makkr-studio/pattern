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

interface Modpack {
  id: string;
  label: string;
  /** One-liner shown as the select hint. */
  hint: string;
  /** The mods the pack wires up (shown in the pack card). */
  mods: string[];
  /** "What's in the box" bullet lines. */
  contents: string[];
  /** Tailored next steps once scaffolded. */
  next: (name: string, runCmd: string, installed: boolean, installLine: string) => string[];
}

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
    next: (name, runCmd, installed, installLine) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        `${pc.cyan("→")} open ${pc.bold("http://localhost:3000/admin")}`,
        `${pc.cyan("→")} curl localhost:3000/hello/world`,
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
    next: (name, runCmd, installed, installLine) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        `${pc.cyan("→")} curl localhost:3000/hello/world`,
        `${pc.cyan("→")} curl -XPOST localhost:3000/echo -H 'content-type: application/json' -d '{"message":"hi"}'`,
      ].filter((l) => l !== ""),
  },
  {
    id: "blank",
    label: "Blank slate",
    hint: "only the engine — one workflow, run programmatically",
    mods: [],
    contents: ["the smallest possible Pattern program: one JSON workflow, one `engine.run()`"],
    next: (name, runCmd, installed, installLine) =>
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
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { install: true, git: true, yes: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--modpack" || a === "-m" || a === "--template" || a === "-t") flags.modpack = argv[++i];
    else if (a === "--pm") flags.pm = argv[++i] as Pm;
    else if (a === "--no-install") flags.install = false;
    else if (a === "--no-git") flags.git = false;
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

function packCard(pack: Modpack): string {
  const mods = pack.mods.length ? pack.mods.map((m) => pc.magenta(m)).join(pc.dim(" + ")) : pc.dim("none — just the engine");
  return [
    `${pc.dim("mods:")} ${mods}`,
    ...pack.contents.map((line) => `${pc.cyan("◆")} ${line}`),
    `${pc.green("✦")} AGENTS.md + CLAUDE.md included — your coding agent knows this project`,
  ].join("\n");
}

function listPacks(): void {
  console.log(`\n${pc.bold("Modpacks")} — curated mod sets per use case:\n`);
  for (const pack of MODPACKS) {
    console.log(`  ${pc.cyan(pack.id.padEnd(10))}${pack.label} — ${pc.dim(pack.hint)}`);
  }
  console.log(`\n  ${pc.dim("npm create pattern@latest my-app -- --modpack <id>")}\n`);
}

async function copyTemplate(packId: string, targetDir: string, name: string): Promise<void> {
  const src = join(TEMPLATES_DIR, packId);
  await cp(src, targetDir, { recursive: true });
  // _gitignore → .gitignore (npm strips .gitignore from published packages).
  if (existsSync(join(targetDir, "_gitignore"))) {
    await rename(join(targetDir, "_gitignore"), join(targetDir, ".gitignore"));
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

  // The pack card: what this modpack actually wires up.
  p.note(packCard(pack), `${pack.label} modpack`);

  const pm =
    flags.pm ??
    (await p.select({
      message: "Package manager",
      initialValue: detectPm(),
      options: PMS.map((m) => ({ value: m, label: m })),
    }))!;
  if (p.isCancel(pm)) return cancel();

  const install = flags.yes ? flags.install : !p.isCancel(await p.confirm({ message: `Install deps with ${pm}?`, initialValue: flags.install }));

  await scaffold({ name: String(name), pack: pack.id, pm: pm as Pm, install, git: flags.git });

  const runCmd = pm === "npm" ? "npm run" : String(pm);
  p.note(pack.next(String(name), runCmd, install, `${pc.dim("$")} ${pm} install`).join("\n"), "Next steps");
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
  console.log(`create-pattern: scaffolding "${name}" with the "${pack.id}" modpack (${pm})`);
  await scaffold({ name, pack: pack.id, pm, install: flags.install, git: flags.git });
  console.log(`Done. Next: cd ${name} && ${pm === "npm" ? "npm run" : pm} dev`);
  if (pack.id === "studio") console.log(`Admin: http://localhost:3000/admin`);
}

async function scaffold(opts: { name: string; pack: string; pm: Pm; install: boolean; git: boolean }): Promise<void> {
  const targetDir = resolve(process.cwd(), opts.name);
  if (existsSync(targetDir) && (await readdir(targetDir)).length > 0) {
    throw new Error(`directory "${opts.name}" already exists and is not empty`);
  }

  const spin = process.stdout.isTTY ? p.spinner() : undefined;
  spin?.start(`Unpacking the ${opts.pack} modpack`);
  await copyTemplate(opts.pack, targetDir, opts.name);
  spin?.stop(`Modpack unpacked (${opts.pack})`);

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
