Every op in the live registry, at `GET {mount}/api/ops`: type, title,
description, a category derived from the type prefix, the contributing mod,
input, output and config port names with their kinds and a data-type label,
control-outs, and how many workflows use it. JSON schemas and the list of
using workflows are trimmed to keep the payload small. Sorted by category,
then type. It drives the reference index; for one op's full data and its
prose page use `docs.ops.get`. Because it reads the running engine, it lists
exactly the mods this installation loaded. Gated by the docs `requireAuth`
policy.
