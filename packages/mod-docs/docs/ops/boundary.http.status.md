Maps a **domain outcome** to an HTTP `{ status, body }` so your op never has to
know about HTTP. A result shaped `{ error: <code> }` takes its status from
`config.map` (defaults: `not_found`→404, `forbidden`→403, `unauthorized`→401,
`conflict`→409, `invalid`→400); anything else is `config.ok` (default 200, set
it to 201 for creates).

This is the network-OUT translator that lets the *workflow* be the only
network-aware layer: a pure domain op returns an entity or a discriminated
outcome (`{ error: "not_found" }`), this op turns that into a status, and you
wire `status`/`body` into `boundary.http.response`. One node per route — not a
hand-wired branch (see *Designing your API*).
