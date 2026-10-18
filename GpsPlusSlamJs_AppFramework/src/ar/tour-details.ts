/**
 * A tour's details (tour editor plan 2026-10-17-1816, W2, D15): the words
 * and the picture a visitor meets before the tour starts, beside its
 * `title` - a `description`, a `cover` (the id of one of the tour's own
 * images) and a `contact` (an e-mail address or a web link), shown by the
 * visitor's error messages.
 *
 * Kept apart from `tour-manifest.ts` so a later format version (stations
 * as parents, the plan's W3) reads the same fields with the same parsers:
 * each takes the raw value and, for the cover, the set of image ids the
 * caller's own structure names (plan review 2 #10).
 *
 * The details are cosmetic, so a READER never fails a tour over one: a
 * value that does not pass is dropped, with its reason, and the tour opens
 * without it. The same checks are exported for the editor's fields, so
 * what the editor accepts is exactly what a reader keeps (DEC-H3).
 *
 * @see tour-details.ts.md
 */

import { TOUR_ID_PATTERN } from './tour-archive.js';

/** The longest description kept, in characters (code points). */
export const TOUR_DESCRIPTION_MAX_CHARS = 2000;

/** The longest contact kept, in characters (an e-mail address is at most
 *  254; a web link rarely more). */
export const TOUR_CONTACT_MAX_CHARS = 320;

/** The details a tour may carry; each optional. */
export interface TourDetails {
  /** A few sentences on what the tour is; line breaks kept. */
  description?: string;
  /** The id of one of the tour's images: a photo object's or an image
   *  asset's (both name a content file by id). */
  cover?: string;
  /** An e-mail address (bare, or `mailto:`) or an http(s) link. */
  contact?: string;
}

export type TourDetailsField = keyof TourDetails;

/** A detail a reader left out, and why. */
export interface TourDetailsDrop {
  readonly field: TourDetailsField;
  readonly reason: string;
}

/** A checked value, or the reason it cannot be kept. */
export type TourDetailCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: string };

/** Ids: the manifest's own rule (short, path-safe, one segment). */
const IMAGE_ID = TOUR_ID_PATTERN;

/** One address: the part before the `@` without spaces or the characters
 *  RFC 5322 reserves (a quoted local part is not accepted); a dotted
 *  domain of letters, digits and hyphens. */
