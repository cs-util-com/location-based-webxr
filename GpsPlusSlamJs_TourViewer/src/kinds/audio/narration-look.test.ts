import { describe, expect, it } from "vitest";
import type { BufferGeometry, Points } from "three";

import { narrationLook } from "./narration-look.js";

describe("narrationLook", () => {
  it("rises along its column, repeats each rise and writes in place", () => {
    // Why: the tick runs every frame, so it must write the one position
    // buffer it made rather than build new arrays; the rise must stay on
    // the column and loop.
    const look = narrationLook(6);
    const points = look.object.children.find(
      (c): c is Points => (c as Points).isPoints === true,
    );
    const geometry = points?.geometry as BufferGeometry;
    const buffer = geometry.getAttribute("position").array;
    look.tick(1);
    const atOne = Array.from(buffer);
    look.tick(5);
    expect(geometry.getAttribute("position").array).toBe(buffer);
    Array.from(buffer).forEach((v, i) => {
      expect(v).toBeCloseTo(atOne[i] ?? Number.NaN, 4);
    });
    for (let i = 1; i < buffer.length; i += 3) {
      expect(buffer[i]).toBeGreaterThanOrEqual(0);
      expect(buffer[i]).toBeLessThan(2.4);
    }
    look.dispose();
  });
});
