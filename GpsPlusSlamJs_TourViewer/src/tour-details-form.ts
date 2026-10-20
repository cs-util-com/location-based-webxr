/**
 * A tour's details as the pages edit them (tour editor plan 2026-10-17-1816,
 * W2; lifted out of `editor/` for the shared tour document, D30): the name,
 * description, cover and contact a manifest carries, the form a page's
 * fields fill, and the one check that turns a form into the details to
 * keep - by the format's own rules (`tour-details.ts` in the framework),
 * the name by `checkTourTitle`, so the phone and the desktop count alike.
 * Pure.
 *
 * @see tour-details-form.ts.md
 */

import {
  checkTourContact,
  checkTourDescription,
  checkTourTitle,
  TOUR_CONTACT_MAX_CHARS,
  TOUR_DESCRIPTION_MAX_CHARS,
  TOUR_TITLE_MAX_CHARS,
} from "gps-plus-slam-app-framework/ar/tour-details";
import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";

/** The tour's details: the manifest's own fields, each present only when
 *  the tour carries it. */
export interface TourDetailFields {
  readonly title?: string;
  readonly description?: string;
  readonly cover?: string;
  readonly contact?: string;
}

/** The details' fields, as the manifest names them, in the order a page
 *  names them (name, description, cover, contact). */
export const DETAIL_FIELDS = [
  "title",
  "description",
  "cover",
  "contact",
] as const;

/** A details form's values; an empty text (or a null cover) is "none". */
export interface DetailsForm {
  readonly name: string;
  readonly description: string;
  readonly cover: string | null;
  readonly contact: string;
}

/** The details a manifest carries. */
export function detailsOf(manifest: TourManifest): TourDetailFields {
  const details: { -readonly [K in keyof TourDetailFields]: string } = {};
  for (const field of DETAIL_FIELDS) {
    const value = manifest[field];
    if (value !== undefined) details[field] = value;
  }
  return details;
}

/** `manifest` carrying `details` in place of its own (an absent field is
 *  removed); the input is left as it was. */
export function withDetails(
  manifest: TourManifest,
  details: TourDetailFields,
): TourManifest {
  const next = { ...manifest };
  for (const field of DETAIL_FIELDS) {
    const value = details[field];
    if (value === undefined) delete next[field];
    else next[field] = value;
  }
  return next;
}

/** Text counted as a reader counts it: in characters, not UTF-16 units. */
function charCount(text: string): number {
  return [...text].length;
}

/**
 * A form checked by the format's rules, in plain words: the details to
 * keep, or why not. `was` is the details as they stand: a name kept as it
 * is passes whatever its length (a tour named elsewhere, M4a review #10).
 * A cover naming none of `covers` is refused, or - for a draft's record,
 * whose photo may have gone since - dropped (`unknownCover`), as the
 * format's reader drops it (M4a review #1).
 */
export function checkDetailsForm(
  form: DetailsForm,
  covers: ReadonlySet<string>,
  was: TourDetailFields,
  unknownCover: "refuse" | "drop" = "refuse",
): { ok: true; details: TourDetailFields } | { ok: false; reason: string } {
  const details: { -readonly [K in keyof TourDetailFields]: string } = {};
  const name = form.name.trim();
  if (name !== "") {
    if (!checkTourTitle(name).ok && name !== was.title) {
      return {
        ok: false,
        reason: `The name is longer than ${String(TOUR_TITLE_MAX_CHARS)} characters.`,
      };
    }
    details.title = name;
  }
  if (form.description.trim() !== "") {
    const checked = checkTourDescription(form.description);
    if (!checked.ok) {
      return {
        ok: false,
        reason: `The description is longer than ${String(TOUR_DESCRIPTION_MAX_CHARS)} characters.`,
      };
    }
    details.description = checked.value;
  }
  if (form.cover !== null && covers.has(form.cover)) {
    details.cover = form.cover;
  } else if (form.cover !== null && unknownCover === "refuse") {
    return {
      ok: false,
      reason: "That cover is not one of this tour's photos any more.",
    };
  }
  if (form.contact.trim() !== "") {
    const checked = checkTourContact(form.contact);
    if (!checked.ok) {
      return {
        ok: false,
        reason:
          charCount(form.contact.trim()) > TOUR_CONTACT_MAX_CHARS
            ? `The contact is longer than ${String(TOUR_CONTACT_MAX_CHARS)} characters.`
            : "The contact must be an e-mail address or a web link starting with http:// or https://.",
      };
    }
    details.contact = checked.value;
  }
  return { ok: true, details };
}
