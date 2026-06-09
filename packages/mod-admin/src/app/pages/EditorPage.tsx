import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
} from "@xyflow/react";
import type { OpInfo, ValidationIssue, WorkflowDoc } from "@pattern/admin-sdk";
import { api } from "../lib/api";
import { useDeploy, useOps, useSaveWorkflow, useWorkflow } from "../lib/queries";
import { OpNode } from "../editor/OpNode";
import { buildFlow, edgeStyle, outputKind, toDoc, type OpMap, type OpNodeData } from "../editor/graph";
import { Badge, GlassPanel, NeonButton, Spinner } from "../components/ui";
import { Rocket, Plus } from "../components/icon";

const nodeTypes = { op: OpNode };

function EditorInner() {
  const { slug } = useParams();
  const isNew = !slug;
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
  const baseDoc = useRef<WorkflowDoc>({ id: slug ?? "untitled", nodes: [], edges: [] });
  const loadedFor = useRef<string | null>(null);

  // Initialize the canvas from the live doc (once per slug, after ops load).
  // Wait for the workflow query too, so we don't lock in an empty doc when
  // `useOps` happens to resolve before `useWorkflow`.
  useEffect(() => {
    if (!opMap.size) return;
    if (!isNew && !wfData) return;
    const key = slug ?? "__new__";
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    const doc: WorkflowDoc = wfData?.liveDoc ?? { id: slug ?? "untitled", name: slug, nodes: [], edges: [] };
    baseDoc.current = doc;
    const flow = buildFlow(doc, opMap);
    setNodes(flow.nodes);
    setEdges(flow.edges);
  }, [opMap, slug, wfData, isNew, setNodes, setEdges]);

  const onConnect = useCallback(
    (c: Connection) => {
      const kind = outputKind(c.source!, c.sourceHandle ?? "out", toDoc(baseDoc.current, nodes, edges), opMap);
      setEdges((eds) => addEdge({ ...c, type: "smoothstep", animated: kind === "stream", style: edgeStyle(kind) }, eds));
      // Connection assist (T2): verify and flag if incompatible.
      const fromNode = nodes.find((n) => n.id === c.source);
      const toNode = nodes.find((n) => n.id === c.target);
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
    [nodes, edges, opMap, setEdges],
  );

  const addNode = (op: OpInfo) => {
    const base = op.type.split(".").slice(-1)[0]!;
    let id = base;
    let i = 1;
    const ids = new Set(nodes.map((n) => n.id));
    while (ids.has(id)) id = `${base}${++i}`;
    const node: RFNode<OpNodeData> = {
      id,
      type: "op",
      position: { x: 120 + nodes.length * 20, y: 120 + nodes.length * 20 },
      data: { op: op.type, config: {}, inputs: op.inputs, outputs: op.outputs, boundary: op.boundary },
    };
    setNodes((ns) => [...ns, node]);
    setSelected(id);
  };

  const currentDoc = (): WorkflowDoc => {
    const targetSlug = slug ?? (newSlug || "untitled");
    return { ...toDoc(baseDoc.current, nodes, edges), id: targetSlug, name: baseDoc.current.name ?? targetSlug };
  };

  const onSave = async () => {
    const doc = currentDoc();
    if (isNew && !newSlug) {
      setNotice("Enter a slug to save the new workflow.");
      return;
    }
    const res = await save.mutateAsync({ slug: doc.id, doc, note: "edited in admin" });
    setIssues(res.issues);
    setNotice(res.issues.length ? `${res.issues.length} validation issue(s)` : `Saved ${res.version?.id}. Deploy to activate.`);
  };

  const onDeploy = async () => {
    const doc = currentDoc();
    const saved = await save.mutateAsync({ slug: doc.id, doc, note: "deploy" });
    if (saved.issues.length) {
      setIssues(saved.issues);
      setNotice(`${saved.issues.length} validation issue(s) — fix before deploying.`);
      return;
    }
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
          <NeonButton variant="ghost" onClick={onSave} disabled={save.isPending || wfData?.meta?.source === "code"}>
            Save
          </NeonButton>
          <NeonButton onClick={onDeploy} disabled={deploy.isPending || wfData?.meta?.source === "code"}>
            <Rocket size={14} /> Deploy
          </NeonButton>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[14rem_1fr_18rem] gap-3">
        {/* Palette */}
        <GlassPanel className="overflow-y-auto p-3">
          <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">Palette</div>
          {(opsData ?? []).map((op) => (
            <button
              key={op.type}
              onClick={() => addNode(op)}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left font-mono text-xs hover:bg-white/5"
            >
              <Plus size={11} className="text-muted shrink-0" />
              <span className="truncate">{op.type}</span>
            </button>
          ))}
        </GlassPanel>

        {/* Canvas */}
        <GlassPanel className="overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_e, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} color="rgba(255,255,255,0.06)" />
            <Controls className="!shadow-none" />
            <MiniMap pannable zoomable className="!bg-transparent" maskColor="rgba(0,0,0,0.4)" />
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
              onChange={(config) =>
                setNodes((ns) => ns.map((n) => (n.id === selectedNode.id ? { ...n, data: { ...n.data, config } } : n)))
              }
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
    </div>
  );
}

function Inspector({ node, op, onChange }: { node: RFNode<OpNodeData>; op?: OpInfo; onChange: (config: Record<string, unknown>) => void }) {
  const [text, setText] = useState(JSON.stringify(node.data.config ?? {}, null, 2));
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <div className="font-mono text-sm">{node.data.op}</div>
      {op?.description && <p className="text-muted mt-1 text-xs">{op.description}</p>}
      <div className="text-muted mt-4 mb-1 text-xs">config (JSON)</div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(e.target.value.trim() ? JSON.parse(e.target.value) : {});
            setErr(null);
          } catch {
            setErr("invalid JSON");
          }
        }}
        spellCheck={false}
        className="glass h-48 w-full rounded-lg p-2 font-mono text-xs outline-none"
      />
      {err && <div className="text-[var(--color-neon-pink)] mt-1 text-xs">{err}</div>}
      {op?.configSchema != null && (
        <details className="mt-3">
          <summary className="text-muted cursor-pointer text-xs">config schema</summary>
          <pre className="glass mt-1 max-h-40 overflow-auto rounded-lg p-2 font-mono text-[10px]">{JSON.stringify(op.configSchema, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export function EditorPage() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}
