import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useDeploy, useDiff, useVersions, useWorkflow } from "../lib/queries";
import { Badge, GlassPanel, JsonView, NeonButton, PageHeader, Spinner } from "../components/ui";
import { ago } from "../lib/format";
import { Rocket } from "../components/icon";

export function VersionsPage() {
  const { slug } = useParams();
  const { data: versions, isLoading } = useVersions(slug);
  const { data: wf } = useWorkflow(slug);
  const deploy = useDeploy();
  const [a, setA] = useState<string>();
  const [b, setB] = useState<string>();
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

  return (
    <>
      <PageHeader title={`Versions · ${slug}`} subtitle="Immutable snapshots. Promote/rollback is a one-click pointer move." />
      <div className="grid grid-cols-[20rem_1fr] gap-6">
        <GlassPanel className="overflow-hidden">
          {(versions ?? []).map((v) => (
            <div key={v.id} className="flex items-center gap-2 border-b hairline px-4 py-3 last:border-0">
              <button type="button" aria-label={`Set ${v.id} as diff side A`} onClick={() => setA(v.id)} className={`rounded px-1.5 text-xs ${a === v.id ? "bg-[var(--color-neon-cyan)] text-black" : "text-muted"}`}>A</button>
              <button type="button" aria-label={`Set ${v.id} as diff side B`} onClick={() => setB(v.id)} className={`rounded px-1.5 text-xs ${b === v.id ? "bg-[var(--color-neon-violet)] text-black" : "text-muted"}`}>B</button>
              <div className="flex flex-col">
                <span className="font-mono text-sm">
                  {v.id} {v.id === live && <Badge hue={150}>live</Badge>}
                </span>
                <span className="text-muted text-xs">{v.note || "—"} · {v.createdAt ? ago(Date.parse(v.createdAt)) : ""}</span>
              </div>
              {v.id !== live && slug && (
                <NeonButton
                  variant="ghost"
                  className="ml-auto !px-2 !py-1"
                  aria-label={`Deploy ${v.id}`}
                  title={`Deploy ${v.id}`}
                  onClick={() => deploy.mutate({ slug, version: v.id })}
                >
                  <Rocket size={12} />
                </NeonButton>
              )}
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
