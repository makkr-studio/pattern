Issue a single-use login link for an email and deliver it through the
`identity.deliverToken` hook (console fallback in dev). Accepts a browser form
post or JSON `{ email, next? }`. The response is byte-identical whether the
address exists or not (no account enumeration), and issuance is gated to
known/enabled users (or open signup). The chat + docs sign-in cards post here.
