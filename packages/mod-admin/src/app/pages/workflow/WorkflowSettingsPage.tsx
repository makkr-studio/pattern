/**
 * A workflow's Settings tab — the operational view of one workflow, without
 * the canvas: identity and execution flags (saved as a new version), the
 * deployment (what's live, deploy / undeploy), export, fork, delete.
 *
 * Identity and flags are part of the DOCUMENT, so saving here mints a version
 * exactly like the editor's Save does — and the editor's Workflow panel edits
 * the same fields on the draft. When a dirty draft exists, this page says so
 * rather than silently competing with it.
 */

import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { WorkflowDoc, WorkflowGetResult } from "@pattern-js/admin-sdk";
import { useDeleteWorkflow, useOps, useSaveWorkflow, useSetEnabled, useWorkflow } from "../../lib/queries";
import { closeTab, useWorkspace, writeDraft } from "../../lib/workspace";
import { Badge, GlassPanel, Modal, NeonButton, Spinner } from "../../components/ui";
import { WorkflowFlags } from "../../editor/WorkflowFlags";
import { INPUT_CLS } from "../../editor/Inspector";
import { Download, GitFork, Trash2 } from "../../components/icon";
import { hasErrors, issueSummary } from "../../lib/issues";
import { ago } from "../../lib/format";
import { sfx } from "../../lib/sfx";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <GlassPanel className="p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="text-muted mt-0.5 mb-3 text-xs">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </GlassPanel>
  );
}

type Form = { name: string; description: string; tags: string; offload: boolean; durable: boolean };
const formOf = (d: WorkflowDoc): Form => ({ name: d.name ?? "", description: d.description ?? "", tags: (d.tags ?? []).join(", "), offload: d.offload === true, durable: d.durable === true });

/** The editable part, keyed by the version it started from so a save resets it. */
function DocumentForm({ slug, base, readOnly, draftDirty }: { slug: string; base: WorkflowDoc; readOnly: boolean; draftDirty: boolean }) {
  const save = useSaveWorkflow();
  const { data: ops } = useOps();
  const [form, setForm] = useState<Form>(() => formOf(base));
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const cpuHeavy = useMemo(() => {
    const heavy = new Set((ops ?? []).filter((o) => o.cpuHeavy).map((o) => o.type));
    return base.nodes.filter((n) => heavy.has(n.op)).length;
  }, [ops, base]);
  const changed = JSON.stringify(form) !== JSON.stringify(formOf(base));

  const onSave = async () => {
    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const doc: WorkflowDoc = {
      ...base,
      name: form.name.trim() || undefined,
      description: form.description.trim() || undefined,
      tags: tags.length ? tags : undefined,
      offload: form.offload ? true : undefined,
      durable: form.durable ? true : undefined,
    };
    const res = await save.mutateAsync({ slug, doc, note: "settings" });
    if (hasErrors(res.issues)) {
      setNotice({ kind: "error", text: `${issueSummary(res.issues)} — nothing saved.` });
      sfx.play("invalid");
      return;
    }
    // A clean editor draft follows the saved document (a dirty one is the
    // author's — it keeps its values; the page warned above).
    if (!draftDirty) writeDraft(slug, { slug, doc, dirty: false, at: Date.now() });
    setNotice({ kind: "ok", text: `Saved ${res.version?.id}. Deploy it from the strip above to make it live.` });
    sfx.play("save");
  };

  return (
    <>
      <Section title="Identity" hint="How this workflow shows in the catalog, to Buddy, and in docs. Saved as a new version.">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <div className="text-muted mb-1 text-xs">Name</div>
            <input className={INPUT_CLS} value={form.name} placeholder={slug} disabled={readOnly} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="block">
            <div className="text-muted mb-1 text-xs">Tags (comma-separated)</div>
            <input className={INPUT_CLS} value={form.tags} placeholder="billing, public-api" disabled={readOnly} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          </label>
          <label className="block md:col-span-2">
            <div className="text-muted mb-1 text-xs">Description</div>
            <textarea
              className="glass h-20 w-full rounded-lg p-2 text-sm outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
              value={form.description}
              placeholder="What this workflow is for."
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
        </div>
      </Section>

      <Section title="Execution" hint="Where and how runs execute. Part of the document — a change here is a new version, deployed like any other.">
        <WorkflowFlags value={{ offload: form.offload, durable: form.durable }} cpuHeavyCount={cpuHeavy} disabled={readOnly} onChange={(v) => setForm({ ...form, ...v })} />
      </Section>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <NeonButton onClick={() => void onSave()} disabled={!changed || save.isPending}>
            Save as new version
          </NeonButton>
          {notice && (
            <span role={notice.kind === "error" ? "alert" : "status"} className={`text-sm ${notice.kind === "error" ? "text-[var(--color-neon-pink)]" : "text-[var(--color-neon-lime)]"}`}>
              {notice.text}
            </span>
          )}
        </div>
      )}
    </>
  );
}

