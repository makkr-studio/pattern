# Wiring sign-in email delivery

The zero-config path: install mod-email + a driver, create one account, done.

## 1. Install the mods

```jsonc
// pattern.config.json — after the identity mods
{ "mods": [
  "@pattern-js/mod-identity",
  "@pattern-js/mod-auth-magic-link",
  "@pattern-js/mod-email",
  "@pattern-js/mod-email-resend",   // or @pattern-js/mod-email-smtp
  ...
] }
```

(Order doesn't actually matter — drivers find the email service through the
two-phase install.) `create-pattern` wires all of this when you pick Resend or
SMTP at the "Sign-in link delivery?" question.

## 2. Create the `default` account

Admin → **System → Email** → new account named `default`:

- **Resend**: the API key, from the vault (System → Secrets) or an env var
  such as `RESEND_API_KEY`. The From address must be on a domain you verified
  with Resend.
- **SMTP**: host (+ port/TLS/username as options) and the password as the one
  secret. A local catcher like Mailpit (`host: localhost`, `port: 1025`, no
  auth) is great in dev.

Press **Test** — it sends a real email to an address you type, which proves
credentials, From address and inbox placement in one go.

## 3. There is no step 3

The packaged **`email.deliver-token`** workflow (visible in the admin catalog)
is already subscribed to identity's `identity.deliverToken` hook. It probes
for the `default` account on every delivery:

- no account → the payload passes through untouched and the link prints to
  the server console, exactly as before;
- account exists → the link goes by email (subject "Your login link", a
  button, a plain-text alternative) and the console stays silent;
- the send throws (bad key, provider down) → identity logs a warning and the
  console fallback still prints the link — you are never locked out.

## Customizing the email

Open `email.deliver-token` in the admin editor. The wording lives in two
`core.string.template` nodes (`{{purpose}}`, `{{url}}`, `{{email}}` from the
hook payload); the sender is the `email.account` node (point it at another
account name if you keep `default` for something else). For a bigger rewrite,
fork the workflow, subscribe your fork to the same hook (a `boundary.hook`
trigger with `hook: "identity.deliverToken"`), and set a lower `priority` so
it runs first — return `delivered: true` and the chain stops falling through.
