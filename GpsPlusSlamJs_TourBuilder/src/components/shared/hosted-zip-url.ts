import { normalizeShareUrl } from "gps-plus-slam-app-framework/storage";

/** Hosts that serve bytes but not to a cross-site *browser* — reachable only
 *  through the proxy. Dropbox sends no CORS headers at all; Google's
 *  usercontent host advertises `Access-Control-Allow-Origin: *` to plain
 *  clients but 403s any request carrying `Sec-Fetch-Site: cross-site`, which a
 *  browser always attaches. The proxy's server-side fetch sends neither. */
export const PROXY_REQUIRED_HOSTS = new Set([
  "dl.dropboxusercontent.com",
  "drive.usercontent.google.com",
]);

export interface PreparedZipUrl {
  readonly url: string;
  readonly notes: readonly string[];
}

/**
 * Turn a pasted hosted-ZIP URL (or cloud-provider share page link) into a
 * fetchable value: share pages are normalized to their raw download URL,
 * and known no-CORS hosts are routed through the dev proxy
 * (`/tour-proxy?u=…`) when `isDev`. In production there is no local proxy,
 * so the URL is left as-is with a warning — see
 * `components/cloud-loader/RECIPE.md` for the Worker setup.
 */
export function prepareHostedZipUrl(
  raw: string,
  isDev: boolean,
): PreparedZipUrl {
  const notes: string[] = [];
  const normalized = normalizeShareUrl(raw);
  if (normalized !== raw) {
    notes.push(`share link normalized → ${normalized}`);
  }

  let host: string;
  try {
    host = new URL(normalized).hostname;
  } catch {
    return { url: normalized, notes }; // relative (e.g. already-proxied) URL
  }

  if (!PROXY_REQUIRED_HOSTS.has(host)) return { url: normalized, notes };
  if (!isDev) {
    notes.push(
      `⚠ ${host} serves no CORS headers — route it through the Worker proxy (RECIPE.md)`,
    );
    return { url: normalized, notes };
  }
  const proxied = `/tour-proxy?u=${encodeURIComponent(normalized)}`;
  notes.push(`no-CORS host ${host} → routed via dev proxy`);
  return { url: proxied, notes };
}
