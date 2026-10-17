/**
 * The poster text printed with the codes (polish round D-P7, r820 feedback
 * R8): a title, an explanation and a call to action, filled in with the
 * owner's wording, editable in step 3 and remembered per tour link. The
 * PDF writer lays them out (`qr-print-pdf.ts`'s `poster` option).
 *
 * @see poster-text.ts.md
 */

/** The second line on a poster (the S1 design's wording, r820 feedback). */
export const DEFAULT_EXPLANATION = "AR tour starts here";

/** The line under the code. It names the phone a tour needs (D8 of tour
 *  editor plan 2026-10-17-1816: Android-only, said plainly on the poster
 *  too); it was "Scan with your phone camera". */
export const DEFAULT_CALL_TO_ACTION = "Scan with an Android phone";

export interface PosterFields {
  title: string;
  explanation: string;
  callToAction: string;
}

/** The store slice the fields live in (`localStorage`). */
export interface PosterTextStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY_PREFIX = "tour-viewer.poster.";

/** The fields a tour starts with: its name (from its `manifest.json`, when
 *  it has one) as the title, and the owner's wording for the rest. */
export function defaultPosterFields(
  tourTitle: string | null | undefined,
): PosterFields {
  return {
    title: tourTitle?.trim() ?? "",
    explanation: DEFAULT_EXPLANATION,
    callToAction: DEFAULT_CALL_TO_ACTION,
  };
}

/** What the creator last had for this tour link, or null: nothing stored,
 *  no store, a store that throws (site data blocked), or a damaged value. */
export function readPosterFields(
  store: PosterTextStore | undefined,
  link: string,
): PosterFields | null {
  if (store === undefined) return null;
  let raw: string | null;
  try {
    raw = store.getItem(KEY_PREFIX + link);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { title, explanation, callToAction } = value as Record<string, unknown>;
  return typeof title === "string" &&
    typeof explanation === "string" &&
    typeof callToAction === "string"
    ? { title, explanation, callToAction }
    : null;
}

/** Remember the fields for this tour link; a store that throws is ignored
 *  (the text then lasts this page only). An empty field is stored as
 *  empty: it is a choice - the part is left off the poster. */
export function writePosterFields(
  store: PosterTextStore | undefined,
  link: string,
  fields: PosterFields,
): void {
  try {
    store?.setItem(
      KEY_PREFIX + link,
      JSON.stringify({
        title: fields.title,
        explanation: fields.explanation,
        callToAction: fields.callToAction,
      }),
    );
  } catch {
    // Site data blocked: the text holds for this page only.
  }
}
