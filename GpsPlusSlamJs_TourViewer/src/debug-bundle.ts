/**
 * The debug bundle: the walk recording a tour was made from, in a zip of
 * its own, so the tour file people open does not carry it (debug captures
 * plan 2026-10-20-1159, M2 step 2, decision E2). It holds the recording's
 * own entries at their paths, `debug-bundle.json` naming the tour it was
 * saved from, and a note for a person. The editor reads one back to show
 * its debug camera captures; a plain Recorder zip reads as "a recording".
 *
 * @see debug-bundle.ts.md
 */

import {
  rebuildZipWithEntries,
  type DecompressionBudget,
  type ZipEntryInput,
} from "gps-plus-slam-app-framework/storage";

import { recordingEntryNames } from "./tour-read-set.js";
import { zipBlobEntryNames } from "./zip-blob.js";

/** The identity's entry, at the bundle's root. */
const IDENTITY_ENTRY = "debug-bundle.json";

/** The note for a person, at the bundle's root. */
const NOTE_ENTRY = "about-this-debug-data.txt";

/** The only format this module writes and reads. */
const FORMAT = 1;

/** The longest title or file name the identity carries, in code points. */
const MAX_TEXT_CHARS = 512;

/** The largest identity entry read: a written one is a few hundred bytes. */
const MAX_IDENTITY_BYTES = 16 * 1024;

/** A series id's shape: the signed list's alphabet (base64url). Looser in
 *  length than the list's 16-64, since the bundle only compares it. */
const SERIES_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** An instant as `Date.prototype.toISOString` writes it, years 0-9999. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The tour a bundle is saved from, or compared with. */
export interface DebugBundleTour {
  /** A listed tour's series id; null for an unlisted tour. */
  readonly seriesId: string | null;
  /** The tour's title (`tour.json`), if it has one. */
  readonly title: string | null | undefined;
  /** The tour file's name, if known. */
  readonly fileName: string | null | undefined;
}

/** What `debug-bundle.json` says, normalised: text trimmed, empty as null. */
export interface DebugBundleIdentity {
  readonly seriesId: string | null;
  readonly tour: string | null;
  readonly file: string | null;
  /** When it was written, as `toISOString` writes it. */
  readonly writtenAt: string;
}

/** What a bundle built from an archive's entry names holds. */
export interface DebugBundlePlan {
  /** The recording's entries, in archive order, at their own paths. */
  readonly keep: readonly string[];
  /** Every other entry of the source. */
  readonly remove: readonly string[];
  /** `debug-bundle.json` and the note, at the root. */
  readonly added: readonly ZipEntryInput[];
  readonly identity: DebugBundleIdentity;
}

export type DebugBundleBuilt =
  | {
      readonly kind: "built";
      readonly blob: Blob;
      /** `debugBundleFileName` of the tour's file name. */
      readonly filename: string;
      readonly identity: DebugBundleIdentity;
    }
  | { readonly kind: "refused"; readonly reason: string };

/** Why a file did not read as debug data. */
type DebugBundleRefusal =
  | "no-recording"
  | "ambiguous"
  | "too-large"
  | "unreadable"
  | "unknown-format"
  | "malformed";

export type DebugBundleRead =
  | { readonly kind: "bundle"; readonly identity: DebugBundleIdentity }
  /** A recording without an identity: a plain Recorder zip. */
  | { readonly kind: "recording" }
  | {
      readonly kind: "refused";
      readonly code: DebugBundleRefusal;
      readonly reason: string;
    };

/** A file that read as debug data: a bundle or a plain recording. */
export type DebugBundleFound = Exclude<DebugBundleRead, { kind: "refused" }>;

/** Whose debug data it is, as far as the file can tell. */
export type BundleMatch = "this-tour" | "other-tour" | "recording";

/** Said when the source carries no recording to save. */
const NO_RECORDING_TO_SAVE =
  "This tour carries no recording, so there is no debug data to save.";

const REFUSALS: Readonly<Record<DebugBundleRefusal, string>> = {
  "no-recording":
    "This file carries no recording: it is neither debug data nor a Recorder zip.",
  ambiguous: `This file carries more than one ${IDENTITY_ENTRY}, so it cannot say which tour it is from.`,
  "too-large": `Its ${IDENTITY_ENTRY} is larger than debug data ever writes.`,
  unreadable: `Its ${IDENTITY_ENTRY} could not be read.`,
  "unknown-format":
    "This debug data was written by a newer version of the Tour Viewer.",
  malformed: `Its ${IDENTITY_ENTRY} is not one the Tour Viewer writes.`,
};

