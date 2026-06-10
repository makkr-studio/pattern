import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useDeploy, useDiff, useSaveWorkflow, useVersions, useWorkflow } from "../lib/queries";
import { Badge, GlassPanel, JsonView, Modal, NeonButton, PageHeader, Spinner } from "../components/ui";
import { ago } from "../lib/format";
import { GitFork, Pencil } from "lucide-react";
import { Rocket } from "../components/icon";
import { sfx } from "../lib/sfx";

export function VersionsPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { data: versions, isLoading } = useVersions(slug);
  const { data: wf } = useWorkflow(slug);
  const deploy = useDeploy();
  const saveWf = useSaveWorkflow();
  const [a, setA] = useState<string>();
  const [b, setB] = useState<string>();
  const [forkFrom, setForkFrom] = useState<string | null>(null);
  const [forkSlug, setForkSlug] = useState("");
  const { data: diff } = useDiff(slug, a, b);

  // Default the diff to previous-vs-live.
  useEffect(() => {
    if (versions && versions.length >= 1 && !b) {
      const live = wf?.meta?.live ?? versions[versions.length - 1]!.id;
      const liveIdx = versions.findIndex((v) => v.id === live);
      setB(live);
      setA(versions[Math.max(0, liveIdx - 1)]!.id);
    }
  }, [versions, wf, b]);

  if (isLoading) return <Spinner />;
  const live = wf?.meta?.live;
  const newest = versions?.[versions.length - 1]?.id;

  /** Load a version's doc into the editor as a dirty draft for this slug. */
  const editFrom = async (versionId: string) => {
    if (!slug) return;
    const doc = await api.versions.get(slug, versionId);
    sfx.play("nav");
    navigate(`/editor/${slug}`, { state: { loadDoc: doc, note: versionId } });
  };

  /** Fork one version to a brand-new slug. */
  const doFork = async () => {
    if (!slug || !forkFrom || !forkSlug.trim()) return;
    const doc = await api.versions.get(slug, forkFrom);
    const id = forkSlug.trim();
    const res = await saveWf.mutateAsync({ slug: id, doc: { ...doc, id, name: id, source: undefined }, note: `forked from ${slug} ${forkFrom}` });
    if (res.issues.length) {
      sfx.play("invalid");
      return;
    }
    setForkFrom(null);
    sfx.play("save");
    navigate(`/editor/${id}`);
  };

  return (
    <>
      <PageHeader
        title={`Versions · ${slug}`}
        subtitle="Immutable snapshots. Restore is a one-click pointer move; fork copies any version to a new slug."
        actions={
          <NeonButton variant="ghost" onClick={() => navigate(`/editor/${slug}`)}>
            <Pencil size={14} /> Open in editor
          </NeonButton>
        }
      />
      <div className="grid grid-cols-[24rem_1fr] gap-6">
        <GlassPanel className="self-start overflow-hidden">
          {[...(versions ?? [])].reverse().map((v) => (
            <div key={v.id} className="flex items-center gap-2 border-b hairline px-4 py-3 last:border-0">
              <button type="button" aria-label={`Set ${v.id} as diff side A`} onClick={() => setA(v.id)} className={`rounded px-1.5 text-xs ${a === v.id ? "bg-[var(--color-neon-cyan)] text-black" : "text-muted"}`}>A</button>
              <button type="button" aria-label={`Set ${v.id} as diff side B`} onClick={() => setB(v.id)} className={`rounded px-1.5 text-xs ${b === v.id ? "bg-[var(--color-neon-violet)] text-black" : "text-muted"}`}>B</button>
              <div className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5 font-mono text-sm">
                  {v.id}
                  {v.id === live && <Badge hue={150}>live</Badge>}
                  {v.id === newest && v.id !== live && <Badge hue={200}>newest</Badge>}
                </span>
                <span className="text-muted truncate text-xs">{v.note || "—"} · {v.createdAt ? ago(Date.parse(v.createdAt)) : ""}</span>
              </div>
              <div className="ml-auto flex items-center gap-1">
                <NeonButton
                  variant="ghost"
                  className="!px-2 !py-1"
                  aria-label={`Edit from ${v.id}`}
                  title={`Open ${v.id} in the editor (saving makes it the newest version)`}
                  onClick={() => void editFrom(v.id)}
                >
                  <Pencil size={12} />
                </NeonButton>
                <NeonButton
                  variant="ghost"
                  className="!px-2 !py-1"
                  aria-label={`Fork ${v.id}`}
                  title={`Fork ${v.id} to a new workflow`}
                  onClick={() => {
                    setForkSlug(`${slug}-fork`);
                    setForkFrom(v.id);
                  }}
                >
                  <GitFork size={12} />
                </NeonButton>
                {v.id !== live && slug && (
                  <NeonButton
                    variant="ghost"
                    className="!px-2 !py-1"
                    aria-label={`Restore ${v.id}`}
                    title={`Restore: deploy ${v.id} (move the live pointer)`}
                    onClick={() => deploy.mutate({ slug, version: v.id }, { onSuccess: () => sfx.play("deploy") })}
                  >
                    <Rocket size={12} />
                  </NeonButton>
                )}
              </div>
            </div>
          ))}
        </GlassPanel>

        <div className="space-y-4">
          {diff ? (
            <>
              <GlassPanel className="p-5">
                <div className="mb-3 flex items-center gap-2 text-sm">
                  <Badge hue={190}>A {a}</Badge>→<Badge hue={270}>B {b}</Badge>
                  {diff.equal && <span className="text-muted">identical</span>}
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <DiffStat label="Nodes +" n={diff.nodes.added.length} hue={150} />
                  <DiffStat label="Nodes −" n={diff.nodes.removed.length} hue={340} />
                  <DiffStat label="Nodes ~" n={diff.nodes.changed.length} hue={40} />
                  <DiffStat label="Edges +" n={diff.edges.added.length} hue={150} />
                  <DiffStat label="Edges −" n={diff.edges.removed.length} hue={340} />
                  <DiffStat label="Meta ~" n={diff.meta.length} hue={200} />
                </div>
                {diff.nodes.changed.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {diff.nodes.changed.map((c) => (
                      <div key={c.id} className="text-xs">
                        <span className="font-mono text-[var(--color-neon-amber)]">{c.id}</span>
                        <div className="mt-1 grid grid-cols-2 gap-2">
                          <JsonView value={c.before} className="max-h-40" />
                          <JsonView value={c.after} className="max-h-40" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </GlassPanel>
            </>
          ) : (
            <GlassPanel className="text-muted p-8 text-sm">Pick two versions (A / B) to diff.</GlassPanel>
          )}
        </div>
      </div>

      {/* Fork dialog */}
      <Modal open={forkFrom !== null} onClose={() => setForkFrom(null)} title={`Fork ${slug} ${forkFrom ?? ""}`}>
        <div className="space-y-4">
          <p className="text-muted text-sm">Copy this version into a brand-new workflow you own.</p>
          <input
            value={forkSlug}
            onChange={(e) => setForkSlug(e.target.value.replace(/[^a-z0-9.\-_]/gi, ""))}
            placeholder="new-workflow-slug"
            aria-label="New workflow slug"
            className="glass w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
            onKeyDown={(e) => {
              if (e.key === "Enter") void doFork();
            }}
          />
          <div className="flex justify-end gap-2">
            <NeonButton variant="ghost" onClick={() => setForkFrom(null)}>
              Cancel
            </NeonButton>
            <NeonButton onClick={() => void doFork()} disabled={!forkSlug.trim() || saveWf.isPending}>
              <GitFork size={14} /> Fork
            </NeonButton>
          </div>
        </div>
      </Modal>
    </>
  );
}

function DiffStat({ label, n, hue }: { label: string; n: number; hue: number }) {
  return (
    <div className="glass rounded-xl px-3 py-2">
      <div className="text-muted text-xs">{label}</div>
      <div className="text-lg font-semibold" style={{ color: n ? `hsl(${hue} 80% 70%)` : undefined }}>
        {n}
      </div>
    </div>
  );
}
