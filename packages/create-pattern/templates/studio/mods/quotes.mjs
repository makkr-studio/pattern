/**
 * An app-local mod — and a working tour of the extension surface.
 *
 * A mod is any module default-exporting a `PatternMod`. This one contributes:
 *   - two pure ops (`app.quotes.random`, `app.quotes.list`) usable from any
 *     workflow, each with a NAMED output (never a bare `out`),
 *   - two **dedicated routes** that front those ops for the admin — the op is
 *     an op, the workflow is the service; there is no generic "run any op"
 *     endpoint,
 *   - an admin **menu entry + page** (a Tier-1 declarative table: pure JSON,
 *     no build step) bound to the list route,
 *   - a ⌘K **command** in the admin palette bound to the random route.
 *
 * List it in `pattern.config.json` under `mods`. 3rd-party mods from npm work
 * identically — install the package and list its name instead of the path.
 * See AGENTS.md for the full op-authoring contract (streams, control flow,
 * config schemas, Tier-2 React pages).
 */

import { httpEndpoint } from "@pattern-js/core";

const QUOTES = [
  { id: "knuth", author: "Donald Knuth", text: "Premature optimization is the root of all evil." },
  { id: "hopper", author: "Grace Hopper", text: "The most dangerous phrase in the language is: we've always done it this way." },
  { id: "kay", author: "Alan Kay", text: "The best way to predict the future is to invent it." },
  { id: "dijkstra", author: "Edsger Dijkstra", text: "Simplicity is prerequisite for reliability." },
  { id: "thompson", author: "Ken Thompson", text: "When in doubt, use brute force." },
];

// Paths the admin page + command call (relative to the admin API mount). Public
// demo data, so the routes aren't scope-gated — add `auth: { scopes: ["admin"] }`
// to httpEndpoint below to lock a real screen to admins.
const LIST_ROUTE = "/quotes";
const RANDOM_ROUTE = "/quotes/random";

/** @type {import("@pattern-js/core").PatternMod} */
export default {
  name: "quotes-mod",
  ops: [
    {
      type: "app.quotes.random",
      title: "app.quotes.random",
      description: "Returns one random quote { id, author, text }.",
      inputs: {},
      outputs: { quote: { kind: "value" } },
      execute: async () => ({ quote: QUOTES[Math.floor(Math.random() * QUOTES.length)] }),
    },
    {
      type: "app.quotes.list",
      title: "app.quotes.list",
      description: "Returns every quote, the data behind the admin's Quotes page.",
      inputs: {},
      outputs: { quotes: { kind: "value" } },
      execute: async () => ({ quotes: QUOTES }),
    },
  ],

  // The dedicated routes that front those ops (request → op → status →
  // response). Each is a real, listable, editable workflow — wired below.
  workflows: [
    httpEndpoint({ id: "app.route.quotes.list", method: "GET", path: `/admin/api${LIST_ROUTE}`, op: "app.quotes.list", io: { out: "quotes" } }),
    httpEndpoint({ id: "app.route.quotes.random", method: "GET", path: `/admin/api${RANDOM_ROUTE}`, op: "app.quotes.random", io: { out: "quote" } }),
  ],

  // Everything below extends the ADMIN — zero admin-core changes needed.
  frontend: {
    menu: [{ category: "Examples", label: "Quotes", icon: "boxes", path: "/x/quotes", order: 10 }],
    commands: [{ id: "quotes.random", label: "Quotes: surprise me", group: "Examples", route: { method: "GET", path: RANDOM_ROUTE } }],
    pages: [
      {
        path: "/x/quotes",
        view: {
          kind: "table",
          route: { method: "GET", path: LIST_ROUTE },
          columns: [
            { key: "id", label: "ID" },
            { key: "author", label: "Author" },
            { key: "text", label: "Quote" },
          ],
        },
      },
    ],
  },
};