function refused(code: DebugBundleRefusal): DebugBundleRead {
  return { kind: "refused", code, reason: REFUSALS[code] };
}

/** Text as the identity carries it: trimmed, empty as null, clipped to
 *  `MAX_TEXT_CHARS` code points (and trimmed again, so it is stable). */
function identityText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const clipped = [...value.trim()].slice(0, MAX_TEXT_CHARS).join("").trim();
  return clipped === "" ? null : clipped;
}

/** A series id the format carries (`SERIES_ID`). */
function isSeriesId(value: unknown): value is string {
  return typeof value === "string" && SERIES_ID.test(value);
}

/** An instant exactly as `toISOString` writes it, on a real day: a
 *  shape-valid `02-30` does not survive the round through `Date`. */
function isInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_INSTANT.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

/** The leading `./` some zip tools write, removed for comparing names. */
function withoutDotSlash(name: string): string {
  return name.startsWith("./") ? name.slice(2) : name;
}

/** The identity's entry wherever a bundle carries it: at the root, under
 *  `./`, or under the folder a re-zipped bundle adds. */
function isIdentityEntry(name: string): boolean {
  return name === IDENTITY_ENTRY || name.endsWith(`/${IDENTITY_ENTRY}`);
}

/**
 * The bundle's file name: the tour's, `.zip` dropped, with `-debug.zip`
 * (`castle.zip` gives `castle-debug.zip`, as the walk's file was
 * `castle-walk.zip`); `tour-debug.zip` for a tour without a usable name.
 */
export function debugBundleFileName(
  tourFileName: string | null | undefined,
): string {
  const base = (tourFileName ?? "")
    .trim()
    .replace(/\.zip$/i, "")
    .trim();
  return `${base === "" ? "tour" : base}-debug.zip`;
}

function noteText(identity: DebugBundleIdentity): string {
  const from =
    identity.file === null ? "a tour file" : `the tour file ${identity.file}`;
  const titled = identity.tour === null ? "" : ` (the tour "${identity.tour}")`;
  return [
    "This is the debug data of a tour: the recording of the walk it was made from - the GPS track, the depth the phone measured, the debug camera captures the phone took by itself, their camera poses and the point cloud.",
    `It was saved from ${from}${titled} at ${identity.writtenAt}, so that the tour file people open does not carry it.`,
    ...(identity.seriesId === null
      ? []
      : [`The tour's series: ${identity.seriesId}.`]),
    "The tour works without it. To see it again, add it to the tour in the tour editor.",
    "Keep this file to yourself: it shows where and when the walk was made.",
    "",
  ].join("\n");
}

/**
 * The bundle of an archive with these entry names, or null when it carries
 * no recording (no action stream, `recordingEntryNames`). Pure.
 *
 * @throws {RangeError} for a `seriesId` or `writtenAt` the format cannot
 *   carry: what the writer writes, the reader must read back.
 */
export function debugBundlePlan(
  entryNames: readonly string[],
  tour: DebugBundleTour,
  writtenAt: Date,
): DebugBundlePlan | null {
  if (tour.seriesId !== null && !isSeriesId(tour.seriesId)) {
    throw new RangeError(
      "debug bundle: the series id is not one a tour carries",
    );
  }
  const when = Number.isNaN(writtenAt.getTime()) ? "" : writtenAt.toISOString();
  if (!isInstant(when)) {
    throw new RangeError(
      "debug bundle: the time must be a date in years 0-9999",
    );
  }
  const keep = recordingEntryNames(entryNames);
  if (keep.length === 0) return null;
  const identity: DebugBundleIdentity = {
    seriesId: tour.seriesId,
    tour: identityText(tour.title),
    file: identityText(tour.fileName),
    writtenAt: when,
  };
  const kept = new Set(keep);
  // The identity and the note are written new, so a source that already
  // carries them (a bundle bundled again) has them replaced, not removed:
  // the rebuild refuses a path that is both removed and written.
  const written = new Set([IDENTITY_ENTRY, NOTE_ENTRY]);
  return {
    keep,
    remove: entryNames.filter(
      (name) => !kept.has(name) && !written.has(withoutDotSlash(name)),
    ),
    added: [
      {
        path: IDENTITY_ENTRY,
        data: `${JSON.stringify({ format: FORMAT, ...identity }, null, 2)}\n`,
      },
      { path: NOTE_ENTRY, data: noteText(identity) },
    ],
    identity,
  };
}

