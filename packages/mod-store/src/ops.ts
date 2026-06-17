/**
 * @pattern/mod-store — the `store.*` op catalog.
 *
 * Document/blob/lease access as visible canvas nodes. Conflicts are VALUES
 * (`ok:false` + context), never thrown — workflows branch on them. The
 * `store.admin.*` json ops back the admin Data browser and re-check the
 * `admin` scope in-op (defense in depth, identity-style).
 */

import { value, required, stream, z, type OpContext, type OpDefinition } from "@pattern/core";
import { storeService } from "./well-known.js";

const recordSchema = z.record(z.string(), z.unknown());
const stringRecord = z.record(z.string(), z.string());

const collectionConfig = z.object({
  /** Target collection (declare its indexes via ensureCollection). */
  collection: z.string().min(1),
});

const col = (ctx: OpContext): string => (ctx.config as { collection: string }).collection;

async function maybe<T>(ctx: OpContext, port: string): Promise<T | undefined> {
  return ctx.input.has(port) ? ((await ctx.input.value(port)) as T) : undefined;
}

/* ── documents ─────────────────────────────────────────────────────────── */

const storeGet: OpDefinition = {
  type: "store.get",
  title: "store.get",
  description: "Read one document by id. `found` is false (and data null) when missing.",
  config: collectionConfig,
  inputs: { id: required(z.string()) },
  outputs: { data: value(), found: value(z.boolean()), version: value(z.number().nullable()) },
  execute: async (ctx) => {
    const row = await storeService(ctx).docs.get(col(ctx), await ctx.input.value("id"));
    return { data: row?.data ?? null, found: row != null, version: row?.version ?? null };
  },
};

const storePut: OpDefinition = {
  type: "store.put",
  title: "store.put",
  description:
    "Write a document. Upsert without `version`; compare-and-swap with it (ok:false on a lost race — re-read and retry).",
  config: collectionConfig,
  inputs: { id: required(z.string()), data: required(recordSchema), version: value(z.number()) },
  outputs: { ok: value(z.boolean()), version: value(z.number().nullable()) },
  execute: async (ctx) => {
    const [id, data, version] = await Promise.all([
      ctx.input.value<string>("id"),
      ctx.input.value<Record<string, unknown>>("data"),
      maybe<number>(ctx, "version"),
    ]);
    const row = await storeService(ctx).docs.put(col(ctx), id, data, version);
    return { ok: row != null, version: row?.version ?? null };
  },
};

const storePatch: OpDefinition = {
  type: "store.patch",
  title: "store.patch",
  description: "Shallow-merge a patch into a document (CAS — version required).",
  config: collectionConfig,
  inputs: {
    id: required(z.string()),
    patch: required(recordSchema),
    version: required(z.number()),
  },
  outputs: { ok: value(z.boolean()), data: value(), version: value(z.number().nullable()) },
  execute: async (ctx) => {
    const [id, patch, version] = await Promise.all([
      ctx.input.value<string>("id"),
      ctx.input.value<Record<string, unknown>>("patch"),
      ctx.input.value<number>("version"),
    ]);
    const row = await storeService(ctx).docs.patch(col(ctx), id, patch, version);
    return { ok: row != null, data: row?.data ?? null, version: row?.version ?? null };
  },
};

const storeDelete: OpDefinition = {
  type: "store.delete",
  title: "store.delete",
  description: "Delete a document by id.",
  config: collectionConfig,
  inputs: { id: required(z.string()) },
  outputs: { ok: value(z.boolean()) },
  execute: async (ctx) => ({ ok: await storeService(ctx).docs.delete(col(ctx), await ctx.input.value("id")) }),
};

