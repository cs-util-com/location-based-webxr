/**
 * Why these tests matter:
 * The strings this escapes reach Leaflet's `bindTooltip`, which renders HTML,
 * and they originate from a publicly editable Google Sheet's column headers.
 * The payload the review found — `<svg onload=x>` — fits inside the 20-character
 * limit `discoverCategories` enforces, so the length cap is not a mitigation.
 *
 * @see escape-html.ts.md
 */

import { describe, it, expect } from "vitest";
import { escapeHtml } from "./escape-html.js";

describe("escapeHtml", () => {
  it("neutralises a tag that fits inside the 20-character category limit", () => {
    const payload = "<svg onload=x>";
    expect(payload.length).toBeLessThanOrEqual(20); // the cap is not a defence
    expect(escapeHtml(payload)).toBe("&lt;svg onload=x&gt;");
  });

  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("escapes quotes, so an attribute context cannot be broken out of", () => {
    // The feature key is interpolated into an href; a bare quote there would
    // end the attribute and start a new one.
    expect(escapeHtml('node/1" onmouseover="evil()')).toBe(
      "node/1&quot; onmouseover=&quot;evil()",
    );
  });

  it("double-escapes an existing entity rather than passing it through", () => {
    // `&` is escaped in the same pass, not first. Displaying a stray `&amp;` is
    // cosmetic; letting an input `&lt;` survive as a literal `<` is a hole.
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
    expect(escapeHtml("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
  });

  it("leaves ordinary category names untouched", () => {
    // The common case must stay legible — this runs on every tooltip.
    expect(escapeHtml("sitting")).toBe("sitting");
    expect(escapeHtml("shade / shelter")).toBe("shade / shelter");
    expect(escapeHtml("Grünfläche")).toBe("Grünfläche");
  });

  it("returns an empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });
});
