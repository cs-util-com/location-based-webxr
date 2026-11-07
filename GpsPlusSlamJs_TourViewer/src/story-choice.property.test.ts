/**
 * Why these properties matter: the picker adds ways through a station that
 * no fixed list of examples covers - stories in any order, played again,
 * ended early, stopped by another station's "Play", everything stopped. They
 * drive the real story panel (`createSceneView`), because the rule that can
 * break is the one between the model and the panel: a station that reports
 * done twice would advance the walk twice, one that never reports would
 * block a fixed-order tour for good. The oracle counts playable stories from
 * the generated data, not through `story-choice.ts`.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { createSceneView, type SceneViewDom } from "./scene-view.js";
import { createStoryChoices, playableStories } from "./story-choice.js";
import { stationContent, storyOf } from "./test-support/station-content.js";

const POSE = {
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
};

/** A story of `blocks` cards (0: empty, so not playable). */
const storyWith = (id: string, blocks: number) =>
  storyOf(
    id,
    Array.from({ length: blocks }, (_, i) => ({
      id: `${id}-${String(i)}`,
      kind: "shortText" as const,
      view: "card" as const,
      caption: `${id} ${String(i)}`,
      pose: POSE,
    })),
    `Title ${id}`,
  );

function stationOf(id: string, lengths: readonly number[]): TourStation {
  return {
    id,
    geo: { lat: 0, lng: 0, alt: 0, heading: 0 },
    ...stationContent(
      lengths.map((n, i) => storyWith(`${id}-${String(i)}`, n)),
    ),
  } as unknown as TourStation;
}

const stories = fc.array(fc.nat({ max: 3 }), { minLength: 0, maxLength: 4 });

type Act =
  | { kind: "pick"; at: number }
  | { kind: "continue" | "end" | "requeue" | "stop" | "offer" };

const acts = fc.array(
  fc.oneof<[fc.Arbitrary<Act>, ...fc.Arbitrary<Act>[]]>(
    fc.nat({ max: 5 }).map((at) => ({ kind: "pick" as const, at })),
    fc.constantFrom<Act>(
      { kind: "continue" },
      { kind: "continue" },
      { kind: "end" },
      { kind: "requeue" },
      { kind: "stop" },
      { kind: "offer" },
    ),
  ),
  { maxLength: 40 },
);

/** The real panel over a fake page, keeping what these properties read. */
function panel() {
  let buttons: { label: string; click: () => void }[] = [];
  const ended: string[] = [];
  const dom: SceneViewDom = {
    panel: { hidden: true },
    title: { textContent: "" },
    description: { textContent: "", hidden: true },
    speaker: { textContent: "", hidden: true },
    text: { textContent: "" },
    status: { textContent: "" },
    image: { src: "", alt: "", hidden: true },
    stationImage: { src: "", alt: "", hidden: true },
    video: {
      src: "",
      poster: "",
      hidden: true,
      pause: () => undefined,
      removeAttribute: () => undefined,
      load: () => undefined,
      onended: null,
      onplay: null,
      onerror: null,
    },
    choices: {
      replaceChildren: (...nodes: (Node | string)[]) => {
        buttons = nodes as unknown as typeof buttons;
      },
    },
    continueButton: { hidden: false },
    playNext: { hidden: true, textContent: "" },
  };
  const view = createSceneView({
    dom,
    assets: new Map(),
    loadAsset: () => new Promise<Blob>(() => undefined),
    audio: { play: () => Promise.resolve(), stop: () => undefined },
    stage: {
      showCharacter: () => Promise.resolve(),
      showModel: () => Promise.resolve(),
      clear: () => undefined,
    },
    checkPicture: () => Promise.resolve(null),
    createChoiceButton: (label, click) => ({ label, click }) as unknown as Node,
    schedule: () => () => undefined,
    objectUrls: { create: () => "blob:x", revoke: () => undefined },
    onStoryEnd: (id) => {
      ended.push(id);
    },
  });
  return { view, dom, ended, buttons: () => buttons };
}

