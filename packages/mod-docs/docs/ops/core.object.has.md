Boolean "does this path exist?": it answers via `core.object.get` and treats a present-but-`undefined` value as absent. A common branch gate before reaching into an optional field.
