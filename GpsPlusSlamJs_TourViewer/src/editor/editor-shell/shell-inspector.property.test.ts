// @vitest-environment jsdom
/**
 * Why these tests matter: a pin's text is free text from the tour file,
 * and it is typed in the inspector's text area, one line or several.
 * Whatever the text is (any lines or one, line ends of any platform, spaces, markup-looking
 * characters), the area must show it with its lines as its default, so a
 * field left untouched reads as untyped and is never written back changed;
 * what is typed there must reach the page's pin text edit as typed, its
 * lines kept; and the head must name it on one line, as text, never as a
 * second field of it. The example tests are in `shell-inspector.test.ts`
 * and `editor-shell.test.ts`; this is the part that holds for every text.
 */
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";

// Activates the licence the station frame's geodesy needs.
import "../../test-support/tour-of.js";
import { buildInspector } from "./inspector-model.js";
import { inspectorEdit } from "./inspector-edits.js";
import type { ShellPictures } from "./shell-pictures.js";
import { drawInspector } from "./shell-inspector.js";
import { stationContent } from "../../test-support/station-content.js";

const pictures: ShellPictures = {
  show: () => undefined,
  sweep: () => undefined,
  clear: () => undefined,
};

/** A station holding one pin, its text `caption`. */
function withPin(caption: string): TourStation[] {
  return [
    {
      id: "s",
      title: "Gate",
      geo: { lat: 48.1371, lon: 11.5754, alt: 560, headingDeg: 0 },
      activateRadiusM: 50,
      foundRadiusM: 25,
      hint: "arrow",
      ...stationContent([
        {
          id: "pin",
          kind: "shortText",
          view: "pin",
          caption,
          createdAtIso: "2026-11-18T10:00:00Z",
          pose: { position: [1, 0, 1], rotation: [0, 0, 0, 1] },
        },
      ]),
    } as unknown as TourStation,
  ];
}

/** Text of several lines: words and spaces joined by line ends of every
 *  platform, markup-looking characters among them. */
const severalLines = fc
  .tuple(
    fc.array(fc.string({ maxLength: 12 }), { minLength: 2, maxLength: 4 }),
    fc.constantFrom("\n", "\r\n", "\r"),
  )
  .map(([lines, end]) => lines.join(end));

/** A pin text of one line or several. */
const anyText = fc.oneof(fc.string({ maxLength: 40 }), severalLines);

/** What a creator types: any graphemes of the whole of Unicode, with
 *  decomposed accents among them (an "e" and its combining acute), so
 *  the NFC the edit applies changes something to check. */
const anyTyped = fc.oneof(
  fc.string({ unit: "grapheme", maxLength: 20 }),
  fc
    .array(
      fc.oneof(
        fc.string({ unit: "grapheme", maxLength: 3 }),
        fc.constantFrom("é", "Å", "ñ", "가"),
      ),
      { maxLength: 6 },
    )
    .map((parts) => parts.join("")),
);

let dock: { root: HTMLElement; head: HTMLElement; body: HTMLElement };

beforeEach(() => {
  document.body.innerHTML =
    '<aside id="i"><div id="h"></div><div id="b"></div></aside>';
  dock = {
    root: document.getElementById("i") as HTMLElement,
    head: document.getElementById("h") as HTMLElement,
    body: document.getElementById("b") as HTMLElement,
  };
});

function drawPin(stations: TourStation[]): HTMLTextAreaElement {
  drawInspector(
    dock,
    buildInspector({ selected: "pin", stations, assets: [], codes: [] }),
    { folded: false, positionOpen: false },
    pictures,
  );
  const named = dock.root.querySelectorAll('[data-field="title"]');
  expect(named).toHaveLength(1);
  const area = named[0];
  if (!(area instanceof HTMLTextAreaElement)) throw new Error("no area");
  return area;
}

describe("a pin text in the inspector", () => {
  it("is shown with its lines, typed back as typed, named on one line in the head", () => {
    fc.assert(
      fc.property(anyText, anyTyped, (text, typed) => {
        const stations = withPin(text);
        const area = drawPin(stations);
        // Its lines, as a text area reads line ends: one character each.
        expect(area.defaultValue).toBe(text.replace(/\r\n?/g, "\n"));
        expect(area.value).toBe(area.defaultValue);
        // The head names it as text, on one line.
        expect(dock.head.querySelector("input, textarea")).toBeNull();
        expect(dock.head.querySelector(".ttl")?.textContent).not.toMatch(
          /[\r\n]/,
        );
        // What is typed reaches the pin's text edit as typed.
        expect(
          inspectorEdit({
            selected: "pin",
            stations,
            origin: null,
            field: area.dataset["field"] ?? "",
            value: typed,
          }),
        ).toEqual({ kind: "text", id: "pin", text: typed.normalize("NFC") });
      }),
      { numRuns: 60 },
    );
  });
});
