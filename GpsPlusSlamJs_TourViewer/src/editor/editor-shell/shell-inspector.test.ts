// @vitest-environment jsdom
/**
 * Why these tests matter: the inspector is what a creator reads to check a
 * station before going out, and where its fields are typed, so its drawing
 * is checked from the page's own store, not only through a 3D view in a
 * browser: the fields it shows, in the units and the order of the studio
 * prototype (a station's place as metres east and north of the tour's
 * centre, its height and heading), every value and every field tied to its
 * label (a screen reader reads "Radius, 25.0 m", not a bare number), the
 * fields a lock keeps still read-only while it is locked, and the position
 * folded away until asked for.
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
import { drawInspector, inspectorDrawing } from "./shell-inspector.js";
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
    blocks: [
      {
        id: "photo-1",
        kind: "picture",
        view: "plane",
        image: "photo-1",
        widthM: 1,
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
    blocks: [],
  },
] as unknown as TourStation[];

/** The photo's own image asset: a captured photo's file. */
const PHOTO_ASSET = {
  id: "photo-1",
  path: "content/photo-1.jpg",
  kind: "image" as const,
  width: 4,
  height: 3,
};

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
      manifest: {
        ...createEmptyTourManifest(),
        assets: [PHOTO_ASSET],
        stations: STATIONS,
      },
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
  busy: string | null = null,
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
    { folded: state.editorView.foldedDocks.inspector, positionOpen, busy },
    pictures,
  );
}

/** Each field's label and what it reads, the label found through the
 *  value's own `labels` (so an untied label reads as missing). */
function fields(): [string, string][] {
  return [
    ...dock.body.querySelectorAll<
      HTMLOutputElement | HTMLInputElement | HTMLTextAreaElement
    >("output:not(.count), input, textarea"),
  ].map((out) => {
    const label =
      out.labels?.[0]?.textContent ?? out.getAttribute("aria-label") ?? "?";
    const unit = out.parentElement?.querySelector(".unit")?.textContent;
    const value =
      out instanceof HTMLOutputElement ? out.textContent : out.value;
    return [label, `${value}${unit ? ` ${unit}` : ""}`];
  });
}

