import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { OpInfo, RunResult, WorkflowDoc } from "@pattern/admin-sdk";
import { api } from "../lib/api";
import { Badge, Dot, JsonView, Modal, NeonButton, Spinner } from "../components/ui";
import { statusColor } from "../lib/format";
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

function TriggerForm({ op, config, form, set }: { op: string; config: Record<string, any>; form: Record<string, string>; set: (k: string, v: string) => void }) {
  const input = "glass w-full rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]";
  const ta = "glass w-full rounded-lg p-2 font-mono text-xs outline-none h-20";
  const Label = ({ children }: { children: string }) => <div className="text-muted mb-1 font-mono text-xs">{children}</div>;

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
          <textarea className={ta} value={form.query ?? ""} onChange={(e) => set("query", e.target.value)} placeholder="{}" />
        </div>
        <div>
          <Label>body (JSON)</Label>
          <textarea className={ta} value={form.body ?? ""} onChange={(e) => set("body", e.target.value)} placeholder="{}" />
        </div>
      </div>
    );
  }
  if (op === "boundary.schedule") return <div className="text-muted text-sm">Fires with the current timestamp.</div>;
  if (op === "boundary.event" || op === "boundary.hook") {
    return (
      <div>
        <Label>payload (JSON)</Label>
        <textarea className={ta} value={form.payload ?? ""} onChange={(e) => set("payload", e.target.value)} placeholder="{}" />
      </div>
    );
  }
  if (op === "boundary.ws.message") {
    return (
      <div className="space-y-3">
        <div>
          <Label>message (JSON or text)</Label>
          <textarea className={ta} value={form.message ?? ""} onChange={(e) => set("message", e.target.value)} />
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
      <textarea className={ta} value={form.input ?? ""} onChange={(e) => set("input", e.target.value)} placeholder="{}" />
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

  const trigger = triggers.find((t) => t.id === triggerId) ?? triggers[0];
  const config = (doc.nodes.find((n) => n.id === trigger?.id)?.config ?? {}) as Record<string, any>;

  const run = async () => {
    if (!trigger) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await api.run({ doc, trigger: trigger.id, input: buildInput(trigger.op, config, form) });
      setResult(res);
    } finally {
      setBusy(false);
    }
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
            <NeonButton className="mt-4 w-full justify-center" onClick={run} disabled={busy}>
              {busy ? "Running…" : "▶ Run"}
            </NeonButton>
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
                  <Badge hue={result.status === "error" ? 340 : 150}>{result.status}</Badge>
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
