/**
 * The graph editor — one workflow's canvas inside its workspace (the layout
 * above provides the open-workflows strip, the title, the deployment state,
 * and the Editor · Runs · Versions · Settings tabs).
 *
 * Layout: palette (collapsible to a rail) | canvas | right dock. The dock is
 * shared by the Inspector and Buddy: selecting a node brings the Inspector
 * forward; with nothing selected it shows the WORKFLOW's own settings (name,
 * description, durable/offload); Buddy is one tab over and keeps its thread
 * while hidden. Deploy previews what changes before it saves and moves the
 * live pointer.
 *
 * Persistence lives in ../lib/workspace (drafts, viewports, open tabs); the
 * pieces of this page live in ../editor (Palette, Inspector, WorkflowPanel,
 * DeployPreview, BuddyDock, RunPanel, graph helpers).
 */

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
  SelectionMode,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
  type OnBeforeDelete,
} from "@xyflow/react";
import type { OpInfo, ValidationIssue, WorkflowDoc } from "@pattern-js/admin-sdk";
import { hasErrors, isWarning, issueSummary } from "../lib/issues";
import { api } from "../lib/api";
import { useDeploy, useManifest, useOps, useSaveWorkflow, useWorkflow } from "../lib/queries";
import {
  NEW_KEY,
  readDraft,
  readTabs,
  readViewport,
  removeDraft,
  renameTab,
  writeDraft,
  writeViewport,
  type EditorDraft,
} from "../lib/workspace";
import { deployPreview, type DeployPreview } from "../lib/deploy-preview";
import { BuddyDock } from "../editor/BuddyDock";
import { OpNode } from "../editor/OpNode";
import { FrameNode } from "../editor/FrameNode";
import { PortalEdge } from "../editor/PortalEdge";
import { FlowEdge } from "../editor/FlowEdge";
import { RunPanel } from "../editor/RunPanel";
import { Palette, DND_TYPE, PALETTE_RAIL_PX } from "../editor/Palette";
import { Inspector } from "../editor/Inspector";
import { WorkflowPanel, type WorkflowMetaPatch } from "../editor/WorkflowPanel";
import { DeployPreviewModal } from "../editor/DeployPreview";
import {
  buildFlow,
  FRAME_TYPE,
  makeFrameNode,
  PORTAL_TYPE,
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
import { GlassPanel, JsonView, Modal, NeonButton, Spinner } from "../components/ui";
import { tip } from "../components/Tooltip";
import { Rocket, Play, Redo2, Undo2, Download, Upload, Wand2, GitFork, Maximize2, Minimize2, Frame } from "../components/icon";
import { Braces, Sparkles, SlidersHorizontal } from "lucide-react";
import { categoryOfType, categoryStyle } from "../lib/categories";
import { schemaTypeOf } from "../lib/format";
import { sfx } from "../lib/sfx";

const nodeTypes = { op: OpNode, frame: FrameNode };
// `default` overrides xyflow's built-in wire so normal edges highlight on
// port-hover (FlowEdge); portaled edges keep their glyph renderer.
const edgeTypes = { portal: PortalEdge, default: FlowEdge };

// ── Editor chrome persistence (localStorage): pane widths, palette state. ──
const PANES_KEY = "pattern.admin.editor.panes";
const PALETTE_KEY = "pattern.admin.editor.palette";

// ── Node clipboard (⌘C/⌘X/⌘V). Lives in localStorage so it crosses editor
// tabs and even browser windows: copy in one workflow, paste into another. ──
const CLIPBOARD_KEY = "pattern.admin.editor.clipboard";

interface ClipboardPayload {
  kind: "pattern/nodes@v1";
  nodes: Array<{
    id: string;
    op: string;
    position: { x: number; y: number };
    config: Record<string, unknown>;
    title?: string;
    comment?: string;
    pairId?: string;
  }>;
  /** Edges INTERNAL to the copied set (both endpoints copied). */
  edges: Array<{ source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }>;
}

/** The document-level fields the Workflow panel edits (mirrored from baseDoc for rendering). */
interface DocMeta {
  name?: string;
  description?: string;
  tags?: string[];
  offload: boolean;
  durable: boolean;
}
const metaOf = (doc: WorkflowDoc): DocMeta => ({ name: doc.name, description: doc.description, tags: doc.tags, offload: doc.offload === true, durable: doc.durable === true });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const editorUrl = (slug: string | null): string => (slug ? `/workflows/${encodeURIComponent(slug)}/editor` : "/workflows/new");

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
  /** Live while a frame is being dragged: the op nodes it carries. */
  const frameDrag = useRef<{ frameId: string; start: { x: number; y: number }; carried: Map<string, { x: number; y: number }> } | null>(null);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [newSlug, setNewSlug] = useState("");
  const [runOpen, setRunOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  /** Document-level fields (name, description, tags, flags) as the Workflow panel shows them. */
  const [meta, setMeta] = useState<DocMeta>({ offload: false, durable: false });
  const [forkOpen, setForkOpen] = useState(false);
  const [forkSlug, setForkSlug] = useState("");
  /** Right dock stretched over the whole editor (focus mode for big configs). */
  const [inspectorWide, setInspectorWide] = useState(false);
  /** An explicit doc (template / "edit vN") over a dirty draft asks first. */
  const [pendingDraft, setPendingDraft] = useState<EditorDraft | null>(null);
  const [initTick, setInitTick] = useState(0);
  /** The deploy conversation: what the click changes, shown before it saves + deploys. */
  const [deployPlan, setDeployPlan] = useState<DeployPreview | null>(null);

  /** Canvas nodes whose op is `cpuHeavy` — the Offload nudge counts these. */
  const cpuHeavyCount = useMemo(
    () => nodes.filter((n) => n.type !== FRAME_TYPE && opMap.get(n.data.op)?.cpuHeavy).length,
    [nodes, opMap],
  );

  const tabKey = slug ?? NEW_KEY;
  useEffect(() => setNotice(null), [tabKey]); // a stale notice from another workflow would mislead
  const baseDoc = useRef<WorkflowDoc>({ id: slug ?? "untitled", nodes: [], edges: [] });
  /** Normal-form snapshot of the last *saved* doc (dirty = current ≠ this). */
  const savedRef = useRef<string>("__unsaved__");
  const loadedFor = useRef<string | null>(null);
  /** Tab whose framing we've already applied (re-applied on tab switch). */
  const viewportFor = useRef<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  // ── Resizable panels: palette | canvas | dock, widths persisted. ──
  const [panes, setPanes] = useState<{ l: number; r: number }>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PANES_KEY) ?? "");
      if (typeof p?.l === "number" && typeof p?.r === "number") return p;
    } catch {
      /* default below */
    }
    return { l: 240, r: 300 };
  });
  const [paletteOpen, setPaletteOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PALETTE_KEY) !== "collapsed";
    } catch {
      return true;
    }
  });
  const togglePalette = (open: boolean) => {
    setPaletteOpen(open);
    try {
      localStorage.setItem(PALETTE_KEY, open ? "open" : "collapsed");
    } catch {
      /* best-effort */
    }
  };
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

  // ── The right dock: Inspector (a node, or the workflow) and Buddy share it.
  // Buddy is present when mod-buddy is installed (manifest carries its command). ──
  const { data: uiManifest } = useManifest();
  const buddyAvailable = Boolean(uiManifest?.commands?.some((c) => c.id === "buddy.open"));
  const [dock, setDock] = useState<"inspector" | "buddy">("inspector");
  const showDock = (d: "inspector" | "buddy") => {
    setDock(d);
    sfx.play(d === "buddy" ? "open" : "close");
  };
  /** Apply a Buddy proposal to the OPEN canvas: undoable (⌘Z), marks dirty — Save/Deploy stay manual. */
  const applyBuddyDoc = useCallback(
    (doc: WorkflowDoc) => {
      pushHistory();
      const flow = buildFlow(doc, opMap);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      baseDoc.current = { ...baseDoc.current, name: doc.name ?? baseDoc.current.name, description: doc.description ?? baseDoc.current.description };
      setMeta(metaOf(baseDoc.current));
    },
    [opMap, pushHistory, setNodes, setEdges],
  );

  /** The Workflow panel edits document-level fields: baseDoc is the truth for
   *  currentDoc()/toDoc; `meta` mirrors it for rendering + the dirty recompute.
   *  Off flags serialize as `undefined` so an off workflow equals one never flagged. */
  const applyMeta = useCallback((patch: WorkflowMetaPatch) => {
    const next: WorkflowDoc = { ...baseDoc.current, ...patch };
    if (patch.offload !== undefined) next.offload = patch.offload ? true : undefined;
    if (patch.durable !== undefined) next.durable = patch.durable ? true : undefined;
    if ("name" in patch && !patch.name) delete next.name;
    if ("description" in patch && !patch.description) delete next.description;
    if ("tags" in patch && !patch.tags) delete next.tags;
    baseDoc.current = next;
    setMeta(metaOf(next));
  }, []);

  /** Load a doc onto the canvas + reset history; `saved` sets the dirty baseline. */
  const mountDoc = useCallback(
    (doc: WorkflowDoc, opts: { saved: WorkflowDoc | null }) => {
      baseDoc.current = doc;
      setMeta(metaOf(doc));
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
      // A freshly (re)mounted doc wants its framing re-applied; the viewport
      // effect does it once these nodes have measured.
      viewportFor.current = null;
    },
    [opMap, setNodes, setEdges],
  );

  // ── Initialize the canvas (once per workflow, after ops + workflow load).
  // Priority: an explicit doc (template / "edit from version") asks first if
  // it would clobber this tab's dirty draft; then the tab's own DIRTY draft —
  // every tab reopens exactly where you left it; then the server doc (a clean
  // draft follows the server, so a version saved elsewhere shows up here).
  useEffect(() => {
    if (!opMap.size) return;
    if (!isNew && !wfData) return;
    if (loadedFor.current === tabKey) return;

    const serverDoc = wfData?.latestDoc ?? wfData?.liveDoc ?? null;
    const draft = readDraft(tabKey);
    const explicit = template ?? loadDoc;

    // An explicit doc over THIS tab's dirty draft would destroy work → ask.
    if (explicit && draft?.dirty && !pendingDraft) {
      setPendingDraft(draft);
      return; // blocked until the user decides (modal below)
    }

    loadedFor.current = tabKey;
    setPendingDraft(null);

    if (explicit) {
      mountDoc({ ...explicit, id: slug ?? explicit.id }, { saved: serverDoc });
      if (loadDoc) setNotice(`Editing ${locState?.note ?? "an older version"} — Save to make it the newest version.`);
      return;
    }
    if (draft && (draft.dirty || !serverDoc)) {
      mountDoc(draft.doc, { saved: serverDoc });
      if (!slug && draft.newSlug) setNewSlug(draft.newSlug);
      if (draft.dirty) setNotice("Restored your unsaved draft.");
      return;
    }
    mountDoc(serverDoc ?? { id: slug ?? "untitled", name: slug, nodes: [], edges: [] }, { saved: serverDoc });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opMap, slug, wfData, isNew, template, loadDoc, initTick, mountDoc, navigate, tabKey]);

  // ── Viewport framing (per tab). When this tab's nodes commit, wait — via rAF
  // — until they've actually MEASURED (fitView is a no-op on unmeasured nodes,
  // which is why a plain timeout was flaky on first paint), then restore the
  // tab's saved zoom/pan or fit the graph (never the over-zoomed default).
  // Guarded so a fast tab switch can't apply a stale tab's framing. ──
  useEffect(() => {
    if (loadedFor.current !== tabKey || viewportFor.current === tabKey || !nodes.length) return;
    // Restoring a saved zoom/pan is just a transform — apply it right away (no
    // measurement needed). FITTING needs measured node sizes, so for a first
    // open we poll until the nodes have measured, then fit.
    const saved = readViewport(tabKey);
    if (saved) {
      viewportFor.current = tabKey;
      void rf.setViewport(saved);
      return;
    }
    let timer = 0;
    let tries = 0;
    const fit = () => {
      if (loadedFor.current !== tabKey) return; // a newer tab took over
      const ns = rf.getNodes();
      const measured = ns.length > 0 && ns.every((n) => (n.measured?.width ?? 0) > 0);
      if (!measured && tries++ < 60) {
        timer = window.setTimeout(fit, 50);
        return;
      }
      if (!ns.length) return;
      viewportFor.current = tabKey;
      void rf.fitView({ padding: 0.2 });
    };
    timer = window.setTimeout(fit, 0);
    return () => clearTimeout(timer);
  }, [nodes, tabKey, rf]);

  // ── Persist the canvas continuously (debounced, per tab) — never lost. ──
  useEffect(() => {
    if (loadedFor.current !== tabKey) return; // not initialized
    const t = setTimeout(() => {
      const doc = toDoc(baseDoc.current, nodes, edges);
      const ser = JSON.stringify(doc);
      const dirty = ser !== savedRef.current && (Boolean(slug) || doc.nodes.length > 0);
      writeDraft(tabKey, { slug: slug ?? null, newSlug: newSlug || undefined, doc, dirty, at: Date.now() });
    }, 400);
    return () => clearTimeout(t);
    // `meta` mirrors document-level fields on baseDoc (a ref) — listed so a
    // Workflow-panel edit recomputes dirty.
  }, [nodes, edges, newSlug, slug, tabKey, meta]);

  // ── Dynamic ports (§12): some ops derive ports from node config
  // (core.object.build keys, boundary.manual outputs, flow.sequence count…).
  // The resolvers are server-side functions, so ask admin.doc.ports and
  // refresh the handles; edge-referenced ports stay as fallbacks so a stale
  // wire never loses its handle. Debounced alongside the draft autosave.
  const portsSig = useMemo(
    () =>
      JSON.stringify([
        nodes.map((n) => [n.id, n.data.op, n.data.config]),
        edges.map((e) => [e.source, e.sourceHandle, e.target, e.targetHandle]),
      ]),
    [nodes, edges],
  );
  useEffect(() => {
    if (loadedFor.current !== tabKey) return;
    const t = setTimeout(async () => {
      const [specs, wires] = JSON.parse(portsSig) as [
        Array<[string, string, Record<string, unknown>]>,
        Array<[string, string | null, string, string | null]>,
      ];
      if (specs.length === 0) return;
      try {
        const ports = await api.docPorts({ nodes: specs.map(([id, op, config]) => ({ id, op, config })) });
        setNodes((ns) =>
          ns.map((n) => {
            const p = ports[n.id];
            if (!p) return n;
            const inputs = [...p.inputs];
            const outputs = [...p.outputs];
            for (const [src, srcPort, tgt, tgtPort] of wires) {
              if (tgt === n.id && tgtPort && tgtPort !== "in" && !inputs.some((x) => x.name === tgtPort) && !p.configInputs.some((x) => x.name === tgtPort)) {
                inputs.push({ name: tgtPort, kind: "value" });
              }
              if (src === n.id && srcPort && srcPort !== "out" && !outputs.some((x) => x.name === srcPort) && !p.controlOut.includes(srcPort)) {
                outputs.push({ name: srcPort, kind: "value" });
              }
            }
            const next = { inputs, outputs, configInputs: p.configInputs, controlOuts: p.controlOut };
            const cur = { inputs: n.data.inputs, outputs: n.data.outputs, configInputs: n.data.configInputs, controlOuts: n.data.controlOuts };
            return JSON.stringify(next) === JSON.stringify(cur) ? n : { ...n, data: { ...n.data, ...next } };
          }),
        );
      } catch {
        /* offline / older server — static ports remain */
      }
    }, 350);
    return () => clearTimeout(t);
  }, [portsSig, tabKey, setNodes]);

  /** Write the current canvas to its draft NOW (before leaving, so the last
   *  ≤400ms of edits aren't lost to the debounce). */
  const flushDraft = useCallback(() => {
    if (loadedFor.current !== tabKey) return;
    const doc = toDoc(baseDoc.current, rf.getNodes(), rf.getEdges());
    const dirty = JSON.stringify(doc) !== savedRef.current && (Boolean(slug) || doc.nodes.length > 0);
    writeDraft(tabKey, { slug: slug ?? null, newSlug: newSlug || undefined, doc, dirty, at: Date.now() });
  }, [tabKey, slug, newSlug, rf]);
  // Leaving the editor (another tab, another page) flushes — unless the tab was
  // just closed, in which case its draft is gone on purpose.
  const flushRef = useRef(flushDraft);
  flushRef.current = flushDraft;
  useEffect(
    () => () => {
      if (readTabs().open.includes(tabKey)) flushRef.current();
    },
    [tabKey],
  );

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

  // ── Copy / cut / paste of selected nodes (+ the edges between them). ──

  /** Snapshot the current selection to the shared clipboard. False when empty. */
  const copySelection = useCallback((): boolean => {
    const sel = rf.getNodes().filter((n) => n.selected && n.type !== FRAME_TYPE);
    if (sel.length === 0) return false;
    const ids = new Set(sel.map((n) => n.id));
    const payload: ClipboardPayload = {
      kind: "pattern/nodes@v1",
      nodes: sel.map((n) => ({
        id: n.id,
        op: n.data.op,
        position: n.position,
        config: n.data.config ?? {},
        title: n.data.title,
        comment: n.data.comment,
        pairId: n.data.pairId,
      })),
      edges: rf
        .getEdges()
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => ({ source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle })),
    };
    try {
      localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(payload));
    } catch {
      /* storage full/blocked — clipboard is best-effort */
    }
    sfx.play("click");
    return true;
  }, [rf]);

  /** Cut = copy + the normal delete path (pair expansion, history, sfx). */
  const cutSelection = useCallback((): boolean => {
    if (!copySelection()) return false;
    void rf.deleteElements({ nodes: rf.getNodes().filter((n) => n.selected) });
    return true;
  }, [rf, copySelection]);

  /**
   * Paste the clipboard with fresh ids, keeping the copied layout. Same-canvas
   * pastes land nudged +24/+24 (a visible duplicate); when the copied area is
   * off-screen (typically a paste into ANOTHER workflow), the group anchors to
   * the viewport center instead so it never arrives invisible.
   */
  const pasteClipboard = useCallback(() => {
    let payload: ClipboardPayload | null = null;
    try {
      payload = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) ?? "null") as ClipboardPayload | null;
    } catch {
      /* corrupt clipboard — ignore */
    }
    if (!payload || payload.kind !== "pattern/nodes@v1" || payload.nodes.length === 0) return;
    // Ops are engine-global, but a clipboard can outlive a mod: skip unknowns.
    const known = payload.nodes.filter((n) => opMap.has(n.op));
    if (known.length === 0) {
      sfx.play("invalid");
      return;
    }
    pushHistory();

    // Placement: bounding-box center vs the visible canvas.
    const cx = known.reduce((s, n) => s + n.position.x, 0) / known.length;
    const cy = known.reduce((s, n) => s + n.position.y, 0) / known.length;
    let dx = 24;
    let dy = 24;
    const pane = document.querySelector(".react-flow")?.getBoundingClientRect();
    if (pane) {
      const onScreen = rf.flowToScreenPosition({ x: cx, y: cy });
      const visible = onScreen.x >= pane.left && onScreen.x <= pane.right && onScreen.y >= pane.top && onScreen.y <= pane.bottom;
      if (!visible) {
        const center = rf.screenToFlowPosition({ x: pane.left + pane.width / 2, y: pane.top + pane.height / 2 });
        dx = center.x - cx;
        dy = center.y - cy;
      }
    }

    // Mint ids (keep the original name when free — cross-workflow pastes stay
    // readable), then remap edges and pair links onto the new ids.
    const taken = new Set(rf.getNodes().map((n) => n.id));
    const idMap = new Map<string, string>();
    const newNodes: RFNode<OpNodeData>[] = known.map((n) => {
      const op = opMap.get(n.op)!;
      let id = n.id;
      let i = 1;
      while (taken.has(id)) id = `${n.id}-${++i}`;
      taken.add(id);
      idMap.set(n.id, id);
      return {
        id,
        type: "op",
        position: { x: n.position.x + dx, y: n.position.y + dy },
        selected: true,
        data: {
          op: op.type,
          config: JSON.parse(JSON.stringify(n.config ?? {})) as Record<string, unknown>,
          title: n.title,
          comment: n.comment,
          description: op.description,
          inputs: op.inputs,
          outputs: op.outputs,
          configInputs: op.configInputs ?? [],
          controlOuts: op.controlOut ?? [],
          boundary: op.boundary,
        },
      };
    });
    for (const [i, src] of known.entries()) {
      // Pair links survive only when the partner came along; else drop them
      // (a dangling pairId would make onBeforeDelete chase a ghost).
      const mapped = src.pairId ? idMap.get(src.pairId) : undefined;
      if (mapped) newNodes[i]!.data.pairId = mapped;
    }
    const pastedDoc = toDoc(baseDoc.current, newNodes, []);
    const newEdges: RFEdge[] = payload.edges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e, i) => {
        const source = idMap.get(e.source)!;
        const kind = outputKind(source, e.sourceHandle ?? CONTROL_OUT, pastedDoc, opMap);
        return {
          id: `paste-${Date.now()}-${i}`,
          source,
          sourceHandle: e.sourceHandle,
          target: idMap.get(e.target)!,
          targetHandle: e.targetHandle,
          type: "default",
          animated: kind === "stream",
          style: edgeStyle(kind),
        };
      });

    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...newNodes]);
    setEdges((es) => [...es, ...newEdges]);
    setSelected(newNodes.length === 1 ? newNodes[0]!.id : null);
    sfx.play("add");
  }, [rf, opMap, pushHistory, setNodes, setEdges]);

  // ⌘C/⌘X/⌘V on the canvas — never over text fields or a live text selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "c" && k !== "x" && k !== "v") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if ((k === "c" || k === "x") && window.getSelection()?.isCollapsed === false) return; // copying text, not nodes
      if (k === "c") {
        if (copySelection()) e.preventDefault();
      } else if (k === "x") {
        if (cutSelection()) e.preventDefault();
      } else {
        e.preventDefault();
        pasteClipboard();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelection, cutSelection, pasteClipboard]);

  /** Multi-select clears the single-node inspector (it shows ONE node). */
  const onSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: RFNode<OpNodeData>[] }) => {
      if (sel.length > 1) setSelected(null);
    },
    [],
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
      setDock("inspector");
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
    navigate(editorUrl(d.slug), { replace: true, state: null });
  }, [pendingDraft, navigate]);

  /** Auto-tidy: layered layout, undo-able, then settle the viewport. */
  const onTidy = useCallback(() => {
    pushHistory();
    const layout = tidyLayout(rf.getNodes(), rf.getEdges());
    setNodes((ns) => ns.map((n) => ({ ...n, position: layout.get(n.id) ?? n.position })));
    setTimeout(() => void rf.fitView({ padding: 0.2, duration: 350 }), 50);
    sfx.play("open");
  }, [rf, setNodes, pushHistory]);

  /** Double-click an edge: collapse it into a named PORTAL pair (or restore
   *  the wire). Pure view — the edge stays in the doc; default name = the
   *  source port. */
  const onEdgeDoubleClick = useCallback(
    (_e: React.MouseEvent, edge: RFEdge) => {
      pushHistory();
      setEdges((es) =>
        es.map((x) => {
          if (x.id !== edge.id) return x;
          const isPortal = x.type === PORTAL_TYPE;
          return isPortal
            ? { ...x, type: "default", data: { ...x.data, portal: undefined } }
            : { ...x, type: PORTAL_TYPE, data: { ...x.data, portal: (x.data?.portal as string) ?? x.sourceHandle ?? "value" } };
        }),
      );
      sfx.play("open");
    },
    [setEdges, pushHistory],
  );

  /** A frame around the selection (with padding), or a default box at the center. */
  const onAddFrame = useCallback(() => {
    pushHistory();
    const sel = rf.getNodes().filter((n) => n.selected && n.type !== FRAME_TYPE);
    let rect: { x: number; y: number; w: number; h: number };
    if (sel.length) {
      const xs = sel.map((n) => n.position.x);
      const ys = sel.map((n) => n.position.y);
      const xe = sel.map((n) => n.position.x + (n.measured?.width ?? 180));
      const ye = sel.map((n) => n.position.y + (n.measured?.height ?? 100));
      rect = {
        x: Math.min(...xs) - 28,
        y: Math.min(...ys) - 44, // headroom for the label
        w: Math.max(...xe) - Math.min(...xs) + 56,
        h: Math.max(...ye) - Math.min(...ys) + 72,
      };
    } else {
      const c = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      rect = { x: c.x - 240, y: c.y - 140, w: 480, h: 280 };
    }
    setNodes((ns) => [makeFrameNode(rect), ...ns.map((n) => ({ ...n, selected: false }))]);
    sfx.play("open");
  }, [rf, setNodes, pushHistory]);

  const currentDoc = (): WorkflowDoc => {
    const targetSlug = slug ?? (newSlug || "untitled");
    return { ...toDoc(baseDoc.current, nodes, edges), id: targetSlug, name: baseDoc.current.name ?? targetSlug };
  };

  /** After a successful save the canvas doc IS the base — keep the ref in sync
   *  so later `currentDoc()` calls carry the saved identity/metadata, and move
   *  a brand-new workflow onto its real URL (its tab becomes the slug's tab). */
  const adoptSaved = (doc: WorkflowDoc) => {
    baseDoc.current = doc;
    setMeta(metaOf(doc));
    savedRef.current = JSON.stringify(doc);
    writeDraft(doc.id, { slug: doc.id, doc, dirty: false, at: Date.now() });
    if (isNew) {
      removeDraft(NEW_KEY);
      renameTab(NEW_KEY, doc.id);
      loadedFor.current = doc.id; // canvas already shows this doc — don't reload
      navigate(editorUrl(doc.id), { replace: true });
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
    // Errors block the save; warnings ride along (the server still versioned it).
    const blocked = hasErrors(res.issues);
    if (!blocked) adoptSaved(doc);
    setNotice(blocked ? `${issueSummary(res.issues)} — fix before saving` : `Saved ${res.version?.id}${res.issues.length ? ` (${issueSummary(res.issues)})` : ""}. Deploy to activate.`);
    sfx.play(blocked ? "invalid" : "save");
  };

  /** Step one of Deploy: say what changes (live doc → this canvas). Nothing moves. */
  const onDeploy = () => {
    if (isNew && !newSlug) {
      setNotice("Enter a slug to save the new workflow.");
      return;
    }
    setDeployPlan(deployPreview(wfData?.liveDoc ?? null, currentDoc(), opMap));
  };
  /** Step two: save the canvas as a version, then make that version live. */
  const doDeploy = async () => {
    const doc = currentDoc();
    setDeployPlan(null);
    const saved = await save.mutateAsync({ slug: doc.id, doc, note: "deploy" });
    setIssues(saved.issues);
    if (hasErrors(saved.issues)) {
      setNotice(`${issueSummary(saved.issues)} — fix before deploying.`);
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
    if (hasErrors(res.issues)) {
      setIssues(res.issues);
      setNotice(`${issueSummary(res.issues)} — fix before forking.`);
      sfx.play("invalid");
      return;
    }
    setForkOpen(false);
    flushDraft(); // the source tab keeps its state
    writeDraft(id, { slug: id, doc, dirty: false, at: Date.now() });
    loadedFor.current = null;
    navigate(editorUrl(id)); // opens as its own tab
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
      setMeta(metaOf(baseDoc.current));
      if (isNew && !newSlug && doc.id) setNewSlug(doc.id.replace(/[^a-z0-9.\-_]/gi, ""));
      setSelected(null);
      // Flag ops this project doesn't have. The import still lands (the graph is
      // visible, missing nodes included), but they're called out and block Save
      // until resolved — never a silent import of an unrunnable workflow.
      const unknownNodes = opMap.size ? doc.nodes.filter((n) => !opMap.has(n.op)) : [];
      const missing = [...new Set(unknownNodes.map((n) => n.op))];
      if (missing.length) {
        setIssues(unknownNodes.map((n) => ({ nodeId: n.id, code: "unknown_op", message: `unknown op "${n.op}" — not installed in this project` })));
        setNotice(`Imported "${doc.id}", but ${missing.length === 1 ? "this op isn't" : "these ops aren't"} installed: ${missing.join(", ")}. Add the mod(s) that provide them, or remove those nodes.`);
        sfx.play("error");
      } else {
        setIssues([]);
        setNotice(`Imported "${doc.id}" — Save to persist it.`);
        sfx.play("add");
      }
    } catch (err) {
      setNotice(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      sfx.play("error");
    }
  };

  const selectedNode = nodes.find((n) => n.id === selected);
  const isCode = wfData?.meta?.source === "code";
  const newestVersion = wfData?.meta?.versions[wfData.meta.versions.length - 1]?.id;

  if (isLoading && !isNew) return <Spinner />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar — the title, badges, and deployment state live in the workspace header above. */}
      <div className="mb-3 flex items-center gap-2">
        {isNew && (
          <input
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value.replace(/[^a-z0-9.\-_]/gi, ""))}
            placeholder="workflow-slug"
            aria-label="Slug for the new workflow"
            title="The workflow's id — lowercase, dots, dashes. Required to save."
            className="glass rounded-lg px-3 py-1.5 font-mono text-sm outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
          />
        )}
        {notice && <span className="text-muted min-w-0 max-w-xl truncate text-xs">{notice}</span>}
        <div className="ml-auto flex items-center gap-2">
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
          <NeonButton
            variant="ghost"
            className="!px-2"
            aria-label="Add a frame"
            title="Frame: a named box around the selection (visual only)"
            onClick={onAddFrame}
          >
            <Frame size={14} />
          </NeonButton>
          {/* For a read-only code workflow, Fork IS the primary action. */}
          <NeonButton
            variant={isCode ? "solid" : "ghost"}
            className={isCode ? undefined : "!px-2"}
            aria-label="Fork to a new slug"
            title={isCode ? "Fork — copy this read-only workflow to a slug you own" : "Fork to a new slug"}
            onClick={() => {
              setForkSlug(slug ? `${slug}-fork` : newSlug ? `${newSlug}-fork` : "");
              setForkOpen(true);
            }}
            disabled={nodes.length === 0}
          >
            <GitFork size={14} />
            {isCode ? " Fork to edit" : null}
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
          <NeonButton
            variant="ghost"
            className="!px-2"
            aria-label="View workflow JSON"
            title="View the JSON of the canvas as it is right now (unsaved state included)"
            onClick={() => setJsonOpen(true)}
            disabled={nodes.length === 0}
          >
            <Braces size={14} />
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
          <NeonButton
            variant="ghost"
            className="!px-2"
            aria-label="Workflow settings"
            title={`Workflow settings (name, durable, offload)${meta.offload ? " — Offload on" : cpuHeavyCount > 0 ? " — Offload recommended" : ""}${meta.durable ? " — Durable on" : ""}`}
            onClick={() => {
              setSelected(null);
              showDock("inspector");
            }}
          >
            <SlidersHorizontal size={14} />
            {(meta.offload || meta.durable || cpuHeavyCount > 0) && (
              <span
                aria-hidden
                className={`ml-1 inline-block h-1.5 w-1.5 rounded-full ${meta.offload || meta.durable ? "bg-[var(--color-neon-cyan)]" : "bg-[var(--color-neon-amber)]"}`}
              />
            )}
          </NeonButton>
          {buddyAvailable && (
            <NeonButton
              variant="ghost"
              className="!px-2"
              aria-label={dock === "buddy" ? "Show the inspector" : "Open Buddy"}
              title={dock === "buddy" ? "Back to the inspector" : "Buddy — describe a workflow, get it drafted on your canvas"}
              onClick={() => showDock(dock === "buddy" ? "inspector" : "buddy")}
            >
              <Sparkles size={14} className={dock === "buddy" ? "text-[var(--color-neon-cyan)]" : undefined} />
            </NeonButton>
          )}
          <NeonButton variant="ghost" onClick={() => setRunOpen(true)} disabled={nodes.length === 0}>
            <Play size={14} /> Run
          </NeonButton>
          {/* Save/Deploy don't exist for read-only code workflows — fork instead. */}
          {!isCode && (
            <>
              <NeonButton variant="ghost" onClick={onSave} disabled={save.isPending} title="Save the canvas as a new version (not live until deployed)">
                Save
              </NeonButton>
              <NeonButton onClick={onDeploy} disabled={deploy.isPending || save.isPending} title="Save the canvas as a new version and make it live — shows what changes first">
                <Rocket size={14} /> Deploy
              </NeonButton>
            </>
          )}
        </div>
      </div>

      <div
        className="relative grid min-h-0 flex-1 gap-0"
        style={{ gridTemplateColumns: `${paletteOpen ? panes.l : PALETTE_RAIL_PX}px 10px 1fr 10px ${panes.r}px` }}
      >
        {/* Palette — searchable, drag onto the canvas; collapses to a rail */}
        <Palette ops={opsData ?? []} open={paletteOpen} onToggle={togglePalette} />

        {paletteOpen ? <PaneGrip onPointerDown={dragPane("l")} label="Resize palette" /> : <div aria-hidden />}

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
            onNodeDragStart={(_e, n) => {
              pushHistory();
              // A frame drags its CONTENTS: snapshot which op nodes sit inside
              // it (by center point) + their positions, replayed per move.
              if (n.type === FRAME_TYPE) {
                const w = n.width ?? n.measured?.width ?? 0;
                const h = n.height ?? n.measured?.height ?? 0;
                const inside = rf.getNodes().filter((m) => {
                  if (m.id === n.id || m.type === FRAME_TYPE || m.selected) return false;
                  const mw = m.measured?.width ?? 0;
                  const mh = m.measured?.height ?? 0;
                  const cx = m.position.x + mw / 2;
                  const cy = m.position.y + mh / 2;
                  return cx >= n.position.x && cx <= n.position.x + w && cy >= n.position.y && cy <= n.position.y + h;
                });
                frameDrag.current = {
                  frameId: n.id,
                  start: { ...n.position },
                  carried: new Map(inside.map((m) => [m.id, { ...m.position }])),
                };
              } else {
                frameDrag.current = null;
              }
            }}
            onNodeDrag={(_e, n) => {
              const fd = frameDrag.current;
              if (!fd || n.id !== fd.frameId) return;
              const dx = n.position.x - fd.start.x;
              const dy = n.position.y - fd.start.y;
              setNodes((ns) =>
                ns.map((m) => {
                  const orig = fd.carried.get(m.id);
                  return orig ? { ...m, position: { x: orig.x + dx, y: orig.y + dy } } : m;
                }),
              );
            }}
            onNodeDragStop={() => {
              frameDrag.current = null;
            }}
            // Selecting a node brings the Inspector forward in the shared dock.
            onNodeClick={(_e, n) => {
              setSelected(n.id);
              setDock("inspector");
            }}
            onEdgeDoubleClick={onEdgeDoubleClick}
            edgeTypes={edgeTypes}
            onPaneClick={() => setSelected(null)}
            // Remember each tab's framing — restored on switch-back (see effect).
            onMoveEnd={(_e, vp) => {
              if (loadedFor.current === tabKey) writeViewport(tabKey, vp);
            }}
            // Marquee: Shift+drag draws a selection rectangle (drag alone still
            // pans); touching a node is enough to take it (Partial). The
            // inspector shows ONE node — clear it when a box grabs several.
            selectionMode={SelectionMode.Partial}
            onSelectionChange={onSelectionChange}
            nodeTypes={nodeTypes}
            // Initial framing is handled per-tab by the viewport effect (restore
            // saved zoom/pan, else fit) — not xyflow's one-shot fitView.
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={22} size={1.6} color="var(--canvas-dot)" />
            <Controls />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => {
                if (n.type === FRAME_TYPE) return "color-mix(in srgb, var(--fg) 12%, transparent)";
                const d = n.data as OpNodeData;
                return d?.boundary ? "#22d3ee" : categoryStyle(categoryOfType(d.op)).color;
              }}
              nodeStrokeWidth={0}
            />
          </ReactFlow>
        </GlassPanel>

        <PaneGrip onPointerDown={dragPane("r")} label="Resize the side panel" />

        {/* The dock — Inspector | Buddy. Stretches over the whole editor in focus mode. */}
        <GlassPanel className={`flex min-h-0 flex-col overflow-hidden ${inspectorWide ? "absolute inset-0 z-20" : ""}`}>
          <div className="flex items-center gap-1 border-b hairline px-2 py-1.5" role="tablist" aria-label="Side panel">
            <button
              type="button"
              role="tab"
              aria-selected={dock === "inspector"}
              onClick={() => showDock("inspector")}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${dock === "inspector" ? "bg-white/10 text-[var(--fg)]" : "text-muted hover:text-[var(--fg)]"}`}
            >
              {selectedNode ? "Inspector" : "Workflow"}
            </button>
            {buddyAvailable && (
              <button
                type="button"
                role="tab"
                aria-selected={dock === "buddy"}
                onClick={() => showDock("buddy")}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${dock === "buddy" ? "bg-white/10 text-[var(--fg)]" : "text-muted hover:text-[var(--fg)]"}`}
              >
                <Sparkles size={11} className={dock === "buddy" ? "text-[var(--color-neon-cyan)]" : undefined} /> Buddy
              </button>
            )}
            <button
              type="button"
              aria-label={inspectorWide ? "Shrink the side panel" : "Stretch the side panel over the canvas"}
              {...tip(inspectorWide ? "Back to the canvas" : "Stretch — more room for configs")}
              className="text-muted ml-auto rounded p-1 hover:bg-white/10 hover:text-[var(--fg)]"
              onClick={() => {
                setInspectorWide((w) => !w);
                sfx.play(inspectorWide ? "close" : "open");
              }}
            >
              {inspectorWide ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </div>

          {/* Inspector: the selected node, or the workflow itself. */}
          <div hidden={dock !== "inspector"} className="min-h-0 flex-1 overflow-y-auto p-4">
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
                  onMeta={(m) => {
                    pushHistoryBurst();
                    setNodes((ns) => ns.map((n) => (n.id === selectedNode.id ? { ...n, data: { ...n.data, ...m } } : n)));
                  }}
                />
              ) : (
                <WorkflowPanel
                  doc={{ id: slug ?? newSlug ?? "untitled", name: meta.name, description: meta.description, tags: meta.tags, offload: meta.offload, durable: meta.durable }}
                  isNew={isNew}
                  readOnly={Boolean(isCode)}
                  cpuHeavyCount={cpuHeavyCount}
                  onChange={applyMeta}
                />
              )}
              {nodes.length === 0 && !selectedNode && (
                <p className="text-muted mt-5 text-xs">
                  Drag an op from the palette onto the canvas to add it; drag between ports to connect (ports refuse incompatible types).
                  {buddyAvailable ? " Or describe the workflow to Buddy." : ""}
                </p>
              )}
              {issues.length > 0 && (
                <div className="mt-5">
                  <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">
                    {hasErrors(issues) ? "Problems" : "Warnings"}
                  </div>
                  {issues.map((iss, i) => (
                    <div key={i} className="mb-1.5 text-xs">
                      <span className={`mr-1 ${isWarning(iss) ? "text-[var(--color-neon-amber)]" : "text-[var(--color-neon-pink)]"}`}>
                        {isWarning(iss) ? "⚠" : "✗"}
                      </span>
                      <span className="font-mono text-muted">{iss.nodeId ?? ""}</span> {iss.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Buddy stays mounted while hidden so a running turn keeps streaming. */}
          {buddyAvailable && (
            <div hidden={dock !== "buddy"} className="flex min-h-0 flex-1 flex-col">
              <BuddyDock slug={slug} getDoc={currentDoc} onApply={applyBuddyDoc} onClose={() => showDock("inspector")} chrome={false} />
            </div>
          )}
        </GlassPanel>
      </div>

      {runOpen && <RunPanel open={runOpen} onClose={() => setRunOpen(false)} doc={currentDoc()} opMap={opMap} />}

      {/* Deploy: what changes, then save + move the pointer. */}
      <DeployPreviewModal
        open={deployPlan !== null}
        onClose={() => setDeployPlan(null)}
        onDeploy={() => void doDeploy()}
        preview={deployPlan}
        slug={slug ?? newSlug}
        version="a new version"
        busy={deploy.isPending || save.isPending}
        note={`Deploy saves the canvas as ${newestVersion ? "the version after " + newestVersion : "the first version"}, then makes it live.`}
      />

      {/* The canvas AS JSON — exactly what Save would persist, dirty state included. */}
      {jsonOpen && (
        <Modal open onClose={() => setJsonOpen(false)} title={`${currentDoc().id}.json — live canvas`} wide>
          <div className="space-y-3">
            <JsonView value={currentDoc()} className="max-h-[60vh]" />
            <div className="flex justify-end gap-2">
              <NeonButton
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(JSON.stringify(currentDoc(), null, 2));
                  sfx.play("ok");
                }}
              >
                Copy JSON
              </NeonButton>
              <NeonButton variant="ghost" onClick={onExport}>
                <Download size={13} /> Download
              </NeonButton>
            </div>
          </div>
        </Modal>
      )}

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

      {/* Unsaved-draft guard: an explicit doc (template / "edit vN") would
          clobber this tab's dirty draft. Closing = the non-destructive choice. */}
      <Modal open={pendingDraft !== null} onClose={() => resumeDraft()} title="Unsaved draft">
        {pendingDraft && (
          <div className="space-y-4">
            <p className="text-sm">
              This workflow has unsaved changes in{" "}
              <span className="font-mono">{pendingDraft.slug ?? pendingDraft.newSlug ?? pendingDraft.doc.id ?? "a new workflow"}</span>. Loading{" "}
              {locState?.note ? <span className="font-mono">{locState.note}</span> : "this document"} over it will discard them.
            </p>
            <div className="flex justify-end gap-2">
              <NeonButton variant="ghost" onClick={resumeDraft}>
                Resume my draft
              </NeonButton>
              <NeonButton
                variant="danger"
                onClick={() => {
                  removeDraft(tabKey);
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

export function EditorPage() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}
