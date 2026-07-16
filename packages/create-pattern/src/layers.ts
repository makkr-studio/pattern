/**
 * create-pattern — the compose-mode layer registry.
 *
 * `compose` is the picker's last entry: instead of a curated modpack you pick
 * capability LAYERS (one multiselect), answer sub-questions only for what you
 * picked, and the scaffolder assembles the stack. Dependencies auto-pull WITH
 * a printed note — never silently, never a hard error (the saas-starter's
 * auth-required-with-a-note pattern, generalized). Scriptable via `--with`:
 *
 *   npm create pattern my-app -- --with admin,auth:magic-link,email:resend,billing
 *
 * The packs stay curated presets over the same underlying pieces; compose is
 * the seventh path. Layers reuse the pack templates' own example workflows
 * (cherry-picked files), so the template safety-net tests cover both.
 */

export interface ComposeLayer {
  id: string;
  /** Picker copy. */
  label: string;
  hint: string;
  /** Layer ids this one auto-pulls (noted to the user, never silent). */
  requires: string[];
  /** Infra layers (store, vault) ride along via `requires`; never in the picker. */
  hidden?: boolean;
  /** @pattern-js packages this layer adds to dependencies (PATTERN_RANGE). */
  deps: string[];
  /** pattern.config.json entries this layer contributes (canonical order). */
  configMods: string[];
  /** Entries that also join `workers.mods` (the offloadable stack). */
  workerMods: string[];
  /** Env vars the layer needs (the card's "needs" line). */
  env: string[];
  /** Example workflow files cherry-picked from a pack template (examples on). */
  examples?: { template: string; workflows: string[] };
  /** Workflow files that are the layer's SURFACE — seeded even without examples. */
  platformWorkflows?: { template: string; workflows: string[] };
  /** Endpoints the layer serves (card + next steps). */
  serves: (examples: boolean) => string[];
  /** A commented .env.example block appended once when the layer lands. */
  envHint?: string;
  /** The AGENTS.md fragment appended under "## Composed layers". */
  agentsMd: string;
}

const STRIPE_ENV_HINT = `# Stripe — the billing account in admin → System → Billing references these
# (test keys from https://dashboard.stripe.com/test/apikeys; the webhook secret
# comes from \`stripe listen\` in dev, or the endpoint config in production)
STRIPE_API_KEY=
STRIPE_WEBHOOK_SECRET=
`;

const VAULT_ENV_HINT = `# The vault's master key — encrypts provider keys and other secrets at rest
# (generate one: openssl rand -base64 32)
# PATTERN_VAULT_KEY=
`;

