/**
 * The open travelling boxes of a page (`travelling-box.ts`, one per open
 * surface) behind the page's three entry points: one `frame()` per
 * animation frame, one `ownsTap` in the visitor's tap routing and one
 * `pointerdown` on the AR root, which goes to the topmost words under the
 * finger.
 *
 * @see travel-registry.ts.md
 */
import type {
  TravelPointer,
  TravelPointerTarget,
  TravellingBox,
} from "./travelling-box.js";

type Entry = Pick<TravellingBox, "frame" | "hit" | "pointerDown" | "ownsTap">;

export interface TravelRegistry {
  /** Adds a box; the returned function takes it out again. */
  add(box: Entry): () => void;
  /** Runs each box's frame once; a call from inside one is a no-op. */
  frame(): void;
  /** Any box owns the current XR select (a press, or its grace). */
  ownsTap(): boolean;
  /** Gives the press to the topmost words under the pointer: a flying or
   *  docked quad over any plate in the world, then the nearest plate. */
  pointerDown(e: TravelPointer, target: TravelPointerTarget): boolean;
  size(): number;
}

export function createTravelRegistry(): TravelRegistry {
  const boxes: Entry[] = [];
  let inFrame = false;
  return {
    add(box) {
      if (!boxes.includes(box)) boxes.push(box);
      return () => {
        const i = boxes.indexOf(box);
        if (i >= 0) boxes.splice(i, 1);
      };
    },
    frame() {
      if (inFrame) return;
      inFrame = true;
      try {
        for (const box of [...boxes]) box.frame();
      } finally {
        inFrame = false;
      }
    },
    ownsTap: () => boxes.some((box) => box.ownsTap()),
    pointerDown(e, target) {
      let best: Entry | null = null;
      let bestQuad = false;
      let bestDepth = Infinity;
      for (const box of boxes) {
        const h = box.hit(e.clientX, e.clientY);
        if (h === null) continue;
        const better =
          best === null ||
          (h.quad && !bestQuad) ||
          (h.quad === bestQuad && h.depth < bestDepth);
        if (better) {
          best = box;
          bestQuad = h.quad;
          bestDepth = h.depth;
        }
      }
      return best !== null && best.pointerDown(e, target);
    },
    size: () => boxes.length,
  };
}
