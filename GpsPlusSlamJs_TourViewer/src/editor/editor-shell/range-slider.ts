/**
 * The inspector's sliders, whatever they set: one drag rule for all of
 * them (a station's radius, a sound's radius, reach and volume). A drag
 * previews and writes nothing; its release writes once, one undo step,
 * when the value moved; a cut-off drag writes nothing. The dock is drawn
 * again from the store, so what a drag keeps lives here, not in the
 * elements, and each slider is looked up by its `data-act` at each step.
 * A drag ends at `change` or at its pointer's release, whichever comes
 * first: a browser fires no `change` for a drag back to where it began.
 *
 * Beside it, the pure rules a track keeps: a value on the track
 * (`trackValue`) and two thumbs that never cross (`pairValue`).
 *
 * @see range-slider.ts.md
 */

/** A slider's track: its ends and its step, in the units it shows. */
export interface SliderTrack {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** The decimals a step needs ("0.5" one, "1" none). */
function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** `value` on `track`: clamped to its ends and rounded to its step,
 *  counted from its start. Not a finite number: the start. */
export function trackValue(value: number, track: SliderTrack): number {
  if (!Number.isFinite(value)) return track.min;
  const clamped = Math.min(track.max, Math.max(track.min, value));
  const steps = Math.round((clamped - track.min) / track.step);
  const snapped = Math.min(track.max, track.min + steps * track.step);
  return Number(snapped.toFixed(decimalsOf(track.step)));
}

/** A thumb of a pair moved to `value` on `track`: kept at least one step
 *  short of the other thumb (`other`), so the low one stays below. */
export function pairValue(
  value: number,
  other: number,
  thumb: "low" | "high",
  track: SliderTrack,
): number {
  const v = trackValue(value, track);
  if (thumb === "low") {
    return v <= other - track.step ? v : trackValue(other - track.step, track);
  }
  return v >= other + track.step ? v : trackValue(other + track.step, track);
}

/** A slider on `track` at `value`, named by `act` (its `data-act`: it
 *  names it across a draw, so the focus stays on it; no command answers
 *  it). Its default value is the one it was drawn at, so a drag that
 *  writes nothing puts its thumb back there. */
export function rangeInput(
  act: string,
  label: string,
  track: SliderTrack,
  value: number,
): HTMLInputElement {
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(track.min);
  slider.max = String(track.max);
  slider.step = String(track.step);
  slider.defaultValue = String(trackValue(value, track));
  slider.value = slider.defaultValue;
  slider.dataset["act"] = act;
  slider.setAttribute("aria-label", label);
  return slider;
}

/** What a drag answers to; `act` is the slider's `data-act`. */
export interface RangeDragDeps {
  readonly root: HTMLElement;
  /** Whether a slider's `data-act` is one of these. */
  readonly owns: (act: string) => boolean;
  /** The drag's subject and its value before, or null: no drag. */
  readonly begin: (
    slider: HTMLInputElement,
  ) => { readonly id: string; readonly before: number } | null;
  /** One step of the drag: show it; returns the value it takes (a pair's
   *  thumb may stop short of where it was put). */
  readonly move: (
    slider: HTMLInputElement,
    id: string,
    value: number,
  ) => number;
  /** The drag over: `at` to write (only when it moved), or null for a
   *  cut-off drag; then everything shown as the tour has it. `slider` is
   *  the one drawn now, null when a draw took it. */
  readonly end: (
    act: string,
    slider: HTMLInputElement | null,
    id: string,
    before: number,
    at: number | null,
  ) => void;
}

export interface RangeDrag {
  /** A drag cut off (its selection gone): nothing written. */
  cancel(): void;
}

/** The drag rule answered for every slider `owns` names in `root`. */
export function wireRangeDrag(deps: RangeDragDeps): RangeDrag {
  let drag: {
    readonly act: string;
    readonly id: string;
    readonly before: number;
    at: number;
  } | null = null;
  /** The finger on the slider: another's release is not the drag's end. */
  let pointer: number | null = null;

  const doc = deps.root.ownerDocument;
  const sliderNow = (act: string) =>
    deps.root.querySelector<HTMLInputElement>(
      `input[type="range"][data-act="${act}"]`,
    );
  const isDragging = (event: PointerEvent) =>
    pointer === null || event.pointerId === pointer;
  const released = (event: PointerEvent) => {
    if (isDragging(event)) finish(true);
  };
  const cancelled = (event: PointerEvent) => {
    if (isDragging(event)) finish(false);
  };

  function finish(write: boolean): void {
    if (drag === null) return;
    const { act, id, before, at } = drag;
    drag = null;
    pointer = null;
    doc.removeEventListener("pointerup", released, true);
    doc.removeEventListener("pointercancel", cancelled, true);
    deps.end(
      act,
      sliderNow(act),
      id,
      before,
      write && at !== before ? at : null,
    );
  }

  const sliderOf = (target: EventTarget | null): HTMLInputElement | null => {
    if (!(target instanceof HTMLInputElement) || target.type !== "range") {
      return null;
    }
    const act = target.dataset["act"];
    return act !== undefined && deps.owns(act) ? target : null;
  };

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
    const act = slider.dataset["act"] ?? "";
    if (drag !== null && drag.act !== act) finish(true);
    if (drag === null) {
      const subject = deps.begin(slider);
      if (subject === null) return;
      drag = {
        act,
        id: subject.id,
        before: subject.before,
        at: subject.before,
      };
      doc.addEventListener("pointerup", released, true);
      doc.addEventListener("pointercancel", cancelled, true);
    }
    drag.at = deps.move(slider, drag.id, Number(slider.value));
  });

  deps.root.addEventListener("change", (event) => {
    const slider = sliderOf(event.target);
    if (slider === null || drag === null) return;
    if (slider.dataset["act"] !== drag.act) return;
    const value = Number(slider.value);
    if (value !== drag.at) drag.at = deps.move(slider, drag.id, value);
    finish(true);
  });

  return {
    cancel: () => {
      finish(false);
    },
  };
}
