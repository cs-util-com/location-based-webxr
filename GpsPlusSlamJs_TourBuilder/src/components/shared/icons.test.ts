import { describe, expect, it } from "vitest";
import { ICONS } from "./icons.js";

describe("ICONS", () => {
  it("exposes exactly the icon set this composition uses, each as an <svg> string", () => {
    const keys = Object.keys(ICONS).sort();
    expect(keys).toEqual(
      [
        "audio",
        "check",
        "chevron",
        "cube",
        "download",
        "grip",
        "link",
        "photo",
        "pin",
        "route",
        "spinner",
        "text",
        "x",
      ].sort(),
    );
    for (const svg of Object.values(ICONS)) {
      expect(svg.trim().startsWith("<svg")).toBe(true);
      expect(svg.trim().endsWith("</svg>")).toBe(true);
    }
  });
});
