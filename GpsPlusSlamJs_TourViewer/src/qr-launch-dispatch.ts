/**
 * The decode side of the `?qr=` launch contract — the "future launch handler"
 * that `gps-plus-slam-app-framework`'s `utils/qr-payload/qr-launch-url.ts`
 * documents (its header, "Decode-side dispatch contract"): payloads starting
 * `http…` are raw URLs; `~…` is the compressed dictionary form; a payload
 * containing `/` is the GitHub template `user/repo/path`; anything else is a
 * bare file name under the configured default asset prefix.
 *
 * The encoder picks whichever form yields the sparsest printable QR, so a
 * viewer that decodes only some forms silently breaks a subset of printed
 * codes — this implements all four. The opt-in fifth form
 * (`HTTPS://<HOST>/S/<base32>`) is a PATH, not a `?qr=` payload; it needs the
 * `/S/*` Cloudflare rewrite that is not deployed, and is intentionally not
 * decoded here yet.
 */

import { decodeDictionaryPayload } from "gps-plus-slam-app-framework/utils/qr-payload/codec-dictionary";

/** Bare-name payloads mirror the encoder's `NAME_PATTERN`. */
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Resolve a `?qr=` payload (already URL-decoded by the query parser) to the
 * archive URL it names, or null when the payload is empty or undecodable.
 */
export async function resolveQrPayload(
  payload: string,
  defaultAssetPrefix: string,
): Promise<string | null> {
  const trimmed = payload.trim();
  if (trimmed === "") return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("~")) {
    return decodeDictionaryPayload(trimmed.slice(1));
  }
  if (trimmed.includes("/")) {
    return decodeGithubTemplate(trimmed);
  }
  if (NAME_PATTERN.test(trimmed)) {
    return defaultAssetPrefix + trimmed;
  }
  return null;
}

/** `user/repo/path…` → the raw-GitHub main-branch URL the encoder shrank. */
function decodeGithubTemplate(payload: string): string | null {
  const m = /^([^/]+)\/([^/]+)\/(.+)$/.exec(payload);
  if (m === null) return null;
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/refs/heads/main/${m[3]}`;
}
