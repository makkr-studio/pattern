import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowRight, Monitor } from "lucide-react";
import { SectionShell } from "../components/SectionShell";
import { GlassPanel, NeonButton, Spinner } from "../components/ui";
import { StaticGraph } from "../graph/StaticGraph";
import { level1Graph } from "../graph/sampleWorkflow";
import { useMediaQuery } from "../lib/use-media-query";

// Lazy so the editor's code only loads when the section nears the viewport.
const MiniEditor = lazy(() => import("../editor/MiniEditor").then((m) => ({ default: m.MiniEditor })));

/** On phones the drag-to-build editor is clunky, so we show a static preview instead. */
function MobilePreview() {
  return (
    <GlassPanel className="flex flex-col items-center gap-6 p-8 text-center">
      <div className="w-full overflow-x-auto">
        <div className="scale-[0.6] origin-top-left" style={{ width: "166%" }}>
          <StaticGraph graph={level1Graph} />
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted">
        <Monitor size={16} /> The interactive builder is best on a larger screen.
      </div>
      <a href="#start">
        <NeonButton>
          Get started <ArrowRight size={16} />
        </NeonButton>
      </a>
    </GlassPanel>
  );
}

export function MiniEditorSection() {
  const desktop = useMediaQuery("(min-width: 768px)");
  const ref = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState(false);

  useEffect(() => {
    if (!desktop) return;
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
  }, [desktop]);

  return (
    <SectionShell
      id="build"
      eyebrow="Try it"
      title="Build your first workflow"
      subtitle="Drag a few ops onto the canvas, link their ports, and run it. No install. This is the same editor that ships with every Pattern app."
    >
      <div ref={ref}>
        {!desktop ? (
          <MobilePreview />
        ) : load ? (
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
