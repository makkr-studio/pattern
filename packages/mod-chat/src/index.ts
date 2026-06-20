/** @pattern-js/mod-chat — public surface. */

export { chatMod, CHAT_ASSETS_FS } from "./backend/mod.js";
export { default } from "./backend/mod.js";

export { resolveOptions, type ChatModOptions, type ResolvedChatOptions } from "./backend/options.js";
export {
  approvalPipelineWorkflow,
  blobUploadWorkflow,
  crudWorkflows,
  spaWorkflow,
  turnPipelineWorkflow,
} from "./backend/workflows.js";
export {
  CONVERSATIONS,
  TURNS,
  DEVICE_COOKIE,
  ensureChatCollections,
  type ConversationDoc,
  type TurnDoc,
  type TurnStatus,
} from "./backend/data.js";
