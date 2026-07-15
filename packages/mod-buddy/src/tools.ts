/**
 * @pattern-js/mod-buddy — the pattern_* control-plane tools.
 *
 * Ten RESTRICTED `boundary.tool` workflows — the one capability layer both
 * Buddy (in-admin) and external MCP clients consume. Bodies are ordinary
 * graphs over the existing admin/docs ops, so every tool call is a
 * traced, linked sub-run you can open on the canvas, and the admin ops
 * re-check the caller's granular scope in-op (workflows:read/write,
 * runs:read/write, deploy). `restricted: true` keeps them out of every
 * `["*"]` toolset/MCP expansion — they are offered only by name.
 */

import type { Workflow } from "@pattern-js/core";

interface ToolSpec {
  /** Workflow id (slug). */
  id: string;
  /** Tool name the model sees. */
  name: string;
  description: string;
  /** JSON-Schema properties of the arguments. */
  params: Record<string, unknown>;
  required?: string[];
  /** Which arg keys fan out into the body op's input ports (port = key). */
  extract: string[];
  /** The body op. */
  op: string;
  /** The body op's output port(s). One → wired straight to the return; several → rebuilt into one object. */
  out: string | string[];
  needsApproval?: boolean;
}

/** trigger → (extract) → op → (build) → return, laid out left to right. */
function toolWorkflow(spec: ToolSpec): Workflow {
  const nodes: Workflow["nodes"] = [
    {
      id: "in",
      op: "boundary.tool",
      config: {
        name: spec.name,
        description: spec.description,
        params: { type: "object", properties: spec.params, ...(spec.required?.length ? { required: spec.required } : {}) },
        restricted: true,
        ...(spec.needsApproval ? { needsApproval: true } : {}),
      },
      ui: { x: 60, y: 120, pair: "out" },
    },
    { id: "op", op: spec.op, ui: { x: 620, y: 120 } },
    { id: "out", op: "boundary.tool.return", ui: { x: 1180, y: 120, pair: "in" } },
  ];
  const edges: Workflow["edges"] = [];

  if (spec.extract.length) {
    nodes.splice(1, 0, {
      id: "args",
      op: "core.object.extract",
      config: { keys: spec.extract },
      comment: "Fan the validated tool args out into the op's input ports.",
      ui: { x: 340, y: 120 },
    });
    edges.push({ from: { node: "in", port: "args" }, to: { node: "args", port: "object" } });
    for (const key of spec.extract) {
      edges.push({ from: { node: "args", port: key }, to: { node: "op", port: key } });
    }
  } else {
    // No data flows from the trigger — a control edge threads reachability.
    edges.push({ from: { node: "in", port: "out" }, to: { node: "op", port: "in" } });
  }

  if (typeof spec.out === "string") {
    edges.push({ from: { node: "op", port: spec.out }, to: { node: "out", port: "result" } });
  } else {
    nodes.splice(nodes.length - 1, 0, {
      id: "combine",
      op: "core.object.build",
      config: { keys: spec.out },
      ui: { x: 900, y: 120 },
    });
    for (const port of spec.out) {
      edges.push({ from: { node: "op", port }, to: { node: "combine", port } });
    }
    edges.push({ from: { node: "combine", port: "out" }, to: { node: "out", port: "result" } });
  }

  return {
    id: spec.id,
    name: `Buddy · ${spec.name}`,
    description: `${spec.description} (restricted control-plane tool — offered only by explicit name)`,
    nodes,
    edges,
  };
}

const docSchema = { type: "object", description: "A full workflow document ({ id, nodes, edges })." };

/** The ten control-plane tools, in reading order of a typical Buddy session. */
export const CONTROL_PLANE_TOOLS: string[] = [
  "pattern_list_ops",
  "pattern_get_op",
  "pattern_search_docs",
  "pattern_get_workflow",
  "pattern_validate_workflow",
  "pattern_propose_workflow",
  "pattern_save_workflow_draft",
  "pattern_deploy_workflow",
  "pattern_list_runs",
  "pattern_get_run",
];

