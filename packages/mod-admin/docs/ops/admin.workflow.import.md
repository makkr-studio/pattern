Create or extend a stored workflow from workflow JSON. Input `json` is the
document object or its JSON text, and it must carry an `id`: that id becomes
the slug (letters, digits, `.`, `-`, `_`). When the doc has no validation
errors a version is saved with the note `imported`. Output: `{ slug, issues }`.

Check `issues` for errors: an invalid doc is reported there and nothing is
saved. Importing an id that already exists adds a version to that workflow
(or reuses the version with the same behavior hash). Import only saves; follow
it with `admin.workflow.deploy` to make it live.

Route: `POST /admin/api/import` with `{ json }`. Scope: `workflows:write`. A
missing or path-like id fails the request (HTTP 500).
