/**
 * A long text's pictures under a decode budget: each waits in its holder
 * (`long-text-render.ts`) as its alt text, is measured from its file's
 * header once it comes within a screen of the view, and is shown while it
 * stays near and the pictures shown together stay within
 * {@link LONG_TEXT_DECODE_BUDGET_PX}. One scrolled two screens away is let
 * go - its object URL given back, its alt text shown again - so a long
 * text with many large pictures never holds more decoded pixels than a
 * phone can afford.
 *
 * @see long-text-pictures.ts.md
 */

import type { PictureFit } from "./image-cap.js";
import { altBoxText, type LongTextPictureSlot } from "./long-text-render.js";

/**
 * The pixels the sheet's pictures may hold decoded at once.
 *
 * WHAT IT RESTS ON: a decoded picture costs 4 bytes a pixel, so 24 MP is
 * about 96 MB - two 12 MP phone photos side by side, which is what a
 * screen and its neighbour can show. Phones that run WebXR keep a few
 * hundred MB for a tab, and the AR session's own buffers share it.
 *
 * WHAT WOULD REVERSE IT: the decode sweep (16, 24, 48 MP) showing a phone
 * reloading the page at 24 (lower it), or none at 48 with pictures visibly
 * blank while scrolling (raise it).
 */
export const LONG_TEXT_DECODE_BUDGET_PX = 24_000_000;

/** A picture is measured, and may be shown, within this many screens. */
const ADMIT_SCREENS = 1;
/** A shown picture is let go at this many screens: the band between the
 *  two keeps one at the edge from being decoded and dropped in turn. */
const RELEASE_SCREENS = 2;

/** A box's or the view's vertical extent, in one coordinate frame. */
export interface VerticalSpan {
  readonly top: number;
  readonly bottom: number;
}

/** How far `box` lies outside `view`, in view heights: 0 where they
 *  overlap; Infinity for a view with no height. */
export function screensAway(box: VerticalSpan, view: VerticalSpan): number {
  const height = view.bottom - view.top;
  if (!(height > 0)) return Infinity;
  if (box.bottom < view.top) return (view.top - box.bottom) / height;
  if (box.top > view.bottom) return (box.top - view.bottom) / height;
  return 0;
}

/** One picture as the planner sees it. */
export interface PicturePlanEntry {
  /** Its pixel count, or null while it is not measured. */
  readonly pixels: number | null;
  readonly screensAway: number;
  /** It is shown now. */
  readonly shown: boolean;
}

export interface PicturePlan {
  /** The indices shown after this plan (kept and newly admitted). */
  readonly show: ReadonlySet<number>;
  /** The indices shown now that are to be let go. */
  readonly release: ReadonlySet<number>;
}

/**
 * Which pictures to show: those shown that are still within
 * {@link RELEASE_SCREENS} stay; then those measured within
 * {@link ADMIT_SCREENS} are admitted, nearest first, while the total fits
 * `budget`. Pure.
 */
export function planPictures(
  entries: readonly PicturePlanEntry[],
  budget: number,
): PicturePlan {
  const show = new Set<number>();
  const release = new Set<number>();
  let used = 0;
  entries.forEach((e, i) => {
    if (!e.shown) return;
    if (e.screensAway < RELEASE_SCREENS) {
      show.add(i);
      used += e.pixels ?? 0;
    } else {
      release.add(i);
    }
  });
  const candidates = entries
    .map((e, i) => ({ e, i }))
    .filter(
      ({ e }) =>
        !e.shown && e.pixels !== null && e.screensAway <= ADMIT_SCREENS,
    )
    .sort((a, b) => a.e.screensAway - b.e.screensAway);
  for (const { e, i } of candidates) {
    const pixels = e.pixels ?? 0;
    if (used + pixels > budget) continue;
    show.add(i);
    used += pixels;
  }
  return { show, release };
}

export interface LongTextPicturesDeps {
  readonly pictures: readonly LongTextPictureSlot[];
  readonly document: Document;
  /** The picture's file from the open tour (an `asset:` id). */
  load(asset: string): Promise<Blob>;
  /** Its size from its header, against the cap (`image-cap.ts`). */
  fit(blob: Blob): Promise<PictureFit>;
  /** How far the holder lies from the view, in screens (`screensAway`). */
  screensAway(holder: HTMLElement): number;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  /** Defaults to {@link LONG_TEXT_DECODE_BUDGET_PX}. */
  readonly budget?: number;
}

