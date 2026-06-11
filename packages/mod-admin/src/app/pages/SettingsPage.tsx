import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SettingsSection as ModSection } from "@pattern/admin-sdk";
import { api } from "../lib/api";
import { useManifest } from "../lib/queries";
import { useTheme, type ThemeMode } from "../lib/theme";
import { sfx } from "../lib/sfx";
import { readSettings, writeSettings, DEFAULT_SETTINGS, type AdminSettings } from "../lib/settings";
import { Badge, GlassPanel, NeonButton, PageHeader } from "../components/ui";
import { Sun, Moon, SunMoon, Volume2, VolumeX } from "../components/icon";

const DRAFT_KEY = "pattern.admin.editor.draft";
const PANES_KEY = "pattern.admin.editor.panes";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <GlassPanel className="p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="text-muted mt-0.5 text-xs">{hint}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </GlassPanel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-2">{children}</span>
    </div>
  );
}

/**
 * A mod-contributed settings section (admin-spec P2): fields bound to a
 * `source` op (current values) and a `submit` op (patches). Edits auto-save —
 * one toggle shouldn't need a Save button — and re-read, so the panel always
 * shows what the server accepted.
 */
function ModSettingsSection({ mod, section, flash }: { mod: string; section: ModSection; flash: (t: string) => void }) {
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["invoke", section.source],
    queryFn: () => api.invoke<Record<string, unknown>>(section.source),
  });
  const [saving, setSaving] = useState(false);

  const save = async (key: string, value: unknown) => {
    setSaving(true);
    try {
      await api.invoke(section.submit, { [key]: value });
      await qc.invalidateQueries({ queryKey: ["invoke", section.source] });
      flash(`${section.title}: ${key} saved.`);
    } catch (err) {
      flash(`${section.title}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  if (error) return null; // e.g. insufficient scopes — hide rather than break the page

  return (
    <Section title={section.title} hint={section.description ?? `Contributed by ${mod}.`}>
      {section.fields.map((field) => {
        const current = data?.[field.key];
        return (
          <div key={field.key}>
            <Row label={field.label}>
              {field.type === "select" &&
                (field.options ?? []).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={saving || data === undefined}
                    onClick={() => current !== opt.value && void save(field.key, opt.value)}
                    className={`rounded-lg px-3 py-1.5 text-xs ${current === opt.value ? "bg-[var(--color-neon-cyan)] font-medium text-black" : "glass text-muted hover:bg-white/5"}`}
                  >
                    {opt.label}
                  </button>
                ))}
              {field.type === "toggle" && (
                <NeonButton variant="ghost" disabled={saving || data === undefined} onClick={() => void save(field.key, !current)}>
                  {current ? "On" : "Off"}
                </NeonButton>
              )}
              {(field.type === "text" || field.type === "number") && (
                <input
                  defaultValue={current == null ? "" : String(current)}
                  disabled={saving || data === undefined}
                  onBlur={(e) => {
                    const v = field.type === "number" ? Number(e.currentTarget.value) : e.currentTarget.value;
                    if (v !== current) void save(field.key, v);
                  }}
                  className="glass w-44 rounded px-2 py-1 text-right font-mono text-xs outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
                />
              )}
            </Row>
            {field.description && <p className="text-muted mt-1 text-[11px] leading-relaxed">{field.description}</p>}
          </div>
        );
      })}
    </Section>
  );
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
  { mode: "auto", label: "Auto", Icon: SunMoon },
];

interface ObservabilityConfig {
  capacity: number;
  exclude: string | null;
}

/** Server-side knobs: run retention + workflow-id exclusion regex. */
function ObservabilitySection({ flash }: { flash: (text: string) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-settings"], queryFn: () => api.settings.get<{ observability: ObservabilityConfig }>() });
  const [capacity, setCapacity] = useState<number | null>(null);
  const [exclude, setExclude] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Adopt server values once loaded (local edits win until saved).
  useEffect(() => {
    if (data && capacity === null && exclude === null) {
      setCapacity(data.observability.capacity);
      setExclude(data.observability.exclude ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const dirty = data && (capacity !== data.observability.capacity || (exclude || null) !== (data.observability.exclude || null));

  const save = async () => {
    setError(null);
    // Validate the regex client-side first for an instant, friendly message.
    if (exclude) {
      try {
        new RegExp(exclude);
      } catch (err) {
        setError(`Invalid regex: ${err instanceof Error ? err.message : String(err)}`);
        sfx.play("invalid");
        return;
      }
    }
    setSaving(true);
    try {
      await api.settings.set({ observability: { capacity, exclude: exclude || null } });
      await qc.invalidateQueries({ queryKey: ["admin-settings"] });
      flash("Observability settings applied (and persisted with the workflow store).");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      sfx.play("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Observability (server)"
      hint="Applies to the running process immediately and persists with the workflow store. Excluded runs are neither retained nor live-tailed."
    >
      <Row label="Runs retained in memory">
        <input
          type="number" min={10} max={10000} value={capacity ?? ""}
          onChange={(e) => setCapacity(Number(e.target.value))}
          className="glass w-24 rounded px-2 py-1 text-right font-mono text-xs outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
          aria-label="Run retention"
        />
      </Row>
      <Row label="Exclude runs whose workflow id matches (regex)">
        <input
          value={exclude ?? ""}
          onChange={(e) => setExclude(e.target.value)}
          placeholder="^admin\."
          className="glass w-48 rounded px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
          aria-label="Exclusion regex"
        />
      </Row>
      {error && <p className="text-xs text-[var(--color-neon-pink)]">{error}</p>}
      <Row label="">
        <NeonButton onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? "Applying…" : "Apply"}
        </NeonButton>
      </Row>
      <p className="text-muted text-[11px]">
        Tip: <code className="font-mono">^admin\.</code> silences the admin's own API runs — the Runs page stops
        narrating itself and retention is spent on YOUR workflows.
      </p>
    </Section>
  );
}

export function SettingsPage() {
  const { mode, set } = useTheme();
  const [muted, setMuted] = useState(sfx.muted());
  const [settings, setSettings] = useState<AdminSettings>(readSettings());
  const [notice, setNotice] = useState<string | null>(null);
  const { data: manifest } = useManifest();
  const { data: stats } = useQuery({
    queryKey: ["system-stats"],
    queryFn: () => api.systemStats<{ host: { cpus: number }; process: { node: string; pid: number }; transport: { kind?: string; size?: number } }>(),
    refetchInterval: 5000,
  });

  const patch = (p: Partial<AdminSettings>) => setSettings(writeSettings(p));
  const flash = (text: string) => {
    sfx.play("toggle");
    setNotice(text);
    setTimeout(() => setNotice(null), 2500);
  };
  const numInput = "glass w-20 rounded px-2 py-1 text-right font-mono text-xs outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]";

  return (
    <>
      <PageHeader title="Settings" subtitle="Admin preferences live in this browser; runtime knobs belong to the host process (explained below)." />
      {notice && (
        <div role="status" className="glass mb-4 rounded-xl px-4 py-2 text-sm text-[var(--color-neon-lime)]">
          {notice}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Appearance" hint="Theme and sound, same toggles as the sidebar — persisted per browser.">
          <Row label="Theme">
            {THEME_OPTIONS.map(({ mode: m, label, Icon }) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  sfx.play("toggle");
                  set(m);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${mode === m ? "bg-[var(--color-neon-cyan)] font-medium text-black" : "glass text-muted hover:bg-white/5"}`}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </Row>
          <Row label="Sound effects">
            <NeonButton
              variant="ghost"
              onClick={() => {
                const next = !muted;
                sfx.setMuted(next);
                setMuted(next);
                if (!next) sfx.play("toggle");
              }}
            >
              {muted ? <VolumeX size={13} /> : <Volume2 size={13} />} {muted ? "Muted" : "On"}
            </NeonButton>
          </Row>
        </Section>

        <Section title="Editor" hint="Local editor state — useful when a layout or stale draft gets in the way.">
          <Row label="Panel layout (palette / canvas / inspector widths)">
            <NeonButton
              variant="ghost"
              onClick={() => {
                localStorage.removeItem(PANES_KEY);
                flash("Panel layout reset — reopen the editor to see defaults.");
              }}
            >
              Reset
            </NeonButton>
          </Row>
          <Row label="Saved canvas draft (the auto-persisted work-in-progress)">
            <NeonButton
              variant="danger"
              onClick={() => {
                localStorage.removeItem(DRAFT_KEY);
                flash("Draft discarded.");
              }}
            >
              Discard
            </NeonButton>
          </Row>
        </Section>

        <Section title="Benchmark defaults" hint="Pre-filled on the Process page's worker-efficiency benchmark.">
          <Row label="Fibonacci index (n)">
            <input
              type="number" min={20} max={40} value={settings.benchN}
              onChange={(e) => patch({ benchN: Number(e.target.value) })}
              className={numInput} aria-label="Default fibonacci index"
            />
          </Row>
          <Row label="Concurrent runs">
            <input
              type="number" min={1} max={16} value={settings.benchRuns}
              onChange={(e) => patch({ benchRuns: Number(e.target.value) })}
              className={numInput} aria-label="Default concurrent runs"
            />
          </Row>
          <Row label={`Pool size (blank = auto: min(runs, cores − 1)${stats ? ` of ${stats.host.cpus}` : ""})`}>
            <input
              type="number" min={1} max={stats?.host.cpus ?? 32} value={settings.benchWorkers ?? ""}
              placeholder="auto"
              onChange={(e) => patch({ benchWorkers: e.target.value === "" ? null : Number(e.target.value) })}
              className={numInput} aria-label="Default pool size"
            />
          </Row>
          <Row label="Reset to defaults">
            <NeonButton variant="ghost" onClick={() => { setSettings(writeSettings(DEFAULT_SETTINGS)); flash("Benchmark defaults reset."); }}>
              Reset
            </NeonButton>
          </Row>
        </Section>

        <ObservabilitySection flash={flash} />

        {/* Mod-contributed sections (admin-spec P2): identity's signup policy, … */}
        {(manifest?.settings ?? []).map(({ mod, section }) => (
          <ModSettingsSection key={`${mod}:${section.id}`} mod={mod} section={section} flash={flash} />
        ))}

        <Section title="Runtime" hint="Read-only — these belong to the host process, not this browser.">
          <Row label="Node">
            <span className="font-mono text-xs">{stats?.process.node ?? "…"} · pid {stats?.process.pid ?? "…"}</span>
          </Row>
          <Row label="Host CPU cores">
            <span className="font-mono text-xs">{stats?.host.cpus ?? "…"}</span>
          </Row>
          <Row label="Run transport">
            <Badge hue={stats?.transport.kind === "worker-pool" ? 150 : 200}>
              {stats?.transport.kind ?? "…"}{stats?.transport.size ? ` × ${stats.transport.size}` : ""}
            </Badge>
          </Row>
          <p className="text-muted text-[11px] leading-relaxed">
            The engine's worker pool is sized where the engine is built:{" "}
            <code className="font-mono">new Engine({"{"} transport: new WorkerPoolTransport({"{"} size {"}"}) {"}"})</code>
            {" "}— default <code className="font-mono">cores − 1</code>. The admin's own runs stay in-process by design
            (its ops need in-process services), so a pooled engine for user workflows is a host-level choice. The
            benchmark above spins its own temporary pool and doesn't touch this engine.
          </p>
        </Section>
      </div>
    </>
  );
}
