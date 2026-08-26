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

import { encodeBase64Url } from '../utils/qr-payload/base64url';
import { utf8Encode } from '../utils/qr-payload/utf8';

export interface NormalizeShareUrlOptions {
  /** Google Drive API key: unlocks the `drive/v3 … alt=media` URL — Range +
   *  CORS per Google's API contract (public files only). Only used when no
   *  `corsProxyBaseUrl` is configured: an explicitly configured proxy is
   *  the deliberate, observable Drive path (drive-proxy plan Rev 2,
   *  review finding 7). */
  googleDriveApiKey?: string | undefined;
  /** Base URL of the site worker's Drive proxy (`/api/drive-proxy`): the
   *  keyless Drive path that actually works in browsers — the usercontent
   *  endpoint 403s any request carrying `Sec-Fetch-Site: cross-site`,
   *  which every real browser fetch does. When set, Drive share links AND
   *  directly-pasted usercontent links rewrite to `<base>?id=<fileId>`. */
  corsProxyBaseUrl?: string | undefined;
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
      return normalizeGoogleDrive(url, opts);
    case 'drive.usercontent.google.com':
      // The raw download form this layer itself used to emit for keyless
      // Drive — browser-blocked, so a pasted/bookmarked copy is rewritten
      // to the proxy when one is configured; otherwise it passes through
      // (non-browser consumers can still use it directly).
      return normalizeGoogleDrive(url, opts);
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

function normalizeGoogleDrive(
  url: URL,
  opts: NormalizeShareUrlOptions
): string | null {
  const id =
    /^\/file\/d\/([^/]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get('id');
  if (id === null || id === undefined || id === '') return null;
  // Precedence: proxy → API key → raw usercontent (drive-proxy plan Rev 2,
  // review finding 7 — a later-added key must not silently switch Drive off
  // the configured, observable proxy path).
  const { corsProxyBaseUrl, googleDriveApiKey: apiKey } = opts;
  if (corsProxyBaseUrl !== undefined && corsProxyBaseUrl !== '') {
    // Built via URL/searchParams, never concatenation: a base already
    // carrying a query (or a trailing `?`) must still yield one valid URL,
    // and searchParams encodes the id so it stays one opaque value.
    const proxied = new URL(corsProxyBaseUrl);
    proxied.searchParams.set('id', id);
    return proxied.toString();
  }
  // `searchParams.get` returns the DECODED value — re-encode so an id (or
  // key) containing `&`/`=` stays one opaque value instead of smuggling
  // extra query parameters into the rewritten URL (PR #357 review).
  const safeId = encodeURIComponent(id);
  if (apiKey !== undefined && apiKey !== '') {
    return `https://www.googleapis.com/drive/v3/files/${safeId}?alt=media&key=${encodeURIComponent(apiKey)}`;
  }
  return `https://drive.usercontent.google.com/download?id=${safeId}&export=download&confirm=t`;
}

function normalizeOneDrive(url: URL, rawUrl: string): string | null {
  // New-style `/u/c/<cid>/<shareId>` links belong to accounts migrated to the
  // SharePoint backend (the 1drv.ms redirect carries `migratedtospo=true`),
  // where the legacy shares API below answers 401. Their SPO download form
  // serves the bytes anonymously with Range + CORS.
  const m = /^\/[a-z]\/c\/([0-9a-fA-F]+)\/([\w!-]+)$/.exec(url.pathname);
  if (m) {
    return `https://my.microsoftpersonalcontent.com/personal/${m[1]}/_layouts/15/download.aspx?share=${m[2]}`;
  }
  if (!isOneDriveShareShape(url)) return null; // e.g. an about page — not ours
  // Legacy links: the shares API addresses any share link as `u!` + base64url
  // over the link's UTF-8 BYTES — `btoa` alone throws on any character
  // outside Latin-1 (a Unicode filename in a query param).
  const token = encodeBase64Url(utf8Encode(rawUrl));
  return `https://api.onedrive.com/v1.0/shares/u!${token}/root/content`;
}

/** Positively recognized OneDrive share-link shapes; anything else must pass
 *  through byte-identical rather than be wrapped in the shares API. */
function isOneDriveShareShape(url: URL): boolean {
  if (url.hostname === '1drv.ms') {
    // Short share links are `/<type letter(s)>/<token…>` — a bare host or
    // marketing path is not a share.
    return /^\/[a-z]{1,2}\//.test(url.pathname);
  }
  // onedrive.live.com addresses shared items via resid/id/cid params or the
  // /redir and /embed routes.
  return (
    url.pathname.startsWith('/redir') ||
    url.pathname.startsWith('/embed') ||
    url.searchParams.has('resid') ||
    url.searchParams.has('id') ||
    url.searchParams.has('cid')
  );
}
