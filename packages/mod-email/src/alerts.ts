/**
 * @pattern-js/mod-email — the packaged failure-alert workflow.
 *
 * The engine emits one `run.failed` event per failed top-level run (0.5); this
 * workflow turns it into an email to `PATTERN_ALERTS_TO`. Zero-config posture:
 * with the env unset it gates out silently, and with no email account
 * configured the send console-logs — so it ships on, costs nothing, and starts
 * alerting the moment both exist. `internal: false`: open it in the editor to
 * reword the copy, filter workflows, or reroute to another channel entirely.
 *
 * (A failing run that was itself triggered by `run.failed` never re-emits —
 * the engine's recursion guard — so a broken alert can't alert about itself.)
 */

import type { Workflow } from "@pattern-js/core";

export function alertFailedRunWorkflow(): Workflow {
  return {
    id: "email.alert-failed-run",
    name: "Email · alert on failed runs (run.failed)",
    description:
      "Emails PATTERN_ALERTS_TO whenever a top-level run fails, with the error and a deep link to the " +
      "trace. Unset the env (or edit this workflow) to change the posture.",
    source: "code",
    internal: false,
    nodes: [
      { id: "in", op: "boundary.event", config: { event: "run.failed" } },
      // Recipient(s): unset/empty → the gate stops everything, silently.
      { id: "to", op: "core.env", config: { name: "PATTERN_ALERTS_TO", default: "" } },
      { id: "wanted", op: "core.cast.toBoolean" },
      { id: "gate", op: "core.flow.gate" },
      // The admin deep link needs a public origin; localhost is the honest dev default.
      { id: "origin", op: "core.env", config: { name: "PATTERN_PUBLIC_URL", default: "http://localhost:3000" } },
      { id: "info", op: "core.object.set", config: { path: "origin" } },
      { id: "subj", op: "core.string.template", config: { template: "Run failed: {{workflowId}}" } },
      {
        id: "body",
        op: "core.string.template",
        config: {
          template:
            "# Run failed: {{workflowId}}\n\n> {{error.message}}\n\nInspect the trace (durable runs can resume from the failing node):\n\n{{origin}}/admin/runs/{{runId}}\n\nYou get this because PATTERN_ALERTS_TO is set — edit the \"email.alert-failed-run\" workflow to reword or reroute it.",
        },
      },
      { id: "send", op: "email.send" },
    ],
    edges: [
      { from: { node: "to", port: "out" }, to: { node: "wanted", port: "value" } },
      { from: { node: "wanted", port: "out" }, to: { node: "gate", port: "condition" } },
      { from: { node: "in", port: "payload" }, to: { node: "info", port: "object" } },
      { from: { node: "origin", port: "out" }, to: { node: "info", port: "value" } },
      { from: { node: "in", port: "payload" }, to: { node: "subj", port: "data" } },
      { from: { node: "info", port: "out" }, to: { node: "body", port: "data" } },
      { from: { node: "to", port: "out" }, to: { node: "send", port: "to" } },
      { from: { node: "subj", port: "out" }, to: { node: "send", port: "subject" } },
      { from: { node: "body", port: "out" }, to: { node: "send", port: "markdown" } },
      { from: { node: "gate", port: "out" }, to: { node: "send", port: "in" } },
    ],
  };
}
