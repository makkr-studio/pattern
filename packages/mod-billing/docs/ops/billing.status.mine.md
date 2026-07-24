The **calling** user's entitlement, straight from the local customer mapping:
`{ signedIn, entitled, status }`. Principal-derived on purpose — there is no
`userId` input, so the public `GET /billing/status` route it backs can never
be used to probe someone else's subscription state. The packaged success page
polls it while the completion webhook lands; your frontend can use the same
route to decide between "Upgrade" and "Manage subscription" without a
provider round-trip. For arbitrary users inside privileged workflows, use
`billing.entitled` or `billing.subscription.get` instead.
