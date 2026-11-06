/**
 * A station's radius slider, beside its number in the inspector: a drag
 * shows the radius in the number and on the 3D view's ring (`preview`)
 * and writes nothing; the release writes one edit, one undo step, when
 * the radius moved. The dock is drawn again from the store, so what the
 * slider keeps during a drag lives here, not in the elements.
 *
 * The track covers the radii a creator sets by feel; the number takes the
 * rest of what the format allows, and the thumb rests at the track's end
 * for those, unwritten until it is moved.
 *
 * @see radius-slider.ts.md
 */

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
  /** The station a drag is showing, and the number it writes into. */
  let drag: {
    readonly id: string;
    readonly radiusM: number;
    readonly number: HTMLInputElement | null;
  } | null = null;

  const sliderOf = (target: EventTarget | null): HTMLInputElement | null =>
    target instanceof HTMLInputElement && target.dataset["act"] === SLIDER_ACT
      ? target
      : null;

  deps.root.addEventListener("input", (event) => {
    const slider = sliderOf(event.target);
    if (slider === null) return;
    const station = deps.station();
    if (station === null) return;
    drag ??= {
      id: station.id,
      radiusM: station.radiusM,
      number:
        slider.parentElement?.querySelector<HTMLInputElement>(
          "input[data-field]",
        ) ?? null,
    };
    const radiusM = Number(slider.value);
    if (drag.number !== null) drag.number.value = radiusM.toFixed(1);
    deps.preview(drag.id, radiusM);
  });

  deps.root.addEventListener("change", (event) => {
    const slider = sliderOf(event.target);
    if (slider === null || drag === null) return;
    const { id, radiusM, number } = drag;
    drag = null;
    if (number !== null) number.value = number.defaultValue;
    const now = Number(slider.value);
    if (now !== radiusM) deps.write(id, now);
    deps.preview(id, null);
  });

  return {
    cancel() {
      if (drag === null) return;
      const { id, number } = drag;
      drag = null;
      if (number !== null) number.value = number.defaultValue;
      deps.preview(id, null);
    },
  };
}
