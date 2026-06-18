import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Engine, type PatternMod } from "@pattern/core";

// Boots a host without an auth provider → the host warns that requireAuth routes
// (the docs auth gate) aren't enforced. Not under test here; silence it.
beforeEach(() => void vi.spyOn(console, "warn").mockImplementation(() => {}));
import { createHttpHost, memoryFs, provideFilesystem } from "@pattern/runtime-node";
import { docsMod } from "../src/index.js";

/**
 * The docs host over a REAL HTTP host: the 3rd-party contribution seam
 * (a fake mod ships markdown in a memory fs → its chapter appears), nav
 * derivation from frontmatter, path-traversal defenses, and the
 * DOCS_REQUIRE_AUTH gate.
 */

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

let port = 5040;

/** A pretend 3rd-party mod that documents itself through the public seam. */
function fakeMod(): PatternMod {
  return {
    name: "@acme/mod-fake",
    ops: [
      {
        type: "fake.op",
        title: "Fake op",
        description: "Does fake things.",
        inputs: {},
        outputs: {},
        execute: async () => ({}),
      },
    ],
    docs: { filesystem: "fake-docs", title: "Fake Mod", order: 50 },
    setup: (engine) => {
      const fs = memoryFs();
      void fs.write("index.md", "# Fake Mod\n\nThe chapter landing page.");
      void fs.write("guides/setup.md", "---\ntitle: Setting up\norder: 1\n---\n\n# Setup\n\nHow to set up.");
      void fs.write("guides/zz-later.md", "# Way later\n\nNo frontmatter — heading title, default order.");
      void fs.write("ops/fake.op.md", "Use `fake.op` when you need convincing fakes.");
      provideFilesystem(engine, "fake-docs", fs);
    },
  };
}

async function boot(opts: { env?: Record<string, string>; headerAuth?: boolean; explicitNav?: boolean } = {}) {
  port += 1;
  const engine = new Engine({ env: opts.env });
  if (opts.headerAuth) {
    engine.registerAuthProvider({
      name: "header",
      async authenticate({ headers }) {
        const id = headers.get("x-user");
        return id ? { kind: "user", id, provider: "header" } : null;
      },
    });
  }
  await engine.useAsync(docsMod(), { deferReady: true });
  const fake = fakeMod();
  if (opts.explicitNav) {
    fake.docs = {
      ...fake.docs!,
      nav: [{ label: "Only this", file: "guides/setup.md" }],
    };
  }
  await engine.useAsync(fake, { deferReady: true });
  const host = createHttpHost(engine, { defaultPort: port });
  const { close } = await host.start();
  closer = close;
  return { engine, base: `http://localhost:${port}` };
}

describe("docs contribution seam (3rd-party e2e)", () => {
  it("an installed mod's markdown becomes a chapter with frontmatter-derived nav", async () => {
    const { base } = await boot();
    const manifest = (await (await fetch(`${base}/docs/api/manifest`)).json()) as {
      chapters: Array<{ mod: string; slug: string; title: string; nav: Array<{ label: string; file: string; items?: unknown[] }> }>;
      adminMount: string;
    };

    // The handbook (mod-docs's own chapter, via the same seam) opens the book.
    expect(manifest.chapters[0]).toMatchObject({ mod: "@pattern/mod-docs", title: "Pattern", slug: "docs" });
    expect(manifest.adminMount).toBe("/admin");

    const fake = manifest.chapters.find((c) => c.mod === "@acme/mod-fake")!;
    expect(fake).toMatchObject({ slug: "fake", title: "Fake Mod" });
    // Derived nav: guides/ groups; frontmatter title + order beat filename;
    // ops/*.md never becomes a page.
    const group = fake.nav.find((n) => n.label === "Guides")!;
    expect(group.items).toHaveLength(2);
    expect((group.items as Array<{ label: string }>)[0]!.label).toBe("Setting up");
    expect((group.items as Array<{ label: string }>)[1]!.label).toBe("Way later");
    expect(JSON.stringify(fake.nav)).not.toContain("fake.op");

    // Page fetch returns the frontmatter-stripped markdown + resolved title.
    const page = (await (
      await fetch(`${base}/docs/api/page?chapter=fake&file=${encodeURIComponent("guides/setup.md")}`)
    ).json()) as { title: string; markdown: string };
    expect(page.title).toBe("Setting up");
    expect(page.markdown).toContain("How to set up.");
    expect(page.markdown).not.toContain("order: 1");
  });

  it("explicit nav override wins; unknown files 404; traversal is rejected", async () => {
    const { base } = await boot({ explicitNav: true });
    const manifest = (await (await fetch(`${base}/docs/api/manifest`)).json()) as {
      chapters: Array<{ mod: string; nav: Array<{ label: string }> }>;
    };
    const fake = manifest.chapters.find((c) => c.mod === "@acme/mod-fake")!;
    expect(fake.nav).toEqual([{ label: "Only this", file: "guides/setup.md" }]);

    expect((await fetch(`${base}/docs/api/page?chapter=fake&file=nope.md`)).status).toBe(404);
    expect((await fetch(`${base}/docs/api/page?chapter=ghost&file=index.md`)).status).toBe(404);
    for (const evil of ["../secrets.md", "/etc/passwd.md", "a\\b.md", "index.md/../x.md", "no-extension"]) {
      const res = await fetch(`${base}/docs/api/page?chapter=fake&file=${encodeURIComponent(evil)}`);
      expect(res.status, evil).toBe(404);
    }
    // raw view returns the bytes, frontmatter included
    const raw = await fetch(`${base}/docs/raw?chapter=fake&file=${encodeURIComponent("guides/setup.md")}`);
    expect(raw.status).toBe(200);
    expect(raw.headers.get("content-type")).toContain("text/markdown");
    expect(await raw.text()).toContain("order: 1");
  });
});

