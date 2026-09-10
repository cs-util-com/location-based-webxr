/**
 * Where the tour manifest and its content live inside a tour archive, and
 * how to read the manifest out of one - the `tour.json` counterpart of
 * `qr/qr-level-archive.ts`'s `qr/<id>.json` convention, and for the same
 * reason: the writer (the Tour Viewer's finish step) and the reader (the
 * visitor's open path) are two code paths, and if their notion of the
 * entry name ever differed the content would simply be invisible, with no
 * error raised anywhere.
 *
 * Archive-agnostic like its sibling: entry NAMES in, a read-by-name
 * function in, so the zip library stays on the caller's side. Imported by
 * `tour-manifest.ts` (a photo's `image` must be the name this module
 * derives), so this module must not import the manifest's parser.
 */

import type { TourManifest } from './tour-manifest.js';

/** The manifest's entry name at the archive root. */
export const TOUR_MANIFEST_ENTRY = 'tour.json';

/** Folder inside the archive that holds placed content files. */
export const TOUR_CONTENT_FOLDER = 'content';

/** Extensions a content file may carry (the writer emits lower case). */
const CONTENT_EXTENSION = /^[a-z0-9]{1,5}$/;

/** Same guard as the manifest's object id: one path-safe segment. */
const CONTENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `…/tour.json` → true. A WRAPPING folder is allowed (`mytour/tour.json`,
 * at any depth) for the reason the level reader allows one: re-zipping a
 * folder, or a cloud host's "download folder", produces that shape, and
 * the framework's own parsers already tolerate it for `actions/` and
 * `session.json`.
 */
const MANIFEST_ENTRY = /(?:^|\/)tour\.json$/;

/**
 * Archive path for a content file.
 *
 * @throws TypeError for an id or extension that could escape the folder;
 *   both reach a zip path, so this fails loud rather than writing
 *   somewhere unintended.
 */
export function tourContentEntryName(id: string, extension: string): string {
  if (typeof id !== 'string' || !CONTENT_ID.test(id)) {
    throw new TypeError(
      `tourContentEntryName: unsafe content id ${JSON.stringify(id)}`
    );
  }
  if (typeof extension !== 'string' || !CONTENT_EXTENSION.test(extension)) {
    throw new TypeError(
      `tourContentEntryName: unsafe extension ${JSON.stringify(extension)}`
    );
  }
  return `${TOUR_CONTENT_FOLDER}/${id}.${extension}`;
}

/** The manifest entry among `entryNames`, or `null` when the archive has
 *  none. The one with the FEWEST path segments wins when a wrapped and a
 *  root copy coexist (the root one, when there is one). */
export function tourManifestEntryOf(
  entryNames: Iterable<string>
): string | null {
  let found: string | null = null;
  let foundDepth = Number.POSITIVE_INFINITY;
  for (const name of entryNames) {
    if (typeof name !== 'string' || !MANIFEST_ENTRY.test(name)) continue;
    const depth = name.split('/').length;
    if (depth < foundDepth) {
      found = name;
      foundDepth = depth;
    }
  }
  return found;
}

/**
 * Read the archive's manifest, or `null` when it has none. A manifest
 * that exists but does not parse is reported as an ERROR (rejects), not as
 * "no manifest": unlike a single bad level file, a broken manifest means
 * the creator's whole placement is unreadable, and a visitor deserves the
 * message over a silently empty tour.
 *
 * @param entryNames every entry name in the archive
 * @param readText reads one entry's text by name; may reject
 * @param parse the manifest parser (`parseTourManifest`), injected because
 *   this module is imported by the parser's own module (the content name
 *   is derived here) and a cycle would fail `check:cycles`.
 */
export async function readTourManifestFromEntries(
  entryNames: Iterable<string>,
  readText: (name: string) => Promise<string>,
  parse: (data: unknown) => TourManifest
): Promise<TourManifest | null> {
  const name = tourManifestEntryOf(entryNames);
  if (name === null) return null;
  return parse(JSON.parse(await readText(name)));
}