export const LAYERS: ComposeLayer[] = [
  {
    id: "admin",
    label: "Admin studio",
    hint: "the visual workspace at /admin — editor, runs & traces, versioned workflow store",
    requires: [],
    deps: [],
    configMods: [], // realized by the base template (studio vs headless)
    workerMods: [],
    env: [],
    serves: () => ["/admin"],
    agentsMd: `### Admin (mod-admin)
The visual control plane at \`/admin\`: build workflows in the editor (versioned
into \`./.pattern\` — commit it), watch runs with per-node traces and replay,
browse every op in the catalog. Workflows you author there and the JSON files
in \`workflows/\` are the same document format.`,
  },
  {
    id: "auth",
    label: "Authentication",
    hint: "sign-in (magic link / OIDC), users, sessions, roles → scopes — locks the admin",
    requires: [],
    deps: [], // applyAuth wires identity + the chosen sign-in methods
    configMods: [],
    workerMods: [],
    env: [],
    serves: () => [],
    agentsMd: `### Authentication (mod-identity)
Users, sessions, and a roles→scopes map (recompiled per request). Gate a route
with \`"requireAuth": true\` (any signed-in user) or \`{ "scopes": ["admin"] }\`
on the \`boundary.http.request\` trigger. First boot prints a one-time owner
link. Manage users/invites in admin → Access.`,
  },
  {
    id: "email",
    label: "Email sending",
    hint: "mod-email: accounts + email.send (+ a driver) — also delivers sign-in links",
    requires: [],
    deps: ["@pattern-js/mod-email"], // the driver joins per the delivery answer
    configMods: ["@pattern-js/mod-email"],
    workerMods: [],
    env: [],
    serves: () => [],
    agentsMd: `### Email (mod-email)
Transactional email as a workflow op: wire \`email.account\` → \`email.send\`
(markdown body; attachments as blob refs). Create the "default" account in
admin → System → Email — until then sends fall back to the console. With auth
on, sign-in links deliver through it automatically. Failed-run alert emails
(set \`PATTERN_ALERTS_TO\`) use the same account.`,
  },
  {
    id: "store",
    label: "Store",
    hint: "durable state (sqlite): documents, blobs, leases",
    requires: [],
    hidden: true,
    deps: ["@pattern-js/mod-store"],
    configMods: ["@pattern-js/mod-store"],
    workerMods: ["@pattern-js/mod-store"],
    env: [],
    serves: () => [],
    agentsMd: `### Store (mod-store)
Durable state without a database server: \`store.put/get/query\` over indexed
document collections, \`store.blob.*\` for binary, \`store.lease.*\` for
mutual exclusion. Data lives in \`.pattern-data/store.db\` (gitignored).`,
  },
  {
    id: "vault",
    label: "Vault",
    hint: "encrypted secrets at rest",
    requires: [],
    hidden: true,
    deps: ["@pattern-js/mod-vault"],
    configMods: ["@pattern-js/mod-vault"],
    workerMods: ["@pattern-js/mod-vault"],
    env: ["PATTERN_VAULT_KEY"],
    serves: () => [],
    envHint: VAULT_ENV_HINT,
    agentsMd: `### Vault (mod-vault)
Encrypted secrets at rest (admin → System → Secrets). Anything that needs a
credential takes a REFERENCE — \`{ "source": "vault", "key": "..." }\` or
\`{ "source": "env", "key": "..." }\` — never a plaintext value in config.`,
  },
  {
    id: "ai",
    label: "AI",
    hint: "mod-ai: text/object/embed/image/speech ops on any provider — model aliases in admin",
    requires: ["store", "vault"],
    deps: ["@pattern-js/mod-ai"],
    configMods: ["@pattern-js/mod-ai"],
    workerMods: ["@pattern-js/mod-ai"],
    env: [],
    examples: { template: "studio-ai", workflows: ["summarize.json"] },
    serves: (ex) => (ex ? ["/summarize"] : []),
    agentsMd: `### AI (mod-ai)
Model calls as ops: \`ai.alias\` (or \`ai.model\`) → \`ai.text.generate\` /
\`ai.object.generate\` / \`ai.embed\` / \`ai.image.generate\` / speech + STT.
Models resolve from ALIASES (admin → Settings → AI Providers); each alias
carries its own key as a vault/env reference. \`default\` is the fallback
alias agents and chat use; \`embeddings\` powers vectors/RAG.`,
  },
  {
    id: "agents",
    label: "Agents",
    hint: "the agent loop: agent · run · tools ops; tools are workflows",
    requires: ["ai"],
    deps: ["@pattern-js/mod-agents"],
    configMods: ["@pattern-js/mod-agents"],
    workerMods: ["@pattern-js/mod-agents"],
    env: [],
    examples: { template: "agentic", workflows: ["agent-answer.json", "tool-time.json"] },
    serves: (ex) => (ex ? ["/ask"] : []),
    agentsMd: `### Agents (mod-agents)
The agent stack: \`agents.agent\` (instructions + model) → \`agents.run\`
(streamed turn events, usage totals). A TOOL is a workflow — trigger
\`boundary.tool\`, out-gate \`boundary.tool.return\` — and
\`agents.tools.workflows\` hands every tool workflow to the agent. Each tool
call is a linked sub-run you can inspect in /admin → Runs.`,
  },
  {
    id: "chat",
    label: "Chat",
    hint: "the /chat product — its turn pipeline is an agentic workflow you can fork",
    requires: ["agents", "store"],
    deps: ["@pattern-js/mod-chat"],
    configMods: ["@pattern-js/mod-chat"],
    workerMods: ["@pattern-js/mod-chat"],
    env: [],
    examples: { template: "agent-chat", workflows: ["tool-weather.json"] },
    serves: () => ["/chat"],
    agentsMd: `### Chat (mod-chat)
A complete chat app at \`/chat\`; every turn runs the \`chat.turn\` workflow —
fork it in the admin editor to change the model, instructions, tools or
guardrails. Add a tool workflow and the chat agent can call it. With vectors
installed, per-user cross-conversation memory switches on (admin → Chat →
Memories).`,
  },
  {
    id: "vectors",
    label: "Vectors / RAG",
    hint: "embedding collections, hybrid search, RAG — needs an embeddings alias",
    requires: ["ai"],
    deps: ["@pattern-js/mod-vectors"],
    configMods: ["@pattern-js/mod-vectors"],
    workerMods: ["@pattern-js/mod-vectors"],
    env: [],
    examples: { template: "agentic", workflows: ["rag-ingest.json", "rag-ask.json"] },
    serves: (ex) => (ex ? ["/rag/ingest", "/rag/ask"] : []),
    agentsMd: `### Vectors (mod-vectors)
Embedding collections with declared filterable fields and hybrid (vector +
keyword) retrieval: \`vectors.collection.ensure\` → \`vectors.index\` →
\`vectors.query\`. The admin Vectors page is a whole RAG loop — paste, search,
read scores. Needs an \`embeddings\` model alias.`,
  },
  {
    id: "billing",
    label: "Billing",
    hint: "Stripe checkout, portal & signed webhooks; subscriptions become roles → scopes",
    requires: ["auth", "email", "store"],
    deps: ["@pattern-js/mod-billing", "@pattern-js/mod-billing-stripe"],
    configMods: ["./mods/billing.mjs", "@pattern-js/mod-billing-stripe"],
    workerMods: [],
    env: ["STRIPE_API_KEY", "STRIPE_WEBHOOK_SECRET"],
    // checkout/portal/pro are the billing SURFACE (kept even with --no-examples);
    // the landing page is the demo.
    platformWorkflows: { template: "saas-starter", workflows: ["checkout.json", "portal.json", "pro.json"] },
    examples: { template: "saas-starter", workflows: ["landing.json"] },
    serves: (ex) => [...(ex ? ["/"] : []), "/pro", "/billing/checkout", "/billing/portal"],
    envHint: STRIPE_ENV_HINT,
    agentsMd: `### Billing (mod-billing + the Stripe driver)
The entitlement bridge: an active/trialing subscription grants the "member"
role (mods/billing.mjs) → identity's roles→scopes map turns it into the "pro"
scope (mods/identity.mjs) → a paid feature is just
\`"requireAuth": { "scopes": ["pro"] }\` on a route. Checkout/portal ship as
durable workflows; the signed Stripe webhook route is seeded by the driver.
Dev loop: keys in .env, the account in admin → System → Billing, then
\`stripe listen --forward-to localhost:3000/billing/webhook/stripe\` and pay
with 4242 4242 4242 4242.`,
  },
  {
    id: "buddy",
    label: "Buddy",
    hint: "the editor assistant + the pattern_* MCP control plane (Claude Code reads .mcp.json)",
    requires: ["agents", "docs", "admin"],
    deps: ["@pattern-js/mod-buddy"],
    configMods: ["@pattern-js/mod-buddy"],
    workerMods: [],
    env: [],
    serves: () => [],
    agentsMd: `### Buddy (mod-buddy)
The ✦ toggle in the editor toolbar: describe a workflow and Buddy drafts it
onto the canvas, validated, as an undoable edit — and debugs failed runs from
their traces. The same ten \`pattern_*\` tools serve over MCP: \`.mcp.json\`
wires \`pattern mcp\`, so Claude Code / Cursor can list ops, read docs,
validate and save drafts against THIS app directly.`,
  },
  {
    id: "docs",
    label: "Docs",
    hint: "/docs — the handbook + a live op reference; every installed mod's chapter",
    requires: [],
    deps: [], // applyDocs appends mod-docs last
    configMods: [],
    workerMods: [],
    env: [],
    serves: () => ["/docs"],
    agentsMd: `### Docs (mod-docs)
The handbook + a live op reference at \`/docs\`, generated from THIS
installation — signatures always match what's running. \`/docs/llms.txt\`
hands the whole thing to a coding agent as one file.`,
  },
];

