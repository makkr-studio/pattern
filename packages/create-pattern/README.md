# create-pattern

The scaffolder for [Pattern](../../README.md) projects.

```bash
npm create pattern@latest
# or
pnpm create pattern my-app --template agent-sse-tts
```

Interactive by default — banner → template → package manager → install + git init
→ teach-as-you-go next steps. Degrades gracefully in non-TTY/CI: fully
flag-driven, no prompts, no animation.

## Templates

| Template | What |
|----------|------|
| `hello-workflow` | the smallest possible Pattern program |
| `http-api` | request → workflow → response, a couple of routes |
| `agent-sse-tts` | the streaming showcase: split tokens to SSE + TTS |

## Flags (headless)

```
create-pattern <name> [--template <id>] [--pm npm|pnpm|yarn|bun] [--no-install] [--no-git] [--yes]
```
