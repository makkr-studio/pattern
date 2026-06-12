/** @pattern/mod-docs — public surface. */

export { docsMod } from "./backend/mod.js";
export { default } from "./backend/mod.js";
export { DOCS_ASSETS_FS, DOCS_CONTENT_FS } from "./backend/services.js";
export { resolveOptions, type DocsModOptions, type ResolvedDocsOptions } from "./backend/options.js";
export { DocsContent, parseFrontmatter, sanitizeDocPath, slugOf, type DocsChapter } from "./backend/content.js";
export { docsRouteWorkflows, spaWorkflow } from "./backend/workflows.js";
