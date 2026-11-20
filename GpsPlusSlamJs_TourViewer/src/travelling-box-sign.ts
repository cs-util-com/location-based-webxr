/**
 * The reading sign's words as a travelling surface (`travel-surface.ts`):
 * the narration box in travel mode is the ghost and the painter's model,
 * the words plate under the sign is the plate. The first surface the
 * travelling box's controller (`travelling-box.ts`) moves.
 *
 * @see travelling-box-sign.ts.md
 */
import { Mesh, type Object3D, type Texture } from "three";

import type { NarrationBox } from "./narration-box.js";
import {
  paintNarrationWords,
  wordsCanvasSize,
  wordsPaintKey,
  type WordsPaintLayout,
  type WordsPaintModel,
} from "./narration-words-paint.js";
import type { ReadingSignHandle } from "./reading-sign.js";
import type { TravelLayout, TravelSurface } from "./travel-surface.js";
import {
  letterGate,
  plateSizeM,
  type TravelHideWhy,
} from "./travelling-box-rules.js";

/** Why the sign's words hide, in this order: no voice to follow, the
 *  visitor outside the station, the reading sheet open; else null. */
export function signHideWhy(input: {
  readonly voice: boolean;
  readonly inStation: boolean;
  readonly sheetOpen: boolean;
}): TravelHideWhy | null {
  if (!input.voice) return "no voice";
  if (!input.inStation) return "outside the station";
  if (input.sheetOpen) return "sheet open";
  return null;
}

/** The growth the sign is given for the `grow` knob: its own (undefined:
 *  `signGrowth` of the distance), or none (1) with the knob off. */
export function signWordsGrowth(grow: boolean): number | undefined {
  return grow ? undefined : 1;
}

export interface SignWordsDeps {
  /** The text's block id: the surface's id and the voice it answers to. */
  readonly id: string;
  readonly sign: Pick<
    ReadingSignHandle,
    "wordsPlate" | "attachWords" | "detachWords"
  >;
  readonly box: Pick<
    NarrationBox,
    | "paintModel"
    | "restingRect"
    | "setGhost"
    | "setPointer"
    | "beginPress"
    | "movePress"
    | "endPress"
    | "pressing"
  >;
  /** The paint scale (`wordsPaintScale` of the device pixel ratio). */
  readonly scale: number;
  /** The text is shown in travel mode. */
  readonly travelling: () => boolean;
  readonly voice: () => boolean;
  readonly inStation: () => boolean;
  readonly sheetOpen: () => boolean;
}

/** Narrows without the `any` generics `instanceof Mesh` gives. */
function isMesh(o: Object3D): o is Mesh {
  return o instanceof Mesh;
}

export function signWordsSurface(deps: SignWordsDeps): TravelSurface {
  const { box, sign, scale } = deps;
  const plate = sign.wordsPlate;
  if (!isMesh(plate)) {
    throw new TypeError("the sign's words plate must be a mesh");
  }
  let model: WordsPaintModel | null = null;
  let measured: WordsPaintLayout | null = null;
  let layout: TravelLayout | null = null;

  return {
    id: `words:${deps.id}`,
    kind: "words",
    slot: "bottom",
    voiced: true,
    answersTo: () => deps.id,
    plate,
    travelling: deps.travelling,
    hideWhy: () =>
      signHideWhy({
        voice: deps.voice(),
        inStation: deps.inStation(),
        sheetOpen: deps.sheetOpen(),
      }),
    canFold: () => false,
    gates: (metrics, knobs) => [letterGate(metrics, knobs)],
    layout() {
      model = box.paintModel();
      if (model === null) return null;
      if (model.layout !== measured) {
        measured = model.layout;
        const size = wordsCanvasSize(measured, scale);
        layout = {
          cssW: measured.width,
          cssH: measured.height,
          fontPx: measured.fontPx,
          lineHeightPx: measured.lineHeight,
          canvasW: size.width,
          canvasH: size.height,
        };
      }
      return layout;
    },
    paintKey: () =>
      model === null ? "" : wordsPaintKey(model.layout, model.frame),
    paint(g) {
      if (model !== null) paintNarrationWords(g, model, scale);
    },
    hang(texture: Texture, l) {
      sign.attachWords(texture, plateSizeM(l.cssW, l.cssH, l.fontPx));
    },
    unhang: () => {
      sign.detachWords();
    },
    restingRect: () => box.restingRect(),
    setGhost: (on) => {
      box.setGhost(on);
    },
    setPointer: (on) => {
      box.setPointer(on);
    },
    beginPress: (press) => box.beginPress(press),
    movePress: (x, y) => {
      box.movePress(x, y);
    },
    endPress: (kind, x, y) => {
      box.endPress(kind, x, y);
    },
    pressing: () => box.pressing(),
  };
}
