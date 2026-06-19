The chat SPA as an app descriptor — wire `app` into `boundary.http.app.serve`
under a `boundary.http.app` mount. `api` is the SHARED backend root this bundle
calls (NOT where the SPA mounts), `namespace` partitions this instance's data,
and `accent`/`title` brand it; all ride the manifest the host injects as
`window.__APP__`. One bundle, hosted many times — set a distinct `namespace` per
instance or their conversation lists collide.
