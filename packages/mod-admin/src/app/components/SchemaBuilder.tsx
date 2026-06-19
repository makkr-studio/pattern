import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { JsonView } from "./ui";
import { tip } from "./Tooltip";

/**
 * A visual schema builder (admin internals §12 spirit: forms over raw JSON).
 * Edits the JSON Schema wire format directly — what `core.schema.define` emits
 * and the hosts compile — so the builder, the raw-JSON toggle, and wired
 * schema values all agree. Recursive: objects nest fields, arrays nest items.
 */

type JS = Record<string, any>;

const TYPES = ["object", "string", "number", "boolean", "array", "any"] as const;
type TypeName = (typeof TYPES)[number];

function typeOf(s: JS | undefined): TypeName {
  const t = s?.type;
  return TYPES.includes(t) ? (t as TypeName) : "any";
}

/** A fresh sub-schema for a newly selected type. */
function blank(type: TypeName): JS {
  switch (type) {
    case "object":
      return { type: "object", properties: {} };
    case "array":
      return { type: "array", items: { type: "string" } };
    case "any":
      return {};
    default:
      return { type };
  }
}

/** Change a schema's type while keeping what survives (description). */
function retype(s: JS | undefined, type: TypeName): JS {
  const next = blank(type);
  if (s?.description) next.description = s.description;
  return next;
}

const inputCls =
  "glass min-w-0 rounded-md px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]";
const TYPE_HUES: Record<TypeName, string> = {
  string: "var(--color-type-string)",
  number: "var(--color-type-number)",
  boolean: "var(--color-type-boolean)",
  object: "var(--color-type-object)",
  array: "var(--color-type-array)",
  any: "var(--color-type-any)",
};

