Save a named test fixture for a workflow, replacing any fixture with that
name. Body:

```json
{ "fixture": { "trigger": "in", "input": { "params": { "name": "Ada" } } } }
```

The fixture is stored as given, with no check against the workflow; a missing
body saves `{}`. Names follow the slug rule (letters, digits, `.`, `-`, `_`),
and an invalid one fails the request. Output: `{ ok: true }`. Replay it by
passing its fields to `admin.run`.

Route: `POST /admin/api/workflows/:slug/fixtures/:name`. Scope:
`workflows:write`.
