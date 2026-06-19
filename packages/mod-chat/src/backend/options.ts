/** @pattern/mod-chat — options & defaults. */

export interface ChatModOptions {
  /** Where the chat app mounts (UI + API under here). Default "/chat". */
  mount?: string;
  /**
   * Short instance id. Namespaces THIS instance's workflow ids (and its
   * guardrail tool) so several instances can be hosted side by side without
   * colliding. Default "" — the canonical, unprefixed ids (single-instance).
   */
  slug?: string;
  /** Per-instance brand the SPA reads from window.__APP__ (accent + title). */
  brand?: { accent?: string; title?: string };
  /**
   * Host the SAME chat app multiple times, each with its own mount, brand and
   * agent — "the same instance, many purposes". Each entry is a ChatModOptions
   * layered over the top-level defaults; give each a distinct `mount` + `slug`.
   * When set, the top-level mount/brand/agent serve only as defaults.
   */
  instances?: ChatModOptions[];
  /** SPA assets dir override (defaults to the bundled dist-app). */
  assets?: string;
  /**
   * The built-in agent the shipped turn pipeline runs. Fork the
   * `chat.turn.pipeline` workflow in the admin (and disable the built-in) for
   * full graph surgery; these options cover the common knobs.
   */
  agent?: {
    name?: string;
    instructions?: string;
    model?: string;
  };
  /** Register the built-in turn pipeline workflow. Default true. */
  turnPipeline?: boolean;
  /**
   * The professional-conduct input guardrail: a small model classifies each
   * user message and trips when it raises a subject not permitted in a
   * professional environment, so the agent never answers it.
   *
   * Enabled by default; the `CHAT_GUARDRAIL` env var is the on/off switch
   * (set it to `false`/`0`/`off` to disable the WIRING in the turn pipeline —
   * the classifier workflow still ships, ready to wire by hand). Pass a boolean
   * to override the env, or an object to also tune the model/instructions.
   */
  guardrail?: boolean | { enabled?: boolean; model?: string; instructions?: string };
  /** Lease TTL for a running turn in ms (crash backstop). Default 5 min. */
  turnTtlMs?: number;
  /** Max model↔tool round-trips per turn. Default 12. */
  maxTurns?: number;
  /**
   * requireAuth for ALL chat API routes (e.g. true, { scopes: ["user"] }).
   * Default `{ env: "CHAT_REQUIRE_AUTH" }` — the host reads the env var per
   * request: unset/false → guests allowed (today's behaviour), true/1 → any
   * signed-in user, anything else → comma-separated scope list. Forked chat
   * workflows copy the trigger config, so they keep following the same switch.
   * The SPA route itself always stays open — the app renders its own sign-in.
   */
  requireAuth?: unknown;
  /**
   * Where the chat sign-in card sends the email for a magic link. Default
   * "/auth/magic-link/request" (mod-auth-magic-link's default mount).
   */
  loginRequestPath?: string;
  /** Where the chat's Sign out posts. Default "/auth/logout" (mod-identity). */
  logoutPath?: string;
}

export interface ResolvedChatOptions {
  mount: string;
  slug: string;
  brand: { accent?: string; title?: string };
  assets?: string;
  agent: { name: string; instructions: string; model?: string };
  turnPipeline: boolean;
  turnTtlMs: number;
  maxTurns: number;
  guardrail: { enabled: boolean; model: string; instructions: string };
  requireAuth?: unknown;
  loginRequestPath: string;
  logoutPath: string;
}

/** The shipped classifier prompt. Replies on one line: `ALLOW`, or `BLOCK: <reason>`.
 *  A single-token verdict is read with a plain substring test — far more robust
 *  than parsing JSON out of free-form model text, and it fails OPEN (no BLOCK
 *  token ⇒ allowed) if the model ever rambles. */
const DEFAULT_GUARDRAIL_INSTRUCTIONS =
  "You are a conduct classifier guarding a professional, workplace assistant. Decide whether the user's " +
  "message raises a subject that is NOT appropriate for a professional environment — for example sexual or " +
  "explicit content, hate speech or harassment, graphic violence, illegal activity, or self-harm. " +
  "Reply on a single line: write `BLOCK: <short reason>` if the message is not permitted, or the single word " +
  "`ALLOW` otherwise. Ordinary workplace conversation is ALLOW; when in doubt, ALLOW.";

/** Parse `CHAT_GUARDRAIL` — anything falsy-looking turns the wiring off. */
function envEnabled(): boolean {
  const raw = process.env.CHAT_GUARDRAIL;
  return !(raw && /^(false|0|off|no)$/i.test(raw.trim()));
}

/**
 * Resolve to a LIST of instances: `options.instances` (each layered over the
 * top-level defaults) when present, else a single instance from the top-level
 * options. The single, no-instances case keeps slug "" → unprefixed ids, so it
 * is byte-compatible with the pre-multi-instance mod.
 */
export function resolveInstances(options: ChatModOptions = {}): ResolvedChatOptions[] {
  const { instances, ...base } = options;
  if (instances?.length) return instances.map((inst) => resolveOptions({ ...base, ...inst }));
  return [resolveOptions(base)];
}

export function resolveOptions(options: ChatModOptions = {}): ResolvedChatOptions {
  return {
    mount: (options.mount ?? "/chat").replace(/\/$/, "") || "/chat",
    slug: (options.slug ?? "").trim(),
    brand: { accent: options.brand?.accent, title: options.brand?.title },
    assets: options.assets,
    agent: {
      name: options.agent?.name ?? "assistant",
      instructions:
        options.agent?.instructions ??
        "You are a helpful, concise assistant. Use the available tools when they genuinely help.",
      model: options.agent?.model,
    },
    turnPipeline: options.turnPipeline ?? true,
    turnTtlMs: options.turnTtlMs ?? 5 * 60 * 1000,
    maxTurns: options.maxTurns ?? 12,
    guardrail: (() => {
      const g = typeof options.guardrail === "object" ? options.guardrail : {};
      const explicit = typeof options.guardrail === "boolean" ? options.guardrail : g.enabled;
      return {
        enabled: explicit ?? envEnabled(),
        model: g.model ?? "gpt-4.1-mini",
        instructions: g.instructions ?? DEFAULT_GUARDRAIL_INSTRUCTIONS,
      };
    })(),
    requireAuth: options.requireAuth ?? { env: "CHAT_REQUIRE_AUTH" },
    loginRequestPath: options.loginRequestPath ?? "/auth/magic-link/request",
    logoutPath: options.logoutPath ?? "/auth/logout",
  };
}
