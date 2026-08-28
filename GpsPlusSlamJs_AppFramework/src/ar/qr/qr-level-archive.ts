/**
 * The `qr/<id>.json` convention: where a printed code's level lives inside a
 * tour or recording archive, and how to read every level out of one.
 *
 * WHY THIS EXISTS. The convention had two halves in two different places —
 * the reader's pattern in the tour viewer, the writer's file name in that
 * app's DOM code — and nothing tied them together. A second writer (the
 * recorder's zip contributor) makes that split untenable: if the two ever
 * disagree, an authored level simply becomes invisible, with no error raised
 * anywhere. Both halves now live here, with a round-trip test across them.
 *
 * The module is deliberately archive-agnostic: it takes entry NAMES and a
 * function that reads one by name, so the zip library stays on the caller's
 * side and this stays testable with a plain object.
 *
 * SEE `GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
 * §3 M-A.
 */

import { parseQrLevel, type QrLevel } from './qr-level.js';

/** Folder inside the archive that holds level files. */
const QR_LEVEL_FOLDER = 'qr';

/**
 * `…/qr/<id>.json` → `<id>`.
 *
 * Deliberately more permissive than {@link qrLevelEntryName} accepts, in two
 * ways, because a reader must tolerate what real archives contain while the
 * writer only ever emits ids from `qrCodeId`:
 *
 * - the id charset is `[\w.-]+`, which excludes `/` — so a nested
 *   `qr/sub/x.json` is still not a level;
 * - a WRAPPING folder is allowed (`myrecording/qr/<id>.json`). Re-zipping a
 *   folder, or downloading one from a cloud host, produces exactly that
 *   shape, and the framework's own zip parser already tolerates it for
 *   `actions/` and `session.json`. Anchoring here while the siblings do not
 *   would lose only the QR levels from such an archive — surfacing as "this
 *   code has no level", the failure that looks like a pass.
 */
const QR_LEVEL_ENTRY = /(?:^|\/)qr\/([\w.-]+)\.json$/;

/** Ids the writer will emit into an archive path. Hex ids always qualify. */
const WRITABLE_ID = /^[\w.-]+$/;

/**
 * Archive path for a code's level file.
 *
 * @throws TypeError when `id` is not a string, is empty, or contains anything
 *   that could escape the folder (`/`, `\`, `..`, whitespace, query
 *   characters). The id reaches a zip path, so this fails loud rather than
 *   writing somewhere unintended.
 */
export function qrLevelEntryName(id: string): string {
  if (typeof id !== 'string' || !WRITABLE_ID.test(id) || id.includes('..')) {
    throw new TypeError(
      `qrLevelEntryName: unsafe level id ${JSON.stringify(id)} — expected the short hex id from qrCodeId`
    );
  }
  return `${QR_LEVEL_FOLDER}/${id}.json`;
}

/** The code id an archive entry names, or `null` if it is not a level file. */
export function qrLevelIdFromEntryName(name: string): string | null {
  if (typeof name !== 'string') return null;
  return QR_LEVEL_ENTRY.exec(name)?.[1] ?? null;
}

/**
 * Read every level file in an archive, keyed by code id.
 *
 * Null-tolerant by design: a corrupt, unparseable or unreadable level means
 * "this code has no level", never "this archive is broken" — a visitor whose
 * tour holds one bad file must still see the tour.
 *
 * @param entryNames every entry name in the archive (only level files are read)
 * @param readText reads one entry's text by name; may reject
 */
export async function parseQrLevelEntries(
  entryNames: Iterable<string>,
  readText: (name: string) => Promise<string>
): Promise<Map<string, QrLevel>> {
  const levels = new Map<string, QrLevel>();
  for (const name of entryNames) {
    const id = qrLevelIdFromEntryName(name);
    if (id === null) continue;
    try {
      levels.set(id, parseQrLevel(JSON.parse(await readText(name))));
    } catch {
      // Deliberately swallowed — see the null-tolerance note above.
    }
  }
  return levels;
}
