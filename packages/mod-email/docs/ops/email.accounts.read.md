Every configured email account as stored: `{ name, provider, from, secrets,
options }`. `secrets` maps each field to its source (`{ source: "vault" |
"env", key }`), so the output names where a credential lives and never holds
its value. Backs the admin Email page at `GET /admin/api/email/accounts`.
Privileged: gate the trigger with the `admin` scope. To turn one name into a
ref a workflow can send through, use `email.account`.
