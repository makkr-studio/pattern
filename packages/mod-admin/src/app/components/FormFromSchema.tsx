import { useId, useState } from "react";
import { JsonCode } from "./JsonCode";

/**
 * A config form generated from a JSON Schema (admin internals §12) — the
 * `FormFromSchema` kit (not @rjsf). Handles the shapes Zod's `toJSONSchema`
 * emits: object/string/number/integer/boolean/enum/array/nested object, with
 * secret fields masked. Anything it can't model degrades to a JSON field.
 */

type Schema = Record<string, any> | undefined;

/** Replace a field's widget (e.g. the visual schema builder for JSON-Schema
 *  valued config fields like http.request's `body`). */
export type FieldOverride = (props: { value: unknown; onChange: (v: unknown) => void }) => React.ReactNode;

export function FormFromSchema({
  schema,
  value,
  onChange,
  overrides,
}: {
  schema: Schema;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  overrides?: Record<string, FieldOverride>;
}) {
  const props: Record<string, Schema> = schema?.type === "object" ? (schema.properties ?? {}) : {};
  const required: string[] = schema?.required ?? [];
  const keys = Object.keys(props);

  if (!schema || keys.length === 0) {
    return <RawJson value={value} onChange={onChange} />;
  }

  const set = (key: string, v: unknown) => {
    const next = { ...value };
    if (v === undefined || v === "") delete next[key];
    else next[key] = v;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {keys.map((key) => {
        const override = overrides?.[key];
        if (override) {
          return (
            <div key={key}>
              <div className="text-muted mb-1 flex items-center gap-1.5 text-xs font-medium">
                <span className="font-mono">{key}</span>
                {required.includes(key) && <span className="text-[var(--color-neon-amber)]">*</span>}
              </div>
              {override({ value: value[key], onChange: (v) => set(key, v) })}
            </div>
          );
        }
        return <Field key={key} name={key} schema={props[key]} required={required.includes(key)} value={value[key]} onChange={(v) => set(key, v)} />;
      })}
    </div>
  );
}

function unwrapSchema(s: Schema): Schema {
  if (!s) return s;
  // anyOf with a null branch = optional; pick the first non-null branch.
  if (Array.isArray(s.anyOf)) return s.anyOf.find((b: Schema) => b?.type !== "null") ?? s.anyOf[0];
  return s;
}

