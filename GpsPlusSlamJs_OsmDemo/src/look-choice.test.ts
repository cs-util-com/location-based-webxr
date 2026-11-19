import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { colourSchemeOf, DEFAULT_COLOUR_SCHEME } from "./colour-schemes.js";
import {
  isLookChoice,
  lookBuildOf,
  lookLinkValue,
  parseLookWeights,
  resolveLook,
  resolveLookChoice,
  TIME_OF_DAY,
  TIME_OF_DAY_LOOKS,
  type LookChoice,
} from "./look-choice.js";
import {
  createDemoStore,
  colourSchemeChanged,
  selectColourScheme,
} from "./osm-store.js";

describe("the look choice", () => {
  // WHY: the blend is one more value of the same choice; a link must be
  // able to name it and round-trip, and nothing else may reach the build.
  it("accepts the schemes and the blend from a link, nothing else", () => {
    const warn = vi.fn();
    expect(resolveLookChoice("timeofday", warn)).toBe(TIME_OF_DAY);
    expect(resolveLookChoice("golden", warn)).toBe("golden");
    expect(resolveLookChoice(null, warn)).toBe(DEFAULT_COLOUR_SCHEME);
    expect(warn).not.toHaveBeenCalled();
    expect(resolveLookChoice("sunset", warn)).toBe(DEFAULT_COLOUR_SCHEME);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(lookLinkValue(TIME_OF_DAY)).toBe("timeofday");
    expect(lookLinkValue(DEFAULT_COLOUR_SCHEME)).toBeNull();
    expect(isLookChoice("toString")).toBe(false);
  });

  // WHY: the store holds the choice, the blend included; a stray payload
  // must not replace it.
  it("is held by the store, the blend included", () => {
    const { store } = createDemoStore({
      start: { lat: 50.94, lng: 6.96 },
      category: "all",
      colourScheme: TIME_OF_DAY,
    });
    expect(selectColourScheme(store.getState())).toBe(TIME_OF_DAY);
    store.dispatch(colourSchemeChanged("nonsense" as LookChoice));
    expect(selectColourScheme(store.getState())).toBe(TIME_OF_DAY);
    store.dispatch(colourSchemeChanged("dusk"));
    expect(selectColourScheme(store.getState())).toBe("dusk");
  });

  // WHY: the worker bakes the four sun looks for the blend, look 0 being
  // the colours themselves (the library refuses anything else), and a
  // fixed scheme keeps today's build with no looks at all.
  it("builds the blend in its four looks and a scheme in its own colours", () => {
    const blend = lookBuildOf(TIME_OF_DAY);
    expect(blend.looks).toEqual(
      TIME_OF_DAY_LOOKS.map((name) => colourSchemeOf(name).city),
    );
    expect(blend.colours).toBe(blend.looks?.[0]);
    expect(lookBuildOf("dusk")).toEqual({
      colours: colourSchemeOf("dusk").city,
    });
  });
});

describe("AR plus timeofday settles, no rebuild loop", () => {
  // WHY: AR always builds the default. The request side and the echo side
  // must resolve the choice with the same rule: if the request asked for
  // the default but the echo waited for the blend, every drawn mesh would
  // look stale and ask for another build, forever.
  it("resolves to the default in AR on both sides, and to the choice outside", () => {
    for (const chosen of [
      TIME_OF_DAY,
      "golden",
      DEFAULT_COLOUR_SCHEME,
    ] as const) {
      const requested = resolveLook(chosen, { ar: true });
      expect(requested).toBe(DEFAULT_COLOUR_SCHEME);
      // The drawn mesh echoes what was requested; resolving the same choice
      // again for the check gives the same value, so the pass settles.
      expect(resolveLook(chosen, { ar: true })).toBe(requested);
      expect(resolveLook(chosen, { ar: false })).toBe(chosen);
    }
  });
});

describe("parseLookWeights (?lookWeights=)", () => {
  // WHY: the hook drives the browser spec and reviews; it must give weights
  // that sum to 1 for any valid input and ignore every invalid one rather
  // than feed NaN to the mix.
  it("normalises any four finite non-negative values with a positive sum", () => {
    expect(() =>
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              fc.constant(0),
              fc.double({ min: 0, max: 1e6, noNaN: true }),
            ),
            {
              minLength: 4,
              maxLength: 4,
            },
          ),
          (values) => {
            const warn = vi.fn();
            const sum = values.reduce((a, b) => a + b, 0);
            const parsed = parseLookWeights(values.join(","), warn);
            if (!(sum > 0))
              return parsed === undefined && warn.mock.calls.length === 1;
            if (parsed === undefined) return false;
            const total = parsed.reduce((a, b) => a + b, 0);
            return (
              parsed.length === 4 &&
              parsed.every((w) => Number.isFinite(w) && w >= 0) &&
              Math.abs(total - 1) < 1e-12
            );
          },
        ),
      ),
    ).not.toThrow();
  });

  it("ignores a wrong count, a bad value or a zero sum", () => {
    const warn = vi.fn();
    expect(parseLookWeights(null, warn)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    for (const bad of [
      "1,0,0",
      "1,0,0,0,0",
      "1,x,0,0",
      "1,-1,0,1",
      "0,0,0,0",
      "1,,0,0",
      "Infinity,0,0,0",
    ]) {
      expect(parseLookWeights(bad, warn)).toBeUndefined();
    }
    expect(warn).toHaveBeenCalledTimes(7);
    expect(parseLookWeights("0.5,0.5,0,0", warn)).toEqual([0.5, 0.5, 0, 0]);
    expect(parseLookWeights("2,2,0,0", warn)).toEqual([0.5, 0.5, 0, 0]);
  });
});
