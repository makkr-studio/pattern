/**
 * @pattern-js/mod-billing — the packaged AI-usage metering loop.
 *
 * mod-ai emits one `ai.usage` event per model call (tokens + the calling
 * user). This workflow subscribes and records each attributed call onto a
 * provider meter — usage-based billing as an EDGE, not code. Seeded only when
 * the mod is constructed with `meterAiUsage: true`, and `internal: false` so
 * operators can open it, reword it, or reroute it (per-model meters, guest
 * buckets, sampling — it's an ordinary workflow).
 *
 * Unattributed calls (no signed-in user) and calls whose provider reported no
 * token counts are gated out rather than erroring: metering is bookkeeping,
 * never a failure source.
 */

import type { Workflow } from "@pattern-js/core";

export function meterAiUsageWorkflow(meter: string): Workflow {
  return {
    id: "billing.meter.ai-usage",
    name: "Billing · meter AI usage (ai.usage → provider meter)",
    description:
      `Records every attributed model call's tokens onto the "${meter}" meter of the "default" ` +
      "billing account. Guest calls and token-less reports pass through unrecorded.",
    source: "code",
    internal: false,
    nodes: [
      { id: "in", op: "boundary.event", config: { event: "ai.usage" } },
      { id: "pick", op: "core.object.extract", config: { keys: ["userId", "totalTokens"] } },
      // Meter only attributed, measured calls: a signed-in user AND a token count.
      { id: "hasUser", op: "core.object.has", config: { path: "userId" } },
      { id: "hasTokens", op: "core.object.has", config: { path: "totalTokens" } },
      { id: "both", op: "core.bool.and" },
      { id: "gate", op: "core.flow.gate" },
      { id: "record", op: "billing.usage.record", config: { meter } },
    ],
    edges: [
      { from: { node: "in", port: "payload" }, to: { node: "pick", port: "object" } },
      { from: { node: "in", port: "payload" }, to: { node: "hasUser", port: "object" } },
      { from: { node: "in", port: "payload" }, to: { node: "hasTokens", port: "object" } },
      { from: { node: "hasUser", port: "out" }, to: { node: "both", port: "a" } },
      { from: { node: "hasTokens", port: "out" }, to: { node: "both", port: "b" } },
      { from: { node: "both", port: "out" }, to: { node: "gate", port: "condition" } },
      { from: { node: "gate", port: "out" }, to: { node: "record", port: "in" } },
      { from: { node: "pick", port: "userId" }, to: { node: "record", port: "userId" } },
      { from: { node: "pick", port: "totalTokens" }, to: { node: "record", port: "value" } },
    ],
  };
}
