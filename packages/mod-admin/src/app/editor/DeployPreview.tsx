/**
 * The deploy conversation: what goes live if you click. One component for both
 * doors — the editor's Deploy (unsaved canvas → save + deploy) and the
 * workspace strip's "Deploy vN" (a saved version → deploy). It renders a
 * `DeployPreview`; the caller owns the action.
 */

import type { ReactNode } from "react";
import { Badge, Modal, NeonButton } from "../components/ui";
import { Rocket } from "../components/icon";
import type { DeployPreview as Preview } from "../lib/deploy-preview";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 text-sm">
      <div className="text-muted pt-0.5 text-xs font-semibold uppercase tracking-wider">{label}</div>
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-xs">{children}</span>;

export function DeployPreviewModal({
  open,
  onClose,
  onDeploy,
  preview,
  slug,
  version,
  busy,
  note,
}: {
  open: boolean;
  onClose: () => void;
  onDeploy: () => void;
  preview: Preview | null;
  slug: string;
  /** The version going live ("v9"), or what will be minted ("a new version"). */
  version: string;
  busy?: boolean;
  /** Extra line the caller wants said (e.g. "saves the canvas first"). */
  note?: string;
}) {
  if (!open || !preview) return null;
  const p = preview;
  const risky = p.external.added.length > 0 || p.auth.some((a) => a.after === "none" || a.after.startsWith("—"));
  const quiet = !p.first && p.equal;
  return (
    <Modal open onClose={onClose} title={p.first ? `Deploy ${slug} for the first time` : `Deploy ${slug} · ${version}`}>
      <div className="space-y-4">
        {quiet ? (
          <p className="text-muted text-sm">
            Nothing the engine reads changes — same nodes, wiring, config, and flags as the live version. Deploying only moves the pointer.
          </p>
        ) : (
          <div className="space-y-3">
            {p.first && <p className="text-muted text-sm">No version is live yet. Deploying registers everything below.</p>}
            {(p.routes.added.length > 0 || p.routes.removed.length > 0) && (
              <Row label="Routes">
                {p.routes.added.map((r) => (
                  <div key={`+${r}`} className="text-[var(--color-neon-lime)]">
                    + <Mono>{r}</Mono> starts serving
                  </div>
                ))}
                {p.routes.removed.map((r) => (
                  <div key={`-${r}`} className="text-[var(--color-neon-pink)]">
                    − <Mono>{r}</Mono> stops serving
                  </div>
                ))}
              </Row>
            )}
            {(p.schedules.added.length > 0 || p.schedules.removed.length > 0) && (
              <Row label="Schedules">
                {p.schedules.added.map((s) => (
                  <div key={`+${s}`} className="text-[var(--color-neon-lime)]">
                    + <Mono>{s}</Mono>
                  </div>
                ))}
                {p.schedules.removed.map((s) => (
                  <div key={`-${s}`} className="text-[var(--color-neon-pink)]">
                    − <Mono>{s}</Mono>
                  </div>
                ))}
              </Row>
            )}
            {p.auth.length > 0 && (
              <Row label="Auth">
                {p.auth.map((a) => (
                  <div key={a.node} className={a.after === "none" ? "text-[var(--color-neon-amber)]" : ""}>
                    <Mono>{a.node}</Mono>: {a.before} → <span className="font-medium">{a.after}</span>
                    {a.after === "none" && " — this route becomes public"}
                  </div>
                ))}
              </Row>
            )}
            {(p.external.added.length > 0 || p.external.removed.length > 0) && (
              <Row label="Side effects">
                {p.external.added.map((n) => (
                  <div key={`+${n.node}`} className="flex items-center gap-1.5">
                    <Badge hue={45}>external</Badge>
                    <Mono>{n.node}</Mono> <span className="text-muted text-xs">({n.op})</span> joins the graph
                  </div>
                ))}
                {p.external.removed.map((n) => (
                  <div key={`-${n.node}`} className="text-muted flex items-center gap-1.5">
                    − <Mono>{n.node}</Mono> <span className="text-xs">({n.op})</span> leaves
                  </div>
                ))}
                {p.external.added.length > 0 && (
                  <p className="text-muted text-xs">
                    These nodes send, charge, or write outside this process. Live runs will do so for real — mark the workflow durable if a
                    failure mid-way must be resumable without repeating them.
                  </p>
                )}
              </Row>
            )}
            {p.flags.length > 0 && (
              <Row label="Execution">
                {p.flags.map((f) => (
                  <div key={f.flag}>
                    <span className="font-medium capitalize">{f.flag}</span> {f.before ? "on" : "off"} → <span className="font-medium">{f.after ? "on" : "off"}</span>
                    {f.flag === "durable" && f.after && <span className="text-muted text-xs"> — runs land in the RunLedger; resume & re-run appear on the run page</span>}
                    {f.flag === "durable" && !f.after && <span className="text-muted text-xs"> — new runs are no longer recorded; existing ledger records stay</span>}
                  </div>
                ))}
              </Row>
            )}
            <Row label="Graph">
              <div className="text-muted text-xs">
                nodes {p.nodes.added > 0 && <span className="text-[var(--color-neon-lime)]">+{p.nodes.added} </span>}
                {p.nodes.removed > 0 && <span className="text-[var(--color-neon-pink)]">−{p.nodes.removed} </span>}
                {p.nodes.changed > 0 && <span className="text-[var(--color-neon-amber)]">~{p.nodes.changed} </span>}
                {p.nodes.added + p.nodes.removed + p.nodes.changed === 0 && "unchanged "}· edges{" "}
                {p.edges.added > 0 && <span className="text-[var(--color-neon-lime)]">+{p.edges.added} </span>}
                {p.edges.removed > 0 && <span className="text-[var(--color-neon-pink)]">−{p.edges.removed} </span>}
                {p.edges.added + p.edges.removed === 0 && "unchanged"}
              </div>
            </Row>
          </div>
        )}
        {note && <p className="text-muted text-xs">{note}</p>}
        <div className="flex justify-end gap-2">
          <NeonButton variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </NeonButton>
          <NeonButton variant={risky ? "danger" : "solid"} onClick={onDeploy} disabled={busy}>
            <Rocket size={14} /> {p.first ? "Deploy" : `Deploy ${version}`}
          </NeonButton>
        </div>
      </div>
    </Modal>
  );
}
