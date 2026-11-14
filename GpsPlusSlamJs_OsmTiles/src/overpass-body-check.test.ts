import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  checkOverpassBody,
  checkOverpassTail,
  BODY_HEAD_BYTES,
} from "./overpass-body-check";
import { REAL_TAIL_A, REAL_TAIL_B } from "./testing/overpass-tails";

// Why these tests matter: Overpass can answer HTTP 200 with a `remark`
// ("runtime error: Query timed out") and only part of the elements. A
// stored tile is served to every later client for as long as it lives, so a
// partial answer must never be stored. The check reads only the head and the
// tail of the bytes (no JSON.parse: on the Workers Free plan a fill has
// 10 ms of CPU), so these tests pin what those two windows must show.

const encoder = new TextEncoder();

function body(elements: string, end = "\n\n  ]\n}\n"): Uint8Array {
  return encoder.encode(
    `{\n  "version": 0.6,\n  "generator": "Overpass API 0.7.62.7",\n  "osm3s": {\n    "timestamp_osm_base": "2026-11-11T09:12:34Z",\n    "copyright": "The data included in this document is from www.openstreetmap.org. The data is made available under ODbL."\n  },\n  "elements": [\n${elements}${end}`,
  );
}

const ELEMENT = `{\n  "type": "node",\n  "id": 1,\n  "lat": 50.9,\n  "lon": 6.9,\n  "tags": {\n    "amenity": "bench"\n  }\n}`;

describe("checkOverpassTail on real operator answers", () => {
  // Why: the fill's tail pattern was written from one layout; these are the
  // ends of answers two operator versions actually sent for the tile query.
  it("accepts both real tails", () => {
    expect(checkOverpassTail(REAL_TAIL_A)).toEqual({ ok: true });
    expect(checkOverpassTail(REAL_TAIL_B)).toEqual({ ok: true });
  });

  it("refuses them cut after the last element or carrying a remark", () => {
    for (const tail of [REAL_TAIL_A, REAL_TAIL_B]) {
      const cut = tail.slice(0, tail.lastIndexOf("]"));
      expect(checkOverpassTail(cut)).toEqual({
        ok: false,
        reason: "incomplete",
      });
      const remark = tail.replace(/\]\s*\}\s*$/, '],\n  "remark": "x"\n}\n');
      expect(checkOverpassTail(remark)).toEqual({
        ok: false,
        reason: "remark",
      });
    }
  });
});

