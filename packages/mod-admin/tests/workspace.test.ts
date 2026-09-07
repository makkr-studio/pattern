// @vitest-environment happy-dom
/**
 * The workflow workspace store: open tabs, per-tab drafts and viewports in
 * localStorage, the legacy single-draft migration, and the snapshot the strip
 * renders from. Pure storage logic — no React mounted.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowDoc } from "@pattern-js/admin-sdk";
import {
  NEW_KEY,
  closeTab,
  openTab,
  readDraft,
  readTabs,
  readViewport,
  removeDraft,
  renameTab,
  tabKeyOf,
  tabSlugOf,
  writeDraft,
  writeViewport,
} from "../src/app/lib/workspace";

const doc = (id: string): WorkflowDoc => ({ id, name: id, nodes: [], edges: [] });
const draft = (slug: string | null, dirty = false, newSlug?: string) => ({ slug, doc: doc(slug ?? "new"), dirty, at: 1, ...(newSlug ? { newSlug } : {}) });

beforeEach(() => localStorage.clear());

describe("tab keys", () => {
  it("a saved workflow is keyed by slug; the unsaved one by NEW_KEY, which reads as /new in URLs", () => {
    expect(tabKeyOf("greeting")).toBe("greeting");
    expect(tabKeyOf(undefined)).toBe(NEW_KEY);
    expect(tabKeyOf(null)).toBe(NEW_KEY);
    expect(tabSlugOf("greeting")).toBe("greeting");
    expect(tabSlugOf(NEW_KEY)).toBe("new");
  });
});

describe("open tabs", () => {
  it("starts empty and opens idempotently, remembering the last visited", () => {
    expect(readTabs()).toEqual({ open: [] });
    expect(openTab("a")).toEqual(["a"]);
    expect(openTab("b")).toEqual(["a", "b"]);
    expect(openTab("a")).toEqual(["a", "b"]);
    expect(readTabs()).toEqual({ open: ["a", "b"], last: "a" });
  });

  it("closing lands on the tab before, else the one after, else nowhere — and drops the draft + viewport", () => {
    openTab("a");
    openTab("b");
    openTab("c");
    writeDraft("b", draft("b", true));
    writeViewport("b", { x: 1, y: 2, zoom: 1.5 });

    expect(closeTab("b")).toEqual({ open: ["a", "c"], neighbor: "a" });
    expect(readDraft("b")).toBeNull();
    expect(readViewport("b")).toBeNull();

    expect(closeTab("a")).toEqual({ open: ["c"], neighbor: "c" });
    expect(closeTab("c")).toEqual({ open: [], neighbor: null });
    expect(closeTab("ghost")).toEqual({ open: [], neighbor: null });
  });

  it("closing the last-visited tab moves `last` to the neighbor; closing another keeps it", () => {
    openTab("a");
    openTab("b");
    expect(readTabs().last).toBe("b");
    closeTab("b");
    expect(readTabs().last).toBe("a");
    openTab("c"); // last = c
    closeTab("a");
    expect(readTabs()).toEqual({ open: ["c"], last: "c" });
  });

  it("rename (first Save of the new tab) keeps position, dedupes, and follows `last`", () => {
    openTab("a");
    openTab(NEW_KEY);
    renameTab(NEW_KEY, "fresh");
    expect(readTabs()).toEqual({ open: ["a", "fresh"], last: "fresh" });
    // Saving under a slug that is already open collapses the two tabs.
    openTab(NEW_KEY);
    renameTab(NEW_KEY, "a");
    expect(readTabs().open).toEqual(["a", "fresh"]);
  });

  it("tolerates garbage in storage", () => {
    localStorage.setItem("pattern.admin.editor.tabs", "{not json");
    expect(readTabs()).toEqual({ open: [] });
    localStorage.setItem("pattern.admin.editor.tabs", JSON.stringify({ open: ["a", 7, null, "b"] }));
    expect(readTabs().open).toEqual(["a", "b"]);
  });
});

describe("drafts and viewports", () => {
  it("round-trips a draft and rejects one without nodes", () => {
    writeDraft("a", draft("a", true, undefined));
    expect(readDraft("a")).toMatchObject({ slug: "a", dirty: true });
    localStorage.setItem("pattern.admin.editor.draft.bad", JSON.stringify({ slug: "bad", doc: {} }));
    expect(readDraft("bad")).toBeNull();
    removeDraft("a");
    expect(readDraft("a")).toBeNull();
  });

  it("round-trips a viewport and rejects a non-numeric zoom", () => {
    writeViewport("a", { x: 10, y: -4, zoom: 0.8 });
    expect(readViewport("a")).toEqual({ x: 10, y: -4, zoom: 0.8 });
    localStorage.setItem("pattern.admin.editor.viewport.b", JSON.stringify({ x: 0, y: 0, zoom: "big" }));
    expect(readViewport("b")).toBeNull();
  });
});

describe("legacy single-draft migration", () => {
  it("moves the pre-tabs draft into its own open tab exactly once", () => {
    localStorage.setItem("pattern.admin.editor.draft", JSON.stringify(draft("old", true)));
    expect(readTabs()).toEqual({ open: ["old"], last: "old" });
    expect(readDraft("old")).toMatchObject({ slug: "old", dirty: true });
    expect(localStorage.getItem("pattern.admin.editor.draft")).toBeNull();
  });

  it("a legacy draft of a brand-new workflow lands under NEW_KEY", () => {
    localStorage.setItem("pattern.admin.editor.draft", JSON.stringify(draft(null, true, "typed-slug")));
    expect(readTabs().open).toEqual([NEW_KEY]);
    expect(readDraft(NEW_KEY)?.newSlug).toBe("typed-slug");
  });
});
