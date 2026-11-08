/**
 * A station's radius slider, beside its number in the inspector: a drag
 * shows the radius in the number and on the 3D view's ring (`preview`)
 * and writes nothing; the release writes one edit, one undo step, when
 * the radius moved. The dock is drawn again from the store, so what the
 * slider keeps during a drag lives here, not in the elements, and a drag
 * ends at the pointer's release too: a browser fires no `change` for a
 * drag back to where it began.
 *
 * The track covers the radii a creator sets by feel; the number takes the
 * rest of what the format allows, and the thumb rests at the nearer end of
 * the track for those, unwritten until it is moved.
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
  /** The station a drag is showing, its radius before, and where it is. */
  let drag: {
    readonly id: string;
    readonly radiusM: number;
    atM: number;
  } | null = null;
  /** The finger on the slider: another's release is not the drag's end. */
  let pointer: number | null = null;

  const doc = deps.root.ownerDocument;
  const sliderNow = () =>
    deps.root.querySelector<HTMLInputElement>(`[data-act="${SLIDER_ACT}"]`);
  const numberNow = () =>
    sliderNow()?.parentElement?.querySelector<HTMLInputElement>(
      "input[data-field]",
    ) ?? null;
  const isDragging = (event: PointerEvent) =>
    pointer === null || event.pointerId === pointer;
  const released = (event: PointerEvent) => {
    if (isDragging(event)) finish(true);
  };
  const cancelled = (event: PointerEvent) => {
    if (isDragging(event)) finish(false);
  };

  /** The drag over: written or not, then the number, the thumb and the
   *  ring as the tour has them (a write may have changed nothing). */
  function finish(write: boolean): void {
    if (drag === null) return;
    const { id, radiusM, atM } = drag;
    drag = null;
    pointer = null;
    doc.removeEventListener("pointerup", released, true);
    doc.removeEventListener("pointercancel", cancelled, true);
    const number = numberNow();
    if (number !== null) number.value = number.defaultValue;
    if (write && atM !== radiusM) deps.write(id, atM);
    const station = deps.station();
    const slider = sliderNow();
    if (slider !== null && station?.id === id) {
      slider.value = String(station.radiusM);
    }
    deps.preview(id, null);
  }

  const sliderOf = (target: EventTarget | null): HTMLInputElement | null =>
    target instanceof HTMLInputElement && target.dataset["act"] === SLIDER_ACT
      ? target
      : null;

  /** A press that moved nothing started no drag, so `finish` never
   *  forgets its finger: its own release does. */
  const pressOver = (event: PointerEvent) => {
    if (pointer !== null && event.pointerId !== pointer) return;
    doc.removeEventListener("pointerup", pressOver, true);
    doc.removeEventListener("pointercancel", pressOver, true);
    if (drag === null) pointer = null;
  };

  deps.root.addEventListener("pointerdown", (event) => {
    if (drag === null && sliderOf(event.target) !== null) {
      pointer = event.pointerId;
      doc.addEventListener("pointerup", pressOver, true);
      doc.addEventListener("pointercancel", pressOver, true);
    }
  });

  deps.root.addEventListener("input", (event) => {
    const slider = sliderOf(event.target);
    if (slider === null) return;
    const station = deps.station();
    if (station === null) return;
    const radiusM = Number(slider.value);
    if (drag === null) {
      drag = { id: station.id, radiusM: station.radiusM, atM: radiusM };
      doc.addEventListener("pointerup", released, true);
      doc.addEventListener("pointercancel", cancelled, true);
    }
    drag.atM = radiusM;
    const number = numberNow();
    if (number !== null) number.value = radiusM.toFixed(1);
    deps.preview(drag.id, radiusM);
  });

  deps.root.addEventListener("change", (event) => {
    const slider = sliderOf(event.target);
    if (slider === null || drag === null) return;
    drag.atM = Number(slider.value);
    finish(true);
  });

  return {
    cancel: () => {
      finish(false);
    },
  };
}
