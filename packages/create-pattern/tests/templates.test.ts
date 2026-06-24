/**
 * Every shipped template's workflow graphs must validate against the REAL op
 * registry of the mods that template declares. This is the safety net for
 * op/port drift: change an op's signature and a stale template workflow fails
 * HERE, in CI, instead of in a user's freshly scaffolded project.
 *
 * The workflow JSONs are validated exactly as shipped — their `{{...}}` are
 * `core.string.template` placeholders (runtime), not scaffold tokens, so no
 * substitution is needed. Mods are instantiated only far enough to harvest
 * their `ops`; we never run setup/ready (no services, no ordering to satisfy).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { Engine, type PatternMod } from "@pattern-js/core";
import { storeMod } from "@pattern-js/mod-store";
import { vaultMod } from "@pattern-js/mod-vault";
import { agentsMod } from "@pattern-js/mod-agents";
import { aiMod } from "@pattern-js/mod-ai";
import { adminMod } from "@pattern-js/mod-admin";
import { chatMod } from "@pattern-js/mod-chat";

const TEMPLATES = fileURLToPath(new URL("../templates", import.meta.url));
const VAULT_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

/** Map a `pattern.config.json` mods entry → a PatternMod. Local `./*.mjs` mods
 *  are imported from the template dir; published ones come from this table. */
const FACTORIES: Record<string, () => PatternMod> = {
  "@pattern-js/mod-store": () => storeMod({ storage: "memory" }),
  "@pattern-js/mod-vault": () => vaultMod({ storage: "memory", masterKey: VAULT_KEY }),
  "@pattern-js/mod-agents": () => agentsMod(),
  "@pattern-js/mod-ai": () => aiMod(),
  "@pattern-js/mod-admin": () => adminMod(),
  "@pattern-js/mod-chat": () => chatMod(),
};

async function resolveMod(templateDir: string, entry: string): Promise<PatternMod> {
  if (entry.startsWith(".")) {
    return (await import(pathToFileURL(join(templateDir, entry)).href)).default as PatternMod;
  }
  const make = FACTORIES[entry];
  if (!make) throw new Error(`template test: no factory mapped for mod "${entry}" — add it to FACTORIES`);
  return make();
}

// Templates that ship file workflows (a config + a workflows/ dir holding JSON).
// Some templates (e.g. studio) intentionally ship none — you build them in the
// admin — and are skipped.
const templates = readdirSync(TEMPLATES).filter((t) => {
  const wf = join(TEMPLATES, t, "workflows");
  return (
    existsSync(join(TEMPLATES, t, "pattern.config.json")) &&
    existsSync(wf) &&
    readdirSync(wf).some((f) => f.endsWith(".json"))
  );
});

describe("create-pattern templates", () => {
  it("sweep is non-empty and covers the agent templates", () => {
    expect(templates).toEqual(expect.arrayContaining(["agentic", "agent-chat", "blank", "headless"]));
  });

  it.each(templates)("%s: every workflow graph validates against its declared mods", async (t) => {
    const dir = join(TEMPLATES, t);
    const cfg = JSON.parse(readFileSync(join(dir, "pattern.config.json"), "utf8")) as { mods?: string[] };
    const engine = new Engine(); // core ops are registered by default
    for (const entry of cfg.mods ?? []) {
      const mod = await resolveMod(dir, entry);
      for (const op of mod.ops ?? []) engine.registerOp(op);
    }

    const wfDir = join(dir, "workflows");
    const files = readdirSync(wfDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const wf = JSON.parse(readFileSync(join(wfDir, f), "utf8"));
      let error: Error | undefined;
      try {
        // Resolve the boot-time phase ($env + boundary config ports) WITHOUT
        // registering, then validate — exactly what a deployed copy would see.
        engine.validate(await engine.resolveWorkflowDoc(wf));
      } catch (e) {
        error = e as Error;
      }
      expect(error, error && `${t}/workflows/${f}: ${error.message}`).toBeUndefined();
    }
  });
});