export interface BuildDebugBundleOptions {
  /** The allowance the source's entries are inflated under: the open
   *  session's when `source` is its untrusted archive. */
  readonly budget?: DecompressionBudget;
  /** The clock `writtenAt` is read from. */
  readonly now?: () => Date;
}

/**
 * The debug bundle of `source`, a whole tour or recording zip: its
 * recording entries byte for byte at their paths (a wrapped tour's folder
 * kept), plus the identity and the note. Refused, in words, when it
 * carries no recording.
 *
 * @throws what `zipBlobEntryNames` and `rebuildZipWithEntries` throw for
 *   bytes that are not a readable zip or pass a cap; the caller shows it.
 */
export async function buildDebugBundle(
  source: Blob,
  tour: DebugBundleTour,
  options: BuildDebugBundleOptions = {},
): Promise<DebugBundleBuilt> {
  const plan = debugBundlePlan(
    await zipBlobEntryNames(source),
    tour,
    (options.now ?? (() => new Date()))(),
  );
  if (plan === null) return { kind: "refused", reason: NO_RECORDING_TO_SAVE };
  const blob = await rebuildZipWithEntries(source, plan.added, {
    remove: plan.remove,
    ...(options.budget === undefined ? {} : { budget: options.budget }),
  });
  return {
    kind: "built",
    blob,
    filename: debugBundleFileName(tour.fileName),
    identity: plan.identity,
  };
}

/** A text field as read: null, or a string within the cap. */
function readText(
  value: unknown,
):
  { ok: true; value: string | null } | { ok: false; code: DebugBundleRefusal } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, code: "malformed" };
  if ([...value.trim()].length > MAX_TEXT_CHARS) {
    return { ok: false, code: "too-large" };
  }
  return { ok: true, value: identityText(value) };
}

/** The JSON object `text` holds, or null for anything else. */
function jsonObject(text: string): Record<string, unknown> | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

/** `debug-bundle.json`'s text, validated. */
function parseIdentity(text: string): DebugBundleRead {
  const record = jsonObject(text);
  if (record === null) return refused("malformed");
  if (record.format !== FORMAT) {
    return refused(
      typeof record.format === "number" ? "unknown-format" : "malformed",
    );
  }
  const { seriesId, writtenAt } = record;
  const present = "seriesId" in record && "tour" in record && "file" in record;
  if (
    !present ||
    !(seriesId === null || isSeriesId(seriesId)) ||
    !isInstant(writtenAt)
  ) {
    return refused("malformed");
  }
  const tour = readText(record.tour);
  if (!tour.ok) return refused(tour.code);
  const file = readText(record.file);
  if (!file.ok) return refused(file.code);
  return {
    kind: "bundle",
    identity: { seriesId, tour: tour.value, file: file.value, writtenAt },
  };
}

/**
 * What a file added as debug data is: a bundle and the tour it names, a
 * plain recording (an action stream, no `debug-bundle.json`), or a refusal
 * in words. Never throws: the file is untrusted, and `readEntry` failing
 * is a refusal too.
 */
export async function readDebugBundle(
  entryNames: readonly string[],
  readEntry: (name: string) => Promise<Blob>,
): Promise<DebugBundleRead> {
  if (recordingEntryNames(entryNames).length === 0) {
    return refused("no-recording");
  }
  const identities = entryNames.filter(isIdentityEntry);
  if (identities.length > 1) return refused("ambiguous");
  const [entry] = identities;
  if (entry === undefined) return { kind: "recording" };
  let text: string;
  try {
    const blob = await readEntry(entry);
    if (blob.size > MAX_IDENTITY_BYTES) return refused("too-large");
    text = await blob.text();
  } catch {
    return refused("unreadable");
  }
  return parseIdentity(text);
}

/**
 * Whether a bundle is this tour's (plan Q-C): a listed tour's on its series
 * id alone; an unlisted tour's unless its title AND its file name both
 * differ (a text neither side knows is no match). A plain recording is its
 * own case: "a recording, not saved from this tour".
 */
export function bundleMatchesTour(
  read: DebugBundleFound,
  tour: DebugBundleTour,
): BundleMatch {
  if (read.kind === "recording") return "recording";
  const { identity } = read;
  if (tour.seriesId !== null) {
    return identity.seriesId === tour.seriesId ? "this-tour" : "other-tour";
  }
  const title = identityText(tour.title);
  const file = identityText(tour.fileName);
  const same =
    (title !== null && title === identity.tour) ||
    (file !== null && file === identity.file);
  return same ? "this-tour" : "other-tour";
}