function Deployment({ wf, slug }: { wf: WorkflowGetResult; slug: string }) {
  const meta = wf.meta!;
  const setEnabled = useSetEnabled();
  const [confirmUndeploy, setConfirmUndeploy] = useState(false);
  const newest = meta.versions[meta.versions.length - 1];
  const isCode = meta.source === "code";
  const toggle = () => {
    if (isCode && meta.enabled) setConfirmUndeploy(true);
    else setEnabled.mutate({ slug, enabled: !meta.enabled }, { onSuccess: () => sfx.play(meta.enabled ? "toggle" : "deploy") });
  };
  return (
    <Section title="Deployment" hint="What runs right now. Undeploying unregisters the workflow's routes and schedules; the versions stay.">
      <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted">Status</dt>
        <dd className="flex items-center gap-2">
          <Badge hue={meta.enabled ? 150 : 45}>{meta.enabled ? "deployed" : "undeployed"}</Badge>
          <NeonButton variant="ghost" className="!px-2.5 !py-1 text-xs" disabled={setEnabled.isPending} onClick={toggle}>
            {meta.enabled ? "Undeploy" : "Deploy again"}
          </NeonButton>
        </dd>
        <dt className="text-muted">Live version</dt>
        <dd className="font-mono text-xs">{isCode ? "code (registered at boot)" : (meta.live ?? "—")}</dd>
        {!isCode && (
          <>
            <dt className="text-muted">Newest version</dt>
            <dd className="font-mono text-xs">
              {newest ? (
                <>
                  {newest.id}
                  {newest.id !== meta.live && <span className="text-muted ml-2 font-sans">not live — use “Deploy {newest.id}” in the strip above</span>}
                  {newest.createdAt && <span className="text-muted ml-2 font-sans">· {ago(Date.parse(newest.createdAt))}</span>}
                </>
              ) : (
                "—"
              )}
            </dd>
          </>
        )}
        <dt className="text-muted">Route</dt>
        <dd className="font-mono text-xs">{meta.route ? `${meta.route.method} ${meta.route.path}${meta.route.port ? ` :${meta.route.port}` : ""}` : <span className="text-muted font-sans">none (not HTTP-triggered)</span>}</dd>
        <dt className="text-muted">Versions</dt>
        <dd className="text-xs">{meta.versions.length}</dd>
      </dl>

      <Modal open={confirmUndeploy} onClose={() => setConfirmUndeploy(false)} title="Undeploy code workflow">
        <div className="space-y-4">
          <p className="text-sm">
            <span className="font-mono">{slug}</span> is shipped by a mod. Undeploying unregisters it immediately
            {meta.route ? (
              <>
                {" "}
                — <span className="font-mono">{meta.route.method} {meta.route.path}</span> stops serving
              </>
            ) : null}
            .
          </p>
          <p className="text-sm text-[var(--color-neon-amber)]">⚠ Anything depending on it may break (admin pages and APIs included). Re-deploy it here any time; a server restart also brings it back.</p>
          <div className="flex justify-end gap-2">
            <NeonButton variant="ghost" onClick={() => setConfirmUndeploy(false)}>
              Cancel
            </NeonButton>
            <NeonButton
              variant="danger"
              disabled={setEnabled.isPending}
              onClick={() => setEnabled.mutate({ slug, enabled: false }, { onSuccess: () => sfx.play("toggle"), onSettled: () => setConfirmUndeploy(false) })}
            >
              Undeploy
            </NeonButton>
          </div>
        </div>
      </Modal>
    </Section>
  );
}

