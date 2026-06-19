The CLI trigger: `pattern run <file.json> -- args` runs a workflow once, seeding
`args` (everything after `--`, raw), `parsed` (when a parser is wired), `stdin`
(a stream — pipe files in), and `env`. Pair with `boundary.cli.exit` for
stdout/stderr/exit-code. Build real command-line tools as workflows — same graph,
different front door. The run records to the project's trace store like any
other, so it shows up in the admin's Runs (durable across processes).
