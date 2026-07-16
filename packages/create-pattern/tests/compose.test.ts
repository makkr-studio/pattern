/**
 * Compose mode (`--with`): the layer picker's headless surface. Two nets:
 *
 *  1. Artifacts — run the BUILT CLI into a tmpdir and assert what a
 *     composition writes (config order, deps + derived ranges, wrappers,
 *     workflows, env hints, AGENTS.md sections, pull notes).
 *  2. Boot — install the composed pattern.config.json the way loadMods does
 *     (deferred workflows, scaffolded order) against the REAL mods, then
 *     validate every seeded workflow. Layer combinations must not just
 *     scaffold — they must boot.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readdirSync } from "node:fs";
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
import { resendEmailMod } from "@pattern-js/mod-email-resend";
import { smtpEmailMod } from "@pattern-js/mod-email-smtp";
import { identityMod } from "@pattern-js/mod-identity";
import { magicLinkMod } from "@pattern-js/mod-auth-magic-link";
import { oidcMod } from "@pattern-js/mod-auth-oidc";
import { billingMod } from "@pattern-js/mod-billing";
import { stripeBillingMod } from "@pattern-js/mod-billing-stripe";
import { vectorsMod } from "@pattern-js/mod-vectors";
import { buddyMod } from "@pattern-js/mod-buddy";
import { docsMod } from "@pattern-js/mod-docs";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const TEMPLATES = fileURLToPath(new URL("../templates", import.meta.url));
const SELF = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version: string };
const RANGE = `^${SELF.version.split(".").slice(0, 2).join(".")}.0`;
const VAULT_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const cwd = mkdtempSync(join(tmpdir(), "create-pattern-compose-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

function compose(name: string, ...flags: string[]) {
  const res = spawnSync(process.execPath, [CLI, name, "--yes", "--no-install", "--no-git", ...flags], { cwd, encoding: "utf8" });
  expect(res.status, res.stderr).toBe(0);
  const dir = join(cwd, name);
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  return { dir, read, json: (f: string) => JSON.parse(read(f)) as Record<string, any>, stdout: res.stdout };
}

/**
 * Boot a composed scaffold's pattern.config.json against the real mods, in the
 * scaffolded order, the way loadMods installs them (workflows deferred until
 * every mod's ops are in) — then register its file workflows. The app-local
 * wrappers compose writes are deterministic, so they map to factory calls.
 */
const FACTORIES: Record<string, () => PatternMod> = {
  "@pattern-js/mod-store": () => storeMod({ storage: "memory" }),
  "@pattern-js/mod-vault": () => vaultMod({ storage: "memory", masterKey: VAULT_KEY }),
  "@pattern-js/mod-agents": () => agentsMod(),
  "@pattern-js/mod-ai": () => aiMod(),
  "@pattern-js/mod-admin": () => adminMod(),
  "@pattern-js/mod-chat": () => chatMod(),
  "@pattern-js/mod-vectors": () => vectorsMod({ path: ":memory:" }),
  "@pattern-js/mod-buddy": () => buddyMod({ indexOnBoot: false }),
  "@pattern-js/mod-email": () => emailMod(),
  "@pattern-js/mod-email-resend": () => resendEmailMod(),
  "@pattern-js/mod-email-smtp": () => smtpEmailMod(),
  "@pattern-js/mod-auth-magic-link": () => magicLinkMod(),
  "@pattern-js/mod-identity": () => identityMod({ storage: "memory" }),
  "@pattern-js/mod-billing-stripe": () => stripeBillingMod(),
  "@pattern-js/mod-docs": () => docsMod(),
  "./mods/identity.mjs": () => identityMod({ storage: "memory", roles: { admin: ["admin"], member: ["pro"] } }),
  "./mods/billing.mjs": () => billingMod({ entitlement: { role: "member" } }),
  "./mods/oidc.mjs": () => oidcMod({ providers: [] }),
};

async function resolveEntry(entry: string, base: "studio" | "headless"): Promise<PatternMod> {
  const make = FACTORIES[entry];
  if (make) return make();
  if (entry.startsWith("./mods/")) {
    // The base template's app-local example mod — import it from the template
    // (identical file; the scaffolded copy sits outside the test's alias roots).
    return (await import(pathToFileURL(join(TEMPLATES, base, entry)).href)).default as PatternMod;
  }
  throw new Error(`compose boot test: no factory for "${entry}" — add it to FACTORIES`);
}

