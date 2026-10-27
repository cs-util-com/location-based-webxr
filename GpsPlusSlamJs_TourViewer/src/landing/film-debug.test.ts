/**
 * Why these tests matter: the film's frame budget (no frame over 50 ms on
 * a phone) can only be checked on a phone, where no test runs. Whoever checks it
 * opens the page with `?debug=1` and reads the film's own readout; the
 * readout must name everything a result rests on (the renderer, the pixel
 * ratio and quality it ran at, the scene's build time, the frames over
 * 50 and 100 ms over the whole run, not only the last few hundred), and
 * the quality knobs must let the same phone compare settings without a
 * new build. A knob that silently accepted nonsense would turn a phone
 * check into a measurement of something else.
 */
import { describe, expect, it } from "vitest";

import { createRunCounts, debugQuality, filmReadout } from "./film-debug.js";
import { FULL_QUALITY } from "./film-scene.js";

describe("debugQuality", () => {
  it("keeps the given quality without knobs", () => {
    expect(debugQuality("?debug=1", FULL_QUALITY)).toEqual(FULL_QUALITY);
    expect(debugQuality("", FULL_QUALITY)).toEqual(FULL_QUALITY);
  });

  it("turns each part off or caps the pixel ratio by its knob", () => {
    expect(
      debugQuality(
        "?debug=1&film-shadows=0&film-eye=0&film-aa=0&film-dpr=1.5",
        FULL_QUALITY,
      ),
    ).toEqual({
      pixelRatioCap: 1.5,
      shadows: false,
      eyePass: false,
      antialias: false,
    });
    expect(
      debugQuality("?film-shadows=1", { ...FULL_QUALITY, shadows: false }),
    ).toMatchObject({ shadows: true });
  });

  // A pixel ratio far below 0.5 would measure an unreadable picture, and
  // one above 3 asks for more pixels than any phone has: the knob holds
  // to the range a comparison means something in.
  it("holds the pixel ratio knob to 0.5 to 3", () => {
    expect(debugQuality("?film-dpr=0.0001", FULL_QUALITY).pixelRatioCap).toBe(
      0.5,
    );
    expect(debugQuality("?film-dpr=4", FULL_QUALITY).pixelRatioCap).toBe(3);
    expect(debugQuality("?film-dpr=0.75", FULL_QUALITY).pixelRatioCap).toBe(
      0.75,
    );
  });

  it("ignores a knob it cannot read", () => {
    for (const bad of [
      "film-dpr=0",
      "film-dpr=-1",
      "film-dpr=abc",
      "film-dpr=",
      "film-shadows=maybe",
      "film-eye=",
    ]) {
      expect(debugQuality(`?${bad}`, FULL_QUALITY), bad).toEqual(FULL_QUALITY);
    }
  });
});

describe("createRunCounts", () => {
  // 33 ms (a frame missed at 30 per second) is the threshold the
  // recorder's frame reports use, so the readout counts it too.
  it("counts every frame and those strictly over 33, 50 and 100 ms, and ignores nonsense", () => {
    const run = createRunCounts();
    expect(run.counts()).toEqual({
      count: 0,
      over33: 0,
      over50: 0,
      over100: 0,
    });
    for (const v of [
      16,
      33,
      33.1,
      50,
      50.1,
      100,
      100.1,
      Number.NaN,
      -1,
      Infinity,
    ]) {
      run.push(v);
    }
    expect(run.counts()).toEqual({
      count: 7,
      over33: 5,
      over50: 3,
      over100: 1,
    });
  });
});

describe("filmReadout", () => {
  const base = {
    renderer: "3d" as const,
    quality: FULL_QUALITY,
    dpr: 2,
    status: "playing",
    t: 12.34,
    totalS: 70.1,
    live: { p50: 16.7, p95: 18.04, max: 70 },
    run: { count: 4122, over33: 9, over50: 5, over100: 1 },
    buildMs: 321.6,
  };

  it("names the renderer, its settings, the build, the time and the frames", () => {
    expect(filmReadout(base).split("\n")).toEqual([
      "3d, dpr 2, shadows eye aa, build 322 ms",
      "playing 12.3 / 70.1 s",
      "p50 16.7 p95 18.0 max 70.0 ms",
      "4122 frames: 9 over 33 ms, 5 over 50, 1 over 100",
    ]);
  });

  it("says which parts are off, and leaves out what it has not seen yet", () => {
    const text = filmReadout({
      ...base,
      quality: { ...FULL_QUALITY, shadows: false, antialias: false },
      dpr: 1.5,
      live: null,
      run: { count: 0, over33: 0, over50: 0, over100: 0 },
      buildMs: 0,
    });
    expect(text.split("\n")).toEqual([
      "3d, dpr 1.5, eye",
      "playing 12.3 / 70.1 s",
    ]);
  });

  it("drops the scene's settings for the flat drawing", () => {
    expect(
      filmReadout({ ...base, renderer: "floor", buildMs: 0 }).split("\n")[0],
    ).toBe("floor");
  });
});
