/**
 * Why these tests matter: the debug layer's state moved from the page's
 * variables and the switch's DOM into the store, so the map and the 3D
 * view on the globe draw from one copy. A drawing kept after its layer
 * stopped would leave captures on the globe of a tour that closed; a
 * capture without a finite place would put a thumbnail at the Earth's
 * centre; a name drawn twice would give one thumbnail two places.
 */

import { describe, expect, it } from "vitest";
import {
  debugLayerActions as act,
  debugLayerReducer as reduce,
  debugPlacesOf,
  initialDebugLayerState,
  selectDebugLayer,
} from "./debug-layer-slice.js";
import { createTourViewerStore } from "../tour-viewer-session.js";

const A = { image: "images/a.jpg", lat: 48.1, lon: 11.5, alt: 520 };
const B = { image: "images/b.jpg", lat: 48.2, lon: 11.6, alt: 521 };

describe("debugLayer", () => {
  it("starts shown, with nothing drawn and no source", () => {
    expect(reduce(undefined, { type: "@@init" })).toEqual(
      initialDebugLayerState,
    );
    expect(initialDebugLayerState).toEqual({
      shown: true,
      source: null,
      captures: null,
    });
  });

  it("a start shows the layer again and forgets an earlier drawing", () => {
    let s = reduce(undefined, act.started({ source: "walk" }));
    s = reduce(s, act.drawn({ captures: [A] }));
    s = reduce(s, act.shownChanged({ on: false }));
    s = reduce(s, act.started({ source: "added" }));
    expect(s).toEqual({ shown: true, source: "added", captures: null });
  });

  it("keeps the drawn captures in order, by name and place only", () => {
    let s = reduce(undefined, act.started({ source: "walk" }));
    s = reduce(s, act.drawn({ captures: [{ ...B, extra: 1 } as typeof B, A] }));
    expect(s.captures).toEqual([B, A]);
  });

  it("ignores a drawing while no layer runs (a decode that ended after the stop)", () => {
    const s = reduce(undefined, act.drawn({ captures: [A] }));
    expect(s.captures).toBeNull();
  });

  it("a clear drops the drawing and the source, and keeps the switch", () => {
    let s = reduce(undefined, act.started({ source: "added" }));
    s = reduce(s, act.drawn({ captures: [A, B] }));
    s = reduce(s, act.shownChanged({ on: false }));
    s = reduce(s, act.cleared());
    expect(s).toEqual({ shown: false, source: null, captures: null });
  });

  it("refuses a source it does not know", () => {
    const s = reduce(
      undefined,
      act.started({ source: "elsewhere" as unknown as "walk" }),
    );
    expect(s.source).toBeNull();
  });

  it("is mounted as a page slice of the tour viewer's store", () => {
    const store = createTourViewerStore(undefined, {
      debugLayer: reduce,
    });
    store.dispatch(act.started({ source: "walk" }));
    store.dispatch(act.drawn({ captures: [A] }));
    expect(selectDebugLayer(store.getState()).captures).toEqual([A]);
  });
});

describe("debugPlacesOf", () => {
  it("drops captures without a name or a finite place, and a name drawn twice", () => {
    expect(
      debugPlacesOf([
        A,
        { ...B, image: "" },
        { ...B, lat: Number.NaN },
        { ...B, lon: Infinity },
        { ...B, alt: "1" },
        { ...B, lat: 91 },
        { ...B, lon: -181 },
        { ...A, lat: 0 },
        B,
      ]),
    ).toEqual([A, B]);
  });
});
