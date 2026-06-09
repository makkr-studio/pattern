import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

/**
 * A single floating tooltip (glass popover) driven by a tiny store. Attach to any
 * element with the `tip(content)` handlers; the host renders one portal popover
 * positioned under the hovered element. Content may be rich (markdown).
 */
interface TipState {
  content: ReactNode | null;
  rect: { left: number; bottom: number; right: number } | null;
  open: (content: ReactNode, rect: DOMRect) => void;
  close: () => void;
}

const useTipStore = create<TipState>((set) => ({
  content: null,
  rect: null,
  open: (content, r) => set({ content, rect: { left: r.left, bottom: r.bottom, right: r.right } }),
  close: () => set({ content: null, rect: null }),
}));

/** Handlers to spread onto any element to give it a tooltip. */
export function tip(content: ReactNode | undefined | null) {
  if (!content) return {};
  return {
    onMouseEnter: (e: { currentTarget: HTMLElement }) => useTipStore.getState().open(content, e.currentTarget.getBoundingClientRect()),
    onMouseLeave: () => useTipStore.getState().close(),
  };
}

/** Renders the active tooltip. Mount once near the app root. */
export function TooltipHost() {
  const { content, rect, close } = useTipStore();
  const ref = useRef<HTMLDivElement>(null);

  // Close on scroll so it never strands over moved content.
  useEffect(() => {
    if (!content) return;
    const onScroll = () => close();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [content, close]);

  if (!content || !rect) return null;
  // Clamp to viewport width.
  const left = Math.min(rect.left, window.innerWidth - 340);
  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left: Math.max(8, left), top: rect.bottom + 8, maxWidth: 320, zIndex: 200 }}
      className="glass-strong pointer-events-none rounded-lg px-3 py-2 text-xs shadow-2xl"
    >
      {content}
    </div>,
    document.body,
  );
}
