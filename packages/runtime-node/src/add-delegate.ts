/**
 * `pattern add` — a thin delegator onto `create-pattern add`.
 *
 * The scaffolding logic lives in create-pattern (runtime-node stays
 * scaffold-free); this just picks the RIGHT create-pattern for the project:
 * the one from the project's own @pattern-js generation, so an 0.4 app grown
 * with an 0.6 CLI still gets 0.4-matched layer definitions. Pure planning is
 * split out so it can be unit-tested without spawning npx.
 */

export interface AddDelegation {
  /** The npx package spec, e.g. `create-pattern@^0.5.0`. */
  spec: string;
  /** Full npx argv (after the binary), stdio-inherited by the caller. */
  argv: string[];
  /** A caller-printable warning when the range couldn't be derived. */
  warning?: string;
}

/**
 * Plan the delegation: derive the create-pattern version spec from the
 * project's package.json text (null = none found → latest, with a warning).
 */
export function planAddDelegation(pkgJsonText: string | null, args: string[]): AddDelegation {
  let spec = "create-pattern@latest";
  let warning: string | undefined;
  if (pkgJsonText === null) {
    warning = "no package.json found here — using create-pattern@latest";
  } else {
    try {
      const pkg = JSON.parse(pkgJsonText) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = { ...pkg.devDependencies, ...pkg.dependencies };
      const range = deps["@pattern-js/core"] ?? deps["@pattern-js/runtime-node"] ?? Object.entries(deps).find(([k]) => k.startsWith("@pattern-js/"))?.[1];
      if (range) spec = `create-pattern@${range}`;
      else warning = "no @pattern-js dependency in package.json — using create-pattern@latest";
    } catch {
      warning = "package.json didn't parse — using create-pattern@latest";
    }
  }
  return { spec, argv: ["--yes", spec, "add", ...args], warning };
}
