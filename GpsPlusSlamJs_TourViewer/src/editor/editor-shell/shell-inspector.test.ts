// @vitest-environment jsdom
/**
 * Why these tests matter: the inspector is what a creator reads to check a
 * station before going out, so its drawing is checked from the page's own
 * store, not only through a 3D view in a browser: the fields it shows, in
 * the units and the order the plan names (a station's place as metres
 * east and north of the tour's centre, its height and heading), every
 * value tied to its label (a screen reader reads "Radius, 25.0 m", not a
 * bare number), and the position folded away until asked for.
 */
import {
  createEmptyTourManifest,
  type TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tourDocumentActions, manifestToWrite } from "../../tour-document.js";
import { createTourViewerStore } from "../../tour-viewer-session.js";
import { editorViewActions, editorViewReducer } from "../editor-view.js";
import { buildInspector, type InspectorCode } from "./inspector-model.js";
import { drawInspector } from "./shell-inspector.js";
import type { ShellPictures } from "./shell-pictures.js";

const AT = "2026-10-22T10:00:00Z";

const STATIONS = [
  {
    id: "gate",
    title: "The old gate",
    description: "Where the wall stood",
    geo: { lat: 48.1371, lon: 11.5754, alt: 562.25, headingDeg: 30 },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    steps: [],
    image: "photo-1",
    items: [
      {
        id: "photo-1",
        kind: "photo",
        image: "content/photo-1.jpg",
        createdAtIso: AT,
        pose: { position: [4, 1.5, -2], rotation: [0, 0, 0, 1] },
      },
    ],
  },
  {
    id: "steps",
    title: "The town hall steps",
    geo: { lat: 48.138, lon: 11.576, alt: 560, headingDeg: 0 },
    activateRadiusM: 60,
    foundRadiusM: 30,
    hint: "arrow",
    steps: [],
    items: [],
  },
] as unknown as TourStation[];

const CODES: InspectorCode[] = [
  {
    id: "level-1",
    title: "Code 1",
    meta: "Printed code, no position stored yet",
    geo: null,
    printSizeM: 0.5,
  },
];

function storeWith(selected: string | null) {
  const store = createTourViewerStore(undefined, {
    editorView: editorViewReducer,
  });
  store.dispatch(
    tourDocumentActions.opened({
      manifest: { ...createEmptyTourManifest(), stations: STATIONS },
    }),
  );
  store.dispatch(editorViewActions.selected({ id: selected }));
  return store;
}

let dock: { root: HTMLElement; head: HTMLElement; body: HTMLElement };
const shown: [Element, string][] = [];
const pictures: ShellPictures = {
  show: (el, path) => shown.push([el, path]),
  sweep: vi.fn(),
  clear: vi.fn(),
};

beforeEach(() => {
  document.body.innerHTML =
    '<aside id="i"><div id="h"></div><div id="b"></div></aside>';
  dock = {
    root: document.getElementById("i") as HTMLElement,
    head: document.getElementById("h") as HTMLElement,
    body: document.getElementById("b") as HTMLElement,
  };
  shown.length = 0;
});

/** The inspector drawn for `selected`, from a store holding the tour. */
function draw(
  selected: string | null,
  positionOpen = false,
  unlocked: string[] = [],
) {
  const state = storeWith(selected).getState();
  const tour = manifestToWrite(state.tourDocument);
  const model = buildInspector({
    selected: state.editorView.selected,
    stations: tour?.stations ?? [],
    assets: tour?.assets ?? [],
    codes: CODES,
    unlockedStations: unlocked,
  });
  drawInspector(
    dock,
    model,
    { folded: state.editorView.foldedDocks.inspector, positionOpen },
    pictures,
  );
}

/** Each field's label and what it reads, the label found through the
 *  value's own `labels` (so an untied label reads as missing). */
function fields(): [string, string][] {
  return [...dock.body.querySelectorAll("output")].map((out) => {
    const label =
      out.labels[0]?.textContent ?? out.getAttribute("aria-label") ?? "?";
    const unit = out.parentElement?.querySelector(".unit")?.textContent;
    return [label, `${out.textContent ?? ""}${unit ? ` ${unit}` : ""}`];
  });
}

