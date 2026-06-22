import { useEffect, useState } from "react";

/** True when the OS asks for reduced motion. JS-driven animations (rAF loops,
 *  scroll-linked transforms) must branch on this explicitly — the global CSS
 *  rule only zeroes CSS transition/animation durations. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Reactive variant for components (tracks live OS changes). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
