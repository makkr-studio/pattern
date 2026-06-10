import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
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
  type OnBeforeDelete,
} from "@xyflow/react";
import type { OpInfo, ValidationIssue, WorkflowDoc } from "@pattern/admin-sdk";
import { api } from "../lib/api";
import { useDeploy, useOps, useSaveWorkflow, useWorkflow } from "../lib/queries";
import { OpNode } from "../editor/OpNode";
import { RunPanel } from "../editor/RunPanel";
import {
  buildFlow,
  edgeStyle,
  outputKind,
  portOnNode,
  tidyLayout,
  toDoc,
  CONTROL_IN,
  CONTROL_OUT,
  type OpMap,
  type OpNodeData,
} from "../editor/graph";
import { Badge, GlassPanel, Modal, NeonButton, Spinner } from "../components/ui";
import { FormFromSchema, RawJson, type FieldOverride } from "../components/FormFromSchema";
import { SchemaBuilder } from "../components/SchemaBuilder";
import { Markdown } from "../components/Markdown";
import { tip } from "../components/Tooltip";
import { Rocket, Play, Redo2, Undo2, Download, Upload, Search, Wand2, History, GitFork, Maximize2, Minimize2 } from "../components/icon";
import { categoryOfType, categoryStyle, humanizeOp, paletteLabel } from "../lib/categories";
import { schemaTypeOf } from "../lib/format";
import { fuzzyFilter } from "../lib/fuzzy";
import { sfx } from "../lib/sfx";

const nodeTypes = { op: OpNode };

/** MIME type carrying an op across the palette→canvas drag. */
const DND_TYPE = "application/x-pattern-op";

// ── Editor persistence (localStorage) ──
const DRAFT_KEY = "pattern.admin.editor.draft";
const PANES_KEY = "pattern.admin.editor.panes";

/** The whole canvas, continuously persisted so closing/navigating never loses
 *  work. `slug` is null for a brand-new workflow; `dirty` = differs from the
 *  last saved version (drives the discard guard). */
interface EditorDraft {
  slug: string | null;
  newSlug?: string;
  doc: WorkflowDoc;
  dirty: boolean;
  at: number;
}

