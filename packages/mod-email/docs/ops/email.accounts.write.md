Create or update an email account, upserted by `name`. Requires `name`,
`provider` (a driver id from `email.providers.list`) and `from` (for example
`App <hello@example.com>`); `secrets` is an object of `{ source, key }` refs
and `options` an object of strings. A field you leave out keeps the saved
value, so re-saving `from` never wipes a secret ref; send `{}` to clear one.
Idempotent.

Name the main account `default`: the packaged delivery workflow and
`email.account` fall back to it. Workflows hold the account name, so editing
it here re-targets every sender at the next send. Accounts persist in
`.pattern-data/email-config.json` (in memory only on a read-only filesystem).
Privileged: the admin route carries the `admin` scope. Prove a draft with
`email.account.test` before saving it.
