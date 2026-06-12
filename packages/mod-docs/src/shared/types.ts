/**
 * @pattern/mod-docs — shapes shared between the backend and the SPA.
 *
 * `DocsNavItem` mirrors @pattern/core's contract (re-declared here so the app
 * bundle never imports core). Phase B adds the introspection shapes
 * (OpInfo/PortInfo/ModInfo) used by the generated reference.
 */

export interface DocsNavItem {
  label: string;
  file: string;
  order?: number;
  items?: DocsNavItem[];
}
