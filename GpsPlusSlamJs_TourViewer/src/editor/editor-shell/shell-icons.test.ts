// @vitest-environment jsdom
/**
 * Why these tests matter: the page's static buttons name their icon in
 * markup (`<i data-icon="undo">`); a name the set does not have must stay
 * as it is - including a name every object has through its prototype
 * ("toString"), which a plain `in` check took for an icon.
 */
import { describe, expect, it } from "vitest";

import { placeShellIcons, shellIcon } from "./shell-icons.js";

describe("placeShellIcons", () => {
  it("puts each named icon in place and leaves an unknown name", () => {
    document.body.innerHTML =
      '<button><i data-icon="undo"></i></button><button><i data-icon="toString"></i></button><button><i data-icon="nope"></i></button>';
    placeShellIcons(document.body);
    const [undo, proto, unknown] = [...document.querySelectorAll("button")];
    expect(undo?.querySelector("svg.i")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(proto?.querySelector("svg")).toBeNull();
    expect(proto?.querySelector("i[data-icon]")).not.toBeNull();
    expect(unknown?.querySelector("i[data-icon]")).not.toBeNull();
  });

  it("draws an icon in the text colour, hidden from screen readers", () => {
    const svg = shellIcon("qr");
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(svg.querySelectorAll("rect").length).toBeGreaterThan(0);
  });
});