export function toolWorkflows(): Workflow[] {
  return [
    toolWorkflow({
      id: "buddy.tool.list-ops",
      name: "pattern_list_ops",
      description:
        "List every op available in this app (type, ports, category, contributing mod — schemas trimmed). " +
        "Call pattern_get_op for one op's full config schema and usage prose.",
      params: {},
      extract: [],
      op: "docs.ops.list",
      out: "ops",
    }),
    toolWorkflow({
      id: "buddy.tool.get-op",
      name: "pattern_get_op",
      description: "One op's full definition: ports, config JSON Schema, and the handbook's usage prose.",
      params: { type: { type: "string", description: 'The op type, e.g. "core.http.fetch".' } },
      required: ["type"],
      extract: ["type"],
      op: "docs.ops.get",
      out: "op",
    }),
    toolWorkflow({
      id: "buddy.tool.search-docs",
      name: "pattern_search_docs",
      description:
        "Search the Pattern handbook and op catalog. Returns [{ title, path, snippet, score }] — " +
        "use it before proposing a workflow to ground yourself in the house patterns.",
      params: {
        query: { type: "string", description: "What you want to know." },
        k: { type: "number", description: "Max results (default 6)." },
      },
      required: ["query"],
      extract: ["query", "k"],
      op: "buddy.knowledge.search",
      out: "results",
    }),
    toolWorkflow({
      id: "buddy.tool.get-workflow",
      name: "pattern_get_workflow",
      description: "A workflow's meta (versions, live pointer, audit) + its live and latest-saved documents.",
      params: { slug: { type: "string", description: "The workflow slug/id." } },
      required: ["slug"],
      extract: ["slug"],
      op: "admin.workflow.get",
      out: "workflow",
    }),
    toolWorkflow({
      id: "buddy.tool.validate-workflow",
      name: "pattern_validate_workflow",
      description:
        "Validate a workflow document WITHOUT saving: { ok, issues } with located errors (nodeId + code). " +
        "Iterate until ok before proposing or saving.",
      params: { doc: docSchema },
      required: ["doc"],
      extract: ["doc"],
      op: "admin.workflow.validate",
      out: "result",
    }),
    toolWorkflow({
      id: "buddy.tool.propose-workflow",
      name: "pattern_propose_workflow",
      description:
        "Propose a workflow doc to the human: it is validated here, and — when ok — surfaces as an Apply card " +
        "in the editor dock (the human applies it to the canvas; nothing is saved or deployed). " +
        "Include a one-sentence summary of what the workflow does and what changed.",
      params: {
        doc: docSchema,
        summary: { type: "string", description: "One sentence: what this workflow does / what changed." },
        slug: { type: "string", description: "Target workflow slug when editing an existing one." },
      },
      required: ["doc", "summary"],
      extract: ["doc"],
      op: "admin.workflow.validate",
      out: "result",
    }),
    toolWorkflow({
      id: "buddy.tool.save-workflow-draft",
      name: "pattern_save_workflow_draft",
      description:
        "Validate + save a doc as a new immutable DRAFT version (never deploys). Invalid docs are refused — " +
        "you get { issues } back instead of a version.",
      params: {
        slug: { type: "string", description: "The workflow slug to save under." },
        doc: docSchema,
        note: { type: "string", description: "Short version note (what changed)." },
      },
      required: ["slug", "doc"],
      extract: ["slug", "doc", "note"],
      op: "admin.workflow.save",
      out: ["version", "issues"],
    }),
    toolWorkflow({
      id: "buddy.tool.deploy-workflow",
      name: "pattern_deploy_workflow",
      description:
        "Activate a saved version (route-conflict checked). Requires the deploy scope; agent calls pause for " +
        "human approval. Pass swap=true to take over conflicting routes.",
      params: {
        slug: { type: "string" },
        version: { type: "string", description: "The version id to activate." },
        swap: { type: "boolean", description: "Take over route conflicts (default false)." },
      },
      required: ["slug", "version"],
      extract: ["slug", "version", "swap"],
      op: "admin.workflow.deploy",
      out: "result",
      needsApproval: true,
    }),
    toolWorkflow({
      id: "buddy.tool.list-runs",
      name: "pattern_list_runs",
      description: "Recent runs from the trace store — filter by workflow slug and/or status (ok | error | canceled).",
      params: {
        workflow: { type: "string", description: "Only this workflow's runs." },
        status: { type: "string", description: "ok | error | canceled" },
        limit: { type: "number", description: "Max rows (default 50)." },
      },
      extract: ["workflow", "status", "limit"],
      op: "admin.run.list",
      out: "runs",
    }),
    toolWorkflow({
      id: "buddy.tool.get-run",
      name: "pattern_get_run",
      description:
        "One run's full trace: per-node spans with status, timings, error messages/stacks, and masked I/O " +
        "samples — everything needed to answer \"why did this run fail?\". Runs of durable workflows also " +
        "report `ledgered: true`: those can be resumed from the failing node or re-run with the same input " +
        "from the Runs page (suggest it when a fix has been deployed).",
      params: { runId: { type: "string" } },
      required: ["runId"],
      extract: ["runId"],
      op: "admin.run.get",
      out: "run",
    }),
  ];
}

/**
 * The Pattern MCP server route: POST /mcp/pattern, gated by requireAuth
 * (workflows:read is the entry floor — each tool's admin ops then re-check
 * their own granular scope against the SAME bearer principal, which flows
 * through ctx.invoke into the tool sub-runs). Exposes exactly the ten
 * control-plane tools by name — restricted tools never ride a wildcard.
 */
export function patternMcpServerWorkflow(path = "/mcp/pattern"): Workflow {
  return {
    id: "buddy.mcp.server",
    name: `Buddy · Pattern MCP server (POST ${path})`,
    description:
      "Exposes the pattern_* control-plane tools to external MCP clients (Claude Code, Cursor, …) over " +
      "StreamableHTTP JSON-RPC. Gated by API tokens (mint them in admin → Access → API tokens); a token's " +
      "scopes decide which calls succeed — authoring tokens can draft, only deploy-scoped tokens can ship.",
    nodes: [
      {
        id: "in",
        op: "boundary.http.request",
        config: { method: "POST", path, requireAuth: { scopes: ["workflows:read"] } },
        ui: { x: 60, y: 120, pair: "out" },
      },
      {
        id: "serve",
        op: "ai.mcp.serve",
        config: { name: "pattern", tools: CONTROL_PLANE_TOOLS },
        comment: "The ten pattern_* tools, by explicit name — wildcards never expose restricted tools.",
        ui: { x: 340, y: 120 },
      },
      { id: "out", op: "boundary.http.response", ui: { x: 620, y: 120, pair: "in" } },
    ],
    edges: [
      { from: { node: "in", port: "body" }, to: { node: "serve", port: "request" } },
      { from: { node: "serve", port: "response" }, to: { node: "out", port: "body" } },
    ],
  };
}
