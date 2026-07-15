Resolve a named billing account (admin → System → Billing) to the edge-safe
reference other ops consume — the NAME travels, secrets re-resolve at call
time, so re-pointing the account in admin re-targets every workflow using it.
Defaults to "default". With `required: false` it probes instead of throwing:
`configured` reports whether the account exists, so a packaged workflow can
branch on "billing is set up" the way the email delivery workflow does.
