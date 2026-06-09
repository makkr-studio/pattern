import { useNavigate } from "react-router-dom";
import type { WorkflowMeta } from "@pattern/admin-sdk";
import { useSetEnabled, useWorkflows } from "../lib/queries";
import { Badge, Dot, EmptyState, NeonButton, PageHeader, Spinner, Table, type Column } from "../components/ui";
import { Icon, Plus } from "../components/icon";

const SOURCE_HUE: Record<string, number> = { code: 200, file: 150, db: 280 };

export function CatalogPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useWorkflows();
  const setEnabled = useSetEnabled();

  if (isLoading) return <Spinner />;
  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title="Workflows" subtitle="Author, deploy, and inspect workflows." />
        <EmptyState
          icon={<Icon name="workflow" size={32} />}
          title="No workflows yet"
          hint="Create your first workflow from a template, or import one."
          action={
            <NeonButton onClick={() => navigate("/editor")}>
              <Plus size={14} /> New workflow
            </NeonButton>
          }
        />
      </>
    );
  }

  const columns: Column<WorkflowMeta>[] = [
    {
      key: "name",
      label: "Workflow",
      render: (w) => (
        <div className="flex flex-col">
          <span className="font-medium">{w.name}</span>
          <span className="text-muted font-mono text-xs">{w.slug}</span>
        </div>
      ),
    },
    { key: "source", label: "Source", width: "8rem", render: (w) => <Badge hue={SOURCE_HUE[w.source]}>{w.source}</Badge> },
    {
      key: "route",
      label: "Route",
      render: (w) => (w.route ? <span className="font-mono text-xs">{w.route.method} {w.route.path}</span> : <span className="text-muted">—</span>),
    },
    { key: "live", label: "Live", width: "6rem", render: (w) => <span className="text-muted font-mono text-xs">{w.live ?? "—"}</span> },
    {
      key: "enabled",
      label: "Status",
      width: "8rem",
      render: (w) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (w.source !== "code") setEnabled.mutate({ slug: w.slug, enabled: !w.enabled });
          }}
          className="flex items-center gap-2 text-sm"
          disabled={w.source === "code"}
          title={w.source === "code" ? "Code workflows are always live" : "Toggle"}
        >
          <Dot color={w.enabled ? "var(--color-neon-lime)" : "var(--color-port-control)"} pulse={w.enabled} />
          {w.enabled ? "enabled" : "disabled"}
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Workflows"
        subtitle={`${rows.length} workflows — the catalog is rendered entirely from the self-reflecting API.`}
        actions={
          <NeonButton onClick={() => navigate("/editor")}>
            <Plus size={14} /> New workflow
          </NeonButton>
        }
      />
      <Table columns={columns} rows={rows} getKey={(w) => w.slug} onRow={(w) => navigate(`/editor/${w.slug}`)} />
    </>
  );
}