function TypeSelect({ value, onChange, label }: { value: TypeName; onChange: (t: TypeName) => void; label?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as TypeName)}
      aria-label={label ?? "Type"}
      className="glass shrink-0 rounded-md px-1.5 py-1 font-mono text-[11px] outline-none [&>option]:bg-[var(--bg)]"
      style={{ color: TYPE_HUES[value] }}
    >
      {TYPES.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

/** Per-type constraints (kept to the useful few; raw JSON covers the rest). */
function Constraints({ schema, onChange }: { schema: JS; onChange: (s: JS) => void }) {
  const t = typeOf(schema);
  const set = (k: string, v: unknown) => {
    const next = { ...schema };
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete next[k];
    else next[k] = v;
    onChange(next);
  };

  if (t === "string") {
    return (
      <div className="flex gap-1.5">
        <input
          className={`${inputCls} flex-1`}
          placeholder="enum: a, b, c"
          aria-label="Allowed values (comma separated)"
          value={Array.isArray(schema.enum) ? schema.enum.join(", ") : ""}
          onChange={(e) => set("enum", e.target.value.split(",").map((p) => p.trim()).filter(Boolean))}
        />
        <input
          className={`${inputCls} flex-1`}
          placeholder="pattern (regex)"
          aria-label="Pattern"
          value={schema.pattern ?? ""}
          onChange={(e) => set("pattern", e.target.value)}
        />
      </div>
    );
  }
  if (t === "number") {
    return (
      <div className="flex gap-1.5">
        <input type="number" className={`${inputCls} flex-1`} placeholder="min" aria-label="Minimum" value={schema.minimum ?? ""} onChange={(e) => set("minimum", e.target.value === "" ? undefined : Number(e.target.value))} />
        <input type="number" className={`${inputCls} flex-1`} placeholder="max" aria-label="Maximum" value={schema.maximum ?? ""} onChange={(e) => set("maximum", e.target.value === "" ? undefined : Number(e.target.value))} />
      </div>
    );
  }
  if (t === "array") {
    const items: JS = schema.items ?? {};
    return (
      <div className="flex items-start gap-1.5">
        <span className="text-muted py-1 text-[10px]">items</span>
        <div className="min-w-0 flex-1">
          <SchemaNode schema={items} onChange={(s) => onChange({ ...schema, items: s })} />
        </div>
      </div>
    );
  }
  if (t === "object") {
    return <Fields schema={schema} onChange={onChange} />;
  }
  return null;
}

/** The fields of an object schema: name / type / required / constraints. */
function Fields({ schema, onChange }: { schema: JS; onChange: (s: JS) => void }) {
  const props: Record<string, JS> = schema.properties ?? {};
  const required: string[] = schema.required ?? [];
  const names = Object.keys(props);

  const commit = (nextProps: Record<string, JS>, nextRequired: string[]) => {
    const next: JS = { ...schema, type: "object", properties: nextProps };
    if (nextRequired.length) next.required = nextRequired;
    else delete next.required;
    onChange(next);
  };

  const rename = (from: string, to: string) => {
    if (!to || (to !== from && props[to])) return; // empty/duplicate names refused
    const nextProps: Record<string, JS> = {};
    for (const n of names) nextProps[n === from ? to : n] = props[n]!; // keep order
    commit(nextProps, required.map((r) => (r === from ? to : r)));
  };

  const addField = () => {
    let name = "field";
    let i = 1;
    while (props[name]) name = `field${++i}`;
    commit({ ...props, [name]: { type: "string" } }, required);
  };

  return (
    <div className="space-y-1.5">
      {names.map((name) => {
        const field = props[name]!;
        const isReq = required.includes(name);
        const t = typeOf(field);
        return (
          <div key={name} className="rounded-lg border hairline p-1.5">
            <div className="flex items-center gap-1.5">
              <FieldName name={name} onRename={(to) => rename(name, to)} />
              <TypeSelect value={t} onChange={(nt) => commit({ ...props, [name]: retype(field, nt) }, required)} label={`Type of ${name}`} />
              <button
                type="button"
                aria-label={`${name} is ${isReq ? "required" : "optional"} — toggle`}
                {...tip(isReq ? "Required — click to make optional" : "Optional — click to require")}
                onClick={() => commit(props, isReq ? required.filter((r) => r !== name) : [...required, name])}
                className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${isReq ? "bg-[var(--color-neon-amber)]/20 text-[var(--color-neon-amber)]" : "text-muted hover:bg-white/10"}`}
              >
                ＊
              </button>
              <button
                type="button"
                aria-label={`Remove field ${name}`}
                onClick={() => {
                  const { [name]: _gone, ...rest } = props;
                  commit(rest, required.filter((r) => r !== name));
                }}
                className="text-muted shrink-0 rounded p-1 hover:text-[var(--color-neon-pink)]"
              >
                <Trash2 size={11} />
              </button>
            </div>
            <FieldDetails field={field} onChange={(s) => commit({ ...props, [name]: s }, required)} />
          </div>
        );
      })}
      <button type="button" onClick={addField} className="text-muted flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] hover:bg-white/5 hover:text-[var(--fg)]">
        <Plus size={11} /> add field
      </button>
    </div>
  );
}

/** Editable field name that commits on blur/Enter (keeps typing smooth). */
function FieldName({ name, onRename }: { name: string; onRename: (to: string) => void }) {
  const [draft, setDraft] = useState(name);
  if (draft !== name && document.activeElement?.getAttribute("data-field") !== name) {
    // External rename (e.g. undo) while unfocused → resync.
    setDraft(name);
  }
  return (
    <input
      data-field={name}
      className={`${inputCls} flex-1`}
      value={draft}
      aria-label="Field name"
      onChange={(e) => setDraft(e.target.value.replace(/[^\w.-]/g, ""))}
      onBlur={() => draft !== name && onRename(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** Constraint area + description for one field (below its header row). */
function FieldDetails({ field, onChange }: { field: JS; onChange: (s: JS) => void }) {
  const t = typeOf(field);
  const hasConstraints = t !== "boolean" && t !== "any";
  return (
    <div className="mt-1.5 space-y-1.5">
      {hasConstraints && t !== "object" && t !== "array" && <Constraints schema={field} onChange={onChange} />}
      {(t === "object" || t === "array") && (
        <div className="ml-2 border-l hairline pl-2">
          <Constraints schema={field} onChange={onChange} />
        </div>
      )}
      <input
        className={`${inputCls} w-full`}
        placeholder="description (optional)"
        aria-label="Description"
        value={field.description ?? ""}
        onChange={(e) => {
          const next = { ...field };
          if (e.target.value) next.description = e.target.value;
          else delete next.description;
          onChange(next);
        }}
      />
    </div>
  );
}

/** One schema node: type + its constraints (recursive). */
function SchemaNode({ schema, onChange }: { schema: JS; onChange: (s: JS) => void }) {
  const t = typeOf(schema);
  return (
    <div className="space-y-1.5">
      <TypeSelect value={t} onChange={(nt) => onChange(retype(schema, nt))} />
      <Constraints schema={schema} onChange={onChange} />
    </div>
  );
}

/** The top-level builder: root type + fields + a live JSON Schema preview. */
export function SchemaBuilder({ value, onChange }: { value: JS | undefined; onChange: (s: JS) => void }) {
  const schema: JS = value && typeof value === "object" ? value : { type: "object", properties: {} };
  return (
    <div className="space-y-2">
      <SchemaNode schema={schema} onChange={onChange} />
      <details className="group">
        <summary className="text-muted cursor-pointer text-[10px] select-none hover:text-[var(--fg)]">JSON Schema preview</summary>
        <JsonView value={schema} className="mt-1.5 max-h-48" />
      </details>
    </div>
  );
}
