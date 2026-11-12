// @vitest-environment jsdom
/**
 * Why these tests matter: a sound's radius, reach and volume are set by
 * feel with these sliders. A drag must show its value in the number and
 * write nothing until the release, or a drag across the track would be
 * dozens of undo steps; the release must write through the typed number
 * (the one place the bounds are checked), as the text the creator sees;
 * the reach's two thumbs must never cross; and the loudness curve must
 * follow a drag before anything is written.
 */
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockNumberField } from "../block-fields.js";
import {
  fieldRange,
  loudnessCurve,
  loudnessPoints,
  wireFieldSliders,
} from "./field-sliders.js";

let root: HTMLElement;
let selected: string | null;
const write = vi.fn<(box: HTMLInputElement, text: string) => void>();

function numberBox(name: string, value: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "num";
  const input = document.createElement("input");
  input.dataset["field"] = name;
  input.defaultValue = value;
  box.append(input);
  return box;
}

const RADIUS: BlockNumberField = {
  name: "radiusM",
  label: "Radius",
  prose: false,
  value: "6",
  required: true,
  number: { unit: "m", scale: 1, slider: { min: 2, max: 15, step: 0.5 } },
};

const REACH: BlockNumberField = {
  name: "maxM",
  label: "Reach",
  prose: false,
  value: "20",
  required: true,
  number: {
    unit: "m",
    scale: 1,
    slider: { min: 1, max: 60, step: 1 },
    low: { name: "minM", label: "Full volume within", value: "4" },
  },
};

/** The zone's rows as the inspector draws them: the reach's two thumbs,
 *  the full volume's own number, the volume and its curve. */
function drawZone(): void {
  const reach = fieldRange(REACH, numberBox("maxM", "20"));
  const volume = fieldRange(
    {
      ...RADIUS,
      name: "volume",
      label: "Volume",
      value: "50",
      number: { unit: "%", scale: 100, slider: { min: 0, max: 100, step: 1 } },
    },
    numberBox("volume", "50"),
  );
  root.replaceChildren(
    reach as HTMLElement,
    numberBox("minM", "4"),
    volume as HTMLElement,
    loudnessCurve({ minM: 4, maxM: 20, volume: 0.5 }, 100),
  );
}

const slider = (field: string) =>
  root.querySelector(
    `input[data-act="field-slider:${field}"]`,
  ) as HTMLInputElement;
const box = (field: string) =>
  root.querySelector(`input[data-field="${field}"]`) as HTMLInputElement;

function drag(field: string, to: number): void {
  const s = slider(field);
  s.value = String(to);
  s.dispatchEvent(new Event("input", { bubbles: true }));
}

function release(field: string): void {
  slider(field).dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "<div id=r></div>";
  root = document.getElementById("r") as HTMLElement;
  selected = "o:sound";
  write.mockClear();
  wireFieldSliders({ root, selected: () => selected, write });
});

afterEach(() => {
  document.dispatchEvent(new Event("pointercancel"));
});

describe("fieldRange", () => {
  it("puts one slider before the number, on the field's track", () => {
    const row = fieldRange(RADIUS, numberBox("radiusM", "6"));
    const [s, n] = row?.children ?? [];
    expect((s as HTMLInputElement).type).toBe("range");
    expect((s as HTMLInputElement).value).toBe("6");
    expect((s as HTMLInputElement).step).toBe("0.5");
    expect(n?.className).toBe("num");
  });

  it("draws no slider for a field without a track", () => {
    const { slider: _none, ...plain } = RADIUS.number;
    expect(fieldRange({ ...RADIUS, number: plain }, numberBox("x", "1"))).toBe(
      null,
    );
  });

  // Why: the reach and its full-volume edge are one distance range; one
  // track with two thumbs shows how they stand to each other.
  it("puts the reach's two thumbs on one track", () => {
    root.replaceChildren(
      fieldRange(REACH, numberBox("maxM", "20")) as HTMLElement,
    );
    const pair = root.querySelector(".pair");
    const thumbs = pair?.querySelectorAll("input[type=range]") ?? [];
    expect(thumbs).toHaveLength(2);
    expect(slider("minM").value).toBe("4");
    expect(slider("maxM").value).toBe("20");
    expect(slider("minM").getAttribute("aria-label")).toBe(
      "Full volume within",
    );
  });

  it("rests a blank thumb at the track's start", () => {
    const row = fieldRange(
      {
        ...REACH,
        number: {
          ...REACH.number,
          low: { name: "minM", label: "L", value: "" },
        },
      },
      numberBox("maxM", "20"),
    );
    root.replaceChildren(row as HTMLElement);
    expect(slider("minM").value).toBe("1");
  });
});

