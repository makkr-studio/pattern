List the configured model aliases: `name`, `provider`, `modelId`, `modality`,
`options`, and each secret as a reference (`{ source: "vault" | "env", key }`).
Secret values never appear here; they are read only when a model is built.

Use it for an admin view or an export of model settings. Privileged, and
served at `GET /admin/api/ai/aliases` behind the admin scope. Aliases persist
in `.pattern-data/ai-config.json` (kept in memory when the filesystem is
read-only). To turn one alias into a model reference inside a workflow, use
`ai.alias`.
