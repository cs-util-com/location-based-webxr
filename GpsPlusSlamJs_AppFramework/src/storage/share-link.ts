/**
 * Share-link normalization: turns a *share page* link copied out of a cloud
 * storage UI into the provider's raw-bytes download URL — the one that
 * actually supports HTTP Range reads and CORS, as opposed to an HTML preview
 * page.
 *
 * - Dropbox `www.dropbox.com/scl/fi/…` (and legacy `/s/…`) → the
 *   `dl.dropboxusercontent.com` content host (drops `dl=`).
 * - GitHub `github.com/u/r/blob|raw/branch/path` → `raw.githubusercontent.com`.
 * - Google Drive `file/d/<id>`, `open?id=`, `uc?id=` → the
 *   `drive.usercontent.google.com/download?…&confirm=t` form: serves 206 +
 *   `Accept-Ranges`, and `confirm=t` skips the "can't scan for viruses" HTML
 *   interstitial on larger files. Caveat: it advertises
 *   `Access-Control-Allow-Origin: *` to plain clients but 403s any request
 *   carrying `Sec-Fetch-Site: cross-site` — i.e. every real browser fetch —
 *   so key-less Drive still needs a CORS proxy. With an API key the official
 *   `drive/v3/files/<id>?alt=media` endpoint is used instead.
 * - OneDrive: new-style `1drv.ms/<t>/c/<cid>/<shareId>` links (accounts on the
 *   SharePoint backend, where the legacy shares API answers 401) → the
 *   `my.microsoftpersonalcontent.com/personal/<cid>/_layouts/15/download.aspx
 *   ?share=<shareId>` form — serves 206 + `Accept-Ranges` +
 *   `Access-Control-Allow-Origin: *` anonymously, even to browser-shaped
 *   requests: Range + CORS with no proxy. Legacy links → the shares API
 *   (`/v1.0/shares/u!<base64url>/root/content`), which 302s to a temporary
 *   download URL; `fetch` follows the redirect.
 *
 * Anything else — already-direct URLs, CORS-proxy URLs (relative or absolute),
 * unknown hosts — passes through byte-identical, so this layer is invisible
 * unless a known share page is recognized. Everything downstream (probe, byte
 * sources, fallback) stays provider-agnostic.
 */

export interface NormalizeShareUrlOptions {
  /** Google Drive API key: unlocks the `drive/v3 … alt=media` URL, the only
   *  Drive form that serves Range + CORS to a browser (public files only). */
  googleDriveApiKey?: string | undefined;
}

/** Rewrite a known share-page link to its raw download form; else return as-is. */
export function normalizeShareUrl(
  rawUrl: string,
  opts: NormalizeShareUrlOptions = {}
): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl; // relative (e.g. a dev-proxy path) or not a URL — untouched
  }
  return resolveKnownProvider(url, rawUrl, opts) ?? rawUrl;
}

/** The provider dispatch: a raw download URL, or null when not a share page. */
function resolveKnownProvider(
  url: URL,
  rawUrl: string,
  opts: NormalizeShareUrlOptions
): string | null {
  switch (url.hostname) {
    case 'dropbox.com':
    case 'www.dropbox.com':
      return normalizeDropbox(url);
    case 'github.com':
      return normalizeGithub(url);
    case 'drive.google.com':
      return normalizeGoogleDrive(url, opts.googleDriveApiKey);
    case '1drv.ms':
    case 'onedrive.live.com':
      return normalizeOneDrive(url, rawUrl);
    default:
      return null;
  }
}

function normalizeDropbox(url: URL): string | null {
  if (!url.pathname.startsWith('/scl/fi/') && !url.pathname.startsWith('/s/')) {
    return null; // folder links etc. have no single-file raw form
  }
  const direct = new URL(url);
  direct.hostname = 'dl.dropboxusercontent.com';
  direct.searchParams.delete('dl'); // dl=0 forces the HTML preview page
  return direct.toString();
}

function normalizeGithub(url: URL): string | null {
  // /<user>/<repo>/(blob|raw)/<branch>/<path> → raw.githubusercontent.com
  const m = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(url.pathname);
  if (!m) return null;
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
}

function normalizeGoogleDrive(url: URL, apiKey?: string): string | null {
  const id =
    /^\/file\/d\/([^/]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get('id');
  if (id === null || id === undefined || id === '') return null;
  if (apiKey !== undefined && apiKey !== '') {
    return `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${apiKey}`;
  }
  return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
}

function normalizeOneDrive(url: URL, rawUrl: string): string {
  // New-style `/u/c/<cid>/<shareId>` links belong to accounts migrated to the
  // SharePoint backend (the 1drv.ms redirect carries `migratedtospo=true`),
  // where the legacy shares API below answers 401. Their SPO download form
  // serves the bytes anonymously with Range + CORS.
  const m = /^\/[a-z]\/c\/([0-9a-fA-F]+)\/([\w!-]+)$/.exec(url.pathname);
  if (m) {
    return `https://my.microsoftpersonalcontent.com/personal/${m[1]}/_layouts/15/download.aspx?share=${m[2]}`;
  }
  // Legacy links: the shares API addresses any share link as `u!` + base64url.
  const token = btoa(rawUrl)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  return `https://api.onedrive.com/v1.0/shares/u!${token}/root/content`;
}
