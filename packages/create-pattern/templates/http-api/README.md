# {{name}}

An HTTP API built from declarative [Pattern](https://github.com/) workflows.

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
```

Routes are **declared in the workflow**, not in code: the
`boundary.http.request` op config holds the method, **path, port**, CORS policy,
and JSON-Schema validation for body/query. A route uses its own `port` if set,
otherwise the `PORT` env var, falling back to 3000 — so `/health` (port 3001)
runs on its own server. Add a `.json` to `workflows/` and the route appears.
Mods (here `mods/uppercase.mjs`, an app-local one) add ops; install 3rd-party
mods from npm and list the package name in `pattern.config.json`.

Inspect any workflow's graph:

```bash
npx pattern graph workflows/hello.json
```
