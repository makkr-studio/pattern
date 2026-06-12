/**
 * The landing: the handbook's index.md as the opening page, then one card per
 * installed chapter — the "install a mod, its docs appear" moment made visible.
 */

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Page } from "../lib/api";
import { Markdown } from "../lib/md";
import { useDocs } from "../shell/Shell";

export function HomePage() {
  const { manifest } = useDocs();
  const handbook = manifest.chapters[0];
  const [page, setPage] = useState<Page | null>(null);

  useEffect(() => {
    if (!handbook) return;
    void api.page(handbook.slug, handbook.index).then(setPage).catch(() => setPage(null));
  }, [handbook?.slug]);

  const others = manifest.chapters.slice(1);

  return (
    <div className="mx-auto max-w-[72ch] px-5 py-8 md:px-10">
      {page ? <Markdown text={page.markdown} /> : <div className="text-[13px] text-muted">loading…</div>}

      {others.length > 0 && (
        <section className="mt-12">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted">
            Installed mods — each documents itself
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {others.map((c) => (
              <Link
                key={c.slug}
                to={`/${c.slug}/${c.index.replace(/\.md$/, "")}`}
                className="glass rounded-2xl px-4 py-3.5 transition-transform hover:-translate-y-0.5"
              >
                <div className="text-[14px] font-medium">{c.title}</div>
                <div className="mt-0.5 truncate text-[12px] text-muted">{c.mod}</div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
