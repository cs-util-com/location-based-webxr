/**
 * The summary map's Leaflet layers (authoring plan 2026-09-28-0953 §3.3,
 * M3b), with Leaflet recorded rather than run.
 *
 * Why these tests matter: the model (`summary-model.test.ts`) proves WHAT
 * is drawn; this proves it reaches Leaflet as drawn - the facing line from
 * the code along its facing, the ring at the predicted error, the estimate
 * only where it differs, every visit as its own track - and that every
 * label is set as TEXT: a pin's label comes from a zip anyone can write,
 * and Leaflet renders a string tooltip as markup.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  polylines: [] as { latLngs: unknown; options: Record<string, unknown> }[],
  circles: [] as { latLng: unknown; options: Record<string, unknown> }[],
  circleMarkers: [] as {
    latLng: unknown;
    options: Record<string, unknown>;
    tooltip: unknown;
  }[],
}));

vi.mock("leaflet", () => {
  const layer = () => ({
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  });
  return {
    default: {
      polyline: vi.fn((latLngs: unknown, options: Record<string, unknown>) => {
        calls.polylines.push({ latLngs, options });
        return layer();
      }),
      circle: vi.fn((latLng: unknown, options: Record<string, unknown>) => {
        calls.circles.push({ latLng, options });
        return layer();
      }),
      circleMarker: vi.fn(
        (latLng: unknown, options: Record<string, unknown>) => {
          const entry = { latLng, options, tooltip: null as unknown };
          calls.circleMarkers.push(entry);
          const marker = {
            ...layer(),
            bindTooltip: vi.fn((content: unknown) => {
              entry.tooltip = content;
              return marker;
            }),
          };
          return marker;
        },
      ),
      latLngBounds: vi.fn(() => ({ extend: vi.fn(), isValid: () => true })),
    },
  };
});

import { CODE_COLOR, drawSummaryLayers } from "./summary-map-view.js";
import type { SummaryCode, SummaryModel } from "./summary-model.js";

const doc = {
  createElement: () => ({ textContent: "", innerHTML: "" }),
};

const P = (lat: number, lng: number) => ({ lat, lng });

function code(overrides: Partial<SummaryCode> = {}): SummaryCode {
  return {
    levelId: "lvl",
    label: "The code",
    reference: {
      ...P(47.5, 8.7),
      facingDeg: 120,
      facingLine: [P(47.5, 8.7), P(47.49995, 8.7001)],
      ringM: 4.5,
    },
    combined: {
      ...P(47.5, 8.7),
      facingDeg: 120,
      facingLine: [P(47.5, 8.7), P(47.49995, 8.7001)],
      ringM: 4.5,
      shown: false,
      offsetM: null,
      offsetDeg: null,
    },
    verdict: { kind: "good", text: "Good", numbers: null, walkM: null },
    estimateVerdict: null,
    details: [],
    ...overrides,
  };
}

function model(overrides: Partial<SummaryModel> = {}): SummaryModel {
  return {
    tracks: [],
    codes: [code()],
    objects: [],
    fitPoints: [P(47.5, 8.7)],
    ...overrides,
  };
}

beforeEach(() => {
  calls.polylines.length = 0;
  calls.circles.length = 0;
  calls.circleMarkers.length = 0;
});

describe("drawSummaryLayers", () => {
  it("draws the stored code as a dot with its facing line and its ring, labelled with its verdict", () => {
    drawSummaryLayers({} as never, model(), doc as never);
    const facing = calls.polylines.filter(
      (p) => p.options["className"] === "tv-summary-facing",
    );
    expect(facing).toHaveLength(1);
    expect(facing[0]?.latLngs).toEqual([
      [47.5, 8.7],
      [47.49995, 8.7001],
    ]);
    expect(facing[0]?.options["color"]).toBe(CODE_COLOR);
    expect(calls.circles).toEqual([
      expect.objectContaining({
        latLng: [47.5, 8.7],
        options: expect.objectContaining({
          radius: 4.5,
          className: "tv-summary-ring",
        }),
      }),
    ]);
    const dots = calls.circleMarkers.filter(
      (m) => m.options["className"] === "tv-summary-code",
    );
    expect(dots).toHaveLength(1);
    expect((dots[0]?.tooltip as { textContent: string }).textContent).toBe(
      "The code: Good",
    );
    // The estimate coincides with the stored pose: not drawn twice.
    expect(
      calls.circleMarkers.some(
        (m) => m.options["className"] === "tv-summary-estimate",
      ),
    ).toBe(false);
  });

  // M3a/M3b review #2: the ring a visitor's position is judged by is the
  // STORED pose's own; the estimate's ring joins it only where the
  // estimate is drawn, or where the stored pose's error is not known.
  it("rings the estimate too where it is drawn, or where the stored pose's own error is unknown", () => {
    const c = code();
    drawSummaryLayers(
      {} as never,
      model({
        codes: [
          { ...c, reference: { ...c.reference!, ringM: null } },
          {
            ...c,
            combined: { ...c.combined!, ...P(47.50005, 8.7), shown: true },
          },
        ],
      }),
      doc as never,
    );
    expect(
      calls.circles.map((x) => [x.options["className"], x.options["radius"]]),
    ).toEqual([
      ["tv-summary-estimate-ring", 4.5],
      ["tv-summary-estimate-ring", 4.5],
      ["tv-summary-ring", 4.5],
    ]);
  });

  it("draws the visits' estimate as a second, hollow mark with a dashed line where it differs", () => {
    const c = code();
    drawSummaryLayers(
      {} as never,
      model({
        codes: [
          {
            ...c,
            combined: {
              ...c.combined!,
              ...P(47.50005, 8.7),
              shown: true,
              offsetM: 5.6,
              offsetDeg: 0,
            },
          },
        ],
      }),
      doc as never,
    );
    const estimate = calls.circleMarkers.filter(
      (m) => m.options["className"] === "tv-summary-estimate",
    );
    expect(estimate).toHaveLength(1);
    expect(estimate[0]?.latLng).toEqual([47.50005, 8.7]);
    // The label stays on the stored pose.
    expect(estimate[0]?.tooltip).toBeNull();
    expect(
      calls.polylines.filter(
        (p) => p.options["className"] === "tv-summary-estimate-facing",
      ),
    ).toHaveLength(1);
  });

  it("labels a code only the visits know on its estimate, and draws no line for a flat code", () => {
    const c = code();
    drawSummaryLayers(
      {} as never,
      model({
        codes: [
          {
            ...c,
            reference: null,
            combined: {
              ...c.combined!,
              facingDeg: null,
              facingLine: null,
              shown: true,
            },
          },
        ],
      }),
      doc as never,
    );
    const estimate = calls.circleMarkers.filter(
      (m) => m.options["className"] === "tv-summary-estimate",
    );
    expect((estimate[0]?.tooltip as { textContent: string }).textContent).toBe(
      "The code: Good",
    );
    expect(calls.polylines).toEqual([]);
  });

  it("labels pins and photos as text, never as markup", () => {
    drawSummaryLayers(
      {} as never,
      model({
        codes: [],
        objects: [
          {
            id: "a",
            kind: "pin",
            label: "<img src=x onerror=alert(1)>",
            ...P(47.5, 8.7),
          },
          { id: "b", kind: "photo", label: "Photo", ...P(47.5001, 8.7) },
        ],
      }),
      doc as never,
    );
    expect(calls.circleMarkers.map((m) => m.options["className"])).toEqual([
      "tv-summary-pin",
      "tv-summary-photo",
    ]);
    const tip = calls.circleMarkers[0]?.tooltip as {
      textContent: string;
      innerHTML: string;
    };
    expect(tip.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(tip.innerHTML).toBe("");
  });

  it("draws every visit's walk as its own track", () => {
    drawSummaryLayers(
      {} as never,
      model({
        codes: [],
        tracks: [
          { visitId: "a", gps: [P(1, 1), P(1, 2)], fused: [P(1, 1), P(1, 2)] },
          { visitId: "b", gps: [P(2, 1), P(2, 2)], fused: [] },
        ],
      }),
      doc as never,
    );
    // Raw and fused of the first visit, raw of the second: never one line
    // joining the first visit's end to the second's start.
    expect(calls.polylines.map((p) => p.latLngs)).toEqual([
      [
        [1, 1],
        [1, 2],
      ],
      [
        [1, 1],
        [1, 2],
      ],
      [
        [2, 1],
        [2, 2],
      ],
    ]);
  });
});
