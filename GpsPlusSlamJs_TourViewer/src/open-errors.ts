/**
 * Plain-language messages for archive-open failures (flows plan M6: pulled
 * out of `main.ts` because three concerns - the open path, the image-plane
 * loader and the AR entry - all need the same wording, and the Drive-aware
 * branch carries a contract of its own).
 */

import { OpenRemoteArchiveError } from "gps-plus-slam-app-framework/storage";

/** True for the URLs whose open failures are Drive's to explain: the share
 *  page, the raw download host, and the site worker's proxy route. */
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
      parsed.pathname.endsWith("/api/drive-proxy")
    );
  } catch {
    return false;
  }
}

export function describeOpenError(err: unknown, url?: string): string {
  if (err instanceof OpenRemoteArchiveError) {
    switch (err.rejectCause) {
      case "missing":
        return "That file does not exist (the link may have expired or been deleted).";
      case "corrupt":
        return "The file exists but is empty or not a readable archive.";
      case "cors":
        return (
          "The host refused the browser access (network down, or the host blocks cross-site reads).\n" +
          "Note: Google Drive links go through the site's proxy automatically — for other hosts the file must allow cross-site reads."
        );
      default:
        // A Drive link refused with a non-404 (e.g. the proxy's 400 for a
        // malformed id, or Drive refusing a non-public file) would
        // otherwise read as the generic archive error and hide the actual
        // cause (drive-proxy plan Rev 2, review finding 12).
        if (url !== undefined && isDriveUrl(url)) {
          return "Google Drive refused that file — check that the file is shared publicly (“Anyone with the link”) and the link carries a valid file id.";
        }
        return "That link cannot be opened as an archive.";
    }
  }
  return err instanceof Error ? err.message : String(err);
}
