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
  type Viewport,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
  type OnBeforeDelete,
} from "@xyflow/react";
import type { OpInfo, ValidationIssue, WorkflowDoc } from "@pattern-js/admin-sdk";
import { hasErrors, isWarning, issueSummary } from "../lib/issues";
import { api } from "../lib/api";
import { useDeploy, useManifest, useOps, useSaveWorkflow, useWorkflow, useWorkflows } from "../lib/queries";
import { BuddyDock } from "../editor/BuddyDock";
import { OpNode } from "../editor/OpNode";
import { FrameNode } from "../editor/FrameNode";
import { PortalEdge } from "../editor/PortalEdge";
import { FlowEdge } from "../editor/FlowEdge";
import { RunPanel } from "../editor/RunPanel";
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
import { Badge, GlassPanel, JsonView, Modal, NeonButton, Spinner } from "../components/ui";
import { FormFromSchema, RawJson, type FieldOverride } from "../components/FormFromSchema";
import { SchemaBuilder } from "../components/SchemaBuilder";
import { RequireAuthField } from "../editor/RequireAuthField";
import { Markdown } from "../components/Markdown";
import { tip } from "../components/Tooltip";
import { Rocket, Play, Redo2, Undo2, Download, Upload, Search, Wand2, History, GitFork, Maximize2, Minimize2, Frame } from "../components/icon";
import { Braces, Lock, Settings, Cpu, Database, Sparkles } from "lucide-react";
import { categoryOfType, categoryStyle, humanizeOp, paletteLabel } from "../lib/categories";
import { schemaTypeOf } from "../lib/format";
import { fuzzyFilter } from "../lib/fuzzy";
import { sfx } from "../lib/sfx";

const nodeTypes = { op: OpNode, frame: FrameNode };
// `default` overrides xyflow's built-in wire so normal edges highlight on
// port-hover (FlowEdge); portaled edges keep their glyph renderer.
const edgeTypes = { portal: PortalEdge, default: FlowEdge };

/** MIME type carrying an op across the palette→canvas drag. */
const DND_TYPE = "application/x-pattern-op";

// ── Editor persistence (localStorage) — TABS: one draft per open workflow. ──
const PANES_KEY = "pattern.admin.editor.panes";
const TABS_KEY = "pattern.admin.editor.tabs";
const DRAFT_PREFIX = "pattern.admin.editor.draft.";
/** The tab key of an unsaved brand-new workflow (at most one at a time). */
const NEW_KEY = "__new__";
/** Pre-tabs single-draft key — migrated on first load. */
const LEGACY_DRAFT_KEY = "pattern.admin.editor.draft";

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

/** One tab's canvas, continuously persisted so closing/switching never loses
 *  work. `slug` is null for a brand-new workflow; `dirty` = differs from the
 *  last saved version (drives the dot + discard guard). */
interface EditorDraft {
  slug: string | null;
  newSlug?: string;
  doc: WorkflowDoc;
  dirty: boolean;
  at: number;
}

interface EditorTabs {
  open: string[];
  /** Where the editor was last — plain /editor reopens here. */
  last?: string;
}

const draftKeyOf = (slug: string | null): string => slug ?? NEW_KEY;

function readDraft(key: string): EditorDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    const d = raw ? (JSON.parse(raw) as EditorDraft) : null;
    return d && Array.isArray(d.doc?.nodes) ? d : null;
  } catch {
    return null;
  }
}
function writeDraft(key: string, d: EditorDraft | null): void {
  try {
    if (d) localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    /* storage full/blocked — drafts are best-effort */
  }
}
const removeDraft = (key: string): void => writeDraft(key, null);

