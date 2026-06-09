# {{name}}

A minimal [Pattern](https://github.com/) workflow.

```bash
npm run dev     # run with hot-reload (pattern dev)
npm start       # run once
```

`src/index.ts` defines a workflow as JSON — a graph of typed **ops** connected by
**edges** — and runs it on the `Engine`. Edit the `template` config or wire in
more ops (`core.string.*`, `core.math.*`, `core.flow.*`) and re-run.

Inspect any workflow graph in the terminal:

```bash
npx pattern graph workflow.json
```