const EMAIL =
  /^[^\s@<>()[\]",;:\\]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[\p{L}\p{N}-]{2,}$/u;

/** The address characters a `mailto:` link must escape (RFC 6068): they
 *  would otherwise start a query or a fragment, or an escape. */
const MAILTO_RESERVED = /[%?#&]/g;

const MAILTO = /^mailto:/i;

function length(text: string): number {
  return [...text].length;
}

/** A string that says something, trimmed; the reason otherwise. */
function trimmedText(
  value: unknown,
  name: string,
  max: number
): TourDetailCheck {
  if (typeof value !== 'string') {
    return { ok: false, reason: `"${name}" must be text` };
  }
  const text = value.trim();
  if (text === '') return { ok: false, reason: `"${name}" is empty` };
  if (length(text) > max) {
    return {
      ok: false,
      reason: `"${name}" is longer than ${String(max)} characters`,
    };
  }
  return { ok: true, value: text };
}

/** The description as kept: trimmed, non-empty, at most
 *  {@link TOUR_DESCRIPTION_MAX_CHARS}. */
export function checkTourDescription(value: unknown): TourDetailCheck {
  return trimmedText(value, 'description', TOUR_DESCRIPTION_MAX_CHARS);
}

function isEmail(text: string): boolean {
  return EMAIL.test(text);
}

function isWebLink(text: string): boolean {
  try {
    const url = new URL(text);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname !== '' &&
      // A link carrying a user name reads as one host and opens another.
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

/** The contact as kept: trimmed, at most {@link TOUR_CONTACT_MAX_CHARS},
 *  and an e-mail address (bare or `mailto:`) or an http(s) link. */
export function checkTourContact(value: unknown): TourDetailCheck {
  const text = trimmedText(value, 'contact', TOUR_CONTACT_MAX_CHARS);
  if (!text.ok) return text;
  const contact = text.value;
  const address = contact.replace(MAILTO, '');
  if (isEmail(address) || isWebLink(contact)) return text;
  return {
    ok: false,
    reason:
      '"contact" must be an e-mail address or a web link starting with http:// or https://',
  };
}

/** The cover as kept: the id of one of `imageIds`. */
export function checkTourCover(
  value: unknown,
  imageIds: ReadonlySet<string>
): TourDetailCheck {
  if (typeof value !== 'string' || !IMAGE_ID.test(value)) {
    return { ok: false, reason: '"cover" must be an image id' };
  }
  if (!imageIds.has(value)) {
    return { ok: false, reason: `"cover" names no image of this tour` };
  }
  return { ok: true, value };
}

/** Where a contact leads: `mailto:` for an e-mail address, the link as
 *  the URL parser reads it otherwise (`https:example.org` is
 *  `https://example.org/`: given as it was typed, a page resolved it
 *  against itself, M4a review #4); null for a value
 *  {@link checkTourContact} refuses. */
export function tourContactHref(contact: string): string | null {
  const checked = checkTourContact(contact);
  if (!checked.ok) return null;
  const address = checked.value.replace(MAILTO, '');
  return isEmail(address)
    ? `mailto:${address.replace(MAILTO_RESERVED, encodeURIComponent)}`
    : new URL(checked.value).href;
}

/**
 * The details of a document (`data` is the manifest's record, or a later
 * version's tour record), each checked; what does not pass is dropped with
 * its reason. An absent field is simply absent. Never throws.
 */
export function parseTourDetails(
  data: Readonly<Record<string, unknown>>,
  options: { readonly imageIds: ReadonlySet<string> }
): { details: TourDetails; dropped: TourDetailsDrop[] } {
  const details: TourDetails = {};
  const dropped: TourDetailsDrop[] = [];
  const checks: readonly [TourDetailsField, (v: unknown) => TourDetailCheck][] =
    [
      ['description', checkTourDescription],
      ['cover', (v) => checkTourCover(v, options.imageIds)],
      ['contact', checkTourContact],
    ];
  for (const [field, check] of checks) {
    if (data[field] === undefined) continue;
    const checked = check(data[field]);
    if (checked.ok) details[field] = checked.value;
    else dropped.push({ field, reason: checked.reason });
  }
  return { details, dropped };
}

/** The parts of a tour a cover is looked up in: structural, so a later
 *  format version with its own records passes them as well. */
export interface TourImages {
  readonly objects: readonly {
    readonly id: string;
    readonly kind: string;
    readonly image?: string;
  }[];
  readonly assets: readonly {
    readonly id: string;
    readonly kind: string;
    readonly path: string;
  }[];
}

/** The ids a cover may name: the placed photos' and the image assets'
 *  (both name a content file by id). */
export function tourImageIds(tour: TourImages): Set<string> {
  return new Set([
    ...tour.objects.filter((o) => o.kind === 'photo').map((o) => o.id),
    ...tour.assets.filter((a) => a.kind === 'image').map((a) => a.id),
  ]);
}

/** The archive entry of the tour's cover (`content/<id>.<ext>`, inside the
 *  tour's own folder), or null without a cover that names an image. */
export function tourCoverEntry(
  tour: TourImages & { readonly cover?: string }
): string | null {
  const { cover } = tour;
  if (cover === undefined) return null;
  const photo = tour.objects.find((o) => o.kind === 'photo' && o.id === cover);
  if (photo?.image !== undefined) return photo.image;
  return (
    tour.assets.find((a) => a.kind === 'image' && a.id === cover)?.path ?? null
  );
}
