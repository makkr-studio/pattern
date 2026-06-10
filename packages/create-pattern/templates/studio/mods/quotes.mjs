/**
 * An app-local mod — and a working tour of the extension surface.
 *
 * A mod is any module default-exporting a `PatternMod`. This one contributes:
 *   - two ops (`app.quotes.random`, `app.quotes.list`) usable from any workflow,
 *   - an admin **menu entry + page** (a Tier-1 declarative table: pure JSON,
 *     no build step, rendered by the admin with `app.quotes.list` as its data
 *     source),
 *   - a ⌘K **command** in the admin palette.
 *
 * List it in `pattern.config.json` under `mods`. 3rd-party mods from npm work
 * identically — install the package and list its name instead of the path.
 * See AGENTS.md for the full op-authoring contract (streams, control flow,
 * config schemas, Tier-2 React pages).
 */

const QUOTES = [
  { id: "knuth", author: "Donald Knuth", text: "Premature optimization is the root of all evil." },
  { id: "hopper", author: "Grace Hopper", text: "The most dangerous phrase in the language is: we've always done it this way." },
  { id: "kay", author: "Alan Kay", text: "The best way to predict the future is to invent it." },
  { id: "dijkstra", author: "Edsger Dijkstra", text: "Simplicity is prerequisite for reliability." },
  { id: "thompson", author: "Ken Thompson", text: "When in doubt, use brute force." },
];

/** @type {import("@pattern/core").PatternMod} */
export default {
  name: "quotes-mod",
  ops: [
    {
      type: "app.quotes.random",
      title: "app.quotes.random",
      description: "Returns one random quote { id, author, text }.",
      inputs: {},
      outputs: { out: { kind: "value" } },
      execute: async () => ({ out: QUOTES[Math.floor(Math.random() * QUOTES.length)] }),
    },
    {
      type: "app.quotes.list",
      title: "app.quotes.list",
      description: "Returns every quote — the data source behind the admin's Quotes page.",
      inputs: {},
      outputs: { out: { kind: "value" } },
      execute: async () => ({ out: QUOTES }),
    },
  ],

  // Everything below extends the ADMIN — zero admin-core changes needed.
  frontend: {
    menu: [{ category: "Examples", label: "Quotes", icon: "boxes", path: "/x/quotes", order: 10 }],
    commands: [{ id: "quotes.random", label: "Quotes: surprise me", group: "Examples", run: "app.quotes.random" }],
    pages: [
      {
        path: "/x/quotes",
        view: {
          kind: "table",
          source: "app.quotes.list",
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
