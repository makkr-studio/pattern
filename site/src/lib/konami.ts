import { useEffect } from "react";

/** The classic sequence. A little delight for the curious. */
const SEQ = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

/** Fires `onTrigger` when the Konami code is entered. */
export function useKonami(onTrigger: () => void): void {
  useEffect(() => {
    let i = 0;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === SEQ[i]) {
        i++;
        if (i === SEQ.length) {
          i = 0;
          onTrigger();
        }
      } else {
        i = key === SEQ[0] ? 1 : 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onTrigger]);
}
