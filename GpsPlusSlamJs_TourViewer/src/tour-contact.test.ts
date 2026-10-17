/**
 * Why these tests matter (tour editor plan 2026-10-17-1816, W2, D15): a
 * visitor whose tour fails had nobody to ask but "the person who put up
 * the poster". A tour may now name a contact, and the visitor's error
 * messages show it as a link - only while an error shows, only a contact a
 * visitor may safely follow (an e-mail address or an http(s) link), and
 * never a script.
 */
import { describe, expect, it } from "vitest";

import { contactLink, renderTourContact } from "./tour-contact.js";

function dom() {
  return {
    line: { hidden: true },
    link: { href: "", textContent: "" },
  };
}

describe("contactLink", () => {
  it("leads an e-mail address to mailto:, shown without it", () => {
    expect(contactLink(" mailto:guide@example.org ")).toEqual({
      href: "mailto:guide@example.org",
      label: "guide@example.org",
    });
  });

  it("leads a web link to itself", () => {
    expect(contactLink("https://example.org/castle")).toEqual({
      href: "https://example.org/castle",
      label: "https://example.org/castle",
    });
  });

  it("gives nothing for no contact, or one a visitor may not follow", () => {
    expect(contactLink(undefined)).toBeNull();
    expect(contactLink("javascript:alert(1)")).toBeNull();
  });
});

describe("renderTourContact", () => {
  it("shows the contact while an error is said", () => {
    const d = dom();
    renderTourContact(d, "The tour could not be read.", "guide@example.org");
    expect(d.line.hidden).toBe(false);
    expect(d.link).toEqual({
      href: "mailto:guide@example.org",
      textContent: "guide@example.org",
    });
  });

  it("hides it without an error, and without a contact", () => {
    const d = dom();
    renderTourContact(d, "Broken.", "guide@example.org");
    renderTourContact(d, "", "guide@example.org");
    expect(d.line.hidden).toBe(true);
    expect(d.link.href).toBe("");
    renderTourContact(d, "Broken.", undefined);
    expect(d.line.hidden).toBe(true);
  });
});
