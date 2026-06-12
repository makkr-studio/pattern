The front door of an HTTP workflow. The route lives **in the node's config** —
method, path (`/users/:id`), optional `port`, CORS, and JSON-Schema validation
for `body`/`query` — and the host derives its routing table by scanning
registered workflows. No code-side route registration exists.

Use one per route workflow, paired with `boundary.http.response`. Invalid
bodies get a `400` with located issues *before* the graph runs; validated
values flow out of the trigger's ports. Gate access with `requireAuth` in
config: `true`, `{ "scopes": [...] }`, or the env-deferred
`{ "env": "MY_SWITCH" }` form resolved per request.
