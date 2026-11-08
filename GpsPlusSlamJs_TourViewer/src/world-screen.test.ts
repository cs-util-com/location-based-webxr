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

  // Why: two overlapping narration circles hand the screen back and
  // forth. The panel a newer one pushed aside must come back once that
  // one closes, built afresh, and its own close must still close it. A
  // build that throws shows nothing, is not tried again, and gives the
  // screen back to the panel it pushed aside.
  it("builds a pushed-aside panel again once the newer one closes", () => {
    const host = document.createElement("div");
    const screen = screenIn(host);
    const log: string[] = [];
    const panelOf = (name: string) => (panel: HTMLElement) => {
      log.push(`build ${name}`);
      panel.textContent = name;
      return () => log.push(`clean ${name}`);
    };
    const closeA = screen.show(panelOf("a"));
    const closeB = screen.show(panelOf("b"));
    closeB();
    expect(host.textContent).toBe("a");
    expect(log).toEqual([
      "build a",
      "clean a",
      "build b",
      "clean b",
      "build a",
    ]);
    closeA();
    expect(host.childElementCount).toBe(0);
    expect(log.at(-1)).toBe("clean a");

    const closeC = screen.show(panelOf("c"));
    expect(() =>
      screen.show(() => {
        throw new Error("no card");
      }),
    ).toThrow("no card");
    // The failed one is gone, and the panel it pushed aside is back.
    expect(host.textContent).toBe("c");
    expect(log.slice(-3)).toEqual(["build c", "clean c", "build c"]);
    closeC();
    expect(host.childElementCount).toBe(0);
    expect(log.at(-1)).toBe("clean c");
  });

  it("is handed to the parts of a visitor's page only", () => {
    const screen = screenIn(document.createElement("div"));
    const load = () => Promise.resolve(new Blob());
    expect(worldEnv("play", [], load, { screen }).screen).toBe(screen);
    expect(worldEnv("edit", [], load, { screen }).screen).toBeUndefined();
    expect(worldEnv("play", [], load).screen).toBeUndefined();
  });
});
