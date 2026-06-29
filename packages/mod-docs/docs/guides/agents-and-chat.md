---
title: Agents & chat
order: 15
---

# Agents & Chat

Five mods turn Pattern into an AI-agent platform where the agent, its tools
and its guardrails are **workflow nodes you can see**:

| mod | what it brings |
| --- | --- |
| `@pattern-js/mod-store` | Generic persistence: JSON document collections with declared indexes, a blob store, TTL'd CAS **leases**. SQLite (`./.pattern-data/store.db`) or memory; admin Data browser. |
| `@pattern-js/mod-vault` | Encrypted secrets (AES-256-GCM, master key from `PATTERN_VAULT_KEY`). `vault.read` emits values that are **masked out of run samples**. Write-only Secrets admin page. |
| `@pattern-js/mod-agents` | The neutral contracts **and the native agent run loop**: agent/toolset/guardrail **descriptors** (plain JSON on edges), the **turn event protocol**, the `boundary.tool` pair, the live tool registry, and `agents.agent` / `agents.run` (streaming, always) / `agents.run.resume` (HITL) / `agents.history.compact`. No provider SDK dependency. It calls a model through a neutral seam. |
| `@pattern-js/mod-ai` | The **AI capability layer + model provider** (Vercel AI SDK): `ai.model` (routing direct/gateway) and `ai.alias` (admin-configured), text/object/embed/image/speech/transcribe/video ops, the MCP client (`agents.mcp.client` connects) + MCP server (`POST /mcp`), and the AI Providers settings page. Backs `agents.run`. |
| `@pattern-js/mod-chat` | The product chat app at `/chat` (streaming transcript with the **strand**, tool buds, image input, approvals, Stop) whose turn pipeline IS a workflow. |

Fastest start: `npm create pattern@latest -- --modpack agent-chat`.

## Tools are workflows

```jsonc
// workflows/tool-weather.json
{ "id": "tool-weather",
  "nodes": [
    { "id": "in", "op": "boundary.tool",
      "config": { "name": "get_weather", "description": "Weather for a city",
                  "params": { "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"] } } },
    { "id": "...", "op": "…your graph…" },
    { "id": "out", "op": "boundary.tool.return" } ] }
```

- `params` is JSON Schema (the editor shows the visual SchemaBuilder). The
  **engine** validates every call's arguments at the trigger: a model's
  hallucinated args never reach your graph (`TriggerInputError`).
- Every call executes via `ctx.invoke`: a **linked sub-run** with sampled
  I/O. Open the Runs page and the agent's work is a tree (↳).
- `needsApproval: true` on the trigger pauses the turn for a human
  Approve/Deny (HITL): the run state serializes into the turn doc and the
  approval resumes it exactly where it stopped.
- Three tool origins merge into one toolset: `boundary.tool` workflows
  (`agents.tools.workflows`), MCP servers (`agents.mcp.client`; connections
  pooled for the process), and mod-contributed code tools
  (`AGENTS_SERVICE.registerOpTool`, picked by `agents.tools.ops`).

## The turn event protocol

