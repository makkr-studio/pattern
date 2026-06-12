Subscribes a workflow to a named event: when `core.event.emit` (or
`engine.events.emit`) fires that name, this trigger starts a run with the
payload. Fire-and-forget, unordered, no return value — use a **hook** when
you need a threaded, ordered result back.
