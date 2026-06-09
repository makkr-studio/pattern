import { useMods } from "../lib/queries";
import { Badge, GlassPanel, PageHeader, Spinner } from "../components/ui";

export function ModsPage() {
  const { data, isLoading } = useMods();
  if (isLoading) return <Spinner />;

  return (
    <>
      <PageHeader title="Mods" subtitle="Installed mods and what each contributes." />
      <div className="grid gap-4 md:grid-cols-2">
        {(data ?? []).map((mod) => (
          <GlassPanel key={mod.name} className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-sm font-semibold">{mod.name}</h2>
              {mod.frontend && <Badge hue={280}>frontend</Badge>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge hue={200}>{mod.ops.length} ops</Badge>
              <Badge hue={150}>{mod.workflows.length} workflows</Badge>
              {mod.frontend && (
                <>
                  <Badge hue={300}>{mod.frontend.menu} menu</Badge>
                  <Badge hue={320}>{mod.frontend.pages} pages</Badge>
                  <Badge hue={340}>{mod.frontend.commands} commands</Badge>
                </>
              )}
            </div>
            {mod.ops.length > 0 && (
              <div className="text-muted mt-3 font-mono text-xs leading-relaxed">{mod.ops.slice(0, 8).join(", ")}{mod.ops.length > 8 ? "…" : ""}</div>
            )}
          </GlassPanel>
        ))}
      </div>
    </>
  );
}
