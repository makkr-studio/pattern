import { useState } from "react";
import { useManifest } from "../lib/queries";

/**
 * The editor control for a boundary trigger's `requireAuth` — authorization
 * lives HERE, on the trigger, not in the ops. Four modes map onto the config
 * shape the host enforces (`engine.authorize`):
 *
 *   Public      → undefined   (no auth; anyone)
 *   Signed-in   → true        (any authenticated principal)
 *   Scopes      → { scopes }   (the scope selector)
 *   From env    → { env }      (deferred: host reads the var per request)
 *
 * `requireAuth` is also a config PORT, so instead of setting it here an author
 * can wire a pure source (core.const / core.env) into it on the canvas; that
 * wired value wins at registration, matching http.request's `body` schema port.
 */
type Mode = "public" | "signed-in" | "scopes" | "env";

function modeOf(v: unknown): Mode {
  if (v === true) return "signed-in";
  if (v && typeof v === "object" && "scopes" in v) return "scopes";
  if (v && typeof v === "object" && "env" in v) return "env";
  return "public";
}

const MODES: Array<{ id: Mode; label: string }> = [
  { id: "public", label: "Public" },
  { id: "signed-in", label: "Signed-in" },
  { id: "scopes", label: "Scopes" },
  { id: "env", label: "From env" },
];

export function RequireAuthField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const { data: manifest } = useManifest();
  // A requirement is only enforced once an auth provider exists; until then it's
  // declared-but-advisory (the route serves open). Warn so it's never a surprise.
  const unenforced = manifest?.authProvider === false && modeOf(value) !== "public";
  const mode = modeOf(value);
  const scopes = mode === "scopes" ? ((value as { scopes?: string[] }).scopes ?? []) : [];
  const env = mode === "env" ? ((value as { env?: string }).env ?? "") : "";
  const [draft, setDraft] = useState("");

  const setMode = (m: Mode) => {
    if (m === "public") onChange(undefined);
    else if (m === "signed-in") onChange(true);
    else if (m === "scopes") onChange({ scopes: scopes.length ? scopes : [] });
    else onChange({ env: env || "" });
  };

  const addScope = (raw: string) => {
    const next = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !scopes.includes(s));
    if (next.length) onChange({ scopes: [...scopes, ...next] });
    setDraft("");
  };
  const removeScope = (s: string) => onChange({ scopes: scopes.filter((x) => x !== s) });

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`rounded-lg px-2.5 py-1 text-[11px] ${
              mode === m.id ? "bg-[var(--color-neon-cyan)] font-medium text-black" : "glass text-muted hover:bg-white/5"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "scopes" && (
        <div>
          <div className="flex flex-wrap gap-1.5">
            {scopes.map((s) => (
              <span key={s} className="glass inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px]">
                {s}
                <button type="button" className="text-muted hover:text-[var(--color-neon-pink)]" onClick={() => removeScope(s)}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            className="glass mt-1.5 w-full rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
            value={draft}
            placeholder='Add a scope (e.g. "admin"), Enter to add'
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addScope(draft);
              } else if (e.key === "Backspace" && !draft && scopes.length) {
                removeScope(scopes[scopes.length - 1]!);
              }
            }}
            onBlur={() => draft && addScope(draft)}
          />
          <div className="text-muted mt-1 text-[10px]">The principal must carry every listed scope (403 otherwise).</div>
        </div>
      )}

      {mode === "env" && (
        <input
          className="glass w-full rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
          value={env}
          placeholder="ENV_VAR_NAME — host resolves it per request"
          onChange={(e) => onChange({ env: e.target.value })}
        />
      )}

      {mode === "public" && <div className="text-muted text-[10px]">No authentication — anyone can reach this trigger.</div>}
      {mode === "signed-in" && <div className="text-muted text-[10px]">Any authenticated principal (no specific scope).</div>}

      {unenforced && (
        <div className="rounded-lg border border-[var(--color-neon-amber)]/40 bg-[var(--color-neon-amber)]/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-[var(--color-neon-amber)]">
          ⚠ No auth provider installed — this requirement is <b>declared but not enforced</b>. The route
          serves public until you add a provider (e.g. <span className="font-mono">@pattern-js/mod-identity</span>);
          the same declaration then starts enforcing, no edit needed.
        </div>
      )}
    </div>
  );
}
