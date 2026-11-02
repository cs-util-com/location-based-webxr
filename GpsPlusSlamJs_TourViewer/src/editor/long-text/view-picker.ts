/**
 * The long text's view picker, as data: three segments (Reading sign,
 * Screen only, Captions), which one is pressed, which can be chosen and
 * the one line under them. Only the reading sign is a view the tour
 * format stores for a long text today; the other two are what a visitor
 * chooses for themselves (the view switch), so they are shown, focusable
 * and explained, never written.
 *
 * @see view-picker.ts.md
 */

/** A segment of the picker. */
export type LongTextSegment = "reading" | "silent" | "captions";

/** The segments, in order. */
export const LONG_TEXT_SEGMENTS: readonly LongTextSegment[] = [
  "reading",
  "silent",
  "captions",
];

/** One segment as drawn. */
interface SegmentModel {
  readonly id: LongTextSegment;
  readonly label: string;
  /** Pressed: the block's view is this one. */
  readonly pressed: boolean;
  /** Dimmed: choosing it explains why instead of writing it. */
  readonly dimmed: boolean;
}

/** The picker as drawn. */
export interface ViewPickerModel {
  readonly segments: readonly SegmentModel[];
  /** The line under the segments. */
  readonly description: string;
  /** Whether the line offers "Add a narration". */
  readonly offerNarration: boolean;
}

const LABEL: Readonly<Record<LongTextSegment, string>> = {
  reading: "Reading sign",
  silent: "Screen only",
  captions: "Captions",
};

/** What the views a long text can store are called (the preview's head
 *  names the text's view). */
const VIEW_LABEL: Readonly<Record<string, string>> = {
  reading: LABEL.reading,
  lectern: "Reading stand",
  card: "Station card",
};

/** The name of a long text's stored `view`; "Long text" for one this
 *  editor does not know. */
export function viewLabel(view: string): string {
  return Object.hasOwn(VIEW_LABEL, view)
    ? (VIEW_LABEL[view] ?? "Long text")
    : "Long text";
}

/** Why a dimmed segment cannot be chosen; null where it can. */
export function segmentRefusal(
  id: LongTextSegment,
  hasNarration: boolean,
): string | null {
  if (id === "reading") return null;
  if (id === "silent") {
    return "Screen only is each visitor's own choice for now: a tour cannot set it yet. Visitors pick it from the view menu at the station.";
  }
  return hasNarration
    ? "Captions are each visitor's own choice for now: a tour cannot set them yet. Visitors who listen pick them from the view menu."
    : "Captions show the sentence being spoken in a strip at the bottom, so they need a narration.";
}

/**
 * The picker for a long text whose stored view is `view`, with or
 * without a narration. `asked` is the dimmed segment the creator last
 * chose, whose reason the line then gives.
 */
export function viewPickerModel(input: {
  readonly view: string;
  readonly hasNarration: boolean;
  readonly asked?: LongTextSegment | null;
}): ViewPickerModel {
  const { view, hasNarration } = input;
  const asked = input.asked ?? null;
  const segments = LONG_TEXT_SEGMENTS.map((id) => ({
    id,
    label: LABEL[id],
    pressed: id === view,
    dimmed: segmentRefusal(id, hasNarration) !== null,
  }));
  const refusal = asked === null ? null : segmentRefusal(asked, hasNarration);
  if (refusal !== null) {
    return {
      segments,
      description: refusal,
      offerNarration: asked === "captions" && !hasNarration,
    };
  }
  const description =
    view === "reading"
      ? `A sign stands at the station. Visitors tap it to read the text in a sheet${hasNarration ? " and can listen while the words light up" : ""}.`
      : view === "lectern"
        ? "This text stands on a reading stand. Choose Reading sign to show it as a sign instead."
        : view === "card"
          ? "This text shows in the station's card. Choose Reading sign to show it as a sign instead."
          : "Choose how visitors meet this text.";
  return { segments, description, offerNarration: false };
}

/** The segment `step` places from `from` (arrow keys), wrapping round. */
export function stepSegment(
  from: LongTextSegment,
  step: 1 | -1,
): LongTextSegment {
  const i = LONG_TEXT_SEGMENTS.indexOf(from);
  const n = LONG_TEXT_SEGMENTS.length;
  return LONG_TEXT_SEGMENTS[(i + step + n) % n] ?? "reading";
}
