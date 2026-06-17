The front door of an HTTP workflow. The route lives **in the node's config** —
method, path (`/users/:id`), optional `port`, CORS, and JSON-Schema validation
for `body`/`query`/`params` — and the host derives its routing table by scanning
registered workflows. No code-side route registration exists.

Use one per route workflow, paired with `boundary.http.response`. Invalid
bodies get a `400` with located issues *before* the graph runs; validated
values flow out of the trigger's ports. Gate access with `requireAuth` in
config: `true`, `{ "scopes": [...] }`, or the env-deferred
`{ "env": "MY_SWITCH" }` form resolved per request.

This is where HTTP stops: extract each field the downstream op needs with a
`core.object.get`/`core.object.extract` (`object ← body`/`params`/`cookies`),
so the request→op mapping is visible edges, and keep the ops themselves
HTTP-free. The `cookies` output is the parsed request cookies — read them in the
workflow (session identity itself travels on `user`, the cross-transport
principal; `cookies` is the lower-level escape hatch). One caution: declare the
input shape in **one** place — a JSON Schema here *and* a Zod schema on the op's
port makes the edge fail the validator's structural check. See
*Designing your API*.
