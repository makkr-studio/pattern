import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { sfx } from "../lib/sfx";

/** Enable/mute the WebAudio soundscape (muted by default on the site). */
export function SoundToggle() {
  const [muted, setMuted] = useState(() => sfx.muted());
  return (
    <button
      type="button"
      onClick={() => {
        const next = !muted;
        sfx.setMuted(next);
        setMuted(next);
        if (!next) sfx.play("ok");
      }}
      aria-label={muted ? "Enable sound" : "Mute sound"}
      title={muted ? "Enable sound" : "Mute sound"}
      className="grid h-9 w-9 place-items-center rounded-xl border hairline text-muted transition-colors hover:bg-white/10 hover:text-[var(--fg)]"
    >
      {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
    </button>
  );
}
