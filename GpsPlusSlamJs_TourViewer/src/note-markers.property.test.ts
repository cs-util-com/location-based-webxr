/**
 * Why these tests matter: the push that keeps note discs apart moves them
 * after it has decided which are on the screen. Unchecked, a crowd of
 * discs near an edge was pushed off the page while still counted as shown,
 * so a disc the visitor could never tap was drawn past the edge with its
 * leader pointing there. Held only within the screen plus its 20 px slack,
 * a 28 px disc could still sit wholly off it (the r973 review). These
 * properties hold the layout to its promises for any notes at all: a shown
 * disc lies wholly on the screen, so it can be tapped; what was off stays
 * off; a lone note whose disc is on the screen is never moved; and two
 * notes with room around them end the full gap apart.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  layoutNoteMarkers,
  NOTE_DISC_RADIUS_PX,
  NOTE_MIN_GAP_PX,
  type NoteOnScreen,
} from "./note-markers.js";

const screenArb = fc.record({
  width: fc.integer({ min: 120, max: 1600 }),
  height: fc.integer({ min: 120, max: 1600 }),
});

/** Notes anywhere around a screen of up to 1600 px, some behind. */
const notesArb = fc.array(
  fc.record({
    x: fc.double({ min: -200, max: 1800, noNaN: true }),
    y: fc.double({ min: -200, max: 1800, noNaN: true }),
    behind: fc.boolean(),
    facing: fc.double({ min: -1, max: 1, noNaN: true }),
  }),
  { maxLength: 32 },
);

function toNotes(
  raw: readonly { x: number; y: number; behind: boolean; facing: number }[],
): NoteOnScreen[] {
  return raw.map((r, i) => ({
    key: `m#${i}`,
    surface: { x: r.x, y: r.y + 30 },
    marker: { x: r.x, y: r.y },
    behind: r.behind,
    facing: r.facing,
    distanceM: 4,
  }));
}

describe("layoutNoteMarkers, for any notes", () => {
  it("keeps every shown disc wholly on the screen, so it can be tapped", () => {
    fc.assert(
      fc.property(notesArb, screenArb, (raw, screen) => {
        const r = NOTE_DISC_RADIUS_PX;
        for (const p of layoutNoteMarkers(toNotes(raw), screen, null)) {
          if (!p.on) continue;
          // The whole disc, its edge included, inside the screen.
          expect(p.x - r).toBeGreaterThanOrEqual(0);
          expect(p.x + r).toBeLessThanOrEqual(screen.width);
          expect(p.y - r).toBeGreaterThanOrEqual(0);
          expect(p.y + r).toBeLessThanOrEqual(screen.height);
        }
      }),
    );
  });

  it("shows none that is behind the camera, and keeps every leader's foot", () => {
    fc.assert(
      fc.property(notesArb, screenArb, (raw, screen) => {
        const notes = toNotes(raw);
        layoutNoteMarkers(notes, screen, null).forEach((p, i) => {
          expect(notes[i]!.behind && p.on).toBe(false);
          expect(p.surfaceX).toBe(notes[i]!.surface.x);
          expect(p.surfaceY).toBe(notes[i]!.surface.y);
        });
      }),
    );
  });

  it("never moves a lone note whose disc is on the screen", () => {
    fc.assert(
      fc.property(
        screenArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (screen, u, v) => {
          const r = NOTE_DISC_RADIUS_PX;
          const [only] = toNotes([
            {
              x: r + u * (screen.width - 2 * r),
              y: r + v * (screen.height - 2 * r),
              behind: false,
              facing: 1,
            },
          ]);
          const [p] = layoutNoteMarkers([only!], screen, null);
          expect(p!.on).toBe(true);
          expect(p!.x).toBe(only!.marker.x);
          expect(p!.y).toBe(only!.marker.y);
        },
      ),
    );
  });

  it("ends two close notes with room around them the full gap apart", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: NOTE_MIN_GAP_PX - 0.5, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        (d, a) => {
          const screen = { width: 800, height: 800 };
          const raw = [
            { x: 400, y: 400, behind: false, facing: 1 },
            {
              x: 400 + d * Math.cos(a),
              y: 400 + d * Math.sin(a),
              behind: false,
              facing: 1,
            },
          ];
          const [p, q] = layoutNoteMarkers(toNotes(raw), screen, null);
          expect(Math.hypot(q!.x - p!.x, q!.y - p!.y)).toBeGreaterThanOrEqual(
            NOTE_MIN_GAP_PX - 1e-6,
          );
        },
      ),
    );
  });
});
