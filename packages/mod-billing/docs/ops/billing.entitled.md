The fast entitlement check: `{ entitled, status }` straight from the local
customer mapping the webhooks maintain — no provider round-trip, safe on
every request. Wire `entitled` into `core.flow.branch` to gate a paid path
mid-graph. Route-level gating is usually better served by the projected role
(`requireAuth: { scopes: ["pro"] }`); this op is for decisions inside a
workflow that serves both tiers.
