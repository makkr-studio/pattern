import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { sfx } from "../lib/sfx";
import { useReducedMotion } from "../lib/reduced-motion";

/**
 * A faux terminal that types a command out, with a copy button. Typing starts
 * when it first scrolls into view. Reduced motion shows the full command at once.
 */
export function Terminal({ command = "npm create pattern@latest", className = "" }: { command?: string; className?: string }) {
  const reduced = useReducedMotion();
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (started) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setStarted(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    if (reduced) {
      setTyped(command);
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i++;
      setTyped(command.slice(0, i));
      if (i >= command.length) clearInterval(id);
    }, 55);
    return () => clearInterval(id);
  }, [started, command, reduced]);

  const copy = () => {
    void navigator.clipboard?.writeText(command);
    setCopied(true);
    sfx.play("ok");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div ref={ref} className={`glass-strong w-full max-w-md overflow-hidden rounded-xl text-left ${className}`}>
      <div className="flex items-center gap-2 border-b hairline px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#f472b6" }} />
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#fbbf24" }} />
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#a3e635" }} />
        <span className="ml-2 text-[11px] text-muted">bash</span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy command"
          className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-white/10 hover:text-[var(--fg)]"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="px-4 py-3 font-mono text-sm">
        <span className="text-[var(--color-neon-lime)]">$</span> {typed}
        <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-[var(--color-neon-cyan)] align-middle" />
      </pre>
    </div>
  );
}
