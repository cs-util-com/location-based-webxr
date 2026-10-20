/**
 * The editor map's one framing rule that is not Leaflet's: a tour with
 * nothing that has a position opens at a world view, and its debug camera
 * captures, once drawn, are framed instead - once per open, and never
 * after the creator moved the view (r901 review #9: a drag or a zoom made
 * while the walk replayed was taken from them when the captures arrived).
 *
 * Why these tests matter: the rule lives in a closure over a Leaflet map,
 * which no other test reaches; Leaflet is replaced by a recording fake so
 * the framing calls can be counted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  setView: [] as unknown[],
  fitBounds: [] as unknown[],
}));

vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("gps-plus-slam-app-framework/visualization/osm-tile-layer", () => ({
  addOsmTileLayer: vi.fn(),
}));
vi.mock("leaflet", () => {
  const layer = () => ({
    addTo: vi.fn().mockReturnThis(),
    addLayer: vi.fn().mockReturnThis(),
    clearLayers: vi.fn(),
    remove: vi.fn(),
    on: vi.fn(),
  });
  const map = {
    setView: vi.fn((...args: unknown[]) => {
      calls.setView.push(args);
      return map;
    }),
    fitBounds: vi.fn((...args: unknown[]) => {
      calls.fitBounds.push(args);
      return map;
    }),
    on: vi.fn(),
    createPane: () => ({ style: {} }),
    remove: vi.fn(),
  };
  return {
    default: {
      map: vi.fn(() => map),
      control: { zoom: vi.fn(() => layer()) },
      layerGroup: vi.fn(() => layer()),
      marker: vi.fn(() => layer()),
      divIcon: vi.fn(() => ({})),
      latLngBounds: vi.fn((points: unknown) => ({ points })),
    },
  };
});

import { createEditorMap } from "./editor-map.js";
import type { DebugCapture } from "../debug-captures.js";
import type { EditorModel } from "./editor-model.js";

/** The map's element: its listeners, and a way to fire one. */
function container() {
  const listeners = new Map<string, (() => void)[]>();
  return {
    element: {
      addEventListener: (type: string, fn: () => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    } as unknown as HTMLElement,
    fire: (type: string) => {
      for (const fn of listeners.get(type) ?? []) fn();
    },
  };
}

/** A tour with nothing that has a position. */
const EMPTY = { items: [], fitPoints: [] } as unknown as EditorModel;
const PADDING = { left: 300, top: 60 };

function captures(): DebugCapture[] {
  return [0, 1].map((i) => ({
    image: `images/frame-${String(i)}.jpg`,
    geo: { lat: 47.5 + i * 1e-4, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  }));
}

const handlers = {
  onSelect: () => undefined,
  onHover: () => undefined,
  onBackground: () => undefined,
  onView: () => undefined,
};

beforeEach(() => {
  calls.setView.length = 0;
  calls.fitBounds.length = 0;
  vi.stubGlobal("document", {
    createElement: () => ({
      className: "",
      children: [],
      classList: { add: () => undefined },
      replaceChildren: () => undefined,
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("framing a tour with nothing that has a position", () => {
  it("frames the debug captures once they are drawn, once per open", () => {
    const { element } = container();
    const map = createEditorMap(element, handlers);
    map.show(EMPTY, PADDING);
    expect(calls.fitBounds).toHaveLength(0);
    map.debugDraw(captures());
    expect(calls.fitBounds).toHaveLength(1);
    // Drawn again (an added debug data file): the view is the creator's.
    map.debugDraw(captures());
    expect(calls.fitBounds).toHaveLength(1);
    // The next open frames its own captures again.
    map.show(EMPTY, PADDING);
    map.debugDraw(captures());
    expect(calls.fitBounds).toHaveLength(2);
  });

  for (const input of ["pointerdown", "wheel", "keydown"]) {
    it(`leaves the view where the creator moved it (${input}) before the captures arrived`, () => {
      const { element, fire } = container();
      const map = createEditorMap(element, handlers);
      map.show(EMPTY, PADDING);
      fire(input);
      map.debugDraw(captures());
      expect(calls.fitBounds).toHaveLength(0);
      // The rule is per open: the next tour frames its captures.
      map.show(EMPTY, PADDING);
      map.debugDraw(captures());
      expect(calls.fitBounds).toHaveLength(1);
    });
  }
});
