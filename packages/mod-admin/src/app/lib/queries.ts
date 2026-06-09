import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RunListFilter, WorkflowDoc } from "@pattern/admin-sdk";
import { api } from "./api";

/** Server-state hooks over the admin endpoints. Pages never fetch by hand. */

export const useManifest = () => useQuery({ queryKey: ["manifest"], queryFn: () => api.uiManifest() });
export const useWorkflows = () => useQuery({ queryKey: ["workflows"], queryFn: () => api.workflows.list() });
export const useWorkflow = (slug: string | undefined) =>
  useQuery({ queryKey: ["workflow", slug], queryFn: () => api.workflows.get(slug!), enabled: Boolean(slug) });
export const useOps = () => useQuery({ queryKey: ["ops"], queryFn: () => api.ops.list() });
export const useMods = () => useQuery({ queryKey: ["mods"], queryFn: () => api.mods() });
export const useSystemMap = () => useQuery({ queryKey: ["system"], queryFn: () => api.systemMap() });
export const useTemplates = () => useQuery({ queryKey: ["templates"], queryFn: () => api.templates() });

export const useRuns = (filter: RunListFilter = {}) =>
  useQuery({ queryKey: ["runs", filter], queryFn: () => api.runs.list(filter), refetchInterval: 4000 });
export const useRun = (runId: string | undefined) =>
  useQuery({ queryKey: ["run", runId], queryFn: () => api.runs.get(runId!), enabled: Boolean(runId) });
export const useMetrics = () =>
  useQuery({ queryKey: ["metrics"], queryFn: () => api.metrics(), refetchInterval: 5000 });

export const useVersions = (slug: string | undefined) =>
  useQuery({ queryKey: ["versions", slug], queryFn: () => api.versions.list(slug!), enabled: Boolean(slug) });
export const useDiff = (slug: string | undefined, a: string | undefined, b: string | undefined) =>
  useQuery({
    queryKey: ["diff", slug, a, b],
    queryFn: () => api.versions.diff(slug!, a!, b!),
    enabled: Boolean(slug && a && b),
  });

export function useSaveWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, doc, note }: { slug: string; doc: WorkflowDoc; note?: string }) =>
      api.workflows.save(slug, doc, note),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ["workflows"] });
      void qc.invalidateQueries({ queryKey: ["workflow", v.slug] });
      void qc.invalidateQueries({ queryKey: ["versions", v.slug] });
    },
  });
}

export function useDeploy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, version, swap }: { slug: string; version: string; swap?: boolean }) =>
      api.deploy(slug, version, swap),
    // Deploy moves the live pointer — the workflow detail (meta.live, liveDoc),
    // its version list, and the system map all read it.
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ["workflows"] });
      void qc.invalidateQueries({ queryKey: ["workflow", v.slug] });
      void qc.invalidateQueries({ queryKey: ["versions", v.slug] });
      void qc.invalidateQueries({ queryKey: ["system"] });
    },
  });
}

export function useSetEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, enabled }: { slug: string; enabled: boolean }) => api.workflows.setEnabled(slug, enabled),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ["workflows"] });
      void qc.invalidateQueries({ queryKey: ["workflow", v.slug] });
      void qc.invalidateQueries({ queryKey: ["system"] });
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.workflows.delete(slug),
    onSuccess: (_r, slug) => {
      void qc.invalidateQueries({ queryKey: ["workflows"] });
      void qc.removeQueries({ queryKey: ["workflow", slug] });
      void qc.removeQueries({ queryKey: ["versions", slug] });
      void qc.invalidateQueries({ queryKey: ["system"] });
    },
  });
}
