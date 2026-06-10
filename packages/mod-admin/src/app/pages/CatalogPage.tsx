import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Template, WorkflowMeta } from "@pattern/admin-sdk";
import { useDeleteWorkflow, useMods, useSetEnabled, useTemplates, useWorkflows } from "../lib/queries";
import { Badge, Dot, EmptyState, Modal, NeonButton, PageHeader, Spinner, Table, type Column } from "../components/ui";
import { Icon, Plus, Search, Trash2 } from "../components/icon";
import { fuzzyFilter } from "../lib/fuzzy";
import { sfx } from "../lib/sfx";

const SOURCE_HUE: Record<string, number> = { code: 200, file: 150, db: 280 };

/** Workflows authored in the admin (file/db) rather than contributed by a mod. */
const LOCAL = "(local)";

/** Pick a starting point for a new workflow: blank canvas or a built-in template. */
function TemplatePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: templates } = useTemplates();
  const start = (template?: Template) => {
    onClose();
    navigate("/editor", template ? { state: { template: template.doc } } : undefined);
  };
  return (
    <Modal open={open} onClose={onClose} title="New workflow">
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => start()}
          className="glass flex w-full flex-col items-start gap-0.5 rounded-xl px-4 py-3 text-left hover:bg-white/5"
        >
          <span className="text-sm font-medium">Blank canvas</span>
          <span className="text-muted text-xs">Start from an empty graph.</span>
        </button>
        {(templates ?? []).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => start(t)}
            className="glass flex w-full flex-col items-start gap-0.5 rounded-xl px-4 py-3 text-left hover:bg-white/5"
          >
            <span className="text-sm font-medium">{t.name}</span>
            <span className="text-muted text-xs">{t.description}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function CatalogPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useWorkflows();
  const { data: mods } = useMods();
  const setEnabled = useSetEnabled();
  const del = useDeleteWorkflow();
  const [confirmDelete, setConfirmDelete] = useState<WorkflowMeta | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [modFilter, setModFilter] = useState("");

  // Which mod contributed each workflow (admin-authored ones are "(local)").
  const modOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const mod of mods ?? []) for (const wf of mod.workflows) m.set(wf, mod.name);
    return m;
  }, [mods]);
  const modNames = useMemo(() => {
    const names = new Set<string>();
    for (const w of data ?? []) names.add(modOf.get(w.slug) ?? LOCAL);
    return [...names].sort();
  }, [data, modOf]);

  const filtered = useMemo(() => {
    let list = data ?? [];
    if (modFilter) list = list.filter((w) => (modOf.get(w.slug) ?? LOCAL) === modFilter);
    return fuzzyFilter(list, query, (w) => `${w.slug} ${w.name} ${w.description ?? ""} ${(w.tags ?? []).join(" ")} ${w.route?.path ?? ""}`);
  }, [data, query, modFilter, modOf]);

  if (isLoading) return <Spinner />;
  if (isError) {
    return (
      <>
        <PageHeader title="Workflows" subtitle="Author, deploy, and inspect workflows." />
        <EmptyState
          title="Couldn't load the catalog"
          hint={error instanceof Error ? error.message : "The admin API did not respond."}
          action={<NeonButton onClick={() => void refetch()}>Retry</NeonButton>}
        />
      </>
    );
  }
  const rows = filtered;

  const newButton = (
    <NeonButton onClick={() => setPickerOpen(true)}>
      <Plus size={14} /> New workflow
    </NeonButton>
  );

  if ((data ?? []).length === 0) {
    return (
      <>
        <PageHeader title="Workflows" subtitle="Author, deploy, and inspect workflows." />
        <EmptyState
          icon={<Icon name="workflow" size={32} />}
          title="No workflows yet"
          hint="Create your first workflow from a template, or import one."
          action={newButton}
        />
        <TemplatePicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
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
      key: "mod",
      label: "Mod",
      width: "11rem",
      render: (w) => {
        const m = modOf.get(w.slug);
        return m ? <span className="text-muted truncate font-mono text-xs">{m}</span> : <span className="text-muted">—</span>;
      },
    },
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
          type="button"
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
    {
      key: "actions",
      label: "",
      width: "3rem",
      render: (w) =>
        w.source === "code" ? null : (
          <button
            type="button"
            aria-label={`Delete workflow ${w.slug}`}
            title="Delete workflow"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(w);
            }}
            className="text-muted rounded p-1 hover:text-[var(--color-neon-pink)]"
          >
            <Trash2 size={14} />
          </button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Workflows"
        subtitle={`${rows.length}${rows.length !== (data ?? []).length ? ` of ${(data ?? []).length}` : ""} workflows — the catalog is rendered entirely from the self-reflecting API.`}
        actions={newButton}
      />

      {/* Filter bar: fuzzy search + by mod */}
      <div className="mb-4 flex gap-2">
        <div className="glass flex max-w-md flex-1 items-center gap-2 rounded-xl px-3 py-2">
          <Search size={14} className="text-muted shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Fuzzy search workflows…"
            aria-label="Search workflows"
            className="w-full bg-transparent text-sm outline-none"
          />
          {query && (
            <button type="button" aria-label="Clear search" className="text-muted text-xs" onClick={() => setQuery("")}>
              ✕
            </button>
          )}
        </div>
        <select
          value={modFilter}
          onChange={(e) => setModFilter(e.target.value)}
          aria-label="Filter by mod"
          className="glass rounded-xl px-3 py-2 text-sm outline-none [&>option]:bg-[var(--bg)]"
        >
          <option value="">All mods</option>
          {modNames.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No workflows match" hint="Loosen the search or pick another mod." />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          getKey={(w) => w.slug}
          onRow={(w) => {
            sfx.play("nav");
            navigate(`/editor/${w.slug}`);
          }}
        />
      )}

      <TemplatePicker open={pickerOpen} onClose={() => setPickerOpen(false)} />

      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete workflow">
        {confirmDelete && (
          <div className="space-y-4">
            <p className="text-sm">
              Delete <span className="font-mono">{confirmDelete.slug}</span>? This disables it and removes all{" "}
              {confirmDelete.versions.length} version{confirmDelete.versions.length === 1 ? "" : "s"} from the store. This
              cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <NeonButton variant="ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </NeonButton>
              <NeonButton
                variant="danger"
                disabled={del.isPending}
                onClick={() => {
                  del.mutate(confirmDelete.slug, { onSettled: () => setConfirmDelete(null) });
                }}
              >
                <Trash2 size={14} /> Delete
              </NeonButton>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
