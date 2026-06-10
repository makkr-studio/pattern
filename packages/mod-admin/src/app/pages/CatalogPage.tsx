import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Template, WorkflowMeta } from "@pattern/admin-sdk";
import { useDeleteWorkflow, useMods, useSetEnabled, useTemplates, useWorkflows } from "../lib/queries";
import { Badge, Dot, EmptyState, Modal, NeonButton, PageHeader, Spinner, Table, type Column } from "../components/ui";
import { History, Icon, Plus, Search, Trash2 } from "../components/icon";
import { fuzzyFilter } from "../lib/fuzzy";
import { sfx } from "../lib/sfx";

const SOURCE_HUE: Record<string, number> = { code: 200, file: 150, db: 280 };

/** Workflows authored in the admin (file/db) rather than contributed by a mod. */
const LOCAL = "(local)";

/** Persisted mod filter: the EXCLUDED mods (new mods default to visible).
 *  First visit: the admin's own plumbing is hidden — your workflows first. */
const EXCLUDED_MODS_KEY = "pattern.admin.catalog.excludedMods";
const DEFAULT_EXCLUDED = ["@pattern/mod-admin"];

function readExcludedMods(): Set<string> {
  try {
    const raw = localStorage.getItem(EXCLUDED_MODS_KEY);
    if (raw == null) return new Set(DEFAULT_EXCLUDED);
    const list = JSON.parse(raw) as string[];
    return new Set(Array.isArray(list) ? list : DEFAULT_EXCLUDED);
  } catch {
    return new Set(DEFAULT_EXCLUDED);
  }
}
function writeExcludedMods(s: Set<string>): void {
  try {
    localStorage.setItem(EXCLUDED_MODS_KEY, JSON.stringify([...s]));
  } catch {
    /* best-effort */
  }
}

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
  const [confirmUndeploy, setConfirmUndeploy] = useState<WorkflowMeta | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [modsOpen, setModsOpen] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(readExcludedMods);

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
    const list = (data ?? []).filter((w) => !excluded.has(modOf.get(w.slug) ?? LOCAL));
    return fuzzyFilter(list, query, (w) => `${w.slug} ${w.name} ${w.description ?? ""} ${(w.tags ?? []).join(" ")} ${w.route?.path ?? ""}`);
  }, [data, query, excluded, modOf]);

  const toggleMod = (name: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      writeExcludedMods(next);
      return next;
    });
    sfx.play("toggle");
  };

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
            // Undeploying a code workflow can break running features — confirm.
            if (w.source === "code" && w.enabled) setConfirmUndeploy(w);
            else setEnabled.mutate({ slug: w.slug, enabled: !w.enabled }, { onSuccess: () => sfx.play(w.enabled ? "toggle" : "deploy") });
          }}
          className="flex items-center gap-2 text-sm"
          title={w.enabled ? "Undeploy — unregister its routes/schedules" : "Deploy it again"}
        >
          <Dot color={w.enabled ? "var(--color-neon-lime)" : "var(--color-port-control)"} pulse={w.enabled} />
          {w.enabled ? "deployed" : "undeployed"}
        </button>
      ),
    },
    {
      key: "actions",
      label: "",
      width: "5rem",
      render: (w) => (
        <div className="flex items-center justify-end gap-0.5">
          {w.source !== "code" && (
            <button
              type="button"
              aria-label={`Versions of ${w.slug}`}
              title={`Versions & history (${w.versions.length})`}
              onClick={(e) => {
                e.stopPropagation();
                sfx.play("nav");
                navigate(`/versions/${w.slug}`);
              }}
              className="text-muted rounded p-1 hover:text-[var(--color-neon-cyan)]"
            >
              <History size={14} />
            </button>
          )}
          {w.source !== "code" && (
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
          )}
        </div>
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
        <button
          type="button"
          onClick={() => setModsOpen(true)}
          aria-label="Filter by mods"
          className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-white/5"
        >
          Mods
          <Badge hue={excluded.size ? 45 : 150}>
            {modNames.filter((m) => !excluded.has(m)).length}/{modNames.length}
          </Badge>
        </button>
      </div>

      {/* Mod visibility: tick = shown. The admin's plumbing hides by default. */}
      <Modal open={modsOpen} onClose={() => setModsOpen(false)} title="Show workflows from…">
        <div className="space-y-1">
          {modNames.map((m) => {
            const shown = !excluded.has(m);
            const count = (data ?? []).filter((w) => (modOf.get(w.slug) ?? LOCAL) === m).length;
            return (
              <label key={m} className="glass flex cursor-pointer items-center gap-3 rounded-xl px-4 py-2.5 hover:bg-white/5">
                <input type="checkbox" checked={shown} onChange={() => toggleMod(m)} className="accent-[var(--color-neon-cyan)]" />
                <span className={`font-mono text-sm ${shown ? "" : "text-muted"}`}>{m}</span>
                <span className="text-muted ml-auto text-xs">{count} workflow{count === 1 ? "" : "s"}</span>
              </label>
            );
          })}
          <p className="text-muted pt-2 text-[11px]">
            Unticked mods are hidden from this list. The admin's own workflows start hidden so yours come first.
          </p>
        </div>
      </Modal>

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

      {/* Undeploying a CODE workflow is the one spicy toggle: it can take down
          features the mod relies on (admin API routes included). */}
      <Modal open={confirmUndeploy !== null} onClose={() => setConfirmUndeploy(null)} title="Undeploy code workflow">
        {confirmUndeploy && (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="font-mono">{confirmUndeploy.slug}</span> is shipped by a mod. Undeploying unregisters it
              immediately{confirmUndeploy.route ? <> — <span className="font-mono">{confirmUndeploy.route.method} {confirmUndeploy.route.path}</span> stops serving</> : null}.
            </p>
            <p className="text-sm text-[var(--color-neon-amber)]">
              ⚠ Anything depending on it may break (admin pages and APIs included). You can re-deploy it here any time;
              a server restart also brings it back.
            </p>
            <div className="flex justify-end gap-2">
              <NeonButton variant="ghost" onClick={() => setConfirmUndeploy(null)}>
                Cancel
              </NeonButton>
              <NeonButton
                variant="danger"
                disabled={setEnabled.isPending}
                onClick={() => {
                  setEnabled.mutate(
                    { slug: confirmUndeploy.slug, enabled: false },
                    { onSuccess: () => sfx.play("toggle"), onSettled: () => setConfirmUndeploy(null) },
                  );
                }}
              >
                Undeploy
              </NeonButton>
            </div>
          </div>
        )}
      </Modal>

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
