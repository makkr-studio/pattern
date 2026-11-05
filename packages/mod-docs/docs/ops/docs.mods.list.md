The installed mods, at `GET {mount}/api/mods`: each with its `name`, the op
types and workflow ids it contributed, and the `chapter` slug of its docs
chapter (absent when the mod ships no docs). Use it to answer "where did
this op come from" or to link a mod to its chapter. Reads the running
engine, so it reflects this installation only. Gated by the docs
`requireAuth` policy.
