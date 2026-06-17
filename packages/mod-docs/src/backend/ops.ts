/**
 * @pattern/mod-docs — the `docs.*` op catalog.
 *
 * Pure domain ops: discrete inputs (the query fields they read, the reader's
 * `user`), a single named output, and a domain outcome (`{ error: "not_found" }`
 * for misses). They never see HTTP — the route workflow decomposes the request,
 * maps outcomes to status via `boundary.http.status`, and sets the content-type
 * for the markdown routes. `docs.me` is the one always-open route.
 */

import {
  boundaries,
  resolveAuthRequirement,
  value,
  z,
  type AuthRequirement,
  type Engine,
  type OpContext,
  type OpDefinition,
} from "@pattern/core";
import type { DocsContent } from "./content.js";
import { modList, opGet, opListTrimmed } from "./introspect.js";
import type { ResolvedDocsOptions } from "./options.js";
import { DOCS_ASSETS_FS } from "./services.js";

// ── Route I/O: how each op's discrete ports map to the request (consumed by
// the route workflows). The op is a pure domain function; the workflow is the
// service that decomposes the request + names the response. ──
type Src = "query" | "params" | "user";
export interface DocsInSpec {
  src: Src;
  schema: z.ZodType;
}
export interface DocsRouteIO {
  in: Record<string, DocsInSpec>;
  out: string;
  /** Forces a response content-type (the markdown routes) — set on the out-gate. */
  contentType?: string;
}
export const docsOpRoutes: Record<string, DocsRouteIO> = {};

const Q = (schema: z.ZodType = z.string().optional()): DocsInSpec => ({ src: "query", schema });
const U = (): DocsInSpec => ({ src: "user", schema: z.unknown() });

function docsOp(
  type: string,
  description: string,
  io: { in?: Record<string, DocsInSpec>; out: string; contentType?: string },
  handler: (inputs: Record<string, unknown>, ctx: OpContext) => unknown | Promise<unknown>,
): OpDefinition {
  const inSpec = io.in ?? {};
  docsOpRoutes[type] = { in: inSpec, out: io.out, contentType: io.contentType };
  return {
    type,
    title: type,
    description,
    reusable: false,
    inputs: Object.fromEntries(Object.entries(inSpec).map(([k, v]) => [k, value(v.schema)])),
    outputs: { [io.out]: value() },
    execute: async (ctx) => {
      const inputs: Record<string, unknown> = {};
      await Promise.all(Object.keys(inSpec).map(async (k) => void (inputs[k] = ctx.input.has(k) ? await ctx.input.value(k) : undefined)));
      return { [io.out]: await handler(inputs, ctx) };
    },
  };
}

