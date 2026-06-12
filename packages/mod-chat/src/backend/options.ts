/** @pattern/mod-chat — options & defaults. */

export interface ChatModOptions {
  /** Where the chat app mounts (UI + API under here). Default "/chat". */
  mount?: string;
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
}

export interface ResolvedChatOptions {
  mount: string;
  assets?: string;
  agent: { name: string; instructions: string; model?: string };
  turnPipeline: boolean;
  turnTtlMs: number;
  maxTurns: number;
  requireAuth?: unknown;
  loginRequestPath: string;
}

export function resolveOptions(options: ChatModOptions = {}): ResolvedChatOptions {
  return {
    mount: (options.mount ?? "/chat").replace(/\/$/, "") || "/chat",
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
    requireAuth: options.requireAuth ?? { env: "CHAT_REQUIRE_AUTH" },
    loginRequestPath: options.loginRequestPath ?? "/auth/magic-link/request",
  };
}
