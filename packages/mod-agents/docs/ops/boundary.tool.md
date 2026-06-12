The trigger that makes a workflow callable by agents. Config: `name`,
`description`, `params` (JSON Schema — engine-validated, so your graph never
sees malformed args), optional `needsApproval` for human-in-the-loop. Outputs
`args` (validated) + `user` (the principal). Pair with `boundary.tool.return`
whose `result` becomes the tool's return value to the model.
