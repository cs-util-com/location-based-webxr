/**
 * Plain-language messages for archive-open failures (flows plan M6: pulled
 * out of `main.ts` because three concerns - the open path, the image-plane
 * loader and the AR entry - all need the same wording, and the Drive-aware
 * branch carries a contract of its own).
 */

import type { TourManifestOlderFormatError } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { TourIntegrityError } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import {
  ArchiveLimitError,
  OpenRemoteArchiveError,
  type RangeProbeRejectCause,
} from "gps-plus-slam-app-framework/storage";

/** True for the URLs whose open failures are Drive's to explain: the share
 *  page, the raw download host, the site worker's proxy route, and the
 *  Drive API form a `googleDriveApiKey` normalises to. The finish step's
 *  Drive route reads it too, on the NORMALISED url, so every form a Drive
 *  link can take must be listed here (Drive replace plan §5 #9). */
export function isDriveUrl(url: string, base?: string): boolean {
  try {
    // The page's own URL resolves a relative proxy path; absolute URLs need
    // no base (and unit tests run without a `location`).
    const parsed = new URL(
      url,
      base ?? (typeof location === "undefined" ? undefined : location.href),
    );
    return (
      parsed.hostname === "drive.google.com" ||
      parsed.hostname === "drive.usercontent.google.com" ||
      parsed.pathname.endsWith("/api/drive-proxy") ||
      (parsed.hostname === "www.googleapis.com" &&
        parsed.pathname.startsWith("/drive/"))
    );
  } catch {
    return false;
  }
}

/** The label of the button under a "host blocks browsers" error: named in
 *  the advice text, so both read from here. */
export const OPEN_FILE_ADVICE_LABEL = "Open the downloaded file";

/**
 * Whether a failed open should offer "open the downloaded file" (tour kit
 * plan K0): only for a host that blocks browsers (`cors`). Offline, a
 * download is not possible either; a missing, broken or too-large file is
 * not fixed by downloading it.
 */
export function offersFileOpen(cause: string): boolean {
  return cause === "cors";
}

/** The first sentence for a host that blocks browsers (`cors`): every
 *  place that words that refusal starts with it - the viewer's error box,
 *  the editor's link open, the "You already have a tour?" box - and each
 *  adds the way around that its own page offers (M1 review #6). */
export const HOST_REFUSED_TEXT =
  "The host refused the browser access (it blocks reads from other sites, or the connection dropped).";

/** The causes whose sentence does not depend on the error or the link. */
const FIXED_TEXT: Partial<Record<RangeProbeRejectCause, string>> = {
  missing:
    "That file does not exist (the link may have expired or been deleted).",
  corrupt: "The file exists but is empty or not a readable archive.",
  // Reached only with no saved copy and the browser online (an offline
  // browser gets "offline"), so the likely cause is a host that blocks
  // other sites' reads - and the way around it is the file itself (tour
  // kit plan K0, K-D1).
  cors:
    `${HOST_REFUSED_TEXT}\n` +
    `Download the file to this device, then tap "${OPEN_FILE_ADVICE_LABEL}" below to open it here.\n` +
    "Note: Google Drive links go through the site's proxy automatically — for other hosts the file must allow cross-site reads.",
  offline:
    "This device is offline, and this tour is not saved on it. Connect to the internet and try again.",
};

/**
 * The sentence for a cause that needs neither the error nor the link
 * (`missing`, `corrupt`, `cors`, `offline`), or undefined. For a caller
 * that has only the outcome's cause, e.g. the "You already have a tour?"
 * box after step 2's check cleared the error box for a tolerated link.
 */
export function describeOpenCause(cause: string): string | undefined {
  return Object.hasOwn(FIXED_TEXT, cause)
    ? FIXED_TEXT[cause as RangeProbeRejectCause]
    : undefined;
}

/**
 * A tour that does not match its own list of contents (tour kit plan K1,
 * §4.2: "modified, do not trust"), in plain words, with the technical
 * detail after it. A list made by a newer app is not "modified": it cannot
 * be checked here, and updating the app is the way forward.
 */
export function describeIntegrityError(err: TourIntegrityError): string {
  if (err.kind === "newer-format") {
    return "This tour was made with a newer version of the app, so it cannot be checked here. Reload the page to update the app, then try again.";
  }
  return `This tour does not match its own list of contents, so it is not shown: it was changed after it was made or signed, or the file is damaged. Do not trust this copy - ask its author for a fresh link. (Detail: ${err.message}.)`;
}

/**
 * A tour in a format this app no longer opens, refused in plain words:
 * which format, and that it has to be made again (no converter exists).
 * `draftDeleted`: this device held unsaved changes for it, which the
 * refusal deleted - they had nothing left to be restored into - and the
 * same sentence says so.
 */
export function olderFormatRefusal(
  err: TourManifestOlderFormatError,
  draftDeleted: boolean,
): string {
  const lost = draftDeleted
    ? ", and its unsaved changes cannot be restored"
    : "";
  return `This tour is in an older format (version ${String(err.version)}) that this version of the app no longer opens; it has to be made again${lost}.`;
}

/** A visitor's words for a host that blocks reads: the download route
 *  (their only way in, K-D1) without the creator's hosting note, and who
 *  can fix the host (UI round 1, U1, review F11). */
const VISITOR_CORS_TEXT =
  "The tour's host refused this browser access.\n" +
  `Download the file to this device, then tap "${OPEN_FILE_ADVICE_LABEL}" below to open it here.\n` +
  "If that does not work, tell the person who put up the poster.";

export function describeOpenError(
  err: unknown,
  url?: string,
  audience: "creator" | "visitor" = "creator",
): string {
  if (err instanceof TourIntegrityError) return describeIntegrityError(err);
  if (err instanceof OpenRemoteArchiveError) {
    if (audience === "visitor" && err.rejectCause === "cors") {
      return VISITOR_CORS_TEXT;
    }
    const fixed = FIXED_TEXT[err.rejectCause];
    if (fixed !== undefined) return fixed;
    if (err.rejectCause === "too-large") {
      // The cap's own sentence when the transport carried it (it names the
      // limit); the bare cause otherwise.
      return err.cause instanceof ArchiveLimitError
        ? err.cause.message
        : "The file is too large to open here.";
    }
    // A Drive link refused with a non-404 (e.g. the proxy's 400 for a
    // malformed id, or Drive refusing a non-public file) would otherwise
    // read as the generic archive error and hide the actual cause
    // (drive-proxy plan Rev 2, review finding 12).
    if (url !== undefined && isDriveUrl(url)) {
      // The sharing settings are the creator's to fix (U1 milestone
      // review #10).
      if (audience === "visitor") {
        return "The tour's file on Google Drive could not be opened. Tell the person who put up the poster.";
      }
      return "Google Drive refused that file — check that the file is shared publicly (“Anyone with the link”) and the link carries a valid file id.";
    }
    return "That link cannot be opened as an archive.";
  }
  // A zip-bomb cap (tour kit plan K0) words itself in plain language.
  return err instanceof Error ? err.message : String(err);
}
