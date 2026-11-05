/**
 * A workflow's workspace: the chrome every workflow page shares.
 *
 *   ┌ open workflows ─────────────────────────────────────────── + ┐
 *   │ name · slug · source            Unsaved changes · Saved v8 · Live v7 [Deploy v8] │
 *   │ Editor · Runs · Versions · Settings                            │
 *   └ <Outlet /> ──────────────────────────────────────────────────┘
 *
 * The strip of open workflows is the workspace's memory (localStorage): every
 * workflow you open stays open, with its editor draft, until you close it. The
 * deployment state says the truth in one line — whether the canvas differs
 * from what's saved, and whether what's saved is what's live — and "Deploy vN"
 * previews what changes before anything moves.
 */

import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import type { WorkflowMeta } from "@pattern-js/admin-sdk";
import { useDeploy, useOps, useWorkflow } from "../../lib/queries";
import { NEW_KEY, closeTab, openTab, readDraft, tabSlugOf, useWorkspace } from "../../lib/workspace";
import { deployPreview } from "../../lib/deploy-preview";
import { DeployPreviewModal } from "../../editor/DeployPreview";
import { Badge, Modal, NeonButton, Spinner } from "../../components/ui";
import { Rocket } from "../../components/icon";
import { tip } from "../../components/Tooltip";
import { Lock } from "lucide-react";
import { sfx } from "../../lib/sfx";

const TABS = ["editor", "runs", "versions", "settings"] as const;
export type WorkflowTab = (typeof TABS)[number];

/** Which tab a pathname is on (`/workflows/:slug/<tab>/…`; the new-workflow route is the editor). */
export function workflowTabOf(pathname: string): WorkflowTab {
  const seg = pathname.split("/").filter(Boolean);
  const t = seg[2] ?? "";
  return (TABS as readonly string[]).includes(t) ? (t as WorkflowTab) : "editor";
}

/** The URL of a workspace tab for a tab key (the new-workflow key only has an editor). */
export const workflowUrl = (key: string, tab: WorkflowTab = "editor"): string =>
  key === NEW_KEY ? "/workflows/new" : `/workflows/${encodeURIComponent(key)}/${tab}`;

