Cooperative concurrency as a node: CAS-acquire a named lease for an owner +
TTL. Returns `{ ok: true, lease }` or `{ ok: false, owner, expiresAt }`: a
value to branch on (wire into `core.flow.branch`). Auto-releases when the owning
run settles; the TTL is the crash backstop. Note for streaming workflows: a run
"settles" when its response stream is captured, before it drains, so own the
lease with an id you control (the chat pipeline uses `turn:{turnId}`) and release
at your terminal event.
