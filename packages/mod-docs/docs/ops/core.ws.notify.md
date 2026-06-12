Broadcasts a typed notification envelope (`{ kind: "notify", type, payload,
ts }`) to a WebSocket room. The ambient-update channel: chat uses it to nudge
other tabs (`chat.turn.updated` → re-fetch), while SSE carries the actual
turn stream. Rooms are strings — `user:{id}`, `device:{id}`, or your own.
