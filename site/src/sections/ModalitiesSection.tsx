import { type LucideIcon, AudioLines, Boxes, Braces, Film, Image, Mic, Type } from "lucide-react";
import { motion } from "motion/react";
import { SectionShell } from "../components/SectionShell";
import { GlowCard } from "../components/ui";

interface Modality {
  icon: LucideIcon;
  name: string;
  op: string;
  hue: number;
}

const MODALITIES: Modality[] = [
  { icon: Type, name: "Text", op: "ai.text.generate · stream", hue: 199 },
  { icon: Braces, name: "Structured output", op: "ai.object.generate · stream", hue: 210 },
  { icon: Boxes, name: "Embeddings", op: "ai.embed · embed.many", hue: 258 },
  { icon: Image, name: "Image", op: "ai.image.generate", hue: 280 },
  { icon: AudioLines, name: "Speech (TTS)", op: "ai.speech.generate", hue: 320 },
  { icon: Mic, name: "Transcription (STT)", op: "ai.transcribe", hue: 330 },
  { icon: Film, name: "Video", op: "ai.video.generate", hue: 265 },
];

// A sampling of the 40+ first-party providers (every AI SDK provider, plus the gateway).
const PROVIDERS = [
  "AI Gateway", "OpenAI", "Anthropic", "Google", "Azure OpenAI", "Amazon Bedrock", "Vertex AI",
  "xAI", "Mistral", "Groq", "DeepSeek", "Cohere", "Perplexity", "Together", "Fireworks", "Cerebras",
  "Fal", "Luma", "ElevenLabs", "Deepgram", "AssemblyAI", "Replicate",
];

/** The AI capability surface: every modality, across any provider, by alias. */
export function ModalitiesSection() {
  return (
    <SectionShell
      id="ai"
      eyebrow="AI, any provider"
      title="Every modality, any model"
      subtitle="One mod gives your workflows text, structured output, embeddings, image, speech, transcription, and video — across the full first-party AI SDK catalog or the Vercel AI Gateway. Pick models by alias; re-point one in Settings and every workflow and agent retargets instantly."
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {MODALITIES.map((m, i) => (
          <motion.div
            key={m.name}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.4, delay: (i % 3) * 0.05 }}
          >
            <GlowCard className="h-full p-6">
              <div className="flex items-center gap-3">
                <div
                  className="grid h-10 w-10 place-items-center rounded-xl"
                  style={{ background: `hsl(${m.hue} 80% 60% / 0.16)`, color: `hsl(${m.hue} 80% 72%)` }}
                >
                  <m.icon size={19} />
                </div>
                <div>
                  <div className="font-semibold">{m.name}</div>
                  <div className="font-mono text-[11px] text-muted">{m.op}</div>
                </div>
              </div>
            </GlowCard>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.45 }}
        className="mt-8"
      >
        <GlowCard className="p-6">
          <div className="mb-4 text-sm text-muted">
            <span className="font-semibold text-[var(--color-fg,inherit)]">40+ providers</span>, each an optional package
            mod-ai lazy-loads only when you use it. The gateway is built in.
          </div>
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.map((p) => (
              <span
                key={p}
                className="rounded-full border px-3 py-1 text-xs text-muted"
                style={{ borderColor: "var(--color-border, rgba(255,255,255,0.12))" }}
              >
                {p}
              </span>
            ))}
            <span className="rounded-full px-3 py-1 text-xs text-[var(--color-neon-cyan)]">and 20+ more</span>
          </div>
        </GlowCard>
      </motion.div>
    </SectionShell>
  );
}