/** The picker's visible layers, in the order they're offered. */
export const VISIBLE_LAYERS = ["admin", "auth", "email", "ai", "agents", "chat", "vectors", "billing", "buddy", "docs"];

/** Prechecked in the interactive multiselect — the secure-by-default trio. */
export const DEFAULT_LAYERS = ["admin", "auth", "docs"];

/**
 * Canonical order for everything derived from a layer set: config mods,
 * cards, AGENTS.md sections. Mirrors the packs' conventions (infra first,
 * the agent stack, products, billing; admin and docs bracket the list at
 * apply time).
 */
export const CANONICAL_ORDER = ["admin", "auth", "store", "vault", "agents", "ai", "chat", "vectors", "buddy", "email", "billing", "docs"];

export function layerOrThrow(id: string): ComposeLayer {
  const layer = LAYERS.find((l) => l.id === id);
  if (!layer) {
    const known = VISIBLE_LAYERS.join(", ");
    throw new Error(`--with: unknown layer "${id}" (have: ${known})`);
  }
  return layer;
}

/**
 * Close a chosen layer set over `requires`, collecting WHO pulled WHAT so the
 * caller can print it — dependencies are never silent. Returns the closure in
 * canonical order.
 */
export function resolveLayers(chosen: string[]): { layers: string[]; pulled: Array<{ id: string; by: string }> } {
  const have = new Set<string>();
  const pulled: Array<{ id: string; by: string }> = [];
  // Everything explicitly chosen counts as chosen FIRST — a layer the user
  // picked must never read as "pulled in" just because a sibling requires it.
  for (const id of chosen) {
    layerOrThrow(id);
    have.add(id);
  }
  const visit = (id: string, by: string): void => {
    if (have.has(id)) return;
    have.add(id);
    pulled.push({ id, by });
    for (const req of layerOrThrow(id).requires) visit(req, id);
  };
  for (const id of chosen) for (const req of layerOrThrow(id).requires) visit(req, id);
  const layers = CANONICAL_ORDER.filter((id) => have.has(id));
  return { layers, pulled };
}

