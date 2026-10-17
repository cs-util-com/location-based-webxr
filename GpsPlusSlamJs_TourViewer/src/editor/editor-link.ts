/**
 * The editor opens a tour from its link (tour editor plan 2026-10-17-1816,
 * W1 step 5): the hosted zip is fetched whole through the viewer's own
 * transport (the framework's `openRemoteArchive`: the Drive proxy, the
 * transport cap, the refusal causes) and handed to the editor's one open
 * path as a File, so a linked tour is opened, checked and saved exactly as
 * a chosen file is.
 *
 * @see editor-link.ts.md
 */

import {
  OpenRemoteArchiveError,
  openRemoteArchive,
  type OpenedArchive,
  type OpenRemoteArchiveOptions,
} from "gps-plus-slam-app-framework/storage";

import { describeOpenError } from "../open-errors.js";
import { archiveFileName, readArchiveInSlices } from "../tour-session.js";

/** What the editor's link open needs of the transport; injected in tests. */
type OpenArchive = (
  url: string,
  options: Pick<OpenRemoteArchiveOptions, "corsProxyBaseUrl" | "warm">,
) => Promise<Pick<OpenedArchive, "size" | "source" | "dispose">>;

export interface FetchTourOptions {
  /** The site worker's Drive proxy (`drive-proxy-url.ts`). */
  readonly corsProxyBaseUrl?: string;
  /** The transport; the framework's `openRemoteArchive` by default. */
  readonly open?: OpenArchive;
  /** For the unit test; the page reads in the viewer's default slices. */
  readonly sliceBytes?: number;
}

/** Said for text that is not an http(s) link. */
export const NOT_A_LINK =
  "That is not a web link: paste the tour's link, starting with https://.";

/**
 * Fetch the tour at `link` as a zip File named after the link (`tour.zip`
 * when it carries no `.zip` name).
 *
 * @throws Error `NOT_A_LINK` for text that is not an http(s) URL, before
 *   any request; `OpenRemoteArchiveError` for a refused link; a read's own
 *   error. The download is stopped on every outcome.
 */
export async function fetchTourFile(
  link: string,
  options: FetchTourOptions = {},
): Promise<File> {
  const url = link.trim();
  if (!isWebLink(url)) throw new Error(NOT_A_LINK);
  const open: OpenArchive = options.open ?? openRemoteArchive;
  // No background download: the whole file is read once, right here.
  const archive = await open(url, {
    ...(options.corsProxyBaseUrl === undefined
      ? {}
      : { corsProxyBaseUrl: options.corsProxyBaseUrl }),
    warm: false,
  });
  try {
    const blob = await readArchiveInSlices(archive, options.sliceBytes);
    return new File([blob], archiveFileName(url), { type: "application/zip" });
  } finally {
    archive.dispose();
  }
}

/** The editor's sentence for a link that did not open: the viewer's words
 *  (`open-errors.ts`), except where those name the viewer's own button. */
export function linkOpenErrorText(err: unknown, link: string): string {
  if (err instanceof OpenRemoteArchiveError && err.rejectCause === "cors") {
    return (
      "The host refused the browser access (it blocks reads from other sites, or the connection dropped).\n" +
      "Download the file to this computer, then choose it above."
    );
  }
  return describeOpenError(err, link.trim());
}

function isWebLink(text: string): boolean {
  try {
    const parsed = new URL(text);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
