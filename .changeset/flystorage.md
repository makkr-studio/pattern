---
"@pattern/runtime-node": minor
"@pattern/mod-admin": patch
---

Storage now runs on **flystorage**. `@pattern/runtime-node` exposes flystorage's
`FileStorage` as the storage handle with `localFs(dir)` / `memoryFs()`
constructors (replacing the bespoke `LocalFilesystem`/`MemoryFilesystem`). The
app boundary and the admin's workflow store share it, so adopting a cloud adapter
(S3 / GCS / Azure) later is a one-line change with no consumer edits.
