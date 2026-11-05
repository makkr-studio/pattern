/**
 * What the inspector shows when NOTHING is selected: the workflow itself.
 * Identity (name, description, tags) and the execution flags — all part of the
 * document, so editing here dirties the draft exactly like moving a node;
 * Save and Deploy carry them. This replaced the gear modal: the settings a
 * workflow has are one click away, and they read as part of the canvas.
 */

import type { WorkflowDoc } from "@pattern-js/admin-sdk";
import { WorkflowFlags } from "./WorkflowFlags";
import { INPUT_CLS } from "./Inspector";

export interface WorkflowMetaPatch {
  name?: string;
  description?: string;
  tags?: string[];
  offload?: boolean;
  durable?: boolean;
}

export function WorkflowPanel({
  doc,
  isNew,
  readOnly,
  cpuHeavyCount,
  onChange,
}: {
  doc: Pick<WorkflowDoc, "id" | "name" | "description" | "tags" | "offload" | "durable">;
  isNew: boolean;
  /** A code workflow: shown, not editable (fork it to change anything). */
  readOnly: boolean;
  cpuHeavyCount: number;
  onChange: (patch: WorkflowMetaPatch) => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-muted text-xs leading-relaxed">
        {readOnly
          ? "This workflow ships with a mod, so its document is read-only here. Fork it to make it yours."
          : "Nothing selected — these are the workflow's own settings. They save and deploy with the document. Select a node to edit its config instead."}
      </p>

      <div className="space-y-2">
        <div>
          <div className="text-muted mb-1 text-xs">Name</div>
          <input
            className={INPUT_CLS}
            value={doc.name ?? ""}
            placeholder={isNew ? "A short, human name" : doc.id}
            disabled={readOnly}
            onChange={(e) => onChange({ name: e.target.value || undefined })}
          />
        </div>
        <div>
          <div className="text-muted mb-1 text-xs">Description</div>
          <textarea
            className="glass h-16 w-full rounded-lg p-2 text-xs outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
            value={doc.description ?? ""}
            placeholder="What this workflow is for — shows in the catalog and to Buddy."
            disabled={readOnly}
            onChange={(e) => onChange({ description: e.target.value || undefined })}
          />
        </div>
        <div>
          <div className="text-muted mb-1 text-xs">Tags (comma-separated)</div>
          <input
            className={INPUT_CLS}
            value={(doc.tags ?? []).join(", ")}
            placeholder="billing, public-api"
            disabled={readOnly}
            onChange={(e) => {
              const tags = e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);
              onChange({ tags: tags.length ? tags : undefined });
            }}
          />
        </div>
      </div>

      <div>
        <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">Execution</div>
        <WorkflowFlags
          value={{ offload: doc.offload === true, durable: doc.durable === true }}
          cpuHeavyCount={cpuHeavyCount}
          disabled={readOnly}
          onChange={(v) => onChange({ offload: v.offload, durable: v.durable })}
        />
      </div>
    </div>
  );
}