async function bootScaffold(dir: string): Promise<Engine> {
  const cfg = JSON.parse(readFileSync(join(dir, "pattern.config.json"), "utf8")) as { mods: string[] };
  const base = cfg.mods.includes("@pattern-js/mod-admin") ? "studio" : "headless";
  const engine = new Engine();
  for (const entry of cfg.mods) {
    await engine.useAsync(await resolveEntry(entry, base), { deferReady: true, deferWorkflows: true });
  }
  await engine.flushDeferredWorkflows();
  const wfDir = join(dir, "workflows");
  if (existsSync(wfDir)) {
    for (const f of readdirSync(wfDir).filter((x) => x.endsWith(".json"))) {
      const doc = JSON.parse(readFileSync(join(wfDir, f), "utf8"));
      engine.registerWorkflow(await engine.resolveWorkflowDoc(doc));
    }
  }
  return engine;
}

describe("compose mode — artifacts", () => {
  it("--with billing pulls auth + email + store, says so, and wires both bridge wrappers", () => {
    const { read, json, stdout } = compose("c-pay", "--with", "billing");
    expect(stdout).toContain("note: billing pulls in auth + email + store");
    const mods = json("pattern.config.json").mods as string[];
    expect(mods).toEqual([
      "./mods/identity.mjs",
      "@pattern-js/mod-auth-magic-link",
      "@pattern-js/mod-store",
      "@pattern-js/mod-email",
      "./mods/billing.mjs",
      "@pattern-js/mod-billing-stripe",
      "./mods/uppercase.mjs", // the headless base's example mod (examples default on)
    ]);
    expect(read("mods/identity.mjs")).toContain('member: ["pro"]');
    expect(read("mods/billing.mjs")).toContain('entitlement: { role: "member" }');
    const deps = json("package.json").dependencies as Record<string, string>;
    for (const name of ["@pattern-js/mod-billing", "@pattern-js/mod-billing-stripe", "@pattern-js/mod-identity", "@pattern-js/mod-email", "@pattern-js/mod-store"]) {
      expect(deps[name], name).toBe(RANGE);
    }
    const env = read(".env.example");
    expect(env).toContain("STRIPE_API_KEY");
    expect(env).toContain("STRIPE_WEBHOOK_SECRET");
    // The billing SURFACE ships; landing is the demo (examples default on here).
    for (const f of ["checkout.json", "portal.json", "pro.json", "landing.json"]) {
      expect(existsSync(join(cwd, "c-pay", "workflows", f)), f).toBe(true);
    }
    expect(json("workflows/checkout.json").durable).toBe(true);
  });

  it("--with chat narrates the whole pull chain and rides the headless base (no admin)", () => {
    const { json, stdout, dir } = compose("c-chat", "--with", "chat");
    expect(stdout).toContain("note: chat pulls in agents");
    expect(stdout).toContain("note: agents pulls in ai");
    expect(stdout).toContain("note: ai pulls in store + vault");
    const mods = json("pattern.config.json").mods as string[];
    expect(mods).toContain("@pattern-js/mod-chat");
    expect(mods).not.toContain("@pattern-js/mod-admin");
    expect(existsSync(join(dir, "Dockerfile"))).toBe(true);
  });

  it("the kitchen sink: canonical order, workers, wrappers, hints, sections, .mcp.json", () => {
    const { read, json, dir } = compose(
      "c-sink",
      "--with",
      "admin,auth:both,email:resend,ai,agents,chat,vectors,billing,buddy,docs",
      "--providers",
      "openai",
    );
    const cfg = json("pattern.config.json") as { mods: string[]; workers: { mods: string[] } };
    expect(cfg.mods).toEqual([
      "./mods/identity.mjs",
      "@pattern-js/mod-auth-magic-link",
      "./mods/oidc.mjs",
      "@pattern-js/mod-store",
      "@pattern-js/mod-vault",
      "@pattern-js/mod-agents",
      "@pattern-js/mod-ai",
      "@pattern-js/mod-chat",
      "@pattern-js/mod-vectors",
      "@pattern-js/mod-buddy",
      "@pattern-js/mod-email",
      "@pattern-js/mod-email-resend",
      "./mods/billing.mjs",
      "@pattern-js/mod-billing-stripe",
      "@pattern-js/mod-admin",
      "./mods/quotes.mjs",
      "@pattern-js/mod-docs",
    ]);
    // Workers carry the offloadable stack + surviving app-local mods — never buddy/admin/billing.
    expect(cfg.workers.mods).toEqual([
      "@pattern-js/mod-store",
      "@pattern-js/mod-vault",
      "@pattern-js/mod-agents",
      "@pattern-js/mod-ai",
      "@pattern-js/mod-chat",
      "@pattern-js/mod-vectors",
      "./mods/quotes.mjs",
    ]);
    const env = read(".env.example");
    for (const k of ["STRIPE_API_KEY", "RESEND_API_KEY", "PATTERN_PUBLIC_URL", "PATTERN_VAULT_KEY"]) expect(env, k).toContain(k);
    const agents = read("AGENTS.md");
    expect(agents).toContain("## Composed layers");
    for (const section of ["### Billing", "### Agents", "### Chat", "### Vectors", "### Buddy", "### Email", "### Vault"]) {
      expect(agents, section).toContain(section);
    }
    expect(read("README.md")).toContain("## Composed layers");
    expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
    // The pair recipe: agents + resend → the inbound email agent demo.
    expect(existsSync(join(dir, "workflows", "email-agent-reply.json"))).toBe(true);
  });

  it("--no-examples keeps each layer's surface and drops the demos", () => {
    const { dir } = compose("c-lean", "--with", "billing,agents", "--no-examples");
    for (const f of ["checkout.json", "portal.json", "pro.json"]) {
      expect(existsSync(join(dir, "workflows", f)), f).toBe(true);
    }
    for (const f of ["landing.json", "agent-answer.json", "tool-time.json", "email-agent-reply.json"]) {
      expect(existsSync(join(dir, "workflows", f)), f).toBe(false);
    }
  });

  it("friendly errors: unknown layer, stray answer, --with next to --modpack", () => {
    for (const args of [
      ["--with", "nope"],
      ["--with", "chat:fast"],
      ["--with", "auth:sms"],
      ["--with", "chat", "--modpack", "studio"],
    ]) {
      const res = spawnSync(process.execPath, [CLI, "c-err", "--yes", "--no-install", "--no-git", ...args], { cwd, encoding: "utf8" });
      expect(res.status, args.join(" ")).toBe(1);
      expect(res.stderr).toContain("✗");
    }
  });

  it("prints the reproducible one-liner, and it round-trips", () => {
    const { stdout } = compose("c-repro", "--with", "vectors");
    const m = stdout.match(/Reproduce: npm create pattern@latest c-repro -- --with (\S+)/);
    expect(m, stdout).not.toBeNull();
    // Re-running the printed composition yields the same stack, no notes needed.
    const again = compose("c-repro2", "--with", m![1]!);
    expect(again.json("pattern.config.json").mods).toEqual(compose("c-repro3", "--with", "vectors").json("pattern.config.json").mods);
  });
});

