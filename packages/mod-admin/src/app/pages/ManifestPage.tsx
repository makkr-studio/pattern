import { lazy, Suspense, useMemo, type ComponentType } from "react";
import { useLocation } from "react-router-dom";
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
 * Renders a mod-contributed page (mod-admin-spec §6) matched by path from the UI
 * manifest: Tier-1 declarative `view`, or a Tier-2 ESM `remote` loaded at runtime.
 * This is what makes "add a mod → its page appears" work with zero admin changes.
 */
export function ManifestPage() {
  const { data: manifest, isLoading } = useManifest();
  const { pathname } = useLocation();
  const page = useMemo(() => manifest?.pages.find((p) => p.path === pathname), [manifest, pathname]);

  if (isLoading) return <Spinner />;
  if (!page) {
    return (
      <>
        <PageHeader title="Not found" />
        <EmptyState title="No such page" hint={`Nothing is mounted at ${pathname}.`} />
      </>
    );
  }

  const menu = manifest?.menu.find((m) => m.path === pathname);
  if (page.view) {
    return (
      <>
        <PageHeader title={menu?.label ?? pathname} subtitle="Contributed by a mod (Tier-1 declarative page)." />
        <DeclarativeView view={page.view} />
      </>
    );
  }
  if (page.remote) {
    const Remote = remote(page.remote);
    return (
      <>
        <PageHeader title={menu?.label ?? pathname} subtitle="Contributed by a mod (Tier-2 ESM remote)." />
        <Suspense fallback={<Spinner />}>
          <Remote />
        </Suspense>
      </>
    );
  }
  return <EmptyState title="Unsupported page" hint="This mod page declared neither a view nor a remote." />;
}
