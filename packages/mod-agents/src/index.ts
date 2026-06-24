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
export { agentRunOps } from "./agent-ops.js";
export {
  agentSchema,
  guardrailSchema,
  historySchema,
  messagePartSchema,
  modelRefSchema,
  neutralMessageSchema,
  toolRefSchema,
  toolsetSchema,
  turnEventSchema,
  usageSchema,
  type AgentDescriptor,
  type GuardrailDescriptor,
  type History,
  type MessagePart,
  type ModelRef,
  type NeutralMessage,
  type ToolRef,
  type ToolsetDescriptor,
  type TurnEvent,
  type TurnStopReason,
  type Usage,
} from "./types.js";
export {
  AI_MCP_SERVICE,
  AI_MODEL_SERVICE,
  aiMcpService,
  aiModelService,
  type AiMcpService,
  type AiModelService,
  type GenerateTextInput,
  type McpToolRef,
  type NeutralChunk,
  type NeutralToolDef,
  type StreamTurnInput,
} from "./model-service.js";
export { startTurn, decodeState, type Decision, type TurnOutcome } from "./loop.js";
