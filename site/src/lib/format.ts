/** Site-local formatting + color helpers, lifted from the admin and made
 *  standalone (no @pattern-js dependency). The port-kind and data-type colors
 *  map to the same CSS vars the product uses, so nodes look identical. */

export type PortKind = "value" | "stream" | "control";

/** Data-type colors for value port dots — one hue per JSON type, shared everywhere. */
const TYPE_COLORS: Record<string, string> = {
  string: "var(--color-type-string)",
  number: "var(--color-type-number)",
  boolean: "var(--color-type-boolean)",
  object: "var(--color-type-object)",
  array: "var(--color-type-array)",
  enum: "var(--color-type-string)",
  union: "var(--color-type-any)",
  null: "var(--color-port-control)",
  any: "var(--color-type-any)",
};

/** CSS var for a port kind's semantic color (shared editor↔runtime). */
export function portColor(kind: PortKind): string {
  return kind === "value"
    ? "var(--color-port-value)"
    : kind === "stream"
      ? "var(--color-port-stream)"
      : "var(--color-port-control)";
}

/**
 * The color of one specific port: control = grey, stream = violet (the kind is
 * the headline for streams), value = colored by its data type.
 */
export function portFill(kind: PortKind, schemaType?: string): string {
  if (kind === "control") return "var(--color-port-control)";
  if (kind === "stream") return "var(--color-port-stream)";
  return TYPE_COLORS[schemaType ?? "any"] ?? "var(--color-type-any)";
}

/** A short human type label for a port ("value<string>", "stream<any>", "control"). */
export function portTypeLabel(kind: PortKind, schemaType?: string): string {
  if (kind === "control") return "control";
  return `${kind}<${schemaType ?? "any"}>`;
}

/** Short, stable color for a category/source badge (deterministic hash → hue). */
export function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
