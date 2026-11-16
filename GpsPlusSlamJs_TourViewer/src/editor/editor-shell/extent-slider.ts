/**
 * An item's extent slider (a video's width), beside its typed number in
 * the inspector, on the track its placement row names (`ExtentSpec`
 * `slider`). A drag shows the value in the number and writes nothing; its
 * release writes once, one undo step, when the value moved. The track
 * covers what a creator sets by feel; the number takes the rest of what
 * the format allows, and the thumb rests at the nearer end for those. The
 * drag rule is the inspector's one for every slider (`range-slider.ts`).
 *
 * @see extent-slider.ts.md
 */
import {
  rangeInput,
  wireRangeDrag,
  type RangeDrag,
  type SliderTrack,
} from "./range-slider.js";

/** The slider's `data-act`: it names it across a draw; no command answers
 *  it. */
const ACT = "extent-slider";

/** The extent's row: the slider on `track` at `value`, then `numberBox`
 *  (the typed number). */
export function extentRange(
  numberBox: HTMLElement,
  label: string,
  track: SliderTrack,
  value: number,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "range";
  box.append(rangeInput(ACT, label, track, value), numberBox);
  return box;
}

/** The slider's drags in the dock at `root` answered: `item` is the
 *  selected item with an extent and its value now (null: none), `write`
 *  the one edit of a release that moved it. */
export function wireExtentSlider(deps: {
  readonly root: HTMLElement;
  readonly item: () => { readonly id: string; readonly value: number } | null;
  readonly write: (id: string, value: number) => void;
}): RangeDrag {
  /** The typed number beside a slider (in the same row). */
  const numberOf = (slider: HTMLInputElement | null) =>
    slider?.parentElement?.querySelector<HTMLInputElement>(
      "input[data-field]",
    ) ?? null;
  return wireRangeDrag({
    root: deps.root,
    owns: (act) => act === ACT,
    begin: () => {
      const item = deps.item();
      return item === null ? null : { id: item.id, before: item.value };
    },
    move: (slider, _id, value) => {
      const number = numberOf(slider);
      if (number !== null) number.value = value.toFixed(2);
      return value;
    },
    end: (_act, slider, id, _before, at) => {
      // The number and the thumb as the tour has them; the draw a write
      // causes brings the new value.
      const number = numberOf(slider);
      if (number !== null) number.value = number.defaultValue;
      if (slider !== null) slider.value = slider.defaultValue;
      if (at !== null) deps.write(id, at);
    },
  });
}
