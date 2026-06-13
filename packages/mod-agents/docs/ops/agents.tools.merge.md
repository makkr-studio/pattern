Combine several toolsets into one — workflow tools (`agents.tools.workflows`),
MCP servers (`agents.mcp.server`), and op tools (`agents.tools.ops`) all
produce toolset values, and this merges them (config `count` sets how many
inputs). Wire the result into `agents.agent`'s tools. The three tool origins,
one toolbox.
