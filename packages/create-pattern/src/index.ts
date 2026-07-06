#!/usr/bin/env node
/**
 * create-pattern — the Pattern project scaffolder (§15). The front door of the DX.
 *
 *   npm create pattern@latest
 *   pnpm create pattern my-app --modpack studio
 *
 * Projects are scaffolded from **modpacks** — curated sets of mods for a use
 * case (blank slate / headless backend / studio with the admin). Interactive by
 * default (banner → modpack → package manager → install), with graceful
 * non-TTY/CI degradation: everything is flag-driven, no prompts, no animation,
 * fully scriptable. Dev-time-only deps, so it can be rich.
 *
 * Every modpack ships AGENTS.md + CLAUDE.md — the contract sheet a coding agent
 * needs to add ops, routes, workflows, and admin pages without guessing.
 */

import { cp, mkdir, readdir, readFile, rename, rm, writeFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { EMAIL_AGENT_REPLY_WORKFLOW, WHOAMI_WORKFLOW } from "./workflows.js";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates", import.meta.url));

/**
 * The @pattern-js/* range every scaffold gets, derived from create-pattern's
 * OWN version (^major.minor.0) — a scaffold always resolves the mods published
 * alongside the CLI that created it. The static template package.jsons carry
 * whatever range was current when they were written; normalizeDepRanges
 * rewrites them at scaffold time, so they can never go stale.
 */
const SELF_VERSION = (JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version: string }).version;
const PATTERN_RANGE = `^${SELF_VERSION.split(".").slice(0, 2).join(".")}.0`;

interface NextCtx {
  name: string;
  runCmd: string;
  installed: boolean;
  installLine: string;
  auth: boolean;
  examples: boolean;
  /** A .env with a generated PATTERN_VAULT_KEY was written (skip the cp step). */
  vaultKey: boolean;
  /** Model aliases pre-written from the provider picks (null = none seeded). */
  seeded: SeedPlan | null;
}

interface Modpack {
  id: string;
  label: string;
  /** One-liner shown as the select hint. */
  hint: string;
  /** The ladder note's "+ what this rung adds" line (kept short — one clause). */
  rung: string;
  /** Technical one-liner under the card title — what this actually is. */
  tagline: string;
  /** The mods the pack wires up (display names; roles from MOD_ROLES). */
  mods: string[];
  /** Names the actual example artifacts — for the examples question + card. */
  exampleSummary: string;
  /** Endpoints the running app exposes (the card's "serves" line). */
  serves: (examples: boolean) => string[];
  /** Env vars the pack needs (the card's "needs" line). */
  env: string[];
  /** Key generated paths shown as the card's file tree. */
  generates: (examples: boolean) => string[];
  /**
   * Auth is a DIMENSION, not a pack: packs that serve HTTP can opt into the
   * identity brick (magic-link login, users/sessions, secured admin). Absent
   * → the question is never asked (blank has no HTTP host).
   */
  auth?: { default: boolean };
  /**
   * Docs is a DIMENSION too: any pack serving HTTP can ship `/docs` — the
   * Pattern handbook + a live op reference, where every installed mod
   * contributes its own chapter. Absent → never asked (blank has no host).
   */
  docs?: { default: boolean };
  /** Tailored next steps once scaffolded. */
  next: (ctx: NextCtx) => string[];
}

/** What the auth toggle adds (pack card lines + config wiring). */
const IDENTITY_MOD = "@pattern-js/mod-identity";
const MAGIC_LINK_MOD = "@pattern-js/mod-auth-magic-link";

/**
 * Sign-in METHODS (asked only when auth is on): magic link (the zero-config
 * default) and/or OIDC — Google, Microsoft, Keycloak, any OpenID Connect
 * issuer. They compose (same verified email = same user), so "both" is a
 * normal answer. OIDC is code-configured: the scaffold writes mods/oidc.mjs
 * with a commented placeholder provider, so the project boots clean and the
 * login button appears the moment a provider is filled in.
 */
const OIDC_MOD = "@pattern-js/mod-auth-oidc";

/**
 * Sign-in link DELIVERY (asked only when auth is on): console (the zero-config
 * dev fallback) or real email — mod-email (the contract: accounts, email.send,
 * the packaged deliverToken workflow) plus the chosen driver. Console stays
 * the fallback until a "default" account exists in admin → System → Email, so
 * either choice boots with zero config.
 */
const EMAIL_MOD = "@pattern-js/mod-email";
const EMAIL_DRIVERS: Record<string, string> = {
  resend: "@pattern-js/mod-email-resend",
  smtp: "@pattern-js/mod-email-smtp",
};
type EmailDelivery = "console" | "resend" | "smtp";

/** What the docs toggle adds: self-reflecting documentation at /docs. */
const DOCS_MOD = "@pattern-js/mod-docs";

/**
 * The AI provider packages offered when a pack uses mod-ai. mod-ai bundles NONE
 * of them: the Vercel AI Gateway ships inside `ai` (always available), and every
 * direct provider is an optional peer that mod-ai lazy-loads only when an alias
 * uses it. Picking one here adds its @ai-sdk package to the project. Ordered by
 * how likely it is to be picked; `value` is the package the scaffold installs.
 *
 * The @ai-sdk provider packages are at DIFFERENT majors (they share one spec
 * layer, @ai-sdk/provider@3, so all are ai-v6 compatible) — each range is pinned
 * to the package's real major (verified against npm) to avoid ETARGET installs.
 *
 * `seed` makes a pick work on FIRST boot: when a seeded provider is chosen, the
 * scaffold pre-writes model aliases (`default` for language, `embeddings` for
 * embedding — the names agents, RAG examples and Buddy resolve) into
 * `.pattern-data/ai-config.json`, each authenticating via `{ source: "env",
 * key: envKey }`. Ids come from mod-ai's curated catalog and stay editable in
 * admin → Settings → AI Providers; provider ids match mod-ai's registry.
 * Unseeded providers keep the status quo (create aliases in Settings).
 */
interface AiProviderChoice {
  value: string;
  label: string;
  hint: string;
  range: string;
  seed?: { provider: string; envKey: string; language?: string; embedding?: string };
}
const AI_PROVIDERS: AiProviderChoice[] = [
  { value: "@ai-sdk/xai", label: "xAI Grok", hint: "", range: "^3", seed: { provider: "xai", envKey: "XAI_API_KEY", language: "grok-4" } },
  { value: "@ai-sdk/vercel", label: "Vercel", hint: "v0 models", range: "^2" },
  { value: "@ai-sdk/openai", label: "OpenAI", hint: "", range: "^3", seed: { provider: "openai", envKey: "OPENAI_API_KEY", language: "gpt-5.1", embedding: "text-embedding-3-small" } },
  { value: "@ai-sdk/azure", label: "Azure OpenAI", hint: "OpenAI on Azure", range: "^3" },
  { value: "@ai-sdk/anthropic", label: "Anthropic", hint: "", range: "^3", seed: { provider: "anthropic", envKey: "ANTHROPIC_API_KEY", language: "claude-sonnet-4-6" } },
  { value: "@ai-sdk/open-responses", label: "Open Responses", hint: "self-hosted Responses API", range: "^1" },
  { value: "@ai-sdk/anthropic-aws", label: "Claude on AWS", hint: "Claude via Bedrock", range: "^1" },
  { value: "@ai-sdk/amazon-bedrock", label: "Amazon Bedrock", hint: "models on AWS", range: "^4" },
  { value: "@ai-sdk/groq", label: "Groq", hint: "", range: "^3", seed: { provider: "groq", envKey: "GROQ_API_KEY", language: "llama-3.3-70b-versatile" } },
  { value: "@ai-sdk/fal", label: "Fal", hint: "image/video/audio", range: "^2" },
  { value: "@ai-sdk/deepinfra", label: "DeepInfra", hint: "", range: "^2" },
  { value: "@ai-sdk/black-forest-labs", label: "Black Forest Labs", hint: "FLUX", range: "^1" },
  { value: "@ai-sdk/google", label: "Google Generative AI", hint: "Gemini", range: "^3", seed: { provider: "google", envKey: "GOOGLE_GENERATIVE_AI_API_KEY", language: "gemini-2.5-flash", embedding: "gemini-embedding-001" } },
  { value: "@ai-sdk/google-vertex", label: "Google Vertex AI", hint: "Gemini/Claude on GCP", range: "^4" },
  { value: "@ai-sdk/mistral", label: "Mistral AI", hint: "", range: "^3", seed: { provider: "mistral", envKey: "MISTRAL_API_KEY", language: "mistral-large-latest", embedding: "mistral-embed" } },
  { value: "@ai-sdk/togetherai", label: "Together.ai", hint: "", range: "^2" },
  { value: "@ai-sdk/cohere", label: "Cohere", hint: "", range: "^3", seed: { provider: "cohere", envKey: "COHERE_API_KEY", language: "command-a", embedding: "embed-v4.0" } },
  { value: "@ai-sdk/fireworks", label: "Fireworks", hint: "", range: "^2" },
  { value: "@ai-sdk/voyage", label: "Voyage AI", hint: "embeddings", range: "^1", seed: { provider: "voyage", envKey: "VOYAGE_API_KEY", embedding: "voyage-3.5" } },
  { value: "@ai-sdk/deepseek", label: "DeepSeek", hint: "", range: "^2" },
  { value: "@ai-sdk/moonshotai", label: "Moonshot AI", hint: "Kimi", range: "^2" },
  { value: "@ai-sdk/alibaba", label: "Alibaba", hint: "Qwen", range: "^1" },
  { value: "@ai-sdk/cerebras", label: "Cerebras", hint: "", range: "^2" },
  { value: "@ai-sdk/replicate", label: "Replicate", hint: "image/video", range: "^2" },
  { value: "@ai-sdk/prodia", label: "Prodia", hint: "image", range: "^1" },
  { value: "@ai-sdk/perplexity", label: "Perplexity", hint: "", range: "^3" },
  { value: "@ai-sdk/luma", label: "Luma", hint: "image/video", range: "^2" },
  { value: "@ai-sdk/bytedance", label: "ByteDance", hint: "Seed/Seedance", range: "^1" },
  { value: "@ai-sdk/klingai", label: "Kling AI", hint: "video", range: "^3" },
  { value: "@ai-sdk/elevenlabs", label: "ElevenLabs", hint: "speech/STT", range: "^2" },
  { value: "@ai-sdk/assemblyai", label: "AssemblyAI", hint: "transcription", range: "^2" },
  { value: "@ai-sdk/deepgram", label: "Deepgram", hint: "speech/STT", range: "^2" },
  { value: "@ai-sdk/gladia", label: "Gladia", hint: "transcription", range: "^2" },
  { value: "@ai-sdk/lmnt", label: "LMNT", hint: "speech", range: "^2" },
  { value: "@ai-sdk/hume", label: "Hume", hint: "speech", range: "^2" },
  { value: "@ai-sdk/revai", label: "Rev.ai", hint: "transcription", range: "^2" },
  { value: "@ai-sdk/baseten", label: "Baseten", hint: "", range: "^1" },
  { value: "@ai-sdk/huggingface", label: "Hugging Face", hint: "", range: "^1" },
  { value: "@ai-sdk/quiverai", label: "QuiverAI", hint: "", range: "^1" },
  { value: "@ai-sdk/openai-compatible", label: "OpenAI Compatible", hint: "any OpenAI-style endpoint", range: "^2" },
];
/** Prechecked in the interactive picker — the most common direct providers. */
const AI_PROVIDERS_DEFAULT = ["@ai-sdk/openai", "@ai-sdk/anthropic"];
/** A pack uses mod-ai if it wires it (directly or via the combined agents+ai entry). */
function packUsesAi(pack: Modpack): boolean {
  return pack.mods.some((m) => m.includes("mod-ai"));
}
/** A pack that wires mod-buddy gets `.mcp.json` (Claude Code ⇄ `pattern mcp`). */
function packHasBuddy(pack: Modpack): boolean {
  return pack.mods.some((m) => m.includes("mod-buddy"));
}

