/**
 * The one prompt-free Permissions-API query (DEC-H3): what the browser says
 * about a permission, without ever showing a prompt.
 *
 * Deliberately free of imports, so a no-build page that serves the
 * framework's TypeScript as-is (the design system's labs under `/fw/`) can
 * load it: their server maps `.js` to `.ts` but resolves no extensionless
 * import.
 */

/**
 * The browser's answer. `unknown`: no Permissions API, no such feature, a
 * query that failed, or an answer outside the standard three.
 */
export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

const STATES: ReadonlySet<string> = new Set(['granted', 'denied', 'prompt']);

/**
 * Queries `navigator.permissions` for `name`. Never prompts and never
 * rejects. iOS Safari answers `prompt` for geolocation even where the page
 * may ask; that stays `prompt`.
 */
export async function queryPermissionState(
  name: PermissionName
): Promise<PermissionState> {
  if (
    typeof navigator === 'undefined' ||
    !navigator ||
    typeof navigator.permissions?.query !== 'function'
  ) {
    return 'unknown';
  }
  try {
    const status: unknown = await navigator.permissions.query({ name });
    const state = (status as { state?: unknown } | null)?.state;
    return typeof state === 'string' && STATES.has(state)
      ? (state as PermissionState)
      : 'unknown';
  } catch {
    // Unsupported names throw (synchronously in some browsers) or reject.
    return 'unknown';
  }
}

/** The geolocation permission; `unknown` where there is no geolocation API. */
export async function geolocationPermissionState(): Promise<PermissionState> {
  if (typeof navigator === 'undefined' || !navigator?.geolocation) {
    return 'unknown';
  }
  return queryPermissionState('geolocation');
}
