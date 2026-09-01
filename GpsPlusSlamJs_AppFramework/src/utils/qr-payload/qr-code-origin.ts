/**
 * Is this decoded QR text one of OUR launch URLs?
 *
 * WHY THIS EXISTS — it is a safety boundary, not a convenience. Decoding a QR
 * turns a printed sticker into a URL, and the consumer path then wants to
 * fetch that URL: an app that scans whatever the camera sees would let a
 * stranger's sticker start an outbound request from the AR frame path, at an
 * address of their choosing, with no user action beyond looking at it. The
 * same predicate also gates MINTING, because an app that anchors every code
 * it sees would write a real latitude and longitude for a shop's WiFi code
 * into a zip the author then publishes.
 *
 * It fails CLOSED: anything it cannot positively recognise is not ours.
 *
 * SEE `GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
 * §3 M-A and §6 (the review finding that produced it).
 */

/** The query parameter every launch URL carries. */
const PAYLOAD_PARAM = 'qr';

/** Only these schemes can name something we would fetch. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * @param text the decoded QR payload
 * @param allowedHosts exact host names we own, e.g. `['gps.csutil.com']`.
 *   Compared case-insensitively against the parsed hostname — never as a
 *   prefix or suffix. An empty list means nothing is ours.
 * @returns whether `text` is one of our launch URLs and carries a payload
 */
export function qrCodeIsOurs(
  text: string,
  allowedHosts: readonly string[]
): boolean {
  if (typeof text !== 'string' || text === '') return false;
  // The allowlist is configuration, but "never throws" is a contract this
  // function is called under on the frame path — so it is checked, not assumed.
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) return false;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    // Not an absolute URL at all — a WiFi block, a phone number, plain text.
    return false;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;

  // Exact hostname match. `url.hostname` is already lowercased and, crucially,
  // excludes any `user@` prefix — so `https://ours.example@evil.example/`
  // resolves to `evil.example` here and is refused.
  //
  // The trailing dot is stripped first: `https://ours.example./` is the same
  // host to a resolver, and the URL parser keeps the dot — so without this a
  // code that IS ours would be quietly declined (fail-closed, but wrong).
  const host = stripTrailingDot(url.hostname);
  const owned = allowedHosts.some(
    (allowed) =>
      typeof allowed === 'string' &&
      stripTrailingDot(allowed.toLowerCase()) === host
  );
  if (!owned) return false;

  // Our own home page is not a code. Trimmed, because a payload of pure
  // whitespace names nothing either and the decoder would reject it anyway.
  const payload = url.searchParams.get(PAYLOAD_PARAM);
  return payload !== null && payload.trim() !== '';
}

/** `example.com.` → `example.com`. One dot only; the root label is optional
 *  in a URL but never part of the name anyone configures. */
function stripTrailingDot(host: string): string {
  return host.endsWith('.') ? host.slice(0, -1) : host;
}
