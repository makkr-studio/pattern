import { useCallback, useState } from "react";
import { SiteHeader } from "./components/SiteHeader";
import { Hero } from "./sections/Hero";
import { WorkflowsAreData } from "./sections/WorkflowsAreData";
import { EdgeKindsToy } from "./sections/EdgeKindsToy";
import { MiniEditorSection } from "./sections/MiniEditorSection";
import { DxAxSection } from "./sections/DxAxSection";
import { Ecosystem } from "./sections/Ecosystem";
import { EditsItself } from "./sections/EditsItself";
import { FinalCta } from "./sections/FinalCta";
import { useKonami } from "./lib/konami";
import { sfx } from "./lib/sfx";

export function App() {
  const [spin, setSpin] = useState(false);
  const onKonami = useCallback(() => {
    setSpin(true);
    sfx.play("deploy");
    setTimeout(() => setSpin(false), 6000);
  }, []);
  useKonami(onKonami);

  return (
    <>
      <SiteHeader />
      <main>
        <Hero spin={spin} />
        <WorkflowsAreData />
        <EdgeKindsToy />
        <MiniEditorSection />
        <DxAxSection />
        <Ecosystem />
        <EditsItself />
        <FinalCta />
      </main>
    </>
  );
}
