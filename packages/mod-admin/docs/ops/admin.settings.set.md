Update the server-side observability settings. They apply live and persist in
the workflow store, so they survive restarts. Body:
`{ observability: { capacity?, exclude?, sampleIo? } }` (the three keys are
also accepted at the top level); omitted keys keep their value. Output:
`{ ok: true, observability }` with the applied values.

- `capacity`: runs retained, 10 to 10000.
- `exclude`: a regex on workflow ids whose runs are never recorded; `null` or
  `""` clears it so every run shows.
- `sampleIo`: `true` samples bounded, secret-masked I/O previews on every run,
  host-served traffic included, which is what lets replay show values outside
  the editor.

A bad regex or an out-of-range capacity answers 400. This backs Settings →
Observability (server). Route: `POST /admin/api/settings`. Scope: `admin`
(root).