function readDraft(): EditorDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const d = raw ? (JSON.parse(raw) as EditorDraft) : null;
    return d && Array.isArray(d.doc?.nodes) ? d : null;
  } catch {
    return null;
  }
}
function writeDraft(d: EditorDraft | null): void {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage full/blocked — drafts are best-effort */
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function EditorInner() {
  const { slug } = useParams();
  const isNew = !slug;
  const navigate = useNavigate();
  const location = useLocation();
  const locState = location.state as { template?: WorkflowDoc; loadDoc?: WorkflowDoc; note?: string } | null;
  /** A starting doc handed over by the template picker (new workflows only). */
  const template = locState?.template;
  /** An explicit doc to open on this slug (e.g. "edit from version vN"). */
  const loadDoc = locState?.loadDoc;
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
  const [forkOpen, setForkOpen] = useState(false);
  const [forkSlug, setForkSlug] = useState("");
  /** Inspector stretched over the whole editor (focus mode for big configs). */
  const [inspectorWide, setInspectorWide] = useState(false);
  /** A dirty draft for ANOTHER target blocks init until the user decides. */
  const [pendingDraft, setPendingDraft] = useState<EditorDraft | null>(null);
  const [initTick, setInitTick] = useState(0);
  const baseDoc = useRef<WorkflowDoc>({ id: slug ?? "untitled", nodes: [], edges: [] });
  /** Normal-form snapshot of the last *saved* doc (dirty = current ≠ this). */
  const savedRef = useRef<string>("__unsaved__");
  const loadedFor = useRef<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  // ── Resizable panels: palette | canvas | inspector, widths persisted. ──
  const [panes, setPanes] = useState<{ l: number; r: number }>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PANES_KEY) ?? "");
      if (typeof p?.l === "number" && typeof p?.r === "number") return p;
    } catch {
      /* default below */
    }
    return { l: 240, r: 300 };
  });
  const dragPane = (side: "l" | "r") => (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panes[side];
    const onMove = (ev: PointerEvent) => {
      const d = ev.clientX - startX;
      setPanes((p) => ({ ...p, [side]: clamp(side === "l" ? startW + d : startW - d, side === "l" ? 170 : 230, side === "l" ? 440 : 560) }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPanes((p) => {
        try {
          localStorage.setItem(PANES_KEY, JSON.stringify(p));
        } catch {
          /* best-effort */
        }
        return p;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

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
    sfx.play("undo");
  }, [takeSnap, setNodes, setEdges]);
  const redo = useCallback(() => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(takeSnap());
    setNodes(next.nodes);
    setEdges(next.edges);
    setHistVersion((v) => v + 1);
    sfx.play("redo");
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

  /** Load a doc onto the canvas + reset history; `saved` sets the dirty baseline. */
  const mountDoc = useCallback(
    (doc: WorkflowDoc, opts: { saved: WorkflowDoc | null }) => {
      baseDoc.current = doc;
      history.current = { past: [], future: [] };
      const flow = buildFlow(doc, opMap);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      // Normal-form the saved baseline through the same path the persist effect
      // uses, so an untouched canvas is never spuriously "dirty".
      if (opts.saved) {
        const sf = buildFlow(opts.saved, opMap);
        savedRef.current = JSON.stringify(toDoc(opts.saved, sf.nodes, sf.edges));
      } else {
        savedRef.current = "__unsaved__";
      }
    },
    [opMap, setNodes, setEdges],
  );

  // ── Initialize the canvas (once per slug, after ops + workflow load).
  // Priority: a dirty draft for another target asks first; then an explicit
  // doc (template / "edit from version"); then this target's own draft —
  // the editor reopens exactly where you left it; then the server doc.
  useEffect(() => {
    if (!opMap.size) return;
    if (!isNew && !wfData) return;
    const key = slug ?? "__new__";
    if (loadedFor.current === key) return;

    const serverDoc = wfData?.latestDoc ?? wfData?.liveDoc ?? null;
    const draft = readDraft();
    const explicit = template ?? loadDoc;

    // Plain /editor visit → the editor reopens wherever you were. Never
    // destructive, never asks: jump to the draft's URL when it has one.
    if (!slug && !explicit && draft?.slug) {
      loadedFor.current = null;
      navigate(`/editor/${draft.slug}`, { replace: true });
      return;
    }

    // Opening a *different* doc over a dirty draft would destroy work → ask.
    const draftIsThisTarget = draft && draft.slug === (slug ?? null) && !explicit;
    if (draft?.dirty && !draftIsThisTarget && !pendingDraft) {
      setPendingDraft(draft);
      return; // blocked until the user decides (modal below)
    }

    loadedFor.current = key;
    setPendingDraft(null);

    if (explicit) {
      mountDoc({ ...explicit, id: slug ?? explicit.id }, { saved: serverDoc });
      if (loadDoc) setNotice(`Editing ${locState?.note ?? "an older version"} — Save to make it the newest version.`);
      return;
    }
    if (draftIsThisTarget) {
      mountDoc(draft.doc, { saved: serverDoc });
      if (!slug && draft.newSlug) setNewSlug(draft.newSlug);
      if (draft.dirty) setNotice("Restored your unsaved draft.");
      return;
    }
    mountDoc(serverDoc ?? { id: slug ?? "untitled", name: slug, nodes: [], edges: [] }, { saved: serverDoc });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opMap, slug, wfData, isNew, template, loadDoc, initTick, mountDoc, navigate]);

  // ── Persist the canvas continuously (debounced) — work is never lost. ──
  useEffect(() => {
    if (loadedFor.current !== (slug ?? "__new__")) return; // not initialized
    const t = setTimeout(() => {
      const doc = toDoc(baseDoc.current, nodes, edges);
      const ser = JSON.stringify(doc);
      const dirty = ser !== savedRef.current && (Boolean(slug) || doc.nodes.length > 0);
      writeDraft({ slug: slug ?? null, newSlug: newSlug || undefined, doc, dirty, at: Date.now() });
    }, 400);
    return () => clearTimeout(t);
  }, [nodes, edges, newSlug, slug]);

  // ── Connection rules: ports must agree on kind AND data type (T2). Checked
  // live while dragging, so an incompatible port simply refuses the link.
  const isValidConnection = useCallback(
    (c: Connection | RFEdge): boolean => {
      if (!c.source || !c.target || c.source === c.target) return false;
      const curNodes = rf.getNodes();
      const src = curNodes.find((n) => n.id === c.source);
      const tgt = curNodes.find((n) => n.id === c.target);
      if (!src || !tgt) return false;
      const out = portOnNode(src.data, c.sourceHandle ?? CONTROL_OUT, "out");
      const inp = portOnNode(tgt.data, c.targetHandle ?? CONTROL_IN, "in");
      if (!out || !inp) return false;
      if (out.kind !== inp.kind) return false;
      if (out.kind !== "control") {
        const a = schemaTypeOf(out.schema);
        const b = schemaTypeOf(inp.schema);
        const loose = (t: string) => t === "any" || t === "union" || t === "enum";
        if (!loose(a) && !loose(b) && a !== b) return false;
      }
      // Stream inputs are single-source (use core.stream.merge to combine).
      if (inp.kind === "stream") {
        const port = c.targetHandle ?? CONTROL_IN;
        if (rf.getEdges().some((e) => e.target === c.target && (e.targetHandle ?? CONTROL_IN) === port)) return false;
      }
      return true;
    },
    [rf],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      // Read live canvas state from the RF store — the closed-over `nodes`/
      // `edges` snapshot can lag pointer-driven events (rapid connects).
      const curNodes = rf.getNodes();
      const curEdges = rf.getEdges();
      pushHistory();
      const kind = outputKind(c.source!, c.sourceHandle ?? CONTROL_OUT, toDoc(baseDoc.current, curNodes, curEdges), opMap);
      setEdges((eds) => addEdge({ ...c, type: "default", animated: kind === "stream", style: edgeStyle(kind) }, eds));
      sfx.play("connect");
      // Connection assist (T2): the engine double-checks schemas server-side.
      const fromNode = curNodes.find((n) => n.id === c.source);
      const toNode = curNodes.find((n) => n.id === c.target);
      if (fromNode && toNode) {
        void api
          .portsCompatible(
            { op: fromNode.data.op, port: c.sourceHandle ?? CONTROL_OUT, dir: "out" },
            { op: toNode.data.op, port: c.targetHandle ?? CONTROL_IN, dir: "in" },
          )
          .then((res) => {
            if (!res.ok) {
              setNotice(`⚠ ${c.sourceHandle} → ${c.targetHandle}: ${res.reason}${res.fix ? ` (insert core.stream.${res.fix})` : ""}`);
              sfx.play("invalid");
            }
          });
      }
    },
    [rf, opMap, setEdges, pushHistory],
  );

  /** A refused drop while connecting gets audible feedback (not just visual). */
  const onConnectEnd = useCallback((_e: unknown, state: { isValid: boolean | null }) => {
    if (state.isValid === false) sfx.play("invalid");
  }, []);

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

  // ── Boundary pairing (§7): triggers and out-gates live and die together. A
  // deletion that hits one half is expanded to its partner (and their edges).
  const onBeforeDelete: OnBeforeDelete<RFNode<OpNodeData>, RFEdge> = useCallback(
    async ({ nodes: delNodes, edges: delEdges }) => {
      const all = rf.getNodes();
      const ids = new Set(delNodes.map((n) => n.id));
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of all) {
          const pid = n.data.pairId;
          if (!pid) continue;
          if (ids.has(n.id) && !ids.has(pid) && all.some((m) => m.id === pid)) {
            ids.add(pid);
            grew = true;
          }
          if (!ids.has(n.id) && ids.has(pid)) {
            ids.add(n.id);
            grew = true;
          }
        }
      }
      const expandedNodes = all.filter((n) => ids.has(n.id));
      const edgeIds = new Set(delEdges.map((e) => e.id));
      const expandedEdges = rf.getEdges().filter((e) => edgeIds.has(e.id) || ids.has(e.source) || ids.has(e.target));
      if (expandedNodes.length || expandedEdges.length) sfx.play("delete");
      return { nodes: expandedNodes, edges: expandedEdges };
    },
    [rf],
  );

  /** Materialize an op as a canvas node with a fresh id. */
  const makeNode = useCallback((op: OpInfo, pos: { x: number; y: number }, ids: Set<string>): RFNode<OpNodeData> => {
    const base = op.type.split(".").slice(-1)[0]!;
    let id = base;
    let i = 1;
    while (ids.has(id)) id = `${base}${++i}`;
    ids.add(id);
    return {
      id,
      type: "op",
      position: pos,
      data: {
        op: op.type,
        config: {},
        description: op.description,
        inputs: op.inputs,
        outputs: op.outputs,
        configInputs: op.configInputs ?? [],
        controlOuts: op.controlOut ?? [],
        boundary: op.boundary,
      },
    };
  }, []);

  /** Drop an op at a canvas position. Boundary ops bring their partner (§7):
   *  adding a trigger always brings the paired out-gate, and vice versa. */
  const addNodeAt = useCallback(
    (op: OpInfo, pos: { x: number; y: number }) => {
      pushHistory();
      const ids = new Set(rf.getNodes().map((n) => n.id));
      const node = makeNode(op, pos, ids);
      const added = [node];
      if (op.boundary && op.pair) {
        const partnerOp = opMap.get(op.pair);
        if (partnerOp?.boundary && partnerOp.boundary !== op.boundary) {
          const dx = op.boundary === "trigger" ? 480 : -480;
          const partner = makeNode(partnerOp, { x: pos.x + dx, y: pos.y }, ids);
          node.data.pairId = partner.id;
          partner.data.pairId = node.id;
          added.push(partner);
        }
      }
      setNodes((ns) => [...ns, ...added]);
      setSelected(node.id);
      sfx.play("add");
    },
    [rf, opMap, makeNode, setNodes, pushHistory],
  );

  // ── Palette → canvas drag-and-drop. ──
  const onDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(DND_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);
  const onDrop = useCallback(
    (e: DragEvent) => {
      const type = e.dataTransfer.getData(DND_TYPE);
      const op = type ? opMap.get(type) : undefined;
      if (!op) return;
      e.preventDefault();
      addNodeAt(op, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [rf, opMap, addNodeAt],
  );

  /** "Resume my draft": go back to where the draft lives. The router change
   *  (slug or cleared location.state) re-runs the init effect — no manual
   *  tick, which would race the navigation and re-trigger the guard. */
  const resumeDraft = useCallback(() => {
    const d = pendingDraft;
    setPendingDraft(null);
    if (!d) return;
    loadedFor.current = null;
    navigate(d.slug ? `/editor/${d.slug}` : "/editor", { replace: true, state: null });
  }, [pendingDraft, navigate]);

  /** Auto-tidy: layered layout, undo-able, then settle the viewport. */
  const onTidy = useCallback(() => {
    pushHistory();
    const layout = tidyLayout(rf.getNodes(), rf.getEdges());
    setNodes((ns) => ns.map((n) => ({ ...n, position: layout.get(n.id) ?? n.position })));
    setTimeout(() => void rf.fitView({ padding: 0.2, duration: 350 }), 50);
    sfx.play("open");
  }, [rf, setNodes, pushHistory]);

  const currentDoc = (): WorkflowDoc => {
    const targetSlug = slug ?? (newSlug || "untitled");
    return { ...toDoc(baseDoc.current, nodes, edges), id: targetSlug, name: baseDoc.current.name ?? targetSlug };
  };

  /** After a successful save the canvas doc IS the base — keep the ref in sync
   *  so later `currentDoc()` calls carry the saved identity/metadata, and move
   *  a brand-new workflow onto its real URL. */
  const adoptSaved = (doc: WorkflowDoc) => {
    baseDoc.current = doc;
    savedRef.current = JSON.stringify(doc);
    writeDraft({ slug: doc.id, doc, dirty: false, at: Date.now() });
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
    sfx.play(res.issues.length ? "invalid" : "save");
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
      sfx.play("invalid");
      return;
    }
    adoptSaved(doc);
    const res = await deploy.mutateAsync({ slug: doc.id, version: saved.version!.id, swap: false });
    setNotice(res.ok ? `Deployed ${doc.id} ${saved.version!.id} 🚀` : `Route conflict with: ${res.conflicts.map((c) => c.conflictsWith).join(", ")}`);
    sfx.play(res.ok ? "deploy" : "error");
  };

  /** Fork: save the current canvas under a new slug (works for code workflows
   *  too — that's how you make a read-only workflow your own). */
  const onFork = async () => {
    const id = forkSlug.trim();
    if (!id) return;
    const doc: WorkflowDoc = { ...currentDoc(), id, name: id, source: undefined };
    const res = await save.mutateAsync({ slug: id, doc, note: `forked from ${slug ?? "draft"}` });
    if (res.issues.length) {
      setIssues(res.issues);
      setNotice(`${res.issues.length} validation issue(s) — fix before forking.`);
      sfx.play("invalid");
      return;
    }
    setForkOpen(false);
    writeDraft({ slug: id, doc, dirty: false, at: Date.now() });
    loadedFor.current = null;
    navigate(`/editor/${id}`);
    setNotice(`Forked to ${id}.`);
    sfx.play("save");
  };

  // ── Import / export: a workflow is a file — round-trip it like one (§15). ──
  const onExport = () => {
    const doc = currentDoc();
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.id}.pattern.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setNotice(`Exported ${a.download}.`);
    sfx.play("ok");
  };
  const onImportFile = async (file: File) => {
    try {
      const doc = JSON.parse(await file.text()) as WorkflowDoc;
      if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new Error("not a workflow document (missing nodes/edges)");
      pushHistory();
      const flow = buildFlow(doc, opMap);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      baseDoc.current = { ...doc, id: slug ?? doc.id };
      if (isNew && !newSlug && doc.id) setNewSlug(doc.id.replace(/[^a-z0-9.\-_]/gi, ""));
      setSelected(null);
      setNotice(`Imported "${doc.id}" — Save to persist it.`);
      sfx.play("add");
    } catch (err) {
      setNotice(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      sfx.play("error");
    }
  };

  const selectedNode = nodes.find((n) => n.id === selected);
  const isCode = wfData?.meta?.source === "code";

  if (isLoading && !isNew) return <Spinner />;

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="text-xl font-semibold">{isNew ? "New workflow" : slug}</h1>
        {wfData?.meta && <Badge hue={wfData.meta.source === "code" ? 200 : 150}>{wfData.meta.source}</Badge>}
        {wfData?.meta?.live && wfData.meta.live !== "code" && (
          <Badge hue={150} title={`Deployed version: ${wfData.meta.live}`}>
            live {wfData.meta.live}
          </Badge>
        )}
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
          <NeonButton variant="ghost" className="!px-2" aria-label="Auto-tidy layout" title="Auto-tidy layout" onClick={onTidy} disabled={nodes.length === 0}>
            <Wand2 size={14} />
          </NeonButton>
          {slug && (
            <NeonButton
              variant="ghost"
              className="!px-2"
              aria-label="Versions & history"
              title={`Versions & history${wfData?.meta ? ` (${wfData.meta.versions.length})` : ""}`}
              onClick={() => navigate(`/versions/${slug}`)}
            >
              <History size={14} />
            </NeonButton>
          )}
          <NeonButton
            variant="ghost"
            className="!px-2"
            aria-label="Fork to a new slug"
            title="Fork to a new slug"
            onClick={() => {
              setForkSlug(slug ? `${slug}-fork` : newSlug ? `${newSlug}-fork` : "");
              setForkOpen(true);
            }}
            disabled={nodes.length === 0}
          >
            <GitFork size={14} />
          </NeonButton>
          <NeonButton
            variant="ghost"
            className="!px-2"
            aria-label="Import workflow JSON"
            title="Import workflow JSON"
            onClick={() => importInput.current?.click()}
          >
            <Upload size={14} />
          </NeonButton>
          <NeonButton
            variant="ghost"
            className="!px-2"
            aria-label="Export workflow JSON"
            title="Export workflow JSON"
            onClick={onExport}
            disabled={nodes.length === 0}
          >
            <Download size={14} />
          </NeonButton>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = ""; // allow re-importing the same file
            }}
          />
          <NeonButton variant="ghost" onClick={() => setRunOpen(true)} disabled={nodes.length === 0}>
            <Play size={14} /> Run
          </NeonButton>
          <NeonButton variant="ghost" onClick={onSave} disabled={save.isPending || isCode} title={isCode ? "Code workflows are read-only — fork instead" : undefined}>
            Save
          </NeonButton>
          <NeonButton onClick={onDeploy} disabled={deploy.isPending || isCode} title={isCode ? "Code workflows are read-only — fork instead" : undefined}>
            <Rocket size={14} /> Deploy
          </NeonButton>
        </div>
      </div>

      <div className="relative grid min-h-0 flex-1 gap-0" style={{ gridTemplateColumns: `${panes.l}px 10px 1fr 10px ${panes.r}px` }}>
        {/* Palette — searchable, drag onto the canvas */}
        <Palette ops={opsData ?? []} />

        <PaneGrip onPointerDown={dragPane("l")} label="Resize palette" />

        {/* Canvas */}
        <GlassPanel className="overflow-hidden" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeTracked}
            onEdgesChange={onEdgesChangeTracked}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onBeforeDelete={onBeforeDelete}
            isValidConnection={isValidConnection}
            onNodeDragStart={() => pushHistory()}
            onNodeClick={(_e, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={22} size={1.6} color="var(--canvas-dot)" />
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

        <PaneGrip onPointerDown={dragPane("r")} label="Resize inspector" />

        {/* Inspector — stretches over the whole editor in focus mode */}
        <GlassPanel className={`overflow-y-auto p-4 ${inspectorWide ? "absolute inset-0 z-20" : ""}`}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-muted text-xs font-semibold uppercase tracking-wider">Inspector</span>
            <button
              type="button"
              aria-label={inspectorWide ? "Shrink inspector" : "Stretch inspector over the canvas"}
              title={inspectorWide ? "Back to the canvas" : "Stretch — more room for configs"}
              className="text-muted rounded p-1 hover:bg-white/10 hover:text-[var(--fg)]"
              onClick={() => {
                setInspectorWide((w) => !w);
                sfx.play(inspectorWide ? "close" : "open");
              }}
            >
              {inspectorWide ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </div>
          <div className={inspectorWide ? "mx-auto max-w-3xl" : undefined}>
            {inspectorWide && selectedNode && (
              <div className="text-muted mb-3 text-xs">
                Editing <span className="font-mono">{selectedNode.id}</span> in focus mode — the canvas is right behind this panel.
              </div>
            )}
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
              <p className="text-muted text-sm">Select a node to edit its config. Drag an op from the palette onto the canvas to add it; drag between ports to connect (ports refuse incompatible types).</p>
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
          </div>
        </GlassPanel>
      </div>

      {runOpen && <RunPanel open={runOpen} onClose={() => setRunOpen(false)} doc={currentDoc()} opMap={opMap} />}

      {/* Fork dialog */}
      <Modal open={forkOpen} onClose={() => setForkOpen(false)} title="Fork workflow">
        <div className="space-y-4">
          <p className="text-muted text-sm">
            Save a copy of the current canvas under a new slug{isCode ? " — that's how a read-only code workflow becomes yours" : ""}.
          </p>
          <input
            value={forkSlug}
            onChange={(e) => setForkSlug(e.target.value.replace(/[^a-z0-9.\-_]/gi, ""))}
            placeholder="new-workflow-slug"
            aria-label="New workflow slug"
            className="glass w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
            onKeyDown={(e) => {
              if (e.key === "Enter") void onFork();
            }}
          />
          <div className="flex justify-end gap-2">
            <NeonButton variant="ghost" onClick={() => setForkOpen(false)}>
              Cancel
            </NeonButton>
            <NeonButton onClick={() => void onFork()} disabled={!forkSlug.trim() || save.isPending}>
              <GitFork size={14} /> Fork
            </NeonButton>
          </div>
        </div>
      </Modal>

      {/* Unsaved-draft guard: this navigation would destroy other work.
          Closing the dialog = the non-destructive choice (resume). */}
      <Modal open={pendingDraft !== null} onClose={() => resumeDraft()} title="Unsaved draft">
        {pendingDraft && (
          <div className="space-y-4">
            <p className="text-sm">
              You have unsaved changes in{" "}
              <span className="font-mono">{pendingDraft.slug ?? pendingDraft.newSlug ?? pendingDraft.doc.id ?? "a new workflow"}</span>. Opening{" "}
              <span className="font-mono">{slug ?? "a new canvas"}</span> will discard them.
            </p>
            <div className="flex justify-end gap-2">
              <NeonButton variant="ghost" onClick={resumeDraft}>
                Resume my draft
              </NeonButton>
              <NeonButton
                variant="danger"
                onClick={() => {
                  writeDraft(null);
                  setPendingDraft(null);
                  loadedFor.current = null;
                  setInitTick((t) => t + 1);
                  sfx.play("delete");
                }}
              >
                Discard draft
              </NeonButton>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** The thin draggable gutter between panes. */
function PaneGrip({ onPointerDown, label }: { onPointerDown: (e: ReactPointerEvent) => void; label: string }) {
  return (
    <div
      role="separator"
      aria-label={label}
      onPointerDown={onPointerDown}
      className="group flex cursor-col-resize items-center justify-center"
    >
      <div className="h-10 w-1 rounded-full bg-white/10 transition-colors group-hover:bg-[var(--color-neon-cyan)]/60" />
    </div>
  );
}

/**
 * Config fields that hold a JSON Schema get the visual builder instead of a
 * raw JSON box. Keyed by op type — mods with schema-valued fields can be added
 * here (or we promote this to op metadata later).
 */
const SCHEMA_FIELDS: Record<string, string[]> = {
  "core.schema.define": ["schema"],
  "core.schema.validate": ["schema"],
  "boundary.http.request": ["body", "query", "params"],
  "boundary.ws.message": ["message"],
};

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
  const schemaOverrides = useMemo(() => {
    const fields = SCHEMA_FIELDS[node.data.op];
    if (!fields) return undefined;
    const o: Record<string, FieldOverride> = {};
    for (const f of fields) {
      o[f] = ({ value, onChange: set }) => (
        <SchemaBuilder value={value as Record<string, unknown> | undefined} onChange={set} />
      );
    }
    return o;
  }, [node.data.op]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color: cat.color }} className="shrink-0" />
        <span className="font-mono text-[11px]" style={{ color: cat.color }}>
          {node.data.op}
        </span>
      </div>
      {op?.description && <div className="text-muted mt-2 text-xs"><Markdown text={op.description} /></div>}
      {node.data.pairId && (
        <div className="text-muted mt-2 text-xs">
          ⛓ Paired with <span className="font-mono">{node.data.pairId}</span> — boundary pairs are created and deleted together.
        </div>
      )}

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
        <FormFromSchema schema={op!.configSchema as Record<string, unknown>} value={config} onChange={onChange} overrides={schemaOverrides} />
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

/** One palette op: draggable onto the canvas (grab it!), tooltip with docs. */
function OpItem({ op }: { op: OpInfo }) {
  const category = categoryOfType(op.type);
  const cat = categoryStyle(category);
  const { Icon } = cat;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_TYPE, op.type);
        e.dataTransfer.effectAllowed = "copy";
        sfx.play("drag");
      }}
      {...tip(
        <div className="space-y-1">
          <div className="font-mono text-[11px] opacity-70">{op.type}</div>
          {op.description && <Markdown text={op.description} />}
          <div className="text-muted">Drag onto the canvas to add{op.boundary && op.pair ? ` (brings its ${op.boundary === "trigger" ? "out-gate" : "trigger"} partner)` : ""}.</div>
        </div>,
      )}
      className="flex w-full cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] select-none hover:bg-white/5 active:cursor-grabbing"
    >
      <Icon size={15} style={{ color: cat.color }} className="shrink-0" />
      <span className="truncate">{paletteLabel(op.type, category)}</span>
    </div>
  );
}

