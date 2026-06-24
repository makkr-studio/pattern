import type { OpDefinition } from "@pattern-js/core";
import { modelOp } from "./model.js";
import { textOps } from "./text.js";
import { objectOps } from "./object.js";
import { embedOps } from "./embed.js";
import { mediaOps } from "./media.js";

/** The mod-ai op catalog: the model builder + every modality. */
export const aiOps: OpDefinition[] = [modelOp, ...textOps, ...objectOps, ...embedOps, ...mediaOps];
