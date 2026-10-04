/**
 * The globe lab's debug log and export (round-6 plan 2026-10-04-1050 G6-0,
 * DEC-G6-6).
 *
 * Why this test matters: the owner reports what they saw on the phone in
 * audio and pastes this export, so the log is how a report is checked
 * against what the page did. It must keep the newest events within a fixed
 * size however long a session runs, and its JSON must always parse: a
 * NaN or Infinity in a live number (an altitude before the first frame)
 * would make JSON.stringify write null silently or the paste fail.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDebugLog, debugExportText } from "./globe-debug-log.js";

describe("createDebugLog", () => {
  it("keeps events in order with their time and detail", () => {
    let t = 1000;
    const log = createDebugLog({ capacity: 10, now: () => t });
    log.log("band.edge", { share: 0.4 });
    t = 1250;
    log.log("release.globe");
    assert.deepEqual(log.entries(), [
      { t: 1000, kind: "band.edge", detail: { share: 0.4 } },
      { t: 1250, kind: "release.globe", detail: null },
    ]);
    assert.equal(log.total(), 2);
  });

  it("keeps only the newest `capacity` events, and counts every one", () => {
    let t = 0;
    const log = createDebugLog({ capacity: 3, now: () => t++ });
    for (let i = 0; i < 10; i++) log.log(`e${i}`);
    assert.deepEqual(
      log.entries().map((e) => e.kind),
      ["e7", "e8", "e9"],
    );
    assert.equal(log.total(), 10);
  });

  it("refuses a capacity that is not a positive integer and an empty kind", () => {
    for (const capacity of [0, -1, 2.5, Number.NaN]) {
      assert.throws(() => createDebugLog({ capacity }), RangeError);
    }
    const log = createDebugLog({ capacity: 2 });
    assert.throws(() => log.log(""), RangeError);
  });
});

describe("debugExportText", () => {
  it("writes valid JSON with non-finite numbers spelled out", () => {
    const text = debugExportText({
      device: { ua: "x" },
      live: { altitudeKm: Number.NaN, distanceKm: Infinity, e: 1.2 },
      recording: null,
      events: [{ t: 1, kind: "k", detail: { v: -Infinity } }],
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.live.altitudeKm, "NaN");
    assert.equal(parsed.live.distanceKm, "Infinity");
    assert.equal(parsed.live.e, 1.2);
    assert.equal(parsed.events[0].detail.v, "-Infinity");
    assert.equal(parsed.format, "globe-debug/1");
  });

  it("stays under 100 KB with a full ring of 500 events", () => {
    const log = createDebugLog({ capacity: 500, now: () => 123456.789 });
    for (let i = 0; i < 2000; i++) {
      log.log("relief.load", { share: 0.123456, altKm: 1234.5678, n: i });
    }
    const text = debugExportText({
      device: { ua: "Mozilla/5.0 (Linux; Android 14) Chrome/140" },
      live: { altitudeKm: 1500 },
      recording: { frames: 1000 },
      events: log.entries(),
    });
    assert.ok(text.length < 100_000, `${text.length} bytes`);
    assert.equal(JSON.parse(text).events.length, 500);
  });
});
