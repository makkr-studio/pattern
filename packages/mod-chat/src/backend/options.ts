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
  /** requireAuth for ALL chat routes (e.g. { scopes: ["user"] }). Default open. */
  requireAuth?: unknown;
}

export interface ResolvedChatOptions {
  mount: string;
  assets?: string;
  agent: { name: string; instructions: string; model?: string };
  turnPipeline: boolean;
  turnTtlMs: number;
  maxTurns: number;
  requireAuth?: unknown;
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
    requireAuth: options.requireAuth,
  };
}
