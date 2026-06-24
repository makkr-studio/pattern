/**
 * @pattern-js/mod-ai — the MCP tool seam (AiMcpService).
 *
 * TODO(mcp): re-implement MCP tool discovery + execution on the AI SDK's
 * experimental_createMCPClient (http StreamableHTTP + stdio), pooled by
 * descriptor like the retired @openai/agents pool. Until then the
 * `agents.mcp.server` descriptor still builds, but resolving its tools fails
 * loudly here rather than silently — MCP parity is tracked, not lost-and-hidden.
 */

import type { AiMcpService, McpToolRef, NeutralToolDef } from "@pattern-js/mod-agents";

const NOT_YET =
  "mod-ai: MCP tool resolution is not yet wired on the AI SDK provider (tracked). The agents.mcp.server " +
  "descriptor builds, but using its tools needs the MCP client. Use workflow tools (boundary.tool) or op tools for now.";

export class McpService implements AiMcpService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listTools(_ref: McpToolRef): Promise<NeutralToolDef[]> {
    throw new Error(NOT_YET);
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async callTool(_ref: McpToolRef, _name: string, _args: Record<string, unknown>): Promise<unknown> {
    throw new Error(NOT_YET);
  }
}
