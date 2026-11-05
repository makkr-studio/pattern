The fast subscription check: `{ entitled, status, purchased }` straight from
the local customer mapping the webhooks maintain — no provider round-trip,
safe on every request. `entitled` is the subscription's verdict
(active/trialing, plus past_due under `gracePastDue`); `purchased` lists the
price keys the user bought outright (ask about one with `billing.owns`). Wire
`entitled` into `core.flow.branch` to gate a paid path mid-graph. Route-level
gating is usually better served by the projected role
(`requireAuth: { scopes: ["pro"] }`); this op is for decisions inside a
workflow that serves both tiers.