export function WorkflowSettingsPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { data: wf, isLoading } = useWorkflow(slug);
  const ws = useWorkspace();
  const save = useSaveWorkflow();
  const del = useDeleteWorkflow();
  const [forkOpen, setForkOpen] = useState(false);
  const [forkSlug, setForkSlug] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (isLoading || !slug) return <Spinner />;
  if (!wf?.meta) return null; // the layout already says "no such workflow"
  const meta = wf.meta;
  const base = wf.latestDoc ?? wf.liveDoc ?? null;
  const isCode = meta.source === "code";
  const draftDirty = Boolean(ws.drafts[slug]?.dirty);
  const newestId = meta.versions[meta.versions.length - 1]?.id ?? "code";

  const onExport = () => {
    if (!base) return;
    const blob = new Blob([JSON.stringify(base, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}.pattern.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    sfx.play("ok");
  };
  const doFork = async () => {
    const id = forkSlug.trim();
    if (!id || !base) return;
    const res = await save.mutateAsync({ slug: id, doc: { ...base, id, name: id, source: undefined }, note: `forked from ${slug} ${newestId}` });
    if (hasErrors(res.issues)) {
      setForkOpen(false);
      setNotice(`Fork failed validation: ${issueSummary(res.issues)}`);
      sfx.play("invalid");
      return;
    }
    setForkOpen(false);
    sfx.play("save");
    navigate(`/workflows/${encodeURIComponent(id)}/editor`);
  };

  return (
    <div className="max-w-3xl space-y-4">
      {draftDirty && (
        <div className="rounded-xl border border-[var(--color-neon-amber)]/40 bg-[var(--color-neon-amber)]/10 px-4 py-2.5 text-sm text-[var(--color-neon-amber)]">
          The editor holds unsaved changes for this workflow. Saving here creates a new version from the last <em>saved</em> document; your draft keeps its own
          values until you save it from the editor.
        </div>
      )}
      {notice && (
        <div role="alert" className="glass rounded-xl px-4 py-2.5 text-sm text-[var(--color-neon-pink)] ring-1 ring-[var(--color-neon-pink)]/40">
          {notice}
        </div>
      )}

      {base ? (
        <DocumentForm key={`${slug}:${newestId}`} slug={slug} base={base} readOnly={isCode} draftDirty={draftDirty} />
      ) : (
        <GlassPanel className="text-muted p-5 text-sm">No saved document yet — save the workflow from the editor first.</GlassPanel>
      )}

      <Deployment wf={wf} slug={slug} />

      <Section title="Copy & danger zone" hint={isCode ? "A code workflow can't be edited in place — fork it to a slug you own." : "Forking copies the newest version to a new slug. Deleting removes every version; there is no undo."}>
        <div className="flex flex-wrap items-center gap-2">
          <NeonButton variant="ghost" onClick={onExport} disabled={!base}>
            <Download size={14} /> Export JSON
          </NeonButton>
          <NeonButton
            variant={isCode ? "solid" : "ghost"}
            onClick={() => {
              setForkSlug(`${slug}-fork`);
              setForkOpen(true);
            }}
            disabled={!base}
          >
            <GitFork size={14} /> Fork{isCode ? " to edit" : ""}
          </NeonButton>
          {!isCode && (
            <NeonButton variant="danger" className="ml-auto" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} /> Delete workflow
            </NeonButton>
          )}
        </div>
      </Section>

      <Modal open={forkOpen} onClose={() => setForkOpen(false)} title={`Fork ${slug}`}>
        <div className="space-y-4">
          <p className="text-muted text-sm">Copy the newest version into a brand-new workflow you own.</p>
          <input
            value={forkSlug}
            onChange={(e) => setForkSlug(e.target.value.replace(/[^a-z0-9.\-_]/gi, ""))}
            placeholder="new-workflow-slug"
            aria-label="New workflow slug"
            className={INPUT_CLS}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doFork();
            }}
          />
          <div className="flex justify-end gap-2">
            <NeonButton variant="ghost" onClick={() => setForkOpen(false)}>
              Cancel
            </NeonButton>
            <NeonButton onClick={() => void doFork()} disabled={!forkSlug.trim() || save.isPending}>
              <GitFork size={14} /> Fork
            </NeonButton>
          </div>
        </div>
      </Modal>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete workflow">
        <div className="space-y-4">
          <p className="text-sm">
            Delete <span className="font-mono">{slug}</span>? This disables it and removes all {meta.versions.length} version{meta.versions.length === 1 ? "" : "s"} from the
            store. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <NeonButton variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </NeonButton>
            <NeonButton
              variant="danger"
              disabled={del.isPending}
              onClick={() => {
                del.mutate(slug, {
                  onSuccess: () => {
                    closeTab(slug); // the workspace tab (and its draft) go with the workflow
                    navigate("/workflows");
                  },
                  onSettled: () => setConfirmDelete(false),
                });
              }}
            >
              <Trash2 size={14} /> Delete
            </NeonButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
