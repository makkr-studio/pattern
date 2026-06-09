import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
} from "@xyflow/react";
import type { OpInfo, ValidationIssue, WorkflowDoc } from "@pattern/admin-sdk";
import { api } from "../lib/api";
import { useDeploy, useOps, useSaveWorkflow, useWorkflow } from "../lib/queries";
import { OpNode } from "../editor/OpNode";
import { RunPanel } from "../editor/RunPanel";
import { buildFlow, edgeStyle, outputKind, toDoc, type OpMap, type OpNodeData } from "../editor/graph";
import { Badge, GlassPanel, NeonButton, Spinner } from "../components/ui";
import { FormFromSchema, RawJson } from "../components/FormFromSchema";
import { Markdown } from "../components/Markdown";
import { tip } from "../components/Tooltip";
import { Rocket, Play, Redo2, Undo2 } from "../components/icon";
import { categoryOfType, categoryStyle, humanizeOp, paletteLabel } from "../lib/categories";

const nodeTypes = { op: OpNode };

function EditorInner() {
  const { slug } = useParams();
  const isNew = !slug;
  const navigate = useNavigate();
  const location = useLocation();
  /** A starting doc handed over by the template picker (new workflows only). */
  const template = (location.state as { template?: WorkflowDoc } | null)?.template;
  const rf = useReactFlow<RFNode<OpNodeData>, RFEdge>();
  const { data: opsData } = useOps();
  const { data: wfData, isLoading } = useWorkflow(slug);
  const save = useSaveWorkflow();
  const deploy = useDeploy();

  const opMap: OpMap = useMemo(() => new Map((opsData ?? []).map((o) => [o.type, o])), [opsData]);

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode<OpNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [newSlug, setNewSlug] = useState("");
  const [runOpen, setRunOpen] = useState(false);
  const baseDoc = useRef<WorkflowDoc>({ id: slug ?? "untitled", nodes: [], edges: [] });
  const loadedFor = useRef<string | null>(null);

  // ── Undo/redo (spec §15.12): a snapshot stack over the canvas. Snapshots are
  // taken *before* each structural mutation (add/connect/delete/drag/config
  // burst), so ⌘Z returns to the state the user last saw.
  type Snap = { nodes: RFNode<OpNodeData>[]; edges: RFEdge[] };
  const history = useRef<{ past: Snap[]; future: Snap[] }>({ past: [], future: [] });
  const [histVersion, setHistVersion] = useState(0); // re-render for disabled states
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const takeSnap = useCallback((): Snap => ({ nodes: rf.getNodes(), edges: rf.getEdges() }), [rf]);
  const pushHistory = useCallback(() => {
    history.current.past.push(takeSnap());
    if (history.current.past.length > 100) history.current.past.shift();
    history.current.future = [];
    setHistVersion((v) => v + 1);
  }, [takeSnap]);
  /** Leading-edge capture for typing bursts: snapshot before the first change,
   *  then swallow captures until the burst goes quiet. */
  const pushHistoryBurst = useCallback(() => {
    if (burstTimer.current === null) pushHistory();
    else clearTimeout(burstTimer.current);
    burstTimer.current = setTimeout(() => (burstTimer.current = null), 800);
  }, [pushHistory]);

  const undo = useCallback(() => {
    const prev = history.current.past.pop();
    if (!prev) return;
    history.current.future.push(takeSnap());
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setHistVersion((v) => v + 1);
  }, [takeSnap, setNodes, setEdges]);
  const redo = useCallback(() => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(takeSnap());
    setNodes(next.nodes);
    setEdges(next.edges);
    setHistVersion((v) => v + 1);
  }, [takeSnap, setNodes, setEdges]);

  // ⌘Z / ⌘⇧Z — skipped while a text field has focus (native undo wins there).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Initialize the canvas from the live doc (once per slug, after ops load).
  // Wait for the workflow query too, so we don't lock in an empty doc when
  // `useOps` happens to resolve before `useWorkflow`.
  useEffect(() => {
    if (!opMap.size) return;
    if (!isNew && !wfData) return;
    const key = slug ?? "__new__";
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    const doc: WorkflowDoc =
      wfData?.liveDoc ?? (isNew && template ? template : { id: slug ?? "untitled", name: slug, nodes: [], edges: [] });
    baseDoc.current = doc;
    history.current = { past: [], future: [] };
    const flow = buildFlow(doc, opMap);
    setNodes(flow.nodes);
    setEdges(flow.edges);
  }, [opMap, slug, wfData, isNew, template, setNodes, setEdges]);

  const onConnect = useCallback(
    (c: Connection) => {
      // Read live canvas state from the RF store — the closed-over `nodes`/
      // `edges` snapshot can lag pointer-driven events (rapid connects).
      const curNodes = rf.getNodes();
      const curEdges = rf.getEdges();
      pushHistory();
      const kind = outputKind(c.source!, c.sourceHandle ?? "out", toDoc(baseDoc.current, curNodes, curEdges), opMap);
      setEdges((eds) => addEdge({ ...c, type: "smoothstep", animated: kind === "stream", style: edgeStyle(kind) }, eds));
      // Connection assist (T2): verify and flag if incompatible.
      const fromNode = curNodes.find((n) => n.id === c.source);
      const toNode = curNodes.find((n) => n.id === c.target);
      if (fromNode && toNode) {
        void api
          .portsCompatible(
            { op: fromNode.data.op, port: c.sourceHandle ?? "out", dir: "out" },
            { op: toNode.data.op, port: c.targetHandle ?? "in", dir: "in" },
          )
          .then((res) => {
            if (!res.ok) setNotice(`⚠ ${c.sourceHandle} → ${c.targetHandle}: ${res.reason}${res.fix ? ` (insert core.stream.${res.fix})` : ""}`);
          });
      }
    },
    [rf, opMap, setEdges, pushHistory],
  );

  // Capture deletions (canvas ⌫) — other change kinds flow through untouched.
  const onNodesChangeTracked: typeof onNodesChange = useCallback(
    (changes) => {
      if (changes.some((ch) => ch.type === "remove")) pushHistory();
      onNodesChange(changes);
    },
    [onNodesChange, pushHistory],
  );
  const onEdgesChangeTracked: typeof onEdgesChange = useCallback(
    (changes) => {
      if (changes.some((ch) => ch.type === "remove")) pushHistory();
      onEdgesChange(changes);
    },
    [onEdgesChange, pushHistory],
  );

  const addNode = (op: OpInfo) => {
    pushHistory();
    const base = op.type.split(".").slice(-1)[0]!;
    let id = base;
    let i = 1;
    const ids = new Set(nodes.map((n) => n.id));
    while (ids.has(id)) id = `${base}${++i}`;
    const node: RFNode<OpNodeData> = {
      id,
      type: "op",
      position: { x: 120 + nodes.length * 20, y: 120 + nodes.length * 20 },
      data: { op: op.type, config: {}, description: op.description, inputs: op.inputs, outputs: op.outputs, boundary: op.boundary },
    };
    setNodes((ns) => [...ns, node]);
    setSelected(id);
  };

  const currentDoc = (): WorkflowDoc => {
    const targetSlug = slug ?? (newSlug || "untitled");
    return { ...toDoc(baseDoc.current, nodes, edges), id: targetSlug, name: baseDoc.current.name ?? targetSlug };
  };

  /** After a successful save the canvas doc IS the base — keep the ref in sync
   *  so later `currentDoc()` calls carry the saved identity/metadata, and move
   *  a brand-new workflow onto its real URL. */
  const adoptSaved = (doc: WorkflowDoc) => {
    baseDoc.current = doc;
    if (isNew) {
      loadedFor.current = doc.id; // canvas already shows this doc — don't reload
      navigate(`/editor/${doc.id}`, { replace: true });
    }
  };

  const onSave = async () => {
    const doc = currentDoc();
    if (isNew && !newSlug) {
      setNotice("Enter a slug to save the new workflow.");
      return;
    }
    const res = await save.mutateAsync({ slug: doc.id, doc, note: "edited in admin" });
    setIssues(res.issues);
    if (!res.issues.length) adoptSaved(doc);
    setNotice(res.issues.length ? `${res.issues.length} validation issue(s)` : `Saved ${res.version?.id}. Deploy to activate.`);
  };

  const onDeploy = async () => {
    const doc = currentDoc();
    if (isNew && !newSlug) {
      setNotice("Enter a slug to save the new workflow.");
      return;
    }
    const saved = await save.mutateAsync({ slug: doc.id, doc, note: "deploy" });
    if (saved.issues.length) {
      setIssues(saved.issues);
      setNotice(`${saved.issues.length} validation issue(s) — fix before deploying.`);
      return;
    }
    adoptSaved(doc);
    const res = await deploy.mutateAsync({ slug: doc.id, version: saved.version!.id, swap: false });
    setNotice(res.ok ? `Deployed ${doc.id} ${saved.version!.id} 🚀` : `Route conflict with: ${res.conflicts.map((c) => c.conflictsWith).join(", ")}`);
  };

  const selectedNode = nodes.find((n) => n.id === selected);

  if (isLoading && !isNew) return <Spinner />;

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="text-xl font-semibold">{isNew ? "New workflow" : slug}</h1>
        {wfData?.meta && <Badge hue={wfData.meta.source === "code" ? 200 : 150}>{wfData.meta.source}</Badge>}
        {isNew && (
          <input
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value.replace(/[^a-z0-9.\-_]/gi, ""))}
            placeholder="workflow-slug"
            className="glass rounded-lg px-3 py-1.5 text-sm outline-none"
          />
        )}
        <div className="ml-auto flex items-center gap-2">
          {notice && <span className="text-muted max-w-md truncate text-xs">{notice}</span>}
          <NeonButton
            variant="ghost"
            className="!px-2"
            aria-label="Undo (⌘Z)"
            title="Undo (⌘Z)"
            onClick={undo}
            disabled={history.current.past.length === 0}
            data-hist={histVersion}
          >
            <Undo2 size={14} />
          </NeonButton>
          <NeonButton
            variant="ghost"
            className="!px-2"
            aria-label="Redo (⌘⇧Z)"
            title="Redo (⌘⇧Z)"
            onClick={redo}
            disabled={history.current.future.length === 0}
          >
            <Redo2 size={14} />
          </NeonButton>
          <NeonButton variant="ghost" onClick={() => setRunOpen(true)} disabled={nodes.length === 0}>
            <Play size={14} /> Run
          </NeonButton>
          <NeonButton variant="ghost" onClick={onSave} disabled={save.isPending || wfData?.meta?.source === "code"}>
            Save
          </NeonButton>
          <NeonButton onClick={onDeploy} disabled={deploy.isPending || wfData?.meta?.source === "code"}>
            <Rocket size={14} /> Deploy
          </NeonButton>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[14rem_1fr_18rem] gap-3">
        {/* Palette — grouped by category, color + icon coded */}
        <Palette ops={opsData ?? []} onAdd={addNode} />

        {/* Canvas */}
        <GlassPanel className="overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeTracked}
            onEdgesChange={onEdgesChangeTracked}
            onConnect={onConnect}
            onNodeDragStart={() => pushHistory()}
            onNodeClick={(_e, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} color="rgba(255,255,255,0.06)" />
            <Controls />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => {
                const d = n.data as OpNodeData;
                return d?.boundary ? "#22d3ee" : categoryStyle(categoryOfType(d.op)).color;
              }}
              nodeStrokeWidth={0}
            />
          </ReactFlow>
        </GlassPanel>

        {/* Inspector */}
        <GlassPanel className="overflow-y-auto p-4">
          <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">Inspector</div>
          {selectedNode ? (
            <Inspector
              key={selectedNode.id}
              node={selectedNode}
              op={opMap.get(selectedNode.data.op)}
              onChange={(config) => {
                pushHistoryBurst();
                setNodes((ns) => ns.map((n) => (n.id === selectedNode.id ? { ...n, data: { ...n.data, config } } : n)));
              }}
              onMeta={(meta) => {
                pushHistoryBurst();
                setNodes((ns) => ns.map((n) => (n.id === selectedNode.id ? { ...n, data: { ...n.data, ...meta } } : n)));
              }}
            />
          ) : (
            <p className="text-muted text-sm">Select a node to edit its config. Drag from a palette op to add a node; drag between handles to connect.</p>
          )}
          {issues.length > 0 && (
            <div className="mt-5">
              <div className="text-[var(--color-neon-pink)] mb-2 text-xs font-semibold uppercase tracking-wider">Problems</div>
              {issues.map((iss, i) => (
                <div key={i} className="mb-1.5 text-xs">
                  <span className="font-mono text-[var(--color-neon-amber)]">{iss.nodeId ?? ""}</span> {iss.message}
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </div>

      {runOpen && <RunPanel open={runOpen} onClose={() => setRunOpen(false)} doc={currentDoc()} opMap={opMap} />}
    </div>
  );
}

function Inspector({
  node,
  op,
  onChange,
  onMeta,
}: {
  node: RFNode<OpNodeData>;
  op?: OpInfo;
  onChange: (config: Record<string, unknown>) => void;
  onMeta: (meta: { title?: string; comment?: string }) => void;
}) {
  const [raw, setRaw] = useState(false);
  const cat = categoryStyle(categoryOfType(node.data.op));
  const config = (node.data.config ?? {}) as Record<string, unknown>;
  const { Icon } = cat;
  const hasSchema = op?.configSchema != null && (op.configSchema as { type?: string }).type === "object";
  const inputCls = "glass w-full rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]";

  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color: cat.color }} className="shrink-0" />
        <span className="font-mono text-[11px]" style={{ color: cat.color }}>
          {node.data.op}
        </span>
      </div>
      {op?.description && <div className="text-muted mt-2 text-xs"><Markdown text={op.description} /></div>}

      {/* Author-set node identity */}
      <div className="mt-4 space-y-2">
        <div>
          <div className="text-muted mb-1 text-xs">Name</div>
          <input
            className={inputCls}
            value={node.data.title ?? ""}
            placeholder={humanizeOp(node.data.op)}
            onChange={(e) => onMeta({ title: e.target.value || undefined })}
          />
        </div>
        <div>
          <div className="text-muted mb-1 text-xs">Comment (markdown)</div>
          <textarea
            className="glass h-16 w-full rounded-lg p-2 text-xs outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
            value={node.data.comment ?? ""}
            placeholder="What does this step do?"
            onChange={(e) => onMeta({ comment: e.target.value || undefined })}
          />
        </div>
      </div>

      <div className="mt-4 mb-2 flex items-center justify-between">
        <span className="text-muted text-xs font-semibold uppercase tracking-wider">Config</span>
        {hasSchema && (
          <button type="button" className="text-muted text-[10px] underline" onClick={() => setRaw((r) => !r)}>
            {raw ? "form" : "raw JSON"}
          </button>
        )}
      </div>

      {raw || !hasSchema ? (
        <RawJson value={config} onChange={onChange} />
      ) : (
        <FormFromSchema schema={op!.configSchema as Record<string, unknown>} value={config} onChange={onChange} />
      )}
    </div>
  );
}

