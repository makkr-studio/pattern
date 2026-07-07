/**
 * @pattern-js/mod-email — the packaged sign-in delivery workflow.
 *
 * Subscribed to mod-identity's `identity.deliverToken` hook. The graph probes
 * for a "default" account (`email.account` with required:false) and branches:
 *
 *  - configured (and nobody upstream already delivered — a custom subscriber
 *    at a lower priority may have; double-sending would be rude) → compose
 *    subject/body from the payload, `email.send`, then flip `delivered:true`
 *    — strictly AFTER the send succeeded (the flag node is control-gated on
 *    the send's completion pulse).
 *  - otherwise → return the payload untouched, so identity's console
 *    fallback prints the link with no warning. Installing mod-email changes
 *    nothing until an operator creates the account; then links start sending.
 *
 * A broken account (bad key, driver down) makes `email.send` throw → the hook
 * chain fails fast → identity logs a warning and still prints the console
 * link, so the operator is never locked out.
 *
 * Deliberately `internal: false`: this is a user-meaningful workflow. Open it
 * in the admin editor to reword the email (the two `core.string.template`
 * nodes), or fork it and subscribe your own.
 */

import type { Workflow } from "@pattern-js/core";

export function deliverTokenWorkflow(): Workflow {
  return {
    id: "email.deliver-token",
    name: "Email · deliver sign-in links (identity.deliverToken)",
    description:
      'Emails identity sign-in links through the "default" email account; leaves the payload ' +
      "untouched (console fallback) while no account is configured.",
    source: "code",
    internal: false,
    nodes: [
      { id: "in", op: "boundary.hook", config: { hook: "identity.deliverToken" } },
      { id: "acct", op: "email.account", config: { account: "default", required: false } },
      { id: "del", op: "core.object.get", config: { path: "delivered" } },
      { id: "fresh", op: "core.bool.not" },
      { id: "should", op: "core.bool.and" },
      { id: "gate", op: "core.flow.branch" },
      { id: "to", op: "core.object.get", config: { path: "email" } },
      // Subject + message arrive READY-MADE on the payload (identity writes
      // purpose- and expiry-aware copy — "You've been invited … valid for 7
      // days"). Reword here, or replace the whole template with your own.
      { id: "subj", op: "core.string.template", config: { template: "{{subject}}" } },
      {
        id: "body",
        op: "core.string.template",
        config: {
          template: "# {{subject}}\n\n{{message}}\n\n{{url}}\n\nIf you didn't expect this email, you can safely ignore it.",
        },
      },
      { id: "send", op: "email.send" },
      { id: "flag", op: "core.const.boolean", config: { value: true } },
      { id: "set", op: "core.object.set", config: { path: "delivered" } },
      { id: "ret1", op: "boundary.hook.return" },
      { id: "ret2", op: "boundary.hook.return" },
    ],
    edges: [
      // The probe + "nobody already delivered" drive the branch.
      { from: { node: "in", port: "payload" }, to: { node: "del", port: "object" } },
      { from: { node: "del", port: "out" }, to: { node: "fresh", port: "a" } },
      { from: { node: "acct", port: "configured" }, to: { node: "should", port: "a" } },
      { from: { node: "fresh", port: "out" }, to: { node: "should", port: "b" } },
      { from: { node: "should", port: "out" }, to: { node: "gate", port: "condition" } },
      // Compose recipient / subject / body from the hook payload.
      { from: { node: "in", port: "payload" }, to: { node: "to", port: "object" } },
      { from: { node: "in", port: "payload" }, to: { node: "subj", port: "data" } },
      { from: { node: "in", port: "payload" }, to: { node: "body", port: "data" } },
      // The send — only when the branch pulses `then`.
      { from: { node: "acct", port: "account" }, to: { node: "send", port: "account" } },
      { from: { node: "to", port: "out" }, to: { node: "send", port: "to" } },
      { from: { node: "subj", port: "out" }, to: { node: "send", port: "subject" } },
      { from: { node: "body", port: "out" }, to: { node: "send", port: "markdown" } },
      { from: { node: "gate", port: "then" }, to: { node: "send", port: "in" } },
      // delivered=true, control-gated on the send's completion pulse.
      { from: { node: "in", port: "payload" }, to: { node: "set", port: "object" } },
      { from: { node: "flag", port: "out" }, to: { node: "set", port: "value" } },
      { from: { node: "send", port: "out" }, to: { node: "set", port: "in" } },
      { from: { node: "set", port: "out" }, to: { node: "ret1", port: "payload" } },
      // Not configured → the payload passes through unchanged.
      { from: { node: "in", port: "payload" }, to: { node: "ret2", port: "payload" } },
      { from: { node: "gate", port: "else" }, to: { node: "ret2", port: "in" } },
    ],
  };
}
