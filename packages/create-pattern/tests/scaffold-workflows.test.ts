/**
 * Drift alarm for the workflow JSON the SCAFFOLDER writes (dimension-driven —
 * not shipped in templates/, so tests/templates.test.ts never sees it). Each
 * constant validates against the real op registries of the mods a scaffold
 * that writes it is guaranteed to carry: change an op's ports and the stale
 * graph fails here, in CI, instead of in a user's fresh project.
 */
import { describe, expect, it } from "vitest";
import { Engine, type PatternMod } from "@pattern-js/core";
import { agentsMod } from "@pattern-js/mod-agents";
import { aiMod } from "@pattern-js/mod-ai";
import { emailMod } from "@pattern-js/mod-email";
import { resendEmailMod } from "@pattern-js/mod-email-resend";
import { EMAIL_AGENT_REPLY_WORKFLOW, WHOAMI_WORKFLOW } from "../src/workflows.js";

/** Mods are instantiated only far enough to harvest ops (no setup/ready). */
async function validate(json: string, mods: PatternMod[]): Promise<void> {
  const engine = new Engine(); // core ops (boundary.http.*, core.string.*) register by default
  for (const mod of mods) for (const op of mod.ops ?? []) engine.registerOp(op);
  engine.validate(await engine.resolveWorkflowDoc(JSON.parse(json)));
}

describe("scaffold-written workflows validate against the real ops", () => {
  it("whoami (headless + auth) — core boundaries only", async () => {
    await expect(validate(WHOAMI_WORKFLOW, [])).resolves.toBeUndefined();
  });

  it("email-agent-reply (agentic + resend) — agents + email contract + driver", async () => {
    await expect(
      validate(EMAIL_AGENT_REPLY_WORKFLOW, [agentsMod(), aiMod(), emailMod(), resendEmailMod()]),
    ).resolves.toBeUndefined();
  });
});
