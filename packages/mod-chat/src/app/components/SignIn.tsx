/**
 * Sign-in gate — shown instead of the app when the server says auth is
 * required and the caller is anonymous (CHAT_REQUIRE_AUTH). One field, one
 * promise: type your email, get a link, the link brings you back here signed
 * in. The response is identical whether the address exists or not, so the
 * card never claims more than "if that address is known, a link is coming".
 */

import React, { useState } from "react";
import { requestMagicLink } from "../lib/api";
import { brandTitle } from "../lib/config";
import type { Me } from "../lib/types";

export function SignIn({ me, onDismiss }: { me: Me; onDismiss?: () => void }) {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || phase === "sending") return;
    setPhase("sending");
    try {
      await requestMagicLink(me.login.requestPath, email.trim());
      setPhase("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div
        className="w-full max-w-[24rem] rounded-2xl border px-7 py-8"
        style={{ borderColor: "var(--line)", background: "var(--bg-raised)" }}
      >
        <div className="mb-5 flex items-center gap-2.5">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="6" cy="6" r="2.4" fill="var(--accent)" />
            <circle cx="18" cy="9" r="2.4" fill="var(--fg-faint)" />
            <circle cx="9" cy="18" r="2.4" fill="var(--fg-faint)" />
            <path d="M8 7.2 15.8 8.6M7.2 8.2 8.6 15.8M16.3 11l-5.6 5.4" stroke="var(--fg-faint)" strokeWidth="1.3" />
          </svg>
          <span className="text-[16px] font-semibold tracking-tight">{brandTitle}</span>
        </div>

        {phase === "sent" ? (
          <div>
            <h1 className="text-[15px] font-medium">Check your inbox</h1>
            <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: "var(--fg-soft)" }}>
              If <span style={{ color: "var(--fg)" }}>{email.trim()}</span> is a known address, a
              sign-in link is on its way. The link brings you straight back here.
            </p>
            <button
              onClick={() => setPhase("idle")}
              className="mt-4 text-[12.5px] underline-offset-2 hover:underline"
              style={{ color: "var(--fg-faint)" }}
            >
              Use a different address
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h1 className="text-[15px] font-medium">Sign in to continue</h1>
            <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: "var(--fg-soft)" }}>
              {onDismiss
                ? "Keep your conversations under your account, across devices. We’ll email you a one-time sign-in link."
                : "This chat is private. Enter your email and we’ll send you a one-time sign-in link."}
            </p>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-4 w-full rounded-lg border px-3 py-2 text-[14px] outline-none transition-colors focus:border-[var(--accent)]"
              style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--fg)" }}
            />
            <button
              type="submit"
              disabled={phase === "sending"}
              className="mt-3 w-full rounded-lg px-3 py-2 text-[13.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {phase === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
            {phase === "error" && (
              <p className="mt-2.5 text-[12.5px]" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            )}
          </form>
        )}

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="mt-4 text-[12.5px] underline-offset-2 hover:underline"
            style={{ color: "var(--fg-faint)" }}
          >
            ← Continue as guest
          </button>
        )}
      </div>
    </div>
  );
}