export interface LongTextPictures {
  /** The view moved or the sheet opened: measure, show and let go. */
  update(): void;
  /** The sheet closed: every URL is given back; later loads do nothing. */
  dispose(): void;
}

type PictureState =
  | { readonly kind: "unknown" }
  | { readonly kind: "measuring" }
  | { readonly kind: "measured"; readonly pixels: number; blob: Blob | null }
  | { readonly kind: "failed" }
  | { readonly kind: "fetching"; readonly pixels: number }
  | { readonly kind: "shown"; readonly pixels: number; readonly url: string };

/** The controller over a rendered body's picture holders. */
export function createLongTextPictures(
  deps: LongTextPicturesDeps,
): LongTextPictures {
  const budget = deps.budget ?? LONG_TEXT_DECODE_BUDGET_PX;
  const states: PictureState[] = deps.pictures.map(() => ({ kind: "unknown" }));
  let disposed = false;

  function showAlt(i: number, suffix: string): void {
    const slot = deps.pictures[i];
    if (slot === undefined) return;
    const box = deps.document.createElement("span");
    box.textContent =
      suffix === ""
        ? altBoxText(slot.alt)
        : `${altBoxText(slot.alt)} ${suffix}`;
    slot.holder.replaceChildren(box);
  }

  function showPicture(i: number, url: string): void {
    const slot = deps.pictures[i];
    if (slot === undefined) return;
    const img = deps.document.createElement("img");
    img.setAttribute("src", url);
    img.setAttribute("alt", slot.alt);
    slot.holder.replaceChildren(img);
  }

  function fail(i: number, tooLarge: boolean): void {
    states[i] = { kind: "failed" };
    showAlt(
      i,
      tooLarge ? "(too large to show here)" : "(cannot be shown here)",
    );
  }

  function measure(i: number, asset: string): void {
    states[i] = { kind: "measuring" };
    void deps
      .load(asset)
      .then(async (blob) => ({ blob, fit: await deps.fit(blob) }))
      .then(
        ({ blob, fit }) => {
          if (disposed) return;
          if (!fit.ok) {
            fail(i, fit.tooLarge);
            return;
          }
          states[i] = { kind: "measured", pixels: fit.pixels, blob };
          update();
        },
        () => {
          if (!disposed) fail(i, false);
        },
      );
  }

  function admit(i: number, pixels: number, blob: Blob | null): void {
    const slot = deps.pictures[i];
    if (slot === undefined) return;
    if (blob !== null) {
      const url = deps.createUrl(blob);
      states[i] = { kind: "shown", pixels, url };
      showPicture(i, url);
      return;
    }
    states[i] = { kind: "fetching", pixels };
    void deps.load(slot.asset).then(
      (again) => {
        if (disposed || states[i]?.kind !== "fetching") return;
        admit(i, pixels, again);
      },
      () => {
        if (!disposed) fail(i, false);
      },
    );
  }

  function update(): void {
    if (disposed) return;
    const away = deps.pictures.map((slot) => deps.screensAway(slot.holder));
    states.forEach((state, i) => {
      const slot = deps.pictures[i];
      if (state.kind === "unknown" && slot !== undefined) {
        if ((away[i] ?? Infinity) <= ADMIT_SCREENS) measure(i, slot.asset);
      }
    });
    const plan = planPictures(
      states.map((state, i) => ({
        pixels:
          state.kind === "measured" ||
          state.kind === "fetching" ||
          state.kind === "shown"
            ? state.pixels
            : null,
        screensAway: away[i] ?? Infinity,
        // A picture being fetched holds its place in the budget.
        shown: state.kind === "shown" || state.kind === "fetching",
      })),
      budget,
    );
    states.forEach((state, i) => {
      if (plan.release.has(i)) {
        if (state.kind === "shown") deps.revokeUrl(state.url);
        if (state.kind === "shown" || state.kind === "fetching") {
          states[i] = { kind: "measured", pixels: state.pixels, blob: null };
          showAlt(i, "");
        }
        return;
      }
      if (state.kind === "measured") {
        if (plan.show.has(i)) admit(i, state.pixels, state.blob);
        else state.blob = null; // not kept while it waits for room
      }
    });
  }

  return {
    update,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      states.forEach((state, i) => {
        if (state.kind === "shown") deps.revokeUrl(state.url);
        states[i] = { kind: "unknown" };
      });
    },
  };
}