// ── Per-tab viewport (zoom + pan). Persisted so switching back to a tab — or
// reloading — restores exactly where you left off, instead of snapping to the
// default. Absent (first open of a workflow) ⇒ the editor fits the graph. ──
const VIEWPORT_PREFIX = "pattern.admin.editor.viewport.";
function readViewport(key: string): Viewport | null {
  try {
    const raw = localStorage.getItem(VIEWPORT_PREFIX + key);
    const v = raw ? (JSON.parse(raw) as Viewport) : null;
    return v && Number.isFinite(v.zoom) ? v : null;
  } catch {
    return null;
  }
}
function writeViewport(key: string, v: Viewport): void {
  try {
    localStorage.setItem(VIEWPORT_PREFIX + key, JSON.stringify(v));
  } catch {
    /* best-effort */
  }
}
const removeViewport = (key: string): void => {
  try {
    localStorage.removeItem(VIEWPORT_PREFIX + key);
  } catch {
    /* best-effort */
  }
};

function readTabs(): EditorTabs {
  migrateLegacyDraft();
  try {
    const t = JSON.parse(localStorage.getItem(TABS_KEY) ?? "") as EditorTabs;
    if (Array.isArray(t.open)) return { open: t.open.filter((k) => typeof k === "string"), last: t.last };
  } catch {
    /* default below */
  }
  return { open: [] };
}
function writeTabs(t: EditorTabs): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(t));
  } catch {
    /* best-effort */
  }
}

