Runs a named hook chain from inside a workflow: payload in, the threaded
result out. The mirror of `boundary.hook` — this is the *call site*, that is
the *handler*. Mods register handlers; your workflow stays open to extension
at this exact point.
