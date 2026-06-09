import { useId } from "react";

/**
 * A config form generated from a JSON Schema (mod-admin-spec §12) — the
 * `FormFromSchema` kit (not @rjsf). Handles the shapes Zod's `toJSONSchema`
 * emits: object/string/number/integer/boolean/enum/array/nested object, with
 * secret fields masked. Anything it can't model degrades to a JSON field.
 */

type Schema = Record<string, any> | undefined;

export function FormFromSchema({ schema, value, onChange }: { schema: Schema; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
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
      {keys.map((key) => (
        <Field key={key} name={key} schema={props[key]} required={required.includes(key)} value={value[key]} onChange={(v) => set(key, v)} />
      ))}
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
      const arr = Array.isArray(value) ? value : [];
      return (
        <div>
          {label}
          <input
            id={id}
            value={arr.join(", ")}
            placeholder="comma, separated, values"
            onChange={(e) => {
              const parts = e.target.value.split(",").map((p) => p.trim()).filter(Boolean);
              onChange(itemType === "number" ? parts.map(Number) : parts);
            }}
            className={inputCls}
          />
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

function JsonField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  return (
    <textarea
      defaultValue={value === undefined ? "" : JSON.stringify(value)}
      spellCheck={false}
      onChange={(e) => {
        try {
          onChange(e.target.value.trim() ? JSON.parse(e.target.value) : undefined);
        } catch {
          /* keep typing; invalid JSON ignored until valid */
        }
      }}
      className="glass h-16 w-full rounded-lg p-2 font-mono text-xs outline-none"
    />
  );
}

export function RawJson({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  return (
    <div>
      <div className="text-muted mb-1 text-xs">config (JSON)</div>
      <textarea
        defaultValue={JSON.stringify(value ?? {}, null, 2)}
        spellCheck={false}
        onChange={(e) => {
          try {
            onChange(e.target.value.trim() ? JSON.parse(e.target.value) : {});
          } catch {
            /* ignore until valid */
          }
        }}
        className="glass h-40 w-full rounded-lg p-2 font-mono text-xs outline-none"
      />
    </div>
  );
}
