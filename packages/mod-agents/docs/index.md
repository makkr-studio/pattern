# Agents (contracts)

`@pattern/mod-agents` is the **neutral** agents layer — plain-JSON
descriptors and the turn event protocol, with no SDK dependency. Provider
mods (like `@pattern/mod-agents-openai`) reify the descriptors; apps (like
`@pattern/mod-chat`) consume the events. Neither needs the other.

## Tools are workflows

A tool = a workflow with a `boundary.tool` trigger: config carries the name,
description, and a JSON-Schema `params` the ENGINE validates before your
graph runs. Drop a tool workflow into the app and every agent picks it up
(`agents.tools.workflows`). Tools can also come from **MCP servers**
(`agents.mcp.server`) and from mod-registered ops — three origins, one
descriptor.

Tool calls run as **linked sub-runs**: the admin's run view is your agent
debugger.

## The turn event protocol

One stream shape for every surface: `text.delta` / `text.done` /
`tool.activity` / `approval.request` / `error` / a GUARANTEED terminal
`done { stopReason }` (and `audio.ref`, reserved for the voice round). Errors
are turn *content*, not crashes.
