Can this output port feed that input port? The editor's connection assist
calls it while you drag an edge. Body:

```json
{ "from": { "op": "core.http.fetch", "port": "body", "dir": "out" },
  "to":   { "op": "core.json.parse", "port": "text", "dir": "in" } }
```

Answers `{ ok: true }` or `{ ok: false, reason, fix? }` from core's
`portCompatibility`, the same rule load-time validation applies: port kinds
must match, and value and stream schemas must be assignable. Stream → value
carries `fix: "accumulate"` and value → stream carries `fix: "emit"`, naming
the adapter (`core.stream.accumulate` / `core.stream.emit`) the editor offers
to insert.

Ports resolve against an empty config, so a port that only exists under some
config (`core.object.build` keys, for instance) reports as unknown; resolve
those with `admin.doc.ports`. Implicit control ports, declared control-outs
and config inputs are recognised.

Route: `POST /admin/api/ports/compatible`. Scope: `workflows:read`.
