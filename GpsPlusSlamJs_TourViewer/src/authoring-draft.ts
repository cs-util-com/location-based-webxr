/**
 * The authoring draft: what survives a crash, and the rules about when it
 * is offered, when it is spent, and what restoring it actually adds.
 *
 * WHY A DRAFT EXISTS (second testing session, F13). Everything a creator
 * measures and places lives in page memory until they tap Finish. An AR
 * session on a phone can be killed by the OS at any moment - a call, a
 * memory reclaim, an accidental back gesture - and today that loses the
 * whole walk.
 *
 * WHY THE DRAFT IS "SINCE THE HOSTED ZIP", NOT "SINCE THE LAST FINISH".
 * This is the rule the milestone's cold review turned on, so it is worth
 * stating plainly. Finishing is not terminal: it merges the placed objects
 * into the in-memory manifest, empties the list, and leaves that batch
 * alive only inside `ctx.rebuiltZip` - a Blob that dies with the page. A
 * draft reset by each finish would therefore hold only the objects placed
 * AFTER the last download, while the finish itself would rebuild from the
 * hosted zip, which never had the earlier ones. The creator would end up
 * with two downloads, each missing the other's content, and nothing on
 * screen would say so. So the draft accumulates until the hosted zip is
 * seen to contain it.
 *
 * Everything here is pure: the OPFS mechanics live in the framework's
 * store, and this file is the part that can be wrong in ways a reader
 * cannot see.
 */

import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

/**
 * What one draft holds.
 *
 * `sizeM` is in here because a crash loses it too: `creator-setup.ts`
 * rewrites the printed-size field from the framework default on every
 * load, so a creator who printed at 20 cm and crashed would re-enter AR
 * solving against 16 cm - silently, because the restored level's own copy
 * of the size still looks right.
 */
export interface AuthoringDraft {
  /** The creator-facing tour URL this draft belongs to. */
  tourUrl: string;
  /** The printed side length in metres, as it was when the code was
   *  measured. */
  sizeM: number;
  /** The measured level, or null when the creator placed content before
   *  measuring (possible: the mint gate blocks the FINISH, not placement
   *  in general). */
  level: { id: string; json: string } | null;
  /** The objects placed on this device and not yet seen in the hosted zip. */
  objects: readonly TourObject[];
}

/**
 * The storage key for a tour.
 *
 * The CREATOR-FACING url, never `session.archive.url`: that one is
 * normalised, and for a Drive-hosted tour it becomes the proxy route -
 * which is a RELATIVE path on a deployment and an absolute one on a dev
 * host, so the same tour would key differently between them. This is the
 * same string `wizardStepKey` keys by, deliberately: one tour, one
 * identity, wherever the page is served from.
 */
export function draftKeyForTour(tourUrl: string): string {
  return tourUrl.trim();
}

/**
 * The draft's objects that the hosted manifest does not already carry.
 *
 * This is the whole state machine in one function. It answers both
 * questions the draft has:
 *
 * - **What does restoring add?** Exactly these. Never an object the zip
 *   already contains, because `serializeTourManifest` rejects duplicate
 *   ids - so appending one would make every future finish throw, forever,
 *   with no way out inside the app.
 * - **Is the draft spent?** When this is empty. That is the only staleness
 *   this design can honestly act on: proof that the content reached the
 *   file the world sees.
 */
export function draftObjectsNotYetHosted(
  draft: AuthoringDraft,
  manifest: TourManifest | null,
): readonly TourObject[] {
  const hosted = new Set((manifest?.objects ?? []).map((o) => o.id));
  return draft.objects.filter((o) => !hosted.has(o.id));
}

/** A draft whose every object is already in the hosted zip has done its
 *  job and should be deleted rather than offered. */
export function draftIsSpent(
  draft: AuthoringDraft,
  manifest: TourManifest | null,
): boolean {
  return draftObjectsNotYetHosted(draft, manifest).length === 0;
}

/**
 * Append `additions` to `existing`, skipping ids already present.
 *
 * Used by the finish. Two lines that turn a permanent, unrecoverable
 * failure into a no-op: without it, a draft restored while its ids are
 * already in the manifest makes `serializeTourManifest` throw on every
 * finish attempt, and the only escape the app offers is clearing the
 * site's storage.
 */
export function appendWithoutDuplicateIds(
  existing: readonly TourObject[],
  additions: readonly TourObject[],
): TourObject[] {
  const seen = new Set(existing.map((o) => o.id));
  const out = [...existing];
  for (const object of additions) {
    if (seen.has(object.id)) continue;
    seen.add(object.id);
    out.push(object);
  }
  return out;
}

/** What the setup panel says when a draft is found. Plain words: the
 *  creator is being asked to decide about work they may not remember. */
export function restoreOfferText(count: number): string {
  return count === 1
    ? "Unsaved work from this tour is still on this device: 1 thing you placed. Add it back?"
    : `Unsaved work from this tour is still on this device: ${String(count)} things you placed. Add them back?`;
}

/** What it says once the creator has taken it back. */
export function restoredText(count: number): string {
  return count === 1
    ? "1 placed object restored - it goes into the zip on the next Finish."
    : `${String(count)} placed objects restored - they go into the zip on the next Finish.`;
}