describe("compose mode — composed stacks BOOT (scaffolded order, deferred workflows)", () => {
  it("the kitchen sink boots: seeded + driver + file workflows all register", async () => {
    const engine = await bootScaffold(join(cwd, "c-sink"));
    // The Stripe driver seeded its signed webhook; buddy its tool workflows;
    // the layer workflows validated against the fully-installed registry.
    expect(engine.workflows.get("billing.stripe.inbound")).toBeDefined();
    expect(engine.workflows.get("buddy.tool.list-ops")).toBeDefined();
    for (const id of ["pro", "billing-checkout", "billing-portal", "summarize", "agent-answer", "rag-ask", "rag-ingest"]) {
      expect(engine.workflows.get(id), id).toBeDefined();
    }
    expect(engine.workflows.get("billing-checkout")?.durable).toBe(true);
  });

  it("single layers boot on the headless base", async () => {
    for (const layer of ["ai", "vectors", "email", "auth"]) {
      const { dir } = compose(`c-solo-${layer}`, "--with", layer);
      const engine = await bootScaffold(dir);
      expect(engine.ops.get("core.string.template"), layer).toBeDefined();
    }
  }, 30_000);

  it("sampled combos boot", async () => {
    const combos: string[][] = [
      ["admin", "vectors", "docs"],
      ["auth", "email:smtp", "agents"],
      ["billing", "ai"],
    ];
    for (const combo of combos) {
      const name = `c-combo-${combo.join("-").replace(/[^a-z-]/g, "")}`;
      const { dir } = compose(name, "--with", combo.join(","));
      await bootScaffold(dir); // registration itself is the assertion — bad wiring throws
    }
  }, 30_000);
});
