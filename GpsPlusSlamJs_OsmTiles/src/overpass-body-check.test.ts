import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkOverpassBody, BODY_HEAD_BYTES } from "./overpass-body-check";

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
    const noBase = encoder.encode(`{"version":0.6,"elements":[\n]\n}\n`);
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

  it("finds the timestamp within the head window", () => {
    expect(BODY_HEAD_BYTES).toBeGreaterThanOrEqual(1024);
  });
});
