import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { OpInfo, RunResult, WorkflowDoc } from "@pattern-js/admin-sdk";
import { api } from "../lib/api";
import { Badge, Dot, JsonView, Modal, NeonButton, Spinner } from "../components/ui";
import { JsonCode } from "../components/JsonCode";
import { statusColor } from "../lib/format";
import { sfx } from "../lib/sfx";
import type { OpMap } from "./graph";

/** Coerce a free-text field to number / boolean / JSON when it looks like one. */
function coerce(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return undefined;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      return raw;
    }
  }
  return raw;
}

function parseJson(raw: string, fallback: unknown): unknown {
  try {
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

interface TriggerNode {
  id: string;
  op: string;
}

/** Build the trigger input object for a given trigger op type + form values. */
function buildInput(op: string, config: Record<string, any>, form: Record<string, string>): Record<string, unknown> {
  switch (op) {
    case "boundary.manual": {
      const outputs: string[] = config.outputs ?? ["value"];
      const input: Record<string, unknown> = {};
      for (const o of outputs) input[o] = coerce(form[o] ?? "");
      return input;
    }
    case "boundary.http.request": {
      const path: string = config.path ?? "/";
      const params: Record<string, string> = {};
      for (const m of path.matchAll(/:([A-Za-z0-9_]+)/g)) params[m[1]!] = form[`param.${m[1]}`] ?? "";
      return {
        method: String(config.method ?? "GET").toUpperCase(),
        url: path,
        path,
        headers: {},
        query: parseJson(form.query ?? "", {}),
        params,
        body: parseJson(form.body ?? "", undefined),
      };
    }
    case "boundary.schedule":
      return { timestamp: Date.now(), scheduledFor: Date.now() };
    case "boundary.event":
    case "boundary.hook":
      return { payload: parseJson(form.payload ?? "", {}) };
    case "boundary.ws.message":
      return { message: parseJson(form.message ?? "", form.message ?? ""), connection: form.connection || "conn-1" };
    default:
      return parseJson(form.input ?? "", {}) as Record<string, unknown>;
  }
}

/** Build a copy-paste curl for an HTTP trigger from its config + the form values.
 *  Base is this host's origin (the app's routes are served alongside the admin);
 *  a trigger `port` override swaps the port. Null for non-HTTP triggers. */
function curlForTrigger(op: string, config: Record<string, any>, form: Record<string, string>): string | null {
  if (op !== "boundary.http.request") return null;
  const method = String(config.method ?? "GET").toUpperCase();
  const path = String(config.path ?? "/").replace(/:([A-Za-z0-9_]+)/g, (_m, p: string) => {
    const v = form[`param.${p}`];
    return v ? encodeURIComponent(v) : `:${p}`;
  });
  const query = parseJson(form.query ?? "", {}) as Record<string, unknown>;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v != null) qs.set(k, String(v));
  const base = config.port ? `${location.protocol}//${location.hostname}:${config.port}` : location.origin;
  const url = base + path + (qs.toString() ? `?${qs}` : "");
  const q = (v: string) => "'" + v.replace(/'/g, "'\\''") + "'";
  const lines = [`curl -X ${method} ${q(url)}`];
  const body = parseJson(form.body ?? "", undefined);
  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    lines.push(`  -H ${q("content-type: application/json")}`);
    lines.push(`  --data-raw ${q(typeof body === "string" ? body : JSON.stringify(body))}`);
  }
  return lines.join(" \\\n");
}

/** Show a curl with a copy button (mirrors the Runs page's reconstructed curl). */
function CurlBlock({ curl }: { curl: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="glass mt-3 rounded-xl p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-muted text-[10px] font-semibold uppercase tracking-wider">curl</span>
        <button
          type="button"
          className="text-xs text-[var(--color-neon-cyan)] hover:underline"
          onClick={() => {
            void navigator.clipboard?.writeText(curl).then(() => {
              setCopied(true);
              sfx.play("toggle");
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="text-muted overflow-x-auto whitespace-pre font-mono text-xs">{curl}</pre>
    </div>
  );
}

function TriggerForm({ op, config, form, set }: { op: string; config: Record<string, any>; form: Record<string, string>; set: (k: string, v: string) => void }) {
  const input = "glass w-full rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]";
  const Label = ({ children }: { children: string }) => <div className="text-muted mb-1 font-mono text-xs">{children}</div>;
  /** Props for a highlighted JSON field bound to one form key (spread onto
   *  JsonCode inline — a nested component would remount per keystroke). */
  const json = (k: string) => ({ text: form[k] ?? "", onText: (t: string) => set(k, t), height: "h-20", placeholder: "{}", ariaLabel: k });

  if (op === "boundary.manual") {
    const outputs: string[] = config.outputs ?? ["value"];
    return (
      <div className="space-y-3">
        {outputs.map((o) => (
          <div key={o}>
            <Label>{o}</Label>
            <input className={input} value={form[o] ?? ""} onChange={(e) => set(o, e.target.value)} placeholder="value (number/bool/json auto-detected)" />
          </div>
        ))}
      </div>
    );
  }
  if (op === "boundary.http.request") {
    const path: string = config.path ?? "/";
    const params = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
    return (
      <div className="space-y-3">
        <div className="text-muted text-xs">{String(config.method ?? "GET").toUpperCase()} {path}</div>
        {params.map((p) => (
          <div key={p}>
            <Label>{`:${p}`}</Label>
            <input className={input} value={form[`param.${p}`] ?? ""} onChange={(e) => set(`param.${p}`, e.target.value)} />
          </div>
        ))}
        <div>
          <Label>query (JSON)</Label>
          <JsonCode {...json("query")} />
        </div>
        <div>
          <Label>body (JSON)</Label>
          <JsonCode {...json("body")} />
        </div>
      </div>
    );
  }
  if (op === "boundary.schedule") return <div className="text-muted text-sm">Fires with the current timestamp.</div>;
  if (op === "boundary.event" || op === "boundary.hook") {
    return (
      <div>
        <Label>payload (JSON)</Label>
        <JsonCode {...json("payload")} />
      </div>
    );
  }
  if (op === "boundary.ws.message") {
    return (
      <div className="space-y-3">
        <div>
          <Label>message (JSON or text)</Label>
          <JsonCode {...json("message")} placeholder="" plainOk />
        </div>
        <div>
          <Label>connection</Label>
          <input className={input} value={form.connection ?? ""} onChange={(e) => set("connection", e.target.value)} placeholder="conn-1" />
        </div>
      </div>
    );
  }
  return (
    <div>
      <Label>input (JSON)</Label>
      <JsonCode {...json("input")} />
    </div>
  );
}

export function RunPanel({ open, onClose, doc, opMap }: { open: boolean; onClose: () => void; doc: WorkflowDoc; opMap: OpMap }) {
  const navigate = useNavigate();
  const triggers: TriggerNode[] = useMemo(
    () => doc.nodes.filter((n) => (opMap.get(n.op) as OpInfo | undefined)?.boundary === "trigger").map((n) => ({ id: n.id, op: n.op })),
    [doc, opMap],
  );
  const [triggerId, setTriggerId] = useState(triggers[0]?.id ?? "");
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [stopNote, setStopNote] = useState<string | null>(null);
  // Minted CLIENT-side so Stop can cancel by id immediately — the server's
  // response (which carries the id) only arrives when the run is over.
  const liveRunId = useRef<string | null>(null);

  const trigger = triggers.find((t) => t.id === triggerId) ?? triggers[0];
  const config = (doc.nodes.find((n) => n.id === trigger?.id)?.config ?? {}) as Record<string, any>;
  const curl = trigger ? curlForTrigger(trigger.op, config, form) : null;

  const run = async () => {
    if (!trigger) return;
    setBusy(true);
    setResult(null);
    setStopNote(null);
    sfx.play("run");
    liveRunId.current = crypto.randomUUID();
    try {
      const res = await api.run({ doc, trigger: trigger.id, input: buildInput(trigger.op, config, form), runId: liveRunId.current });
      setResult(res);
      sfx.play(res.ok && res.status === "ok" ? "ok" : res.ok ? "error" : "invalid");
    } catch (err) {
      sfx.play("error");
      throw err;
    } finally {
      liveRunId.current = null;
      setBusy(false);
    }
  };

  const stop = async () => {
    const id = liveRunId.current;
    if (!id) return;
    sfx.play("close");
    const { ok } = await api.runs.cancel(id);
    setStopNote(ok ? null : "Too late — the run had already finished.");
  };

  return (
    <Modal open={open} onClose={onClose} title="Run workflow" wide>
      {triggers.length === 0 ? (
        <p className="text-muted text-sm">This workflow has no trigger to run.</p>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          <div>
            {triggers.length > 1 && (
              <div className="mb-3">
                <div className="text-muted mb-1 text-xs">Trigger</div>
                <select className="glass w-full rounded-lg px-2.5 py-1.5 text-sm outline-none" value={triggerId} onChange={(e) => setTriggerId(e.target.value)}>
                  {triggers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id} — {t.op}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {trigger && <TriggerForm op={trigger.op} config={config} form={form} set={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />}
            <div className="mt-4 flex gap-2">
              <NeonButton className="flex-1 justify-center" onClick={run} disabled={busy}>
                {busy ? "Running…" : "▶ Run"}
              </NeonButton>
              {busy && (
                <NeonButton variant="danger" title="Stop — abort the in-flight run" onClick={() => void stop()}>
                  ⏹ Stop
                </NeonButton>
              )}
            </div>
            {stopNote && <p className="text-muted mt-2 text-xs">{stopNote}</p>}
            {curl && <CurlBlock curl={curl} />}
          </div>

          <div>
            <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">Result</div>
            {busy && <Spinner />}
            {!busy && !result && <p className="text-muted text-sm">Launch the run to see its output here.</p>}
            {result && !result.ok && (
              <div className="space-y-1">
                <Badge hue={340}>validation failed</Badge>
                {result.issues.map((iss, i) => (
                  <div key={i} className="text-xs">
                    <span className="font-mono text-[var(--color-neon-amber)]">{iss.nodeId}</span> {iss.message}
                  </div>
                ))}
              </div>
            )}
            {result && result.ok && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Dot color={statusColor(result.status)} />
                  <Badge hue={result.status === "error" ? 340 : result.status === "canceled" ? 45 : 150}>{result.status}</Badge>
                  <button className="text-muted ml-auto text-xs underline" onClick={() => navigate(`/runs/${result.runId}`)}>
                    open in Runs ↗
                  </button>
                </div>
                {result.error && <div className="text-[var(--color-neon-pink)] text-xs">{result.error}</div>}
                <JsonView value={result.outputs} className="max-h-72" />
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