/** One-time migration of the pre-tabs single draft into its own tab. */
function migrateLegacyDraft(): void {
  try {
    const raw = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw) as EditorDraft;
    if (d && Array.isArray(d.doc?.nodes)) {
      const key = draftKeyOf(d.slug);
      localStorage.setItem(DRAFT_PREFIX + key, raw);
      const t = JSON.parse(localStorage.getItem(TABS_KEY) ?? '{"open":[]}') as EditorTabs;
      if (!t.open.includes(key)) t.open.push(key);
      t.last = key;
      localStorage.setItem(TABS_KEY, JSON.stringify(t));
    }
    localStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    /* best-effort */
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
  /** Live while a frame is being dragged: the op nodes it carries. */
  const frameDrag = useRef<{ frameId: string; start: { x: number; y: number }; carried: Map<string, { x: number; y: number }> } | null>(null);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [newSlug, setNewSlug] = useState("");
  const [runOpen, setRunOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Workflow-level Offload flag (mirrors baseDoc.current.offload for the UI). */
  const [offload, setOffload] = useState(false);
  /** Workflow-level Durable flag (mirrors baseDoc.current.durable for the UI). */
  const [durable, setDurable] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [forkSlug, setForkSlug] = useState("");
  /** Inspector stretched over the whole editor (focus mode for big configs). */
  const [inspectorWide, setInspectorWide] = useState(false);
  /** An explicit doc (template / "edit vN") over a dirty draft asks first. */
  const [pendingDraft, setPendingDraft] = useState<EditorDraft | null>(null);
  const [initTick, setInitTick] = useState(0);

  /** Canvas nodes whose op is `cpuHeavy` — the Offload nudge counts these. */
  const cpuHeavyCount = useMemo(
    () => nodes.filter((n) => n.type !== FRAME_TYPE && opMap.get(n.data.op)?.cpuHeavy).length,
    [nodes, opMap],
  );

  // ── Tabs: every workflow you open stays open (per-tab drafts). ──
  const tabKey = slug ?? NEW_KEY;
  const [tabs, setTabs] = useState<string[]>(() => readTabs().open);
  const [dirtyMap, setDirtyMap] = useState<Record<string, { dirty: boolean; newSlug?: string }>>({});
  const [closingTab, setClosingTab] = useState<string | null>(null);

  /** Re-read every tab's draft state (dots + new-tab label). */
  const refreshDirty = useCallback((keys: string[]) => {
    const m: Record<string, { dirty: boolean; newSlug?: string }> = {};
    for (const k of keys) {
      const d = readDraft(k);
      m[k] = { dirty: Boolean(d?.dirty), newSlug: d?.newSlug };
    }
    setDirtyMap(m);
  }, []);

  // The tab being viewed is always an open tab; remember it as `last`.
  useEffect(() => {
    setTabs((prev) => {
      const next = prev.includes(tabKey) ? prev : [...prev, tabKey];
      writeTabs({ open: next, last: tabKey });
      refreshDirty(next);
      return next;
    });
    setNotice(null); // a stale notice from another tab would mislead
  }, [tabKey, refreshDirty]);
  const baseDoc = useRef<WorkflowDoc>({ id: slug ?? "untitled", nodes: [], edges: [] });
  /** Normal-form snapshot of the last *saved* doc (dirty = current ≠ this). */
  const savedRef = useRef<string>("__unsaved__");
  const loadedFor = useRef<string | null>(null);
  /** Tab whose framing we've already applied (re-applied on tab switch). */
  const viewportFor = useRef<string | null>(null);
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

  // ── Buddy dock: shown when mod-buddy is installed (manifest carries its command). ──
  const { data: uiManifest } = useManifest();
  const buddyAvailable = Boolean(uiManifest?.commands?.some((c) => c.id === "buddy.open"));
  const [buddyOpen, setBuddyOpen] = useState(false);
  /** Apply a Buddy proposal to the OPEN canvas: undoable (⌘Z), marks dirty — Save/Deploy stay manual. */
  const applyBuddyDoc = useCallback(
    (doc: WorkflowDoc) => {
      pushHistory();
      const flow = buildFlow(doc, opMap);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      baseDoc.current = { ...baseDoc.current, name: doc.name ?? baseDoc.current.name, description: doc.description ?? baseDoc.current.description };
    },
    [opMap, pushHistory, setNodes, setEdges],
  );

  /** Load a doc onto the canvas + reset history; `saved` sets the dirty baseline. */
  const mountDoc = useCallback(
    (doc: WorkflowDoc, opts: { saved: WorkflowDoc | null }) => {
      baseDoc.current = doc;
      setOffload(doc.offload === true);
      setDurable(doc.durable === true);
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

  // ── Initialize the canvas (once per tab, after ops + workflow load).
  // Priority: an explicit doc (template / "edit from version") asks first if
  // it would clobber this tab's dirty draft; then the tab's own draft — every
  // tab reopens exactly where you left it; then the server doc.
  useEffect(() => {
    if (!opMap.size) return;
    if (!isNew && !wfData) return;
    if (loadedFor.current === tabKey) return;

    const serverDoc = wfData?.latestDoc ?? wfData?.liveDoc ?? null;
    const draft = readDraft(tabKey);
    const explicit = template ?? loadDoc;
    const wantsNewTab = Boolean((locState as { newTab?: boolean } | null)?.newTab);

    // Plain /editor visit → reopen where you were (the last active tab). The
    // "+" tab button passes state.newTab to genuinely open the new-workflow tab.
    if (!slug && !explicit && !wantsNewTab && !draft?.doc.nodes.length) {
      const last = readTabs().last;
      if (last && last !== NEW_KEY) {
        loadedFor.current = null;
        navigate(`/editor/${last}`, { replace: true });
        return;
      }
    }

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
    if (draft) {
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
      setDirtyMap((m) => (m[tabKey]?.dirty === dirty && m[tabKey]?.newSlug === (newSlug || undefined) ? m : { ...m, [tabKey]: { dirty, newSlug: newSlug || undefined } }));
    }, 400);
    return () => clearTimeout(t);
    // `offload`/`durable` are metadata on baseDoc (a ref), so list them explicitly
    // to recompute dirty when the Workflow-settings toggles flip them.
  }, [nodes, edges, newSlug, slug, tabKey, offload, durable]);

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

  /** Write the current canvas to its draft NOW (used before switching tabs,
   *  so the last ≤400ms of edits aren't lost to the debounce). */
  const flushDraft = useCallback(() => {
    if (loadedFor.current !== tabKey) return;
    const doc = toDoc(baseDoc.current, rf.getNodes(), rf.getEdges());
    const dirty = JSON.stringify(doc) !== savedRef.current && (Boolean(slug) || doc.nodes.length > 0);
    writeDraft(tabKey, { slug: slug ?? null, newSlug: newSlug || undefined, doc, dirty, at: Date.now() });
  }, [tabKey, slug, newSlug, rf]);

  /** Switch tabs: flush this canvas, then navigate (init loads the target's draft). */
  const switchTab = useCallback(
    (key: string) => {
      if (key === tabKey) return;
      flushDraft();
      sfx.play("nav");
      navigate(key === NEW_KEY ? "/editor" : `/editor/${key}`, key === NEW_KEY ? { state: { newTab: true } } : undefined);
    },
    [tabKey, flushDraft, navigate],
  );

  /** Close a tab (dirty ones confirm via modal first). */
  const doCloseTab = useCallback(
    (key: string) => {
      removeDraft(key);
      removeViewport(key);
      setClosingTab(null);
      setTabs((prev) => {
        const idx = prev.indexOf(key);
        const next = prev.filter((k) => k !== key);
        if (key === tabKey) {
          const neighbor = next[idx - 1] ?? next[idx] ?? null;
          loadedFor.current = null;
          if (neighbor) {
            writeTabs({ open: next, last: neighbor });
            navigate(neighbor === NEW_KEY ? "/editor" : `/editor/${neighbor}`, neighbor === NEW_KEY ? { state: { newTab: true } } : undefined);
          } else {
            // Last tab closed → a fresh new-workflow tab.
            const fresh = [NEW_KEY];
            writeTabs({ open: fresh, last: NEW_KEY });
            setNewSlug("");
            navigate("/editor", { state: { newTab: true } });
            setInitTick((t) => t + 1);
            return fresh;
          }
        } else {
          writeTabs({ open: next, last: tabKey });
        }
        return next;
      });
      sfx.play("delete");
    },
    [tabKey, navigate],
  );
  const requestCloseTab = useCallback(
    (key: string) => {
      if (key === tabKey) flushDraft();
      const d = readDraft(key);
      if (d?.dirty) setClosingTab(key);
      else doCloseTab(key);
    },
    [tabKey, flushDraft, doCloseTab],
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
   *  a brand-new workflow onto its real URL. */
  const adoptSaved = (doc: WorkflowDoc) => {
    baseDoc.current = doc;
    savedRef.current = JSON.stringify(doc);
    writeDraft(doc.id, { slug: doc.id, doc, dirty: false, at: Date.now() });
    setDirtyMap((m) => ({ ...m, [doc.id]: { dirty: false } }));
    if (isNew) {
      // The new-workflow tab becomes the saved slug's tab.
      removeDraft(NEW_KEY);
      setTabs((prev) => {
        const next = prev.map((k) => (k === NEW_KEY ? doc.id : k)).filter((k, i, a) => a.indexOf(k) === i);
        writeTabs({ open: next, last: doc.id });
        return next;
      });
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
    // Errors block the save; warnings ride along (the server still versioned it).
    const blocked = hasErrors(res.issues);
    if (!blocked) adoptSaved(doc);
    setNotice(blocked ? `${issueSummary(res.issues)} — fix before saving` : `Saved ${res.version?.id}${res.issues.length ? ` (${issueSummary(res.issues)})` : ""}. Deploy to activate.`);
    sfx.play(blocked ? "invalid" : "save");
  };

  const onDeploy = async () => {
    const doc = currentDoc();
    if (isNew && !newSlug) {
      setNotice("Enter a slug to save the new workflow.");
      return;
    }
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
    navigate(`/editor/${id}`); // opens as its own tab
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

  if (isLoading && !isNew) return <Spinner />;

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="text-xl font-semibold">{isNew ? "New workflow" : slug}</h1>
        {wfData?.meta && <Badge hue={wfData.meta.source === "code" ? 200 : 150}>{wfData.meta.source}</Badge>}
        {isCode && (
          <span
            className="flex items-center gap-1 rounded-full bg-[var(--color-neon-amber)]/15 px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-neon-amber)]"
            title="Shipped by a mod — it can't be saved or deployed from here. Fork it to make it yours."
          >
            <Lock size={11} /> read-only
          </span>
        )}
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
          <NeonButton
            variant="ghost"
            className="!px-2"
            aria-label="Add a frame"
            title="Frame: a named box around the selection (visual only)"
            onClick={onAddFrame}
          >
            <Frame size={14} />
          </NeonButton>
          {slug && !isCode && (
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
          <NeonButton
            variant="ghost"
            className="!px-2"
            aria-label="Workflow settings"
            title={`Workflow settings${offload ? " — Offload on" : cpuHeavyCount > 0 ? " — Offload recommended" : ""}`}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={14} />
            {(offload || cpuHeavyCount > 0) && (
              <span
                aria-hidden
                className={`ml-1 inline-block h-1.5 w-1.5 rounded-full ${offload ? "bg-[var(--color-neon-cyan)]" : "bg-[var(--color-neon-amber)]"}`}
              />
            )}
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
          {buddyAvailable && (
            <NeonButton
              variant="ghost"
              className="!px-2"
              aria-label={buddyOpen ? "Close Buddy" : "Open Buddy"}
              title={buddyOpen ? "Close Buddy" : "Buddy — describe a workflow, get it drafted on your canvas"}
              onClick={() => {
                setBuddyOpen((o) => !o);
                sfx.play(buddyOpen ? "close" : "open");
              }}
            >
              <Sparkles size={14} className={buddyOpen ? "text-[var(--color-neon-cyan)]" : undefined} />
            </NeonButton>
          )}
          <NeonButton variant="ghost" onClick={() => setRunOpen(true)} disabled={nodes.length === 0}>
            <Play size={14} /> Run
          </NeonButton>
          {/* Save/Deploy don't exist for read-only code workflows — fork instead. */}
          {!isCode && (
            <>
              <NeonButton variant="ghost" onClick={onSave} disabled={save.isPending}>
                Save
              </NeonButton>
              <NeonButton onClick={onDeploy} disabled={deploy.isPending}>
                <Rocket size={14} /> Deploy
              </NeonButton>
            </>
          )}
        </div>
      </div>

      {/* Tabs — every open workflow keeps its own draft; dot = unsaved. */}
      <div className="mb-2 flex items-center gap-1 overflow-x-auto">
        {tabs.map((k) => {
          const active = k === tabKey;
          const d = dirtyMap[k];
          const label = k === NEW_KEY ? `✦ ${(active ? newSlug : d?.newSlug) || "new"}` : k;
          return (
            <div
              key={k}
              role="tab"
              aria-selected={active}
              onClick={() => switchTab(k)}
              title={k === NEW_KEY ? "New workflow (unsaved)" : k}
              className={`group flex max-w-56 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                active
                  ? "border-[var(--color-neon-cyan)]/40 bg-white/10 text-[var(--fg)]"
                  : "hairline text-muted bg-transparent hover:bg-white/5 hover:text-[var(--fg)]"
              }`}
            >
              <span className="truncate font-mono">{label}</span>
              {(active ? undefined : d?.dirty) || (active && d?.dirty) ? (
                <span aria-label="unsaved changes" title="Unsaved changes" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-neon-amber)]" />
              ) : null}
              <button
                type="button"
                aria-label={`Close ${label}`}
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  requestCloseTab(k);
                }}
                className="text-muted -mr-1 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 hover:text-[var(--fg)]"
              >
                ✕
              </button>
            </div>
          );
        })}
        <button
          type="button"
          aria-label="New workflow tab"
          title="New workflow tab"
          onClick={() => switchTab(NEW_KEY)}
          className="text-muted shrink-0 rounded-lg border hairline px-2.5 py-1.5 text-xs hover:bg-white/5 hover:text-[var(--fg)]"
        >
          +
        </button>
      </div>

      <div
        className="relative grid min-h-0 flex-1 gap-0"
        style={{ gridTemplateColumns: `${panes.l}px 10px 1fr 10px ${panes.r}px${buddyOpen ? " 10px 400px" : ""}` }}
      >
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
            onNodeClick={(_e, n) => setSelected(n.id)}
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
        </GlassPanel>

        {/* Buddy — the assistant dock (4th pane; present only with mod-buddy installed) */}
        {buddyOpen && (
          <>
            <div aria-hidden />
            <BuddyDock slug={slug} getDoc={currentDoc} onApply={applyBuddyDoc} onClose={() => setBuddyOpen(false)} />
          </>
        )}
      </div>

      {runOpen && <RunPanel open={runOpen} onClose={() => setRunOpen(false)} doc={currentDoc()} opMap={opMap} />}

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

      {/* Workflow settings — execution-model knobs that aren't per-node. */}
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Workflow settings">
        <div className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={offload}
              className="mt-0.5 accent-[var(--color-neon-cyan)]"
              onChange={(e) => {
                const next = e.target.checked;
                // baseDoc is the source of truth for currentDoc()/toDoc; mirror it
                // into state for the toggle + dirty recompute. `undefined` when off
                // so an off workflow serializes identically to one never flagged.
                baseDoc.current = { ...baseDoc.current, offload: next ? true : undefined };
                setOffload(next);
              }}
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Cpu size={13} /> Offload to the worker pool
              </span>
              <span className="text-muted mt-0.5 block text-xs leading-relaxed">
                Run this whole workflow off the host event loop, on the worker pool, so its
                compute can&rsquo;t stall the loop (and the admin). Default is inline — only flag
                CPU-heavy workflows. Needs a pool configured (<span className="font-mono">workers</span> in
                <span className="font-mono"> pattern.config.json</span>); with none it runs inline. Offloaded
                runs use the worker&rsquo;s own services, can&rsquo;t reach live WebSocket sockets, and aren&rsquo;t
                pausable from the editor.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={durable}
              className="mt-0.5 accent-[var(--color-neon-cyan)]"
              onChange={(e) => {
                const next = e.target.checked;
                baseDoc.current = { ...baseDoc.current, durable: next ? true : undefined };
                setDurable(next);
              }}
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Database size={13} /> Durable runs (resume &amp; re-run)
              </span>
              <span className="text-muted mt-0.5 block text-xs leading-relaxed">
                Record each run&rsquo;s exact input and every node&rsquo;s exact outputs in the RunLedger, so a
                failed run can resume from the failing node and any run can re-run with the same input.
                Costs one ledger write per node, and the ledger stores REAL values (under
                <span className="font-mono"> .pattern-data/</span> — gitignored; protect it like your
                database). Best for workflows where correctness beats latency: payments, webhooks,
                provisioning.
              </span>
            </span>
          </label>

          <div
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] leading-relaxed ${
              cpuHeavyCount > 0 && !offload
                ? "border-[var(--color-neon-amber)]/40 bg-[var(--color-neon-amber)]/10 text-[var(--color-neon-amber)]"
                : "glass text-muted"
            }`}
          >
            {cpuHeavyCount > 0
              ? offload
                ? `${cpuHeavyCount} cpu-heavy node${cpuHeavyCount > 1 ? "s" : ""} on the canvas — they run on the pool.`
                : `⚠ ${cpuHeavyCount} cpu-heavy node${cpuHeavyCount > 1 ? "s" : ""} on the canvas — Offload recommended.`
              : "No cpu-heavy nodes on the canvas. Leave Offload off unless this workflow does heavy compute."}
          </div>

          <div className="flex justify-end">
            <NeonButton variant="ghost" onClick={() => setSettingsOpen(false)}>
              Done
            </NeonButton>
          </div>
        </div>
      </Modal>

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
              This tab has unsaved changes in{" "}
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

      {/* Closing a dirty tab — make losing work an explicit choice. */}
      <Modal open={closingTab !== null} onClose={() => setClosingTab(null)} title="Close tab">
        {closingTab && (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="font-mono">{closingTab === NEW_KEY ? dirtyMap[NEW_KEY]?.newSlug || "new workflow" : closingTab}</span> has
              unsaved changes. Close anyway?
            </p>
            <div className="flex justify-end gap-2">
              <NeonButton variant="ghost" onClick={() => setClosingTab(null)}>
                Keep it open
              </NeonButton>
              <NeonButton variant="danger" onClick={() => doCloseTab(closingTab)}>
                Discard & close
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
 * Widget for SubworkflowRef config fields ({ workflowId } | { workflow }) on
 * higher-order ops (core.array.map, core.flow.try, …): pick a registered
 * workflow from a select instead of hand-writing JSON. An inline `workflow`
 * doc (advanced) still round-trips through the raw-JSON toggle.
 */
function WorkflowRefField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const { data: workflows } = useWorkflows();
  const current = (value as { workflowId?: string; workflow?: unknown } | undefined) ?? {};
  if (current.workflow) {
    return <div className="text-muted text-xs">Inline workflow doc — edit via <span className="font-mono">raw JSON</span>.</div>;
  }
  return (
    <select
      value={current.workflowId ?? ""}
      onChange={(e) => onChange(e.target.value ? { workflowId: e.target.value } : undefined)}
      className="glass w-full rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
    >
      <option value="">— pick a workflow —</option>
      {(workflows ?? []).map((w) => (
        <option key={w.slug} value={w.slug}>
          {w.slug}
        </option>
      ))}
    </select>
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
  "boundary.tool": ["params"],
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
  onMeta: (meta: { title?: string; comment?: string; retry?: OpNodeData["retry"] }) => void;
}) {
  const [raw, setRaw] = useState(false);
  const cat = categoryStyle(categoryOfType(node.data.op));
  const config = (node.data.config ?? {}) as Record<string, unknown>;
  const { Icon } = cat;
  const hasSchema = op?.configSchema != null && (op.configSchema as { type?: string }).type === "object";
  const inputCls = "glass w-full rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]";
  const schemaOverrides = useMemo(() => {
    const o: Record<string, FieldOverride> = {};
    for (const f of SCHEMA_FIELDS[node.data.op] ?? []) {
      o[f] = ({ value, onChange: set }) => (
        <SchemaBuilder value={value as Record<string, unknown> | undefined} onChange={set} />
      );
    }
    // Higher-order ops: a `workflow` config property is a SubworkflowRef —
    // render the picker (detected from the schema, so mod ops get it too).
    const props = (op?.configSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
    if (props && "workflow" in props && !o.workflow) {
      o.workflow = ({ value, onChange: set }) => <WorkflowRefField value={value} onChange={set} />;
    }
    // Boundary triggers: `requireAuth` gets the auth/scope selector (the union
    // renders poorly as a plain form field, and auth deserves a real control).
    if (props && "requireAuth" in props && !o.requireAuth) {
      o.requireAuth = ({ value, onChange: set }) => <RequireAuthField value={value} onChange={set} />;
    }
    return Object.keys(o).length ? o : undefined;
  }, [node.data.op, op?.configSchema]);

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

      {/* Reliability: the per-node retry policy (engine-read; validator warns
          on external-effects ops and stream inputs — surfaced under Issues). */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="text-muted text-xs font-semibold uppercase tracking-wider">Reliability</span>
          {node.data.retry ? (
            <button type="button" className="text-muted text-[10px] underline" onClick={() => onMeta({ retry: undefined })}>
              remove retry
            </button>
          ) : (
            <button
              type="button"
              className="text-muted text-[10px] underline"
              onClick={() => onMeta({ retry: { attempts: 3, backoffMs: 500 } })}
            >
              + retry on failure
            </button>
          )}
        </div>
        {node.data.retry && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                ["attempts", "Attempts (total)", 1, 10, "3"],
                ["backoffMs", "Backoff (ms)", 0, undefined, "500"],
                ["factor", "Backoff factor", 1, undefined, "2"],
                ["maxBackoffMs", "Max backoff (ms)", 0, undefined, "30000"],
              ] as const
            ).map(([key, label, min, max, placeholder]) => (
              <div key={key}>
                <div className="text-muted mb-1 text-xs">{label}</div>
                <input
                  type="number"
                  className={inputCls}
                  min={min}
                  max={max}
                  placeholder={placeholder}
                  value={node.data.retry?.[key] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? undefined : Number(e.target.value);
                    const next = { ...node.data.retry!, [key]: v };
                    if (v === undefined) delete (next as Record<string, unknown>)[key];
                    onMeta({ retry: { ...next, attempts: next.attempts ?? 3 } });
                  }}
                />
              </div>
            ))}
          </div>
        )}
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
