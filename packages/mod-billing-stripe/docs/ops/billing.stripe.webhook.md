Verify and ingest one Stripe webhook delivery: the RAW body stream plus
headers in, the `Stripe-Signature` header checked (hex HMAC over `t.body`,
whsec used verbatim, rotation-aware, constant-time) against the account's
`webhookSecret`, then mod-billing's pipeline — dedup on the event id, the
customer mapping, role projection, and the normalized `billing.*` events.
Outputs `{ result }`; wire it through `boundary.http.status` so a bad
signature answers 401 and everything legitimate answers 2xx (Stripe stops
redelivering). Lives behind the seeded `POST /billing/webhook/stripe` route —
fork that workflow to serve another account or path.
