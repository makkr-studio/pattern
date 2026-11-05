Give an agent the tools of an existing MCP server. The node outputs a toolset
value for `agents.agent`'s `tools` (or `agents.tools.merge`); mod-ai connects
when the run starts, lists the server's tools, and calls them as the model asks.

`transport: "http"` takes a `url`; wire auth headers on the `headers` input,
built from `vault.read` so the key stays out of config. `transport: "stdio"`
starts a local process: `command` may hold a whole command line (for example
`docker mcp gateway run --profile X`), it is split on spaces with quotes
respected, and `args` are appended. The child process inherits the server's
environment.

Connections are pooled per configuration for the life of the process, so the
handshake happens once. Tool results prefer the server's structured content and
fall back to its joined text. MCP tools run without an approval step.
