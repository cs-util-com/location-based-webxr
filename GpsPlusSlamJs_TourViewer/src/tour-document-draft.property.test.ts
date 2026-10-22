/**
 * Why these properties matter: the settings record keeps the whole frames
 * of the stations a page created, and a reload puts them back before the
 * objects. A frame may route to a sibling (its `next`), and any frame may
 * be stored broken (a hand-edited record, a frame of a newer build). Over
 * random route graphs with random broken frames, the frames that come
 * back must never route to a created station the record lost - such a
 * route would reach the written tour.json - and every frame whose routes
 * lead only through readable frames must come back: dropping a good frame
 * would lose its title and steps for nothing.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseSettingsRecord } from "./tour-document-draft.js";
import { automaticStationFrame, routedTo } from "./tour-content.js";

const AT = { lat: 48.52, lon: 9.05, alt: 400 };

/** Frames `s0..s(n-1)`: each may route to one other, and may be broken. */
const graphs = fc.integer({ min: 1, max: 7 }).chain((n) =>
  fc.record({
    next: fc.array(fc.option(fc.integer({ min: 0, max: n - 1 })), {
      minLength: n,
      maxLength: n,
    }),
    broken: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
  }),
);

describe("parseSettingsRecord, created frames over random route graphs", () => {
  it("keeps exactly the frames whose routes lead only through readable frames", () => {
    fc.assert(
      fc.property(graphs, ({ next, broken }) => {
        const id = (i: number) => `s${String(i)}`;
        const stored = next.map((to, i) => {
          const frame = automaticStationFrame(id(i), AT);
          return {
            ...frame,
            ...(to === null ? {} : { next: id(to) }),
            // A latitude stored as a string does not read.
            ...(broken[i] === true ? { geo: { ...frame.geo, lat: "x" } } : {}),
          };
        });
        const parsed = parseSettingsRecord(
          JSON.stringify({ needsNoGps: false, createdStations: stored }),
        );
        const kept = new Set(
          (parsed?.createdStations ?? []).map((frame) => frame.id),
        );
        for (const frame of parsed?.createdStations ?? []) {
          for (const target of routedTo(frame)) {
            expect(kept.has(target)).toBe(true);
          }
        }
        // The model: a frame comes back when it is readable and every frame
        // its route reaches comes back (a route of one link per frame, so
        // following it ends in a cycle, a broken frame or none).
        const survives = (i: number, seen: Set<number>): boolean => {
          if (broken[i] === true) return false;
          const to = next[i];
          if (to === null || to === undefined || seen.has(to)) return true;
          return survives(to, new Set([...seen, i]));
        };
        const expected = next
          .map((_, i) => i)
          .filter((i) => survives(i, new Set([i])))
          .map(id);
        expect([...kept]).toEqual(expected);
      }),
    );
  });
});
