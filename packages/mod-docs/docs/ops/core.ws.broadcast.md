Send a message to every connection in a room. Lower-level than
`core.ws.notify` (which wraps the payload in the typed notify envelope apps
listen for). Use broadcast for raw protocol messages, notify for app events.
