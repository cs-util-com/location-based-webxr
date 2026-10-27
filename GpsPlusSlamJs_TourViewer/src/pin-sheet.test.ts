/**
 * Why these tests matter (station blocks plan B2b step 5): a pin shows
 * only its caption in the world; its description is reachable only by a
 * tap. A pin the tap could not reach (hidden content, a pin without a
 * description offered as a target, a label from outside the stations)
 * would open the wrong sheet or none, and a sheet that stayed open after
 * a tap on nothing would cover the visit.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Group, Object3D } from "three";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  cancelsXrSelect,
  createPinSheet,
  tappablePins,
  tourBlocksById,
} from "./pin-sheet.js";

const POSE = {
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
};
const pin = (id: string, description?: string): TourBlock => ({
  id,
  kind: "shortText",
  view: "pin",
  caption: `Caption ${id}`,
  ...(description === undefined ? {} : { description }),
  pose: POSE,
});

function sceneWith(
  entries: { id: string; group: string; visible?: boolean }[],
) {
  const scene = new Group();
  for (const { id, group, visible } of entries) {
    let parent = scene.getObjectByName(group);
    if (parent === undefined) {
      parent = new Group();
      parent.name = group;
      scene.add(parent);
    }
    const label = new Object3D();
    label.userData["objectId"] = id;
    label.visible = visible ?? true;
    parent.add(label);
  }
  return scene;
}

function harness(
  scene: Object3D | null,
  blocks: TourBlock[],
  hit: () => string | null,
) {
  const dom = {
    sheet: { hidden: true },
    title: { textContent: "" },
    text: { textContent: "" },
  };
  const offered: string[][] = [];
  const sheet = createPinSheet({
    dom,
    scene: () => scene,
    blocks: () => new Map(blocks.map((b) => [b.id, b])),
    pick: (targets) => {
      offered.push([...targets.keys()]);
      // As the real pick: only an offered target can be hit.
      const id = hit();
      return id !== null && targets.has(id) ? id : null;
    },
  });
  return { dom, sheet, offered };
}

describe("the visitor's overlay and the tour's blocks", () => {
  // Why: a tap on the story's Continue, the walk sheet or the pin sheet's
  // own Close is ALSO an XR select unless the overlay cancels it, and that
  // select would open (or close) a pin sheet behind the button. A tap on
  // the overlay's empty area must stay a select, or no pin could be tapped.
  it("cancels the select of a tap on a control or a sheet, keeps one on the open view", () => {
    const at = (selector: string | null) => ({
      closest: (s: string) =>
        selector !== null && s.split(", ").includes(selector) ? {} : null,
    });
    expect(cancelsXrSelect(at("button"))).toBe(true);
    expect(cancelsXrSelect(at(".sheet"))).toBe(true);
    expect(cancelsXrSelect(at("#scene-panel"))).toBe(true);
    expect(cancelsXrSelect(at(null))).toBe(false);
    expect(cancelsXrSelect(null)).toBe(false);
  });

  // Why: a tap names a block by its id, tour-wide (block ids are unique
  // across the tour), so the sheet reads every station's blocks.
  it("maps every station's blocks by id, none without a tour", () => {
    expect(tourBlocksById(null).size).toBe(0);
    const station = (id: string, blocks: TourBlock[]) => ({ id, blocks });
    const map = tourBlocksById({
      stations: [station("a", [pin("x", "X.")]), station("b", [pin("y")])],
    });
    expect([...map.keys()]).toEqual(["x", "y"]);
  });
});

describe("the pin sheet", () => {
  it("opens the tapped pin's caption and description, and closes on a tap on nothing", () => {
    let hit: string | null = "sign";
    const h = harness(
      sceneWith([{ id: "sign", group: "station-content:gate" }]),
      [pin("sign", "Carved in 1400.")],
      () => hit,
    );
    h.sheet.tapped(null);
    expect(h.dom).toEqual({
      sheet: { hidden: false },
      title: { textContent: "Caption sign" },
      text: { textContent: "Carved in 1400." },
    });
    expect(h.sheet.openId()).toBe("sign");
    hit = null;
    h.sheet.tapped(null);
    expect(h.dom.sheet.hidden).toBe(true);
    expect(h.sheet.openId()).toBeNull();
  });

  it("offers only shown pins with a description under a station's content", () => {
    const scene = sceneWith([
      { id: "told", group: "station-content:gate" },
      { id: "bare", group: "station-content:gate" },
      { id: "hidden", group: "station-content:gate", visible: false },
      { id: "elsewhere", group: "station-stage:gate" },
      { id: "card", group: "station-content:gate" },
    ]);
    const blocks = [
      pin("told", "More."),
      pin("bare"),
      pin("hidden", "More."),
      pin("elsewhere", "More."),
      {
        id: "card",
        kind: "longText",
        view: "card",
        title: "T",
        body: "B",
        pose: POSE,
      } as TourBlock,
    ];
    expect([
      ...tappablePins(scene, new Map(blocks.map((b) => [b.id, b]))).keys(),
    ]).toEqual(["told"]);
  });

  it("closes outside AR, with no scene to tap", () => {
    const h = harness(null, [pin("sign", "More.")], () => "sign");
    h.sheet.tapped(null);
    expect(h.dom.sheet.hidden).toBe(true);
    expect(h.offered).toEqual([]);
  });

  // Why: over any mix of pins - with or without a description, shown or
  // hidden - the targets are exactly the shown described pins, and a tap
  // opens a sheet only for one of those.
  it("offers exactly the shown described pins, and opens only one of them (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ described: fc.boolean(), visible: fc.boolean() }),
          {
            maxLength: 8,
          },
        ),
        fc.nat(9),
        (pins, pickAt) => {
          const ids = pins.map((_p, i) => `p${String(i)}`);
          const scene = sceneWith(
            pins.map((p, i) => ({
              id: ids[i]!,
              group: "station-content:s",
              visible: p.visible,
            })),
          );
          const blocks = pins.map((p, i) =>
            pin(ids[i]!, p.described ? "More." : undefined),
          );
          const expected = ids.filter(
            (_id, i) => pins[i]!.described && pins[i]!.visible,
          );
          const h = harness(scene, blocks, () => ids[pickAt] ?? null);
          h.sheet.tapped(null);
          expect(h.offered[0]).toEqual(expected);
          const picked = ids[pickAt];
          const opens = picked !== undefined && expected.includes(picked);
          expect(h.dom.sheet.hidden).toBe(!opens);
        },
      ),
    );
  });
});