describe("the story picker, through the real panel", () => {
  it("shows iff two or more stories are playable, and a station ends exactly once per visit", () => {
    fc.assert(
      fc.property(stories, stories, acts, (lengths, otherLengths, script) => {
        const here = stationOf("here", lengths);
        const other = stationOf("other", otherLengths.concat(1));
        const stations = new Map([
          [here.id, here],
          [other.id, other],
        ]);
        const p = panel();
        /** A station's visit runs from its offer to its one reported end. */
        const open = new Set<string>();
        const offer = (s: TourStation): void => {
          open.add(s.id);
          p.view.offer(s);
          drain();
        };
        let seen = 0;
        const drain = (): void => {
          for (const id of p.ended.slice(seen)) {
            expect(open.has(id), `${id} ended outside a visit`).toBe(true);
            open.delete(id);
          }
          seen = p.ended.length;
        };
        const pickerFault = (
          showing: boolean,
          turn: TourStation | undefined,
        ): string | null => {
          if (turn === undefined) {
            return p.dom.panel.hidden ? null : "a panel with no station";
          }
          if (!showing) {
            return p.dom.text.textContent === "Choose a story"
              ? "the line without its buttons"
              : null;
          }
          const playable = lengths
            .concat(turn === other ? otherLengths.concat(1) : [])
            .filter((n) => n > 0);
          if (playable.length < 2) return "a picker of one story";
          if (p.view.progress() !== null) return "a picker with a step count";
          return p.dom.continueButton.hidden ? "a picker with no way on" : null;
        };
        const pickerRule = (): void => {
          const showing = p.buttons().length > 0;
          const turn = stations.get(p.view.playing() ?? "");
          expect(pickerFault(showing, turn)).toBeNull();
        };

        offer(here);
        expect(p.buttons().length > 0).toBe(
          lengths.filter((n) => n > 0).length >= 2,
        );
        pickerRule();
        for (const act of script) {
          if (act.kind === "pick") {
            const row = p.buttons();
            row[act.at % Math.max(1, row.length)]?.click();
          } else if (act.kind === "continue") p.view.continueTapped();
          else if (act.kind === "requeue") {
            offer(other);
            p.view.playNextNow();
          } else if (act.kind === "stop") {
            p.view.stopAll();
            open.clear();
          } else if (act.kind === "offer") offer(here);
          else {
            const id = p.view.playing();
            if (id !== null) p.view.end(id);
          }
          drain();
          pickerRule();
        }
        // Whatever is left: Continue, the picker's or a story's, always
        // reaches an end, so no visit can stay open for good.
        for (let i = 0; i < 200 && p.view.playing() !== null; i += 1) {
          p.view.continueTapped();
        }
        drain();
        expect(p.view.playing()).toBeNull();
        expect(open.size).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  it("keeps a story's mark over a re-queue, and has none after the station is done", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 4 }), (count) => {
        const here = stationOf(
          "here",
          Array.from({ length: count }, () => 1),
        );
        const p = panel();
        p.view.offer(here);
        p.buttons()[0]!.click();
        p.view.continueTapped();
        expect(p.buttons()[0]!.label).toBe(`✓ Title here-0`);
        p.buttons()[1]!.click();
        p.view.offer(stationOf("other", [1]));
        p.view.playNextNow();
        p.view.continueTapped();
        expect(p.buttons()[0]!.label).toBe(`✓ Title here-0`);
        expect(p.buttons()[1]!.label).toBe(`Title here-1`);
        p.view.continueTapped();
        expect(p.ended).toEqual(["other", "here"]);
        p.view.offer(here);
        expect(p.buttons().every((b) => !b.label.startsWith("✓"))).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});

describe("createStoryChoices", () => {
  it("ends a station after every playable story, in any order, and never before", () => {
    fc.assert(
      fc.property(
        stories,
        fc.array(fc.nat({ max: 5 }), { maxLength: 30 }),
        (lengths, order) => {
          const station = stationOf("s", lengths);
          const playable = playableStories(station);
          expect(playable.length).toBe(lengths.filter((n) => n > 0).length);
          fc.pre(playable.length > 0);
          const choices = createStoryChoices();
          const played = new Set<string>();
          const marks: (number | undefined)[] = [];
          const counts: number[] = [];
          for (const at of [...order, ...playable.keys()]) {
            const story = playable[at % playable.length]!;
            played.add(story.id);
            const back = choices.storyEnded(station, story.id);
            marks.push(back?.picks.filter((p) => p.played).length);
            counts.push(played.size);
            if (back === null) break;
          }
          // Each end but the last marks every story played so far; the last
          // ends the station, and only with every story played.
          expect(played.size).toBe(playable.length);
          expect(marks.at(-1)).toBeUndefined();
          expect(marks.slice(0, -1)).toEqual(counts.slice(0, -1));
        },
      ),
    );
  });
});
