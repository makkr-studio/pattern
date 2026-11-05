The **calling** user's billing state, straight from the local customer
mapping: `{ signedIn, entitled, status, purchased }` — the subscription's
entitlement and status, plus the price keys bought outright. Principal-derived
on purpose — there is no `userId` input, so the public `GET /billing/status`
route it backs can never be used to probe someone else's state. The packaged
success page polls it while the completion webhook lands (for `entitled`, or
for the bought `item` to appear in `purchased`); your frontend can use the same
route to decide between "Upgrade", "Manage subscription", and "You own this"
without a provider round-trip. For arbitrary users inside privileged
workflows, use `billing.entitled`, `billing.owns`, or `billing.subscription.get`.
