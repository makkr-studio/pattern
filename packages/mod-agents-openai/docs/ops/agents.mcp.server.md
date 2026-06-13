An MCP server as a toolset value — its tools become the agent's tools. Config
the transport (`http` with a url + optional wired `headers` for auth, or
`stdio` with a command). Connections are POOLED per process keyed by the
descriptor, so repeated runs reuse one server. Merge with other toolsets via
`agents.tools.merge`.