`agents.run` emits one stream every consumer speaks (SSE responses, the
chat's persisted log, future voice surfaces): `text.delta`, `text.done`,
`tool.activity` (start/done/error + sub-run link), `approval.request`
(+ opaque `stateToken`), `error` (errors are turn content; the chat renders
them as an inline card), `audio.ref` (reserved), and a **guaranteed terminal**
`done {stopReason: complete|interrupted|error|cancelled}`.

## The turn pipeline, live

This is the actual `chat.turn.pipeline` workflow that runs every chat turn,
rendered from its real JSON. Fork it in the admin and the
middle (tools, agent, guardrails, compaction) is yours to rewire:

```workflow
{
 "id": "chat.turn.pipeline",
 "name": "Chat \u00b7 turn pipeline",
 "nodes": [
  {
   "id": "in",
   "op": "boundary.http.request",
   "ui": {
    "x": 40,
    "y": 200
   }
  },
  {
   "id": "begin",
   "op": "chat.turn.begin",
   "comment": "Scope check + conversation lease + turn doc. Conflict \u2192 409 path.",
   "ui": {
    "x": 320,
    "y": 200
   }
  },
  {
   "id": "gate",
   "op": "core.flow.branch",
   "ui": {
    "x": 600,
    "y": 120
   }
  },
  {
   "id": "tools",
   "op": "agents.tools.workflows",
   "comment": "Every boundary.tool workflow in the app. Name them here to narrow.",
   "ui": {
    "x": 820,
    "y": 40
   }
  },
  {
   "id": "agent",
   "op": "agents.agent",
   "comment": "THE agent. Edit instructions/model here; wire guardrails/handoffs in.",
   "ui": {
    "x": 1080,
    "y": 40
   }
  },
  {
   "id": "run",
   "op": "agents.run",
   "comment": "Streams turn events; runs on the wired ai.model or the Settings default.",
   "ui": {
    "x": 1340,
    "y": 200
   }
  },
  {
   "id": "sink",
   "op": "chat.events.sink",
   "comment": "Persists events + history; notifies WS rooms; guarantees a terminal state.",
   "ui": {
    "x": 1620,
    "y": 80
   }
  },
  {
   "id": "ok",
   "op": "boundary.http.response",
   "ui": {
    "x": 1620,
    "y": 320
   }
  },
  {
   "id": "err",
   "op": "boundary.http.response",
   "ui": {
    "x": 600,
    "y": 420
   }
  }
 ],
 "edges": [
  {
   "from": {
    "node": "in",
    "port": "params"
   },
   "to": {
    "node": "begin",
    "port": "params"
   }
  },
  {
   "from": {
    "node": "in",
    "port": "body"
   },
   "to": {
    "node": "begin",
    "port": "body"
   }
  },
  {
   "from": {
    "node": "in",
    "port": "headers"
   },
   "to": {
    "node": "begin",
    "port": "headers"
   }
  },
  {
   "from": {
    "node": "in",
    "port": "user"
   },
   "to": {
    "node": "begin",
    "port": "user"
   }
  },
  {
   "from": {
    "node": "begin",
    "port": "ok"
   },
   "to": {
    "node": "gate",
    "port": "condition"
   }
  },
  {
   "from": {
    "node": "gate",
    "port": "then"
   },
   "to": {
    "node": "tools",
    "port": "in"
   }
  },
  {
   "from": {
    "node": "tools",
    "port": "toolset"
   },
   "to": {
    "node": "agent",
    "port": "tools"
   }
  },
  {
   "from": {
    "node": "agent",
    "port": "agent"
   },
   "to": {
    "node": "run",
    "port": "agent"
   }
  },
  {
   "from": {
    "node": "begin",
    "port": "input"
   },
   "to": {
    "node": "run",
    "port": "input"
   }
  },
  {
   "from": {
    "node": "begin",
    "port": "history"
   },
   "to": {
    "node": "run",
    "port": "history"
   }
  },
  {
   "from": {
    "node": "begin",
    "port": "turnId"
   },
   "to": {
    "node": "run",
    "port": "turnId"
   }
  },
  {
   "from": {
    "node": "gate",
    "port": "then"
   },
   "to": {
    "node": "ok",
    "port": "in"
   }
  },
  {
   "from": {
    "node": "gate",
    "port": "then"
   },
   "to": {
    "node": "sink",
    "port": "in"
   }
  },
  {
   "from": {
    "node": "run",
    "port": "events"
   },
   "to": {
    "node": "ok",
    "port": "stream"
   }
  },
  {
   "from": {
    "node": "run",
    "port": "events"
   },
   "to": {
    "node": "sink",
    "port": "events"
   }
  },
  {
   "from": {
    "node": "begin",
    "port": "turn"
   },
   "to": {
    "node": "sink",
    "port": "turn"
   }
  },
  {
   "from": {
    "node": "run",
    "port": "history"
   },
   "to": {
    "node": "sink",
    "port": "history"
   }
  },
  {
   "from": {
    "node": "gate",
    "port": "else"
   },
   "to": {
    "node": "err",
    "port": "in"
   }
  },
  {
   "from": {
    "node": "begin",
    "port": "status"
   },
   "to": {
    "node": "err",
    "port": "status"
   }
  },
  {
   "from": {
    "node": "begin",
    "port": "error"
   },
   "to": {
    "node": "err",
    "port": "body"
   }
  }
 ]
}
```

## You own the conversations

History is pulled from the store, handed to `agents.run`, and the updated
history is pushed back. These are explicit nodes on the canvas. Compaction is a
node too (`agents.history.compact`): you SEE when memory squeezes. The chat mod's
turn doc persists every event as it streams: **the store is the source of
truth, SSE is a live tail**. A refresh mid-turn replays from the store, and
every turn reaches a terminal status even across crashes (lease TTL).

## One turn at a time

`chat.turn.begin` claims a CAS **lease** on the conversation (owner = the
turn); a concurrent send gets a 409 with the active turn and the UI offers
Stop. Streaming runs settle for the engine while the SSE tail still flows, so
Stop goes through the provider's **turn-abort registry**
(`AGENTS_SERVICE.abortTurn(turnId)`); the sink releases the lease at the
terminal event.

## Models & keys

The agent's model comes from an `ai.model` node (routing `direct` or `gateway`,
a provider, a model id) or an `ai.alias` node (a model configured in admin →
Settings → **AI Providers**), wired into `agents.agent.model`. Wire nothing and
the agent falls back to the **default** alias.