describe("the generated op reference", () => {
  it("lists live registry ops and merges per-op prose by owning mod", async () => {
    const { base } = await boot();

    // The list: core + fake-mod ops, trimmed (no schemas), with attribution.
    const list = (await (await fetch(`${base}/docs/api/ops`)).json()) as { ops: Array<Record<string, unknown>> };
    const fakeInList = list.ops.find((o) => o.type === "fake.op")!;
    expect(fakeInList).toMatchObject({ mod: "@acme/mod-fake", category: "fake" });
    expect(list.ops.some((o) => o.type === "core.flow.branch")).toBe(true);
    expect(JSON.stringify(fakeInList)).not.toContain("configSchema");

    // The detail: full info + prose from the OWNING mod's docs fs.
    const fake = (await (await fetch(`${base}/docs/api/op?type=fake.op`)).json()) as {
      info: { type: string; description: string };
      prose: string | null;
    };
    expect(fake.info.description).toBe("Does fake things.");
    expect(fake.prose).toContain("convincing fakes");

    // A core op picks its prose from mod-docs's own packaged docs/ops/.
    const branch = (await (await fetch(`${base}/docs/api/op?type=core.flow.branch`)).json()) as {
      info: { controlOut: string[] };
      prose: string | null;
    };
    expect(branch.info.controlOut).toEqual(expect.arrayContaining(["then", "else"]));
    expect(branch.prose).toContain("If/else for graphs");
    // Ports carry a derived data TYPE, not just the kind.
    const condition = (branch.info as unknown as { inputs: Array<{ name: string; dataType?: string }> }).inputs.find(
      (p) => p.name === "condition",
    )!;
    expect(condition.dataType).toBe("boolean");

    // Unknown type → 404; a trivial op with no prose file → prose null.
    expect((await fetch(`${base}/docs/api/op?type=no.such.op`)).status).toBe(404);
    const xor = (await (await fetch(`${base}/docs/api/op?type=core.bool.xor`)).json()) as { prose: string | null };
    expect(xor.prose).toBeNull();

    // Mods list with chapter slugs.
    const mods = (await (await fetch(`${base}/docs/api/mods`)).json()) as {
      mods: Array<{ name: string; ops: string[]; chapter?: string }>;
    };
    const fakeMod = mods.mods.find((m) => m.name === "@acme/mod-fake")!;
    expect(fakeMod.ops).toContain("fake.op");
    expect(fakeMod.chapter).toBe("fake");
  });
});

describe("llms.txt + search index (agent-readable docs)", () => {
  it("serves the whole doc set as one markdown body, chapters in order", async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/docs/llms.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();

    // Chapters in order: the handbook before the fake mod's chapter.
    const handbookAt = text.indexOf("# Chapter: Pattern (@pattern/mod-docs)");
    const fakeAt = text.indexOf("# Chapter: Fake Mod (@acme/mod-fake)");
    expect(handbookAt).toBeGreaterThan(-1);
    expect(fakeAt).toBeGreaterThan(handbookAt);
    // Page bodies are in, frontmatter is not.
    expect(text).toContain("How to set up.");
    expect(text).not.toContain("order: 1\n---");
    // The generated reference rides along — terse, no JSON schemas.
    expect(text).toContain("# Op reference (generated from the live registry)");
    expect(text).toContain("## core.flow.branch");
    expect(text).not.toContain('"$schema"');
  });

  it("exposes the ⌘K corpus: pages with headings + op types", async () => {
    const { base } = await boot();
    const idx = (await (await fetch(`${base}/docs/api/search-index`)).json()) as {
      pages: Array<{ chapter: string; file: string; title: string; headings: string[] }>;
      ops: Array<{ type: string }>;
    };
    const setup = idx.pages.find((p) => p.chapter === "fake" && p.file === "guides/setup.md")!;
    expect(setup.title).toBe("Setting up");
    expect(setup.headings).toContain("Setup");
    expect(idx.pages.some((p) => p.chapter === "docs" && p.file === "index.md")).toBe(true);
    expect(idx.ops.some((o) => o.type === "fake.op")).toBe(true);
  });
});

describe("docs auth gate (DOCS_REQUIRE_AUTH)", () => {
  it("default: open to everyone, /me says so", async () => {
    const { base } = await boot();
    const me = (await (await fetch(`${base}/docs/api/me`)).json()) as { user: unknown; authRequired: boolean };
    expect(me).toMatchObject({ user: null, authRequired: false });
    expect((await fetch(`${base}/docs/api/manifest`)).status).toBe(200);
  });

  it("DOCS_REQUIRE_AUTH=true gates content but never /me", async () => {
    const { base } = await boot({ env: { DOCS_REQUIRE_AUTH: "true" }, headerAuth: true });
    const me = (await (await fetch(`${base}/docs/api/me`)).json()) as { authRequired: boolean };
    expect(me.authRequired).toBe(true);

    expect((await fetch(`${base}/docs/api/manifest`)).status).toBe(401);
    expect((await fetch(`${base}/docs/api/page?chapter=fake&file=index.md`)).status).toBe(401);
    expect((await fetch(`${base}/docs/raw?chapter=fake&file=index.md`)).status).toBe(401);
    expect((await fetch(`${base}/docs/llms.txt`)).status).toBe(401);
    expect((await fetch(`${base}/docs/api/search-index`)).status).toBe(401);
    expect((await fetch(`${base}/docs/api/ops`)).status).toBe(401);

    const authed = await fetch(`${base}/docs/api/manifest`, { headers: { "x-user": "benoit" } });
    expect(authed.status).toBe(200);
  });
});
