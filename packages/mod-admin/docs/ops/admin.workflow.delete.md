Remove a stored workflow for good: it is unregistered, then its whole store
directory (every version, the audit trail, its fixtures) is deleted. There is
no undo, so export the doc first (`admin.version.get`) if you may want it
back. Output: `{ ok: true }`.

On a code workflow the op unregisters it from the running engine without
parking it, so it drops out of the catalog until the next boot. To switch a
code workflow off reversibly, use `admin.workflow.setEnabled` with
`enabled: false`.

Route: `DELETE /admin/api/workflows/:slug`. Scope: `deploy`.
