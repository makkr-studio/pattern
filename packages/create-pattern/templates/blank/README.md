# {{name}}

A minimal [Pattern](https://github.com/makkr-studio/pattern) project — the **blank** modpack: just
the engine, one workflow, zero ceremony.

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
  AGENTS.md               # docs for your coding agent (CLAUDE.md points here)
```

`loadProject()` reads the config, loads any mods, registers every workflow, and
returns the `engine`. Explore from the terminal:

```bash
npx pattern ops                          # every op you can wire
npx pattern graph workflows/greeting.json
```

Working with a coding agent? It already knows what to do — `AGENTS.md` carries
the op-authoring and workflow contracts.
