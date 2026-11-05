The built-in starter templates for a new workflow: `[{ id, name,
description, doc }]`. The set is fixed in the mod: `http-endpoint`,
`sse-stream`, `cron-job` and `event-listener`. Each `doc` is a complete
workflow document. The Workflows room's new-workflow picker clones one into
the editor, where it becomes an ordinary draft to save with
`admin.workflow.save`.

Route: `GET /admin/api/templates`. Scope: `workflows:read`.
