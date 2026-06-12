/**
 * @pattern/mod-docs — the `docs.*` op catalog.
 *
 * Identity-style http ops (params/query/body/headers/user in → status/headers/
 * body out) behind thin route workflows. `docs.me` is the one always-open
 * route — it tells the SPA who's reading and whether the rest is gated.
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

const recordSchema = z.record(z.string(), z.unknown());
const stringRecord = z.record(z.string(), z.string());

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

async function maybe<T>(ctx: OpContext, port: string): Promise<T | undefined> {
  return ctx.input.has(port) ? ((await ctx.input.value(port)) as T) : undefined;
}

interface HttpArgs {
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, string>;
  user: { id?: string; name?: string; email?: string; provider?: string } | null;
  ctx: OpContext;
}

interface HttpResult {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export function httpOp(
  type: string,
  description: string,
  handler: (args: HttpArgs) => HttpResult | Promise<HttpResult>,
): OpDefinition {
  return {
    type,
    title: type,
    description,
    reusable: false,
    inputs: {
      params: value(recordSchema),
      query: value(recordSchema),
      body: value(z.unknown()),
      headers: value(stringRecord),
      user: value(),
    },
    outputs: { status: value(z.number()), headers: value(stringRecord), body: value() },
    execute: async (ctx) => {
      const [params, query, body, headers, user] = await Promise.all([
        maybe<Record<string, unknown>>(ctx, "params"),
        maybe<Record<string, unknown>>(ctx, "query"),
        maybe(ctx, "body"),
        maybe<Record<string, string>>(ctx, "headers"),
        maybe<HttpArgs["user"]>(ctx, "user"),
      ]);
      const res = await handler({
        params: obj(params),
        query: obj(query),
        body,
        headers: headers ?? {},
        user: user ?? null,
        ctx,
      });
      const isText = typeof res.body === "string";
      return {
        status: res.status,
        headers: { "content-type": isText ? "text/markdown; charset=utf-8" : "application/json", ...res.headers },
        body: res.body ?? {},
      };
    },
  };
}

export function makeDocsOps(
  getEngine: () => Engine | undefined,
  content: DocsContent,
  opts: ResolvedDocsOptions,
): OpDefinition[] {
  // Always-open: the SPA's first question — "who am I, is this gated?".
  const me = httpOp("docs.me", "Reader identity + the resolved docs auth policy.", async ({ user, ctx }) => {
    const requirement = resolveAuthRequirement(opts.requireAuth as AuthRequirement | undefined, ctx.env);
    return {
      status: 200,
      body: {
        user: user?.id ? { id: user.id, name: user.name ?? null, email: user.email ?? null } : null,
        authRequired: requirement !== undefined && requirement !== false,
        login: { kind: "magic-link", requestPath: opts.loginRequestPath },
      },
    };
  });

  const manifest = httpOp(
    "docs.manifest",
    "The aggregated docs nav: one chapter per installed mod with a docs contribution.",
    async () => ({
      status: 200,
      body: {
        chapters: await content.chapters(),
        mount: opts.mount,
        adminMount: opts.adminMount,
      },
    }),
  );

  const page = httpOp(
    "docs.page",
    "One markdown page (?chapter=<slug>&file=<path>) — frontmatter-stripped, with its resolved title.",
    async ({ query }) => {
      const result = await content.page(String(query.chapter ?? ""), String(query.file ?? ""));
      if (!result) return { status: 404, body: { error: "page not found" } };
      return { status: 200, body: { chapter: String(query.chapter), file: String(query.file), ...result } };
    },
  );

  const raw = httpOp(
    "docs.raw",
    "A page's raw markdown bytes (?chapter&file) — text/markdown, frontmatter included.",
    async ({ query }) => {
      const markdown = await content.raw(String(query.chapter ?? ""), String(query.file ?? ""));
      if (markdown == null) return { status: 404, body: { error: "page not found" } };
      return { status: 200, body: markdown };
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

  const opsList = httpOp(
    "docs.ops.list",
    "Every registered op from the LIVE registry — ports, category, contributing mod (schemas trimmed; ask docs.ops.get).",
    async () => ({ status: 200, body: { ops: opListTrimmed(engine()) } }),
  );

  const opsGet = httpOp(
    "docs.ops.get",
    "One op (?type=) — full registry data merged with the owning mod's ops/<type>.md prose.",
    async ({ query }) => {
      const type = String(query.type ?? "");
      const info = opGet(engine(), type);
      if (!info) return { status: 404, body: { error: "unknown op type" } };
      return { status: 200, body: { info, prose: await content.opProse(type, info.mod) } };
    },
  );

  const modsList = httpOp(
    "docs.mods.list",
    "Installed mods with their contributions + docs chapter slugs.",
    async () => {
      const chapters = await content.chapters();
      const chapterOf = (mod: string) => chapters.find((c) => c.mod === mod)?.slug;
      return { status: 200, body: { mods: modList(engine(), chapterOf) } };
    },
  );

  return [me, manifest, page, raw, opsList, opsGet, modsList, appOp];
}
