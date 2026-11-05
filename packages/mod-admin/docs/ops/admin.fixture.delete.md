Delete a named test fixture. Output: `{ ok: true }`. A workflow's fixtures
also go away with it when `admin.workflow.delete` removes the workflow.

Route: `DELETE /admin/api/workflows/:slug/fixtures/:name`. Scope:
`workflows:write`.
