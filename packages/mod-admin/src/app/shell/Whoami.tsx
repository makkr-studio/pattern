import { useQuery } from "@tanstack/react-query";
import { LogOut, User } from "../components/icon";
import { LOGIN_URL } from "../lib/api";
import { tip } from "../components/Tooltip";

/**
 * Who's signed in + logout, in the sidebar footer area. Renders nothing when
 * the identity mod isn't installed (404/anonymous) — the admin works
 * identity-free. Direct fetch on purpose: /auth/* is the identity mod's
 * mount, not the admin API.
 */
interface Whoami {
  kind: "user" | "anonymous";
  email?: string;
  name?: string;
  roles?: string[];
}

function useWhoami() {
  return useQuery<Whoami | null>({
    queryKey: ["whoami"],
    queryFn: async () => {
      try {
        const res = await fetch("/auth/whoami");
        if (!res.ok) return null;
        return (await res.json()) as Whoami;
      } catch {
        return null; // identity mod absent — chip stays hidden
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function WhoamiChip({ collapsed }: { collapsed: boolean }) {
  const { data } = useWhoami();
  if (!data || data.kind !== "user") return null;

  const label = data.name || data.email || "Signed in";
  const logout = async () => {
    try {
      await fetch("/auth/logout", { method: "POST" });
    } finally {
      location.assign(`${LOGIN_URL}?next=${encodeURIComponent("/admin")}`);
    }
  };

  return (
    <div
      className={`glass text-muted mt-2 flex items-center rounded-xl text-sm ${collapsed ? "flex-col gap-1 p-2" : "gap-2 px-3 py-2"}`}
    >
      <span className="flex shrink-0" {...(collapsed ? tip(label) : {})}>
        <User size={14} className="text-[var(--color-neon-cyan)]" />
      </span>
      {!collapsed && (
        <span className="min-w-0 flex-1 truncate" title={data.email}>
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={() => void logout()}
        aria-label="Sign out"
        {...tip("Sign out")}
        className="rounded-lg p-1 hover:bg-white/10 hover:text-[var(--fg)]"
      >
        <LogOut size={13} />
      </button>
    </div>
  );
}
