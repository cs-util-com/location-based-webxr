/**
 * Why this property matters (station blocks plan B2b step 2, B-Q4): it
 * drives the visitor's real story panel (`createSceneView`) through any
 * sequence of story actions - taps, choices, an end, a stop, the station
 * offered again - and holds the world it leaves to the plan's rule: the
 * blocks present are the station's free world blocks plus every story
 * world block a step reached, never a card or a stage block (the stage's
 * one figure is `scene-stage.ts`'s own invariant, tested there), and a
 * reached block never leaves. The oracle is the block the open panel
 * shows after each action (its words), not `shown-blocks.ts`, so the
 * module cannot confirm itself.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  TourAsset,
  TourBlock,
  TourStation,
  TourStep,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { createSceneView, type SceneViewDom } from "./scene-view.js";
import { presentWorldBlocks } from "./shown-blocks.js";

const POSE = {
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
};

/** One block of each shape a story can show; its id is the words the
 *  card shows for it, so the oracle can read which block is shown. */
function blockOf(id: string, shape: number): TourBlock {
  switch (shape) {
    case 0:
      return { id, kind: "shortText", view: "pin", caption: id, pose: POSE };
    case 1:
      return {
        id,
        kind: "picture",
        view: "plane",
        image: "img",
        widthM: 1,
        caption: id,
        pose: POSE,
      };
    case 2:
      return {
        id,
        kind: "model",
        view: "placed",
        asset: "glb",
        sizeM: 1,
        title: id,
        pose: POSE,
      };
    case 3:
      return {
        id,
        kind: "model",
        view: "stage",
        asset: "glb",
        title: id,
        pose: POSE,
      };
    case 4:
      return {
        id,
        kind: "character",
        view: "stage",
        name: "K",
        image: "img",
        caption: id,
        pose: POSE,
      };
    default:
      return {
        id,
        kind: "longText",
        view: "card",
        title: id,
        body: id,
        pose: POSE,
      };
  }
}

const WORLD = new Set(["pin", "plane", "placed"]);

const assets = new Map<string, TourAsset>([
  [
    "img",
    { id: "img", path: "content/img.png", kind: "image", width: 1, height: 1 },
  ],
  ["glb", { id: "glb", path: "content/m.glb", kind: "model" }],
]);

const arbStation = fc
  .record({
    shapes: fc.array(fc.integer({ min: 0, max: 5 }), {
      minLength: 1,
      maxLength: 7,
    }),
    // Which blocks a step shows (the rest are free), and where a choice sits.
    shownMask: fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
    choiceAt: fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined }),
  })
  .map(({ shapes, shownMask, choiceAt }): TourStation => {
    const blocks = shapes.map((shape, i) => blockOf(`b${String(i)}`, shape));
    const steps: TourStep[] = blocks
      .filter((_b, i) => shownMask[i] === true)
      .map((b) => ({
        id: `s-${b.id}`,
        action: { kind: "show", block: b.id },
        advance: { mode: "tap" },
      }));
    if (choiceAt !== undefined && steps.length > 0) {
      const options = steps.map((s, i) => ({
        id: `o${String(i)}`,
        label: s.id,
        goto: s.id,
      }));
      steps.splice(Math.min(choiceAt, steps.length), 0, {
        id: "choice",
        action: { kind: "choice", prompt: "?", options },
        advance: { mode: "tap" },
      });
    }
    return {
      id: "st",
      geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
      activateRadiusM: 20,
      foundRadiusM: 5,
      hint: "arrow",
      blocks,
      steps,
    };
  });

type Act =
  | { kind: "tap" }
  | { kind: "choose"; pick: number }
  | { kind: "end" }
  | { kind: "stop" }
  | { kind: "offer" };
const arbActs = fc.array(
  fc.oneof(
    fc.constant<Act>({ kind: "tap" }),
    fc
      .integer({ min: 0, max: 7 })
      .map((pick): Act => ({ kind: "choose", pick })),
    fc.constant<Act>({ kind: "end" }),
    fc.constant<Act>({ kind: "stop" }),
    fc.constant<Act>({ kind: "offer" }),
  ),
  { maxLength: 25 },
);

describe("a story's world (property)", () => {
  it("stands the free world blocks plus every reached story world block, never a card or a stage block, and none leaves", () => {
    fc.assert(
      fc.property(arbStation, arbActs, (station, acts) => {
        /** What the view reported (the app keeps it with the walk). */
        const reached: string[] = [];
        /** The oracle: world blocks of steps the panel showed. */
        const oracle = new Set<string>();
        let choices: { click: () => void }[] = [];
        const dom: SceneViewDom = {
          panel: { hidden: true },
          title: { textContent: "" },
          speaker: { textContent: "", hidden: true },
          text: { textContent: "" },
          status: { textContent: "" },
          image: { src: "", alt: "", hidden: true },
          choices: {
            replaceChildren: (...nodes: (Node | string)[]) => {
              choices = nodes as unknown as { click: () => void }[];
            },
          },
          continueButton: { hidden: false },
          playNext: { hidden: true, textContent: "" },
        };
        const blocks = new Map(station.blocks.map((b) => [b.id, b]));
        const shownByStep = new Set(
          station.steps.flatMap((s) =>
            s.action.kind === "show" ? [s.action.block] : [],
          ),
        );
        const freeWorld = station.blocks
          .filter((b) => WORLD.has(b.view) && !shownByStep.has(b.id))
          .map((b) => b.id);
        const view = createSceneView({
          dom,
          assets,
          // Media never arrive; only which blocks stand is under test.
          loadAsset: () => new Promise<Blob>(() => undefined),
          audio: { play: () => Promise.resolve(), stop: () => undefined },
          stage: {
            showCharacter: () => Promise.resolve(),
            showModel: () => Promise.resolve(),
            clear: () => undefined,
          },
          checkPicture: () => Promise.resolve(null),
          createChoiceButton: (_label, click) => ({ click }) as unknown as Node,
          schedule: () => () => undefined,
          objectUrls: { create: () => "blob:x", revoke: () => undefined },
          onStoryEnd: () => undefined,
          onBlockShown: (stationId, blockId) => {
            expect(stationId).toBe(station.id);
            if (!reached.includes(blockId)) reached.push(blockId);
          },
        });
        const observe = (): void => {
          if (view.playing() !== station.id || dom.panel.hidden) return;
          const block = blocks.get(dom.text.textContent ?? "");
          if (block !== undefined && WORLD.has(block.view))
            oracle.add(block.id);
        };
        view.offer(station);
        observe();
        for (const act of acts) {
          const before = [...reached];
          if (act.kind === "tap") view.continueTapped();
          else if (act.kind === "choose")
            choices[act.pick % Math.max(1, choices.length)]?.click();
          else if (act.kind === "end") view.end(station.id);
          else if (act.kind === "stop") view.stopAll();
          else view.offer(station);
          observe();
          // Exactly the world blocks of steps shown, once each.
          expect(new Set(reached)).toEqual(oracle);
          expect(new Set(reached).size).toBe(reached.length);
          // A reached block never leaves.
          expect(reached.slice(0, before.length)).toEqual(before);
          const present = presentWorldBlocks(station, reached).map((b) => b.id);
          expect(present).toEqual([...freeWorld, ...reached]);
          expect(present.every((id) => WORLD.has(blocks.get(id)!.view))).toBe(
            true,
          );
        }
      }),
      { numRuns: 200 },
    );
  });
});
