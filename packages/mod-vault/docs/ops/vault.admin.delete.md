Removes a secret by `name`, at `DELETE /admin/api/vault/secrets/:name`.
Returns `{ ok }`: true when a secret was deleted, false when the name did not
exist. It works without the master key. Nothing tracks who references the
secret: a `vault.read` node naming it, or an email, billing or AI account
whose secret ref points at `{ source: "vault", key }`, fails at its next run.
To change a value keep the name and rotate with `vault.admin.write`.
Privileged: gate the trigger with the `admin` scope.