/**
 * Written into every mod-buddy pack: any MCP client that reads `.mcp.json`
 * (Claude Code first among them) auto-connects `pattern mcp` — the project's
 * tool workflows over stdio, including the ten `pattern_*` control-plane tools
 * (list/search ops + docs, get/validate/save workflow drafts, inspect runs).
 * Stdio is the local trust posture: no tokens, the shell already owns the box.
 */
const MCP_CONFIG = `{
  "mcpServers": {
    "pattern": {
      "command": "npx",
      "args": ["pattern", "mcp"]
    }
  }
}
`;
/** Accept short ids ("azure") or full packages ("@ai-sdk/azure"). */
const normProvider = (id: string): string => (id.startsWith("@ai-sdk/") ? id : "@ai-sdk/" + id);
/** The version range for a provider package (falls back to latest for an unknown one). */
const providerRange = (pkg: string): string => AI_PROVIDERS.find((p) => p.value === pkg)?.range ?? "latest";

/** One alias the scaffold pre-writes into `.pattern-data/ai-config.json`. */
interface SeededAlias {
  name: "default" | "embeddings";
  provider: string;
  modelId: string;
  modality: "language" | "embedding";
  envKey: string;
}
interface SeedPlan {
  aliases: SeededAlias[];
  /** The env var(s) that unlock the seeded aliases (deduped). */
  envKeys: string[];
}

/**
 * What the picked providers let us seed: `default` from the first pick with a
 * language seed, `embeddings` from the first with an embedding seed (they can
 * differ — anthropic + openai seeds Claude for language, OpenAI for
 * embeddings). No seedable pick → null, and the "create aliases in Settings"
 * next-steps stay. Pure, so the manifest card and next-steps render the same
 * plan the scaffold writes.
 */
function aliasSeedPlan(providers: string[]): SeedPlan | null {
  const seeds = providers
    .map((id) => AI_PROVIDERS.find((x) => x.value === normProvider(id))?.seed)
    .filter((s): s is NonNullable<AiProviderChoice["seed"]> => s !== undefined);
  const lang = seeds.find((s) => s.language);
  const emb = seeds.find((s) => s.embedding);
  if (!lang && !emb) return null;
  const aliases: SeededAlias[] = [];
  if (lang) aliases.push({ name: "default", provider: lang.provider, modelId: lang.language!, modality: "language", envKey: lang.envKey });
  if (emb) aliases.push({ name: "embeddings", provider: emb.provider, modelId: emb.embedding!, modality: "embedding", envKey: emb.envKey });
  return { aliases, envKeys: [...new Set(aliases.map((a) => a.envKey))] };
}

/** The model aliases an AI pack can use — one per modality. `default` (text) is the
 *  only one strictly required; the rest unlock image/speech/transcription ops. */
const AI_ALIASES: Array<[string, string]> = [
  ["default", "default text model (required)"],
  ["image", "image generation"],
  ["speech", "text-to-speech"],
  ["transcription", "speech-to-text"],
];
/** "Next steps" lines suggesting the model aliases to create for an AI pack. */
function aliasLines(items: Array<[string, string]> = AI_ALIASES): string[] {
  return [
    `${pc.cyan("→")} create model aliases in admin → ${pc.bold("Settings → AI Providers")} ${pc.dim("— each brings its own key (vault or env var):")}`,
    ...items.map(([n, d]) => `     ${pc.bold(n)}${" ".repeat(Math.max(1, 15 - n.length))}${pc.dim(d)}`),
  ];
}

/**
 * The model-alias next steps: with a seed plan, the aliases already exist —
 * the only step is the key; without one, the manual how-to (aliasLines).
 */
function modelLines(seeded: SeedPlan | null): string[] {
  if (!seeded) return aliasLines();
  const show = (a: SeededAlias) => `${pc.bold(a.name)} ${pc.dim(`(${a.provider} ${a.modelId})`)}`;
  const lines = [
    `${pc.cyan("→")} model aliases seeded: ${seeded.aliases.map(show).join(" + ")} — set ${seeded.envKeys.map((k) => pc.bold(k)).join(" + ")} in ${pc.bold(".env")} ${pc.dim("(re-point them anytime in admin → Settings → AI Providers)")}`,
  ];
  if (!seeded.aliases.some((a) => a.name === "default")) {
    lines.push(`${pc.cyan("→")} add a ${pc.bold("default")} language alias in admin → ${pc.bold("Settings → AI Providers")} ${pc.dim("— agents and chat fall back to it")}`);
  }
  if (!seeded.aliases.some((a) => a.name === "embeddings")) {
    lines.push(`${pc.cyan("→")} add an ${pc.bold("embeddings")} alias ${pc.dim("(modality: embedding)")} in admin → ${pc.bold("Settings → AI Providers")} ${pc.dim("— RAG + semantic search need it")}`);
  }
  return lines;
}

/** The vault line for an AI pack. Provider keys are added per alias (vault or
 *  env) on the AI Providers page, so we only flag the auto-generated vault key. */
function vaultLine(vaultKey: boolean): string {
  return vaultKey
    ? `${pc.cyan("→")} a vault key was generated in ${pc.bold(".env")} ${pc.dim("— it encrypts the provider keys you add")}`
    : `${pc.dim("$")} cp .env.example .env ${pc.dim("— then add a PATTERN_VAULT_KEY (openssl rand -base64 32)")}`;
}

/** The Buddy + Claude Code lines for packs that wire mod-buddy. */
function buddyNextLines(): string[] {
  return [
    `${pc.green("✦")} Buddy: the ✦ toggle in the editor toolbar ${pc.dim("— drafts, validates and repairs workflows with you (talks through the default alias)")}`,
    `${pc.green("✦")} Claude Code: open this folder — ${pc.bold(".mcp.json")} connects your app's ${pc.bold("pattern_*")} tools ${pc.dim("(ops, docs, validate, drafts, runs)")}`,
  ];
}

/** A pack-aware "make it yours" tip — fork the thing that defines the agent. */
function personalizeLine(packId: string, examples: boolean): string | null {
  switch (packId) {
    case "agent-chat":
      // The turn pipeline is platform, not an example — always there to fork.
      return `${pc.cyan("→")} make it yours: ${pc.dim("fork the turn pipeline in the admin editor — swap the model, instructions, tools or guardrails")}`;
    case "agentic":
      return examples
        ? `${pc.cyan("→")} make it yours: ${pc.dim("fork the agent workflow (agents.agent → agents.run) — change the model, instructions or tools")}`
        : null;
    case "studio-ai":
    case "studio":
      return examples ? `${pc.cyan("→")} make it yours: ${pc.dim("fork an example workflow in the editor and rewire it")}` : null;
    default:
      return null;
  }
}

/** One-line technical role per mod — shown beside each in the manifest card. */
const MOD_ROLES: Record<string, string> = {
  "@pattern-js/mod-admin": "visual editor, run traces, /admin control plane",
  "@pattern-js/mod-agents": "agent ops: agent · run · tools · guardrail",
  "@pattern-js/mod-ai": "AI capabilities (text/image/embed/stt/tts/video) + the model provider",
  "@pattern-js/mod-agents + mod-ai": "agent ops + AI capabilities on any provider/model",
  "@pattern-js/mod-store": "durable state (sqlite): conversations, blobs, leases",
  "@pattern-js/mod-vault": "encrypted secrets — holds your provider keys",
  "@pattern-js/mod-chat": "the /chat product; its turn pipeline is a workflow",
  "@pattern-js/mod-identity": "users, sessions, roles → scopes",
  "@pattern-js/mod-auth-magic-link": "magic-link login (console fallback in dev)",
  "@pattern-js/mod-auth-oidc": "OIDC login — Google, Microsoft, any issuer",
  "./mods/oidc.mjs (app-local)": "app-local: your OIDC providers (issuer + client)",
  "@pattern-js/mod-email": "email accounts + email.send; delivers sign-in links",
  "@pattern-js/mod-email-resend": "Resend driver for mod-email",
  "@pattern-js/mod-email-smtp": "SMTP driver for mod-email (nodemailer)",
  "@pattern-js/mod-docs": "/docs: handbook + a live op reference",
  "@pattern-js/mod-vectors": "vector search: embedding collections, hybrid retrieval, RAG",
  "@pattern-js/mod-buddy": "Buddy: the editor assistant + the pattern_* MCP control plane",
  "./mods/quotes.mjs (app-local)": "app-local: example ops + an admin page",
  "./mods/uppercase.mjs (app-local)": "app-local: the app.shout op",
};

/** Ladder order (ascending capability) for the picker + --list. */
const LADDER = ["blank", "headless", "studio", "studio-ai", "agentic", "agent-chat"];