/** A collapsible category section with colored header + op items. */
function CategorySection({ category, ops, open, onToggle }: { category: string; ops: OpInfo[]; open: boolean; onToggle: () => void }) {
  const cat = categoryStyle(category);
  const { Icon } = cat;
  return (
    <div className="mb-0.5">
      <button onClick={onToggle} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5">
        <Icon size={15} style={{ color: cat.color }} />
        <span className="text-[13px] font-semibold capitalize">{category}</span>
        <span className="text-muted ml-auto text-[10px]">{ops.length}</span>
      </button>
      {open && (
        <div className="ml-1 border-l pl-2" style={{ borderColor: cat.border }}>
          {ops.map((op) => (
            <OpItem key={op.type} op={op} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The op palette: fuzzy-searchable, filterable by mod, grouped by category
 *  (color + icon coded), drag-to-add. Non-reusable ops live in a collapsed
 *  "Advanced" section. Scrolls independently of the canvas. */
function Palette({ ops }: { ops: OpInfo[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mod, setMod] = useState<string>("");
  const toggle = (k: string) => setCollapsed((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const mods = useMemo(() => [...new Set(ops.map((o) => o.mod ?? "core"))].sort(), [ops]);
  const filtered = useMemo(() => {
    let list = ops;
    if (mod) list = list.filter((o) => (o.mod ?? "core") === mod);
    return fuzzyFilter(list, query, (o) => `${o.type} ${o.title ?? ""} ${humanizeOp(o.type)}`);
  }, [ops, mod, query]);
  const searching = query.trim().length > 0;

  const reusable = useMemo(() => groupByCategory(filtered.filter((o) => o.reusable !== false)), [filtered]);
  const advanced = useMemo(() => filtered.filter((o) => o.reusable === false), [filtered]);
  const advancedGroups = useMemo(() => groupByCategory(advanced), [advanced]);

  return (
    <GlassPanel className="flex min-h-0 flex-col p-2">
      {/* Filter bar */}
      <div className="mb-2 space-y-1.5 px-0.5">
        <div className="glass flex items-center gap-1.5 rounded-lg px-2 py-1.5">
          <Search size={12} className="text-muted shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ops…"
            aria-label="Search ops"
            className="w-full bg-transparent text-xs outline-none"
          />
          {query && (
            <button type="button" aria-label="Clear search" className="text-muted text-[10px]" onClick={() => setQuery("")}>
              ✕
            </button>
          )}
        </div>
        <select
          value={mod}
          onChange={(e) => setMod(e.target.value)}
          aria-label="Filter by mod"
          className="glass w-full rounded-lg px-2 py-1 text-xs outline-none [&>option]:bg-[var(--bg)]"
        >
          <option value="">All mods</option>
          {mods.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Op list — its own scroll context */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {searching ? (
          // Flat ranked list while searching (best match first).
          <div>
            {filtered.length === 0 && <div className="text-muted px-2 py-4 text-center text-xs">No ops match.</div>}
            {filtered.map((op) => (
              <OpItem key={op.type} op={op} />
            ))}
          </div>
        ) : (
          <>
            {reusable.map(([category, list]) => (
              <CategorySection key={category} category={category} ops={list} open={!collapsed.has(category)} onToggle={() => toggle(category)} />
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
                            <OpItem key={op.type} op={op} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
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
