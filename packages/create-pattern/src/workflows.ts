/**
 * Workflow JSON the SCAFFOLDER writes (dimension-driven), as opposed to the
 * workflows shipped inside `templates/`. Template workflows are drift-tested
 * against the real op registries by tests/templates.test.ts; these constants
 * get the same safety net in tests/scaffold-workflows.test.ts — change an op's
 * ports and the stale graph fails in CI, not in a fresh scaffold.
 *
 * This module must stay side-effect free (index.ts runs the CLI on import;
 * tests import from here).
 */

/** A protected route demoing requireAuth + the trigger's `user` port (headless + auth). */
export const WHOAMI_WORKFLOW = `{
  "$schema": "pattern/workflow/v1",
  "id": "whoami",
  "name": "GET /whoami (protected)",
  "nodes": [
    {
      "id": "in",
      "op": "boundary.http.request",
      "config": { "method": "GET", "path": "/whoami", "requireAuth": true },
      "comment": "requireAuth gates the route; the user port carries the signed-in identity."
    },
    { "id": "out", "op": "boundary.http.response", "config": { "mode": "buffered" } }
  ],
  "edges": [
    { "from": { "node": "in", "port": "user" }, "to": { "node": "out", "port": "body" } }
  ]
}
`;

/**
 * Email your app and an agent answers (agentic pack + Resend delivery). The
 * `email.inbound` trigger fires off the svix-verified webhook route that
 * mod-email-resend seeds (POST /email/inbound/resend); `email.reply` threads
 * the agent's answer back to the sender through the arrival account.
 */
export const EMAIL_AGENT_REPLY_WORKFLOW = `{
  "$schema": "pattern/workflow/v1",
  "id": "email-agent-reply",
  "name": "Inbound email: an agent replies",
  "description": "Email your app, an agent answers: email.inbound fires when the (svix-verified) Resend webhook delivers a message, the email becomes the agent's prompt, and email.reply threads the answer back to the sender. Setup: create the \\"default\\" account in admin \\u2192 System \\u2192 Email (API key + webhook secret), point a Resend inbound webhook at POST /email/inbound/resend, and have a \\"default\\" model alias.",
  "nodes": [
    {
      "id": "in",
      "op": "email.inbound",
      "config": {},
      "comment": "Fires once per received email, any account \\u2014 set config.account to narrow. Attachments are already blobs.",
      "ui": { "x": 40, "y": 200 }
    },
    {
      "id": "prompt",
      "op": "core.string.template",
      "config": { "template": "Reply to this email.\\n\\nFrom: {{ from }}\\nSubject: {{ subject }}\\n\\n{{ text }}" },
      "ui": { "x": 320, "y": 120 }
    },
    {
      "id": "agent",
      "op": "agents.agent",
      "config": {
        "name": "mail-assistant",
        "instructions": "You answer inbound email for this app. Write the reply body only \\u2014 concise, helpful markdown; no subject line, no signature."
      },
      "comment": "No model wired \\u2014 the agent falls back to the \\"default\\" alias (admin \\u2192 Settings \\u2192 AI Providers).",
      "ui": { "x": 320, "y": 320 }
    },
    { "id": "run", "op": "agents.run", "ui": { "x": 600, "y": 220 } },
    {
      "id": "reply",
      "op": "email.reply",
      "config": {},
      "comment": "Threads In-Reply-To/References, prefixes \\"Re:\\", and sends through the account the message arrived on.",
      "ui": { "x": 880, "y": 220 }
    }
  ],
  "edges": [
    { "from": { "node": "in", "port": "message" }, "to": { "node": "prompt", "port": "data" } },
    { "from": { "node": "prompt", "port": "out" }, "to": { "node": "run", "port": "input" } },
    { "from": { "node": "agent", "port": "agent" }, "to": { "node": "run", "port": "agent" } },
    { "from": { "node": "run", "port": "output" }, "to": { "node": "reply", "port": "markdown" } },
    { "from": { "node": "in", "port": "message" }, "to": { "node": "reply", "port": "message" } }
  ]
}
`;