function groupByCategory(ops: OpInfo[]): [string, OpInfo[]][] {
  const m = new Map<string, OpInfo[]>();
  for (const op of ops) {
    const c = categoryOfType(op.type);
    const list = m.get(c) ?? [];
    list.push(op);
    m.set(c, list);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** One palette op: category icon + color + a disambiguated label. */
function OpItem({ op, onAdd }: { op: OpInfo; onAdd: (op: OpInfo) => void }) {
  const category = categoryOfType(op.type);
  const cat = categoryStyle(category);
  const { Icon } = cat;
  return (
    <button
      onClick={() => onAdd(op)}
      {...tip(
        <div className="space-y-1">
          <div className="font-mono text-[11px] opacity-70">{op.type}</div>
          {op.description && <Markdown text={op.description} />}
        </div>,
      )}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-white/5"
    >
      <Icon size={12} style={{ color: cat.color }} className="shrink-0" />
      <span className="truncate">{paletteLabel(op.type, category)}</span>
    </button>
  );
}

/** A collapsible category section with colored header + op items. */
function CategorySection({ category, ops, open, onToggle, onAdd }: { category: string; ops: OpInfo[]; open: boolean; onToggle: () => void; onAdd: (op: OpInfo) => void }) {
  const cat = categoryStyle(category);
  const { Icon } = cat;
  return (
    <div className="mb-0.5">
      <button onClick={onToggle} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5">
        <Icon size={14} style={{ color: cat.color }} />
        <span className="text-xs font-semibold capitalize">{category}</span>
        <span className="text-muted ml-auto text-[10px]">{ops.length}</span>
      </button>
      {open && (
        <div className="ml-1 border-l pl-2" style={{ borderColor: cat.border }}>
          {ops.map((op) => (
            <OpItem key={op.type} op={op} onAdd={onAdd} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The op palette: reusable ops grouped by category (color + icon coded), with a
 *  collapsed-by-default "Advanced" section holding non-reusable/internal ops. */
function Palette({ ops, onAdd }: { ops: OpInfo[]; onAdd: (op: OpInfo) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const toggle = (k: string) => setCollapsed((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const reusable = useMemo(() => groupByCategory(ops.filter((o) => o.reusable !== false)), [ops]);
  const advanced = useMemo(() => ops.filter((o) => o.reusable === false), [ops]);
  const advancedGroups = useMemo(() => groupByCategory(advanced), [advanced]);

  return (
    <GlassPanel className="overflow-y-auto p-2">
      {reusable.map(([category, list]) => (
        <CategorySection key={category} category={category} ops={list} open={!collapsed.has(category)} onToggle={() => toggle(category)} onAdd={onAdd} />
      ))}

      {advanced.length > 0 && (
        <div className="mt-2 border-t hairline pt-2">
          <button onClick={() => setAdvancedOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5">
            <span className="text-muted text-[10px]">{advancedOpen ? "▾" : "▸"}</span>
            <span className="text-muted text-xs font-semibold uppercase tracking-wider">Advanced</span>
            <span className="text-muted ml-auto text-[10px]">{advanced.length}</span>
          </button>
          {advancedOpen && (
            <div className="mt-1 opacity-80">
              {advancedGroups.map(([category, list]) => (
                <div key={category} className="mb-1">
                  <div className="text-muted px-2 py-1 text-[10px] font-semibold capitalize">{category}</div>
                  <div className="ml-1 border-l hairline pl-2">
                    {list.map((op) => (
                      <OpItem key={op.type} op={op} onAdd={onAdd} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </GlassPanel>
  );
}

export function EditorPage() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}
