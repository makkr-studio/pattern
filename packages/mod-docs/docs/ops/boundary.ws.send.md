The WS out-gate: write `message` (one value) or `stream` (incremental) back
to the connection that triggered the run. For OTHER connections or rooms use
`core.ws.broadcast` / `core.ws.notify` instead — send only answers the caller.
