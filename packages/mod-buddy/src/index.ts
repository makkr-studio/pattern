/** @pattern-js/mod-buddy — public surface (Buddy + the Pattern control plane). */

export { buddyMod, type BuddyOptions } from "./mod.js";
export { default } from "./mod.js";

export { CONTROL_PLANE_TOOLS, patternMcpServerWorkflow, toolWorkflows } from "./tools.js";
export { KnowledgeService, knowledgeSearchOp, DOCS_COLLECTION, type KnowledgeResult } from "./knowledge.js";
export { turnPipelineWorkflow, buddyRoutes, turnOps } from "./turn.js";
export { BUDDY_INSTRUCTIONS, contextBlock } from "./prompts.js";
export { THREADS, loadThread, saveThread, clearThread } from "./threads.js";