`mod-ai` resolves provider keys inside the layer; they never wire into the agent
ops. An **alias** sources each secret explicitly from the vault or a named env
var. An inline `ai.model` resolves the provider's conventional key by name (e.g.
`OPENAI_API_KEY` for OpenAI, or `AI_GATEWAY_API_KEY` for gateway routing),
checking the environment first (`loadProject` auto-loads a `.env` next to
`pattern.config.json`, where `PATTERN_VAULT_KEY` also lives; existing env wins),
then the vault. Storing a key in the vault works with no extra wiring.
Vault-read values register into the engine's sample mask, so a key can never
appear in sampled run I/O.

## Who may chat (CHAT_REQUIRE_AUTH)

Guests are allowed by default: anonymous visitors get a `chat_device` cookie
and their own conversations. One switch closes the door:

```sh
CHAT_REQUIRE_AUTH=true     # any signed-in user
CHAT_REQUIRE_AUTH=member   # comma-separated scope list works too
```

Every chat route's trigger carries `requireAuth: { env: "CHAT_REQUIRE_AUTH" }`:
a core **env-deferred auth requirement** the host resolves per request, so
the flag stays visible in the editor (it stays a live reference, resolved per
request) and **forked** chat workflows keep following the same switch.
Unset/`false` = open. The SPA route itself always stays open: anonymous visitors
of a gated chat see the app's own sign-in card (email → magic link → back in the
chat), and the sidebar footer shows who you are: your name, or `Guest`. The policy
comes from `GET /chat/api/me`, which is the one route that never requires
auth. `chatMod({ requireAuth: ... })` overrides the default; the magic-link
endpoint is `chatMod({ loginRequestPath })` if you mounted identity elsewhere.

Guests stop being invisible in the admin too: **Chat → Conversations** lists
every conversation with its owner (a username when identity knows them, else
`guest · a1b2c3` from the device cookie), turn counts, and a click-through to
each turn's event log with deep links to the runs.

## Customizing the chat pipeline

`chat.turn.pipeline` ships as a code workflow. To rewire it: **fork** it in
the admin editor, edit your copy (instructions and model live on the
`agents.agent` node; add `agents.guardrail` nodes, compaction, more
toolsets), then disable the built-in from the catalog. Or configure the
common knobs without forking: `chatMod({ agent: { instructions, model } })`.

## Voice

Voice mode ships in the chat app, behind the wave button. An on-device neural VAD
(Silero) detects when you finish speaking, the app transcribes your speech, runs
the normal `chat.turn.pipeline` against the same agent, and speaks the reply back.
Start talking again and it stops to listen (barge-in). A GPU particle avatar
visualizes the exchange, and the composer mic offers the same VAD-driven
dictation for typed turns. Voice turns post with an `avatar: true` flag and carry
audio on the protocol's `audio.ref` event, so they reuse the agent, tools, and
guardrails you already configured. Realtime bidirectional audio sessions
(persistent and stream-native) are a separate concern planned for a later round.
See the **Chat** chapter for the full voice and dictation behavior.
