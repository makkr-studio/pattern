The CLI trigger: `pattern run <workflow> -- args` seeds `args` (raw),
`parsed` (minimist-style), `stdin` (a stream — pipe files in), and `env`.
Pair with `boundary.cli.exit` for stdout/stderr/exit-code. Build real
command-line tools as workflows — same graph, different front door.
