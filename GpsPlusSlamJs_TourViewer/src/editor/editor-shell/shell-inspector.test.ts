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
import {
  buildInspector,
  type InspectorCode,
  type InspectorModel,
} from "./inspector-model.js";
import { drawInspector, inspectorDrawing } from "./shell-inspector.js";
import type { ShellPictures } from "./shell-pictures.js";
import { stationContent } from "../../test-support/station-content.js";

const AT = "2026-10-22T10:00:00Z";

/** A free video's inspector: an item with no place in the world. */
const NO_PLACE = {
  kind: "item",
  itemKind: "video",
  title: "A clip",
  sub: "Video in The old gate",
  stationId: "gate",
  text: null,
  extent: null,
  model: null,
  longText: null,
  offset: null,
  headingDeg: null,
  turns: false,
  folder: null,
  groundOffM: null,
} as const;

const STATIONS = [
  {
    id: "gate",
    title: "The old gate",
    description: "Where the wall stood",
    geo: { lat: 48.1371, lon: 11.5754, alt: 562.25, headingDeg: 30 },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",

    image: "photo-1",
    ...stationContent([
      {
        id: "photo-1",
        kind: "picture",
        view: "plane",
        image: "photo-1",
        widthM: 1,
        createdAtIso: AT,
        pose: { position: [4, 1.5, -2], rotation: [0, 0, 0, 1] },
      },
    ]),
  },
  {
    id: "steps",
    title: "The town hall steps",
    geo: { lat: 48.138, lon: 11.576, alt: 560, headingDeg: 0 },
    activateRadiusM: 60,
    foundRadiusM: 30,
    hint: "arrow",
    ...stationContent([]),
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
    >("output:not(.count), input:not([type=range]), textarea"),
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
        contents: [],
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

  /** A story's entry with `block`, as its inspector reads it. */
  const entryOf = (
    block: Extract<InspectorModel, { kind: "storyEntry" }>["block"],
    advance: { mode: string; afterS: number | null } = {
      mode: "tap",
      afterS: null,
    },
  ) =>
    ({
      kind: "storyEntry",
      id: block.id,
      stationId: "gate",
      rowKind: "text",
      title: block.title,
      sub: "1 The old gate / The legend / Long text, entry 1",
      block,
      advance,
    }) as const;
  const FOLD = { folded: false, positionOpen: false };

  // Why: a story's parts left the station's inspector for a story's own: a
  // story's title is typed in the head, its entries are listed in order
  // with the way to add one, and its Delete says what goes with it. Names
  // are the file's, never markup.
  it("draws a story: its typed title, its numbered entries, its commands", () => {
    drawInspector(
      dock,
      {
        kind: "story",
        storyId: "legend",
        stationId: "gate",
        title: "The <b>legend</b>",
        sub: "1 The old gate / Story",
        entries: [
          { id: "intro", kind: "text", title: "The <i>siege</i>", place: 1 },
          { id: "way", kind: "choice", title: "Choice: Which?", place: 2 },
        ],
      },
      FOLD,
      pictures,
    );
    const title = dock.head.querySelector<HTMLInputElement>(
      '[data-field="story-title"]',
    );
    expect(title?.defaultValue).toBe("The <b>legend</b>");
    expect(title?.getAttribute("aria-label")).toBe("Name of the story");
    expect(dock.body.querySelector(".sub")?.textContent).toBe(
      "1 The old gate / Story",
    );
    expect(dock.body.querySelector('[data-act="contents"]')?.textContent).toBe(
      "Entries2, played in order",
    );
    expect(
      [...dock.body.querySelectorAll<HTMLElement>(".kids .kid")].map((k) => [
        k.dataset["act"],
        k.querySelector(".meta")?.textContent,
        k.querySelector(".nm")?.textContent,
      ]),
    ).toEqual([
      ["goto:intro", "1", "The <i>siege</i>"],
      ["goto:way", "2", "Choice: Which?"],
    ]);
    expect(dock.body.querySelector("b, i")).toBeNull();
    expect(
      dock.body.querySelector('[data-act="add-entry"]')?.textContent,
    ).toContain("Add entry...");
    expect(
      dock.body.querySelector('[data-act="delete"]')?.textContent,
    ).toContain("Delete story and its 2 entries...");
  });

  it("says an empty story has no entries, and needs no words on its Delete", () => {
    drawInspector(
      dock,
      {
        kind: "story",
        storyId: "legend",
        stationId: "gate",
        title: "Empty",
        sub: "1 The old gate / Story",
        entries: [],
      },
      FOLD,
      pictures,
    );
    expect(dock.body.querySelector(".kids")).toBeNull();
    expect(dock.body.textContent).toContain("No entries yet.");
    expect(
      dock.body.querySelector('[data-act="delete"]')?.textContent,
    ).toContain("Delete story");
    expect(
      dock.body.querySelector('[data-act="delete"]')?.textContent,
    ).not.toContain("entries");
  });

  // Why: an entry that is no block waits for an answer. It cannot be edited
  // yet, so what it says and its Delete are all there is: a summary drawn as
  // text, and no field that would suggest otherwise.
  it("draws a choice's or a quiz's summary as text, with its Delete", () => {
    drawInspector(
      dock,
      {
        kind: "storyStep",
        stepKind: "choice",
        id: "way",
        stationId: "gate",
        title: "Which <b>way</b>?",
        sub: "1 The old gate / The legend / Choice, entry 2",
        heading: "Answers",
        lines: ["<b>Back</b> - goes to The siege", "On - plays on"],
      },
      FOLD,
      pictures,
    );
    expect(dock.head.querySelector(".ttl")?.textContent).toBe(
      "Which <b>way</b>?",
    );
    expect(
      [...dock.body.querySelectorAll(".steplines li")].map(
        (l) => l.textContent,
      ),
    ).toEqual(["<b>Back</b> - goes to The siege", "On - plays on"]);
    expect(dock.body.querySelector("b")).toBeNull();
    expect(dock.body.querySelector("input, textarea")).toBeNull();
    expect(
      dock.body.querySelector('[data-act="delete"]')?.textContent,
    ).toContain("Delete choice");
  });

  // Why: a video has no place in the world, so its inspector has nothing
  // to move, ground or split off: its texts and its Delete only.
  it("draws a free video's texts and its Delete", () => {
    drawInspector(
      dock,
      {
        ...NO_PLACE,
        fields: [
          {
            name: "title",
            label: "Title",
            value: "A clip",
            max: 80,
            unit: "codePoints",
            required: false,
            prose: false,
          },
        ],
      },
      FOLD,
      pictures,
    );
    expect(
      dock.body.querySelector<HTMLInputElement>('[data-field="title"]')
        ?.defaultValue,
    ).toBe("A clip");
    expect(
      dock.body.querySelector('[data-act="delete"]')?.textContent,
    ).toContain("Delete video");
    expect(
      [...dock.body.querySelectorAll("[data-act]")].map(
        (b) => (b as HTMLElement).dataset["act"],
      ),
    ).toEqual(["delete"]);
    expect(dock.body.querySelector('[data-field="east"]')).toBeNull();
  });

  // Why: in the 3D view a click on a folder's item picks the item alone,
  // so its inspector is the 3D view's way to the folder (the tree's row is
  // the other); an item at its station's top has no folder to offer.
  it("offers to select the folder holding a placed item, by its name", () => {
    const placed = {
      ...NO_PLACE,
      itemKind: "shortText",
      offset: { northM: 1, upM: 0, eastM: 2 },
      headingDeg: 0,
      fields: [],
    } as const;
    drawInspector(
      dock,
      { ...placed, folder: { id: "f", title: "Benches" } },
      FOLD,
      pictures,
    );
    const button = dock.body.querySelector<HTMLButtonElement>(
      '[data-act="select:folder:f"]',
    );
    expect(button?.textContent).toContain("Select the folder");
    expect(button?.textContent).toContain("Benches");
    drawInspector(dock, placed, FOLD, pictures);
    expect(dock.body.querySelector('[data-act^="select:"]')).toBeNull();
  });

  // Why: a sound's radius, reach and volume are numbers (block-fields.ts
  // `number`): typed in a decimal box with the unit beside it, never a
  // text with a character counter.
  it("draws a block's number field as a decimal box with its unit", () => {
    drawInspector(
      dock,
      {
        ...NO_PLACE,
        fields: [
          {
            name: "radiusM",
            label: "Radius",
            value: "6",
            required: true,
            prose: false,
            number: { unit: "m", scale: 1 },
          },
        ],
      },
      FOLD,
      pictures,
    );
    const input = dock.body.querySelector<HTMLInputElement>(
      '[data-field="radiusM"]',
    );
    expect(input?.defaultValue).toBe("6");
    expect(input?.inputMode).toBe("decimal");
    expect(input?.placeholder).toBe("Required");
    expect(input?.closest(".num")?.querySelector(".unit")?.textContent).toBe(
      "m",
    );
    expect(dock.body.querySelector("output.count")).toBeNull();
  });

  // Why: how a block moves on is the one thing of its step the entry's
  // inspector sets: the chip in use pressed, the seconds only while they
  // mean something, and a mode no chip offers still shown as its own chip.
  it("draws how a story's block moves on, its seconds only when automatic", () => {
    const block = { id: "b1", kind: "Long text", title: "T", fields: [] };
    const chips = () =>
      [
        ...dock.body.querySelectorAll<HTMLElement>("[data-act^=entry-advance]"),
      ].map((b) => [b.dataset["act"], b.getAttribute("aria-pressed")]);
    drawInspector(dock, entryOf(block), FOLD, pictures);
    expect(chips()).toEqual([
      ["entry-advance:b1:tap", "true"],
      ["entry-advance:b1:auto", "false"],
    ]);
    expect(dock.body.querySelector('[data-field="entry-after:b1"]')).toBeNull();
    drawInspector(
      dock,
      entryOf(block, { mode: "auto", afterS: 8 }),
      FOLD,
      pictures,
    );
    expect(chips()[1]).toEqual(["entry-advance:b1:auto", "true"]);
    expect(
      dock.body.querySelector<HTMLInputElement>('[data-field="entry-after:b1"]')
        ?.defaultValue,
    ).toBe("8");
    drawInspector(
      dock,
      entryOf(block, { mode: "lineEnd", afterS: null }),
      FOLD,
      pictures,
    );
    expect(chips()).toEqual([
      ["entry-advance:b1:tap", "false"],
      ["entry-advance:b1:auto", "false"],
      ["entry-advance:b1:lineEnd", "true"],
    ]);
  });

  // Why: a story character is set in his entry's inspector with the
  // controls a model's view already has - chips, the one in use pressed -
  // and his facing as a heading typed like an item's: each control named
  // by the block it sets (`data-act` / `data-field`), so the shell writes
  // to the right character. The facing turns only the pop-up stage (a
  // flat figure faces the visitor fully), so it shows in that view alone.
  it("draws a story character's view and advance as chips and, in the pop-up, his facing as a heading", () => {
    drawInspector(
      dock,
      entryOf({
        id: "w1",
        kind: "Character",
        title: "Wendel",
        character: { view: "popup", advance: "lineEnd", facingDeg: 179.6 },
        fields: [],
      }),
      FOLD,
      pictures,
    );
    const section = dock.body.querySelector<HTMLElement>(
      '.character[data-block="w1"]',
    );
    expect(section).not.toBeNull();
    expect(dock.body.querySelectorAll(".character")).toHaveLength(1);
    const chips = (prefix: string) =>
      [
        ...(section?.querySelectorAll<HTMLButtonElement>(
          `[data-act^="${prefix}"]`,
        ) ?? []),
      ].map((b) => [
        b.dataset["act"],
        b.textContent,
        b.getAttribute("aria-pressed"),
      ]);
    expect(chips("character-view:")).toEqual([
      ["character-view:w1:bubble", "Bubble", "false"],
      ["character-view:w1:speak", "Tap to speak", "false"],
      ["character-view:w1:two-stations", "Two stations", "false"],
      ["character-view:w1:portrait", "Portrait", "false"],
      ["character-view:w1:popup", "Pop-up", "true"],
    ]);
    expect(chips("character-advance:")).toEqual([
      ["character-advance:w1:tap", "On a tap", "false"],
      ["character-advance:w1:lineEnd", "When the line ends", "true"],
    ]);
    // Each group of chips is named by its label.
    const groups = [...(section?.querySelectorAll('[role="group"]') ?? [])];
    expect(
      groups.map(
        (g) =>
          dock.body.querySelector(
            `[id="${g.getAttribute("aria-labelledby") ?? ""}"]`,
          )?.textContent,
      ),
    ).toEqual(["View", "Moves on"]);
    const facing = section?.querySelector<HTMLInputElement>(
      '[data-field="character-facing:w1"]',
    );
    expect(facing?.defaultValue).toBe("180");
    expect(facing?.labels?.[0]?.textContent).toBe("Facing");
    expect(section?.textContent).toContain("Wendel");

    // In every flat-figure view a turn shows nothing: no Facing field.
    for (const view of ["bubble", "speak", "two-stations", "portrait"]) {
      drawInspector(
        dock,
        entryOf({
          id: "w1",
          kind: "Character",
          title: "Wendel",
          character: { view, advance: "tap", facingDeg: 90 },
          fields: [],
        }),
        FOLD,
        pictures,
      );
      expect(
        dock.body.querySelector('[data-field="character-facing:w1"]'),
        view,
      ).toBeNull();
    }
  });

  // Why: a story block's texts are typed in its entry's inspector, each
  // named by the block and the field it sets (`block:<id>:<field>`), so
  // the shell writes to the right block; each shows its count against the
  // format's cap; a character's texts sit in his own box, under his
  // settings; a story block without texts to type gets no box.
  it("draws a story block's texts named by block and field, a character's in his box", () => {
    const field = (
      name: string,
      label: string,
      value: string,
      max: number,
    ) => ({
      name,
      label,
      value,
      max,
      unit: "codePoints" as const,
      required: true,
      prose: name !== "title" && name !== "name",
    });
    drawInspector(
      dock,
      entryOf({
        id: "intro",
        kind: "Long text",
        title: "The siege",
        fields: [
          field("title", "Title", "The siege", 80),
          field("body", "Body", "In 1632", 32000),
        ],
      }),
      FOLD,
      pictures,
    );
    const intro = dock.body.querySelector<HTMLElement>(
      '.story-text[data-block="intro"]',
    );
    const title = intro?.querySelector<HTMLInputElement>(
      '[data-field="block:intro:title"]',
    );
    expect(title?.defaultValue).toBe("The siege");
    expect(title?.labels?.[0]?.textContent).toBe("Title");
    const body = intro?.querySelector<HTMLTextAreaElement>(
      'textarea[data-field="block:intro:body"]',
    );
    expect(body?.defaultValue).toBe("In 1632");
    const count = dock.body.querySelector(
      `[id="${body?.getAttribute("aria-describedby") ?? ""}"]`,
    );
    expect(count?.textContent).toContain("32000");

    drawInspector(
      dock,
      entryOf({
        id: "k1",
        kind: "Character",
        title: "Sir Kay",
        character: { view: "speak", advance: "tap", facingDeg: 0 },
        fields: [
          field("name", "Name", "Sir Kay", 80),
          field("caption", "Caption", "Hold the gate.", 2000),
        ],
      }),
      FOLD,
      pictures,
    );
    const kay = dock.body.querySelector<HTMLElement>(
      '.character[data-block="k1"]',
    );
    expect(
      [...(kay?.querySelectorAll<HTMLElement>("[data-field]") ?? [])].map(
        (f) => f.dataset["field"],
      ),
    ).toEqual(["block:k1:name", "block:k1:caption"]);
    expect(dock.body.querySelector('.story-text[data-block="k1"]')).toBeNull();

    drawInspector(
      dock,
      entryOf({ id: "arch", kind: "Model", title: "Arch", fields: [] }),
      FOLD,
      pictures,
    );
    expect(dock.body.querySelector('.isec[data-block="arch"]')).toBeNull();
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
    // The radius sits with the position under "Place", folded.
    expect(fields()).toEqual([
      ["Name", "The old gate"],
      ["Description", "Where the wall stood"],
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
    // Folded: a one-line summary, the radius first, then metres of the
    // centre.
    const disclosure = dock.body.querySelector("button.disc");
    expect(disclosure?.getAttribute("aria-expanded")).toBe("false");
    expect(disclosure?.querySelector(".lab")?.textContent).toBe("Place");
    expect(disclosure?.querySelector(".sum")?.textContent).toMatch(
      /^r 25 m {2}E -?\d+\.\d {2}N -?\d+\.\d {2}30 deg$/,
    );
  });

  // Why: the radius is where the station is felt, so it sits with the
  // position (the place), first once unfolded, its note under it.
  it("puts the radius first under Place, once unfolded", () => {
    draw("station:gate", true);
    expect(fields()[2]).toEqual(["Radius", "25.0 m"]);
    const pos = dock.body.querySelector(".pos");
    expect(pos?.contains(input("radius"))).toBe(true);
    expect(pos?.querySelector(".note")?.textContent).toMatch(
      /^Visitors who step inside this circle/,
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

  // Why: a folder's pivot fields are what the creator types to move, turn
  // or scale its whole group; each field must carry the folder's value
  // and its name, or the edit would land on nothing. They show open, under
  // their own heading, as the chosen design has them (a folder has no
  // other fields to fold them away from).
  it("shows a folder's pivot to type: its position, height, heading and scale", () => {
    const folderStation = {
      ...STATIONS[0]!,
      children: [
        {
          id: "f",
          kind: "folder",
          title: "Benches",
          pose: { position: [4, 1, -2], rotation: [0, 0, 0, 1] },
          scale: 2,
          children: [],
        },
      ],
    } as unknown as TourStation;
    const model = buildInspector({
      selected: "folder:f",
      stations: [folderStation],
      assets: [],
      codes: CODES,
    });
    drawInspector(
      dock,
      model,
      { folded: false, positionOpen: false, busy: null },
      pictures,
    );
    expect(dock.head.querySelector(".ttl")?.textContent).toBe("Benches");
    expect(dock.body.querySelector(".isec-h")?.textContent).toBe(
      "Pivot (from the station centre)",
    );
    expect(dock.body.querySelector(".sub")?.textContent).toBe(
      "Folder in The old gate, 0 items",
    );
    expect(fields()).toEqual([
      ["Position east", "-2.00 m"],
      ["Position north", "4.00 m"],
      ["Height", "1.00 m"],
      ["Heading", "0.0 deg"],
      ["Scale", "2.00 x"],
    ]);
    for (const name of ["scale", "east", "north", "height", "heading"]) {
      expect(input(name)).not.toBeNull();
    }
  });

  // Why: the prototype's folder inspector is the way from the folder to
  // one of its items alone (a row selects it, as the tree's does), to all
  // of them picked ("Select its items"), and to a pivot at their centre;
  // each must carry the act the shell answers, and an empty folder offers
  // no pick of nothing.
  it("lists a folder's items to select alone, and offers Pivot to centre and Select its items", () => {
    const pinOf = (id: string, caption: string) => ({
      id,
      kind: "shortText",
      view: "pin",
      caption,
      createdAtIso: AT,
      pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    });
    const station = (children: unknown[]) =>
      ({
        ...STATIONS[0]!,
        children: [
          {
            id: "f",
            kind: "folder",
            title: "Benches",
            pose: { position: [4, 1, -2], rotation: [0, 0, 0, 1] },
            children,
          },
        ],
      }) as unknown as TourStation;
    const show = (children: unknown[]) => {
      drawInspector(
        dock,
        buildInspector({
          selected: "folder:f",
          stations: [station(children)],
          assets: [],
          codes: CODES,
        }),
        { folded: false, positionOpen: false, busy: null },
        pictures,
      );
    };
    show([pinOf("a", "North bench"), pinOf("b", "South bench")]);
    const rows = [...dock.body.querySelectorAll<HTMLElement>(".kids .kid")];
    expect(rows.map((r) => [r.dataset["act"], r.textContent])).toEqual([
      ["goto:a", "North bench"],
      ["goto:b", "South bench"],
    ]);
    const act = (name: string) =>
      dock.body.querySelector<HTMLButtonElement>(`[data-act="${name}"]`);
    expect(act("pivot-centre")?.textContent).toContain("Pivot to centre");
    expect(act("select-items")?.textContent).toContain("Select its items");
    expect(act("select-items")?.disabled).toBe(false);
    show([]);
    expect(dock.body.querySelectorAll(".kids .kid")).toHaveLength(0);
    expect(act("select-items")?.disabled).toBe(true);
  });

  it("shows an item's offset in its station's frame, its height and heading to type", () => {
    draw("photo-1", true);
    // A picture's text fields first; its kind in the creator's word.
    expect(dock.body.querySelector(".sub")?.textContent).toBe(
      "Photo in The old gate",
    );
    expect(fields()).toEqual([
      ["Title", ""],
      ["Caption", ""],
      ["Alt text", ""],
      // Its width, the size its white dots change.
      ["Width", "1.00 m"],
      ["Offset east", "-2.00 m"],
      ["Offset north", "4.00 m"],
      ["Height", "1.50 m"],
      ["Heading", "0.0 deg"],
    ]);
    // A picture's head is words; its title, caption and alt text are
    // typed in the body, each with its count against its cap.
    expect(dock.head.querySelector("input")).toBeNull();
    expect(dock.head.querySelector(".ttl")?.textContent).toBe("Photo");
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

  // Why: the shell draws the inspector again 5 times a second while the
  // view shows, so the ground arriving or refining under the selection
  // shows in "Put on the ground". That height changes often while the
  // ground loads; a rebuild of the whole dock for it would swallow a
  // click on the way and could lose a half-typed field. Only the ground
  // button changes, in place: every other control stays the same node.
  it("updates only the ground button when only the ground under it changes", () => {
    const state = storeWith("station:gate").getState();
    const tour = manifestToWrite(state.tourDocument);
    const drawOver = (groundM: number | null) => {
      drawInspector(
        dock,
        buildInspector({
          selected: "station:gate",
          stations: tour?.stations ?? [],
          assets: tour?.assets ?? [],
          codes: CODES,
          unlockedStations: ["gate"],
          groundAt: () => groundM,
        }),
        { folded: false, positionOpen: true },
        pictures,
      );
    };
    const ground = () =>
      dock.body.querySelector<HTMLButtonElement>('.pos [data-act="ground"]');
    drawOver(null);
    const north = input("north");
    const button = ground();
    north?.focus();
    if (north !== null) north.value = "12";
    for (const [groundM, note, disabled] of [
      [550, "12.3 m up", false],
      [550.04, "12.2 m up", false],
      [562.25, "", true],
      [null, "", false],
    ] as const) {
      drawOver(groundM);
      expect(input("north"), String(groundM)).toBe(north);
      expect(ground(), String(groundM)).toBe(button);
      expect(document.activeElement).toBe(north);
      expect(north?.value).toBe("12");
      expect(button?.querySelector(".note")?.textContent ?? "").toBe(note);
      expect(button?.disabled).toBe(disabled);
    }
    // Anything else that changes still draws the dock again.
    drawInspector(
      dock,
      buildInspector({
        selected: "station:gate",
        stations: tour?.stations ?? [],
        assets: tour?.assets ?? [],
        codes: CODES,
        unlockedStations: [],
        groundAt: () => 550,
      }),
      { folded: false, positionOpen: true },
      pictures,
    );
    expect(ground()).not.toBe(button);
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
            ...stationContent([
              {
                id: "pin-x",
                kind: "shortText",
                view: "pin",
                caption: "Look up",
                createdAtIso: AT,
                pose: { position: [1, 0, 1], rotation: [0, 0, 0, 1] },
              },
            ]),
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
            ...stationContent([
              {
                id: "pin-x",
                kind: "shortText",
                view: "pin",
                caption: "Look up",
                createdAtIso: AT,
                pose: { position: [1, 0, 1], rotation: [0, 0, 0, 1] },
              },
            ]),
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
  // Why: a story's entry is moved from the keyboard by these: Earlier and
  // Later beside its place, as a station's are, and a Move button per
  // list it may go into - each named in words, the ends off.
  it("gives a story's entry Earlier, Later and its Move buttons", () => {
    drawInspector(
      dock,
      {
        kind: "storyStep",
        stepKind: "choice",
        id: "way",
        stationId: "gate",
        title: "Which way?",
        sub: "1 The old gate / The legend / Choice, entry 1",
        heading: "Answers",
        lines: [],
        moves: {
          step: { earlier: false, later: true },
          targets: [
            { list: "free", label: "Move out of the story" },
            { list: "story:aside", label: 'Move into "Aside"' },
          ],
          stations: [{ id: "mill", label: "The mill" }],
        },
      },
      FOLD,
      pictures,
    );
    const earlier = dock.body.querySelector<HTMLButtonElement>(
      '.sub [data-act="earlier"]',
    );
    const later = dock.body.querySelector<HTMLButtonElement>(
      '.sub [data-act="later"]',
    );
    expect(earlier?.getAttribute("aria-label")).toBe("Earlier in the story");
    expect(earlier?.disabled).toBe(true);
    expect(later?.disabled).toBe(false);
    expect(
      [
        ...dock.body.querySelectorAll<HTMLElement>('[data-act^="move-to:"]'),
      ].map((b) => [b.dataset["act"], b.textContent]),
    ).toEqual([
      ["move-to:free", "Move out of the story"],
      ["move-to:story:aside", 'Move into "Aside"'],
    ]);
    // The phone's and the keyboard's way onto another station: a picker
    // whose first, disabled option names it, then each station it may go to.
    const pick = dock.body.querySelector<HTMLSelectElement>(
      "select[data-move-station]",
    );
    expect(pick?.getAttribute("aria-label")).toBe("Move to station");
    expect(
      [...(pick?.options ?? [])].map((o) => [o.value, o.disabled]),
    ).toEqual([
      ["", true],
      ["mill", false],
    ]);
  });

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
      [
        ...dock.body.querySelectorAll<HTMLButtonElement>(
          ":not(.contents) > .acts .act",
        ),
      ].map((b) => [b.dataset["act"], b.querySelector(".lbl")?.textContent]);
    draw("station:gate");
    // Adding is the tree's and the palette's; Delete comes last, behind
    // a separator, so it is never the next button by accident.
    expect(acts()).toEqual([
      ["ground-items", "Put items on the ground"],
      ["delete", "Delete station"],
    ]);
    const sep = dock.body.querySelector('.acts [role="separator"]');
    expect(sep?.nextElementSibling?.getAttribute("data-act")).toBe("delete");
    const del = dock.body.querySelector('.acts [data-act="delete"]');
    expect(del?.getAttribute("aria-keyshortcuts")).toBe("Delete");
    expect(del?.querySelector("kbd")?.getAttribute("aria-hidden")).toBe("true");
    expect(del?.classList.contains("danger")).toBe(true);
    draw("photo-1");
    expect(acts()).toEqual([
      ["split", "Move to a new station"],
      ["ground", "Put on the ground"],
      ["delete", "Delete photo"],
    ]);
    expect(
      dock.body
        .querySelector('.acts [role="separator"]')
        ?.nextElementSibling?.getAttribute("data-act"),
    ).toBe("delete");
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
    draw("station:steps", true);
    dock.body.querySelector<HTMLButtonElement>('[data-act="earlier"]')?.focus();
    const model = buildInspector({
      selected: "station:steps",
      stations: STATIONS.map((s) =>
        s.id === "steps" ? { ...s, foundRadiusM: 12 } : s,
      ),
      assets: [],
      codes: CODES,
    });
    drawInspector(dock, model, { folded: false, positionOpen: true }, pictures);
    expect(fields()).toContainEqual(["Radius", "12.0 m"]);
    const again = dock.body.querySelector('[data-act="earlier"]');
    expect(again).not.toBeNull();
    expect(document.activeElement).toBe(again);
  });

  // Why: an arrow key steps the focused radius slider, and its write draws
  // the inspector inside the change event. A slider has no caret: carried
  // over like typed text it threw, and the step never reached the history.
  it("keeps the focus on a slider through a redraw, its value the model's", () => {
    draw("station:steps", true);
    const slider = (): HTMLInputElement | null =>
      dock.body.querySelector('[data-act="radius-slider"]');
    const moved = slider();
    moved?.focus();
    if (moved !== null) moved.value = "12";
    const model = buildInspector({
      selected: "station:steps",
      stations: STATIONS.map((s) =>
        s.id === "steps" ? { ...s, foundRadiusM: 12 } : s,
      ),
      assets: [],
      codes: CODES,
    });
    drawInspector(dock, model, { folded: false, positionOpen: true }, pictures);
    expect(slider()).not.toBe(moved);
    expect(document.activeElement).toBe(slider());
    expect(slider()?.value).toBe("12");
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

  // Why: a field selected and not yet typed in has nothing to carry over,
  // so a redraw put the caret at its start: the next keys landed before
  // the old text ("The old wellPin a") instead of replacing it.
  it("keeps the selection in a field not typed in through a redraw", () => {
    const drawAt = (foundRadiusM: number) => {
      drawInspector(
        dock,
        buildInspector({
          selected: `station:${STATIONS[0]?.id ?? ""}`,
          stations: STATIONS.map((s, i) =>
            i === 0 ? { ...s, description: "Old words", foundRadiusM } : s,
          ),
          assets: [],
          codes: CODES,
        }),
        { folded: false, positionOpen: false },
        pictures,
      );
    };
    drawAt(11);
    const description = input("description");
    description?.focus();
    description?.setSelectionRange(0, "Old words".length);
    drawAt(12);
    const again = input("description");
    expect(again).not.toBe(description);
    expect(document.activeElement).toBe(again);
    expect(again?.value).toBe("Old words");
    expect([again?.selectionStart, again?.selectionEnd]).toEqual([0, 9]);
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
            ...stationContent([
              {
                id: "lines",
                kind: "shortText",
                view: "pin",
                caption: "line one\nline two",
                createdAtIso: AT,
                pose: { position: [1, 0, 1], rotation: [0, 0, 0, 1] },
              },
            ]),
          }
        : s,
    );
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

describe("a station's Contents", () => {
  const contents = () =>
    dock.body.querySelector<HTMLButtonElement>('[data-act="contents"]');
  const rows = () => [
    ...dock.body.querySelectorAll<HTMLButtonElement>(".contents .kid"),
  ];

  // Why: the inspector is where a station is read on a phone, the tree out
  // of sight, so its items are listed there, and a tap on one goes to it.
  it("lists the station's items by kind and name, open from the start", () => {
    draw("station:gate");
    expect(contents()?.getAttribute("aria-expanded")).toBe("true");
    expect(contents()?.querySelector(".sum")?.textContent).toBe("1 item");
    expect(rows().map((r) => r.dataset["act"])).toEqual(["goto:photo-1"]);
    expect(rows()[0]?.querySelector(".ic")?.classList.contains("photo")).toBe(
      true,
    );
    expect(rows()[0]?.textContent).not.toBe("");
  });

  it("says when a station holds nothing, and offers to add", () => {
    draw("station:steps");
    expect(contents()?.querySelector(".sum")?.textContent).toBe("0 items");
    expect(rows()).toHaveLength(0);
    expect(dock.body.querySelector(".contents .note")?.textContent).toBe(
      "Nothing at this station yet.",
    );
    expect(
      dock.body.querySelector('.contents [data-act="add-content"]'),
    ).not.toBeNull();
  });

  // Why: `.pos` is the position's body, read by the fold's checks: the
  // list must not pass for it.
  it("folds on its own, apart from the position", () => {
    const state = { folded: false, positionOpen: false, contentsOpen: false };
    const store = storeWith("station:gate").getState();
    const tour = manifestToWrite(store.tourDocument);
    drawInspector(
      dock,
      buildInspector({
        selected: "station:gate",
        stations: tour?.stations ?? [],
        assets: tour?.assets ?? [],
        codes: CODES,
      }),
      state,
      pictures,
    );
    expect(contents()?.getAttribute("aria-expanded")).toBe("false");
    expect(rows()).toHaveLength(0);
    expect(dock.body.querySelector(".pos")).toBeNull();
  });

  it("does not list an item's own details as a station's", () => {
    draw("photo-1");
    expect(contents()).toBeNull();
  });
});

describe("the radius slider", () => {
  // Why: a number alone takes typing, a poor way to feel a circle's size;
  // the slider stands beside the number, which stays the way to a value
  // past the track.
  it("stands beside the radius's number under Place", () => {
    draw("station:gate", true);
    const range = dock.body.querySelector(".pos .range");
    expect(range?.querySelector("input[type=range]")).not.toBeNull();
    expect(range?.contains(input("radius"))).toBe(true);
  });
});

describe("the head's way back", () => {
  // Why: on a phone the details cover the list, so the head must lead back.
  it("starts with the back arrow, every kind of element", () => {
    for (const id of ["station:gate", "photo-1"]) {
      draw(id);
      const first = dock.head.firstElementChild as HTMLElement;
      expect(first.dataset["act"]).toBe("back");
      expect(first.getAttribute("aria-label")).toBe("Back to the list");
    }
  });
});
