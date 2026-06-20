/** @pattern-js/mod-agents — public surface (the neutral agent contracts). */

export { agentsMod } from "./mod.js";
export { default } from "./mod.js";

export {
  AGENTS_SERVICE,
  agentsService,
  workflowToolRef,
  type AgentsService,
  type OpToolRegistration,
  type WorkflowToolRegistration,
} from "./well-known.js";
export { AgentsRegistry } from "./service.js";
export { agentBoundaryOps, toolTrigger, toolReturn } from "./boundaries.js";
export { agentsOps } from "./ops.js";
export {
  agentSchema,
  guardrailSchema,
  historySchema,
  messagePartSchema,
  toolRefSchema,
  toolsetSchema,
  turnEventSchema,
  type AgentDescriptor,
  type GuardrailDescriptor,
  type History,
  type MessagePart,
  type ToolRef,
  type ToolsetDescriptor,
  type TurnEvent,
  type TurnStopReason,
} from "./types.js";
