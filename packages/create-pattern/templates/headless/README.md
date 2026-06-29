# {{name}}

A headless HTTP backend built from declarative [Pattern](https://pattern-js.dev)
workflows, the **headless** modpack: routes as data, an app-local mod, no UI.

```bash
npm run dev                # hot-reload server (pattern dev)
# PORT=8080 npm run dev    # main routes on 8080 instead of 3000
# then:
curl localhost:3000/hello/world
curl -XPOST localhost:3000/echo -H 'content-type: application/json' -d '{"message":"hi"}'
curl localhost:3000/shout/hello
curl localhost:3001/health   # declared on a separate port
```

```
{{name}}/
  pattern.config.json     # mods to load, workflows dir
  mods/
    uppercase.mjs         # an app-local mod: contributes the `app.shout` op
  workflows/
    hello.json            # GET  /hello/:name        (default port)
    echo.json             # POST /echo  (body validated by JSON Schema)
    shout.json            # GET  /shout/:text  (uses the mod op)
    health.json           # GET  /health             (port 3001)
  src/index.ts            # loadProject() → start()
  AGENTS.md               # docs for your coding agent (CLAUDE.md points here)
```

Routes are **declared in the workflow**, not in code: the
`boundary.http.request` op config holds the method, **path, port**, CORS policy,
and JSON-Schema validation for body/query/params. A route uses its own `port`
if set, otherwise the `PORT` env var, falling back to 3000.

**Env interpolation.** Config can reference environment variables, with type
casting and fallbacks. `/health` declares its port as
`{ "$env": "ADMIN_PORT", "type": "number", "default": 3001 }`, so
`ADMIN_PORT=9000 npm run dev` moves it to 9000, otherwise it's 3001. Strings
support `${VAR}` / `${VAR:-fallback}` too. References resolve when the workflow
is registered.

Add a `.json` to `workflows/` and the route appears. Mods (here
`mods/uppercase.mjs`, an app-local one) add ops; install 3rd-party mods from npm
and list the package name in `pattern.config.json`.

Explore from the terminal:

```bash
npx pattern ops                       # every op you can wire (mod ops included)
npx pattern graph workflows/hello.json
```

Working with a coding agent? `AGENTS.md` carries the route and op-authoring
contracts. Want a visual control plane later? Add `@pattern-js/mod-admin` to the
config; the admin appears at `/admin`.
