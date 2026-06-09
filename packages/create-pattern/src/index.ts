#!/usr/bin/env node
/**
 * create-pattern — the Pattern project scaffolder (§15).
 *
 *   npm create pattern@latest
 *   pnpm create pattern my-app --template agent-sse-tts
 *
 * Interactive by default (banner → template → package manager → install/git),
 * with graceful non-TTY/CI degradation: everything is flag-driven, no prompts,
 * no animation, fully scriptable. Dev-time-only deps, so it can be rich.
 */

import { cp, readdir, readFile, rename, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates", import.meta.url));

interface Template {
  id: string;
  label: string;
  hint: string;
}
const TEMPLATES: Template[] = [
  { id: "hello-workflow", label: "Hello workflow", hint: "the smallest possible Pattern program" },
  { id: "http-api", label: "HTTP API", hint: "declarative routes, JSON workflows, an app-local mod" },
];

const PMS = ["npm", "pnpm", "yarn", "bun"] as const;
type Pm = (typeof PMS)[number];

interface Flags {
  name?: string;
  template?: string;
  pm?: Pm;
  install: boolean;
  git: boolean;
  yes: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { install: true, git: true, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--template" || a === "-t") flags.template = argv[++i];
    else if (a === "--pm") flags.pm = argv[++i] as Pm;
    else if (a === "--no-install") flags.install = false;
    else if (a === "--no-git") flags.git = false;
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (!a.startsWith("-") && !flags.name) flags.name = a;
  }
  return flags;
}

function banner(): void {
  const lines = ["┌─┐┌─┐┌┬┐┌┬┐┌─┐┬─┐┌┐┌", "├─┘├─┤ │  │ ├┤ ├┬┘│││", "┴  ┴ ┴ ┴  ┴ └─┘┴└─┘└┘"];
  const colors = [pc.magenta, pc.magentaBright ?? pc.magenta, pc.cyan];
  console.log("");
  lines.forEach((l, i) => console.log("  " + (colors[i] ?? pc.cyan)(l)));
  console.log("  " + pc.dim("a workflow execution engine\n"));
}

function detectPm(): Pm {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("yarn")) return "yarn";
  if (ua.startsWith("bun")) return "bun";
  return "npm";
}

async function copyTemplate(templateId: string, targetDir: string, name: string): Promise<void> {
  const src = join(TEMPLATES_DIR, templateId);
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

  const template =
    flags.template ??
    (await p.select({
      message: "Pick a template",
      options: TEMPLATES.map((t) => ({ value: t.id, label: t.label, hint: t.hint })),
    }))!;
  if (p.isCancel(template)) return cancel();

  const pm =
    flags.pm ??
    (await p.select({
      message: "Package manager",
      initialValue: detectPm(),
      options: PMS.map((m) => ({ value: m, label: m })),
    }))!;
  if (p.isCancel(pm)) return cancel();

  const install = flags.yes ? flags.install : !p.isCancel(await p.confirm({ message: `Install deps with ${pm}?`, initialValue: flags.install }));

  await scaffold({ name: String(name), template: String(template), pm: pm as Pm, install, git: flags.git });

  // Teach-as-you-go next steps.
  p.note(
    [
      `${pc.dim("$")} cd ${name}`,
      install ? "" : `${pc.dim("$")} ${pm} install`,
      `${pc.dim("$")} ${pm === "npm" ? "npm run" : pm} dev`,
      "",
      pc.dim("A workflow is JSON: a graph of typed ops + edges. Ops carry the code;"),
      pc.dim("the engine runs the subgraph reachable from a trigger. Inspect any graph:"),
      `${pc.dim("$")} npx pattern graph workflow.json`,
    ]
      .filter((l) => l !== "")
      .join("\n"),
    "Next steps",
  );
  p.outro(pc.green("Done — happy building! ✦"));
}

async function runHeadless(flags: Flags): Promise<void> {
  const name = flags.name ?? "my-pattern-app";
  const template = flags.template ?? "hello-workflow";
  const pm = flags.pm ?? detectPm();
  console.log(`create-pattern: scaffolding "${name}" from "${template}" (${pm})`);
  await scaffold({ name, template, pm, install: flags.install, git: flags.git });
  console.log(`Done. Next: cd ${name} && ${pm === "npm" ? "npm run" : pm} dev`);
}

async function scaffold(opts: { name: string; template: string; pm: Pm; install: boolean; git: boolean }): Promise<void> {
  if (!TEMPLATES.some((t) => t.id === opts.template)) {
    throw new Error(`unknown template "${opts.template}" (have: ${TEMPLATES.map((t) => t.id).join(", ")})`);
  }
  const targetDir = resolve(process.cwd(), opts.name);
  if (existsSync(targetDir) && (await readdir(targetDir)).length > 0) {
    throw new Error(`directory "${opts.name}" already exists and is not empty`);
  }

  const spin = process.stdout.isTTY ? p.spinner() : undefined;
  spin?.start("Copying template");
  await copyTemplate(opts.template, targetDir, opts.name);
  spin?.stop("Template copied");

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
