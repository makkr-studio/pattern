Names of a workflow's saved test fixtures, e.g. `["happy-path", "no-name"]`.
A fixture is a named test input stored beside the workflow
(`<slug>/fixtures/<name>.json`) and kept apart from its versions, so it
survives saves and deploys. An unknown slug yields `[]`. Load one with
`admin.fixture.get`.

Route: `GET /admin/api/workflows/:slug/fixtures`. Scope: `workflows:read`.
