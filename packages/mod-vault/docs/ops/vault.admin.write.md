Create or rotate a secret. Admin-scoped and write-only: the value is encrypted
at rest and never returned by any read API (only `vault.read` decrypts it,
into the masked secret channel). This backs the admin's System → Secrets form.