const MODPACKS: Modpack[] = [
  {
    id: "blank",
    label: "Engine only",
    hint: "no web server, no UI — run a workflow from code and watch it print; best for learning or embedding",
    rung: "the engine, in-process — no server",
    tagline: "the engine in-process — run workflows from code, no server",
    mods: [],
    exampleSummary: "one runnable example workflow (greeting)",
    serves: () => [],
    env: [],
    generates: (ex) => (ex ? ["workflows/greeting.json", "src/index.ts"] : ["workflows/ (your workflows)", "src/index.ts"]),
    next: ({ name, runCmd, installed, installLine, examples }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        `${pc.dim("$")} ${runCmd} dev   ${pc.dim(examples ? "— runs the greeting workflow, prints the result" : "— boots the engine")}`,
        ...(examples
          ? [`${pc.cyan("→")} edit ${pc.bold("workflows/greeting.json")} ${pc.dim("(hot-reloaded), or wire in core.string.* / core.math.* ops")}`]
          : ["", `${pc.cyan("→")} add a workflow in ${pc.bold("workflows/")} ${pc.dim("(see AGENTS.md), then engine.run() it from src/index.ts")}`]),
      ].filter((l) => l !== ""),
  },
  {
    id: "headless",
    label: "Headless server",
    hint: "a running server, no UI — serve HTTP, WebSocket, scheduled or CLI workflows; routes are JSON",
    rung: "+ the HTTP/WS/CLI host — serve workflows, no UI",
    tagline: "the engine + the HTTP/WS/CLI host — serve workflows as endpoints, no UI",
    mods: ["./mods/uppercase.mjs (app-local)"],
    exampleSummary: "4 example routes (hello/echo/shout/health) + the app.shout mod",
    serves: (ex) => (ex ? ["/hello/:name", "/echo", "/shout/:text", "/health"] : []),
    env: [],
    generates: (ex) =>
      ex
        ? ["workflows/hello.json + echo, shout, health", "mods/uppercase.mjs", "src/index.ts"]
        : ["workflows/ (your routes)", "mods/ (your ops)", "src/index.ts"],
    // APIs often start behind a gateway — opt in with one keystroke.
    auth: { default: false },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth, examples }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        ...(examples
          ? [
              `${pc.cyan("→")} curl localhost:3000/hello/world`,
              `${pc.cyan("→")} curl -XPOST localhost:3000/echo -H 'content-type: application/json' -d '{"message":"hi"}'`,
            ]
          : [`${pc.cyan("→")} add a route: a workflow with ${pc.bold("boundary.http.request → boundary.http.response")} in workflows/ (see AGENTS.md)`]),
        ...(auth
          ? [`${pc.cyan("→")} curl localhost:3000/whoami ${pc.dim("— 401 until you sign in (first boot prints a one-time link)")}`]
          : []),
      ].filter((l) => l !== ""),
  },
  {
    id: "studio",
    label: "Studio",
    hint: "a visual workspace at /admin — build, version, run & trace workflows in the browser (recommended)",
    rung: "+ mod-admin — a visual editor & run traces at /admin",
    tagline: "the engine + mod-admin — a visual editor, run traces & a versioned workflow store at /admin",
    mods: ["@pattern-js/mod-admin", "./mods/quotes.mjs (app-local)"],
    exampleSummary: "3 editable example workflows + an app-local mod (ops + an admin page)",
    serves: () => ["/admin"],
    env: [],
    generates: (ex) =>
      ex
        ? ["3 seeded workflows (in the admin store)", "mods/quotes.mjs", "src/index.ts"]
        : ["workflows/ (file workflows)", "mods/ (your ops)", "src/index.ts"],
    // Secure-by-default is the philosophy — the flagship pack ships locked.
    auth: { default: true },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth, examples }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        ...(auth
          ? [
              `${pc.cyan("→")} first boot prints a ${pc.bold("one-time admin link")} in the console — open it, you're the owner`,
              `${pc.cyan("→")} then ${pc.bold("http://localhost:3000/admin")} ${pc.dim("(sign-in links print to the console too)")}`,
            ]
          : [`${pc.cyan("→")} open ${pc.bold("http://localhost:3000/admin")}`]),
        examples
          ? `${pc.cyan("→")} the editor opens with 3 example workflows — fork one, or ${pc.dim("curl localhost:3000/hello/world")}`
          : `${pc.cyan("→")} build your first workflow in the editor ${pc.dim("(or drop JSON in workflows/ — see AGENTS.md)")}`,
      ].filter((l) => l !== ""),
  },
  {
    id: "studio-ai",
    label: "Studio + AI",
    hint: "call AI ops directly in the editor — text/object/embed/image/speech ops + vault; no agent loop",
    rung: "+ mod-ai — text/object/image/speech ops, any provider",
    tagline: "Studio + mod-ai — build plain AI workflows (text · object · image · speech) in the editor",
    mods: ["@pattern-js/mod-ai", "@pattern-js/mod-vectors", "@pattern-js/mod-store", "@pattern-js/mod-vault", "@pattern-js/mod-admin"],
    exampleSummary: "an AI workflow (POST /summarize → ai.text.generate, no agent)",
    serves: (ex) => (ex ? ["/admin", "/summarize"] : ["/admin"]),
    env: ["PATTERN_VAULT_KEY"],
    generates: (ex) =>
      ex
        ? ["workflows/summarize.json", "src/index.ts", ".env.example"]
        : ["workflows/ (your AI flows)", "src/index.ts", ".env.example"],
    auth: { default: true },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth, examples, vaultKey, seeded }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        vaultLine(vaultKey),
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        ...(auth
          ? [`${pc.cyan("→")} admin is locked — first boot prints a one-time owner link; then ${pc.bold("http://localhost:3000/admin")}`]
          : [`${pc.cyan("→")} open ${pc.bold("http://localhost:3000/admin")}`]),
        ...modelLines(seeded),
        examples
          ? `${pc.cyan("→")} curl -XPOST localhost:3000/summarize -H 'content-type: application/json' -d '{"text":"…"}' ${pc.dim("— ai.text.generate, no agent")}`
          : `${pc.cyan("→")} build an AI workflow: ${pc.bold("ai.alias → ai.text.generate")} (see AGENTS.md)`,
      ].filter((l) => l !== ""),
  },
  {
    id: "agentic",
    label: "Studio + AI + Agents",
    hint: "build agentic workflows in the editor — agent/run/tools ops + AI + vault + store; no chat UI",
    rung: "+ the agent stack — agentic workflows in the editor",
    tagline: "Studio + AI + the agent stack — build agentic workflows (agent · run · tools) in the editor",
    mods: [
      "@pattern-js/mod-agents + mod-ai",
      "@pattern-js/mod-vectors",
      "@pattern-js/mod-buddy",
      "@pattern-js/mod-store",
      "@pattern-js/mod-vault",
      "@pattern-js/mod-admin",
    ],
    exampleSummary: "an agentic workflow (POST /ask → agent + tool), a get_time tool, and a RAG pair (ingest + ask)",
    serves: (ex) => (ex ? ["/admin", "/ask", "/rag/ask"] : ["/admin"]),
    env: ["PATTERN_VAULT_KEY"],
    generates: (ex) =>
      ex
        ? ["workflows/agent-answer.json", "workflows/tool-time.json", "workflows/rag-ingest.json", "workflows/rag-ask.json", "src/index.ts", ".env.example"]
        : ["workflows/ (your agentic flows)", "src/index.ts", ".env.example"],
    auth: { default: true },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth, examples, vaultKey, seeded }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        vaultLine(vaultKey),
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        ...(auth
          ? [`${pc.cyan("→")} admin is locked — first boot prints a one-time owner link; then ${pc.bold("http://localhost:3000/admin")}`]
          : [`${pc.cyan("→")} open ${pc.bold("http://localhost:3000/admin")}`]),
        ...modelLines(seeded),
        examples
          ? `${pc.cyan("→")} curl -XPOST localhost:3000/ask -H 'content-type: application/json' -d '{"question":"what time is it?"}' ${pc.dim("— the agent calls get_time (a linked sub-run)")}`
          : `${pc.cyan("→")} build an agentic workflow: ${pc.bold("agents.agent → agents.run")} (see AGENTS.md)`,
        ...(examples
          ? [
              `${pc.cyan("→")} RAG pair: POST ${pc.bold("/rag/ingest")} {"docs":[{"id":"…","text":"…"}]} feeds the kb, POST ${pc.bold("/rag/ask")} {"question":"…"} answers from it ${pc.dim("(needs the embeddings alias)")}`,
            ]
          : []),
        ...buddyNextLines(),
      ].filter((l) => l !== ""),
  },
  {
    id: "agent-chat",
    label: "Studio + Agentic Chat",
    hint: "a chat product at /chat — tools, guardrails, HITL — the turn pipeline is an agentic workflow",
    rung: "+ mod-chat — the /chat product",
    tagline: "Studio + Agents + mod-chat — the /chat product whose turn pipeline is an agentic workflow",
    mods: [
      "@pattern-js/mod-chat",
      "@pattern-js/mod-agents + mod-ai",
      "@pattern-js/mod-vectors",
      "@pattern-js/mod-buddy",
      "@pattern-js/mod-store",
      "@pattern-js/mod-vault",
      "@pattern-js/mod-admin",
    ],
    exampleSummary: "two example chat tools (get_time, get_weather)",
    serves: () => ["/chat", "/admin"],
    env: ["PATTERN_VAULT_KEY"],
    generates: (ex) =>
      ex
        ? ["workflows/tool-time.json", "workflows/tool-weather.json", "src/index.ts", ".env.example"]
        : ["workflows/ (your tools)", "src/index.ts", ".env.example"],
    auth: { default: true },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth, examples, vaultKey, seeded }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        vaultLine(vaultKey),
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        `${pc.cyan("→")} chat at ${pc.bold("http://localhost:3000/chat")}`,
        ...(auth
          ? [`${pc.cyan("→")} admin is locked — first boot prints a one-time owner link`]
          : [`${pc.cyan("→")} admin at ${pc.bold("http://localhost:3000/admin")}`]),
        ...modelLines(seeded),
        examples
          ? `${pc.cyan("→")} ask it ${pc.bold('"what time is it?"')} ${pc.dim("— the agent calls the get_time tool (a linked sub-run)")}`
          : `${pc.cyan("→")} add a tool workflow (see AGENTS.md), then ask the agent to call it`,
        ...buddyNextLines(),
      ].filter((l) => l !== ""),
  },
];

/** Old template ids → modpacks, so existing scripts keep working. */
const LEGACY_IDS: Record<string, string> = {
  "hello-workflow": "blank",
  "http-api": "headless",
};

const PMS = ["npm", "pnpm", "yarn", "bun"] as const;
type Pm = (typeof PMS)[number];

interface Flags {
  name?: string;
  modpack?: string;
  pm?: Pm;
  install: boolean;
  git: boolean;
  yes: boolean;
  list: boolean;
  help: boolean;
  /** undefined = ask (interactive) / pack default (headless). */
  auth?: boolean;
  /** Magic-link sign-in (auth only). undefined = ask / default ON. */
  magicLink?: boolean;
  /** OIDC sign-in (auth only) — writes mods/oidc.mjs. undefined = ask / default OFF. */
  oidc?: boolean;
  /** Sign-in link delivery (magic-link only). undefined = ask / default console. */
  email?: EmailDelivery;
  /** Same tri-state as auth. */
  docs?: boolean;
  /** undefined = ask (interactive) / default ON (headless). */
  examples?: boolean;
  /** undefined = ask (vault packs only) / default ON. Generate PATTERN_VAULT_KEY into .env. */
  vaultKey?: boolean;
  /** Extra AI providers (short id or @ai-sdk pkg) to install. undefined = ask (mod-ai packs). */
  providers?: string[];
  /** Print the manifest for the resolved selection and write nothing. */
  dryRun: boolean;
  /** What to scaffold: an app (default) or a publishable mod. undefined = ask. */
  kind?: "app" | "mod";
  /** Mod pieces (tri-state like auth/docs). */
  modOps?: boolean;
  modWorkflows?: boolean;
  /** Mod admin page tier. undefined = ask / default tier1. */
  modAdmin?: "none" | "tier1" | "tier2";
  /** npm scope for a mod, e.g. "@acme" → @acme/mod-<name>. */
  modScope?: string;
}