export function makeDocsOps(
  getEngine: () => Engine | undefined,
  content: DocsContent,
  opts: ResolvedDocsOptions,
): OpDefinition[] {
  // Always-open: the SPA's first question — "who am I, is this gated?".
  const me = docsOp("docs.me", "Reader identity + the resolved docs auth policy.", { in: { user: U() }, out: "info" }, (inputs, ctx) => {
    const user = inputs.user as { id?: string; name?: string; email?: string } | null;
    const requirement = resolveAuthRequirement(opts.requireAuth as AuthRequirement | undefined, ctx.env);
    return {
      user: user?.id ? { id: user.id, name: user.name ?? null, email: user.email ?? null } : null,
      authRequired: requirement !== undefined && requirement !== false,
      login: { kind: "magic-link", requestPath: opts.loginRequestPath },
    };
  });

  const manifest = docsOp(
    "docs.manifest",
    "The aggregated docs nav: one chapter per installed mod with a docs contribution.",
    { out: "manifest" },
    async () => ({ chapters: await content.chapters(), mount: opts.mount, adminMount: opts.adminMount }),
  );

  const page = docsOp(
    "docs.page",
    "One markdown page (?chapter=<slug>&file=<path>) — frontmatter-stripped, with its resolved title.",
    { in: { chapter: Q(), file: Q() }, out: "page" },
    async ({ chapter, file }) => {
      const result = await content.page(String(chapter ?? ""), String(file ?? ""));
      if (!result) return { error: "not_found" };
      return { chapter: String(chapter ?? ""), file: String(file ?? ""), ...result };
    },
  );

  const raw = docsOp(
    "docs.raw",
    "A page's raw markdown bytes (?chapter&file) — text/markdown, frontmatter included.",
    { in: { chapter: Q(), file: Q() }, out: "markdown", contentType: "text/markdown; charset=utf-8" },
    async ({ chapter, file }) => {
      const markdown = await content.raw(String(chapter ?? ""), String(file ?? ""));
      return markdown == null ? { error: "not_found" } : markdown;
    },
  );

  const appOp: OpDefinition = {
    type: "docs.app",
    title: "Pattern Docs app",
    description:
      "The docs SPA as an app object. Wire `app` into `boundary.http.app.serve` under a `boundary.http.app` mount.",
    reusable: true,
    inputs: {},
    outputs: { app: value(boundaries.appDescriptorSchema) },
    config: z.object({
      filesystem: z.string().default(DOCS_ASSETS_FS),
      spaFallback: z.string().default("index.html"),
      immutableAssets: z.boolean().default(true),
    }),
    execute: (ctx) => ({ app: { ...(ctx.config as object) } }),
  };

  /* ── the generated reference (self-reflection) ───────────────────────── */

  const engine = (): Engine => {
    const e = getEngine();
    if (!e) throw new Error("docs: engine not ready");
    return e;
  };

  const opsList = docsOp(
    "docs.ops.list",
    "Every registered op from the LIVE registry — ports, category, contributing mod (schemas trimmed; ask docs.ops.get).",
    { out: "ops" },
    async () => ({ ops: opListTrimmed(engine()) }),
  );

  const opsGet = docsOp(
    "docs.ops.get",
    "One op (?type=) — full registry data merged with the owning mod's ops/<type>.md prose.",
    { in: { type: Q() }, out: "op" },
    async ({ type }) => {
      const t = String(type ?? "");
      const info = opGet(engine(), t);
      if (!info) return { error: "not_found" };
      return { info, prose: await content.opProse(t, info.mod) };
    },
  );

  const modsList = docsOp(
    "docs.mods.list",
    "Installed mods with their contributions + docs chapter slugs.",
    { out: "mods" },
    async () => {
      const chapters = await content.chapters();
      const chapterOf = (mod: string) => chapters.find((c) => c.mod === mod)?.slug;
      return { mods: modList(engine(), chapterOf) };
    },
  );

  const searchIndex = docsOp(
    "docs.search.index",
    "The ⌘K corpus: every page (chapter, file, title, headings) + every op type.",
    { out: "index" },
    async () => ({
      pages: await content.searchIndex(),
      ops: opListTrimmed(engine()).map((o) => ({ type: o.type, description: o.description ?? "" })),
    }),
  );

  const llms = docsOp(
    "docs.llms",
    "The ENTIRE doc set as one markdown body (agent-readable docs) + a terse generated op reference.",
    { out: "markdown", contentType: "text/markdown; charset=utf-8" },
    async () => {
      const reference = opListTrimmed(engine())
        .map((o) => {
          const ports = (label: string, list: Array<{ name: string; kind: string }>) =>
            list.length ? `${label}: ${list.map((p) => `${p.name}(${p.kind})`).join(" ")}` : null;
          return [
            `## ${o.type}`,
            o.description ?? "",
            [ports("inputs", o.inputs), ports("outputs", o.outputs), o.controlOut.length ? `control-outs: ${o.controlOut.join(" ")}` : null]
              .filter(Boolean)
              .join(" · "),
          ].join("\n");
        })
        .join("\n\n");
      return `${await content.llmsText()}\n\n---\n\n# Op reference (generated from the live registry)\n\n${reference}\n`;
    },
  );

  return [me, manifest, page, raw, opsList, opsGet, modsList, searchIndex, llms, appOp];
}
