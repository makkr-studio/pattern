/**
 * `create-pattern add` — grow an existing project by layers. Nets:
 *
 *  1. Artifacts — scaffold a pack with the BUILT CLI, run `add` in it, and
 *     assert the append-only contract: the PROJECT's dep range (never the
 *     CLI's), canonical config positions, absent-only wrappers, first-writer
 *     workflow seeds, env hints only for missing keys.
 *  2. Idempotence — the same add twice is byte-identical the second time.
 *  3. Boot — a grown project still boots the loadMods way.
 *
 * Plus the `pattern add` delegator's pure planning (runtime-node).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Engine, type PatternMod } from "@pattern-js/core";
import { storeMod } from "@pattern-js/mod-store";
import { vaultMod } from "@pattern-js/mod-vault";
import { agentsMod } from "@pattern-js/mod-agents";
import { aiMod } from "@pattern-js/mod-ai";
import { adminMod } from "@pattern-js/mod-admin";
import { chatMod } from "@pattern-js/mod-chat";
import { emailMod } from "@pattern-js/mod-email";
import { identityMod } from "@pattern-js/mod-identity";
import { magicLinkMod } from "@pattern-js/mod-auth-magic-link";
import { billingMod } from "@pattern-js/mod-billing";
import { stripeBillingMod } from "@pattern-js/mod-billing-stripe";
import { docsMod } from "@pattern-js/mod-docs";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const TEMPLATES = fileURLToPath(new URL("../templates", import.meta.url));
const SELF = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version: string };
const RANGE = `^${SELF.version.split(".").slice(0, 2).join(".")}.0`;

const cwd = mkdtempSync(join(tmpdir(), "create-pattern-add-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

function run(args: string[], dir: string) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8" });
  return { status: res.status, out: res.stdout + res.stderr };
}

function scaffold(name: string, ...flags: string[]): string {
  const res = spawnSync(process.execPath, [CLI, name, "--yes", "--no-install", "--no-git", ...flags], { cwd, encoding: "utf8" });
  expect(res.status, res.stderr).toBe(0);
  return join(cwd, name);
}

const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");
const json = (dir: string, f: string) => JSON.parse(read(dir, f)) as Record<string, any>;

const FACTORIES: Record<string, () => PatternMod> = {
  "@pattern-js/mod-store": () => storeMod({ storage: "memory" }),
  "@pattern-js/mod-vault": () => vaultMod({ storage: "memory", masterKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }),
  "@pattern-js/mod-agents": () => agentsMod(),
  "@pattern-js/mod-ai": () => aiMod(),
  "@pattern-js/mod-admin": () => adminMod(),
  "@pattern-js/mod-chat": () => chatMod(),
  "@pattern-js/mod-email": () => emailMod(),
  "@pattern-js/mod-auth-magic-link": () => magicLinkMod(),
  "@pattern-js/mod-identity": () => identityMod({ storage: "memory" }),
  "@pattern-js/mod-billing-stripe": () => stripeBillingMod(),
  "@pattern-js/mod-docs": () => docsMod(),
  "./mods/identity.mjs": () => identityMod({ storage: "memory", roles: { admin: ["admin"], member: ["pro"] } }),
  "./mods/billing.mjs": () => billingMod({ entitlement: { role: "member" } }),
};

async function boot(dir: string): Promise<Engine> {
  const cfg = json(dir, "pattern.config.json") as { mods: string[] };
  const base = cfg.mods.includes("@pattern-js/mod-admin") ? "studio" : "headless";
  const engine = new Engine();
  for (const entry of cfg.mods) {
    const make = FACTORIES[entry];
    const mod = make ? make() : ((await import(pathToFileURL(join(TEMPLATES, base, entry)).href)).default as PatternMod);
    await engine.useAsync(mod, { deferReady: true, deferWorkflows: true });
  }
  await engine.flushDeferredWorkflows();
  const wfDir = join(dir, "workflows");
  if (existsSync(wfDir)) {
    for (const f of readdirSync(wfDir).filter((x) => x.endsWith(".json"))) {
      engine.registerWorkflow(await engine.resolveWorkflowDoc(JSON.parse(read(dir, `workflows/${f}`))));
    }
  }
  return engine;
}

describe("create-pattern add", () => {
  it("adds billing to an authed studio project — project range, canonical order, bridge, boots", async () => {
    const dir = scaffold("grown", "--modpack", "studio", "--auth", "--docs", "--email", "console");
    // Prove the range comes from the PROJECT: age it to a fake generation.
    const pkg = json(dir, "package.json");
    for (const k of Object.keys(pkg.dependencies)) if (k.startsWith("@pattern-js/")) pkg.dependencies[k] = "^9.9.0";
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

    const res = run(["add", "billing"], dir);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("billing pulls in email");
    expect(res.out).toContain("^9.9.0"); // the skew warning names the project's range
    expect(res.out).toContain("already installed: auth");

    const grown = json(dir, "package.json").dependencies as Record<string, string>;
    for (const name of ["@pattern-js/mod-billing", "@pattern-js/mod-billing-stripe", "@pattern-js/mod-email", "@pattern-js/mod-store"]) {
      expect(grown[name], name).toBe("^9.9.0"); // NEVER the CLI's own range
    }

    const mods = json(dir, "pattern.config.json").mods as string[];
    // The bare identity entry was upgraded to the roles wrapper (the bridge),
    // additions land before docs, docs stays last.
    expect(mods).not.toContain("@pattern-js/mod-identity");
    expect(mods).toContain("./mods/identity.mjs");
    expect(mods.indexOf("./mods/billing.mjs")).toBeLessThan(mods.indexOf("@pattern-js/mod-docs"));
    expect(mods.at(-1)).toBe("@pattern-js/mod-docs");
    expect(mods.indexOf("@pattern-js/mod-billing-stripe")).toBe(mods.indexOf("./mods/billing.mjs") + 1);
    expect(read(dir, "mods/identity.mjs")).toContain('member: ["pro"]');
    // workers.mods (studio has a pool) gained the offloadable store, kept quotes.
    const workers = json(dir, "pattern.config.json").workers as { mods: string[] };
    expect(workers.mods).toContain("@pattern-js/mod-store");

    expect(read(dir, ".env.example")).toContain("STRIPE_API_KEY");
    expect(read(dir, "AGENTS.md")).toContain("## Composed layers");
    expect(read(dir, "AGENTS.md")).toContain("entitlement bridge");
    for (const f of ["checkout.json", "portal.json", "pro.json", "landing.json"]) {
      expect(existsSync(join(dir, "workflows", f)), f).toBe(true);
    }
    // Seeds substitute the PROJECT's name (add runs long after copyTemplate's
    // placeholder pass — a literal {{name}} must never reach the page).
    const landing = read(dir, "workflows/landing.json");
    expect(landing).toContain("<title>grown</title>");
    expect(landing).not.toContain("{{name}}");

    // Restore a real range so the boot uses actual workspace mods, then boot.
    const pkg2 = json(dir, "package.json");
    for (const k of Object.keys(pkg2.dependencies)) if (k.startsWith("@pattern-js/")) pkg2.dependencies[k] = RANGE;
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg2, null, 2) + "\n");
    const engine = await boot(dir);
    expect(engine.workflows.get("billing-checkout")).toBeDefined();
  });

  it("re-running the same add is a byte-identical no-op", () => {
    const dir = scaffold("idem", "--modpack", "studio", "--auth", "--docs", "--email", "console");
    expect(run(["add", "billing"], dir).status).toBe(0);
    const before = ["package.json", "pattern.config.json", ".env.example", "AGENTS.md", "mods/identity.mjs", "mods/billing.mjs"].map((f) => read(dir, f));
    const res = run(["add", "billing"], dir);
    expect(res.status).toBe(0);
    expect(res.out).toMatch(/already installed:.*billing/);
    expect(res.out).toContain("nothing to do");
    const after = ["package.json", "pattern.config.json", ".env.example", "AGENTS.md", "mods/identity.mjs", "mods/billing.mjs"].map((f) => read(dir, f));
    expect(after).toEqual(before);
  });

  it("adds chat to a headless project — narrated pull chain, boots", async () => {
    const dir = scaffold("grown-hl", "--modpack", "headless", "--no-auth", "--no-docs");
    const res = run(["add", "chat", "--no-examples"], dir);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toMatch(/chat pulls in agents/);
    const mods = json(dir, "pattern.config.json").mods as string[];
    for (const m of ["@pattern-js/mod-chat", "@pattern-js/mod-agents", "@pattern-js/mod-ai", "@pattern-js/mod-store", "@pattern-js/mod-vault"]) {
      expect(mods).toContain(m);
    }
    const engine = await boot(dir);
    expect(engine.ops.get("chat.turn.begin")).toBeDefined();
  });

  it("never overwrites an existing workflow file", () => {
    const dir = scaffold("keeps", "--modpack", "studio", "--auth", "--docs", "--email", "console");
    writeFileSync(join(dir, "workflows", "checkout.json"), `{"id":"mine"}`);
    const res = run(["add", "billing"], dir);
    expect(res.status).toBe(0);
    expect(res.out).toContain("kept your existing: checkout.json");
    expect(read(dir, "workflows/checkout.json")).toBe(`{"id":"mine"}`);
  });

  it("refuses politely outside a project; lists status with no args", () => {
    const bare = mkdtempSync(join(tmpdir(), "not-a-project-"));
    try {
      const res = run(["add", "billing"], bare);
      expect(res.status).toBe(1);
      expect(res.out).toContain("no pattern.config.json");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
    const dir = scaffold("statusy", "--modpack", "studio", "--auth", "--docs", "--email", "console");
    const res = run(["add"], dir);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toMatch(/installed.+auth/s);
    expect(res.out).toMatch(/available.+billing/s);
  });
});