describe("wireFieldSliders", () => {
  it("shows a drag in the number and writes once, at the release", () => {
    root.replaceChildren(
      fieldRange(RADIUS, numberBox("radiusM", "6")) as HTMLElement,
    );
    drag("radiusM", 7);
    drag("radiusM", 7.5);
    expect(box("radiusM").value).toBe("7.5");
    expect(write).not.toHaveBeenCalled();
    release("radiusM");
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(box("radiusM"), "7.5");
  });

  // Why: a browser fires no `change` for a drag back to where it began;
  // the pointer's release ends it, and a drag that moved nothing writes
  // nothing and leaves the number as the tour has it.
  it("writes nothing for a drag back to where it began", () => {
    root.replaceChildren(
      fieldRange(RADIUS, numberBox("radiusM", "6")) as HTMLElement,
    );
    drag("radiusM", 9);
    drag("radiusM", 6);
    document.dispatchEvent(new Event("pointerup"));
    expect(write).not.toHaveBeenCalled();
    expect(box("radiusM").value).toBe("6");
  });

  // Why: the keyboard moves a slider by steps, each an input and a change
  // event: each step is one write, as a typed number would be.
  it("writes a keyboard step at once", () => {
    root.replaceChildren(
      fieldRange(RADIUS, numberBox("radiusM", "6")) as HTMLElement,
    );
    drag("radiusM", 6.5);
    release("radiusM");
    expect(write).toHaveBeenLastCalledWith(box("radiusM"), "6.5");
  });

  it("keeps the low thumb a step below the high one, and the high above", () => {
    drawZone();
    drag("minM", 35);
    expect(slider("minM").value).toBe("19");
    expect(box("minM").value).toBe("19");
    release("minM");
    expect(write).toHaveBeenLastCalledWith(box("minM"), "19");
    // Drawn again as the tour has it (this write was not kept).
    drawZone();
    drag("maxM", 2);
    release("maxM");
    expect(write).toHaveBeenLastCalledWith(box("maxM"), "5");
  });

  it("redraws the loudness curve during a drag, before any write", () => {
    drawZone();
    const svg = root.querySelector("svg.loudness") as SVGSVGElement;
    const before = svg.querySelector(".line")?.getAttribute("d");
    drag("volume", 80);
    expect(svg.querySelector(".line")?.getAttribute("d")).not.toBe(before);
    expect(svg.getAttribute("aria-label")).toBe(
      "Loudness: 80 % within 4 m, silent beyond 20 m",
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("writes nothing when the drag is cut off or nothing is selected", () => {
    root.replaceChildren(
      fieldRange(RADIUS, numberBox("radiusM", "6")) as HTMLElement,
    );
    const sliders = wireFieldSliders({ root, selected: () => selected, write });
    drag("radiusM", 9);
    sliders.cancel();
    document.dispatchEvent(new Event("pointercancel"));
    expect(write).not.toHaveBeenCalled();
    expect(box("radiusM").value).toBe("6");
    expect(slider("radiusM").value).toBe("6");
    selected = null;
    drag("radiusM", 9);
    release("radiusM");
    expect(write).not.toHaveBeenCalled();
  });
});

describe("loudnessPoints", () => {
  // Why a property: whatever the zone holds, the curve stays in its box,
  // never rises with distance and is silent from the reach on.
  it("draws a curve inside its box that falls to silence at the reach", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5, max: 300, noNaN: false }),
        fc.option(fc.double({ min: -5, max: 300, noNaN: true }), {
          nil: undefined,
        }),
        fc.double({ min: -1, max: 2, noNaN: true }),
        (maxM, minM, volume) => {
          const { points } = loudnessPoints(
            { maxM, ...(minM === undefined ? {} : { minM }), volume },
            200,
            48,
          );
          for (const [x, y] of points) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(200);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(48);
          }
          for (let i = 1; i < points.length; i++) {
            expect(points[i]?.[0]).toBeGreaterThanOrEqual(
              points[i - 1]?.[0] ?? 0,
            );
            expect(points[i]?.[1]).toBeGreaterThanOrEqual(
              points[i - 1]?.[1] ?? 0,
            );
          }
          expect(points.at(-1)?.[1]).toBe(48);
          expect(points.at(-2)?.[1]).toBe(48);
        },
      ),
    );
  });

  it("is flat at the volume within the edge", () => {
    const { points, words } = loudnessPoints(
      { minM: 5, maxM: 20, volume: 0.5 },
      100,
      40,
    );
    expect(points[0]).toEqual([0, 20]);
    expect(points[1]).toEqual([20, 20]);
    expect(points[2]).toEqual([80, 40]);
    expect(words).toBe("Loudness: 50 % within 5 m, silent beyond 20 m");
    expect(loudnessPoints({ maxM: 20, volume: 1 }, 100, 40).words).toBe(
      "Loudness: 100 % at the centre, silent beyond 20 m",
    );
  });
});