function Field({ name, schema, required, value, onChange }: { name: string; schema: Schema; required: boolean; value: unknown; onChange: (v: unknown) => void }) {
  const s = unwrapSchema(schema);
  const id = useId();
  const label = (
    <label htmlFor={id} className="text-muted mb-1 flex items-center gap-1.5 text-xs font-medium">
      <span className="font-mono">{name}</span>
      {required && <span className="text-[var(--color-neon-amber)]">*</span>}
      {s?.description && <span className="font-normal opacity-70">— {s.description}</span>}
    </label>
  );
  const inputCls = "glass w-full rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]";

  // enum → select
  const enumVals: unknown[] | undefined = s?.enum;
  if (enumVals) {
    return (
      <div>
        {label}
        <select id={id} value={String(value ?? s?.default ?? "")} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          {!required && <option value="">—</option>}
          {enumVals.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const type = s?.type;
  if (type === "boolean") {
    return (
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm">
        <input id={id} type="checkbox" checked={Boolean(value ?? s?.default)} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--color-neon-cyan)]" />
        <span className="font-mono text-xs">{name}</span>
        {s?.description && <span className="text-muted text-xs">{s.description}</span>}
      </label>
    );
  }

  if (type === "number" || type === "integer") {
    return (
      <div>
        {label}
        <input
          id={id}
          type="number"
          value={value === undefined ? "" : String(value)}
          placeholder={s?.default != null ? String(s.default) : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          className={inputCls}
        />
      </div>
    );
  }

  if (type === "string") {
    // `format: "multiline"` → a textarea (paste a document, write a prompt…).
    if (s?.format === "multiline") {
      return (
        <div>
          {label}
          <textarea
            id={id}
            value={String(value ?? "")}
            rows={6}
            placeholder={s?.default != null ? String(s.default) : ""}
            onChange={(e) => onChange(e.target.value)}
            className={`${inputCls} min-h-[120px] resize-y`}
          />
        </div>
      );
    }
    const secret = s?.secret === true || s?.format === "password";
    return (
      <div>
        {label}
        <input
          id={id}
          type={secret ? "password" : "text"}
          value={String(value ?? "")}
          placeholder={s?.default != null ? String(s.default) : secret ? "••••" : ""}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} ${secret ? "font-mono" : ""}`}
        />
      </div>
    );
  }

  if (type === "array") {
    const itemType = unwrapSchema(s?.items)?.type;
    if (itemType === "string" || itemType === "number") {
      return (
        <div>
          {label}
          <CsvField id={id} value={value} numeric={itemType === "number"} onChange={onChange} className={inputCls} />
        </div>
      );
    }
    return (
      <div>
        {label}
        <JsonField value={value} onChange={onChange} />
      </div>
    );
  }

  if (type === "object") {
    return (
      <fieldset className="rounded-lg border hairline p-2.5">
        <legend className="text-muted px-1 font-mono text-xs">{name}</legend>
        <FormFromSchema schema={s} value={(value as Record<string, unknown>) ?? {}} onChange={onChange} />
      </fieldset>
    );
  }

  // Fallback: anything we can't model (unions, unknown) → JSON.
  return (
    <div>
      {label}
      <JsonField value={value} onChange={onChange} />
    </div>
  );
}

/**
 * A JSON field that owns its text while the user types (controlled, so nothing
 * is silently dropped). Only valid JSON propagates via `onChange`; the
 * underlying `JsonCode` shows syntax highlighting + live parse status with
 * line/column, so the user always knows what a Save would use.
 */
function JsonTextarea({
  value,
  onChange,
  rows,
  label,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  rows: string;
  label?: string;
}) {
  const serialized = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [text, setText] = useState(serialized);
  const [dirty, setDirty] = useState(false);
  // External value changed and the user isn't mid-edit → resync.
  if (!dirty && text !== serialized) setText(serialized);

  return (
    <div>
      {label && <div className="text-muted mb-1 text-xs">{label}</div>}
      <JsonCode
        text={text}
        height={rows}
        ariaLabel={label ?? "JSON value"}
        onText={(t) => {
          setText(t);
          setDirty(true);
          try {
            onChange(t.trim() ? JSON.parse(t) : undefined);
          } catch {
            /* surfaced by JsonCode's live status */
          }
        }}
        // After blur, external changes (undo/redo) may resync the text.
        onBlur={() => {
          try {
            if (text.trim()) JSON.parse(text);
            setDirty(false);
          } catch {
            /* keep the user's invalid text on screen */
          }
        }}
      />
    </div>
  );
}

/**
 * Comma-separated list editor for string[]/number[] config. Keeps a DRAFT of
 * the raw text while focused — a fully-controlled input that re-parses every
 * keystroke eats the trailing comma before you can type the next item (the
 * `core.object.build` keys bug). Parses on every change (the canvas updates
 * live) but renders the draft; normalizes on blur.
 */
function CsvField({
  id,
  value,
  numeric,
  onChange,
  className,
}: {
  id: string;
  value: unknown;
  numeric: boolean;
  onChange: (v: unknown) => void;
  className: string;
}) {
  const canonical = (Array.isArray(value) ? value : []).join(", ");
  const [draft, setDraft] = useState<string | null>(null);
  const parse = (text: string) => {
    const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
    onChange(numeric ? parts.map(Number).filter((n) => !Number.isNaN(n)) : parts);
  };
  return (
    <input
      id={id}
      value={draft ?? canonical}
      placeholder="comma, separated, values"
      onFocus={() => setDraft(canonical)}
      onChange={(e) => {
        setDraft(e.target.value);
        parse(e.target.value);
      }}
      onBlur={() => setDraft(null)}
      className={className}
    />
  );
}

function JsonField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  return <JsonTextarea value={value} onChange={onChange} rows="h-16" />;
}

export function RawJson({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  return <JsonTextarea value={value ?? {}} onChange={(v) => onChange((v as Record<string, unknown>) ?? {})} rows="h-40" label="config (JSON)" />;
}
