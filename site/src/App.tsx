import { useCallback, useState } from "react";
import { SiteHeader } from "./components/SiteHeader";
import { Hero } from "./sections/Hero";
import { WorkflowsAreData } from "./sections/WorkflowsAreData";
import { OpsSection } from "./sections/OpsSection";
import { EdgeKindsToy } from "./sections/EdgeKindsToy";
import { MiniEditorSection } from "./sections/MiniEditorSection";
import { DxAxSection } from "./sections/DxAxSection";
import { Ecosystem } from "./sections/Ecosystem";
import { EditsItself } from "./sections/EditsItself";
import { FinalCta } from "./sections/FinalCta";
import { KonamiFx } from "./components/KonamiFx";
import { useKonami } from "./lib/konami";
import { sfx } from "./lib/sfx";

export function App() {
  const [spin, setSpin] = useState(false);
  const [fxKey, setFxKey] = useState(0);
  const [fxOn, setFxOn] = useState(false);
  const onKonami = useCallback(() => {
    setSpin(true);
    setFxKey((k) => k + 1);
    setFxOn(true);
    sfx.play("konami");
    setTimeout(() => setSpin(false), 6000);
  }, []);
  const onFxDone = useCallback(() => setFxOn(false), []);
  useKonami(onKonami);

  return (
    <>
      <SiteHeader />
      <main>
        <Hero spin={spin} />
        <WorkflowsAreData />
        <OpsSection />
        <EdgeKindsToy />
        <MiniEditorSection />
        <DxAxSection />
        <Ecosystem />
        <EditsItself />
        <FinalCta />
      </main>
      {fxOn && <KonamiFx key={fxKey} onDone={onFxDone} />}
    </>
  );
}