const storeQuery: OpDefinition = {
  type: "store.query",
  title: "store.query",
  description:
    "Query a collection: equality on indexed fields + orderBy (indexed or createdAt/updatedAt/id) + limit/offset.",
  config: collectionConfig.extend({
    orderBy: z.string().optional(),
    orderDir: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  inputs: {
    where: value(recordSchema),
    orderBy: value(z.string()),
    orderDir: value(z.enum(["asc", "desc"])),
    limit: value(z.number()),
    offset: value(z.number()),
  },
  outputs: { docs: value(z.array(z.unknown())), count: value(z.number()) },
  execute: async (ctx) => {
    const cfg = ctx.config as { collection: string; orderBy?: string; orderDir?: "asc" | "desc"; limit?: number };
    const [where, orderBy, orderDir, limit, offset] = await Promise.all([
      maybe<Record<string, unknown>>(ctx, "where"),
      maybe<string>(ctx, "orderBy"),
      maybe<"asc" | "desc">(ctx, "orderDir"),
      maybe<number>(ctx, "limit"),
      maybe<number>(ctx, "offset"),
    ]);
    const docs = await storeService(ctx).docs.query({
      collection: cfg.collection,
      where,
      orderBy: orderBy ?? cfg.orderBy,
      orderDir: orderDir ?? cfg.orderDir,
      limit: limit ?? cfg.limit,
      offset,
    });
    return { docs, count: docs.length };
  },
};

/* ── blobs ─────────────────────────────────────────────────────────────── */

const blobPut: OpDefinition = {
  type: "store.blob.put",
  title: "store.blob.put",
  description:
    "Store binary data (bytes value, or wire a byte stream — e.g. a streamed request body). Strings are stored utf-8.",
  inputs: {
    data: value(),
    bytes: stream(),
    mime: value(z.string()),
    ownerId: value(z.string()),
  },
  outputs: { id: value(z.string()), meta: value() },
  execute: async (ctx) => {
    const [mime, ownerId] = await Promise.all([maybe<string>(ctx, "mime"), maybe<string>(ctx, "ownerId")]);
    let payload: Uint8Array | ReadableStream<Uint8Array>;
    if (ctx.input.has("bytes")) {
      payload = ctx.input.stream<Uint8Array>("bytes");
    } else {
      const data = await ctx.input.value("data");
      if (data instanceof Uint8Array) payload = data;
      else if (typeof data === "string") {
        // Data-URL convenience (image paste flows) or plain text.
        const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(data);
        if (m) {
          const bytes = m[2]
            ? Uint8Array.from(atob(m[3]!), (c) => c.charCodeAt(0))
            : new TextEncoder().encode(decodeURIComponent(m[3]!));
          const meta = await storeService(ctx).blobs.put(bytes, { mime: mime ?? m[1] ?? undefined, ownerId });
          return { id: meta.id, meta };
        }
        payload = new TextEncoder().encode(data);
      } else throw new Error("store.blob.put: wire `bytes` (stream) or `data` (Uint8Array / string)");
    }
    const meta = await storeService(ctx).blobs.put(payload, { mime, ownerId });
    return { id: meta.id, meta };
  },
};

const blobGet: OpDefinition = {
  type: "store.blob.get",
  title: "store.blob.get",
  description:
    "Read a blob: bytes as a stream + meta + ready-to-serve headers (wire stream/headers straight into an HTTP response, mode chunked).",
  inputs: { id: required(z.string()) },
  outputs: {
    bytes: stream(),
    meta: value(),
    found: value(z.boolean()),
    headers: value(stringRecord),
    status: value(z.number()),
  },
  execute: async (ctx) => {
    const hit = await storeService(ctx).blobs.get(await ctx.input.value("id"));
    if (!hit) {
      return {
        bytes: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
        meta: null,
        found: false,
        headers: { "content-type": "application/json" },
        status: 404,
      };
    }
    return {
      bytes: hit.stream,
      meta: hit.meta,
      found: true,
      // No content-length: the serve route streams chunked, and HTTP/1.1
      // forbids mixing Content-Length with Transfer-Encoding.
      headers: { "content-type": hit.meta.mime },
      status: 200,
    };
  },
};

const blobDelete: OpDefinition = {
  type: "store.blob.delete",
  title: "store.blob.delete",
  description: "Delete a blob (bytes + metadata).",
  inputs: { id: required(z.string()) },
  outputs: { ok: value(z.boolean()) },
  execute: async (ctx) => ({ ok: await storeService(ctx).blobs.delete(await ctx.input.value("id")) }),
};

/* ── leases ────────────────────────────────────────────────────────────── */

const leaseConfig = z.object({
  /** Lease key (a `key` input overrides; e.g. wire "conversation:" + id). */
  key: z.string().optional(),
  /** Time-to-live in ms — the crash backstop. Default 60s. */
  ttlMs: z.number().int().positive().default(60_000),
});

async function leaseArgs(ctx: OpContext): Promise<{ key: string; owner: string; ttlMs: number }> {
  const cfg = ctx.config as { key?: string; ttlMs: number };
  const key = (await maybe<string>(ctx, "key")) ?? cfg.key;
  if (!key) throw new Error("store.lease: provide a key (config or input)");
  // The conventional owner is the runId: the mod releases every lease owned
  // by a run when it settles, so workflows can't leak a lock.
  const owner = (await maybe<string>(ctx, "owner")) ?? ctx.runId;
  const ttlMs = (await maybe<number>(ctx, "ttlMs")) ?? cfg.ttlMs;
  return { key, owner, ttlMs };
}

const leaseOutputs = {
  ok: value(z.boolean()),
  owner: value(z.string()),
  expiresAt: value(z.number()),
};

const leaseAcquire: OpDefinition = {
  type: "store.lease.acquire",
  title: "store.lease.acquire",
  description:
    "Claim a TTL'd lease (owner defaults to this runId; auto-released when the run settles). Conflict → ok:false + current owner — branch, don't throw.",
  config: leaseConfig,
  inputs: { key: value(z.string()), owner: value(z.string()), ttlMs: value(z.number()) },
  outputs: leaseOutputs,
  execute: async (ctx) => {
    const { key, owner, ttlMs } = await leaseArgs(ctx);
    const res = await storeService(ctx).leases.acquire(key, owner, ttlMs);
    return res.ok
      ? { ok: true, owner: res.lease.owner, expiresAt: res.lease.expiresAt }
      : { ok: false, owner: res.owner, expiresAt: res.expiresAt };
  },
};

const leaseRenew: OpDefinition = {
  type: "store.lease.renew",
  title: "store.lease.renew",
  description: "Extend a lease you hold (heartbeat for long work).",
  config: leaseConfig,
  inputs: { key: value(z.string()), owner: value(z.string()), ttlMs: value(z.number()) },
  outputs: leaseOutputs,
  execute: async (ctx) => {
    const { key, owner, ttlMs } = await leaseArgs(ctx);
    const res = await storeService(ctx).leases.renew(key, owner, ttlMs);
    return res.ok
      ? { ok: true, owner: res.lease.owner, expiresAt: res.lease.expiresAt }
      : { ok: false, owner: res.owner, expiresAt: res.expiresAt };
  },
};

const leaseRelease: OpDefinition = {
  type: "store.lease.release",
  title: "store.lease.release",
  description: "Release a lease you hold (runs also auto-release on settle).",
  config: z.object({ key: z.string().optional() }),
  inputs: { key: value(z.string()), owner: value(z.string()) },
  outputs: { ok: value(z.boolean()) },
  execute: async (ctx) => {
    const cfg = ctx.config as { key?: string };
    const key = (await maybe<string>(ctx, "key")) ?? cfg.key;
    if (!key) throw new Error("store.lease.release: provide a key (config or input)");
    const owner = (await maybe<string>(ctx, "owner")) ?? ctx.runId;
    await storeService(ctx).leases.release(key, owner);
    return { ok: true };
  },
};

/* ── admin surface (Data browser sources) ──────────────────────────────── */

function requireScope(ctx: OpContext, scope: string): void {
  const p = ctx.principal;
  if (p.kind !== "user" || !(p.scopes ?? []).includes(scope)) {
    throw new Error(`store: "${scope}" scope required`);
  }
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

type JsonHandler = (args: Record<string, unknown>, ctx: OpContext) => unknown | Promise<unknown>;

/**
 * An admin data op: a PURE domain function (discrete named inputs, a named
 * output) guarded by the `admin` scope in-op (deliberate defense-in-depth — an
 * open admin can't leak it). Invoked by the admin's declarative Data pages via
 * admin.invoke, which decomposes the page input onto these ports. NOT
 * reusable:false — invoke must be able to call it.
 */
function adminOp(type: string, description: string, io: { in?: Record<string, z.ZodType>; out: string }, handler: JsonHandler): OpDefinition {
  const inSpec = io.in ?? {};
  return {
    type,
    title: type,
    description,
    inputs: Object.fromEntries(Object.entries(inSpec).map(([k, s]) => [k, value(s)])),
    outputs: { [io.out]: value() },
    execute: async (ctx) => {
      requireScope(ctx, "admin");
      const args: Record<string, unknown> = {};
      await Promise.all(Object.keys(inSpec).map(async (k) => void (args[k] = ctx.input.has(k) ? await ctx.input.value(k) : undefined)));
      return { [io.out]: await handler(args, ctx) };
    },
  };
}

const adminCollections = adminOp(
  "store.admin.collections",
  "Collections with declared indexes and document counts (admin).",
  { out: "collections" },
  async (_args, ctx) => {
    const cols = await storeService(ctx).docs.listCollections();
    return cols.map((c) => ({ name: c.name, indexes: c.indexes.join(", "), docs: c.docCount }));
  },
);

const adminDocs = adminOp(
  "store.admin.docs",
  "Documents of a collection, newest first (admin).",
  { in: { collection: z.string(), limit: z.number().optional(), offset: z.number().optional() }, out: "documents" },
  async (args, ctx) => {
    const collection = String(args.collection ?? "");
    const docs = await storeService(ctx).docs.query({
      collection,
      orderBy: "updatedAt",
      orderDir: "desc",
      limit: Math.min(Number(args.limit ?? 100), 500),
      offset: Number(args.offset ?? 0),
    });
    return docs.map((d) => ({
      id: d.id,
      collection: d.collection,
      version: d.version,
      updated: new Date(d.updatedAt).toISOString(),
      preview: JSON.stringify(d.data).slice(0, 120),
    }));
  },
);

const adminDocGet = adminOp(
  "store.admin.doc.get",
  "One document, full JSON (admin).",
  { in: { collection: z.string(), id: z.string() }, out: "document" },
  async (args, ctx) => {
    const row = await storeService(ctx).docs.get(String(args.collection ?? ""), String(args.id ?? ""));
    return row ?? { error: "not found" };
  },
);

const adminBlobs = adminOp("store.admin.blobs", "Stored blobs, newest first (admin).", { in: { limit: z.number().optional() }, out: "blobs" }, async (args, ctx) => {
  const blobs = await storeService(ctx).blobs.list({ limit: Math.min(Number(args.limit ?? 100), 500) });
  return blobs.map((b) => ({
    id: b.id,
    mime: b.mime,
    size: b.size,
    owner: b.ownerId ?? "",
    created: new Date(b.createdAt).toISOString(),
  }));
});

const adminDocDelete = adminOp("store.admin.doc.delete", "Delete a document (admin).", { in: { collection: z.string(), id: z.string() }, out: "result" }, async (args, ctx) => {
  const ok = await storeService(ctx).docs.delete(String(args.collection ?? ""), String(args.id ?? ""));
  return { ok };
});

const adminBlobDelete = adminOp("store.admin.blob.delete", "Delete a blob (admin).", { in: { id: z.string() }, out: "result" }, async (args, ctx) => ({
  ok: await storeService(ctx).blobs.delete(String(args.id ?? "")),
}));

export const storeOps: OpDefinition[] = [
  storeGet,
  storePut,
  storePatch,
  storeDelete,
  storeQuery,
  blobPut,
  blobGet,
  blobDelete,
  leaseAcquire,
  leaseRenew,
  leaseRelease,
  adminCollections,
  adminDocs,
  adminDocGet,
  adminDocDelete,
  adminBlobs,
  adminBlobDelete,
];
