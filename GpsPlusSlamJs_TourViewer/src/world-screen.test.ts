// @vitest-environment jsdom
/**
 * Why these tests matter: the screen is the one place a world part may
 * put a panel of its own (a narration's player card). Two circles side by
 * side must never stack two cards, a close must not take away a newer
 * panel, and the editor's parts must not be handed a screen at all.
 */
import { describe, expect, it } from "vitest";

import { screenIn, worldEnv } from "./world-part";

describe("screenIn", () => {
  it("shows one panel at a time; a newer one closes the older", () => {
    const host = document.createElement("div");
    const screen = screenIn(host);
    const cleaned: string[] = [];
    const closeA = screen.show((panel) => {
      panel.textContent = "a";
      return () => cleaned.push("a");
    });
    expect(host.textContent).toBe("a");
    const closeB = screen.show((panel) => {
      panel.textContent = "b";
      return () => cleaned.push("b");
    });
    expect(host.textContent).toBe("b");
    expect(cleaned).toEqual(["a"]);
    closeA();
    expect(host.textContent).toBe("b");
    closeB();
    closeB();
    expect(host.childElementCount).toBe(0);
    expect(cleaned).toEqual(["a", "b"]);
  });

  it("is handed to the parts of a visitor's page only", () => {
    const screen = screenIn(document.createElement("div"));
    const load = () => Promise.resolve(new Blob());
    expect(worldEnv("play", [], load, { screen }).screen).toBe(screen);
    expect(worldEnv("edit", [], load, { screen }).screen).toBeUndefined();
    expect(worldEnv("play", [], load).screen).toBeUndefined();
  });
});
