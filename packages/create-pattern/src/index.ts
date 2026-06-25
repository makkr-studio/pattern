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

import { cp, readdir, readFile, rename, rm, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as p from "@clack/prompts";
import pc from "picocolors";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates", import.meta.url));

interface NextCtx {
  name: string;
  runCmd: string;
  installed: boolean;
  installLine: string;
  auth: boolean;
  examples: boolean;
  /** A .env with a generated PATTERN_VAULT_KEY was written (skip the cp step). */
  vaultKey: boolean;
}

interface Modpack {
  id: string;
  label: string;
  /** One-liner shown as the select hint. */
  hint: string;
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
  /** A workflow file to render as an inline graph (when examples are on). */
  showcase?: string;
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
const AUTH_MODS = ["@pattern-js/mod-identity", "@pattern-js/mod-auth-magic-link"];

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
 */
const AI_PROVIDERS = [
  { value: "@ai-sdk/xai", label: "xAI Grok", hint: "", range: "^3" },
  { value: "@ai-sdk/vercel", label: "Vercel", hint: "v0 models", range: "^2" },
  { value: "@ai-sdk/openai", label: "OpenAI", hint: "", range: "^3" },
  { value: "@ai-sdk/azure", label: "Azure OpenAI", hint: "OpenAI on Azure", range: "^3" },
  { value: "@ai-sdk/anthropic", label: "Anthropic", hint: "", range: "^3" },
  { value: "@ai-sdk/open-responses", label: "Open Responses", hint: "self-hosted Responses API", range: "^1" },
  { value: "@ai-sdk/anthropic-aws", label: "Claude on AWS", hint: "Claude via Bedrock", range: "^1" },
  { value: "@ai-sdk/amazon-bedrock", label: "Amazon Bedrock", hint: "models on AWS", range: "^4" },
  { value: "@ai-sdk/groq", label: "Groq", hint: "", range: "^3" },
  { value: "@ai-sdk/fal", label: "Fal", hint: "image/video/audio", range: "^2" },
  { value: "@ai-sdk/deepinfra", label: "DeepInfra", hint: "", range: "^2" },
  { value: "@ai-sdk/black-forest-labs", label: "Black Forest Labs", hint: "FLUX", range: "^1" },
  { value: "@ai-sdk/google", label: "Google Generative AI", hint: "Gemini", range: "^3" },
  { value: "@ai-sdk/google-vertex", label: "Google Vertex AI", hint: "Gemini/Claude on GCP", range: "^4" },
  { value: "@ai-sdk/mistral", label: "Mistral AI", hint: "", range: "^3" },
  { value: "@ai-sdk/togetherai", label: "Together.ai", hint: "", range: "^2" },
  { value: "@ai-sdk/cohere", label: "Cohere", hint: "", range: "^3" },
  { value: "@ai-sdk/fireworks", label: "Fireworks", hint: "", range: "^2" },
  { value: "@ai-sdk/voyage", label: "Voyage AI", hint: "embeddings", range: "^1" },
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
/** Accept short ids ("azure") or full packages ("@ai-sdk/azure"). */
const normProvider = (id: string): string => (id.startsWith("@ai-sdk/") ? id : "@ai-sdk/" + id);
/** The version range for a provider package (falls back to latest for an unknown one). */
const providerRange = (pkg: string): string => AI_PROVIDERS.find((p) => p.value === pkg)?.range ?? "latest";

/** One-line technical role per mod — shown beside each in the manifest card. */
const MOD_ROLES: Record<string, string> = {
  "@pattern-js/mod-admin": "visual editor, run traces, /admin control plane",
  "@pattern-js/mod-agents": "agent ops: agent · run · tools · guardrail",
  "@pattern-js/mod-ai": "AI capabilities (text/image/embed/stt/tts/video) + the model provider",
  "@pattern-js/mod-agents + mod-ai": "agent ops + AI capabilities on any provider/model",
  "@pattern-js/mod-store": "durable state (sqlite): conversations, blobs, leases",
  "@pattern-js/mod-vault": "encrypted secrets — holds OPENAI_API_KEY",
  "@pattern-js/mod-chat": "the /chat product; its turn pipeline is a workflow",
  "@pattern-js/mod-identity": "users, sessions, roles → scopes",
  "@pattern-js/mod-auth-magic-link": "magic-link login (console fallback in dev)",
  "@pattern-js/mod-docs": "/docs: handbook + a live op reference",
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
    tagline: "the engine in-process — run workflows from code, no server",
    mods: [],
    exampleSummary: "one runnable example workflow (greeting)",
    serves: () => [],
    env: [],
    generates: (ex) => (ex ? ["workflows/greeting.json", "src/index.ts"] : ["workflows/ (your workflows)", "src/index.ts"]),
    showcase: "workflows/greeting.json",
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
    tagline: "the engine + the HTTP/WS/CLI host — serve workflows as endpoints, no UI",
    mods: ["./mods/uppercase.mjs (app-local)"],
    exampleSummary: "4 example routes (hello/echo/shout/health) + the app.shout mod",
    serves: (ex) => (ex ? ["/hello/:name", "/echo", "/shout/:text", "/health"] : []),
    env: [],
    generates: (ex) =>
      ex
        ? ["workflows/hello.json + echo, shout, health", "mods/uppercase.mjs", "src/index.ts"]
        : ["workflows/ (your routes)", "mods/ (your ops)", "src/index.ts"],
    showcase: "workflows/hello.json",
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
    tagline: "Studio + mod-ai — build plain AI workflows (text · object · image · speech) in the editor",
    mods: ["@pattern-js/mod-ai", "@pattern-js/mod-store", "@pattern-js/mod-vault", "@pattern-js/mod-admin"],
    exampleSummary: "an AI workflow (POST /summarize → ai.text.generate, no agent)",
    serves: (ex) => (ex ? ["/admin", "/summarize"] : ["/admin"]),
    env: ["OPENAI_API_KEY", "PATTERN_VAULT_KEY"],
    generates: (ex) =>
      ex
        ? ["workflows/summarize.json", "src/index.ts", ".env.example"]
        : ["workflows/ (your AI flows)", "src/index.ts", ".env.example"],
    showcase: "workflows/summarize.json",
    auth: { default: true },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth, examples, vaultKey }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        vaultKey
          ? `${pc.cyan("→")} set ${pc.bold("OPENAI_API_KEY")} in ${pc.bold(".env")} ${pc.dim("(vault key already generated — or use the admin Secrets page)")}`
          : `${pc.dim("$")} cp .env.example .env ${pc.dim("— set OPENAI_API_KEY + a PATTERN_VAULT_KEY (openssl rand -base64 32)")}`,
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        ...(auth
          ? [`${pc.cyan("→")} admin is locked — first boot prints a one-time owner link; then ${pc.bold("http://localhost:3000/admin")}`]
          : [`${pc.cyan("→")} open ${pc.bold("http://localhost:3000/admin")}`]),
        `${pc.cyan("→")} create a ${pc.bold("default")} alias in admin → Settings → AI Providers`,
        examples
          ? `${pc.cyan("→")} curl -XPOST localhost:3000/summarize -H 'content-type: application/json' -d '{"text":"…"}' ${pc.dim("— ai.text.generate, no agent")}`
          : `${pc.cyan("→")} build an AI workflow: ${pc.bold("ai.alias → ai.text.generate")} (see AGENTS.md)`,
      ].filter((l) => l !== ""),
  },
  {
    id: "agentic",
    label: "Studio + AI + Agents",
    hint: "build agentic workflows in the editor — agent/run/tools ops + AI + vault + store; no chat UI",
    tagline: "Studio + AI + the agent stack — build agentic workflows (agent · run · tools) in the editor",
    mods: [
      "@pattern-js/mod-agents + mod-ai",
      "@pattern-js/mod-store",
      "@pattern-js/mod-vault",
      "@pattern-js/mod-admin",
    ],
    exampleSummary: "an agentic workflow (POST /ask → agent + tool) + a get_time tool",
    serves: (ex) => (ex ? ["/admin", "/ask"] : ["/admin"]),
    env: ["OPENAI_API_KEY", "PATTERN_VAULT_KEY"],
    generates: (ex) =>
      ex
        ? ["workflows/agent-answer.json", "workflows/tool-time.json", "src/index.ts", ".env.example"]
        : ["workflows/ (your agentic flows)", "src/index.ts", ".env.example"],
    showcase: "workflows/agent-answer.json",
    auth: { default: true },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth, examples, vaultKey }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        vaultKey
          ? `${pc.cyan("→")} set ${pc.bold("OPENAI_API_KEY")} in ${pc.bold(".env")} ${pc.dim("(vault key already generated — or use the admin Secrets page)")}`
          : `${pc.dim("$")} cp .env.example .env ${pc.dim("— set OPENAI_API_KEY + a PATTERN_VAULT_KEY (openssl rand -base64 32)")}`,
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        ...(auth
          ? [`${pc.cyan("→")} admin is locked — first boot prints a one-time owner link; then ${pc.bold("http://localhost:3000/admin")}`]
          : [`${pc.cyan("→")} open ${pc.bold("http://localhost:3000/admin")}`]),
        examples
          ? `${pc.cyan("→")} curl -XPOST localhost:3000/ask -H 'content-type: application/json' -d '{"question":"what time is it?"}' ${pc.dim("— the agent calls get_time (a linked sub-run)")}`
          : `${pc.cyan("→")} build an agentic workflow: ${pc.bold("agents.agent → agents.run")} (see AGENTS.md)`,
      ].filter((l) => l !== ""),
  },
  {
    id: "agent-chat",
    label: "Studio + Agentic Chat",
    hint: "a chat product at /chat — tools, guardrails, HITL — the turn pipeline is an agentic workflow",
    tagline: "Studio + Agents + mod-chat — the /chat product whose turn pipeline is an agentic workflow",
    mods: [
      "@pattern-js/mod-chat",
      "@pattern-js/mod-agents + mod-ai",
      "@pattern-js/mod-store",
      "@pattern-js/mod-vault",
      "@pattern-js/mod-admin",
    ],
    exampleSummary: "two example chat tools (get_time, get_weather)",
    serves: () => ["/chat", "/admin"],
    env: ["OPENAI_API_KEY", "PATTERN_VAULT_KEY"],
    generates: (ex) =>
      ex
        ? ["workflows/tool-time.json", "workflows/tool-weather.json", "src/index.ts", ".env.example"]
        : ["workflows/ (your tools)", "src/index.ts", ".env.example"],
    showcase: "workflows/tool-time.json",
    auth: { default: true },
    docs: { default: true },
    next: ({ name, runCmd, installed, installLine, auth, examples, vaultKey }) =>
      [
        `${pc.dim("$")} cd ${name}`,
        installed ? "" : installLine,
        vaultKey
          ? `${pc.cyan("→")} set ${pc.bold("OPENAI_API_KEY")} in ${pc.bold(".env")} ${pc.dim("(vault key already generated — or use the admin Secrets page)")}`
          : `${pc.dim("$")} cp .env.example .env ${pc.dim("— set OPENAI_API_KEY + a PATTERN_VAULT_KEY (openssl rand -base64 32)")}`,
        `${pc.dim("$")} ${runCmd} dev`,
        "",
        `${pc.cyan("→")} chat at ${pc.bold("http://localhost:3000/chat")}`,
        ...(auth
          ? [`${pc.cyan("→")} admin is locked — first boot prints a one-time owner link`]
          : [`${pc.cyan("→")} admin at ${pc.bold("http://localhost:3000/admin")}`]),
        examples
          ? `${pc.cyan("→")} ask it ${pc.bold('"what time is it?"')} ${pc.dim("— the agent calls the get_time tool (a linked sub-run)")}`
          : `${pc.cyan("→")} add a tool workflow (see AGENTS.md), then ask the agent to call it`,
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
  /** undefined = ask (interactive) / pack default (headless). */
  auth?: boolean;
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

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { install: true, git: true, yes: false, list: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--modpack" || a === "-m" || a === "--template" || a === "-t") flags.modpack = argv[++i];
    else if (a === "--pm") flags.pm = argv[++i] as Pm;
    else if (a === "--no-install") flags.install = false;
    else if (a === "--no-git") flags.git = false;
    else if (a === "--auth") flags.auth = true;
    else if (a === "--no-auth") flags.auth = false;
    else if (a === "--docs") flags.docs = true;
    else if (a === "--no-docs") flags.docs = false;
    else if (a === "--examples") flags.examples = true;
    else if (a === "--no-examples") flags.examples = false;
    else if (a === "--vault-key") flags.vaultKey = true;
    else if (a === "--no-vault-key") flags.vaultKey = false;
    else if (a === "--providers") flags.providers = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--list" || a === "-l") flags.list = true;
    else if (a === "--dry-run" || a === "--dry") flags.dryRun = true;
    else if (a === "--kind") flags.kind = argv[++i] as "app" | "mod";
    else if (a === "--ops") flags.modOps = true;
    else if (a === "--no-ops") flags.modOps = false;
    else if (a === "--workflows") flags.modWorkflows = true;
    else if (a === "--no-workflows") flags.modWorkflows = false;
    else if (a === "--admin") flags.modAdmin = argv[++i] as "none" | "tier1" | "tier2";
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

/**
 * The manifest card: a computed, accurate preview of exactly what gets wired
 * and generated — mods + their roles, the file tree, the endpoints served, the
 * env it needs. Everything here is derived from the actual selections.
 */
function packCard(pack: Modpack, auth: boolean, docs: boolean, examples: boolean, vaultKey = false): string {
  // Mods, in install order: identity first (infra), pack mods, docs last.
  const packMods = examples ? pack.mods : pack.mods.filter((m) => !m.includes("(app-local)"));
  const modList = [...(auth ? AUTH_MODS : []), ...packMods, ...(docs ? [DOCS_MOD] : [])];
  const roleOf = (m: string) => MOD_ROLES[m] ?? "";
  const width = Math.max(0, ...modList.map((m) => modPath(m).length));
  const modLines = modList.length
    ? modList.map((m) => `  ${pc.magenta(modPath(m).padEnd(width))}  ${pc.dim(roleOf(m))}`)
    : [`  ${pc.dim("none — just the engine, in-process")}`];

  const files = pack.generates(examples);
  const fileLines = files.map((f) => `  ${pc.cyan("›")} ${f}`);

  const serves = [...pack.serves(examples), ...(docs ? ["/docs"] : []), ...(auth && pack.id === "headless" && examples ? ["/whoami"] : [])];
  const env = pack.env;

  const blocks: string[] = [`${pc.dim(pack.tagline)}`, "", pc.bold("mods"), ...modLines, "", pc.bold("generates"), ...fileLines];
  if (serves.length) blocks.push("", `${pc.bold("serves")}   ${serves.map((s) => pc.cyan(s)).join(pc.dim(" · "))}`);
  if (env.length) {
    const annotate = (e: string) =>
      e === "PATTERN_VAULT_KEY" && vaultKey ? `${pc.magenta(e)} ${pc.green("(generated → .env)")}` : pc.magenta(e);
    const hint = env.includes("PATTERN_VAULT_KEY") && !vaultKey ? pc.dim("  (vault key: openssl rand -base64 32)") : "";
    blocks.push(`${pc.bold("needs")}    ${env.map(annotate).join(pc.dim(" · "))}${hint}`);
  }
  blocks.push("", `${pc.green("✦")} AGENTS.md + CLAUDE.md — the recipes your coding agent reads`);
  return blocks.join("\n");
}

/** Resolve the orthogonal dimensions from flags + pack defaults (no prompts). */
function resolveDims(
  pack: Modpack,
  flags: Flags,
): { auth: boolean; docs: boolean; examples: boolean; vaultKey: boolean; providers: string[] } {
  return {
    auth: pack.auth ? (flags.auth ?? pack.auth.default) : false,
    docs: pack.docs ? (flags.docs ?? pack.docs.default) : false,
    examples: flags.examples ?? true,
    vaultKey: packNeedsVault(pack) ? (flags.vaultKey ?? true) : false,
    providers: packUsesAi(pack) ? (flags.providers ?? []).map(normProvider) : [],
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
  const { auth, docs, examples, vaultKey } = resolveDims(pack, flags);
  console.log(
    `  ${pc.bold(pack.label)} ${pc.dim(`(${pack.id}${examples ? "" : ", no examples"}${auth ? ", auth" : ""}${docs ? ", docs" : ""})`)}\n`,
  );
  console.log(
    packCard(pack, auth, docs, examples, vaultKey)
      .split("\n")
      .map((l) => "  " + l)
      .join("\n"),
  );
  console.log("\n  " + pc.dim("dry run — nothing written. Drop --dry-run to scaffold."));
}

/** Render the seeded showcase workflow as a terminal graph (examples + installed). */
function showcaseGraph(name: string, pack: Modpack, examples: boolean, installed: boolean): string | null {
  if (!examples || !pack.showcase || !installed) return null;
  const dir = resolve(process.cwd(), name);
  try {
    const res = spawnSync("npx", ["pattern", "graph", pack.showcase], { cwd: dir, encoding: "utf8" });
    if (res.status === 0 && res.stdout?.trim()) return res.stdout.replace(/\s+$/, "");
  } catch {
    /* the inline graph is a nicety — never block scaffolding on it */
  }
  return null;
}

function listPacks(): void {
  console.log(`\n${pc.bold("Modpacks")} — a ladder; each rung adds one capability:\n`);
  for (const pack of LADDER.map((id) => packOrThrow(id))) {
    const authNote = pack.auth ? pc.dim(`  (auth: ${pack.auth.default ? "on" : "off"}, docs: ${pack.docs?.default ? "on" : "off"} by default)`) : "";
    console.log(`  ${pc.cyan(pack.id.padEnd(12))}${pack.label} — ${pc.dim(pack.hint)}${authNote}`);
  }
  console.log(
    `\n  ${pc.dim("npm create pattern@latest my-app -- --modpack <id> [--auth|--no-auth] [--docs|--no-docs] [--examples|--no-examples]")}`,
  );
  console.log(`  ${pc.dim("examples are included by default — pass --no-examples for a clean scaffold.")}\n`);
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

/** A protected route demoing requireAuth + the trigger's `user` port (headless). */
const WHOAMI_WORKFLOW = `{
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
 * Flip the auth dimension on: wire the identity mods into the manifest and
 * the config (FIRST in the list — they're infrastructure), and give headless
 * packs a protected /whoami route so the value is curl-able in minute one.
 */
async function applyAuth(targetDir: string, packId: string): Promise<void> {
  const pkgPath = join(targetDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { dependencies: Record<string, string> };
  for (const mod of AUTH_MODS) pkg.dependencies[mod] = "^0.2.0";
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const cfgPath = join(targetDir, "pattern.config.json");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as { mods: string[] };
  cfg.mods = [...AUTH_MODS, ...cfg.mods];
  await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

  if (packId === "headless") {
    await writeFile(join(targetDir, "workflows", "whoami.json"), WHOAMI_WORKFLOW);
  }
}

/** A pack that wires mod-vault — only these get the vault-key offer. */
function packNeedsVault(pack: Modpack): boolean {
  return pack.env.includes("PATTERN_VAULT_KEY");
}

/**
 * Write `.env` from `.env.example` with a freshly generated PATTERN_VAULT_KEY —
 * the vault's master key (random, local, what `openssl rand -base64 32` gives).
 * Leaves OPENAI_API_KEY blank: that's the user's real secret to fill in. `.env`
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
  pkg.dependencies[DOCS_MOD] = "^0.2.0";
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
    p.note(
      [
        `${pc.dim("Each rung adds one capability over the one before:")}`,
        `${pc.cyan("Engine only")}            the engine, in-process — no server`,
        `${pc.cyan("Headless server")}        + the HTTP/WS/CLI host — serve workflows, no UI`,
        `${pc.cyan("Studio")}                 + mod-admin — a visual editor & run traces at /admin`,
        `${pc.cyan("Studio + Agents")}        + the agent stack — build agentic workflows`,
        `${pc.cyan("Studio + Agentic Chat")}  + mod-chat — the /chat product`,
      ].join("\n"),
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
  let auth = false;
  if (pack.auth) {
    if (flags.auth !== undefined) {
      auth = flags.auth;
    } else {
      const answer = await p.confirm({
        message: `Add authentication? ${pc.dim("magic-link login, users & sessions" + (pack.id === "studio" ? " — locks the admin" : ""))}`,
        initialValue: pack.auth.default,
      });
      if (p.isCancel(answer)) return cancel();
      auth = answer;
    }
  }

  // Docs is orthogonal too — same tri-state as auth.
  let docs = false;
  if (pack.docs) {
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
  p.note(packCard(pack, auth, docs, examples, vaultKey), `${pack.label} modpack`);

  const pm =
    flags.pm ??
    (await p.select({
      message: "Package manager",
      initialValue: detectPm(),
      options: PMS.map((m) => ({ value: m, label: m })),
    }))!;
  if (p.isCancel(pm)) return cancel();

  const install = flags.yes ? flags.install : !p.isCancel(await p.confirm({ message: `Install deps with ${pm}?`, initialValue: flags.install }));

  await scaffold({ name: String(name), pack: pack.id, pm: pm as Pm, install, git: flags.git, auth, docs, examples, vaultKey, providers });

  const runCmd = pm === "npm" ? "npm run" : String(pm);
  p.note(
    [
      ...pack.next({ name: String(name), runCmd, installed: install, installLine: `${pc.dim("$")} ${pm} install`, auth, examples, vaultKey }),
      ...(docs ? [`${pc.cyan("→")} docs: ${pc.bold("http://localhost:3000/docs")} ${pc.dim("(public — DOCS_REQUIRE_AUTH gates it)")}`] : []),
    ].join("\n"),
    "Next steps",
  );
  // The example you'll touch first, as a graph — workflows are data, so show it.
  const graph = showcaseGraph(String(name), pack, examples, install);
  if (graph) p.note(graph, `${pack.showcase} ${pc.dim("· open this first")}`);
  p.note(
    [
      `${pc.dim("Workflows are JSON graphs of typed ops; ops carry the code; mods bundle both.")}`,
      `${pc.dim("$")} npx pattern ops          ${pc.dim("every op you can wire — never guess")}`,
      `${pc.dim("$")} npx pattern graph <wf>   ${pc.dim("any workflow, as a terminal graph")}`,
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
  const { auth, docs, examples, vaultKey, providers } = resolveDims(pack, flags);
  console.log(
    `create-pattern: scaffolding "${name}" with the "${pack.id}" modpack (${pm}${examples ? "" : ", no examples"}${auth ? ", auth on" : ""}${docs ? ", docs on" : ""}${providers.length ? `, +${providers.length} provider(s)` : ""})`,
  );
  await scaffold({ name, pack: pack.id, pm, install: flags.install, git: flags.git, auth, docs, examples, vaultKey, providers });
  console.log(`Done. Next: cd ${name} && ${pm === "npm" ? "npm run" : pm} dev`);
  if (vaultKey) console.log(`Wrote .env with a generated PATTERN_VAULT_KEY (set OPENAI_API_KEY there).`);
  if (auth) console.log(`First boot prints a one-time admin link in the console (magic links print there too).`);
  for (const ep of [...pack.serves(examples), ...(docs ? ["/docs"] : [])]) console.log(`  serves http://localhost:3000${ep}`);
  const graph = showcaseGraph(name, pack, examples, flags.install);
  if (graph) {
    console.log(`\n${pack.showcase} (open this first):\n`);
    console.log(graph);
  }
}

async function scaffold(opts: {
  name: string;
  pack: string;
  pm: Pm;
  install: boolean;
  git: boolean;
  auth: boolean;
  docs: boolean;
  examples: boolean;
  vaultKey: boolean;
  providers?: string[];
}): Promise<void> {
  const targetDir = resolve(process.cwd(), opts.name);
  if (existsSync(targetDir) && (await readdir(targetDir)).length > 0) {
    throw new Error(`directory "${opts.name}" already exists and is not empty`);
  }

  const spin = process.stdout.isTTY ? p.spinner() : undefined;
  spin?.start(`Unpacking the ${opts.pack} modpack`);
  await copyTemplate(opts.pack, targetDir, { name: opts.name });
  // Strip examples BEFORE auth (so auth's /whoami route survives the strip).
  if (!opts.examples) await applyNoExamples(targetDir, opts.pack, opts.name);
  if (opts.auth) await applyAuth(targetDir, opts.pack);
  if (opts.docs) await applyDocs(targetDir);
  if (opts.vaultKey) await applyVaultKey(targetDir);
  if (opts.providers?.length) await applyProviders(targetDir, opts.providers);
  spin?.stop(`Modpack unpacked (${opts.pack}${opts.examples ? "" : ", no examples"}${opts.auth ? " + auth" : ""}${opts.docs ? " + docs" : ""}${opts.vaultKey ? " + vault key" : ""}${opts.providers?.length ? ` + ${opts.providers.length} provider(s)` : ""})`);

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
  if (pieces.admin === "tier2") {
    imp.push(`import { frontendTier2 } from "./frontend.js";`);
    imp.push(`import { appMount, provideAssets } from "./app.js";`);
  }

  const fsName = `${vars.name}-docs`;
  const fields: string[] = [`  name: ${JSON.stringify(vars.pkgName)},`];
  if (pieces.ops) fields.push(`  ops: [itemsList],`);
  const wf = [...routes];
  if (pieces.admin === "tier2") wf.push("appMount");
  if (wf.length) fields.push(`  workflows: [${wf.join(", ")}],`);
  if (pieces.admin === "tier1") fields.push(`  frontend: frontendTier1,`);
  if (pieces.admin === "tier2") fields.push(`  frontend: frontendTier2,`);
  if (pieces.docs) fields.push(`  docs: { filesystem: ${JSON.stringify(fsName)}, title: ${JSON.stringify(vars.title)}, order: 50 },`);

  const setup: string[] = [];
  if (pieces.admin === "tier2") setup.push(`    provideAssets(engine);`);
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
  if (pieces.admin !== "tier2") await rm(src("app.ts"), { force: true });
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
  const flags = parseFlags(process.argv.slice(2));
  if (flags.list) return listPacks();
  if (flags.dryRun) return previewManifest(flags);
  const interactive = process.stdout.isTTY && !flags.yes;
  try {
    if (interactive) await runInteractive(flags);
    else await runHeadless(flags);
  } catch (err) {
    console.error(pc.red(`\n✗ ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}

void main();