describe("checkOverpassBody", () => {
  it("accepts a complete answer and reads its data age", () => {
    expect(checkOverpassBody(body(ELEMENT))).toEqual({
      ok: true,
      osmBase: "2026-11-11T09:12:34Z",
    });
  });

  it("accepts an empty tile (empty tiles are legitimate)", () => {
    expect(checkOverpassBody(body("")).ok).toBe(true);
  });

  it("refuses a 200 that carries a runtime-error remark", () => {
    const partial = body(
      ELEMENT,
      `\n\n  ],\n  "remark": "runtime error: Query timed out in \\"query\\" at line 3 after 181 seconds."\n}\n`,
    );
    expect(checkOverpassBody(partial)).toEqual({
      ok: false,
      reason: "remark",
    });
  });

  it("refuses a body cut off mid-stream", () => {
    const whole = body(ELEMENT.repeat(3));
    expect(checkOverpassBody(whole.subarray(0, whole.length - 20))).toEqual({
      ok: false,
      reason: "incomplete",
    });
  });

  it("refuses an HTML error page served with 200", () => {
    expect(
      checkOverpassBody(encoder.encode("<html><body>Too busy</body></html>")),
    ).toEqual({ ok: false, reason: "not-json" });
  });

  it("refuses an answer without the data timestamp (newer-not-older needs it)", () => {
    const noBase = encoder.encode(`{"version":0.6,"elements":[\n\n  ]\n}\n`);
    expect(checkOverpassBody(noBase)).toEqual({
      ok: false,
      reason: "no-timestamp",
    });
  });

  it("does not mistake an OSM tag named remark inside the last element for an Overpass remark", () => {
    const tagged = `{\n  "type": "node",\n  "id": 2,\n  "lat": 1,\n  "lon": 2,\n  "tags": {\n    "remark": "old mill"\n  }\n}`;
    expect(checkOverpassBody(body(tagged)).ok).toBe(true);
  });

  it("property: a big answer is judged by its tail, whatever sits in the middle", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400 }),
        fc.boolean(),
        (count, cut) => {
          const whole = body(Array(count).fill(ELEMENT).join(",\n"));
          const bytes = cut ? whole.subarray(0, whole.length - 3) : whole;
          expect(checkOverpassBody(bytes).ok).toBe(!cut);
        },
      ),
    );
  });

  it("reads the timestamp only inside the head window", () => {
    // Overpass writes `osm3s` first; the window is what keeps the check's
    // cost flat. A timestamp pushed past it is not searched for.
    const pad = " ".repeat(BODY_HEAD_BYTES);
    const late = encoder.encode(
      `{${pad}"osm3s": {"timestamp_osm_base": "2026-11-11T09:12:34Z"},\n  "elements": [\n\n\n  ]\n}\n`,
    );
    expect(checkOverpassBody(late)).toEqual({
      ok: false,
      reason: "no-timestamp",
    });
  });

  // The end of a real answer, as the deployed Worker stored it: the last
  // element closes at column 0, a blank line follows, then the array and the
  // object close. An element's own arrays (`nodes`, `geometry`, `members`)
  // close with `]` and `}` too, but never after a blank line, so a body cut
  // right after such an element must not pass for complete.
  const UNTAGGED_WAY = `{\n  "type": "way",\n  "id": 3,\n  "nodes": [\n    1,\n    2\n  ],\n  "geometry": [\n    { "lat": 1, "lon": 2 },\n    { "lat": 1.1, "lon": 2.1 }\n  ]\n}`;
  const RELATION = `{\n  "type": "relation",\n  "id": 4,\n  "members": [\n    {\n      "type": "way",\n      "ref": 3,\n      "role": "outer",\n      "geometry": [\n         { "lat": 1, "lon": 2 }\n      ]\n    }\n  ]\n}`;

  function cutAfter(whole: Uint8Array, marker: string): Uint8Array {
    const text = new TextDecoder().decode(whole);
    return encoder.encode(text.slice(0, text.indexOf(marker) + marker.length));
  }

  it("refuses a body cut right after an untagged way (its geometry closes in ] })", () => {
    const whole = body(`${ELEMENT},\n${UNTAGGED_WAY},\n${ELEMENT}`);
    expect(checkOverpassBody(cutAfter(whole, UNTAGGED_WAY))).toEqual({
      ok: false,
      reason: "incomplete",
    });
  });

  it("refuses a body cut inside a relation, right after its members array", () => {
    const whole = body(`${RELATION},\n${ELEMENT}`);
    expect(checkOverpassBody(cutAfter(whole, RELATION)).ok).toBe(false);
  });

  it("accepts a complete answer whose last element is an untagged way", () => {
    expect(checkOverpassBody(body(UNTAGGED_WAY)).ok).toBe(true);
  });

  it("accepts the empty answer exactly as Overpass writes it", () => {
    expect(checkOverpassBody(body("", "\n\n\n  ]\n}\n")).ok).toBe(true);
  });

  it("refuses a data timestamp more than an hour in the future", () => {
    const now = Date.parse("2026-11-11T08:00:00Z");
    expect(checkOverpassBody(body(ELEMENT), now)).toEqual({
      ok: false,
      reason: "future-timestamp",
    });
    const close = Date.parse("2026-11-11T08:13:00Z");
    expect(checkOverpassBody(body(ELEMENT), close).ok).toBe(true);
  });

  it("refuses a data timestamp of the right shape that is not a date", () => {
    // The pattern admits any 20 characters of digits, T, Z, colons and
    // hyphens; a value that does not parse would pass the future check (NaN
    // compares false) and be stored as the tile's data age.
    for (const bad of ["9999-99-99T99:99:99Z", "2026-13-01T00:00:00Z"]) {
      const text = new TextDecoder()
        .decode(body(ELEMENT))
        .replace("2026-11-11T09:12:34Z", bad);
      expect(checkOverpassBody(encoder.encode(text)), bad).toEqual({
        ok: false,
        reason: "no-timestamp",
      });
    }
  });
});