describe("drawInspector", () => {
  // Why: the lock is the one control that opens a station to a move, so
  // it sits on the Position row the shell answers, and says its state to
  // a screen reader: pressed while locked.
  it("puts a station's lock beside its Position, pressed while locked", () => {
    draw("station:gate");
    const lock = () =>
      dock.body.querySelector<HTMLButtonElement>('.posrow [data-act="lock"]');
    expect(dock.body.querySelector(".posrow button.disc")).not.toBeNull();
    expect(lock()?.getAttribute("aria-pressed")).toBe("true");
    expect(lock()?.getAttribute("aria-label")).toMatch(/^Unlock the position/);
    draw("station:gate", false, ["gate"]);
    expect(lock()?.getAttribute("aria-pressed")).toBe("false");
    expect(lock()?.getAttribute("aria-label")).toBe("Lock the position");
    draw("photo-1");
    expect(dock.body.querySelector('[data-act="lock"]')).toBeNull();
  });

  // Why: a station the file gives no position has nothing the lock could
  // keep still, and a lock beside the "no position" note read as if it
  // locked the note. The note stands alone, with no lock.
  it("shows no lock for a station without a position, only the note", () => {
    drawInspector(
      dock,
      {
        kind: "station",
        title: "Unplaced",
        sub: "Station 1 of 1",
        description: null,
        imagePath: null,
        foundRadiusM: 25,
        activateRadiusM: 50,
        position: null,
        locked: true,
      },
      { folded: false, positionOpen: false },
      pictures,
    );
    expect(dock.body.querySelector('[data-act="lock"]')).toBeNull();
    expect(dock.body.querySelector(".posrow")).toBeNull();
    const notes = [...dock.body.querySelectorAll(".note")].map(
      (n) => n.textContent,
    );
    expect(notes).toContain("The file gives this station no position.");
  });

  it("is hidden while nothing is selected", () => {
    draw(null);
    expect(dock.root.hidden).toBe(true);
    expect(dock.body.childElementCount).toBe(0);
  });

  it("shows a station's fields, each tied to its label, the position folded", () => {
    draw("station:gate");
    expect(dock.root.hidden).toBe(false);
    expect(dock.head.querySelector(".ttl")?.textContent).toBe("The old gate");
    expect(dock.body.querySelector(".sub")?.textContent).toBe("Station 1 of 2");
    expect(fields()).toEqual([
      ["Description", "Where the wall stood"],
      ["Card image", ""],
      ["Radius", "25.0 m"],
    ]);
    // The card picture is the station's photo, read through the pictures.
    expect(shown.map(([, path]) => path)).toEqual(["content/photo-1.jpg"]);
    // Folded: a one-line summary in the plan's form, metres of the centre.
    const disclosure = dock.body.querySelector("button.disc");
    expect(disclosure?.getAttribute("aria-expanded")).toBe("false");
    expect(disclosure?.querySelector(".sum")?.textContent).toMatch(
      /^E -?\d+\.\d {2}N -?\d+\.\d {2}30 deg$/,
    );
  });

  it("shows where a station stands in metres of the tour's centre, once unfolded", () => {
    draw("station:gate", true);
    const position = fields().slice(3);
    expect(position.map(([label]) => label)).toEqual([
      "Anchor east",
      "Anchor north",
      "Height",
      "Heading",
    ]);
    // Two stations either side of their middle: about 23 m west and 49 m
    // south of it.
    const [east, north, height, heading] = position.map(([, v]) => v);
    expect(Number.parseFloat(east ?? "")).toBeCloseTo(-22.3, 0);
    expect(Number.parseFloat(north ?? "")).toBeCloseTo(-50.0, 0);
    expect(height).toBe("562.3 m");
    expect(heading).toBe("30 deg");
    expect(
      dock.body
        .querySelector('[role="group"]')
        ?.getAttribute("aria-labelledby"),
    ).toBe(dock.body.querySelector(".f > .flabel")?.id);
  });

  it("shows an item's offset in its station's frame", () => {
    draw("photo-1", true);
    expect(dock.body.querySelector(".sub")?.textContent).toBe(
      "Photo in The old gate",
    );
    expect(fields()).toEqual([
      ["Offset north", "4.00"],
      ["Offset up", "1.50"],
      ["Offset east", "-2.00"],
      ["Heading", "0 deg"],
    ]);
  });

  it("says a code has no position stored", () => {
    // The code is not in the store's tour, but in the page's codes.
    draw("level-1");
    expect(fields()).toEqual([["Print size", "0.50 m"]]);
    expect(dock.body.querySelector(".note")?.textContent).toBe(
      "No position stored yet.",
    );
  });

  it("folds to its head", () => {
    const state = storeWith("station:steps");
    state.dispatch(
      editorViewActions.dockFolded({ dock: "inspector", folded: true }),
    );
    const s = state.getState();
    const tour = manifestToWrite(s.tourDocument);
    drawInspector(
      dock,
      buildInspector({
        selected: s.editorView.selected,
        stations: tour?.stations ?? [],
        assets: [],
        codes: [],
      }),
      { folded: s.editorView.foldedDocks.inspector, positionOpen: false },
      pictures,
    );
    expect(dock.root.classList.contains("collapsed")).toBe(true);
    expect(
      dock.head.querySelector('[data-act="fold"]')?.getAttribute("aria-label"),
    ).toBe("Show the details");
  });
});
