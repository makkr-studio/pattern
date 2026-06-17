Mounts a static app (SPA) at a URL prefix. The trigger half of the app trio:
`boundary.http.app` (mount/cors/auth) → an app-descriptor op (e.g.
`core.app.static`, `admin.app`, `chat.app`, `docs.app`) → `boundary.http.app.serve`.
Files come from a registered filesystem; `spaFallback` serves index.html for
client-routed paths.

To serve your own SPA, **drop a workflow file** with this trio — the app is a
node in the graph, not server code. (Mods that ship endpoints as a package,
like the admin, register theirs imperatively in `setup`; that's a packaging
concern, not how app authors should serve a frontend.)
