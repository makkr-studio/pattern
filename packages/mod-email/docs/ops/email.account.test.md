Proves an account works by sending a real email: a short "It works" message
with subject "Pattern test email" goes to the `to` address through the
account draft you pass (same fields as `email.accounts.write`). The draft is
not saved, so you can test before committing; omitted `secrets` or `options`
fall back to the saved account of that name. The result is `{ ok: true,
messageId? }` or `{ ok: false, detail }` with the driver's error message,
and the op itself does not throw.

It sends for real because for email only end-to-end delivery means
anything; use an address you control, and expect it to count against the
provider's quota. Privileged: served at `POST /admin/api/email/test` behind
the `admin` scope.