/** Reject an invalid flag value with the same friendly shape everywhere. */
function oneOf<T extends string>(flag: string, value: string | undefined, allowed: readonly T[]): T {
  if (!value || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${flag} must be ${allowed.join(", ")} (got "${value ?? ""}")`);
  }
  return value as T;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { install: true, git: true, yes: false, list: false, help: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--modpack" || a === "-m" || a === "--template" || a === "-t") flags.modpack = argv[++i];
    else if (a === "--pm") flags.pm = oneOf("--pm", argv[++i], PMS);
    else if (a === "--no-install") flags.install = false;
    else if (a === "--no-git") flags.git = false;
    else if (a === "--auth") flags.auth = true;
    else if (a === "--no-auth") flags.auth = false;
    else if (a === "--magic-link") flags.magicLink = true;
    else if (a === "--no-magic-link") flags.magicLink = false;
    else if (a === "--oidc") flags.oidc = true;
    else if (a === "--no-oidc") flags.oidc = false;
    else if (a === "--email") flags.email = oneOf("--email", argv[++i], ["console", "resend", "smtp"] as const);
    else if (a === "--docs") flags.docs = true;
    else if (a === "--no-docs") flags.docs = false;
    else if (a === "--examples") flags.examples = true;
    else if (a === "--no-examples") flags.examples = false;
    else if (a === "--vault-key") flags.vaultKey = true;
    else if (a === "--no-vault-key") flags.vaultKey = false;
    else if (a === "--providers") {
      const ids = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const id of ids) {
        const pkg = normProvider(id);
        if (!AI_PROVIDERS.some((p) => p.value === pkg)) {
          throw new Error(`--providers: unknown AI provider "${id}" — use an @ai-sdk id like openai, anthropic, google (short or full package name)`);
        }
      }
      flags.providers = ids;
    }
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--list" || a === "-l") flags.list = true;
    else if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--dry-run" || a === "--dry") flags.dryRun = true;
    else if (a === "--kind") flags.kind = oneOf("--kind", argv[++i], ["app", "mod"] as const);
    else if (a === "--ops") flags.modOps = true;
    else if (a === "--no-ops") flags.modOps = false;
    else if (a === "--workflows") flags.modWorkflows = true;
    else if (a === "--no-workflows") flags.modWorkflows = false;
    else if (a === "--admin") flags.modAdmin = oneOf("--admin", argv[++i], ["none", "tier1", "tier2"] as const);
    else if (a === "--scope") flags.modScope = argv[++i];
    else if (!a.startsWith("-") && !flags.name) flags.name = a;
  }
  if (flags.modpack && LEGACY_IDS[flags.modpack]) flags.modpack = LEGACY_IDS[flags.modpack];
  // A modpack implies an app (the app ladder); never ask kind then.
  if (flags.modpack) flags.kind = "app";
  return flags;
}

function banner(): void {
  const lines = ["┌─┐┌─┐┌┬┐┌┬┐┌─┐┬─┐┌┐┌", "├─┘├─┤ │  │ ├┤ ├┬┘│││", "┴  ┴ ┴ ┴  ┴ └─┘┴└─┘└┘"];
  const colors = [pc.magenta, pc.magentaBright ?? pc.magenta, pc.cyan];
  console.log("");
  lines.forEach((l, i) => console.log("  " + (colors[i] ?? pc.cyan)(l)));
  console.log("  " + pc.dim("workflows as data · ops as code · mods all the way down\n"));
}

function detectPm(): Pm {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("yarn")) return "yarn";
  if (ua.startsWith("bun")) return "bun";
  return "npm";
}

/** Resolve the display-name → npm-name (drops the "(app-local)" annotation). */
function modPath(display: string): string {
  return display.replace(/\s*\(app-local\)\s*$/, "");
}

/** The resolved orthogonal dimensions of a scaffold. */
interface Dims {
  auth: boolean;
  magicLink: boolean;
  oidc: boolean;
  email: EmailDelivery;
  docs: boolean;
  examples: boolean;
  vaultKey: boolean;
  providers: string[];
}

/**
 * The manifest card: a computed, accurate preview of exactly what gets wired
 * and generated — mods + their roles, the file tree, the endpoints served, the
 * env it needs. Everything here is derived from the actual selections.
 */
function packCard(pack: Modpack, dims: Dims): string {
  const { auth, magicLink, oidc, email, docs, examples, vaultKey, providers } = dims;
  // Mods, in install order: identity + sign-in methods first (infra), email
  // delivery, pack mods, docs last.
  const packMods = examples ? pack.mods : pack.mods.filter((m) => !m.includes("(app-local)"));
  const authMods = auth
    ? [IDENTITY_MOD, ...(magicLink ? [MAGIC_LINK_MOD] : []), ...(oidc ? [OIDC_MOD, "./mods/oidc.mjs (app-local)"] : [])]
    : [];
  const emailMods = auth && magicLink && email !== "console" ? [EMAIL_MOD, EMAIL_DRIVERS[email]!] : [];
  const modList = [...authMods, ...emailMods, ...packMods, ...(docs ? [DOCS_MOD] : [])];
  const roleOf = (m: string) => MOD_ROLES[m] ?? "";
  const width = Math.max(0, ...modList.map((m) => modPath(m).length));
  const modLines = modList.length
    ? modList.map((m) => `  ${pc.magenta(modPath(m).padEnd(width))}  ${pc.dim(roleOf(m))}`)
    : [`  ${pc.dim("none — just the engine, in-process")}`];

  const seeded = aliasSeedPlan(providers);
  const files = [
    ...pack.generates(examples),
    ...(pack.id === "agentic" && examples && auth && magicLink && email === "resend" ? ["workflows/email-agent-reply.json"] : []),
    ...(seeded ? [`.pattern-data/ai-config.json (model aliases: ${seeded.aliases.map((a) => a.name).join(" + ")})`] : []),
    ...(packHasBuddy(pack) ? [".mcp.json (Claude Code → pattern mcp)"] : []),
  ];
  const fileLines = files.map((f) => `  ${pc.cyan("›")} ${f}`);

  // /whoami ships whenever headless+auth (applyAuth writes it example-free too).
  const serves = [...pack.serves(examples), ...(docs ? ["/docs"] : []), ...(auth && pack.id === "headless" ? ["/whoami"] : [])];
  const env = [...pack.env, ...(seeded?.envKeys ?? [])];

  const blocks: string[] = [`${pc.dim(pack.tagline)}`, "", pc.bold("mods"), ...modLines, "", pc.bold("generates"), ...fileLines];
  if (serves.length) blocks.push("", `${pc.bold("serves")}   ${serves.map((s) => pc.cyan(s)).join(pc.dim(" · "))}`);
  if (env.length) {
    const annotate = (e: string) =>
      e === "PATTERN_VAULT_KEY" && vaultKey
        ? `${pc.magenta(e)} ${pc.green("(generated → .env)")}`
        : seeded?.envKeys.includes(e)
          ? `${pc.magenta(e)} ${pc.dim("(model aliases)")}`
          : pc.magenta(e);
    const hint = env.includes("PATTERN_VAULT_KEY") && !vaultKey ? pc.dim("  (vault key: openssl rand -base64 32)") : "";
    blocks.push(`${pc.bold("needs")}    ${env.map(annotate).join(pc.dim(" · "))}${hint}`);
  }
  blocks.push("", `${pc.green("✦")} AGENTS.md + CLAUDE.md — the recipes your coding agent reads`);
  return blocks.join("\n");
}

/**
 * Resolve the orthogonal dimensions from flags + pack defaults (no prompts).
 * A flag that can't apply to the selection isn't an error — the scaffold still
 * does the right thing — but it isn't silent either: each one becomes a note
 * the caller prints.
 */
function resolveDims(pack: Modpack, flags: Flags): { dims: Dims; notes: string[] } {
  const notes: string[] = [];
  const auth = pack.auth ? (flags.auth ?? pack.auth.default) : false;
  const magicLink = auth ? (flags.magicLink ?? true) : false;
  const oidc = auth ? (flags.oidc ?? false) : false;
  if (auth && !magicLink && !oidc) {
    throw new Error("auth needs at least one sign-in method — keep magic link or add --oidc");
  }
  if (!pack.auth && flags.auth) notes.push(`--auth ignored (the ${pack.id} pack has no HTTP host to secure)`);
  if (!auth && flags.magicLink !== undefined) notes.push("--magic-link ignored (auth is off)");
  if (!auth && flags.oidc !== undefined) notes.push("--oidc ignored (auth is off)");
  if (flags.email !== undefined && !auth) notes.push("--email ignored (auth is off)");
  if (flags.email !== undefined && auth && !magicLink) notes.push("--email ignored (magic link is off — email delivers magic links)");
  if (flags.docs !== undefined && !pack.docs) notes.push(`--docs ignored (the ${pack.id} pack has no HTTP host)`);
  if (flags.docs === false && packHasBuddy(pack)) notes.push("--no-docs ignored (Buddy's knowledge engine reads the docs — this pack keeps /docs)");
  if (flags.vaultKey !== undefined && !packNeedsVault(pack)) notes.push(`--vault-key ignored (the ${pack.id} pack has no vault)`);
  if (flags.providers !== undefined && !packUsesAi(pack)) notes.push(`--providers ignored (the ${pack.id} pack has no mod-ai)`);
  return {
    dims: {
      auth,
      magicLink,
      oidc,
      email: auth && magicLink ? (flags.email ?? "console") : "console",
      // Buddy packs always ship docs: mod-buddy's tools wire docs.* ops and its
      // knowledge engine retrieves over the handbook — without mod-docs the
      // seeded tool workflows can't validate and the app won't boot.
      docs: packHasBuddy(pack) ? true : pack.docs ? (flags.docs ?? pack.docs.default) : false,
      examples: flags.examples ?? true,
      vaultKey: packNeedsVault(pack) ? (flags.vaultKey ?? true) : false,
      providers: packUsesAi(pack) ? (flags.providers ?? []).map(normProvider) : [],
    },
    notes,
  };
}

/** --dry-run: print exactly what WOULD be wired & generated, write nothing. */
function previewManifest(flags: Flags): void {
  banner();
  if ((flags.kind ?? "app") === "mod") {
    const name = flags.name ?? "my-mod";
    const pieces = resolveModPieces(flags);
    const pkgName = modPkgName(name, flags.modScope ?? "");
    console.log(`  ${pc.bold("Mod")} ${pc.dim(pkgName)}\n`);
    console.log(
      modCard(pkgName, pieces)
        .split("\n")
        .map((l) => "  " + l)
        .join("\n"),
    );
    console.log("\n  " + pc.dim("dry run — nothing written. Drop --dry-run to scaffold."));
    return;
  }
  const pack = packOrThrow(flags.modpack ?? "studio");
  const { dims, notes } = resolveDims(pack, flags);
  const { auth, oidc, email, docs, examples } = dims;
  console.log(
    `  ${pc.bold(pack.label)} ${pc.dim(`(${pack.id}${examples ? "" : ", no examples"}${auth ? ", auth" : ""}${oidc ? ", oidc" : ""}${email !== "console" ? `, email ${email}` : ""}${docs ? ", docs" : ""})`)}\n`,
  );
  for (const n of notes) console.log(`  ${pc.yellow("note:")} ${n}`);
  if (notes.length) console.log("");
  console.log(
    packCard(pack, dims)
      .split("\n")
      .map((l) => "  " + l)
      .join("\n"),
  );
  console.log("\n  " + pc.dim("dry run — nothing written. Drop --dry-run to scaffold."));
}

function listPacks(): void {
  console.log(`\n${pc.bold("Modpacks")} — a ladder; each rung adds one capability:\n`);
  for (const pack of LADDER.map((id) => packOrThrow(id))) {
    const authNote = pack.auth ? pc.dim(`  (auth: ${pack.auth.default ? "on" : "off"}, docs: ${pack.docs?.default ? "on" : "off"} by default)`) : "";
    console.log(`  ${pc.cyan(pack.id.padEnd(12))}${pack.label} — ${pc.dim(pack.hint)}${authNote}`);
  }
  console.log(
    `\n  ${pc.dim("npm create pattern@latest my-app -- --modpack <id> [--auth|--no-auth] [--oidc] [--email console|resend|smtp] [--docs|--no-docs] [--examples|--no-examples]")}`,
  );
  console.log(`  ${pc.dim("examples are included by default — pass --no-examples for a clean scaffold. --help for every flag.")}\n`);
}

/** --help: the full flag reference (the wizard covers the rest). */
function usage(): void {
  const f = (flag: string, desc: string) => `    ${flag.padEnd(31)}${pc.dim(desc)}`;
  console.log(
    [
      "",
      `  ${pc.bold("create-pattern")} — scaffold a Pattern project`,
      "",
      `  ${pc.bold("Usage")}`,
      `    npm create pattern@latest ${pc.dim("[name] [options]")}`,
      "",
      `  ${pc.bold("Modpacks")} ${pc.dim("(--list for the ladder)")}`,
      f("--modpack, -m <id>", "blank | headless | studio | studio-ai | agentic | agent-chat"),
      "",
      `  ${pc.bold("Dimensions")} ${pc.dim("(omit a flag = ask, or take the pack default)")}`,
      f("--auth | --no-auth", "identity + sign-in, users & sessions"),
      f("--magic-link | --no-magic-link", "magic-link sign-in (default on with auth)"),
      f("--oidc | --no-oidc", "OIDC sign-in — writes mods/oidc.mjs to fill in"),
      f("--email <console|resend|smtp>", "how magic links reach users"),
      f("--docs | --no-docs", "/docs — the handbook + a live op reference"),
      f("--examples | --no-examples", "demo workflows/tools (default on)"),
      f("--vault-key | --no-vault-key", "generate PATTERN_VAULT_KEY into .env"),
      f("--providers <a,b,…>", "AI provider packages (openai, anthropic, …)"),
      "",
      `  ${pc.bold("Mods")} ${pc.dim("(--kind mod scaffolds a publishable mod)")}`,
      f("--kind <app|mod>", "what to scaffold (default app)"),
      f("--scope <@acme>", "npm scope → @acme/mod-<name>"),
      f("--ops | --no-ops", "an example op"),
      f("--workflows | --no-workflows", "an example HTTP route"),
      f("--admin <none|tier1|tier2>", "admin page tier"),
      "",
      `  ${pc.bold("General")}`,
      f("--pm <npm|pnpm|yarn|bun>", "package manager (default: detected)"),
      f("--no-install", "skip dependency install"),
      f("--no-git", "skip git init"),
      f("--yes, -y", "non-interactive — flags + defaults, no prompts"),
      f("--dry-run", "print the manifest, write nothing"),
      f("--list, -l", "list modpacks"),
      f("--help, -h", "this help"),
      "",
    ].join("\n"),
  );
}

async function copyTemplate(packId: string, targetDir: string, vars: Record<string, string>): Promise<void> {
  const src = join(TEMPLATES_DIR, packId);
  await cp(src, targetDir, { recursive: true });
  // _gitignore → .gitignore (npm strips .gitignore from published packages).
  if (existsSync(join(targetDir, "_gitignore"))) {
    await rename(join(targetDir, "_gitignore"), join(targetDir, ".gitignore"));
  }
  // _env.example → .env.example (same npm-stripping dance for dotfiles).
  if (existsSync(join(targetDir, "_env.example"))) {
    await rename(join(targetDir, "_env.example"), join(targetDir, ".env.example"));
  }
  // Replace {{name}} / {{pkgName}} / … placeholders in text files.
  await replacePlaceholders(targetDir, vars);
}

async function replacePlaceholders(dir: string, vars: Record<string, string>): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      await replacePlaceholders(full, vars);
    } else {
      const s = await stat(full);
      if (s.size > 1_000_000) continue;
      let text: string;
      try {
        text = await readFile(full, "utf8");
      } catch {
        continue;
      }
      // Note: no inner whitespace — `{{name}}` is a scaffold var, while the
      // Pattern runtime template syntax `{{ name }}` (with spaces) is preserved.
      const replaced = text.replace(/\{\{(\w+)\}\}/g, (m, key) => vars[key] ?? m);
      if (replaced !== text) await writeFile(full, replaced);
    }
  }
}

function packOrThrow(id: string): Modpack {
  const pack = MODPACKS.find((t) => t.id === id);
  if (!pack) throw new Error(`unknown modpack "${id}" (have: ${MODPACKS.map((t) => t.id).join(", ")})`);
  return pack;
}

/**
 * Pin every @pattern-js/* range in the scaffolded package.json to this CLI's
 * own minor (PATTERN_RANGE). The static templates carry whatever range was
 * current when they were written; this rewrite is what guarantees a scaffold
 * resolves the mods published alongside the CLI it was created with.
 */
async function normalizeDepRanges(targetDir: string): Promise<void> {
  const pkgPath = join(targetDir, "package.json");
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, Record<string, string> | undefined>;
  let touched = false;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (name.startsWith("@pattern-js/") && deps[name] !== PATTERN_RANGE) {
        deps[name] = PATTERN_RANGE;
        touched = true;
      }
    }
  }
  if (touched) await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

/**
 * Flip the auth dimension on: wire identity + the chosen sign-in methods into
 * the manifest and the config (FIRST in the list — they're infrastructure),
 * and give headless packs a protected /whoami route so the value is curl-able
 * in minute one. OIDC's wrapper file is applyOidc's job.
 */
async function applyAuth(targetDir: string, packId: string, magicLink: boolean): Promise<void> {
  const mods = [IDENTITY_MOD, ...(magicLink ? [MAGIC_LINK_MOD] : [])];
  const pkgPath = join(targetDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { dependencies: Record<string, string> };
  for (const mod of mods) pkg.dependencies[mod] = PATTERN_RANGE;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const cfgPath = join(targetDir, "pattern.config.json");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as { mods: string[] };
  cfg.mods = [...mods, ...cfg.mods];
  await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

  if (packId === "headless") {
    await writeFile(join(targetDir, "workflows", "whoami.json"), WHOAMI_WORKFLOW);
  }
}

/**
 * Flip sign-in link delivery to real email: mod-email + the chosen driver join
 * the manifest right after the identity mods (they serve auth). Console stays
 * the fallback until a "default" account exists in admin → System → Email, so
 * the scaffold still boots with zero config. Runs AFTER applyAuth, and only
 * when magic link is on (email is what carries the links).
 */
async function applyEmail(targetDir: string, delivery: EmailDelivery): Promise<void> {
  const driver = EMAIL_DRIVERS[delivery];
  if (!driver) return; // "console" — the status quo

  const pkgPath = join(targetDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { dependencies: Record<string, string> };
  for (const mod of [EMAIL_MOD, driver]) pkg.dependencies[mod] = PATTERN_RANGE;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const cfgPath = join(targetDir, "pattern.config.json");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as { mods: string[] };
  // After identity + magic-link (email only applies when magic link is on).
  const at = 2;
  cfg.mods = [...cfg.mods.slice(0, at), EMAIL_MOD, driver, ...cfg.mods.slice(at)];
  await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

  const hint =
    delivery === "resend"
      ? "# Email (Resend): the API key lives here or in the vault (admin → System → Secrets)\n# RESEND_API_KEY=\n"
      : "# Email (SMTP): host/port/user are account options in admin → System → Email;\n# the password lives here or in the vault (admin → System → Secrets)\n# SMTP_PASSWORD=\n";
  await appendEnvHint(
    targetDir,
    hint +
      "\n# The app's public origin (e.g. https://app.example.com) — emailed links\n" +
      "# (invites, sign-in) are built on it. Unset in dev = the request's host.\n" +
      "# PATTERN_PUBLIC_URL=\n",
  );
}

/** Append a commented hint to .env.example, creating the file for templates that ship none. */
async function appendEnvHint(targetDir: string, hint: string): Promise<void> {
  const envPath = join(targetDir, ".env.example");
  const current = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
  await writeFile(envPath, current ? `${current.replace(/\n*$/, "\n")}\n${hint}` : hint);
}

/**
 * The app-local OIDC wrapper the scaffold writes. The provider ships COMMENTED
 * OUT on purpose: the project boots clean (an empty provider list logs a hint
 * and contributes nothing), and the login button appears the moment a real
 * issuer + client id are filled in. The secret never lives in this file — it's
 * a { source, key } reference into env or the vault.
 */
const OIDC_WRAPPER = `/**
 * OIDC sign-in — your providers, code-configured (docs: /docs → "OIDC login").
 *
 * Google, Microsoft, Keycloak, Auth0 — any OpenID Connect issuer works. Several
 * providers can sit side by side; each becomes a button on the login page.
 * OIDC composes with magic-link: the same verified email is the same user.
 */
import { oidcMod } from "@pattern-js/mod-auth-oidc";

export default oidcMod({
  providers: [
    // 1. Create an OAuth client at your IdP.
    // 2. Register the redirect URI:
    //      http://localhost:3000/auth/oidc/google/callback   (+ your production host)
    // 3. Uncomment, fill in, and set GOOGLE_CLIENT_SECRET in .env —
    //    the "Continue with Google" button appears on the login page.
    // {
    //   id: "google",
    //   label: "Continue with Google",
    //   issuer: "https://accounts.google.com",
    //   clientId: "1234567890-abc.apps.googleusercontent.com",
    //   clientSecret: { source: "env", key: "GOOGLE_CLIENT_SECRET" },
    // },
  ],
});
`;

/**
 * Flip OIDC sign-in on: the mod-auth-oidc dep + an app-local wrapper mod at
 * mods/oidc.mjs (OIDC is code-configured — providers are code, secrets are
 * references). Runs AFTER applyEmail, so the config insert lands the sign-in
 * methods together: identity · magic-link · oidc · email · pack mods.
 */
async function applyOidc(targetDir: string, magicLink: boolean): Promise<void> {
  const pkgPath = join(targetDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { dependencies: Record<string, string> };
  pkg.dependencies[OIDC_MOD] = PATTERN_RANGE;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const cfgPath = join(targetDir, "pattern.config.json");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as { mods: string[] };
  const at = 1 + (magicLink ? 1 : 0); // right after identity (+ magic-link)
  cfg.mods = [...cfg.mods.slice(0, at), "./mods/oidc.mjs", ...cfg.mods.slice(at)];
  await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

  await mkdir(join(targetDir, "mods"), { recursive: true });
  await writeFile(join(targetDir, "mods", "oidc.mjs"), OIDC_WRAPPER);

  // The placeholder's secret ref points at env — make sure the hint has a home
  // even in templates that ship no .env.example.
  await appendEnvHint(targetDir, "# OIDC (mods/oidc.mjs): the client secret lives here or in the vault (admin → System → Secrets)\n# GOOGLE_CLIENT_SECRET=\n");
}

/** A pack that wires mod-vault — only these get the vault-key offer. */
function packNeedsVault(pack: Modpack): boolean {
  return pack.env.includes("PATTERN_VAULT_KEY");
}

/**
 * Write `.env` from `.env.example` with a freshly generated PATTERN_VAULT_KEY —
 * the vault's master key (random, local, what `openssl rand -base64 32` gives).
 * Provider keys stay blank — you add them per model alias (vault or env). `.env`
 * is gitignored. No-op if the template has no `.env.example`.
 */
async function applyVaultKey(targetDir: string): Promise<void> {
  const examplePath = join(targetDir, ".env.example");
  if (!existsSync(examplePath)) return;
  const key = randomBytes(32).toString("base64");
  const example = await readFile(examplePath, "utf8");
  const env = /^PATTERN_VAULT_KEY=.*$/m.test(example)
    ? example.replace(/^PATTERN_VAULT_KEY=.*$/m, `PATTERN_VAULT_KEY=${key}`)
    : `${example}\nPATTERN_VAULT_KEY=${key}\n`;
  await writeFile(join(targetDir, ".env"), env);
}

/**
 * Pre-write the seeded model aliases into `.pattern-data/ai-config.json` —
 * exactly the file admin → Settings → AI Providers manages, so a scaffold with
 * a provider pick boots with `default` (+ `embeddings`) already resolvable and
 * the ONLY remaining step is the key in `.env`. Each alias authenticates via an
 * env-sourced secret REF ({ source: "env", key }) — no value ever lands in the
 * scaffold. Runs BEFORE applyVaultKey so appended env hints reach the generated
 * `.env` too.
 */
async function applyAiAliases(targetDir: string, plan: SeedPlan): Promise<void> {
  const aliases = plan.aliases.map((a) => ({
    name: a.name,
    provider: a.provider,
    modelId: a.modelId,
    modality: a.modality,
    secrets: { apiKey: { source: "env", key: a.envKey } },
    options: {},
  }));
  await mkdir(join(targetDir, ".pattern-data"), { recursive: true });
  await writeFile(join(targetDir, ".pattern-data", "ai-config.json"), JSON.stringify({ aliases }, null, 2) + "\n");

  // Every referenced env key gets a line in .env.example (unless the template
  // already carries one, commented or not).
  const envPath = join(targetDir, ".env.example");
  const current = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
  const missing = plan.envKeys.filter((k) => !new RegExp(`^#?\\s*${k}=`, "m").test(current));
  if (missing.length) {
    await appendEnvHint(
      targetDir,
      `# The seeded model aliases (admin → Settings → AI Providers) read their key here\n${missing.map((k) => `${k}=`).join("\n")}\n`,
    );
  }
}

/**
 * Add the chosen AI providers to the project's deps. mod-ai bundles no provider
 * and lazy-imports an @ai-sdk package only when an alias uses that provider, so
 * the project carries exactly the providers it picked, nothing more. (The Vercel
 * AI Gateway ships inside `ai`, so it always works with no pick.)
 */
async function applyProviders(targetDir: string, providers: string[]): Promise<void> {
  const pkgPath = join(targetDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { dependencies: Record<string, string> };
  for (const id of providers) {
    const p = normProvider(id);
    pkg.dependencies[p] = providerRange(p);
  }
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

/** Flip the docs dimension on: /docs joins the manifest + config (last — it documents the rest). */
async function applyDocs(targetDir: string): Promise<void> {
  const pkgPath = join(targetDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { dependencies: Record<string, string> };
  pkg.dependencies[DOCS_MOD] = PATTERN_RANGE;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const cfgPath = join(targetDir, "pattern.config.json");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as { mods: string[] };
  cfg.mods = [...cfg.mods, DOCS_MOD];
  await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
}

// ── Examples dimension ───────────────────────────────────────────────────────
// "Examples" = the demo CUSTOM content (sample workflows, example tools,
// app-local demo mods). The platform mods and their built-in workflows always
// stay and always run. `--no-examples` strips the demos and leaves a runnable
// skeleton + notes on how to add your own.

const NOTE_WORKFLOWS = `# workflows/

Drop \`*.json\` workflow files here — each registers at boot (hot-reloaded by
\`npm run dev\`). See AGENTS.md for the workflow-JSON shape, and \`npx pattern ops\`
for every op you can wire.
`;

const NOTE_TOOLS = `# workflows/

Tool workflows live here — a workflow with a \`boundary.tool\` trigger and a
\`boundary.tool.return\` out-gate. The agent picks up every tool automatically
(via \`agents.tools.workflows\`). See AGENTS.md for the recipe.
`;

const NOTE_AGENTIC = `# workflows/

Agentic workflows live here — a graph that wires an agent (\`agents.agent\`)
into a runner (\`agents.run\`), plus tools (each a workflow with a
\`boundary.tool\` trigger). Build them in the editor at /admin or drop JSON
here. See AGENTS.md for the shape.
`;

const NOTE_MODS = `# mods/

App-local mods live here — a single \`.mjs\` (or \`.ts\`) file contributing ops
(and, with mod-admin, an admin page). List each in \`pattern.config.json\` →
\`mods\`. See AGENTS.md.
`;

const BLANK_INDEX = `/**
 * __NAME__ — the smallest Pattern program (engine only, no server).
 *
 * Workflows are *data*: drop a JSON graph in \`workflows/\` (declared in
 * \`pattern.config.json\`) and \`loadProject\` hands back a ready \`engine\`. See
 * AGENTS.md for the shape, and \`npx pattern ops\` for every op you can wire.
 */
import { loadProject } from "@pattern-js/runtime-node";

const { engine } = await loadProject();
void engine;

// Add a workflow in \`workflows/\`, then run it:
//   const result = await engine.run("<your-workflow-id>", { input: { /* … */ } });
//   console.log(result.outputs);
console.log("engine ready — add a workflow in workflows/ (see AGENTS.md), then call engine.run().");
`;

const HEADLESS_INDEX = `/**
 * __NAME__ — a server built from declarative workflows (HTTP, WS, scheduled, CLI).
 *
 * Triggers live in workflow config, not code: a \`boundary.http.request\`,
 * \`boundary.ws.*\`, \`boundary.schedule\` or \`boundary.cli\` op declares the
 * route/trigger; \`start()\` derives them and opens a server per declared port.
 * Drop a \`.json\` in \`workflows/\` (see AGENTS.md); \`npm run dev\` reloads it.
 */
import { loadProject } from "@pattern-js/runtime-node";

const { start } = await loadProject();
const { ports } = await start();

console.log(
  ports.length
    ? \`▶ listening on \${ports.map((p) => \`http://localhost:\${p}\`).join(", ")}\`
    : "▶ engine ready — no routes yet. Add one in workflows/ (see AGENTS.md).",
);
`;

const STUDIO_AI_INDEX = `/**
 * __NAME__ — build AI workflows on Pattern, with the visual admin.
 *
 * \`pattern.config.json\` wires the AI stack WITHOUT the agent layer: mod-vault
 * (encrypted provider keys), mod-store (blobs for generated media), mod-ai
 * (the capability ops — \`ai.text.*\`, \`ai.object.*\`, \`ai.embed*\`,
 * \`ai.image.*\`, \`ai.speech.*\`, \`ai.transcribe\`, \`ai.video.*\`) and
 * mod-admin (the editor + run traces at /admin). Build a flow in the editor or
 * drop JSON in \`workflows/\` (see AGENTS.md); models resolve from the aliases
 * you configure in admin → Settings → AI Providers.
 */
import { loadProject } from "@pattern-js/runtime-node";

const { start } = await loadProject();
const { ports } = await start();
const base = \`http://localhost:\${ports[0]}\`;

console.log(\`◆ __NAME__\`);
console.log(\`  Admin   \${base}/admin\`);
`;

const STUDIO_INDEX = `/**
 * __NAME__ — a Pattern engine wearing its admin.
 *
 * \`@pattern-js/mod-admin\` gives you the visual control plane at /admin (editor,
 * runs, observability). Author workflows there — they're versioned into
 * \`./.pattern\` (commit it: it's your deployable workflow store). Add app-local
 * ops or an admin page with a mod in \`mods/\` (see AGENTS.md).
 */
import { loadProject } from "@pattern-js/runtime-node";

const { start } = await loadProject();

const { ports } = await start();
const base = \`http://localhost:\${ports[0]}\`;

console.log(\`◆ __NAME__\`);
console.log(\`  Admin   \${base}/admin\`);
`;

interface ExampleSpec {
  workflows?: string[];
  mods?: string[];
  configMods?: string[];
  src?: string[];
  /** Root-relative extras that only make sense with the examples (load profiles, …). */
  files?: string[];
  index?: string;
  notes?: Record<string, string>;
}

const EXAMPLES: Record<string, ExampleSpec> = {
  blank: {
    workflows: ["greeting.json"],
    index: BLANK_INDEX,
    notes: { "workflows/README.md": NOTE_WORKFLOWS },
  },
  headless: {
    workflows: ["hello.json", "echo.json", "shout.json", "health.json"],
    mods: ["uppercase.mjs"],
    configMods: ["./mods/uppercase.mjs"],
    // The load profile targets the example routes — stale without them.
    files: ["load.example.json"],
    index: HEADLESS_INDEX,
    notes: { "workflows/README.md": NOTE_WORKFLOWS, "mods/README.md": NOTE_MODS },
  },
  studio: {
    mods: ["quotes.mjs"],
    configMods: ["./mods/quotes.mjs"],
    src: ["examples.ts"],
    index: STUDIO_INDEX,
    // workflows/README.md already ships in the studio template — keep it.
    notes: { "mods/README.md": NOTE_MODS },
  },
  "studio-ai": {
    workflows: ["summarize.json"],
    index: STUDIO_AI_INDEX,
    notes: { "workflows/README.md": NOTE_WORKFLOWS },
  },
  agentic: {
    workflows: ["agent-answer.json", "tool-time.json"],
    notes: { "workflows/README.md": NOTE_AGENTIC },
  },
  "agent-chat": {
    workflows: ["tool-time.json", "tool-weather.json"],
    notes: { "workflows/README.md": NOTE_TOOLS },
  },
};

/**
 * Strip a pack's demo content, leaving a runnable skeleton + notes. The
 * platform mods (admin, chat, …) and their built-in workflows are untouched.
 */
async function applyNoExamples(targetDir: string, packId: string, name: string): Promise<void> {
  const spec = EXAMPLES[packId];
  if (!spec) return;

  for (const f of spec.workflows ?? []) await rm(join(targetDir, "workflows", f), { force: true });
  for (const f of spec.mods ?? []) await rm(join(targetDir, "mods", f), { force: true });
  for (const f of spec.src ?? []) await rm(join(targetDir, "src", f), { force: true });
  for (const f of spec.files ?? []) await rm(join(targetDir, f), { force: true });

  if (spec.configMods?.length) {
    const cfgPath = join(targetDir, "pattern.config.json");
    const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as { mods: string[] };
    cfg.mods = cfg.mods.filter((m) => !spec.configMods!.includes(m));
    await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  }

  // Swap in an example-free entrypoint where the shipped one runs/prints demos.
  if (spec.index) {
    await writeFile(join(targetDir, "src", "index.ts"), spec.index.replaceAll("__NAME__", name));
  }

  // Leave a short note in any otherwise-empty scaffold dir (never clobber one
  // the template already ships).
  for (const [rel, body] of Object.entries(spec.notes ?? {})) {
    const full = join(targetDir, ...rel.split("/"));
    if (!existsSync(full)) await writeFile(full, body);
  }
}

async function runInteractive(flags: Flags): Promise<void> {
  banner();
  p.intro(pc.bgMagenta(pc.black(" create-pattern ")));

  const name =
    flags.name ??
    (await p.text({
      message: "Project name?",
      placeholder: "my-pattern-app",
      defaultValue: "my-pattern-app",
      validate: (v) => (v && /^[a-z0-9-_.]+$/i.test(v) ? undefined : "use letters, numbers, - _ ."),
    }))!;
  if (p.isCancel(name)) return cancel();

  // What are you creating? An app (the modpack ladder) or a publishable mod.
  const kind =
    flags.kind ??
    (await p.select({
      message: "What are you creating?",
      options: [
        { value: "app", label: "An app", hint: "a runnable Pattern project (engine / server / studio / chat)" },
        { value: "mod", label: "A mod", hint: "a publishable npm package that exports defineMod(...)" },
      ],
    }));
  if (p.isCancel(kind)) return cancel();
  if (kind === "mod") return runInteractiveMod(flags, String(name));

  if (!flags.modpack) {
    // Generated from LADDER so a new rung can never be forgotten here.
    const rungs = LADDER.map((id) => packOrThrow(id));
    const width = Math.max(...rungs.map((t) => t.label.length)) + 2;
    p.note(
      [`${pc.dim("Each rung adds one capability over the one before:")}`, ...rungs.map((t) => `${pc.cyan(t.label.padEnd(width))}${t.rung}`)].join("\n"),
      "The ladder",
    );
  }
  const packId =
    flags.modpack ??
    (await p.select({
      message: "Pick a modpack",
      initialValue: "studio",
      options: LADDER.map((id) => packOrThrow(id)).map((t) => ({ value: t.id, label: t.label, hint: t.hint })),
    }))!;
  if (p.isCancel(packId)) return cancel();
  const pack = packOrThrow(String(packId));

  // Auth is orthogonal to the pack — asked only where it makes sense.
  const packHasAdmin = pack.mods.some((m) => m.includes("mod-admin"));
  let auth = false;
  if (pack.auth) {
    if (flags.auth !== undefined) {
      auth = flags.auth;
    } else {
      const answer = await p.confirm({
        message: `Add authentication? ${pc.dim("sign-in (magic link / OIDC), users & sessions" + (packHasAdmin ? " — locks the admin" : ""))}`,
        initialValue: pack.auth.default,
      });
      if (p.isCancel(answer)) return cancel();
      auth = answer;
    }
  }

  // Sign-in methods — they compose (same verified email = same user), so this
  // is a multiselect: magic link (the zero-config default), OIDC, or both.
  let magicLink = auth;
  let oidc = false;
  if (auth) {
    if (flags.magicLink !== undefined || flags.oidc !== undefined) {
      magicLink = flags.magicLink ?? true;
      oidc = flags.oidc ?? false;
      if (!magicLink && !oidc) throw new Error("auth needs at least one sign-in method — keep magic link or add --oidc");
    } else {
      const sel = await p.multiselect({
        message: `Sign-in methods? ${pc.dim("both compose — the login page lists every method")}`,
        options: [
          { value: "magic-link", label: "Magic link", hint: "email links; console fallback in dev — zero config" },
          { value: "oidc", label: "OIDC", hint: "Google, Microsoft, Keycloak, any issuer — fill mods/oidc.mjs after scaffold" },
        ],
        initialValues: ["magic-link"],
        required: true,
      });
      if (p.isCancel(sel)) return cancel();
      const methods = sel as string[];
      magicLink = methods.includes("magic-link");
      oidc = methods.includes("oidc");
    }
  }

  // Sign-in link delivery — asked only with magic link (email carries the links).
  let email: EmailDelivery = "console";
  if (auth && magicLink) {
    if (flags.email !== undefined) {
      email = flags.email;
    } else {
      const answer = await p.select({
        message: `Sign-in link delivery? ${pc.dim("how magic links reach users — console works with zero config")}`,
        initialValue: "console" as EmailDelivery,
        options: [
          { value: "console", label: "Console (dev)", hint: "links print to the server console — zero config" },
          { value: "resend", label: "Resend", hint: "mod-email + the Resend driver; add the account in admin → System → Email" },
          { value: "smtp", label: "SMTP", hint: "mod-email + the SMTP driver (nodemailer); any relay or local catcher" },
        ],
      });
      if (p.isCancel(answer)) return cancel();
      email = answer as EmailDelivery;
    }
  }

  // Docs is orthogonal too — same tri-state as auth. Buddy packs don't ask:
  // mod-buddy's tools wire docs.* ops and its knowledge retrieves over the
  // handbook, so /docs is part of the pack.
  let docs = false;
  if (packHasBuddy(pack)) {
    docs = true;
  } else if (pack.docs) {
    if (flags.docs !== undefined) {
      docs = flags.docs;
    } else {
      const answer = await p.confirm({
        message: `Add documentation? ${pc.dim("/docs — the handbook + a live op reference; every mod's chapter")}`,
        initialValue: pack.docs.default,
      });
      if (p.isCancel(answer)) return cancel();
      docs = answer;
    }
  }

  // Examples are a dimension on every pack: the platform always runs, this
  // only toggles the demo content (sample workflows, tools, app-local mods).
  let examples = true;
  if (flags.examples !== undefined) {
    examples = flags.examples;
  } else {
    const answer = await p.confirm({
      message: `Include examples? ${pc.dim(pack.exampleSummary + " — off = a clean scaffold + notes")}`,
      initialValue: true,
    });
    if (p.isCancel(answer)) return cancel();
    examples = answer;
  }

  // Vault packs hold encrypted secrets and need a master key. Offer to generate
  // it now (random, local) so there's no openssl step before the first boot —
  // and so the role of the key is clear. (Never the API key: that's yours.)
  let vaultKey = false;
  if (packNeedsVault(pack)) {
    if (flags.vaultKey !== undefined) {
      vaultKey = flags.vaultKey;
    } else {
      const answer = await p.confirm({
        message: `Generate a vault key? ${pc.dim("mod-vault encrypts secrets at rest (e.g. your API key) and needs a master key — we'll write a fresh one to .env")}`,
        initialValue: true,
      });
      if (p.isCancel(answer)) return cancel();
      vaultKey = answer;
    }
  }

  // AI providers (only when the pack uses mod-ai). The Vercel AI Gateway ships
  // inside `ai` (always available); each pick adds an optional @ai-sdk package
  // mod-ai lazy-loads when an alias uses that provider.
  let providers: string[] = [];
  if (packUsesAi(pack)) {
    if (flags.providers !== undefined) {
      providers = flags.providers.map(normProvider);
    } else {
      const sel = await p.multiselect({
        message: `AI providers to install? ${pc.dim("the AI Gateway is built in; pick the direct providers you'll use")}`,
        options: AI_PROVIDERS,
        initialValues: AI_PROVIDERS_DEFAULT,
        required: false,
      });
      if (p.isCancel(sel)) return cancel();
      providers = sel as string[];
    }
  }

  // The pack card: what this modpack actually wires up.
  const dims: Dims = { auth, magicLink, oidc, email, docs, examples, vaultKey, providers };
  p.note(packCard(pack, dims), `${pack.label} modpack`);

  const pm =
    flags.pm ??
    (await p.select({
      message: "Package manager",
      initialValue: detectPm(),
      options: PMS.map((m) => ({ value: m, label: m })),
    }))!;
  if (p.isCancel(pm)) return cancel();

  const install = flags.yes ? flags.install : !p.isCancel(await p.confirm({ message: `Install deps with ${pm}?`, initialValue: flags.install }));

  await scaffold({ name: String(name), pack: pack.id, pm: pm as Pm, install, git: flags.git, ...dims });

  const runCmd = pm === "npm" ? "npm run" : String(pm);
  p.note(
    [
      ...pack.next({
        name: String(name),
        runCmd,
        installed: install,
        installLine: `${pc.dim("$")} ${pm} install`,
        auth,
        examples,
        vaultKey,
        seeded: aliasSeedPlan(providers),
      }),
      ...(oidc
        ? [
            `${pc.cyan("→")} OIDC: fill in ${pc.bold("mods/oidc.mjs")} ${pc.dim("(issuer + client id; the secret via env or vault), register")} ${pc.bold("/auth/oidc/<id>/callback")} ${pc.dim("at your IdP — the button appears on the login page")}`,
          ]
        : []),
      ...(auth && magicLink && email !== "console"
        ? [
            `${pc.cyan("→")} email: admin → ${pc.bold("System → Email")} ${pc.dim(`— create the "default" account (${email === "resend" ? "Resend API key" : "SMTP host + password"} via vault or env); sign-in links then send automatically (console until then)`)}`,
          ]
        : []),
      ...(pack.id === "agentic" && examples && email === "resend"
        ? [
            `${pc.cyan("→")} email → agent: point a Resend inbound webhook at ${pc.bold("POST /email/inbound/resend")} ${pc.dim("— workflows/email-agent-reply.json answers every email, threaded (add the webhook secret to the account)")}`,
          ]
        : []),
      ...(docs ? [`${pc.cyan("→")} docs: ${pc.bold("http://localhost:3000/docs")} ${pc.dim("(public — DOCS_REQUIRE_AUTH gates it)")}`] : []),
    ].join("\n"),
    "Next steps",
  );
  const personalize = personalizeLine(pack.id, examples);
  p.note(
    [
      ...(personalize ? [personalize, ""] : []),
      `${pc.dim("Workflows are JSON graphs of typed ops; ops carry the code; mods bundle both.")}`,
      `${pc.dim("$")} npx pattern ops          ${pc.dim("every op you can wire — never guess")}`,
      `${pc.dim("$")} npx pattern graph <wf>   ${pc.dim("render any workflow as a terminal graph")}`,
      "",
      `${pc.green("✦")} Coding with an agent? It reads ${pc.bold("AGENTS.md")} — ops, routes & admin pages, by recipe.`,
    ].join("\n"),
    "Good to know",
  );
  p.outro(pc.green("Done — happy building! ✦"));
}

async function runHeadless(flags: Flags): Promise<void> {
  // Headless defaults to an app (every existing CI script is preserved); a mod
  // is scaffolded headlessly only with an explicit --kind mod.
  if ((flags.kind ?? "app") === "mod") return runHeadlessMod(flags);
  const name = flags.name ?? "my-pattern-app";
  const pack = packOrThrow(flags.modpack ?? "studio");
  const pm = flags.pm ?? detectPm();
  // No prompt to ask — flags win, else the pack's default (studio ships locked).
  const { dims, notes } = resolveDims(pack, flags);
  const { auth, magicLink, oidc, email, docs, examples, vaultKey, providers } = dims;
  console.log(
    `create-pattern: scaffolding "${name}" with the "${pack.id}" modpack (${pm}${examples ? "" : ", no examples"}${auth ? ", auth on" : ""}${oidc ? ", oidc" : ""}${email !== "console" ? `, email ${email}` : ""}${docs ? ", docs on" : ""}${providers.length ? `, +${providers.length} provider(s)` : ""})`,
  );
  for (const n of notes) console.log(`note: ${n}`);
  await scaffold({ name, pack: pack.id, pm, install: flags.install, git: flags.git, ...dims });
  const seeded = aliasSeedPlan(providers);
  console.log(`Done. Next: cd ${name} && ${pm === "npm" ? "npm run" : pm} dev`);
  if (vaultKey) console.log(`Wrote .env with a generated PATTERN_VAULT_KEY (add provider keys per model alias in admin → Settings → AI Providers).`);
  if (seeded) console.log(`Seeded model aliases ${seeded.aliases.map((a) => `"${a.name}" (${a.provider} ${a.modelId})`).join(" + ")} — set ${seeded.envKeys.join(", ")} in .env.`);
  if (packHasBuddy(pack)) console.log(`Wrote .mcp.json — Claude Code auto-connects to \`pattern mcp\` (the pattern_* tools).`);
  if (auth) console.log(`First boot prints a one-time admin link in the console${magicLink ? " (magic links print there too)" : ""}.`);
  if (oidc) console.log(`OIDC: fill in mods/oidc.mjs (issuer + client id; secret via env or vault), register /auth/oidc/<id>/callback at your IdP.`);
  if (auth && magicLink && email !== "console") console.log(`Email delivery: create the "default" account in admin → System → Email — sign-in links then send via ${email} (console until then).`);
  if (pack.id === "agentic" && examples && email === "resend") console.log(`Inbound demo: workflows/email-agent-reply.json — point a Resend inbound webhook at POST /email/inbound/resend and an agent answers every email.`);
  for (const ep of [...pack.serves(examples), ...(docs ? ["/docs"] : [])]) console.log(`  serves http://localhost:3000${ep}`);
}

async function scaffold(opts: Dims & {
  name: string;
  pack: string;
  pm: Pm;
  install: boolean;
  git: boolean;
}): Promise<void> {
  const targetDir = resolve(process.cwd(), opts.name);
  if (existsSync(targetDir) && (await readdir(targetDir)).length > 0) {
    throw new Error(`directory "${opts.name}" already exists and is not empty`);
  }

  const spin = process.stdout.isTTY ? p.spinner() : undefined;
  spin?.start(`Unpacking the ${opts.pack} modpack`);
  await copyTemplate(opts.pack, targetDir, { name: opts.name });
  // The template's @pattern-js/* ranges follow this CLI's version, always.
  await normalizeDepRanges(targetDir);
  // Strip examples BEFORE auth (so auth's /whoami route survives the strip).
  if (!opts.examples) await applyNoExamples(targetDir, opts.pack, opts.name);
  if (opts.auth) await applyAuth(targetDir, opts.pack, opts.magicLink);
  if (opts.auth && opts.magicLink) await applyEmail(targetDir, opts.email);
  // Resend delivery on the agent pack unlocks the inbound demo: email → agent → threaded reply.
  if (opts.pack === "agentic" && opts.examples && opts.email === "resend") {
    await writeFile(join(targetDir, "workflows", "email-agent-reply.json"), EMAIL_AGENT_REPLY_WORKFLOW);
  }
  if (opts.auth && opts.oidc) await applyOidc(targetDir, opts.magicLink);
  if (opts.docs) await applyDocs(targetDir);
  const seeded = aliasSeedPlan(opts.providers ?? []);
  if (seeded) await applyAiAliases(targetDir, seeded); // before applyVaultKey — its env hints belong in .env too
  if (opts.vaultKey) await applyVaultKey(targetDir);
  if (opts.providers?.length) await applyProviders(targetDir, opts.providers);
  if (packHasBuddy(packOrThrow(opts.pack))) await writeFile(join(targetDir, ".mcp.json"), MCP_CONFIG);
  spin?.stop(`Modpack unpacked (${opts.pack}${opts.examples ? "" : ", no examples"}${opts.auth ? " + auth" : ""}${opts.oidc ? " + oidc" : ""}${opts.auth && opts.magicLink && opts.email !== "console" ? ` + email (${opts.email})` : ""}${opts.docs ? " + docs" : ""}${opts.vaultKey ? " + vault key" : ""}${opts.providers?.length ? ` + ${opts.providers.length} provider(s)` : ""}${seeded ? " + model aliases" : ""})`);

  if (opts.git) {
    spawnSync("git", ["init", "-q"], { cwd: targetDir });
  }
  if (opts.install) {
    spin?.start(`Installing with ${opts.pm}`);
    const res = spawnSync(opts.pm, ["install"], { cwd: targetDir, stdio: spin ? "ignore" : "inherit" });
    if (res.status !== 0) spin?.stop(pc.yellow("install skipped/failed — run it manually"));
    else spin?.stop("Dependencies installed");
  }
}

// ── Mod scaffolding (--kind mod) ─────────────────────────────────────────────
// A third-party mod is a publishable package exporting defineMod(...). The
// questionnaire toggles which pieces it ships; buildModIndex assembles
// src/index.ts to match, and assembleMod drops the files the selection omits.

type AdminTier = "none" | "tier1" | "tier2";
interface ModPieces {
  ops: boolean;
  workflows: boolean;
  admin: AdminTier;
  docs: boolean;
}

function resolveModPieces(flags: Flags): ModPieces {
  const ops = flags.modOps ?? true;
  return {
    ops,
    // Routes and the admin page front the op — they need it.
    workflows: ops ? (flags.modWorkflows ?? true) : false,
    admin: ops ? (flags.modAdmin ?? "tier1") : "none",
    docs: flags.docs ?? true,
  };
}

/** Bare, url/op-safe stem (drops a leading "mod-"). */
function modStem(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/^mod-/, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "mod"
  );
}
function modPkgName(name: string, scope: string): string {
  const stem = modStem(name);
  const s = scope.trim();
  if (!s) return `mod-${stem}`;
  const at = s.startsWith("@") ? s : `@${s}`;
  return `${at}/mod-${stem}`;
}
function modOpPrefix(name: string): string {
  return modStem(name).replace(/[^a-z0-9]+/g, "") || "mod";
}
function modTitle(name: string): string {
  const t = modStem(name)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join("");
  return /^[A-Za-z]/.test(t) ? t : `Mod${t}`;
}

function modCard(pkgName: string, pieces: ModPieces): string {
  const yes = (b: boolean) => (b ? pc.green("✓") : pc.dim("·"));
  const adminLabel =
    pieces.admin === "none" ? pc.dim("none") : pc.cyan(pieces.admin === "tier2" ? "Tier 2 (React page)" : "Tier 1 (table)");
  return [
    `${pc.dim("a publishable mod —")} ${pc.magenta(pkgName)}`,
    "",
    pc.bold("contributes"),
    `  ${yes(pieces.ops)} an op            ${pc.dim("src/ops.ts")}`,
    `  ${yes(pieces.workflows)} HTTP route(s)    ${pc.dim("src/routes.ts")}`,
    `  ${pieces.admin === "none" ? pc.dim("·") : pc.green("✓")} admin page       ${adminLabel}`,
    `  ${yes(pieces.docs)} docs chapter     ${pc.dim("docs/ → /docs")}`,
    "",
    `${pc.green("✦")} AGENTS.md — the mod-authoring contract your coding agent reads`,
  ].join("\n");
}

/** Assemble src/index.ts from the chosen pieces (the single source of truth). */
function buildModIndex(pieces: ModPieces, vars: { pkgName: string; name: string; title: string }): string {
  const imp: string[] = [];
  if (pieces.docs) {
    imp.push(`import { existsSync } from "node:fs";`);
    imp.push(`import { fileURLToPath } from "node:url";`);
  }
  imp.push(`import { defineMod } from "@pattern-js/core";`);
  if (pieces.docs) imp.push(`import { localFs, provideFilesystem } from "@pattern-js/runtime-node";`);
  if (pieces.ops) imp.push(`import { itemsList } from "./ops.js";`);
  const routes: string[] = [];
  if (pieces.ops && pieces.workflows) routes.push("itemsRoute");
  if (pieces.ops && pieces.admin !== "none") routes.push("itemsAdminRoute");
  if (routes.length) imp.push(`import { ${routes.join(", ")} } from "./routes.js";`);
  if (pieces.admin === "tier1") imp.push(`import { frontendTier1 } from "./frontend.js";`);
  // Tier-2 ships its page as `module` SOURCE in frontend.ts — the admin serves +
  // imports it, so there's no app.ts, no app workflow, no provideAssets.
  if (pieces.admin === "tier2") imp.push(`import { frontendTier2 } from "./frontend.js";`);

  const fsName = `${vars.name}-docs`;
  const fields: string[] = [`  name: ${JSON.stringify(vars.pkgName)},`];
  if (pieces.ops) fields.push(`  ops: [itemsList],`);
  const wf = [...routes];
  if (wf.length) fields.push(`  workflows: [${wf.join(", ")}],`);
  if (pieces.admin === "tier1") fields.push(`  frontend: frontendTier1,`);
  if (pieces.admin === "tier2") fields.push(`  frontend: frontendTier2,`);
  // Order 60: past the shipped chapters (Agents 50 · AI 51 · Chat 52) so a
  // fresh mod never ties a first-party one.
  if (pieces.docs) fields.push(`  docs: { filesystem: ${JSON.stringify(fsName)}, title: ${JSON.stringify(vars.title)}, order: 60 },`);

  const setup: string[] = [];
  if (pieces.docs) {
    setup.push(`    try {`);
    setup.push(`      const dir = fileURLToPath(new URL("../docs", import.meta.url));`);
    setup.push(`      if (existsSync(dir)) provideFilesystem(engine, ${JSON.stringify(fsName)}, localFs(dir));`);
    setup.push(`    } catch {`);
    setup.push(`      /* packaged without docs — skip */`);
    setup.push(`    }`);
  }
  if (setup.length) fields.push(`  setup: (engine) => {\n${setup.join("\n")}\n  },`);

  return (
    `/**\n` +
    ` * ${vars.pkgName} — a Pattern mod.\n` +
    ` *\n` +
    ` * defineMod bundles everything this package contributes. Install it by adding\n` +
    ` * "${vars.pkgName}" to a project's pattern.config.json \`mods\`.\n` +
    ` */\n` +
    imp.join("\n") +
    `\n\nexport default defineMod({\n` +
    fields.join("\n") +
    `\n});\n`
  );
}

async function assembleMod(
  targetDir: string,
  pieces: ModPieces,
  vars: { pkgName: string; name: string; opPrefix: string; title: string },
): Promise<void> {
  const src = (f: string) => join(targetDir, "src", f);
  await writeFile(src("index.ts"), buildModIndex(pieces, vars));
  // Drop the files the selection omits (buildModIndex never imports them).
  if (!pieces.ops) await rm(src("ops.ts"), { force: true });
  const routesNeeded = pieces.ops && (pieces.workflows || pieces.admin !== "none");
  if (!routesNeeded) await rm(src("routes.ts"), { force: true });
  if (pieces.admin === "none") await rm(src("frontend.ts"), { force: true });
  // Docs: rename the op-prose stub to the real op type, or drop the chapter.
  if (pieces.docs) {
    const opDoc = join(targetDir, "docs", "ops", "op.md");
    if (existsSync(opDoc) && pieces.ops) await rename(opDoc, join(targetDir, "docs", "ops", `${vars.opPrefix}.items.list.md`));
    else if (existsSync(opDoc)) await rm(opDoc, { force: true });
  } else {
    await rm(join(targetDir, "docs"), { recursive: true, force: true });
  }
}

function modNext(name: string, pkgName: string, opPrefix: string, pieces: ModPieces, installed: boolean, installLine: string): string[] {
  return [
    `${pc.dim("$")} cd ${name}`,
    installed ? "" : installLine,
    `${pc.dim("$")} npm run build   ${pc.dim("— tsc → dist/")}`,
    `${pc.dim("$")} npm test        ${pc.dim("— the vitest smoke test")}`,
    "",
    `${pc.cyan("→")} try it in a host: ${pc.bold("npx create-pattern host-test --modpack studio")},`,
    `  then add ${pc.bold(`"${pkgName}": "file:../${name}"`)} + list ${pc.bold(pkgName)} in its pattern.config.json mods`,
    `${pc.cyan("→")} verify: ${pc.bold(`npx pattern ops ${opPrefix}`)}${pieces.admin !== "none" ? `, then ${pc.bold("/admin")} → Extensions` : ""}${pieces.docs ? `, ${pc.bold("/docs")}` : ""}`,
    `${pc.green("✦")} ${pc.bold("AGENTS.md")} is the contract sheet — point your coding agent at it.`,
  ].filter((l) => l !== "");
}

async function scaffoldMod(opts: {
  name: string;
  pkgName: string;
  opPrefix: string;
  title: string;
  pieces: ModPieces;
  pm: Pm;
  install: boolean;
  git: boolean;
}): Promise<void> {
  const targetDir = resolve(process.cwd(), opts.name);
  if (existsSync(targetDir) && (await readdir(targetDir)).length > 0) {
    throw new Error(`directory "${opts.name}" already exists and is not empty`);
  }
  const spin = process.stdout.isTTY ? p.spinner() : undefined;
  spin?.start("Unpacking the mod template");
  await copyTemplate("mod", targetDir, { name: opts.name, pkgName: opts.pkgName, opPrefix: opts.opPrefix, Title: opts.title });
  await normalizeDepRanges(targetDir);
  await assembleMod(targetDir, opts.pieces, opts);
  spin?.stop(`Mod scaffolded (${opts.pieces.admin === "none" ? "ops" : opts.pieces.admin}${opts.pieces.docs ? " + docs" : ""})`);
  if (opts.git) spawnSync("git", ["init", "-q"], { cwd: targetDir });
  if (opts.install) {
    spin?.start(`Installing with ${opts.pm}`);
    const res = spawnSync(opts.pm, ["install"], { cwd: targetDir, stdio: spin ? "ignore" : "inherit" });
    if (res.status !== 0) spin?.stop(pc.yellow("install skipped/failed — run it manually"));
    else spin?.stop("Dependencies installed");
  }
}

async function runInteractiveMod(flags: Flags, name: string): Promise<void> {
  const scope = flags.modScope ?? (await p.text({ message: "npm scope? (blank = unscoped)", placeholder: "@acme", defaultValue: "" }));
  if (p.isCancel(scope)) return cancel();
  const pkgName = modPkgName(name, String(scope));
  const opPrefix = modOpPrefix(name);
  const title = modTitle(name);

  let ops = flags.modOps;
  if (ops === undefined) {
    const a = await p.confirm({ message: `Contribute ops? ${pc.dim("an example op in src/ops.ts")}`, initialValue: true });
    if (p.isCancel(a)) return cancel();
    ops = a;
  }

  let workflows = false;
  if (ops) {
    if (flags.modWorkflows !== undefined) workflows = flags.modWorkflows;
    else {
      const a = await p.confirm({ message: `Contribute HTTP routes? ${pc.dim("an example route fronting the op")}`, initialValue: true });
      if (p.isCancel(a)) return cancel();
      workflows = a;
    }
  }

  let admin: AdminTier = "none";
  if (ops) {
    if (flags.modAdmin) admin = flags.modAdmin;
    else {
      const a = await p.select({
        message: "Add a custom admin page?",
        options: [
          { value: "tier1", label: "Tier 1 — declarative table", hint: "no build step" },
          { value: "tier2", label: "Tier 2 — custom React page", hint: "the admin's React + UI + motion + lucide" },
          { value: "none", label: "None", hint: "ops + routes only" },
        ],
      });
      if (p.isCancel(a)) return cancel();
      admin = a as AdminTier;
    }
  }

  let docs = flags.docs;
  if (docs === undefined) {
    const a = await p.confirm({ message: `Ship a docs chapter? ${pc.dim("docs/ at /docs, with per-op prose")}`, initialValue: true });
    if (p.isCancel(a)) return cancel();
    docs = a;
  }

  const pieces: ModPieces = { ops: !!ops, workflows, admin, docs: !!docs };
  p.note(modCard(pkgName, pieces), `${title} mod`);

  const pm = flags.pm ?? (await p.select({ message: "Package manager", initialValue: detectPm(), options: PMS.map((m) => ({ value: m, label: m })) }))!;
  if (p.isCancel(pm)) return cancel();
  const install = flags.yes ? flags.install : !p.isCancel(await p.confirm({ message: `Install deps with ${pm}?`, initialValue: flags.install }));

  await scaffoldMod({ name, pkgName, opPrefix, title, pieces, pm: pm as Pm, install, git: flags.git });
  p.note(modNext(name, pkgName, opPrefix, pieces, install, `${pc.dim("$")} ${pm} install`).join("\n"), "Next steps");
  p.outro(pc.green("Done — happy building! ✦"));
}

async function runHeadlessMod(flags: Flags): Promise<void> {
  const name = flags.name ?? "my-mod";
  const pm = flags.pm ?? detectPm();
  const pieces = resolveModPieces(flags);
  const pkgName = modPkgName(name, flags.modScope ?? "");
  console.log(`create-pattern: scaffolding mod "${pkgName}" (${pm}, admin: ${pieces.admin}${pieces.docs ? ", docs" : ""})`);
  await scaffoldMod({ name, pkgName, opPrefix: modOpPrefix(name), title: modTitle(name), pieces, pm, install: flags.install, git: flags.git });
  console.log(`Done. Next: cd ${name} && npm run build && npm test`);
}

function cancel(): void {
  p.cancel("Cancelled.");
  process.exit(0);
}

async function main(): Promise<void> {
  try {
    // parseFlags inside the try: a bad flag value gets the friendly ✗, not a stack.
    const flags = parseFlags(process.argv.slice(2));
    if (flags.help) return usage();
    if (flags.list) return listPacks();
    if (flags.dryRun) return previewManifest(flags);
    const interactive = process.stdout.isTTY && !flags.yes;
    if (interactive) await runInteractive(flags);
    else await runHeadless(flags);
  } catch (err) {
    console.error(pc.red(`\n✗ ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}

void main();
