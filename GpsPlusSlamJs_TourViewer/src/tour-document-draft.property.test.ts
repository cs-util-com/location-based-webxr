/**
 * Why these properties matter: the settings record keeps the whole frames
 * of the stations a page created, and a reload puts them back before the
 * objects. Any frame may be stored broken (a hand-edited record, a frame
 * of a newer build), and a frame stored by an older build may still name
 * a sibling as its `next`. Over random broken frames with random such
 * names, exactly the readable frames must come back, in their stored
 * order: dropping a good frame would lose its title and steps for
 * nothing, and a name no station field holds any more must neither cost
 * a frame nor reach the written tour.json.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseSettingsRecord } from "./tour-document-draft.js";
import { automaticStationFrame } from "./tour-content.js";

const AT = { lat: 48.52, lon: 9.05, alt: 400 };

/** Frames `s0..s(n-1)`: each may name one other as `next`, and may be broken. */
const records = fc.integer({ min: 1, max: 7 }).chain((n) =>
  fc.record({
    next: fc.array(fc.option(fc.integer({ min: 0, max: n - 1 })), {
      minLength: n,
      maxLength: n,
    }),
    broken: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
  }),
);

describe("parseSettingsRecord, created frames, some broken, some naming a sibling", () => {
  it("keeps exactly the readable frames, in order, none carrying a next", () => {
    fc.assert(
      fc.property(records, ({ next, broken }) => {
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
        const frames = parsed?.createdStations ?? [];
        expect(frames.map((frame) => frame.id)).toEqual(
          next
            .map((_, i) => i)
            .filter((i) => broken[i] !== true)
            .map(id),
        );
        expect(frames.filter((frame) => "next" in frame)).toEqual([]);
      }),
    );
  });
});
