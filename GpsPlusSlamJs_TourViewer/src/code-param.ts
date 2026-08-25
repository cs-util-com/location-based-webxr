/**
 * `&c=<n>` — the printed code discriminator (QD-6): selects which
 * `qr/<c>.json` level a launch refers to. Absent or unreadable ⇒ `"1"`,
 * because the single-code tour is the common case and a printed URL must
 * never dead-end over a missing parameter.
 *
 * Used twice in viewer mode: once on the PAGE's own launch URL (the code
 * the visitor scanned to get here), and once on each DETECTED code's
 * decoded text (a tour can have several printed codes; the code in front
 * of the camera wins over the one that launched the page).
 */
export const DEFAULT_CODE_DISCRIMINATOR = "1";

/** From a query string (`location.search` or a URL's `.search`). */
export function codeFromSearch(search: string): string {
  const raw = new URLSearchParams(search).get("c")?.trim();
  return raw !== undefined && raw !== "" ? raw : DEFAULT_CODE_DISCRIMINATOR;
}

/** From a DETECTED code's decoded text (a printed launch URL). Non-URL
 *  text — or a URL without `c` — falls back to `fallback`: the PAGE's own
 *  launch code, so a payload without a discriminator resolves to the code
 *  the visitor actually scanned to get here (M4 milestone review #6). */
export function codeFromDetectedText(
  text: string,
  fallback: string = DEFAULT_CODE_DISCRIMINATOR,
): string {
  try {
    const raw = new URLSearchParams(new URL(text).search).get("c")?.trim();
    return raw !== undefined && raw !== "" ? raw : fallback;
  } catch {
    return fallback;
  }
}
