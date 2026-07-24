Issue a single-use login link **plus a 6-digit sign-in code** for an email
and deliver both through the `identity.deliverToken` hook (console fallback
in dev). Accepts a browser form post or JSON `{ email, next? }`. The response
is byte-identical whether the address exists or not (no account enumeration),
and issuance is gated to known/enabled users (or open signup). The returned
"check your inbox" page carries the code form posting to `POST /auth/code` —
the installed-PWA path, where the emailed link would open in the system
browser's cookie jar instead of the app's. The chat + docs sign-in cards post
here.
