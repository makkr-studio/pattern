Add a connection to a named room (rooms are just strings: `user:{id}`,
`doc:{id}`, whatever scopes your broadcast). Typically wired right after
`boundary.ws.open` or on an authenticated action.
