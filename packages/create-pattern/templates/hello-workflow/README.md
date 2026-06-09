# {{name}}

A minimal [Pattern](https://github.com/) project.

```bash
npm run dev     # run with hot-reload (pattern dev)
npm start       # run once
```

Workflows are **JSON data** in `workflows/`, declared in `pattern.config.json`:

```
{{name}}/
  pattern.config.json     # which mods to load, where workflows live
  workflows/
    greeting.json         # a graph of typed ops + edges
  src/index.ts            # loadProject() → run it
```

`loadProject()` reads the config, loads any mods, registers every workflow, and
returns the `engine`. Inspect a workflow's graph in the terminal:

```bash
npx pattern graph workflows/greeting.json
```
