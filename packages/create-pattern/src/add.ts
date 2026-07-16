/**
 * create-pattern add — grow an EXISTING project by layers.
 *
 *   npx create-pattern add billing            # or: pattern add billing
 *   npx create-pattern add chat,vectors --no-examples
 *   npx create-pattern add                    # list layers + their status
 *
 * The same layer registry compose scaffolds from, applied ADDITIVELY to a
 * project that already exists — which changes the rules of engagement:
 *
 *  - deps use the PROJECT'S @pattern-js range (read from its package.json),
 *    never this CLI's own — an 0.4 app that runs `add` gets 0.4 mods, with a
 *    version-skew warning when the CLI is from another minor;
 *  - everything is append-only: config entries insert in canonical positions
 *    (auth first, docs last), wrapper files are written only if absent, env
 *    hints only if their keys are missing, workflow seeds never overwrite;
 *  - a layer that's already there is a printed no-op, so re-running the same
 *    add is safe (and boring, which is the point).
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import pc from "picocolors";
import { LAYERS, layerOrThrow, parseWith, pickLayers, resolveLayers, type ComposeLayer, type WithToken } from "./layers.js";
import {
  ADMIN_MOD,
  DOCS_MOD,
  EMAIL_DRIVERS,
  EMAIL_MOD,
  IDENTITY_MOD,
  IDENTITY_WRAPPER_SAAS,
  MAGIC_LINK_MOD,
  OIDC_MOD,
  OIDC_WRAPPER,
  SELF_VERSION,
  TEMPLATES_DIR,
  appendEnvHint,
  emailEnvHint,
  type EmailDelivery,
} from "./shared.js";

const IDENTITY_WRAPPER_PATH = "./mods/identity.mjs";
const BILLING_WRAPPER_PATH = "./mods/billing.mjs";
const OIDC_WRAPPER_PATH = "./mods/oidc.mjs";

/** Walk up from `from` to the nearest directory holding pattern.config.json. */
export function findProjectRoot(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "pattern.config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The project's own @pattern-js range (from any installed @pattern-js dep).
 * `add` installs THE PROJECT'S generation of mods — never the CLI's.
 */
export function projectPatternRange(pkg: { dependencies?: Record<string, string> }): string | null {
  const deps = pkg.dependencies ?? {};
  const core = deps["@pattern-js/core"] ?? deps["@pattern-js/runtime-node"];
  if (core) return core;
  const any = Object.keys(deps).find((k) => k.startsWith("@pattern-js/"));
  return any ? deps[any]! : null;
}

/** Same minor? "^0.5.0" vs "0.5.1" vs "~0.5.2" all count as 0.5. */
function sameMinor(range: string, version: string): boolean {
  const m = range.match(/(\d+)\.(\d+)/);
  const v = version.match(/(\d+)\.(\d+)/);
  return Boolean(m && v && m[1] === v[1] && m[2] === v[2]);
}

type Presence = "installed" | "partial" | "available";

/** Is this layer already in the project? (config entries are the truth.) */
export function layerPresence(id: string, deps: Record<string, string>, mods: string[]): Presence {
  switch (id) {
    case "admin":
      return mods.includes(ADMIN_MOD) ? "installed" : deps[ADMIN_MOD] ? "partial" : "available";
    case "auth":
      return mods.includes(IDENTITY_MOD) || mods.includes(IDENTITY_WRAPPER_PATH) ? "installed" : deps[IDENTITY_MOD] ? "partial" : "available";
    case "email":
      return mods.includes(EMAIL_MOD) ? "installed" : deps[EMAIL_MOD] ? "partial" : "available";
    case "docs":
      return mods.includes(DOCS_MOD) ? "installed" : deps[DOCS_MOD] ? "partial" : "available";
    default: {
      const layer = layerOrThrow(id);
      const cfgHas = layer.configMods.every((m) => mods.includes(m));
      const depHas = layer.deps.every((d) => Boolean(deps[d]));
      if (cfgHas && depHas) return "installed";
      if (layer.configMods.some((m) => mods.includes(m)) || layer.deps.some((d) => Boolean(deps[d]))) return "partial";
      return "available";
    }
  }
}

interface AddFlags {
  tokens: WithToken[];
  examples: boolean;
  dryRun: boolean;
  help: boolean;
}

export function parseAddArgs(argv: string[]): AddFlags {
  const flags: AddFlags = { tokens: [], examples: true, dryRun: false, help: false };
  const positional: string[] = [];
  for (const a of argv) {
    if (a === "--no-examples") flags.examples = false;
    else if (a === "--examples") flags.examples = true;
    else if (a === "--dry-run" || a === "--dry") flags.dryRun = true;
    else if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--yes" || a === "-y") continue; // add never prompts; accepted for symmetry
    else if (a.startsWith("-")) throw new Error(`add: unknown flag "${a}" (have: --examples/--no-examples, --dry-run)`);
    else positional.push(a);
  }
  if (positional.length) flags.tokens = parseWith(positional.join(","));
  return flags;
}

/** Everything one `add` run did (also the dry-run preview + the test surface). */
export interface AddReport {
  root: string;
  added: string[];
  alreadyThere: string[];
  pulled: Array<{ id: string; by: string }>;
  depsAdded: Record<string, string>;
  configAdded: string[];
  wrappers: string[];
  workflowsSeeded: string[];
  workflowsSkipped: string[];
  envKeysHinted: string[];
  notes: string[];
  rangeWarning?: string;
}

/**
 * Apply layers to the project at `root`. Pure-ish core of `add` — computes and
 * (unless dryRun) writes; the CLI entry does the finding/printing around it.
 */
export async function applyAdd(root: string, flags: AddFlags): Promise<AddReport> {
  const pkgPath = join(root, "package.json");
  const cfgPath = join(root, "pattern.config.json");
  if (!existsSync(pkgPath)) throw new Error(`no package.json next to ${cfgPath} — is this a scaffolded Pattern project?`);
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { name?: string; dependencies?: Record<string, string> };
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as { mods: string[]; workers?: { size: number; mods?: string[] } };
  pkg.dependencies ??= {};
  cfg.mods ??= [];

  const range = projectPatternRange(pkg) ?? `^${SELF_VERSION.split(".").slice(0, 2).join(".")}.0`;
  const report: AddReport = {
    root,
    added: [],
    alreadyThere: [],
    pulled: [],
    depsAdded: {},
    configAdded: [],
    wrappers: [],
    workflowsSeeded: [],
    workflowsSkipped: [],
    envKeysHinted: [],
    notes: [],
  };
  if (!projectPatternRange(pkg)) {
    report.notes.push(`no @pattern-js dependency found — using this CLI's range (${range})`);
  } else if (!sameMinor(range, SELF_VERSION)) {
    report.rangeWarning = `this CLI is create-pattern ${SELF_VERSION} but the project runs @pattern-js ${range} — mods install at the PROJECT's range; for a same-generation CLI use: npx create-pattern@${range} add … (\`pattern add\` picks the right one automatically)`;
  }

  const answers = new Map(flags.tokens.map((t) => [t.id, t.answer] as const));
  const { layers: closure, pulled } = resolveLayers(flags.tokens.map((t) => t.id));

  // What's genuinely new vs already in place. An already-installed layer is
  // reported either way — "already installed: auth" tells the operator that
  // billing is hooking into the auth they have, not ignoring it.
  const missing: string[] = [];
  for (const id of closure) {
    if (layerPresence(id, pkg.dependencies, cfg.mods) === "installed") {
      if (answers.get(id) === undefined) {
        report.alreadyThere.push(id);
        continue;
      }
      // installed but answer-carrying (auth:oidc, email:resend): the sub-piece
      // may still be missing — handled by the layer installers below.
      missing.push(id);
    } else {
      missing.push(id);
    }
  }
  report.pulled = pulled.filter((x) => missing.includes(x.id));
  if (!missing.length) return report;

  const addDep = (name: string, r = range): void => {
    if (!pkg.dependencies![name]) {
      pkg.dependencies![name] = r;
      report.depsAdded[name] = r;
    }
  };
  const prependMod = (entry: string): void => {
    if (cfg.mods.includes(entry)) return;
    cfg.mods = [entry, ...cfg.mods];
    report.configAdded.push(entry);
  };
  const insertBeforeDocs = (entry: string): void => {
    if (cfg.mods.includes(entry)) return;
    const at = cfg.mods.indexOf(DOCS_MOD);
    cfg.mods = at === -1 ? [...cfg.mods, entry] : [...cfg.mods.slice(0, at), entry, ...cfg.mods.slice(at)];
    report.configAdded.push(entry);
  };
  const insertAfter = (anchor: string, entry: string): void => {
    if (cfg.mods.includes(entry)) return;
    const at = cfg.mods.indexOf(anchor);
    cfg.mods = at === -1 ? [...cfg.mods, entry] : [...cfg.mods.slice(0, at + 1), entry, ...cfg.mods.slice(at + 1)];
    report.configAdded.push(entry);
  };
  const writeIfAbsent = async (rel: string, content: string): Promise<boolean> => {
    const full = join(root, rel);
    if (existsSync(full)) return false;
    await mkdir(dirname(full), { recursive: true });
    if (!flags.dryRun) await writeFile(full, content);
    return true;
  };
  const envHintIfMissing = async (layerEnv: string[], hint: string | null | undefined): Promise<void> => {
    if (!hint) return;
    const envPath = join(root, ".env.example");
    const current = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
    const missingKeys = layerEnv.filter((k) => !new RegExp(`^#?\\s*${k}=`, "m").test(current));
    if (!layerEnv.length || missingKeys.length) {
      if (!flags.dryRun) await appendEnvHint(root, hint);
      report.envKeysHinted.push(...(missingKeys.length ? missingKeys : layerEnv));
    }
  };
  const seedWorkflows = async (layer: ComposeLayer): Promise<void> => {
    const groups = [
      ...(layer.platformWorkflows ? [layer.platformWorkflows] : []),
      ...(flags.examples && layer.examples ? [layer.examples] : []),
    ];
    if (!groups.length) return;
    if (!flags.dryRun) await mkdir(join(root, "workflows"), { recursive: true });
    for (const g of groups) {
      for (const f of g.workflows) {
        const dst = join(root, "workflows", f);
        if (existsSync(dst)) {
          report.workflowsSkipped.push(f);
        } else {
          if (!flags.dryRun) await cp(join(TEMPLATES_DIR, g.template, "workflows", f), dst);
          report.workflowsSeeded.push(f);
        }
      }
    }
  };

  const wantsBilling = missing.includes("billing");
  const agentsSections: string[] = [];

  for (const id of missing) {
    const layer = layerOrThrow(id);
    let did = false;

    switch (id) {
      case "admin": {
        addDep(ADMIN_MOD);
        prependMod(ADMIN_MOD);
        did = true;
        break;
      }
      case "auth": {
        const answer = answers.get("auth") ?? "magic-link";
        const magicLink = answer !== "oidc";
        const oidc = answer !== "magic-link";
        const installed = layerPresence("auth", pkg.dependencies, cfg.mods) === "installed";
        if (!installed) {
          addDep(IDENTITY_MOD);
          if (magicLink) addDep(MAGIC_LINK_MOD);
          let identityEntry = IDENTITY_MOD;
          if (wantsBilling) {
            if (await writeIfAbsent("mods/identity.mjs", IDENTITY_WRAPPER_SAAS)) report.wrappers.push("mods/identity.mjs");
            identityEntry = IDENTITY_WRAPPER_PATH;
          }
          if (magicLink) prependMod(MAGIC_LINK_MOD);
          prependMod(identityEntry); // prepend order: identity ends up first
          did = true;
        }
        if (oidc && !cfg.mods.includes(OIDC_WRAPPER_PATH)) {
          addDep(OIDC_MOD);
          if (await writeIfAbsent("mods/oidc.mjs", OIDC_WRAPPER)) report.wrappers.push("mods/oidc.mjs");
          insertAfter(cfg.mods.includes(MAGIC_LINK_MOD) ? MAGIC_LINK_MOD : cfg.mods.includes(IDENTITY_WRAPPER_PATH) ? IDENTITY_WRAPPER_PATH : IDENTITY_MOD, OIDC_WRAPPER_PATH);
          await envHintIfMissing(["GOOGLE_CLIENT_SECRET"], "# OIDC (mods/oidc.mjs): the client secret lives here or in the vault (admin → System → Secrets)\n# GOOGLE_CLIENT_SECRET=\n");
          did = true;
        }
        break;
      }
      case "email": {
        const delivery = (answers.get("email") ?? "console") as EmailDelivery;
        if (!cfg.mods.includes(EMAIL_MOD)) {
          addDep(EMAIL_MOD);
          insertBeforeDocs(EMAIL_MOD);
          did = true;
        }
        const driver = EMAIL_DRIVERS[delivery];
        if (driver && !cfg.mods.includes(driver)) {
          addDep(driver);
          insertAfter(EMAIL_MOD, driver);
          await envHintIfMissing(delivery === "resend" ? ["RESEND_API_KEY"] : ["SMTP_PASSWORD"], emailEnvHint(delivery));
          did = true;
        }
        break;
      }
      case "docs": {
        addDep(DOCS_MOD);
        if (!cfg.mods.includes(DOCS_MOD)) {
          cfg.mods = [...cfg.mods, DOCS_MOD];
          report.configAdded.push(DOCS_MOD);
        }
        did = true;
        break;
      }
      default: {
        for (const d of layer.deps) addDep(d);
        for (const entry of layer.configMods) {
          if (entry === BILLING_WRAPPER_PATH) {
            if (await writeIfAbsent("mods/billing.mjs", await readFile(join(TEMPLATES_DIR, "saas-starter", "mods", "billing.mjs"), "utf8"))) {
              report.wrappers.push("mods/billing.mjs");
            }
          }
          insertBeforeDocs(entry);
        }
        if (cfg.workers) {
          for (const w of layer.workerMods) {
            if (!(cfg.workers.mods ?? []).includes(w)) cfg.workers.mods = [...(cfg.workers.mods ?? []), w];
          }
        }
        await envHintIfMissing(layer.env, layer.envHint);
        did = true;
      }
    }

    if (did) {
      report.added.push(id);
      await seedWorkflows(layer);
      agentsSections.push(layer.agentsMd);
    } else if (!report.alreadyThere.includes(id)) {
      // Installed, and the sub-answer asked for nothing new (auth:magic-link
      // on an authed project, email:console on a mailing one).
      report.alreadyThere.push(id);
    }
  }

  // Billing's entitlement bridge needs the roles→scopes map on identity. A
  // bare identity entry is upgraded to the app-local wrapper (append-only in
  // spirit: the wrapper file is new, the entry just points at it); a custom
  // wrapper is YOURS — we leave it alone and say what to add.
  if (wantsBilling && report.added.includes("billing")) {
    if (cfg.mods.includes(IDENTITY_MOD)) {
      if (await writeIfAbsent("mods/identity.mjs", IDENTITY_WRAPPER_SAAS)) report.wrappers.push("mods/identity.mjs");
      cfg.mods = cfg.mods.map((m) => (m === IDENTITY_MOD ? IDENTITY_WRAPPER_PATH : m));
      report.notes.push("identity's config entry now points at mods/identity.mjs — the roles→scopes map (member → pro) that billing's entitlement bridge gates on");
    } else if (cfg.mods.includes(IDENTITY_WRAPPER_PATH) && !report.wrappers.includes("mods/identity.mjs")) {
      report.notes.push('billing grants the "member" role — make sure mods/identity.mjs maps it to a scope, e.g. roles: { member: ["pro"] }');
    }
  }
  if (report.added.includes("ai")) {
    report.notes.push("create model aliases in admin → Settings → AI Providers (each key is an env/vault reference — never a value in config)");
  }
  if (report.added.includes("vault") && !existsSync(join(root, ".env"))) {
    report.notes.push("the vault needs PATTERN_VAULT_KEY in .env (generate one: openssl rand -base64 32)");
  }

  // AGENTS.md: each layer documents itself, appended under the composed-layers
  // section (created if the project predates compose).
  const agentsPath = join(root, "AGENTS.md");
  if (agentsSections.length && existsSync(agentsPath) && !flags.dryRun) {
    const current = await readFile(agentsPath, "utf8");
    const header = "## Composed layers";
    const intro = current.includes(header)
      ? ""
      : `\n${header}\n\nLayers added with \`create-pattern add\`. What each one gives you:\n`;
    await writeFile(agentsPath, current.replace(/\n*$/, "\n") + intro + "\n" + agentsSections.join("\n\n") + "\n");
  }

  if (!flags.dryRun) {
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  }
  return report;
}

/** The no-args surface: every layer, with its status in THIS project. */
async function listStatus(root: string): Promise<void> {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  const cfg = JSON.parse(await readFile(join(root, "pattern.config.json"), "utf8")) as { mods: string[] };
  console.log(`\n${pc.bold("layers")} ${pc.dim(`(${root})`)}\n`);
  for (const layer of LAYERS.filter((l) => !l.hidden)) {
    const presence = layerPresence(layer.id, pkg.dependencies ?? {}, cfg.mods ?? []);
    const badge =
      presence === "installed" ? pc.green("● installed") : presence === "partial" ? pc.yellow("◐ partial  ") : pc.dim("○ available");
    console.log(`  ${badge}  ${pc.bold(layer.id.padEnd(8))} ${pc.dim(layer.hint)}`);
  }
  console.log(`\n  ${pc.dim("grow it:")} npx create-pattern add ${pc.bold("<layer>")}${pc.dim(",<layer>…  (or: pattern add <layer>)")}\n`);
}

function printReport(r: AddReport, dryRun: boolean): void {
  const arrow = pc.cyan("→");
  if (r.rangeWarning) console.log(`\n${pc.yellow("⚠")} ${r.rangeWarning}`);
  for (const n of r.notes.filter((n) => n.startsWith("no @pattern-js"))) console.log(`${pc.yellow("⚠")} ${n}`);
  if (r.alreadyThere.length) console.log(`\n  ${pc.dim(`already installed: ${r.alreadyThere.join(", ")}`)}`);
  if (!r.added.length) {
    console.log(`  ${pc.dim("nothing to do.")}\n`);
    return;
  }
  const pulls = r.pulled.length ? pc.dim(`  (${r.pulled.map((p) => `${p.by} pulls in ${p.id}`).join("; ")})`) : "";
  console.log(`\n  ${pc.green("+")} ${pc.bold(r.added.join(", "))}${pulls}`);
  if (Object.keys(r.depsAdded).length) {
    console.log(`  ${arrow} dependencies: ${Object.entries(r.depsAdded).map(([k, v]) => `${k}@${pc.dim(v)}`).join(", ")}`);
  }
  if (r.configAdded.length) console.log(`  ${arrow} pattern.config.json: + ${r.configAdded.join(", ")}`);
  if (r.wrappers.length) console.log(`  ${arrow} wrappers: ${r.wrappers.join(", ")} ${pc.dim("(yours to edit)")}`);
  if (r.workflowsSeeded.length) console.log(`  ${arrow} workflows: + ${r.workflowsSeeded.join(", ")}`);
  if (r.workflowsSkipped.length) console.log(`  ${arrow} ${pc.dim(`kept your existing: ${r.workflowsSkipped.join(", ")}`)}`);
  if (r.envKeysHinted.length) console.log(`  ${arrow} .env.example: ${r.envKeysHinted.join(", ")}`);
  for (const n of r.notes.filter((n) => !n.startsWith("no @pattern-js"))) console.log(`  ${arrow} ${n}`);
  if (dryRun) {
    console.log(`\n  ${pc.dim("dry run — nothing written. Drop --dry-run to apply.")}\n`);
    return;
  }
  if (Object.keys(r.depsAdded).length) console.log(`\n  ${pc.bold("next:")} npm install ${pc.dim("(then npm run dev)")}`);
  if (r.added.includes("billing")) {
    console.log(`  ${arrow} connect Stripe: keys in .env, the account in admin → System → Billing,`);
    console.log(`    ${pc.dim("then")} stripe listen --forward-to localhost:3000/billing/webhook/stripe`);
  }
  console.log("");
}

function addUsage(): void {
  const visible = LAYERS.filter((l) => !l.hidden).map((l) => l.id).join(", ");
  console.log(`
${pc.bold("create-pattern add")} — grow an existing project by layers

  npx create-pattern add <layer>[,<layer>…]   ${pc.dim("inside a scaffolded project")}
  npx create-pattern add                      ${pc.dim("list layers + their status here")}

layers: ${visible}
  auth takes :magic-link | :oidc | :both      email takes :console | :resend | :smtp

flags: --no-examples ${pc.dim("(skip demo workflows)")} · --dry-run ${pc.dim("(print, write nothing)")}
`);
}

/** The `create-pattern add …` entry (also what `pattern add` delegates to). */
export async function runAdd(argv: string[], cwd = process.cwd()): Promise<void> {
  const flags = parseAddArgs(argv);
  if (flags.help) return addUsage();
  const root = findProjectRoot(cwd);
  if (!root) {
    throw new Error(
      "add grows an EXISTING project, and there's no pattern.config.json here (or above) — run it inside a scaffolded app, or create one first: npm create pattern@latest",
    );
  }
  if (!flags.tokens.length) return listStatus(root);
  const report = await applyAdd(root, flags);
  printReport(report, flags.dryRun);
}
