/**
 * Why these tests matter (station blocks plan B2b step 2, B-Q4): which
 * blocks stand in a station's world is the visitor's whole view of it. A
 * reached story pin that vanished on the next step, a card drawn in the
 * world, or a free block counted twice would each show the visitor
 * something the creator did not make.
 */
import { describe, expect, it } from "vitest";
import type {
  TourBlock,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  hasStoryWorldBlocks,
  isWorldBlock,
  presentWorldBlocks,
  reachedWorldBlocks,
  worldBlockReachedBy,
} from "./shown-blocks.js";

const POSE = {
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
};
const pin = (id: string): TourBlock => ({
  id,
  kind: "shortText",
  view: "pin",
  caption: id,
  pose: POSE,
});
const card = (id: string): TourBlock => ({
  id,
  kind: "longText",
  view: "card",
  title: id,
  body: id,
  pose: POSE,
});
const show = (id: string, block: string) => ({
  id,
  action: { kind: "show" as const, block },
  advance: { mode: "tap" as const },
});

function station(blocks: TourBlock[], shown: string[]): TourStation {
  return {
    id: "s",
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
    activateRadiusM: 20,
    foundRadiusM: 5,
    hint: "arrow",
    blocks,
    steps: shown.map((b) => show(`step-${b}`, b)),
  };
}

describe("shown-blocks", () => {
  it("tells the world views from the card and the stage", () => {
    expect(isWorldBlock(pin("p"))).toBe(true);
    expect(isWorldBlock(card("c"))).toBe(false);
  });

  it("names the world block a show step reaches, none for a card or a choice", () => {
    const s = station([pin("p"), card("c")], ["p", "c"]);
    expect(worldBlockReachedBy(s, s.steps[0]!)?.id).toBe("p");
    expect(worldBlockReachedBy(s, s.steps[1]!)).toBeNull();
    expect(
      worldBlockReachedBy(s, {
        id: "q",
        action: {
          kind: "choice",
          prompt: "?",
          options: [{ id: "a", label: "A" }],
        },
        advance: { mode: "tap" },
      }),
    ).toBeNull();
  });

  it("stands the free world blocks, then the reached story ones in the order reached, each once", () => {
    const s = station(
      [pin("free"), pin("a"), pin("b"), card("c")],
      ["a", "b", "c"],
    );
    expect(presentWorldBlocks(s, []).map((b) => b.id)).toEqual(["free"]);
    expect(
      presentWorldBlocks(s, ["b", "c", "a", "b", "free", "gone"]).map(
        (b) => b.id,
      ),
    ).toEqual(["free", "b", "a"]);
    expect(reachedWorldBlocks(s, ["free"])).toEqual([]);
    expect(hasStoryWorldBlocks(s)).toBe(true);
    expect(hasStoryWorldBlocks(station([pin("free"), card("c")], ["c"]))).toBe(
      false,
    );
  });
});
