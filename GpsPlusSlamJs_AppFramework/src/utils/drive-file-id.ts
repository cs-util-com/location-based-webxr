/**
 * The Google Drive file id of a link, in any spelling Drive or this app
 * hands out - the one parser (Tour Viewer M0c follow-up F3; root
 * `CLAUDE.md` DEC-H3: shared behaviour lives once, here).
 *
 * @see drive-file-id.ts.md
 */

/** A Drive file id as Drive mints them: letters, digits, `-` and `_`. */
const DRIVE_ID = /^[\w-]+$/;

/** Hosts whose links name a Drive file by `?id=`. */
const ID_QUERY_HOSTS: ReadonlySet<string> = new Set([
  'drive.google.com',
  'drive.usercontent.google.com',
]);

/**
 * The file id behind `link`, or null: `/file/d/<id>/...` (view, edit, the
 * bare address, any share tail), `open?id=` and `uc?id=` on
 * drive.google.com, the usercontent download, the Drive API's
 * `/drive/v<n>/files/<id>`, and the site worker's proxy
 * (`.../api/drive-proxy?id=`; a relative one resolves against `base`). An
 * id outside Drive's alphabet is null, so a returned id is safe in a path
 * or a query unescaped.
 */
export function driveFileId(link: string | URL, base?: string): string | null {
  let url: URL;
  try {
    url = typeof link === 'string' ? new URL(link, base) : link;
  } catch {
    return null;
  }
  const id = idFromPath(url) ?? idFromQuery(url);
  return id !== null && DRIVE_ID.test(id) ? id : null;
}

/** `/file/d/<id>` on drive.google.com, `/drive/v<n>/files/<id>` on the
 *  Drive API. */
function idFromPath(url: URL): string | null {
  const pattern =
    url.hostname === 'drive.google.com'
      ? /^\/file\/d\/([^/]+)/
      : url.hostname === 'www.googleapis.com'
        ? /^\/drive\/v\d+\/files\/([^/]+)/
        : null;
  return pattern?.exec(url.pathname)?.[1] ?? null;
}

/** `?id=` on the Drive hosts and the site worker's proxy. */
function idFromQuery(url: URL): string | null {
  const named =
    ID_QUERY_HOSTS.has(url.hostname) ||
    url.pathname.endsWith('/api/drive-proxy');
  return named ? url.searchParams.get('id') : null;
}
