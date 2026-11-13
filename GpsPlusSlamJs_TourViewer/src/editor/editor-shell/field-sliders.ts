/**
 * A block's number fields as sliders in the inspector (`FieldSpec`
 * `number.slider`): the slider beside the typed number, or one track with
 * two thumbs for a pair (a zone's full volume edge and its reach), and a
 * zone's loudness curve under its volume. A drag shows its value in the
 * number and the curve and writes nothing; its release writes once,
 * through the same typed-field commit the number takes, so the bounds,
 * the comma and the pair's order are checked in one place
 * (`block-fields.ts`) and one drag is one undo step. The drag rule is the
 * inspector's one for every slider (`range-slider.ts`).
 *
 * @see field-sliders.ts.md
 */
import { zoneGain } from "../../kinds/audio/sound-reach.js";
import {
  heldNumber,
  typedNumber,
  type BlockNumberField,
  type LoudnessOf,
} from "../block-fields.js";
import {
  pairValue,
  rangeInput,
  trackValue,
  wireRangeDrag,
  type RangeDrag,
  type SliderTrack,
} from "./range-slider.js";

/** The `data-act` prefix of a field's slider; the field's name follows. */
const ACT = "field-slider:";

const actOf = (field: string): string => `${ACT}${field}`;

/** The value a slider rests at for what the box shows: on the track, or
 *  its start for a blank box. */
function restOf(shown: string, track: SliderTrack): number {
  const n = typedNumber(shown);
  return trackValue(n ?? track.min, track);
}

/** The field's slider row: the slider (a pair: two thumbs on one track),
 *  then `numberBox`. Null for a field without a slider. */
export function fieldRange(
  field: BlockNumberField,
  numberBox: HTMLElement,
): HTMLElement | null {
  const track = field.number.slider;
  if (track === undefined) return null;
  const box = document.createElement("div");
  box.className = "range";
  const high = rangeInput(
    actOf(field.name),
    field.label,
    track,
    restOf(field.value, track),
  );
  const low = field.number.low;
  if (low === undefined) {
    box.append(high, numberBox);
    return box;
  }
  const lowInput = rangeInput(
    actOf(low.name),
    low.label,
    track,
    restOf(low.value, track),
  );
  lowInput.dataset["pair"] = "low";
  high.dataset["pair"] = "high";
  lowInput.dataset["other"] = actOf(field.name);
  high.dataset["other"] = actOf(low.name);
  const pair = document.createElement("div");
  pair.className = "pair";
  pair.append(lowInput, high);
  box.append(pair, numberBox);
  return box;
}

/** How far past the reach the curve runs, as a share of the reach: the
 *  silence beyond it shows. */
const CURVE_PAST = 1.25;

/** The loudness over distance in a `width` by `height` box (y down, full
 *  volume 1 at the top): the corners of `zoneGain` from the centre to a
 *  little past the reach, and the words a screen reader says for it. */
export function loudnessPoints(
  of: LoudnessOf,
  width: number,
  height: number,
): {
  readonly points: readonly (readonly [number, number])[];
  readonly words: string;
} {
  const maxM = Number.isFinite(of.maxM) && of.maxM > 0 ? of.maxM : 1;
  const minM =
    of.minM !== undefined && Number.isFinite(of.minM) && of.minM < maxM
      ? Math.max(0, of.minM)
      : 0;
  const volume = Math.min(
    1,
    Math.max(0, Number.isFinite(of.volume) ? of.volume : 0),
  );
  const zone = { minM, maxM, volume };
  const endM = maxM * CURVE_PAST;
  const points = [0, minM, maxM, endM].map(
    (d) => [(d / endM) * width, height - zoneGain(d, zone) * height] as const,
  );
  const percent = String(Math.round(volume * 100));
  const words =
    minM > 0
      ? `Loudness: ${percent} % within ${String(minM)} m, silent beyond ${String(maxM)} m`
      : `Loudness: ${percent} % at the centre, silent beyond ${String(maxM)} m`;
  return { points, words };
}

const SVG = "http://www.w3.org/2000/svg";
/** The curve's drawing box (viewBox units). */
const CURVE = { width: 200, height: 48 } as const;

/** The loudness over distance, as an SVG under the volume: full within
 *  the edge, falling to silence at the reach. `scale` is the volume box's
 *  (what it shows per unit the file holds), so a drag redraws it from the
 *  boxes (`redrawCurves`). */
