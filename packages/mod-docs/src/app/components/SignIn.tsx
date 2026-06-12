/**
 * Sign-in gate — shown when DOCS_REQUIRE_AUTH gates the docs and the reader
 * is anonymous. Email → one-time magic link → straight back into the docs.
 */

import React, { useState } from "react";
import { BookOpen } from "lucide-react";
import { requestMagicLink, type Me } from "../lib/api";

export function SignIn({ me }: { me: Me }) {
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
      <div className="glass w-full max-w-[24rem] rounded-2xl px-7 py-8">
        <div className="mb-5 flex items-center gap-2.5">
          <BookOpen size={18} className="text-[var(--color-neon-cyan)]" />
          <span className="text-[15px] font-semibold tracking-tight">Pattern Docs</span>
        </div>

        {phase === "sent" ? (
          <div>
            <h1 className="text-[15px] font-medium">Check your inbox</h1>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
              If <span style={{ color: "var(--fg)" }}>{email.trim()}</span> is a known address, a
              sign-in link is on its way — it brings you straight back here.
            </p>
            <button onClick={() => setPhase("idle")} className="mt-4 text-[12.5px] text-muted underline-offset-2 hover:underline">
              Use a different address
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h1 className="text-[15px] font-medium">Sign in to read</h1>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
              These docs are private. Enter your email and we&rsquo;ll send a one-time sign-in link.
            </p>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-4 w-full rounded-lg border px-3 py-2 text-[14px] outline-none hairline focus:border-[var(--color-neon-cyan)]"
              style={{ background: "var(--bg)", color: "var(--fg)" }}
            />
            <button
              type="submit"
              disabled={phase === "sending"}
              className="mt-3 w-full rounded-lg px-3 py-2 text-[13.5px] font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--color-neon-cyan)", color: "#06222a" }}
            >
              {phase === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
            {phase === "error" && <p className="mt-2.5 text-[12.5px] text-[var(--color-neon-pink)]">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
