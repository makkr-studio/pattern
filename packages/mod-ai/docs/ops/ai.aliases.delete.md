Delete a model alias by `name` and return `{ ok: true }`. Deleting a name that
does not exist is a harmless no-op, so retries are safe.

Workflows keep their `ai.alias` nodes, and those nodes fail on the next run
with a message to configure the alias. Deleting `default` also removes the
fallback model for `agents.run` and `agents.history.compact` when no model is
wired. Privileged, served at `DELETE /admin/api/ai/aliases/:name` behind the
admin scope.
