/**
 * A tour that is not finished yet, as its visitor and its creator meet
 * it. The printed code may point at the hosted file before the creator's
 * first Finish, so a visitor can open a zip without `tour.json`, or a tour
 * without stations: that is the normal order of making a tour, not an
 * error, and the page says so plainly (with the tour's contact when it has
 * one) instead of refusing the file. Pure.
 *
 * @see tour-unfinished.ts.md
 */

import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { contactLink } from "./tour-contact.js";

/** What a visitor of an unfinished tour is told, on the start page and on
 *  the AR status line. */
export const NOT_FINISHED = "This tour is not finished yet.";

/** Unfinished: no `tour.json` (`null`), or a tour without stations. A
 *  visitor sees only a finished tour's content. */
export function tourUnfinished(manifest: TourManifest | null): boolean {
  return manifest === null || manifest.stations.length === 0;
}

/** The AR status line's sentence for an unfinished tour: {@link
 *  NOT_FINISHED}, and who to ask when the tour names a contact a visitor
 *  may follow (the start page's words, `index.html` `#error-contact`). */
export function notFinishedSentence(contact: string | undefined): string {
  const link = contactLink(contact);
  return link === null
    ? NOT_FINISHED
    : `${NOT_FINISHED} Questions about this tour? Contact its maker: ${link.label}`;
}

/** The creator's note beside the visitor link while the hosted file is not
 *  finished: what a visitor reads now, and what finishes it. Null for a
 *  finished tour. */
export function unfinishedNote(
  fileManifest: TourManifest | null,
): string | null {
  return tourUnfinished(fileManifest)
    ? `A visitor who opens this link now reads "${NOT_FINISHED}": the hosted file has no station yet. Place something in AR, finish the tour, and upload the file it saves in place of the hosted one.`
    : null;
}
