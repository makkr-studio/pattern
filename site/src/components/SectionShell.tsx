import { type ReactNode } from "react";
import { motion } from "motion/react";

/** A page section with an optional centered heading block that reveals on scroll. */
export function SectionShell({
  id,
  eyebrow,
  title,
  subtitle,
  children,
  className = "",
  width = "max-w-6xl",
}: {
  id?: string;
  eyebrow?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  className?: string;
  width?: string;
}) {
  return (
    <section id={id} className={`mx-auto w-full ${width} px-6 py-24 ${className}`}>
      {(eyebrow || title || subtitle) && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="mb-12 text-center"
        >
          {eyebrow && <div className="mb-3 text-xs font-medium uppercase tracking-[0.22em] text-[var(--color-neon-cyan)]">{eyebrow}</div>}
          {title && <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h2>}
          {subtitle && <p className="mx-auto mt-4 max-w-2xl text-muted">{subtitle}</p>}
        </motion.div>
      )}
      {children}
    </section>
  );
}
