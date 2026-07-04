Validate a workflow document without saving anything: returns `{ ok, issues }`
where each issue carries a severity (`error` blocks registration, `warning` is
advisory), a stable `code`, and — where possible — the `nodeId` it points at.
The doc goes through the same resolve phase a real registration would ($env
references, boundary config ports), so the verdict matches what save/deploy
will actually accept; a resolve failure comes back as a `resolve_failed` issue
instead of an exception.

This is the self-repair loop's workhorse: Buddy and MCP clients call it after
every draft and feed the located issues straight back to the model. Scope:
`workflows:read` — validation reads, it never writes.
