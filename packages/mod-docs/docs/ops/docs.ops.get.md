One op's reference page, at `GET {mount}/api/op?type=<op.type>`. It returns
`info` (the full registry data: ports with JSON schemas, the config schema,
control-outs, reusability, and the ids of the workflows that use it) and
`prose`, the body of `ops/<type>.md` or `null`. An unknown type is a
`not_found` outcome (404).

Prose is looked up in the owning mod's docs chapter first, then in mod-docs'
own handbook (which holds the `core.*` and `boundary.*` pages). A file in any
other mod's `ops/` folder is never consulted, so ship the page with the mod
that registers the op. Gated by the docs `requireAuth` policy.
