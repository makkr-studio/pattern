/**
 * A markdown page: measured prose column, a TOC rail on wide screens,
 * prev/next from the chapter nav, and the raw `.md` one click away.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, pageHref, type Chapter, type Page } from "../lib/api";
import { headingsOf, Markdown } from "../lib/md";
import { useDocs } from "../shell/Shell";
import { WorkflowEmbed } from "../components/WorkflowEmbed";
import type { DocsNavItem } from "../../shared/types";

/** Resolve a relative markdown href against the current file's directory. */
function resolveRelative(currentFile: string, href: string): string {
  const base = currentFile.split("/").slice(0, -1);
  const parts = href.split("/");
  const out = [...base];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function flatten(items: DocsNavItem[]): DocsNavItem[] {
  return items.flatMap((i) => [i, ...(i.items ? flatten(i.items) : [])]);
}

const InternalLink = ({ to, children }: { to: string; children: React.ReactNode }) => (
  <Link to={to}>{children}</Link>
);

export function DocPage() {
  const { manifest } = useDocs();
  const params = useParams();
  const seg0 = params.chapter!;
  const splat = params["*"] ?? "";
  const primarySlug = manifest.chapters[0]?.slug;

  // A first segment that names a chapter selects it; otherwise the whole path is
  // a page in the primary chapter (the handbook is rooted at the mount, so
  // /docs/getting-started resolves to its getting-started page).
  const named = manifest.chapters.find((c) => c.slug === seg0);
  const chapter: Chapter | undefined = named ?? manifest.chapters[0];
  const file = named
    ? splat
      ? `${splat}.md`
      : (named.index ?? "index.md")
    : `${[seg0, splat].filter(Boolean).join("/")}.md`;

  const [page, setPage] = useState<Page | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setPage(null);
    setMissing(false);
    let live = true;
    if (!chapter) {
      setMissing(true);
      return;
    }
    api
      .page(chapter.slug, file)
      .then((p) => live && setPage(p))
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [chapter, file]);

  // Scroll to top (or the hash anchor) when the page changes.
  useEffect(() => {
    if (!page) return;
    const hash = window.location.hash.slice(1);
    if (hash) document.getElementById(hash)?.scrollIntoView();
    else document.querySelector("main")?.scrollTo({ top: 0 });
  }, [page]);

  const toc = useMemo(() => (page ? headingsOf(page.markdown).filter((h) => h.depth === 2 || h.depth === 3) : []), [page]);

  const { prev, next } = useMemo(() => {
    if (!chapter) return { prev: null, next: null };
    const seq: Array<{ label: string; file: string }> = [
      { label: "Overview", file: chapter.index },
      ...flatten(chapter.nav),
    ];
    const at = seq.findIndex((s) => s.file === file);
    return { prev: at > 0 ? seq[at - 1]! : null, next: at >= 0 && at < seq.length - 1 ? seq[at + 1]! : null };
  }, [chapter, file]);

  const routeOf = (f: string) => pageHref(primarySlug, chapter!.slug, f, chapter!.index);

  if (!chapter || missing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[14px] text-muted">
        <div className="text-[17px]">This page doesn&rsquo;t exist (yet).</div>
        <Link to="/" className="text-[var(--color-neon-cyan)] underline underline-offset-2">
          Back to the handbook
        </Link>
      </div>
    );
  }
  if (!page) return <div className="px-8 py-10 text-[13px] text-muted">loading…</div>;

  return (
    <div className="flex justify-center gap-10 px-5 py-8 md:px-10">
      <article className="min-w-0 max-w-[72ch] flex-1">
        <Markdown
          text={page.markdown}
          InternalLink={InternalLink}
          fence={(lang, body, key) => (lang === "workflow" ? <WorkflowEmbed key={key} source={body} /> : null)}
          resolveLink={(href) => {
            const [path, frag] = href.split("#");
            if (path && /\.md$/.test(path) && !/^[a-z]+:/.test(path) && !path.startsWith("/")) {
              const target = resolveRelative(file, path);
              return { href: `${pageHref(primarySlug, chapter!.slug, target, chapter!.index)}${frag ? `#${frag}` : ""}`, internal: true };
            }
            return { href };
          }}
        />

        <footer className="mt-12 flex items-center justify-between gap-3 border-t pt-5 hairline">
          {prev ? (
            <Link to={routeOf(prev.file)} className="text-[13px] text-muted hover:text-[var(--fg)]">
              ← {prev.label}
            </Link>
          ) : (
            <span />
          )}
          <a href={api.rawUrl(chapter!.slug, file)} className="text-[11.5px] text-muted hover:text-[var(--fg)]" target="_blank" rel="noreferrer">
            view raw .md
          </a>
          {next ? (
            <Link to={routeOf(next.file)} className="text-right text-[13px] text-muted hover:text-[var(--fg)]">
              {next.label} →
            </Link>
          ) : (
            <span />
          )}
        </footer>
      </article>

      {toc.length > 1 && (
        <nav className="sticky top-8 hidden w-[200px] shrink-0 self-start xl:block">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">On this page</div>
          <div className="mt-2 flex flex-col gap-1 border-l pl-3 hairline">
            {toc.map((h) => (
              <a
                key={h.id}
                href={`#${h.id}`}
                className="text-[12.5px] text-muted transition-colors hover:text-[var(--fg)]"
                style={{ paddingLeft: h.depth === 3 ? 12 : 0 }}
              >
                {h.text}
              </a>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
