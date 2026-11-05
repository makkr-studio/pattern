/**
 * @pattern-js/mod-vault — the Tier-2 "Secrets" admin page.
 *
 * Same construction as the billing/email pages: the ESM SOURCE of the
 * component, written against the shared `__PATTERN_ADMIN__` global. A
 * write-only surface with three panels — the secrets table (names and dates,
 * never values), add-or-rotate (clears on save; the value is gone from the
 * DOM the moment it's encrypted), and IMPORT .ENV: paste or pick a file, the
 * page previews the parsed NAMES client-side (values never render), one
 * click encrypts the lot. That import is what makes vault-first migration
 * painless for anyone arriving with a filled .env.
 */

export const REMOTE = `
const { React, api, ui } = globalThis.__PATTERN_ADMIN__;
const { GlassPanel, NeonButton, Badge } = ui;
const h = React.createElement;
const inputCls = "glass w-full rounded-lg px-3 py-2 text-sm";

function ago(iso) {
  const ts = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ts)) return "";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return Math.round(s) + "s ago";
  if (s < 5400) return Math.round(s / 60) + "m ago";
  if (s < 129600) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

function Field({ label, children }) {
  return h("label", { className: "block text-sm space-y-1" },
    h("span", { className: "text-muted" }, label),
    children);
}

// Mirrors the server's parseDotenv just enough for an honest PREVIEW — names
// only; the raw text goes to the server, values never touch the page's state.
function previewNames(text) {
  const names = [];
  for (const raw of String(text).split(/\\r?\\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.+)$/.exec(line);
    if (m && m[1] !== "PATTERN_VAULT_KEY") names.push(m[1]);
  }
  return names;
}

function SecretsTable({ rows, reload }) {
  const warning = rows.find((r) => String(r.name).startsWith("⚠"));
  const real = rows.filter((r) => !String(r.name).startsWith("⚠"));
  function del(name) { api.call("DELETE", "/vault/secrets/" + encodeURIComponent(name)).then(reload); }
  return h(GlassPanel, { className: "p-6 space-y-3" },
    h("div", { className: "flex items-center justify-between" },
      h("h3", { className: "font-semibold" }, "Secrets"),
      real.length > 0 && h(Badge, { hue: 200 }, String(real.length))),
    h("p", { className: "text-xs text-muted" },
      "Write-only: names and dates are all this page can show. Same name = rotate. Anything that needs a credential references one of these — accounts, model aliases, workflow vault.read nodes."),
    warning && h("p", { className: "rounded-lg px-3 py-2 text-sm", style: { background: "rgba(255,180,84,.08)", color: "var(--color-neon-amber)" } }, warning.name),
    real.length === 0
      ? h("p", { className: "text-sm text-muted" }, "Nothing stored yet — add one on the right, or import your .env.")
      : h("table", { className: "w-full text-sm" },
          h("thead", null, h("tr", { className: "text-left text-xs text-muted" },
            h("th", { className: "py-1 pr-4 font-normal" }, "Name"),
            h("th", { className: "py-1 pr-4 font-normal" }, "v"),
            h("th", { className: "py-1 pr-4 font-normal" }, "Created"),
            h("th", { className: "py-1 pr-4 font-normal" }, "Rotated"),
            h("th", null))),
          h("tbody", null, real.map((r) =>
            h("tr", { key: r.name, className: "border-t border-white/5" },
              h("td", { className: "py-1.5 pr-4 font-mono text-xs" }, r.name),
              h("td", { className: "py-1.5 pr-4 font-mono text-xs" }, String(r.version)),
              h("td", { className: "py-1.5 pr-4 text-xs text-muted" }, ago(r.created)),
              h("td", { className: "py-1.5 pr-4 text-xs text-muted" }, ago(r.updated)),
              h("td", { className: "py-1.5 text-right" },
                h("button", { className: "text-xs text-muted hover:text-[var(--color-neon-pink)]", onClick: () => del(r.name) }, "Delete")))))));
}

function AddForm({ reload }) {
  const [name, setName] = React.useState("");
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [savedAs, setSavedAs] = React.useState(null);
  function save() {
    if (!name.trim() || !value) return;
    setBusy(true);
    api.call("POST", "/vault/secrets", { name: name.trim(), value })
      .then(() => { setSavedAs(name.trim()); setName(""); setValue(""); reload(); })
      .finally(() => setBusy(false));
  }
  return h(GlassPanel, { className: "p-6 space-y-3" },
    h("h3", { className: "font-semibold" }, "Add or rotate a secret"),
    h(Field, { label: "Name" },
      h("input", { className: inputCls, value: name, placeholder: 'e.g. "OPENAI_API_KEY"', onChange: (e) => setName(e.target.value) })),
    h(Field, { label: "Value" },
      h("input", { className: inputCls, type: "password", value: value, autoComplete: "off",
        placeholder: "encrypted at rest; never displayed again", onChange: (e) => setValue(e.target.value) })),
    h("div", { className: "flex items-center gap-3" },
      h(NeonButton, { onClick: save, disabled: busy || !name.trim() || !value }, busy ? "Encrypting…" : "Encrypt & store"),
      savedAs && h("span", { className: "text-xs", style: { color: "var(--color-neon-lime)" } },
        "✓ " + savedAs + " stored — the value won't be shown again")));
}

function ImportEnv({ reload }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const names = previewNames(text);
  function pickFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { setText(String(r.result || "")); setResult(null); };
    r.readAsText(f);
    e.target.value = "";
  }
  function run() {
    setBusy(true); setResult(null);
    api.call("POST", "/vault/secrets/import", { dotenv: text })
      .then((res) => { const out = (res && res.result) || res; setResult(out); setText(""); reload(); })
      .finally(() => setBusy(false));
  }
  return h(GlassPanel, { className: "p-6 space-y-3" },
    h("h3", { className: "font-semibold" }, "Import .env"),
    h("p", { className: "text-xs text-muted" },
      "Paste a .env (or pick the file) — every KEY=VALUE line becomes an encrypted secret. Comments, blanks and PATTERN_VAULT_KEY are skipped; the values never render here."),
    h("textarea", { className: inputCls + " font-mono", rows: 5, value: text, spellCheck: false,
      placeholder: "OPENAI_API_KEY=sk-…\\nSTRIPE_API_KEY=sk_test_…",
      onChange: (e) => { setText(e.target.value); setResult(null); } }),
    h("div", { className: "flex items-center gap-3 flex-wrap" },
      h(NeonButton, { onClick: run, disabled: busy || names.length === 0 },
        busy ? "Encrypting…" : names.length ? "Encrypt " + names.length + " secret" + (names.length > 1 ? "s" : "") : "Encrypt"),
      h("label", { className: "text-xs text-muted cursor-pointer hover:text-[var(--fg)]" },
        "…or choose a file",
        h("input", { type: "file", style: { display: "none" }, onChange: pickFile }))),
    names.length > 0 && !result && h("p", { className: "text-xs text-muted font-mono" }, "→ " + names.join(", ")),
    result && h("div", { className: "text-xs space-y-1" },
      h("p", { style: { color: "var(--color-neon-lime)" } },
        "✓ imported " + (result.imported || []).length + ": " + (result.imported || []).join(", ")),
      (result.skipped || []).length > 0 && h("p", { className: "text-muted" },
        "skipped " + result.skipped.map((s) => s.name + " (" + s.reason + ")").join(", "))));
}

export default function SecretsPage() {
  const [rows, setRows] = React.useState([]);
  const reload = () => api.call("GET", "/vault/secrets")
    .then((r) => setRows(Array.isArray(r) ? r : (r && r.secrets) || []))
    .catch(() => {});
  React.useEffect(() => { reload(); }, []);
  return h("div", { className: "grid gap-6 lg:grid-cols-2 items-start" },
    h(SecretsTable, { rows, reload }),
    h("div", { className: "space-y-6" },
      h(AddForm, { reload }),
      h(ImportEnv, { reload })));
}
`;
