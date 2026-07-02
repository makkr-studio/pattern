The out-gate of the app trio: takes the `app` descriptor and serves it under
the paired mount. Routes declared by `boundary.http.request` always win over
app mounts; your API can live UNDER your SPA's prefix (e.g. /docs/llms.txt
inside /docs).
