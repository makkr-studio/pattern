import { describe, it, expect } from "vitest";
import { renderEmailMarkdown } from "../src/markdown.js";

describe("renderEmailMarkdown", () => {
  it("renders the subset: headings, paragraphs, inline formatting", () => {
    const { html, text } = renderEmailMarkdown(
      "# Welcome\n\nHello **there**, this is *italic* and `code`.\n\n## Details\n\nSecond paragraph.",
    );
    expect(html).toContain("<h1");
    expect(html).toContain("Welcome</h1>");
    expect(html).toContain("<strong>there</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code");
    expect(html).toContain("<h2");
    // Everything is inline-styled (email clients ignore stylesheets).
    expect(html).not.toContain("<style");
    expect(html).toContain('style="');
    // Text alternative strips the markers.
    expect(text).toContain("Welcome");
    expect(text).toContain("Hello there, this is italic and code.");
  });

  it("renders links and autolinks bare URLs", () => {
    const { html, text } = renderEmailMarkdown("See [the docs](https://example.com/docs) or https://example.com/raw for more.");
    expect(html).toContain('<a href="https://example.com/docs"');
    expect(html).toContain(">the docs</a>");
    expect(html).toContain('<a href="https://example.com/raw"');
    expect(text).toContain("the docs (https://example.com/docs)");
    expect(text).toContain("https://example.com/raw");
  });

  it("button rule: a paragraph that is exactly one link becomes a button", () => {
    const { html } = renderEmailMarkdown("Click below:\n\n[Sign in](https://h.example/auth?t=1)\n\nThanks!");
    const button = /<a href="https:\/\/h.example\/auth\?t=1" style="([^"]*)">Sign in<\/a>/.exec(html);
    expect(button).toBeTruthy();
    expect(button![1]).toContain("display:inline-block");
    expect(button![1]).toContain("border-radius");
    // A bare URL alone in a paragraph gets the same treatment.
    const bare = renderEmailMarkdown("https://h.example/auth?t=2").html;
    expect(bare).toContain("display:inline-block");
  });

  it("an inline link inside a sentence is NOT a button", () => {
    const { html } = renderEmailMarkdown("Click [here](https://h.example/x) to continue.");
    expect(html).toContain('<a href="https://h.example/x"');
    expect(html).not.toContain("display:inline-block");
  });

  it("blocks unsafe schemes and escapes HTML", () => {
    const { html } = renderEmailMarkdown('Try [click me](javascript:alert(1)) and <script>alert("x")</script>.');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click me"); // the label survives as text
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders fenced code and lists; digits in prose survive the placeholder pass", () => {
    const { html, text } = renderEmailMarkdown(
      "Expires in 15 minutes.\n\n```\nnpm i x\n```\n\n- one\n- two\n\n1. first\n2. second",
    );
    expect(html).toContain("Expires in 15 minutes.");
    expect(html).toContain("<pre");
    expect(html).toContain("npm i x");
    expect(html).toContain("<ul");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<ol");
    expect(html).toContain("<li>first</li>");
    expect(text).toContain("- one");
    expect(text).toContain("1. first");
    expect(text).toContain("npm i x");
  });

  it("wraps the document in a measured, font-styled container", () => {
    const { html } = renderEmailMarkdown("Hi.");
    expect(html).toMatch(/^<div style="max-width:560px/);
    expect(html).toContain("font-family");
  });
});
