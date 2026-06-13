Fires when a WebSocket connects (after `requireAuth` passed at the upgrade).
Gets the `connection` ref — stash it, join rooms (`core.ws.join`), send a
welcome. The WS host auto-wires itself when any ws trigger exists.
