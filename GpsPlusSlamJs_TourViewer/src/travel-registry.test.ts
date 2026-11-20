import { describe, expect, it } from "vitest";

import { createTravelRegistry } from "./travel-registry.js";
import type { TravelHit } from "./travelling-box.js";

function fake(name: string, hit: TravelHit | null, log: string[]) {
  return {
    owns: false,
    frame: () => log.push(`frame ${name}`),
    hit: () => hit,
    pointerDown: () => {
      log.push(`down ${name}`);
      return true;
    },
    ownsTap(): boolean {
      return this.owns;
    },
    pressing: () => false,
  };
}

const E = { pointerId: 1, clientX: 10, clientY: 10 };
const TARGET = new (class extends EventTarget {
  setPointerCapture(): void {}
})();

describe("createTravelRegistry", () => {
  // Why this test matters: a quad is drawn over the whole world, so a
  // finger on it must reach it, never a plate behind it; between plates
  // the nearest is the one seen.
  it("gives the press to a quad first, then to the nearest plate", () => {
    const log: string[] = [];
    const reg = createTravelRegistry();
    reg.add(fake("far", { quad: false, depth: 9, linePx: 5 }, log));
    reg.add(fake("near", { quad: false, depth: 3, linePx: 5 }, log));
    reg.add(fake("miss", null, log));
    expect(reg.pointerDown(E, TARGET)).toBe(true);
    expect(log).toEqual(["down near"]);
    reg.add(fake("quad", { quad: true, depth: 0, linePx: 5 }, log));
    reg.pointerDown(E, TARGET);
    expect(log.at(-1)).toBe("down quad");
  });

  it("takes no press when no words are under the pointer", () => {
    const reg = createTravelRegistry();
    reg.add(fake("miss", null, []));
    expect(reg.pointerDown(E, TARGET)).toBe(false);
  });

  // Why: the page calls frame() once per animation frame and on store
  // dispatches; each box runs once per call and never re-enters.
  it("runs each box once a frame, never from inside one", () => {
    const log: string[] = [];
    const reg = createTravelRegistry();
    const a = fake("a", null, log);
    reg.add(a);
    const b = fake("b", null, log);
    b.frame = () => {
      log.push("frame b");
      reg.frame();
      return log.length;
    };
    const remove = reg.add(b);
    reg.frame();
    expect(log).toEqual(["frame a", "frame b"]);
    remove();
    reg.frame();
    expect(log).toEqual(["frame a", "frame b", "frame a"]);
    expect(reg.size()).toBe(1);
  });

  // Why: the page cancels the XR select while a finger is on the words,
  // so a drag over the world never also taps it.
  it("is pressing while any box is", () => {
    const reg = createTravelRegistry();
    const a = {
      ...fake("a", null, []),
      down: false,
      pressing(): boolean {
        return this.down;
      },
    };
    reg.add(a);
    expect(reg.pressing()).toBe(false);
    a.down = true;
    expect(reg.pressing()).toBe(true);
  });

  it("owns a tap while any box does", () => {
    const reg = createTravelRegistry();
    const a = fake("a", null, []);
    const b = fake("b", null, []);
    reg.add(a);
    reg.add(b);
    expect(reg.ownsTap()).toBe(false);
    b.owns = true;
    expect(reg.ownsTap()).toBe(true);
  });

  // Why: quads are drawn in the order they were added, so on a tie the
  // later one is the one on top and the one the finger sees.
  it("gives a tie between quads to the later one, as drawn", () => {
    const log: string[] = [];
    const reg = createTravelRegistry();
    reg.add(fake("first", { quad: true, depth: 0, linePx: 5 }, log));
    reg.add(fake("later", { quad: true, depth: 0, linePx: 5 }, log));
    reg.pointerDown(E, TARGET);
    expect(log).toEqual(["down later"]);
  });
});
