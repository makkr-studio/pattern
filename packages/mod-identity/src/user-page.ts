/**
 * @pattern-js/mod-identity — the Tier-2 "User" details page.
 *
 * The operator's view of one person: identity card + the actions that matter
 * (sign-in link, disable, log out everywhere, delete), a ROLES editor that
 * knows the configured roles map (checkboxes, not comma syntax) and says out
 * loud that saving signs the user out everywhere, their sessions and run
 * stats — and, duck-typed, their subscription when mod-billing is installed
 * (absent mod, absent panel). Same construction as the billing/email pages:
 * ESM source over the shared `__PATTERN_ADMIN__` global.
 */

export const USER_PAGE_REMOTE = `
const { React, api, ui } = globalThis.__PATTERN_ADMIN__;
const { GlassPanel, NeonButton, Badge, Modal } = ui;
const h = React.createElement;
const inputCls = "glass w-full rounded-lg px-3 py-2 text-sm";

function ago(v) {
  var ts = typeof v === "number" ? v : v ? Date.parse(v) : NaN;
  if (!isFinite(ts)) return "";
  var s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return Math.round(s) + "s ago";
  if (s < 5400) return Math.round(s / 60) + "m ago";
  if (s < 129600) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

function Row({ label, children }) {
  return h("div", { className: "flex items-baseline justify-between gap-6 text-sm" },
    h("span", { className: "text-muted shrink-0 text-xs uppercase tracking-wider" }, label),
    h("span", { className: "min-w-0 break-all text-right font-mono text-xs" }, children));
}

function MiniTable({ title, cols, rows, empty, rowAction }) {
  return h(GlassPanel, { className: "p-6 space-y-3" },
    h("h3", { className: "font-semibold" }, title),
    rows.length === 0
      ? h("p", { className: "text-sm text-muted" }, empty)
      : h("div", { className: "overflow-x-auto" }, h("table", { className: "w-full text-sm" },
          h("thead", null, h("tr", { className: "text-left text-xs text-muted" },
            cols.map((c) => h("th", { key: c.key, className: "py-1 pr-4 font-normal" }, c.label)),
            rowAction ? h("th", null) : null)),
          h("tbody", null, rows.map((r, i) =>
            h("tr", { key: i, className: "border-t border-white/5" },
              cols.map((c) => h("td", { key: c.key, className: "py-1.5 pr-4 text-xs " + (c.mono ? "font-mono" : "") },
                c.render ? c.render(r) : String(r[c.key] == null ? "—" : r[c.key]))),
              rowAction ? h("td", { className: "py-1.5 text-right" },
                h("button", { className: "text-xs text-muted hover:text-[var(--color-neon-pink)]", onClick: () => rowAction.run(r) }, rowAction.label)) : null))))));
}

// ── Roles editor: the configured map as checkboxes + free-form extras ────
function RolesEditor({ user, onSaved }) {
  const known = user.knownRoles || [];
  const [roles, setRoles] = React.useState(user.rolesList || []);
  const [extra, setExtra] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const toggle = (r) => setRoles(roles.indexOf(r) >= 0 ? roles.filter((x) => x !== r) : roles.concat(r));
  const finalRoles = () => roles.concat(extra.split(",").map((s) => s.trim()).filter((s) => s && roles.indexOf(s) < 0));
  const changed = JSON.stringify(finalRoles().slice().sort()) !== JSON.stringify((user.rolesList || []).slice().sort());
  function save() {
    setBusy(true);
    api.call("POST", "/identity/users/" + encodeURIComponent(user["user id"]) + "/roles", { roles: finalRoles().join(",") })
      .then(() => { setConfirming(false); setExtra(""); onSaved(); })
      .finally(() => setBusy(false));
  }
  return h(GlassPanel, { className: "p-6 space-y-3" },
    h("h3", { className: "font-semibold" }, "Roles"),
    h("p", { className: "text-xs text-muted" },
      "Roles become scopes on the next request (the identity roles map). Saving REPLACES the set and signs the user out everywhere."),
    h("div", { className: "space-y-1.5" }, known.map((r) =>
      h("label", { key: r, className: "flex cursor-pointer items-center gap-2 text-sm" },
        h("input", { type: "checkbox", checked: roles.indexOf(r) >= 0, onChange: () => toggle(r) }),
        h("span", { className: "font-mono text-xs" }, r))),
      known.length === 0 && h("p", { className: "text-xs text-muted" }, "No roles map configured — add roles free-form below.")),
    h("input", { className: inputCls, value: extra, placeholder: "extra roles, comma-separated (optional)", onChange: (e) => setExtra(e.target.value) }),
    h(NeonButton, { disabled: !changed || busy, onClick: () => setConfirming(true) }, "Save roles"),
    h(Modal, { open: confirming, onClose: () => setConfirming(false), title: "Replace roles?" },
      h("div", { className: "space-y-4" },
        h("p", { className: "text-sm" },
          "New set: ", h("span", { className: "font-mono text-xs" }, finalRoles().join(", ") || "(none — plain user)"),
          ". This is a privilege change: the user is signed out of every session."),
        h("div", { className: "flex justify-end gap-2" },
          h(NeonButton, { variant: "ghost", onClick: () => setConfirming(false) }, "Cancel"),
          h(NeonButton, { variant: "danger", disabled: busy, onClick: save }, busy ? "Saving…" : "Replace roles")))));
}

// ── The action strip: mint link / disable / log out / delete ─────────────
function Actions({ user, reload }) {
  const id = encodeURIComponent(user["user id"]);
  const [confirm, setConfirm] = React.useState(null); // { label, run, note }
  const [minted, setMinted] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const act = (method, path) => api.call(method, path).then(reload);
  const buttons = [
    { label: "Sign-in link", run: () => api.call("POST", "/identity/users/" + id + "/login-link").then((r) => setMinted((r && (r.result || r.link || r.copy)) || r)) },
    { label: user.disabled ? "Enable" : "Disable", confirm: user.disabled ? "Re-enable this account?" : "The user can't sign in (existing sessions end).", run: () => act("POST", "/identity/users/" + id + "/toggle-disabled") },
    { label: "Log out everywhere", confirm: "Ends every active session for this user.", run: () => act("POST", "/identity/users/" + id + "/revoke-sessions") },
    { label: "Delete", confirm: "Deletes the account permanently.", danger: true, run: () => api.call("DELETE", "/identity/users/" + id).then(() => history.back()) },
  ];
  const fire = (b) => (b.confirm ? setConfirm(b) : b.run());
  const mintedText = minted && (typeof minted === "string" ? minted : (minted.copy || minted.link || JSON.stringify(minted)));
  return h("div", { className: "space-y-3" },
    h("div", { className: "flex flex-wrap gap-2" },
      buttons.map((b) => h(NeonButton, { key: b.label, variant: b.danger ? "danger" : "ghost", disabled: busy, onClick: () => fire(b) }, b.label))),
    mintedText && h("div", { className: "flex items-center gap-2" },
      h("input", { readOnly: true, value: String(mintedText).startsWith("/") ? location.origin + mintedText : mintedText,
        onFocus: (e) => e.currentTarget.select(), className: "glass min-w-0 flex-1 rounded-lg px-3 py-2 font-mono text-xs" }),
      h(NeonButton, { onClick: () => { navigator.clipboard && navigator.clipboard.writeText(String(mintedText).startsWith("/") ? location.origin + mintedText : mintedText); } }, "Copy")),
    h(Modal, { open: confirm !== null, onClose: () => setConfirm(null), title: confirm ? confirm.label : "" },
      confirm && h("div", { className: "space-y-4" },
        h("p", { className: "text-sm" }, confirm.confirm),
        h("div", { className: "flex justify-end gap-2" },
          h(NeonButton, { variant: "ghost", onClick: () => setConfirm(null) }, "Cancel"),
          h(NeonButton, { variant: "danger", disabled: busy, onClick: () => { setBusy(true); Promise.resolve(confirm.run()).finally(() => { setBusy(false); setConfirm(null); }); } }, confirm.label)))));
}

// ── Billing, duck-typed: present ⇒ a panel; absent ⇒ nothing ────────────
function BillingPanel({ userId }) {
  const [state, setState] = React.useState({ probed: false, row: null });
  React.useEffect(() => {
    api.call("GET", "/billing/api/customers")
      .then((r) => {
        const rows = Array.isArray(r) ? r : (r && r.customers) || [];
        setState({ probed: true, row: rows.find((c) => c.userId === userId) || null });
      })
      .catch(() => setState({ probed: false, row: null }));
  }, [userId]);
  if (!state.probed) return null;
  return h(GlassPanel, { className: "p-6 space-y-3" },
    h("h3", { className: "font-semibold" }, "Subscription"),
    state.row
      ? h("div", { className: "space-y-2" },
          h(Row, { label: "Status" }, h(Badge, null, String(state.row.status || "—"))),
          h(Row, { label: "Entitled" }, state.row.entitled === true || state.row.entitled === "yes" ? "yes" : "no"),
          h(Row, { label: "Plan" }, String(state.row.priceKeys || "—")),
          h(Row, { label: "Owns" }, String(state.row.purchased || "—")),
          h(Row, { label: "Customer" }, String(state.row.customerId || "—")),
          h(Row, { label: "Updated" }, ago(state.row.updatedAt) || "—"))
      : h("p", { className: "text-sm text-muted" }, "No subscription — this user has never completed a checkout."));
}

export default function UserPage({ params }) {
  const userId = (params && params.userId) || decodeURIComponent(location.pathname.split("/").pop() || "");
  const [user, setUser] = React.useState(null);
  const [sessions, setSessions] = React.useState([]);
  const [stats, setStats] = React.useState([]);
  const [error, setError] = React.useState(false);
  const id = encodeURIComponent(userId);

  const reload = () => Promise.all([
    api.call("GET", "/identity/users/" + id).then((r) => setUser((r && r.user) || r)),
    api.call("GET", "/identity/users/" + id + "/sessions").then((r) => setSessions(Array.isArray(r) ? r : (r && r.sessions) || [])),
    api.call("GET", "/identity/users/" + id + "/run-stats").then((r) => setStats(Array.isArray(r) ? r : (r && r.stats) || [])).catch(() => {}),
  ]).catch(() => setError(true));
  React.useEffect(() => { reload(); }, [userId]);

  if (error) return h(GlassPanel, { className: "p-6 text-sm", style: { color: "var(--color-neon-pink)" } }, "Couldn't load this user.");
  if (!user) return null;

  const revokeSession = { label: "Revoke", run: (r) => api.call("DELETE", "/identity/sessions/" + encodeURIComponent(r.id)).then(reload) };

  return h("div", { className: "grid gap-6 lg:grid-cols-2 items-start" },
    h("div", { className: "space-y-6" },
      h(GlassPanel, { className: "p-6 space-y-3" },
        h("div", { className: "flex items-center justify-between gap-3" },
          h("div", null,
            h("h3", { className: "font-semibold" }, String(user.email || userId)),
            h("p", { className: "text-xs text-muted mt-0.5" }, String(user.name || ""))),
          user.disabled ? h(Badge, { hue: 340 }, "disabled") : h(Badge, { hue: 140 }, "active")),
        h("div", { className: "space-y-2" },
          h(Row, { label: "Roles" }, String(user.roles || "—")),
          h(Row, { label: "Scopes" }, String(user.scopes || "—")),
          h(Row, { label: "Sessions" }, String(user["active sessions"])),
          h(Row, { label: "Created" }, ago(user.createdAt) || String(user.created || "")),
          h(Row, { label: "Id" }, String(user["user id"]))),
        h(Actions, { user, reload })),
      h(RolesEditor, { key: String(user.roles), user, onSaved: reload })),
    h("div", { className: "space-y-6" },
      h(BillingPanel, { userId: user["user id"] }),
      h(MiniTable, {
        title: "Sessions", empty: "No sessions.",
        cols: [
          { key: "status", label: "Status", render: (r) => h(Badge, null, String(r.status || "—")) },
          { key: "created", label: "Created", render: (r) => ago(r.created) || "—" },
          { key: "lastSeen", label: "Last seen", render: (r) => ago(r.lastSeen) || "—" },
          { key: "userAgent", label: "Device" },
        ],
        rows: sessions, rowAction: revokeSession,
      }),
      h(MiniTable, {
        title: "Runs by workflow (recent window)", empty: "No runs in the retained window.",
        cols: [
          { key: "workflow", label: "Workflow", mono: true },
          { key: "runs", label: "Runs" },
          { key: "errors", label: "Errors" },
          { key: "avg ms", label: "Avg ms" },
          { key: "last run", label: "Last run" },
        ],
        rows: stats,
      })));
}
`;
