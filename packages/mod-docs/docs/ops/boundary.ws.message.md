Fires a run per incoming WebSocket message. The WS host auto-wires itself
when any `boundary.ws.*` trigger exists in the app (no binding code). Reply
via `boundary.ws.send` (wire the same `connection` through), or broadcast to
rooms with `core.ws.notify`.
