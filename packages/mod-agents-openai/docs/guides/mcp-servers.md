---
title: MCP servers
order: 10
---

# MCP servers as tools

`agents.mcp.server` exposes a Model Context Protocol server's tools to an
agent as a toolset value. Reach for it to borrow tools you don't want to
re-implement — a database gateway, a search server, a vendor's hosted tools —
instead of authoring `boundary.tool` workflows for each.

The op produces a toolset descriptor; merge it with workflow/op toolsets via
`agents.tools.merge` and wire the result into `agents.agent`'s `tools`.

## Two transports

### HTTP

Point at a streamable-HTTP MCP endpoint. Wire auth `headers` as an input (run
`vault.read` into a record builder so the token never sits in config):

```jsonc
{ "id": "mcp", "op": "agents.mcp.server",
  "config": { "transport": "http", "url": "https://mcp.example.com/sse",
              "serverLabel": "example" } }
```

### stdio — paste the whole command line

For a local stdio server you can paste the **entire** command verbatim into
`command` and leave `args` empty. The classic case is a Docker Desktop MCP
gateway line:

```jsonc
{ "id": "mcp", "op": "agents.mcp.server",
  "config": { "transport": "stdio",
              "command": "docker mcp gateway run --profile my-profile" } }
```

The command is tokenized for you (single/double quotes are honored so an arg
with spaces survives), the first token becomes the executable, the rest become
leading args, and any explicit `args` are appended after them. Every token is
trimmed and blanks are dropped — a stray trailing space or comma can't
`ENOENT` the spawn. So a bare `command: "my-server"` with `args: ["--port",
"4000"]` works too; you just don't *have* to split it yourself.

## Connections are pooled

MCP handshakes and tool discovery are expensive, runs are short — so servers
are **long-lived**. The pool keys a connection by its descriptor (transport,
url, command, args, env, label) and connects on first use; every `agents.run`
with the same MCP ref shares one connection, which lives for the process. A
failed connect is evicted so the next run retries cleanly rather than reusing
a poisoned entry. Change any field and you get a new pooled server.

## Gotchas

- An HTTP server with no `url`, or a stdio server with no `command`, fails the
  node loudly — these are pre-flight errors, not turn content.
- The pool is process-global; there's no per-run teardown. That's by design
  (reuse), but it means a stdio child process stays alive for the process
  lifetime.
- The MCP server's own tools are **not** engine-validated the way
  `boundary.tool` `params` are — validation lives at the MCP boundary, not in
  Pattern's trigger.
