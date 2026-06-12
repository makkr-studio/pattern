/**
 * In-app confirmation — replaces window.confirm (browser chrome has no place
 * in this app). Esc cancels, Enter confirms (the danger button holds focus),
 * clicking the scrim cancels.
 */

import React, { useEffect, useRef } from "react";

export function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  detail?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "rgba(20, 16, 12, 0.35)", backdropFilter: "blur(2px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-[22rem] rounded-2xl border px-6 py-5 shadow-xl"
        style={{ borderColor: "var(--line)", background: "var(--bg-raised)" }}
      >
        <h2 className="text-[15px] font-medium" style={{ color: "var(--fg)" }}>
          {title}
        </h2>
        {detail && (
          <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--fg-soft)" }}>
            {detail}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border px-3 py-1.5 text-[13px] transition-colors hover:border-[var(--fg-faint)]"
            style={{ borderColor: "var(--line)", color: "var(--fg-soft)" }}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-white outline-offset-2 transition-opacity hover:opacity-90"
            style={{ background: "var(--danger)", outlineColor: "var(--danger)" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
