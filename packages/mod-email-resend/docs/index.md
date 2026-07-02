# Email · Resend

`@pattern-js/mod-email-resend` is the [Resend](https://resend.com) driver for
`@pattern-js/mod-email` — and the worked example to copy when writing your own
driver: Resend's send API is one authenticated POST, so the whole driver is a
single dependency-free fetch.

```jsonc
{ "mods": ["@pattern-js/mod-email", "@pattern-js/mod-email-resend"] }
```

## Setup

1. In Resend: verify your sending domain and create an API key.
2. Put the key in the vault (admin → **System → Secrets**) or an env var such
   as `RESEND_API_KEY`.
3. Admin → **System → Email** → new account: driver **Resend**, a From address
   on the verified domain, the key's source. Name it `default` if it should
   carry sign-in links.
4. Press **Test** — a real email lands in the inbox you name.

## Fields

- **Secret `apiKey`** (required) — the Resend API key, by reference
  (vault name or env-var name; never the value).
- **Option `baseUrl`** (optional) — defaults to `https://api.resend.com`.
  Point it at a proxy, a regional endpoint, or a local fake in tests: it's the
  seam the driver's own test suite uses to run the real code with zero network.

Failures surface as the run's error with Resend's own message
(`resend: 422 Invalid \`from\` address …`), so a misconfigured domain reads as
itself in the trace, not as a mystery.
