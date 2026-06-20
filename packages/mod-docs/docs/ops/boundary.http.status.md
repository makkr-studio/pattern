Maps a **domain outcome** to an HTTP `{ status, body }` so your op never has to
know about HTTP. A domain op returns its entity on success, or
`httpOutcome("not_found")` (from `@pattern-js/core`) on a miss; this node turns the
outcome's code into a status via `config.map` (defaults: `not_found`→404,
`forbidden`→403, `unauthorized`→401, `conflict`→409, `invalid`→400) and anything
else into `config.ok` (default 200, body = the value). Set `ok` to 201 for
creates.

The outcome marker is **collision-proof**: a normal payload that happens to
carry an `error` field (say, a run's failure message) is a 200, not a 4xx —
only an `httpOutcome(...)` value becomes an error status. So you can route
*every* route through it safely.

This is the network-OUT translator that lets the *workflow* be the only
network-aware layer: pure op returns an outcome → this maps it → wire
`status`/`body` into `boundary.http.response`. One node per route, not a
hand-wired branch (see *Designing your API*).