/** The strip of open workflows — every one you opened, with its unsaved dot. */
function OpenStrip({ activeKey, tab }: { activeKey: string; tab: WorkflowTab }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const [closing, setClosing] = useState<string | null>(null);

  const doClose = (key: string) => {
    const { neighbor } = closeTab(key);
    setClosing(null);
    sfx.play("delete");
    if (key === activeKey) navigate(neighbor ? workflowUrl(neighbor, tab) : "/workflows");
  };
  const requestClose = (key: string) => {
    if (readDraft(key)?.dirty) setClosing(key);
    else doClose(key);
  };

  return (
    <div className="mb-2 flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Open workflows">
      {ws.open.map((k) => {
        const active = k === activeKey;
        const d = ws.drafts[k];
        const label = k === NEW_KEY ? `✦ ${d?.newSlug || "new"}` : k;
        return (
          <div
            key={k}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => {
              if (!active) {
                sfx.play("nav");
                navigate(workflowUrl(k, tab));
              }
            }}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !active) {
                e.preventDefault();
                navigate(workflowUrl(k, tab));
              }
            }}
            title={k === NEW_KEY ? "New workflow (unsaved)" : k}
            className={`group flex max-w-56 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-neon-cyan)] ${
              active ? "border-[var(--color-neon-cyan)]/40 bg-white/10 text-[var(--fg)]" : "hairline text-muted bg-transparent hover:bg-white/5 hover:text-[var(--fg)]"
            }`}
          >
            <span className="truncate font-mono">{label}</span>
            {d?.dirty && <span aria-label="unsaved changes" title="Unsaved changes" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-neon-amber)]" />}
            <button
              type="button"
              aria-label={`Close ${label}`}
              title="Close"
              onClick={(e) => {
                e.stopPropagation();
                requestClose(k);
              }}
              className="text-muted -mr-1 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-white/10 hover:text-[var(--fg)]"
            >
              ✕
            </button>
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New workflow"
        {...tip("New workflow")}
        onClick={() => {
          sfx.play("nav");
          navigate("/workflows/new");
        }}
        className="text-muted shrink-0 rounded-lg border hairline px-2.5 py-1.5 text-xs hover:bg-white/5 hover:text-[var(--fg)]"
      >
        +
      </button>

      {/* Closing a dirty tab — make losing work an explicit choice. */}
      <Modal open={closing !== null} onClose={() => setClosing(null)} title="Close workflow">
        {closing && (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="font-mono">{closing === NEW_KEY ? ws.drafts[NEW_KEY]?.newSlug || "new workflow" : closing}</span> has unsaved changes. Close anyway?
            </p>
            <div className="flex justify-end gap-2">
              <NeonButton variant="ghost" onClick={() => setClosing(null)}>
                Keep it open
              </NeonButton>
              <NeonButton variant="danger" onClick={() => doClose(closing)}>
                Discard &amp; close
              </NeonButton>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Pill({ tone, children, title }: { tone: "amber" | "cyan" | "lime" | "muted"; children: React.ReactNode; title?: string }) {
  const color = { amber: "var(--color-neon-amber)", cyan: "var(--color-neon-cyan)", lime: "var(--color-neon-lime)", muted: "var(--fg-muted)" }[tone];
  return (
    <span title={title} className="glass flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: tone === "muted" ? undefined : `0 0 6px ${color}` }} />
      {children}
    </span>
  );
}

/**
 * The deployment state in one strip: draft vs saved vs live. "Deploy vN"
 * deploys the last SAVED version — never the canvas (the editor's own Deploy
 * saves first); the preview says what changes.
 */
function DeployState({ slug, meta, dirty, onNotice }: { slug: string; meta: WorkflowMeta; dirty: boolean; onNotice: (text: string | null) => void }) {
  const { data: wf } = useWorkflow(slug);
  const { data: ops } = useOps();
  const deploy = useDeploy();
  const [previewOpen, setPreviewOpen] = useState(false);
  const newest = meta.versions[meta.versions.length - 1]?.id ?? null;
  const live = meta.live;
  const isCode = meta.source === "code";
  const opMap = useMemo(() => new Map((ops ?? []).map((o) => [o.type, o])), [ops]);
  const preview = useMemo(
    () => (previewOpen && wf?.latestDoc ? deployPreview(wf.liveDoc ?? null, wf.latestDoc, opMap) : null),
    [previewOpen, wf, opMap],
  );

  const go = () => {
    if (!newest) return;
    deploy.mutate(
      { slug, version: newest, swap: false },
      {
        onSuccess: (res) => {
          setPreviewOpen(false);
          if (res.ok) {
            onNotice(null);
            sfx.play("deploy");
          } else {
            onNotice(`Cannot deploy ${newest}: ${res.conflicts.map((c) => `${c.route.method} ${c.route.path} conflicts with ${c.conflictsWith}`).join("; ")}`);
            sfx.play("error");
          }
        },
        onError: (err) => {
          setPreviewOpen(false);
          onNotice(`Deploy failed: ${err instanceof Error ? err.message : String(err)}`);
          sfx.play("error");
        },
      },
    );
  };

  return (
    <div className="flex items-center gap-1.5" aria-label="Deployment state">
      {dirty && <Pill tone="amber" title="The canvas differs from the last saved version — Save or Deploy from the editor.">Unsaved changes</Pill>}
      {isCode ? (
        <Pill tone="cyan" title="Shipped by a mod: registered at boot from code, not from a saved version.">
          code · {meta.enabled ? "registered" : "undeployed"}
        </Pill>
      ) : !newest ? (
        <Pill tone="muted">Not saved yet</Pill>
      ) : newest !== live ? (
        <>
          <Pill tone="cyan" title={`${newest} is the newest saved version — not live yet.`}>
            Saved {newest}
          </Pill>
          <Pill tone={live ? "lime" : "muted"} title={live ? `${live} is what runs right now.` : "No version is live yet."}>
            Live {live ?? "—"}
          </Pill>
          <NeonButton
            variant="ghost"
            className="!px-2.5 !py-1 text-xs"
            title={`Deploy ${newest} — the last saved version${dirty ? " (your unsaved canvas changes are not included; use the editor's Deploy for those)" : ""}. Shows what changes first.`}
            disabled={deploy.isPending}
            onClick={() => setPreviewOpen(true)}
          >
            <Rocket size={12} /> Deploy {newest}
          </NeonButton>
        </>
      ) : (
        <Pill tone={meta.enabled ? "lime" : "amber"} title={meta.enabled ? `${live} is saved and live — what you see is what runs.` : `${live} is the live version but the workflow is undeployed (its routes are unregistered).`}>
          Live {live}
          {!meta.enabled && " · undeployed"}
        </Pill>
      )}
      <DeployPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onDeploy={go}
        preview={preview}
        slug={slug}
        version={newest ?? ""}
        busy={deploy.isPending}
      />
    </div>
  );
}

export function WorkflowLayout() {
  const { slug } = useParams();
  const isNew = !slug;
  const key = slug ?? NEW_KEY;
  const location = useLocation();
  const tab = workflowTabOf(location.pathname);
  const ws = useWorkspace();
  const { data: wf, isLoading, isError } = useWorkflow(slug);
  const [notice, setNotice] = useState<string | null>(null);

  // The workflow being viewed is always an open tab, and the last one visited.
  useEffect(() => {
    openTab(key);
  }, [key]);
  useEffect(() => setNotice(null), [key]);

  const meta = wf?.meta ?? null;
  const isCode = meta?.source === "code";
  const dirty = Boolean(ws.drafts[key]?.dirty);
  const title = isNew ? "New workflow" : (meta?.name ?? slug!);

  const tabs: Array<{ id: WorkflowTab; label: string; title?: string }> = [
    { id: "editor", label: "Editor" },
    { id: "runs", label: "Runs", title: "This workflow's runs" },
    { id: "versions", label: "Versions", title: "Immutable snapshots, diffs, restore" },
    { id: "settings", label: "Settings", title: "Identity, execution, deployment, danger zone" },
  ];

  return (
    <div className={`flex flex-col ${tab === "editor" ? "h-[calc(100vh-3rem)]" : "min-h-[calc(100vh-3rem)]"}`}>
      <OpenStrip activeKey={key} tab={tab} />

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        {!isNew && meta && meta.name !== slug && <span className="text-muted font-mono text-xs">{slug}</span>}
        {meta && <Badge hue={meta.source === "code" ? 200 : 150}>{meta.source}</Badge>}
        {isCode && (
          <span
            className="flex items-center gap-1 rounded-full bg-[var(--color-neon-amber)]/15 px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-neon-amber)]"
            title="Shipped by a mod — it can't be saved or deployed from here. Fork it to make it yours."
          >
            <Lock size={11} /> read-only
          </span>
        )}
        {meta?.route && (
          <span className="text-muted font-mono text-xs" title="This workflow's HTTP route">
            {meta.route.method} {meta.route.path}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isNew ? <Pill tone="muted">Not saved yet</Pill> : meta ? <DeployState slug={slug!} meta={meta} dirty={dirty} onNotice={setNotice} /> : null}
        </div>
      </div>

      <nav className="mb-3 flex items-center gap-1 border-b hairline" aria-label="Workflow pages">
        {tabs.map((t) => {
          const disabled = isNew && t.id !== "editor";
          if (disabled) {
            return (
              <span key={t.id} className="text-muted/50 cursor-not-allowed px-3 py-1.5 text-sm" title="Save the workflow first">
                {t.label}
              </span>
            );
          }
          return (
            <NavLink
              key={t.id}
              to={workflowUrl(key, t.id)}
              end={t.id !== "runs"}
              title={t.title}
              onClick={() => sfx.play("nav")}
              className={({ isActive }) =>
                `-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
                  isActive ? "border-[var(--color-neon-cyan)] text-[var(--fg)]" : "text-muted border-transparent hover:text-[var(--fg)]"
                }`
              }
            >
              {t.label}
            </NavLink>
          );
        })}
      </nav>

      {notice && (
        <div role="alert" className="glass mb-3 flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-[var(--color-neon-pink)] ring-1 ring-[var(--color-neon-pink)]/40">
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" aria-label="Dismiss" className="text-muted shrink-0" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

      {!isNew && isLoading ? (
        <Spinner />
      ) : !isNew && (isError || (wf && !wf.meta)) ? (
        <div className="glass text-muted rounded-2xl p-8 text-sm">
          No workflow named <span className="font-mono">{slug}</span> — it may have been deleted, or the slug is misspelled.
        </div>
      ) : (
        <Outlet />
      )}
    </div>
  );
}
