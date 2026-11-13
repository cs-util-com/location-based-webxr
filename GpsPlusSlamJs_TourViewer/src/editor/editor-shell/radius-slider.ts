/**
 * A station's radius slider, beside its number in the inspector: a drag
 * shows the radius in the number and on the 3D view's ring (`preview`)
 * and writes nothing; the release writes one edit, one undo step, when
 * the radius moved. The drag rule is the inspector's one for every
 * slider (`range-slider.ts`).
 *
 * The track covers the radii a creator sets by feel; the number takes the
 * rest of what the format allows, and the thumb rests at the nearer end of
 * the track for those, unwritten until it is moved.
 *
 * @see radius-slider.ts.md
 */
import { wireRangeDrag } from "./range-slider.js";

/** The track, in metres. */
export const RADIUS_SLIDER = { min: 5, max: 100, step: 1 } as const;

/** What the slider's `data-act` says: it names it across a draw, so the
 *  focus stays on it (`controlName`); no command answers it. */
const SLIDER_ACT = "radius-slider";

/** The radius's row: the slider, then `numberBox` (the typed number). */
export function radiusRange(
  numberBox: HTMLElement,
  radiusM: number,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "range";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(RADIUS_SLIDER.min);
  slider.max = String(RADIUS_SLIDER.max);
  slider.step = String(RADIUS_SLIDER.step);
  slider.value = String(radiusM);
  slider.dataset["act"] = SLIDER_ACT;
  slider.setAttribute("aria-label", "Radius");
  box.append(slider, numberBox);
  return box;
}

export interface RadiusSlider {
  /** A drag cut off (its selection gone): the view as the tour has it. */
  cancel(): void;
}

/** The slider's events in the dock at `root` answered. */
export function wireRadiusSlider(deps: {
  readonly root: HTMLElement;
  /** The selected station and its radius now; null for anything else. */
  readonly station: () => {
    readonly id: string;
    readonly radiusM: number;
  } | null;
  /** Draw the station's ring at `radiusM`; null: as the tour has it. */
  readonly preview: (stationId: string, radiusM: number | null) => void;
  /** Write the radius: one edit. */
  readonly write: (stationId: string, radiusM: number) => void;
}): RadiusSlider {
  const numberBeside = (slider: HTMLInputElement | null) =>
    slider?.parentElement?.querySelector<HTMLInputElement>(
      "input[data-field]",
    ) ?? null;
  return wireRangeDrag({
    root: deps.root,
    owns: (act) => act === SLIDER_ACT,
    begin: () => {
      const station = deps.station();
      return station === null
        ? null
        : { id: station.id, before: station.radiusM };
    },
    move: (slider, id, radiusM) => {
      const number = numberBeside(slider);
      if (number !== null) number.value = radiusM.toFixed(1);
      deps.preview(id, radiusM);
      return radiusM;
    },
    // The number, the thumb and the ring as the tour has them after the
    // write (a write may have changed nothing).
    end: (_act, slider, id, _before, at) => {
      const number = numberBeside(slider);
      if (number !== null) number.value = number.defaultValue;
      if (at !== null) deps.write(id, at);
      const station = deps.station();
      if (slider !== null && station?.id === id) {
        slider.value = String(station.radiusM);
      }
      deps.preview(id, null);
    },
  });
}
