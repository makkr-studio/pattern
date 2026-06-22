import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { SectionShell } from "../components/SectionShell";
import { Spinner } from "../components/ui";

// Lazy so the editor's code only loads when the section nears the viewport.
const MiniEditor = lazy(() => import("../editor/MiniEditor").then((m) => ({ default: m.MiniEditor })));

export function MiniEditorSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLoad(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <SectionShell
      id="build"
      eyebrow="Try it"
      title="Build your first workflow"
      subtitle="Add a few ops, connect them, and run it. No install. This is the same editor that ships with every Pattern app."
    >
      <div ref={ref}>
        {load ? (
          <Suspense fallback={<div className="grid min-h-[520px] place-items-center"><Spinner /></div>}>
            <MiniEditor />
          </Suspense>
        ) : (
          <div className="grid min-h-[520px] place-items-center text-muted">
            <Spinner />
          </div>
        )}
      </div>
    </SectionShell>
  );
}