export function loudnessCurve(of: LoudnessOf, scale: number): HTMLElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "loudness");
  svg.setAttribute(
    "viewBox",
    `0 0 ${String(CURVE.width)} ${String(CURVE.height)}`,
  );
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.dataset["scale"] = String(scale);
  const area = document.createElementNS(SVG, "path");
  area.setAttribute("class", "area");
  const line = document.createElementNS(SVG, "path");
  line.setAttribute("class", "line");
  svg.append(area, line);
  drawCurve(svg, of);
  const box = document.createElement("div");
  box.className = "curve";
  box.append(svg);
  return box;
}

function drawCurve(svg: SVGSVGElement, of: LoudnessOf): void {
  const { points, words } = loudnessPoints(of, CURVE.width, CURVE.height);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`);
  svg.querySelector(".line")?.setAttribute("d", `M${line.join("L")}`);
  svg
    .querySelector(".area")
    ?.setAttribute(
      "d",
      `M0,${String(CURVE.height)}L${line.join("L")}L${String(CURVE.width)},${String(CURVE.height)}Z`,
    );
  svg.setAttribute("aria-label", words);
}

/** Every loudness curve in `root` drawn again from the boxes beside it,
 *  so a drag or a typed value shows at once. */
function redrawCurves(root: HTMLElement): void {
  const read = (name: string) => {
    const box = root.querySelector<HTMLInputElement>(
      `input[data-field="${name}"]`,
    );
    return box === null ? null : typedNumber(box.value);
  };
  for (const svg of root.querySelectorAll<SVGSVGElement>("svg.loudness")) {
    const maxM = read("maxM");
    const volume = read("volume");
    if (maxM === null || volume === null) continue;
    const minM = read("minM");
    drawCurve(svg, {
      ...(minM === null ? {} : { minM }),
      maxM,
      volume: heldNumber(volume, Number(svg.dataset["scale"] ?? "1")),
    });
  }
}

/** The fields' sliders in the dock at `root` answered. */
export function wireFieldSliders(deps: {
  readonly root: HTMLElement;
  /** What the inspector shows now; null: nothing. */
  readonly selected: () => string | null;
  /** Write `text` as typed into the field's box: one edit. */
  readonly write: (box: HTMLInputElement, text: string) => void;
}): RangeDrag {
  const { root } = deps;
  const boxOf = (act: string) =>
    root.querySelector<HTMLInputElement>(
      `input[data-field="${act.slice(ACT.length)}"]`,
    );
  const sliderOf = (act: string) =>
    root.querySelector<HTMLInputElement>(
      `input[type="range"][data-act="${act}"]`,
    );
  const trackOf = (slider: HTMLInputElement): SliderTrack => ({
    min: Number(slider.min),
    max: Number(slider.max),
    step: Number(slider.step),
  });

  // A typed value redraws the curve too, before it is written.
  root.addEventListener("input", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset["field"]) {
      redrawCurves(root);
    }
  });

  return wireRangeDrag({
    root,
    owns: (act) => act.startsWith(ACT),
    begin: (slider) => {
      const id = deps.selected();
      const act = slider.dataset["act"] ?? "";
      const box = boxOf(act);
      if (id === null || box === null) return null;
      const before =
        typedNumber(box.defaultValue) ?? Number(slider.defaultValue);
      return { id, before };
    },
    move: (slider, _id, value) => {
      const track = trackOf(slider);
      const thumb = slider.dataset["pair"];
      const other = sliderOf(slider.dataset["other"] ?? "");
      const at =
        (thumb === "low" || thumb === "high") && other !== null
          ? pairValue(value, Number(other.value), thumb, track)
          : trackValue(value, track);
      slider.value = String(at);
      const box = boxOf(slider.dataset["act"] ?? "");
      if (box !== null) box.value = String(at);
      redrawCurves(root);
      return at;
    },
    end: (act, slider, id, _before, at) => {
      const box = boxOf(act);
      if (box === null) return;
      if (at !== null && deps.selected() === id) {
        deps.write(box, String(at));
        return;
      }
      box.value = box.defaultValue;
      if (slider !== null) slider.value = slider.defaultValue;
      redrawCurves(root);
    },
  });
}
