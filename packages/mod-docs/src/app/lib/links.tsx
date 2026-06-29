/**
 * Shared markdown link resolution for every page that renders doc prose
 * (DocPage, HomePage, OpPage). Relative `.md` links become in-app routes (the
 * `.md` is dropped and the router prepends the mount); root-relative in-app
 * routes (`/ops`, `/admin/internals`) become Links too, with a defensive strip
 * so a mount prefix is never doubled. Anything else is left as a plain anchor.
 */

import React from "react";
import { Link } from "react-router-dom";
import { pageHref } from "./api";
import { appBoot } from "./config";

export const InternalLink = ({ to, children }: { to: string; children: React.ReactNode }) => (
  <Link to={to}>{children}</Link>
);

/** Resolve a relative markdown href against the current file's directory. */
export function resolveRelative(currentFile: string, href: string): string {
  const base = currentFile.split("/").slice(0, -1);
  const out = [...base];
  for (const part of href.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** Build the `resolveLink` callback for a page in `slug`, currently showing `file`. */
export function makeResolveLink(primarySlug: string | undefined, slug: string, file: string, index: string) {
  return (href: string): { href: string; internal?: boolean } => {
    const [path, frag] = href.split("#");
    const suffix = frag ? `#${frag}` : "";
    // A relative `.md` link → the in-app route for that page (the `.md` dropped).
    if (path && /\.md$/.test(path) && !/^[a-z]+:/.test(path) && !path.startsWith("/")) {
      const target = resolveRelative(file, path);
      return { href: `${pageHref(primarySlug, slug, target, index)}${suffix}`, internal: true };
    }
    // A root-relative in-app route (e.g. `/ops`, `/admin/internals`) → a Link, so
    // the router prepends the configured mount and it stays portable. A link that
    // already carries the mount (legacy `/docs/...`) is stripped to avoid doubling.
    if (path && path.startsWith("/") && !/^\/\//.test(path)) {
      let route = path;
      const m = appBoot.mount;
      if (m && m !== "/" && (route === m || route.startsWith(`${m}/`))) route = route.slice(m.length) || "/";
      return { href: `${route}${suffix}`, internal: true };
    }
    return { href };
  };
}
