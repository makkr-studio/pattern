/** @pattern-js/mod-chat — options & defaults. */

/** Brand the SPA reads from window.__APP__. */
export interface ChatBrand {
  accent?: string;
  title?: string;
}

/**
 * One hosted SPA instance: a branded mount over the SHARED backend. The
 * `namespace` (decoupled from the mount) partitions its data; an optional
 * `agent` mints a namespace-pinned fork of the turn pipeline so this instance's
 * turns run a different agent (its hardwired :ns path overrides the generic).
 */
export interface ChatInstanceOptions {
  /** Where this SPA is served, e.g. "/sales". */
  mount: string;
  /** Data partition (defaults to the mount's last segment, else "default"). */
  namespace?: string;
  brand?: ChatBrand;
  /** Override the agent for THIS namespace only (→ a pinned turn-pipeline fork). */
  agent?: { name?: string; instructions?: string; model?: string };
}

export interface ChatModOptions {
  /** Where the SHARED backend (API) and the default SPA mount live. Default "/chat". */
  mount?: string;
  /** The default instance's data namespace. Default "default". */
  namespace?: string;
  /** The default instance's brand. */
  brand?: ChatBrand;
  /**
   * Host the SAME app several times: one shared backend, many branded SPA
   * mounts. Each is a light SPA over the backend at `mount`, partitioned by its
   * `namespace`. When set, the top-level mount still hosts the backend (and,
   * unless an instance also mounts there, no default SPA).
   */
  instances?: ChatInstanceOptions[];
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

/** The resolved SHARED backend config (one set of ops + routes, all instances). */
export interface ResolvedChatOptions {
  mount: string;
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

/** A resolved SPA instance (fed to spaWorkflow). */
export interface ResolvedInstance {
  mount: string;
  api: string;
  namespace: string;
  brand: ChatBrand;
}

/** A resolved namespace-pinned agent (fed to turnPipelineWorkflow as a fork). */
export interface ResolvedPin {
  namespace: string;
  agent: { name: string; instructions: string; model?: string };
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

/** Strip a trailing slash; root stays the given default. */
function norm(mount: string, dflt: string): string {
  return mount.replace(/\/$/, "") || dflt;
}

/**
 * Resolve the hosted SPA instances and any namespace-pinned agents. With no
 * `instances`, that's a single default SPA at `mount` (namespace "default") —
 * byte-compatible with the single-instance mod. The backend always lives at
 * `mount`; every instance's SPA points its `api` there.
 */
export function resolveInstances(options: ChatModOptions = {}): { instances: ResolvedInstance[]; pins: ResolvedPin[] } {
  const api = norm(options.mount ?? "/chat", "/chat");
  if (!options.instances?.length) {
    const namespace = options.namespace ?? "default";
    return { instances: [{ mount: api, api, namespace, brand: options.brand ?? {} }], pins: [] };
  }
  const instances: ResolvedInstance[] = [];
  const pins: ResolvedPin[] = [];
  for (const inst of options.instances) {
    const mount = norm(inst.mount, "/chat");
    const namespace = inst.namespace ?? mount.split("/").filter(Boolean).pop() ?? "default";
    instances.push({ mount, api, namespace, brand: inst.brand ?? {} });
    if (inst.agent) {
      pins.push({
        namespace,
        agent: {
          name: inst.agent.name ?? namespace,
          instructions: inst.agent.instructions ?? "You are a helpful, concise assistant.",
          model: inst.agent.model,
        },
      });
    }
  }
  return { instances, pins };
}

export function resolveOptions(options: ChatModOptions = {}): ResolvedChatOptions {
  return {
    mount: norm(options.mount ?? "/chat", "/chat"),
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
