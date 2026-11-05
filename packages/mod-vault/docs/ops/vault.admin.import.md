Import a pasted `.env`: every `KEY=VALUE` line becomes an encrypted secret
(same name = rotate), in one call — the vault-first migration path for a
project arriving with a filled `.env`. Comments, blank lines, empty values
(`KEY=` placeholders), malformed names, and `PATTERN_VAULT_KEY` are skipped —
the master key unlocks the vault, so it can never live inside it. Surrounding
quotes and a leading `export ` are stripped, CRLF handled. The result carries
names only (`imported` + `skipped` with reasons); values are never echoed.
Backs the Secrets page's **Import .env** panel.
