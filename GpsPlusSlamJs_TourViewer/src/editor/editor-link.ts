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

import { driveFileId } from "gps-plus-slam-app-framework/utils/drive-file-id";

import { HOST_REFUSED_TEXT, describeOpenError } from "../open-errors.js";
import {
  archiveFileName,
  readArchiveInSlices,
  zipNameOf,
} from "../tour-session.js";
import { undatedFileName } from "./editor-session.js";

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
    return new File([blob], fetchedFileName(url), {
      type: "application/zip",
    });
  } finally {
    archive.dispose();
  }
}

/** How many characters of a Drive file id a linked tour's name keeps:
 *  enough to tell two tours apart, short enough to read in a dialog. */
const DRIVE_ID_CHARS = 12;

/** The fallback name `archiveFileName` gives a link without a `.zip`
 *  name. */
const PLAIN_STAND_IN = "tour.zip";

/** The names `fetchedFileName` makes up for a link that names no file. */
const DRIVE_STAND_IN = new RegExp(
  `^tour-[A-Za-z0-9_-]{1,${String(DRIVE_ID_CHARS)}}\.zip$`,
);

/** The link's own `.zip` name; for a Drive link without one,
 *  `tour-<start of its file id>.zip` (r955 review #1: every Drive link
 *  suggested `tour.zip`, so a second one offered the first one's file);
 *  else `tour.zip`. */
function fetchedFileName(url: string): string {
  const named = archiveFileName(url);
  if (named !== PLAIN_STAND_IN) return named;
  const id = driveFileId(url);
  return id === null ? named : `tour-${id.slice(0, DRIVE_ID_CHARS)}.zip`;
}

/**
 * Whether `name` is shaped like a name `fetchTourFile` makes up for a link
 * that names no file (`tour-<start of a Drive id>.zip`, `tour.zip`): no
 * host knows it. A hosted file really called `tour.zip` matches too, and
 * is then said to be unknown rather than named - the safe side of the
 * guess.
 */
export function isLinkStandInName(name: string): boolean {
  return name === PLAIN_STAND_IN || DRIVE_STAND_IN.test(name);
}

/**
 * The name of the file at the tour's link, for Done's words
 * (`DoneFacts.hostedName`). `linkHosted`: what `linkHostedName` gave in
 * this session (a name, null for a link that names none), undefined when
 * the tour was not opened from a link in this session. Without it, a
 * dated save (`datedFileName`; a reopened save, a draft restored after a
 * reload) is undated - unless that gives a stand-in
 * (`isLinkStandInName`) or `sampleName`, which no host knows: null then.
 * Undefined: neither a link nor a dated save. Pure.
 */
export function doneHostedName(
  savedName: string,
  context: {
    readonly linkHosted: string | null | undefined;
    readonly sampleName: string;
  },
): string | null | undefined {
  if (context.linkHosted !== undefined) return context.linkHosted;
  const undated = undatedFileName(savedName);
  if (undated === savedName) return undefined;
  return undated === context.sampleName || isLinkStandInName(undated)
    ? null
    : undated;
}

/**
 * The name the file fetched from `link` will carry (`fetchTourFile`),
 * worked out from the link alone, before any request: the save dialog
 * asked for in the open's click suggests it. Null for text that is not an
 * http(s) link (the open refuses it, and nothing is asked).
 */
export function linkFileName(link: string): string | null {
  const url = link.trim();
  return isWebLink(url) ? fetchedFileName(url) : null;
}

/**
 * The name of the file the link points to, as the host keeps it: the
 * link's own `.zip` name (the trimmed link's). Null for text that is not
 * an http(s) link, and for a link that names no file (a Drive link by its
 * id): `linkFileName`'s stand-in is no name the host knows.
 */
export function linkHostedName(link: string): string | null {
  const url = link.trim();
  return isWebLink(url) ? zipNameOf(url) : null;
}

/** The editor's sentence for a link that did not open: the viewer's words
 *  (`open-errors.ts`), except where those name the viewer's own button. */
export function linkOpenErrorText(err: unknown, link: string): string {
  if (err instanceof OpenRemoteArchiveError && err.rejectCause === "cors") {
    return `${HOST_REFUSED_TEXT}\nDownload the file to this computer, then choose it above.`;
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
