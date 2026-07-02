import { lazy, Suspense, useMemo, type ComponentType } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { useManifest } from "../lib/queries";
import { DeclarativeView } from "../components/DeclarativeView";
import { EmptyState, PageHeader, Spinner } from "../components/ui";

/** Cache of loaded Tier-2 remote components, keyed by URL. */
const remoteCache = new Map<string, ComponentType>();
function remote(url: string): ComponentType {
  let C = remoteCache.get(url);
  if (!C) {
    C = lazy(() => import(/* @vite-ignore */ url).then((m) => ({ default: (m.default ?? m) as ComponentType })));
    remoteCache.set(url, C);
  }
  return C;
}

/**
 * Renders a mod-contributed page (admin internals §6) matched by path from the UI
 * manifest: Tier-1 declarative `view` (or stacked `views`), or a Tier-2 ESM
 * `remote` loaded at runtime. Paths may carry `:params`
 * (`/x/identity/users/:userId`) — matched like routes, exact paths first; the
 * params reach every view's source op as args.
 * This is what makes "add a mod → its page appears" work with zero admin changes.
 */
export function ManifestPage() {
  const { data: manifest, isLoading } = useManifest();
  const { pathname } = useLocation();
  const { page, params } = useMemo(() => {
    const pages = manifest?.pages ?? [];
    const exact = pages.find((p) => p.path === pathname);
    if (exact) return { page: exact, params: {} as Record<string, string> };
    for (const p of pages) {
      if (!p.path.includes(":")) continue;
      const m = matchPath(p.path, pathname);
      if (m) return { page: p, params: (m.params ?? {}) as Record<string, string> };
    }
    return { page: undefined, params: {} as Record<string, string> };
  }, [manifest, pathname]);

  if (isLoading) return <Spinner />;
  if (!page) {
    return (
      <>
        <PageHeader title="Not found" />
        <EmptyState title="No such page" hint={`Nothing is mounted at ${pathname}.`} />
      </>
    );
  }

  const menu = manifest?.menu.find((m) => m.path === page.path);
  const title = page.title ?? menu?.label ?? page.path.split("/").filter((s) => s && !s.startsWith(":")).pop() ?? page.path;
  // A mod controls its chrome: a custom title/subtitle, or `header: false` to
  // suppress the shell header entirely and render its own.
  const header = (fallbackSubtitle: string) =>
    page.header === false ? null : <PageHeader title={title} subtitle={page.subtitle ?? fallbackSubtitle} />;
  if (page.view || page.views) {
    const sections = page.views ?? [{ title: undefined, view: page.view! }];
    return (
      <>
        {header("Contributed by a mod (Tier-1 declarative page).")}
        <div className="space-y-6">
          {sections.map((s, i) => (
            <section key={i}>
              {s.title && <h2 className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">{s.title}</h2>}
              <DeclarativeView view={s.view} params={params} />
            </section>
          ))}
        </div>
      </>
    );
  }
  if (page.remote) {
    const Remote = remote(page.remote);
    return (
      <>
        {header("Contributed by a mod (Tier-2 ESM remote).")}
        <Suspense fallback={<Spinner />}>
          <Remote />
        </Suspense>
      </>
    );
  }
  return <EmptyState title="Unsupported page" hint="This mod page declared neither a view nor a remote." />;
}
