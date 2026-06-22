import { useEffect, useRef, type ReactNode, type HTMLAttributes, type ButtonHTMLAttributes } from "react";
import { motion } from "motion/react";
import { hashHue } from "../lib/format";
import { highlight } from "./JsonCode";
import { sfx } from "../lib/sfx";

/** A frosted glass surface. The core surface language, shared with the product. */
export function GlassPanel({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`glass rounded-2xl ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** A glass card with a soft neon glow on hover (for clickable tiles). */
export function GlowCard({
  className = "",
  children,
  onClick,
  style,
  ...rest
}: { className?: string; children: ReactNode; onClick?: () => void; style?: React.CSSProperties } & Record<`data-${string}`, string>) {
  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: "0 12px 40px rgba(34,211,238,0.18)" }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      onClick={onClick}
      style={style}
      className={`glass rounded-2xl ${onClick ? "cursor-pointer" : ""} ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function NeonButton({
  className = "",
  variant = "solid",
  children,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "ghost" | "danger" }) {
  const base =
    "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed";
  const styles = {
    solid: "text-black bg-[var(--color-neon-cyan)] hover:shadow-[0_0_24px_rgba(34,211,238,0.5)] hover:brightness-110",
    ghost: "glass hover:bg-white/10 text-[var(--fg)]",
    danger: "text-white bg-[var(--color-neon-pink)] hover:shadow-[0_0_24px_rgba(244,114,182,0.5)]",
  }[variant];
  return (
    <button
      className={`${base} ${styles} ${className}`}
      onClick={(e) => {
        sfx.play("click");
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Badge({ children, hue, title }: { children: ReactNode; hue?: number; title?: string }) {
  const h = hue ?? (typeof children === "string" ? hashHue(children) : 200);
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: `hsl(${h} 80% 60% / 0.16)`, color: `hsl(${h} 80% 75%)`, border: `1px solid hsl(${h} 80% 60% / 0.3)` }}
    >
      {children}
    </span>
  );
}

export function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${pulse ? "animate-pulse" : ""}`}
      style={{ background: color, boxShadow: `0 0 8px ${color}` }}
    />
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center p-8 text-muted">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-neon-cyan)] border-t-transparent" />
    </div>
  );
}

/** Read-only JSON with syntax highlighting + a line-number gutter. */
export function JsonView({ value, className = "" }: { value: unknown; className?: string }) {
  const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "undefined");
  const lines = text.split("\n");
  return (
    <div className={`glass overflow-y-auto rounded-xl py-2 font-mono text-xs leading-relaxed ${className}`}>
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span
            aria-hidden
            className="sticky left-0 shrink-0 select-none border-r hairline px-2 text-right text-[var(--fg-muted)]"
            style={{ background: "var(--tip-bg)", opacity: 0.85, minWidth: "2.25rem" }}
          >
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap px-3" style={{ overflowWrap: "anywhere" }}>
            {highlight(line)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    sfx.play("open");
    restoreRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      sfx.play("close");
      window.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-[40px]" onClick={onClose}>
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.97, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className={`glass-strong w-full ${wide ? "max-w-4xl" : "max-w-lg"} rounded-2xl p-6 outline-none`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" aria-label="Close dialog" className="text-muted hover:text-[var(--fg)]" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}