/** The typed field `name` of the dock (head or body). */
function input(name: string): HTMLInputElement | null {
  return dock.root.querySelector<HTMLInputElement>(`[data-field="${name}"]`);
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
        place: { number: 1, count: 1 },
        name: "Unplaced",
        description: null,
        imagePath: null,
        images: [],
        imageId: null,
        foundRadiusM: 25,
        activateRadiusM: 50,
        outside: 0,
        offGround: null,
        groundOffM: null,
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

  // Why (AU-2, the owner's audit of 2026-10-27): the name was a
  // borderless field doubling as the dock's title, with no label, its
  // border shown only on hover (never on a touch screen), so it read as a
  // heading and the owner could not see how to correct it. The name and
  // the description are now labelled fields in the body, "Name" first;
  // the head shows the name as plain text.
  it("shows a station's fields to type, each tied to its label, Name and Description first, the position folded", () => {
    draw("station:gate");
    expect(dock.root.hidden).toBe(false);
    expect(dock.head.querySelector("input, textarea")).toBeNull();
    expect(dock.head.querySelector(".ttl")?.textContent).toBe("The old gate");
    expect(input("title")?.value).toBe("The old gate");
    expect(input("title")?.placeholder).toBe("Station 1");
    expect(dock.body.contains(input("title"))).toBe(true);
    expect(dock.body.querySelector(".sub")?.textContent).toBe("Station 1 of 2");
    expect(fields()).toEqual([
      ["Name", "The old gate"],
      ["Description", "Where the wall stood"],
      ["Radius", "25.0 m"],
    ]);
    // The description starts three lines high: a box to write in, not a
    // line (it grows with its text, `field-sizing`, in the stylesheet).
    const area = dock.body.querySelector<HTMLTextAreaElement>(
      '[data-field="description"]',
    );
    expect(area?.rows).toBe(3);
    // The card's pictures to pick from: the station's photo, shown.
    const picks = [
      ...dock.body.querySelectorAll<HTMLButtonElement>(
        '[role="group"][aria-label="Card image"] button.thumb',
      ),
    ];
    expect(
      picks.map((b) => [b.dataset["act"], b.getAttribute("aria-pressed")]),
    ).toEqual([["image:photo-1", "true"]]);
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
      "Heading",
      "Height",
    ]);
    // Two stations either side of their middle: about 23 m west and 49 m
    // south of it.
    const [east, north, heading, height] = position.map(([, v]) => v);
    expect(Number.parseFloat(east ?? "")).toBeCloseTo(-22.3, 0);
    expect(Number.parseFloat(north ?? "")).toBeCloseTo(-50.0, 0);
    expect(height).toBe("562.3 m");
    expect(heading).toBe("30.0 deg");
    expect(
      dock.body
        .querySelector('.vec[role="group"]')
        ?.getAttribute("aria-labelledby"),
    ).toBe(dock.body.querySelector(".pos .f > .flabel")?.id);
  });

  it("shows an item's offset in its station's frame, its height and heading to type", () => {
    draw("photo-1", true);
    // B2c: a picture in the block model's words, its text fields first.
    expect(dock.body.querySelector(".sub")?.textContent).toBe(
      "Picture in The old gate",
    );
    expect(fields()).toEqual([
      ["Title", ""],
      ["Caption", ""],
      ["Alt text", ""],
      ["Offset east", "-2.00 m"],
      ["Offset north", "4.00 m"],
      ["Height", "1.50 m"],
      ["Heading", "0.0 deg"],
    ]);
    // A picture's head is words; its title, caption and alt text are
    // typed in the body (B2c), each with its count against its cap.
    expect(dock.head.querySelector("input")).toBeNull();
    expect(dock.head.querySelector(".ttl")?.textContent).toBe("Picture");
    expect(dock.body.contains(input("title"))).toBe(true);
    const counts = [...dock.body.querySelectorAll("output.count")].map(
      (o) => o.textContent,
    );
    expect(counts).toEqual(["0 / 40", "0 / 1200", "0 / 300"]);
    const alt = input("alt") as unknown as HTMLTextAreaElement | null;
    expect(alt?.tagName).toBe("TEXTAREA");
    expect(alt?.getAttribute("aria-describedby")).toBe(
      dock.body.querySelectorAll("output.count")[2]?.id,
    );
  });

  // Why: the position and the heading of a locked station are refused by
  // the session; a field that took the typing and then threw it away
  // would read as broken, so the fields say they are read-only.
  it("keeps a locked station's place and heading read-only, and its Put on the ground off", () => {
    draw("station:gate", true);
    for (const name of ["east", "north", "heading"]) {
      expect(input(name)?.readOnly, name).toBe(true);
    }
    const ground = () =>
      dock.body.querySelector<HTMLButtonElement>('.pos [data-act="ground"]');
    expect(ground()?.disabled).toBe(true);
    draw("station:gate", true, ["gate"]);
    for (const name of ["east", "north", "heading"]) {
      expect(input(name)?.readOnly, name).toBe(false);
    }
    expect(ground()?.disabled).toBe(false);
    // The radius is free either way.
    expect(input("radius")?.readOnly).toBe(false);
  });

  // Why: a pin's words are its title; they are typed where the title is.
  it("offers a pin's text in the head", () => {
    drawInspector(
      dock,
      buildInspector({
        selected: "pin-x",
        stations: [
          {
            ...STATIONS[1],
            blocks: [
              {
                id: "pin-x",
                kind: "shortText",
                view: "pin",
                caption: "Look up",
                createdAtIso: AT,
                pose: { position: [1, 0, 1], rotation: [0, 0, 0, 1] },
              },
            ],
          } as unknown as TourStation,
        ],
        assets: [],
        codes: [],
      }),
      { folded: false, positionOpen: false },
      pictures,
    );
    expect(input("title")?.value).toBe("Look up");
    expect(input("title")?.getAttribute("aria-label")).toBe("Pin text");
  });

  // Why: a pin's text is a short text's caption, which the tour file caps
  // at 40 characters; the inspector refuses a longer one at Enter, so the
  // count is shown while typing, tied to the field for a screen reader.
  it("counts a pin's text as it is typed, marked past 40 characters", () => {
    drawInspector(
      dock,
      buildInspector({
        selected: "pin-x",
        stations: [
          {
            ...STATIONS[1],
            blocks: [
              {
                id: "pin-x",
                kind: "shortText",
                view: "pin",
                caption: "Look up",
                createdAtIso: AT,
                pose: { position: [1, 0, 1], rotation: [0, 0, 0, 1] },
              },
            ],
          } as unknown as TourStation,
        ],
        assets: [],
        codes: [],
      }),
      { folded: false, positionOpen: false },
      pictures,
    );
    const title = input("title");
    const count = dock.body.querySelector("output.pad");
    expect(count?.textContent).toBe("7 / 40");
    expect(count?.id).not.toBe("");
    expect(title?.getAttribute("aria-describedby")).toBe(count?.id);
    if (title === null || title === undefined) throw new Error("no field");
    title.value = "y".repeat(41);
    title.dispatchEvent(new Event("input"));
    expect(count?.textContent).toBe("41 / 40");
    expect(count?.hasAttribute("data-over")).toBe(true);
    // A station's name is not a pin's text: no count.
    draw("station:steps");
    expect(dock.body.querySelector("output.pad")).toBeNull();
  });

  // Why: lowering a radius under its items leaves them where they are;
  // this line is how the creator learns about it.
  it("warns of items outside the circle", () => {
    const model = buildInspector({
      selected: "station:gate",
      stations: STATIONS.map((s) =>
        s.id === "gate" ? { ...s, foundRadiusM: 3 } : s,
      ),
      assets: [],
      codes: [],
    });
    drawInspector(
      dock,
      model,
      { folded: false, positionOpen: false },
      pictures,
    );
    expect(dock.body.querySelector(".warn")?.textContent).toBe(
      "1 item stands outside the circle: visitors see it only from inside the circle.",
    );
    draw("station:gate");
    expect(dock.body.querySelector(".warn")).toBeNull();
  });

  // Why: "Put on the ground" may wait for ground still loading; while it
  // does, its button says so and takes no second press.
  it("shows an action waiting for the ground as in progress", () => {
    draw("station:gate", false, [], "ground-items");
    const button = dock.body.querySelector<HTMLButtonElement>(
      '[data-act="ground-items"]',
    );
    // Waiting, it takes no press, but keeps the keyboard's focus: a
    // `disabled` button would drop it to the page for up to 20 s.
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(button?.querySelector(".lbl")?.textContent).toBe(
      "Waiting for the ground...",
    );
  });

  // Why: pressed from the keyboard, "Put items on the ground" redraws
  // itself as waiting; the focus must stay on it, not fall to the page.
  it("keeps the keyboard's focus on a command that starts waiting", () => {
    draw("station:gate");
    dock.body
      .querySelector<HTMLButtonElement>('[data-act="ground-items"]')
      ?.focus();
    draw("station:gate", false, [], "ground-items");
    const waiting = dock.body.querySelector('[data-act="ground-items"]');
    expect(waiting?.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(waiting);
  });

  it("says a code has no position stored", () => {
    // The code is not in the store's tour, but in the page's codes.
    draw("level-1");
    expect(fields()).toEqual([["Print size", "0.50 m"]]);
    expect(dock.body.querySelector(".note")?.textContent).toBe(
      "No position stored yet.",
    );
  });

  // Why: the tree's drag is a pointer's; Earlier and Later are the
  // keyboard's way to reorder (and a touch screen's, where a drag in a
  // narrow dock is easy to miss), so they sit on the station's own line.
  it("gives a station Earlier and Later beside its place in the tour, off at the ends", () => {
    draw("station:gate");
    const earlier = dock.body.querySelector<HTMLButtonElement>(
      '.sub [data-act="earlier"]',
    );
    const later = dock.body.querySelector<HTMLButtonElement>(
      '.sub [data-act="later"]',
    );
    expect(dock.body.querySelector(".sub")?.textContent).toBe("Station 1 of 2");
    expect(earlier?.getAttribute("aria-label")).toBe("Earlier in the tour");
    expect(later?.getAttribute("aria-label")).toBe("Later in the tour");
    expect(earlier?.disabled).toBe(true);
    expect(later?.disabled).toBe(false);
    draw("station:steps");
    expect(
      dock.body.querySelector<HTMLButtonElement>('[data-act="earlier"]')
        ?.disabled,
    ).toBe(false);
    expect(
      dock.body.querySelector<HTMLButtonElement>('[data-act="later"]')
        ?.disabled,
    ).toBe(true);
  });

  // Why: the tree's commands on the selection are the inspector's actions
  // (the prototype's): Delete for a station, and for an item a station of
  // its own or Delete - each a button in words, its key announced.
  it("lists the selection's actions in words: a station's Delete, an item's new station and Delete", () => {
    const acts = () =>
      [...dock.body.querySelectorAll<HTMLButtonElement>(".acts .act")].map(
        (b) => [b.dataset["act"], b.querySelector(".lbl")?.textContent],
      );
    draw("station:gate");
    expect(acts()).toEqual([
      ["add-pin", "Add short text"],
      ["ground-items", "Put items on the ground"],
      ["delete", "Delete station"],
    ]);
    const del = dock.body.querySelector('.acts [data-act="delete"]');
    expect(del?.getAttribute("aria-keyshortcuts")).toBe("Delete");
    expect(del?.querySelector("kbd")?.getAttribute("aria-hidden")).toBe("true");
    expect(del?.classList.contains("danger")).toBe(true);
    draw("photo-1");
    expect(acts()).toEqual([
      ["split", "Move to a new station"],
      ["ground", "Put on the ground"],
      ["delete", "Delete picture"],
    ]);
    // A code is read-only here: no actions.
    draw("level-1");
    expect(acts()).toEqual([]);
  });

  // Why: the inspector is drawn from the store, and the store changes for
  // reasons that are not the inspector's - an autosave claims its save a
  // few seconds after every edit. A keyboard user on Earlier lost the
  // focus to the page at that moment, and the next Enter went nowhere.
  it("keeps the focus on Earlier through a store change that is not the inspector's", () => {
    const store = storeWith("station:steps");
    const drawFrom = () => {
      const s = store.getState();
      const tour = manifestToWrite(s.tourDocument);
      drawInspector(
        dock,
        buildInspector({
          selected: s.editorView.selected,
          stations: tour?.stations ?? [],
          assets: [],
          codes: [],
        }),
        { folded: false, positionOpen: false },
        pictures,
      );
    };
    drawFrom();
    const earlier = () =>
      dock.body.querySelector<HTMLButtonElement>('[data-act="earlier"]');
    earlier()?.focus();
    expect(document.activeElement).toBe(earlier());
    // An autosave's claim of the save slot: the document changes, the
    // inspector's model does not.
    const doc = store.getState().tourDocument;
    store.dispatch(tourDocumentActions.saveClaimed({ by: "auto" }));
    expect(store.getState().tourDocument).not.toBe(doc);
    drawFrom();
    expect(document.activeElement).toBe(earlier());
  });

  // Why: a change that IS the inspector's (here the station's radius,
  // edited elsewhere) draws it again; the control that had the focus must
  // have it again, or every edit made beside it drops a keyboard user.
  it("gives the focus back to the same control when the inspector is drawn again", () => {
    draw("station:steps");
    dock.body.querySelector<HTMLButtonElement>('[data-act="earlier"]')?.focus();
    const model = buildInspector({
      selected: "station:steps",
      stations: STATIONS.map((s) =>
        s.id === "steps" ? { ...s, foundRadiusM: 12 } : s,
      ),
      assets: [],
      codes: CODES,
    });
    drawInspector(
      dock,
      model,
      { folded: false, positionOpen: false },
      pictures,
    );
    expect(fields()).toContainEqual(["Radius", "12.0 m"]);
    const again = dock.body.querySelector('[data-act="earlier"]');
    expect(again).not.toBeNull();
    expect(document.activeElement).toBe(again);
  });

  // Why: a redraw while a field is being typed in (the ground arrived, a
  // radius changed elsewhere) must not drop what was typed, nor the
  // focus: the creator would lose words mid-sentence.
  it("keeps text typed and not yet committed through a redraw", () => {
    draw("station:steps");
    const description = input("description");
    description?.focus();
    if (description !== null) description.value = "Half a sente";
    const model = buildInspector({
      selected: "station:steps",
      stations: STATIONS.map((s) =>
        s.id === "steps" ? { ...s, foundRadiusM: 12 } : s,
      ),
      assets: [],
      codes: CODES,
    });
    drawInspector(
      dock,
      model,
      { folded: false, positionOpen: false },
      pictures,
    );
    expect(input("description")).not.toBe(description);
    expect(document.activeElement).toBe(input("description"));
    expect(input("description")?.value).toBe("Half a sente");
    // What the tour holds stays the field's own value: leaving it now
    // commits the typed text.
    expect(input("description")?.defaultValue).toBe("");
  });

  // Why: a draw takes the focused field out of the page, and Chromium
  // fires its focusout in the middle of the draw; the shell's commit then
  // dispatched, and the store's change drew the inspector again INSIDE the
  // first draw, which then finished over it and left a stale dock. A draw
  // must say it is running, and must never run inside another.
  it("is never drawn from inside a draw, and says while it draws", () => {
    const seen: boolean[] = [];
    const nested: ShellPictures = {
      show: () => {
        seen.push(inspectorDrawing(dock.root));
        drawInspector(
          dock,
          buildInspector({
            selected: "station:steps",
            stations: STATIONS,
            assets: [],
            codes: CODES,
          }),
          { folded: false, positionOpen: false },
          pictures,
        );
      },
      sweep: vi.fn(),
      clear: vi.fn(),
    };
    // The gate's card picture is drawn during the draw (`show`).
    const gate = buildInspector({
      selected: "station:gate",
      stations: STATIONS,
      assets: [PHOTO_ASSET],
      codes: CODES,
    });
    drawInspector(dock, gate, { folded: false, positionOpen: false }, nested);
    expect(seen).toEqual([true]);
    expect(inspectorDrawing(dock.root)).toBe(false);
    expect(input("title")?.value).toBe("The old gate");
  });

  // Why: a text input drops line breaks, so a pin text of several lines
  // (the 2D card's textarea writes them) read back as one glued line, and
  // focusing and leaving the field wrote that flattened text as an edit.
  // It is read-only here, and the dock says why in words (a title never
  // shows on a touch screen, nor to a sighted keyboard user).
  it("shows a pin text of several lines on one line, read-only, its reason in words, so leaving it writes nothing", () => {
    const withPin = STATIONS.map((s) =>
      s.id === "steps"
        ? {
            ...s,
            blocks: [
              {
                id: "lines",
                kind: "shortText",
                view: "pin",
                caption: "line one\nline two",
                createdAtIso: AT,
                pose: { position: [1, 0, 1], rotation: [0, 0, 0, 1] },
              },
            ],
          }
        : s,
    ) as unknown as TourStation[];
    drawInspector(
      dock,
      buildInspector({
        selected: "lines",
        stations: withPin,
        assets: [],
        codes: CODES,
      }),
      { folded: false, positionOpen: false },
      pictures,
    );
    const title = input("title");
    expect(title?.readOnly).toBe(true);
    expect(title?.value).toBe("line one line two");
    // Its value as shown is its default: nothing reads as typed.
    expect(title?.defaultValue).toBe(title?.value);
    expect(title?.title).toContain("2D map");
    expect(dock.body.textContent).toContain(
      "edit it in the pin's card on the 2D map",
    );
    // Read-only, it is not typed here: no count of its text.
    expect(dock.body.querySelector("#inspector-pin-count")).toBeNull();
    // A one-line text stays a field to type in, with no such line.
    draw("station:steps");
    expect(input("title")?.readOnly).toBe(false);
    expect(dock.body.textContent).not.toContain("2D map");
  });

  // Why: the 3D inspector is the only place that edits a station's name
  // and description, so neither may become read-only when the tour holds
  // a line break (a tour written elsewhere): the description is prose, a
  // text area that keeps its lines; the name is shown on one line and
  // stays editable, an unchanged one reading as untyped (its default is
  // what it shows), so leaving it writes nothing.
  it("keeps a station's name and description of several lines editable, the description in a text area with its lines", () => {
    const lines: TourStation[] = STATIONS.map((s) =>
      s.id === "steps"
        ? { ...s, title: "Upper\ngate", description: "line one\r\nline two" }
        : s,
    );
    drawInspector(
      dock,
      buildInspector({
        selected: "station:steps",
        stations: lines,
        assets: [],
        codes: CODES,
      }),
      { folded: false, positionOpen: false },
      pictures,
    );
    const title = input("title");
    expect(title?.readOnly).toBe(false);
    expect(title?.value).toBe("Upper gate");
    expect(title?.defaultValue).toBe(title?.value);
    const description = dock.root.querySelector('[data-field="description"]');
    expect(description).toBeInstanceOf(HTMLTextAreaElement);
    const area = description as HTMLTextAreaElement;
    expect(area.readOnly).toBe(false);
    expect(area.value).toBe("line one\nline two");
    // A text area reads its line ends as one character: its default is
    // the same, so an untouched one reads as untyped.
    expect(area.defaultValue).toBe(area.value);
    expect(area.labels?.[0]?.textContent).toBe("Description");
    expect(dock.body.textContent).not.toContain("several lines");
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
