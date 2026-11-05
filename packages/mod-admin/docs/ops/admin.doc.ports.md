Resolve every node's ports against that node's own config. Ops such as
`core.object.build` (its keys), `boundary.manual` (its outputs) and
`core.flow.sequence` (its control-outs) compute ports from config with
server-side functions, so the editor posts the doc here to learn which
handles to draw. Body: `{ doc: { nodes: [{ id, op, config }] } }`; edges are
ignored. Output: `{ [nodeId]: { inputs, outputs, configInputs, controlOut } }`.

Nodes with an unknown op are left out of the result. A node whose config
breaks its port resolver falls back to the default ports. A body without
`doc.nodes` answers 400.

Route: `POST /admin/api/doc/ports`. Scope: `workflows:read`.