/** One `--with` token: `layer` or `layer:answer` (auth + email take answers). */
export interface WithToken {
  id: string;
  answer?: string;
}

/** Parse `--with a,b:answer,c` — friendly errors, no silent drops. */
export function parseWith(raw: string): WithToken[] {
  const tokens = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!tokens.length) throw new Error("--with needs at least one layer (e.g. --with admin,auth,billing)");
  return tokens.map((t) => {
    const [id, answer, ...rest] = t.split(":");
    if (rest.length) throw new Error(`--with: "${t}" — one ":answer" at most`);
    const layer = layerOrThrow(id!);
    if (answer !== undefined) {
      if (layer.id === "auth") {
        if (!["magic-link", "oidc", "both"].includes(answer)) {
          throw new Error(`--with: auth takes :magic-link, :oidc or :both (got "${answer}")`);
        }
      } else if (layer.id === "email") {
        if (!["console", "resend", "smtp"].includes(answer)) {
          throw new Error(`--with: email takes :console, :resend or :smtp (got "${answer}")`);
        }
      } else {
        throw new Error(`--with: layer "${layer.id}" takes no :answer (only auth and email do)`);
      }
    }
    return { id: layer.id, answer };
  });
}

/** The layers whose ids appear in `set`, canonical order. */
export function pickLayers(set: string[]): ComposeLayer[] {
  return CANONICAL_ORDER.filter((id) => set.includes(id)).map((id) => layerOrThrow(id));
}
