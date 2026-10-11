/**
 * Which tour a printed code names (TourViewer scan-to-open plan §9 #2,
 * #6): the code's text is the launch link `…/tour/?qr=<payload>`, the
 * payload resolves exactly as a `?qr=` boot does, and the result is
 * normalised the way `openRemoteArchive` normalises the link it opens - so
 * it compares equal to an open tour's `archive.url` whichever of a host's
 * spellings either side was written with. The code's own level id
 * (`qrCodeId` of its text) is resolved too: a tour that carries
 * `qr/<id>.json` for it printed it, whatever link either side names - the
 * one comparison a tour opened from a FILE (no link at all) can make (K0
 * milestone review R6). Pure: no DOM, no session state.
 */

import { normalizeShareUrl } from "gps-plus-slam-app-framework/storage";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import { resolveQrPayload } from "gps-plus-slam-app-framework/utils/qr-payload/qr-launch-dispatch";

import { isTourFileKey } from "./tour-file-key.js";

/** Bare-name `?qr=` payloads resolve under this prefix — the convention the
 *  QR builder's `defaultAssetPrefix` example documents. */
export const DEFAULT_ASSET_PREFIX =
  "https://raw.githubusercontent.com/cs-util-com/GeoTales/refs/heads/main/";

/** Hosts whose link reaches the file only through a redirect, or whose
 *  normalised form depends on the spelling: two different links there can
 *  be one file, so a difference proves nothing. */
const UNCOMPARABLE_HOSTS: ReadonlySet<string> = new Set([
  "1drv.ms",
  "onedrive.live.com",
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "is.gd",
  "goo.gl",
]);

export type CodeTour =
  /** The code is no launch link (a third-party code near the poster). */
  | { kind: "not-a-tour-code" }
  /** A launch link whose payload names no archive. */
  | { kind: "unreadable" }
  | {
      kind: "tour";
      /** The link as resolved - what the open path and step 1 take. */
      url: string;
      /** The comparison key: `archive.url`'s form (`normalizeShareUrl`)
       *  with the spellings that still name one file folded together
       *  (`comparableUrl`). Compare only with `tourRelation`. */
      normalizedUrl: string;
      /** False where a difference in links does not prove another file. */
      comparable: boolean;
      /** The code's level id (`qrCodeId` of its text), or null where Web
       *  Crypto is missing: an open tour carrying `qr/<levelId>.json` is
       *  the tour that printed this code. */
      levelId: string | null;
    };

/** The `qr` payload of a launch link, or null (not a URL, no payload). */
export function launchPayload(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const payload = url.searchParams.get("qr")?.trim() ?? "";
  return payload === "" ? null : payload;
}

/** Which tour `text` names. Never rejects: a payload the resolver refuses
 *  is "unreadable". */
export async function resolveCodeTour(
  text: string,
  corsProxyBaseUrl: string,
): Promise<CodeTour> {
  const payload = launchPayload(text);
  if (payload === null) return { kind: "not-a-tour-code" };
  let url: string | null;
  try {
    url = await resolveQrPayload(payload, DEFAULT_ASSET_PREFIX);
  } catch {
    url = null;
  }
  if (url === null) return { kind: "unreadable" };
  let levelId: string | null;
  try {
    levelId = await qrCodeId(text);
  } catch {
    levelId = null; // no Web Crypto (an insecure context): links only
  }
  return {
    kind: "tour",
    url,
    normalizedUrl: comparableUrl(normalizeShareUrl(url, { corsProxyBaseUrl })),
    comparable: !UNCOMPARABLE_HOSTS.has(hostOf(url)),
    levelId,
  };
}

export type TourRelation =
  | "not-a-tour"
  | "no-tour-open"
  | "this-tour"
  | "other-tour"
  /** A link that cannot be compared and differs: neither proven. */
  | "unknown";

/**
 * How a resolved code relates to the open tour (`archive.url`, or null),
 * given the level ids the open tour carries (`qr/<id>.json`).
 *
 * The tour's identity decides before its link (K0 milestone review R6): a
 * tour carrying the code's level printed it, however either side was
 * opened. A tour opened from a FILE has no link to compare at all - its
 * `archive.url` is a content key - so any other code reads `unknown`,
 * never "another tour".
 */
export function tourRelation(
  code: CodeTour,
  openArchiveUrl: string | null,
  openLevelIds: { has(id: string): boolean } | null = null,
): TourRelation {
  if (code.kind !== "tour") return "not-a-tour";
  if (openArchiveUrl === null) return "no-tour-open";
  if (printedBy(code, openArchiveUrl, openLevelIds)) return "this-tour";
  if (isTourFileKey(openArchiveUrl)) return "unknown";
  // Either side may be the one only a redirect resolves: a tour opened in
  // step 1 from a short link is as uncomparable as a code carrying one.
  return code.comparable && !UNCOMPARABLE_HOSTS.has(hostOf(openArchiveUrl))
    ? "other-tour"
    : "unknown";
}

/** Whether the open tour printed `code`: it carries the code's level, or
 *  its link names the same file. */
function printedBy(
  code: CodeTour & { kind: "tour" },
  openArchiveUrl: string,
  openLevelIds: { has(id: string): boolean } | null,
): boolean {
  if (code.levelId !== null && openLevelIds?.has(code.levelId) === true) {
    return true;
  }
  return code.normalizedUrl === comparableUrl(openArchiveUrl);
}

/**
 * Fold together spellings `normalizeShareUrl` keeps apart but that name one
 * file (milestone review #7): the print step shrinks a raw GitHub link to
 * `user/repo/path`, which decodes to `.../refs/heads/<branch>/...` while
 * the tour may have been opened as `.../<branch>/...`; a Dropbox link's
 * `st` token differs between copies of one share, and `dl` only picks a
 * download mode. Anything unparseable is its own key.
 */
function comparableUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.hostname === "raw.githubusercontent.com") {
    parsed.pathname = parsed.pathname.replace(
      /^(\/[^/]+\/[^/]+)\/refs\/heads\//,
      "$1/",
    );
  }
  if (
    parsed.hostname.endsWith("dropbox.com") ||
    parsed.hostname.endsWith("dropboxusercontent.com")
  ) {
    parsed.searchParams.delete("st");
    parsed.searchParams.delete("dl");
  }
  return parsed.toString();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
