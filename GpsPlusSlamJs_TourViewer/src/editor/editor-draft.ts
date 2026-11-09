/**
 * The desktop editor's draft (M6 E2c): the edits since the opened file,
 * kept in this browser so a closed tab, a crash or a file that can no
 * longer be read does not lose them. The phone's records and rules
 * (`draft-persistence.ts`, `authoring-draft.ts`) under the editor's own
 * namespace, one tab at a time (a Web Lock on the draft key), and the
 * offer the next open of the same tour makes.
 *
 * WHAT THE DRAFT HOLDS, AND WHEN IT CLEARS (the E2c plan review #2). Every
 * edit since the OPENED FILE - not since the last save. Only an in-place
 * write that LANDED clears what it wrote (the file then carries it), or a
 * later open that finds the content in the file. A download clears
 * nothing: "the browser started the download" is all a page can know
 * (Firefox and Safari always say so), and whether the creator ever puts
 * the copy in place is never known. A build adds its versions to each
 * record's `written` list instead, so the copy put in place and reopened
 * still offers what came after it.
 *
 * WHY TWO BASE LISTS, NOT ONE (review #1, the E2p re-review's lesson). A
 * record is offered back only when the file's version of its object is
 * one this browser SAW in a file it opened or WROTE in a save; a version in
 * neither was made elsewhere, and the record is not offered (the file
 * wins, owner question Q-E2-2's default). One base per object loses work
 * in two ordinary walks: an in-place save and then an edit, and a save
 * built but never put in place. A deletion has no base: a restored
 * deletion deletes a newer edit made elsewhere (named, not covered).
 *
 * THE KEY (review #5, #6). The namespace is `editor:<file key>`
 * (`tour-file-key.ts`), never the phone's namespace for the same file. It
 * moves only after an in-place write that landed, to the key of the bytes
 * written (computed in the save path); the switch is synchronous, so every
 * later write goes to the new namespace, and the old one is emptied behind
 * its own queued writes. The draft key is also the Web Lock's: only the
 * tab holding it writes, and any other tab says it keeps no backup.
 *
 * THE SETTINGS (QR-first M1b-2). The tour-level settings the editor changes
 * - "needs no GPS" and, since W2 of the tour editor plan, the tour's
 * details (name, description, cover, contact) - are ONE record (`settings`) beside the
 * objects', by the same rules: kept while the file on disk does not carry
 * it (or a build wrote the other value, the "built but never put in place"
 * walk), offered by a later open whose file does not carry it, spent by one
 * that does, carried along by a key move, and thrown away by "Delete it"
 * unless changed since the open. The value last set here is kept, and the
 * keep is decided again whenever a build or a landed write changes what
 * it is measured against (M1b-2 milestone review #1: a setting turned
 * back while a save builds). No base, deliberately: a file that differs
 * from the record holds the other value, and this browser cannot tell
 * whether it saw or wrote that value or a colleague made it since - so
 * the offer NAMES the setting and its value (milestone review #3), and the
 * creator decides. Not covered, named: Restore of an offered setting can
 * undo a colleague's newer change of it when the creator does not notice
 * the named value; a version base for one boolean was declined as heavier
 * than that risk.
 *
 * Files brought in (a voice, a picture, a model). Each is written as
 * `asset:<id>` with the list of them (`assets`) BEFORE the record naming
 * it, so a reload never offers a record whose file is lost; a record that
 * names a file held nowhere is not offered (said: `unreadDraft`). Kept
 * while the file on disk does not list them, carried by a key move, gone
 * with the offer on "Delete it" unless brought in again since the open.
 *
 * @see editor-draft.ts.md
 */

import { tourStories } from "gps-plus-slam-app-framework/ar/tour-story";
import { AUTHOR_DEFAULT_SIZE_M } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type {
  TourAsset,
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourMediaTypeOf } from "gps-plus-slam-app-framework/ar/tour-media";
import { tourBlockAssetIds } from "gps-plus-slam-app-framework/ar/tour-kinds";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import { tourImageIds } from "gps-plus-slam-app-framework/ar/tour-details";
import {
  draftDeletionsNotYetHosted,
  draftObjectsNotYetHosted,
  draftObjectsSuperseded,
  hostedObjects,
  manifestAsRead,
  restoreOfferText,
  supersededLine,
  withBaseKey,
  type DraftBase,
} from "../authoring-draft.js";
import type { DraftObjectWrites } from "../draft-actions.js";
import {
  DETAIL_FIELDS,
  detailsOf,
  type TourDetailFields,
} from "../tour-details-form.js";
import {
  addDraftBaseKey,
  META_KEY,
  readDraft,
  removeDraftDeletion,
  removeDraftObject,
  writeDraftBase,
  writeDraftDeletion,
  writeDraftLiveRecord,
  writeDraftMeta,
  discardOlderFormatDraft,
  isOlderVersionDraft,
} from "../draft-persistence.js";
import { createKeyedChain } from "gps-plus-slam-app-framework/utils/keyed-chain";
import { isTourContentKey } from "../tour-file-key.js";
import type { EditorLock } from "./save-target.js";
import {
  framesOf,
  objectAssetsHeld,
  sameBeyondPose,
  type StationFrame,
  type StationPose,
} from "../tour-document.js";
import { sameJson } from "../same-json.js";
import {
  changedStations,
  parseSettingsRecord,
  settingsRecordText,
  SETTINGS_KEY,
  withFiledNarration,
} from "../tour-document-draft.js";

/** The tour-level settings the editor changes (QR-first M1b-2): what the
 *  draft's settings record holds. */
export interface EditorTourSettings {
  readonly needsNoGps: boolean;
  /** The tour's details as they stand (W2). Absent in a record written
   *  before the details existed, or before any was changed: no opinion
   *  about them, so it never offers to change (or blank) them. */
  readonly details?: TourDetailFields;
  /** Every station's pose (D17), once a frame was moved here: a moved
   *  station comes back with its items (the r875 milestone review #1).
   *  Absent: no opinion about them. A pose for a station the file does not
   *  carry is no change. */
  readonly stations?: readonly StationPose[];
  /** The whole frames of the stations the page created ("Move to a new
   *  station" starts one): the draft's objects name them, so a restore
   *  puts them back first. Not a change of their own. */
  readonly createdStations?: readonly StationFrame[];
  /** Once a station was edited beyond its pose here (renamed, added,
   *  deleted, reordered, copied), the stations edited beyond their pose or
   *  added here, whole: each comes back as recorded, at the opened file's
   *  pose when the file carries it. Absent: no opinion about them. */
  readonly frames?: readonly StationFrame[];
  /** The stations' order, when the record orders them (`recordedOrder`). */
  readonly order?: readonly string[];
  /** The stations of the file the record deleted. */
  readonly deletedStations?: readonly string[];
  /** The stations added by hand there (untitled and empty, each keeps
   *  itself). */
  readonly handMadeStations?: readonly string[];
}

/** One of the details' fields (`tour-details-form.ts`), in the order the
 *  offer names them. */
type DetailField = (typeof DETAIL_FIELDS)[number];

/** Each field as the page names it (`edit.html`'s "Tour details"). */
const DETAIL_NAMES: Readonly<Record<DetailField, string>> = {
  title: "name",
  description: "description",
  cover: "cover",
  contact: "contact",
};

/** The fields `wanted` changes against `against`; none for a record
 *  without details (no opinion). */
function changedDetails(
  wanted: TourDetailFields | undefined,
  against: TourDetailFields | undefined,
): DetailField[] {
  if (wanted === undefined) return [];
  return DETAIL_FIELDS.filter((f) => wanted[f] !== against?.[f]);
}

/** What a record's whole frames change against `against`'s: the stations
 *  edited beyond their pose (a pose is `stations`' to name), the stations
 *  it adds that carry the creator's own work (a station a placement
 *  started is no change of its own: `addsStations`), the stations of
 *  `against` it deletes, and whether it orders the shared ones anew. None
 *  for a record without frames. */
interface FrameChanges {
  readonly edited: readonly string[];
  readonly added: readonly string[];
  readonly deleted: readonly string[];
  readonly reordered: boolean;
}

const NO_FRAME_CHANGES: FrameChanges = {
  edited: [],
  added: [],
  deleted: [],
  reordered: false,
};

function changedFrames(
  wanted: EditorTourSettings,
  against: EditorTourSettings,
): FrameChanges {
  if (wanted.frames === undefined) return NO_FRAME_CHANGES;
  const theirs = new Map((against.frames ?? []).map((f) => [f.id, f]));
  const edited = wanted.frames
    .filter((f) => {
      const other = theirs.get(f.id);
      return other !== undefined && !sameBeyondPose(other, f);
    })
    .map((f) => f.id);
  const added = wanted.frames
    .filter(
      (f) =>
        !theirs.has(f.id) &&
        (f.title !== undefined ||
          tourStories(f).length > 0 ||
          f.description !== undefined ||
          f.image !== undefined),
    )
    .map((f) => f.id);
  const deleted = (wanted.deletedStations ?? []).filter((id) => theirs.has(id));
  const order = wanted.order ?? [];
  const ordered = new Set(order);
  const shared = order.filter((id) => theirs.has(id));
  const sharedTheirs = [...theirs.keys()].filter((id) => ordered.has(id));
  return {
    edited,
    added,
    deleted,
    reordered: shared.some((id, i) => id !== sharedTheirs[i]),
  };
}

/** The items an offered record moves between a story and the free items:
 *  the story entries of each station whose frame it edits, in its frame or
 *  in the file's. Such an item's object record (out of a story) or
 *  tombstone (into one) is part of that frame's change, counted there and
 *  never as a change or a deletion of its own. */
function movedIds(
  settings: EditorTourSettings | undefined,
  manifest: TourManifest,
): ReadonlySet<string> {
  if (settings === undefined) return new Set();
  const edited = new Set(changedFrames(settings, settingsOf(manifest)).edited);
  const entries = (frames: readonly StationFrame[]) =>
    frames
      .filter((f) => edited.has(f.id))
      .flatMap((f) =>
        tourStories(f).flatMap((s) => s.children.map((c) => c.id)),
      );
  return new Set([
    ...entries(settings.frames ?? []),
    ...entries(settingsOf(manifest).frames ?? []),
  ]);
}

/** How many changes a record's frames count as. */
function frameChangeCount(changes: FrameChanges): number {
  return (
    changes.edited.length +
    changes.added.length +
    changes.deleted.length +
    (changes.reordered ? 1 : 0)
  );
}

/** Whether `wanted` changes a setting, a detail, a station's pose or a
 *  station beyond its pose that `against` holds: what the offer names. */
function changesSettings(
  wanted: EditorTourSettings,
  against: EditorTourSettings,
): boolean {
  return (
    wanted.needsNoGps !== against.needsNoGps ||
    changedDetails(wanted.details, against.details).length > 0 ||
    changedStations(wanted.stations, against.stations).length > 0 ||
    frameChangeCount(changedFrames(wanted, against)) > 0
  );
}

/** Whether `wanted` holds a station the page created that `against` does
 *  not carry: the draft's notes name it, so the record is work to keep
 *  (whole, its pose as it stands) even when nothing else changed. */
function addsStations(
  wanted: EditorTourSettings,
  against: EditorTourSettings,
): boolean {
  const carried = new Set((against.stations ?? []).map((s) => s.id));
  return (wanted.createdStations ?? []).some((f) => !carried.has(f.id));
}

/** Whether `wanted` holds anything `against` lacks. */
function differs(
  wanted: EditorTourSettings,
  against: EditorTourSettings,
): boolean {
  return changesSettings(wanted, against) || addsStations(wanted, against);
}

/** Two records alike (null is "no record"). */
function sameRecord(
  a: EditorTourSettings | null,
  b: EditorTourSettings | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.needsNoGps !== b.needsNoGps) return false;
  if ((a.details === undefined) !== (b.details === undefined)) return false;
  const stationsAlike = (
    [
      "stations",
      "createdStations",
      "frames",
      "order",
      "deletedStations",
      "handMadeStations",
    ] as const
  ).every((key) => sameJson(a[key], b[key]));
  return stationsAlike && changedDetails(a.details, b.details).length === 0;
}

/** The setting's name as the page shows it (`edit.html`). */
const NO_GPS_LABEL = '"This tour needs no GPS"';

/** How the offer names its settings part: the setting, the details, or
 *  both (`restoredLine`). */
const NO_GPS_WHAT = `this tour's "needs no GPS" setting`;
const DETAILS_WHAT = "this tour's details";
const BOTH_WHAT = "this tour's settings";
const STATIONS_WHAT = "this tour's station positions";
const FRAMES_WHAT = "this tour's stations";

/** What an offered record changes against the opened file: whether the
 *  setting, and which details. */
function settingsChanges(
  settings: EditorTourSettings,
  manifest: TourManifest,
): {
  readonly noGps: boolean;
  readonly details: DetailField[];
  readonly stations: string[];
  readonly frames: FrameChanges;
} {
  const file = settingsOf(manifest);
  return {
    noGps: settings.needsNoGps !== file.needsNoGps,
    details: changedDetails(settings.details, file.details),
    stations: changedStations(settings.stations, file.stations),
    frames: changedFrames(settings, file),
  };
}

/**
 * The offer's words (`restoreOfferText`), and - when it holds settings -
 * which and to what (M1b-2 milestone review #3; W2 names the details by
 * field): Restore then never puts a value back the creator did not see
 * named. Each changed detail counts as one change, as the session counts
 * it.
 */
function offerText(
  notes: number,
  deleted: number,
  settings: EditorTourSettings | undefined,
  manifest: TourManifest,
): string {
  const changes = namedChanges(settings, manifest);
  const counted = restoreOfferText(0, false, {
    changed: notes + (changes === null ? 0 : settingsChangeCount(changes)),
    deleted,
  });
  if (settings === undefined || changes === null) return counted;
  const noGps = `${NO_GPS_LABEL} turned ${settings.needsNoGps ? "on" : "off"}`;
  if (
    changes.details.length === 0 &&
    changes.stations.length === 0 &&
    frameChangeCount(changes.frames) === 0
  ) {
    return notes + deleted === 0
      ? `${counted} It is ${noGps}.`
      : `${counted} One of the changes is ${noGps}.`;
  }
  const parts = settingsParts(changes, noGps);
  const last = parts.pop();
  const named = parts.length === 0 ? last : `${parts.join(", ")}, and ${last}`;
  return `${counted} Changed: ${named}.`;
}

type SettingsChanges = ReturnType<typeof settingsChanges>;

/** What an offered record changes that the offer names; null without a
 *  record, or for one holding only stations the page created (not a
 *  change of their own). */
function namedChanges(
  settings: EditorTourSettings | undefined,
  manifest: TourManifest,
): SettingsChanges | null {
  if (settings === undefined) return null;
  const changes = settingsChanges(settings, manifest);
  return settingsChangeCount(changes) === 0 ? null : changes;
}

/** How many changes a settings record counts as: the setting, each detail
 *  and each station one. */
function settingsChangeCount(changes: SettingsChanges): number {
  return (
    (changes.noGps ? 1 : 0) +
    changes.details.length +
    changes.stations.length +
    frameChangeCount(changes.frames)
  );
}

/** "a station" or "3 stations". */
function stationsWord(count: number): string {
  return count === 1 ? "a station" : `${String(count)} stations`;
}

/** The offer's named parts of a settings record, in the page's order. */
function settingsParts(changes: SettingsChanges, noGps: string): string[] {
  const parts: string[] = [];
  if (changes.noGps) parts.push(noGps);
  if (changes.details.length > 0) {
    const names = changes.details.map((f) => DETAIL_NAMES[f]).join(", ");
    parts.push(`the tour's details (${names})`);
  }
  if (changes.stations.length === 1) parts.push("the position of a station");
  if (changes.stations.length > 1) {
    parts.push(`the positions of ${String(changes.stations.length)} stations`);
  }
  const { edited, added, deleted, reordered } = changes.frames;
  if (edited.length > 0) {
    parts.push(
      `the details of ${edited.length === 1 ? "a station" : `${String(edited.length)} stations`}`,
    );
  }
  if (added.length > 0) parts.push(`${stationsWord(added.length)} added`);
  if (deleted.length > 0) parts.push(`${stationsWord(deleted.length)} deleted`);
  if (reordered) parts.push("the order of the stations");
  return parts;
}

/** `settingsWhat` of an offer that holds `settings`; undefined when it
 *  names nothing (only stations the page created). */
function settingsWhatOf(
  settings: EditorTourSettings,
  manifest: TourManifest,
): string | undefined {
  const changes = settingsChanges(settings, manifest);
  const frames = frameChangeCount(changes.frames) > 0;
  const kinds = [
    changes.noGps,
    changes.details.length > 0,
    changes.stations.length > 0 || frames,
  ].filter(Boolean).length;
  if (kinds > 1) return BOTH_WHAT;
  if (changes.details.length > 0) return DETAILS_WHAT;
  if (frames) return FRAMES_WHAT;
  if (changes.stations.length > 0) return STATIONS_WHAT;
  return changes.noGps ? NO_GPS_WHAT : undefined;
}

/**
 * Said once an offer was restored: what came back, or - when nothing did,
 * live work having won - why, in the offer's own terms (M1b-2 milestone
 * review #6).
 */
export function restoredLine(
  count: number,
  offer: Pick<
    EditorDraftOffer,
    "objects" | "deleted" | "settings" | "settingsWhat"
  >,
): string {
  if (count > 0) {
    const back =
      count === 1
        ? "1 earlier change is"
        : `${String(count)} earlier changes are`;
    return `${back} back - not saved yet.`;
  }
  const what = offer.settings === undefined ? undefined : offer.settingsWhat;
  if (what === undefined) {
    return "Nothing was restored: the notes those changes were for are edited here already.";
  }
  if (offer.objects.length + offer.deleted.length === 0) {
    return `Nothing was restored: ${what} ${what === NO_GPS_WHAT ? "is" : "are"} changed here already.`;
  }
  const part =
    what === NO_GPS_WHAT
      ? "the setting"
      : what === DETAILS_WHAT
        ? "the details"
        : what === STATIONS_WHAT
          ? "the station positions"
          : what === FRAMES_WHAT
            ? "the stations"
            : "the settings";
  return `Nothing was restored: the notes and ${part} those changes were for are changed here already.`;
}

/**
 * `settings` as measured against `manifest`: a cover naming no image of
 * that file (a deleted photo) is no opinion about the cover - the file's
 * own stands - since no save could write it (M4a review #1: the record
 * kept the deleted photo's cover, and every later open offered a cover
 * change that Restore could not make).
 */
function heldAgainst(
  settings: EditorTourSettings,
  manifest: TourManifest,
): EditorTourSettings {
  const details = settings.details;
  const cover = details?.cover;
  if (details === undefined || cover === undefined) return settings;
  // A captured photo's image is an asset of the tour since version 4.
  const images = tourImageIds({ objects: [], assets: manifest.assets });
  if (images.has(cover)) return settings;
  const { cover: _gone, ...rest } = details;
  return {
    ...settings,
    details:
      manifest.cover === undefined ? rest : { ...rest, cover: manifest.cover },
  };
}

function settingsOf(manifest: TourManifest): EditorTourSettings {
  return {
    needsNoGps: manifest.needsNoGps === true,
    details: detailsOf(manifest),
    stations: manifest.stations.map(({ id, geo }) => ({ id, geo })),
    frames: framesOf(manifest),
  };
}

/** Every editor draft's namespace starts with this; the phone's never do
 *  (a link, or a file key, `tour-file-key.ts`). */
const EDITOR_DRAFT_PREFIX = "editor:";

/** A file brought in: its bytes under `asset:<id>`, the list of them
 *  under `assets`. */
const ASSET_PREFIX = "asset:";
const ASSETS_KEY = "assets";

/** A file the draft holds, with its bytes. After a smaller file replaced
 *  it (`swapAsset`), `original` is the record it replaced, with that
 *  record's bytes while this draft keeps them (a file brought in; an asset
 *  of the file on disk has its original there, so none). The two records
 *  may share a path (a smaller file of the same format, or the original
 *  handed back for an asset of the file on disk): the bytes tell them
 *  apart, never the path. */
interface DraftFile {
  readonly asset: TourAsset;
  readonly blob: Blob;
  readonly original?: { readonly asset: TourAsset; readonly blob?: Blob };
  /** A plain file the creator set back from its smaller file ("use the
   *  original"): a reload puts it on the shelf as that choice left it,
   *  never queued to be made smaller again. */
  readonly originalChosen?: true;
}

/** Where `file`'s own bytes are kept: `asset:<id>` for a plain file,
 *  `asset:<id>.<ext>` for a smaller one, so the original's bytes stay
 *  readable under `asset:<id>` until a save that wrote the new file
 *  landed. */
function bytesKey(file: DraftFile): string {
  const { id, path } = file.asset;
  if (file.original === undefined) return `${ASSET_PREFIX}${id}`;
  return `${ASSET_PREFIX}${id}.${path.slice(path.lastIndexOf(".") + 1)}`;
}

/** Every key `file` uses: its own bytes, and its original's when kept. */
function keysOf(file: DraftFile): string[] {
  const own = bytesKey(file);
  return file.original?.blob === undefined
    ? [own]
    : [own, `${ASSET_PREFIX}${file.asset.id}`];
}

/** `file` as the `assets` list names it: a plain record, or one with the
 *  record it replaced and whether its bytes are kept. */
function listItem(file: DraftFile): unknown {
  if (file.original === undefined) {
    return file.originalChosen === true
      ? { ...file.asset, originalChosen: true }
      : file.asset;
  }
  return {
    ...file.asset,
    original: file.original.asset,
    originalKept: file.original.blob !== undefined,
  };
}

/** A record the format takes: its path `content/<id>.<ext>` of an
 *  extension of its kind. */
function readsAsAsset(item: unknown): item is TourAsset {
  const a = item as Partial<Record<keyof TourAsset, unknown>> | null;
  if (
    typeof a?.id !== "string" ||
    typeof a.path !== "string" ||
    typeof a.kind !== "string"
  ) {
    return false;
  }
  const ext = a.path.slice(a.path.lastIndexOf(".") + 1);
  return (
    a.path === `content/${a.id}.${ext}` && tourMediaTypeOf(ext)?.kind === a.kind
  );
}

/** One entry of the `assets` list as read. */
interface ListedFile {
  readonly asset: TourAsset;
  readonly original?: TourAsset;
  readonly originalKept: boolean;
  readonly originalChosen?: true;
}

/** The `assets` list as written, each record one the format takes, and a
 *  replaced record of the same id; null when it does not read. */
function assetListOf(text: string | undefined): ListedFile[] | null {
  if (text === undefined) return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const listed: ListedFile[] = [];
  for (const item of data as unknown[]) {
    if (!readsAsAsset(item)) return null;
    const { original, originalKept, originalChosen, ...asset } =
      item as TourAsset & {
        readonly original?: unknown;
        readonly originalKept?: unknown;
        readonly originalChosen?: unknown;
      };
    if (original === undefined && originalKept === undefined) {
      if (originalChosen !== undefined && originalChosen !== true) return null;
      listed.push({
        asset,
        originalKept: false,
        ...(originalChosen === true ? { originalChosen: true as const } : {}),
      });
      continue;
    }
    if (
      originalChosen !== undefined ||
      !readsAsAsset(original) ||
      original.id !== asset.id ||
      typeof originalKept !== "boolean"
    ) {
      return null;
    }
    listed.push({ asset, original, originalKept });
  }
  return listed;
}

/** The editor's draft namespace (and Web Lock key) for a file key. */
export function editorDraftKey(fileKey: string): string {
  return `${EDITOR_DRAFT_PREFIX}${fileKey}`;
}

/** Where `supersededLine` says the replaced changes were kept. */
const SUPERSEDED_WHERE = "in this browser";

/** Why this page keeps no backup copy: no storage (or a write that did
 *  not land), or another tab holds this tour's draft. */
export type NoBackupReason = "storage" | "other-tab";

export interface EditorDraftDeps {
  /** Open a draft namespace (`draft-store-root.ts`); undefined without
   *  persistence. */
  readonly openStore: (key: string) => Promise<DraftFileStore | undefined>;
  /** Hold the draft key for this tab (`holdEditorDraftLock`). */
  readonly holdLock: (key: string) => Promise<EditorLock>;
  /** Said once per opened tour: this page keeps no backup copy. */
  readonly noBackup: (reason: NoBackupReason) => void;
  /** Part of the opened tour's settings record did not read. */
  readonly unreadDraft?: () => void;
  /** Writes started (true) or all settled (false): the page's readiness
   *  mark. */
  readonly onWriting?: (writing: boolean) => void;
}

/** What an earlier visit left, offered back. */
export interface EditorDraftOffer {
  /** Edited or moved objects the opened file carries in another version. */
  readonly objects: readonly TourObject[];
  /** Deleted ids the opened file still carries. */
  readonly deleted: readonly string[];
  /** The tour's settings, when the opened file does not carry the draft's
   *  (QR-first M1b-2). */
  readonly settings?: EditorTourSettings;
  /** The ids among `objects` the opened file lacks: copies made here,
   *  which a restore puts back though the tour does not carry them. */
  readonly made?: readonly string[];
  /** The pictures of the offered photos the opened file lacks (a copy
   *  made here), by id: a restore holds them for the save. */
  readonly pictures?: ReadonlyMap<string, Blob>;
  /** The files brought in there, with their bytes: a restore
   *  lists them again before the records naming them. */
  readonly files?: readonly DraftFile[];
  /** How the offer's settings part is named in plain words ("this tour's
   *  details"), present with `settings` unless they name nothing - a
   *  record holding only stations the page created (`restoredLine`). */
  readonly settingsWhat?: string;
  /** The offer's words: changes and deletions named apart
   *  (`restoreOfferText`); a changed setting, and each changed detail, is
   *  a change. */
  readonly text: string;
}

interface EditorDraftOpened {
  /** Null when there is nothing to offer. */
  readonly offer: EditorDraftOffer | null;
  /** Said once, when records gave way to newer edits in the file. */
  readonly superseded: string | null;
  /** This tab backs the edits up (it holds the draft, storage answered). */
  readonly backedUp: boolean;
}

/** The settings record's write (QR-first M1b-2). */
interface DraftSettingsWrites {
  /** The tour's settings as they stand now: kept while the file does not
   *  carry them, the record removed once it does. */
  saveSettings(settings: EditorTourSettings): Promise<boolean>;
}

/** The writes and a save's two notes for one opened tour (E2c review #6,
 *  the E2b-2 milestone review #1): once that tour closes or another opens,
 *  each is dropped, so a late write or save of the old tour never lands in
 *  the new tour's namespace, its seen versions or its key. */
export interface EditorTourDraft
  extends DraftObjectWrites, DraftSettingsWrites, DraftFileWrites {
  /** A save was built: its versions are this browser's own work. */
  built(written: TourManifest): void;
  /** An in-place write of `written` landed, whose bytes have `fileKey`:
   *  what it carries clears, and the draft follows the key. `wrote`: the
   *  bytes it wrote for each asset (`EditorSave.wrote`); a smaller file
   *  is spent only by a write of its own bytes, a plain file also by its
   *  path when the write wrote none for it. */
  landed(
    written: TourManifest,
    fileKey: string,
    wrote?: ReadonlyMap<string, Blob>,
  ): void;
  /** A download landed whose bytes have `fileKey` (debug-captures plan,
   *  Q-I: the first save of a tour without an id writes one): the draft
   *  follows the key, carrying everything - nothing is spent, and the old
   *  namespace keeps what it holds. A no-op for the key it has. */
  moved(fileKey: string): void;
}

/** The files' write. */
interface DraftFileWrites {
  /** A file brought in, with its bytes: written with the list before the
   *  record naming it; whether it landed. */
  saveAsset(asset: TourAsset, blob: Blob): Promise<boolean>;
  /** Whether a file brought in is held here: false once its write did not
   *  land, so no record names it (`draftableObject`). */
  holdsFile(id: string): boolean;
  /** A smaller file for an asset held here or by the file on disk, under
   *  the same id (`asset`: its new record): its bytes under a key of their
   *  own, then the list, then the keys only the previous entry used, so a
   *  crash between any two writes leaves every listed record with the
   *  bytes of its own path. Back to the original's record with the
   *  original's own bytes (the same Blob), the original stands again as a
   *  plain file; any other bytes are kept as a smaller file, also at the
   *  original's path - for an asset of the file on disk the bytes handed
   *  back are kept, since a save still running may land other bytes over
   *  that file. `blob` undefined: what stands without a smaller file (the
   *  file on disk's bytes: nothing held). False when it did not land, or
   *  for an id held nowhere. `originalChosen`: the creator's "use the
   *  original" - a file brought in that stands as its plain original
   *  again remembers it (`DraftFile.originalChosen`). */
  swapAsset(
    asset: TourAsset,
    blob: Blob | undefined,
    originalChosen?: boolean,
  ): Promise<boolean>;
  /** Whether the draft keeps the bytes a smaller file replaced ("use the
   *  original"): until a save that wrote the smaller file landed. */
  holdsOriginal(id: string): boolean;
}

export interface EditorDraft
  extends DraftObjectWrites, DraftSettingsWrites, DraftFileWrites {
  /** The writes, and a save's notes, for the tour open NOW: the session is
   *  given the writes, the page's save path the notes. */
  writes(): EditorTourDraft;
  /** A tour opened: hold its draft, read it, clear what the file carries,
   *  and say what to offer. Awaited before the tour shows. `sizeInFile`
   *  gives the size of an entry (by its path in the tour's folder) the
   *  opened file holds: a smaller file the file lists at its path is the
   *  file's own only when the sizes agree (a save by download wrote it),
   *  since the path alone does not say which bytes are there. Without it a
   *  smaller file is always kept. */
  open(
    fileKey: string,
    manifest: TourManifest,
    sizeInFile?: (path: string) => number | undefined,
  ): Promise<EditorDraftOpened>;
  /** The offer was restored (the session wrote what it applied). */
  restored(): void;
  /** "Delete it": the offer's records go, minus ids edited since the
   *  open; false when the rejection did not land (offered again). */
  discard(): Promise<boolean>;
  /** Whether this tab backs the open tour's edits up. */
  backsUp(): boolean;
  /** The tour closed: the hold goes. */
  close(): void;
  /** Every queued write settled. */
  idle(): Promise<void>;
  /**
   * The file `fileKey` was refused as an older format: its draft has
   * nothing left to be restored into, so its namespace is emptied, the
   * meta first (a reload midway finds no draft), under the draft's lock -
   * a tab editing it keeps it. True when a draft was there (its meta);
   * false for none, a lock another tab holds, or no persistence. Never
   * rejects.
   */
  forget(fileKey: string): Promise<boolean>;
}

/** The draft with the save notes `writes()` binds to one open. */
type DraftApi = EditorDraft &
  Pick<EditorTourDraft, "built" | "landed" | "moved">;

/** One namespace: its key, its store (after the lock), its rejections. */
interface Space {
  readonly key: string;
  readonly fileKey: string;
  store: Promise<DraftFileStore | undefined>;
  lock: EditorLock | null;
  /** Why `store` is undefined, once known. */
  refused: NoBackupReason | null;
  /** The ids the meta rejects ("Delete it"); a write of one claims it. */
  rejected: readonly string[];
  /** Every id the meta ON DISK rejects, until a meta write lands: the open
   *  prunes `rejected` to the ids that still have files, and a write of an
   *  id only the unpruned meta names is claimed too, or a pruning write
   *  that did not land would hide it (PR #622 bot finding A; the phone's
   *  `rejectedOnDisk`). */
  rejectedOnDisk: ReadonlySet<string>;
  /** Every id with files here: what a key move empties. */
  readonly ids: Set<string>;
  /** Its writes not yet settled: the hold goes only after them. */
  readonly work: Set<Promise<unknown>>;
}

export function createEditorDraft(deps: EditorDraftDeps): EditorDraft {
  const chain = createKeyedChain();
  let space: Space | null = null;
  /** The file as it is on disk now: the opened one, then each in-place
   *  write that landed - what an edit's `seen` version is read from. */
  let opened: TourManifest | null = null;
  /** Per id, this page's latest change since the opened file: the object,
   *  or null for a deletion. */
  const pending = new Map<string, TourObject | null>();
  /** Every id this page wrote since the open: live work, which wins over
   *  the offer and is never rejected with it. */
  const touched = new Set<string>();
  /** The bases as written (a mirror, for a key move). */
  const bases = new Map<string, DraftBase>();
  /** The offer, until restored or deleted ("Not now" keeps it). */
  let offer: {
    readonly objects: readonly TourObject[];
    readonly deleted: readonly string[];
    readonly settings?: EditorTourSettings;
    readonly pictures?: ReadonlyMap<string, Blob>;
    readonly files?: readonly DraftFile[];
  } | null = null;
  /** The files this draft holds for the open tour, as last
   *  written: a key move carries them. */
  const files = new Map<string, DraftFile>();
  /** The ids of the files brought in since the open: live work, kept on
   *  "Delete it". */
  const filesHere = new Set<string>();
  /** The files brought in whose write did not land. */
  const filesNotKept = new Set<string>();
  /** The pictures of the pending objects the opened file lacks (a copied
   *  photo), as last written: a key move carries them with the record. */
  const pendingPictures = new Map<string, Blob>();
  /** The settings record this page keeps (THE SETTINGS), or null. */
  let settingsPending: EditorTourSettings | null = null;
  /** The settings as last set here since the open, or null: live work,
   *  which wins over the offer and is never thrown away with it. Kept
   *  whether or not its record is, so a build or a landed write can decide
   *  the keep again (M1b-2 milestone review #1). */
  let settingsWanted: EditorTourSettings | null = null;
  /** The manifests builds wrote since the open (their settings, and the
   *  images a recorded cover is measured against): a change back to the
   *  file's value still differs from a built copy that may be put in
   *  place, so its record is kept (review #1's walk, for the settings). */
  const built: TourManifest[] = [];

  /** Whether `settings` must be kept: the file on disk differs, or a
   *  build wrote other values (THE SETTINGS). */
  function keepSettings(settings: EditorTourSettings): boolean {
    return (
      opened === null ||
      differs(heldAgainst(settings, opened), settingsOf(opened)) ||
      built.some((b) => differs(heldAgainst(settings, b), settingsOf(b)))
    );
  }

  /** The keep decided again for the value last set here, after a build or
   *  a landed write changed what it is measured against; whether the
   *  record must now be written (`settingsPending`) or removed (null). */
  function redecideSettings(): boolean {
    const wanted = settingsWanted;
    if (wanted === null) return false;
    const next = keepSettings(wanted) ? wanted : null;
    if (sameRecord(next, settingsPending)) return false;
    settingsPending = next;
    return true;
  }
  let told = false;
  let generation = 0;
  /** When the last tour's hold let go: the next open waits for it (the
   *  same file again in the same tab is not "another tab"). */
  let letGo: Promise<void> = Promise.resolve();
  let writing = 0;
  let waiters: (() => void)[] = [];

  /** Said once per opened tour, and only about the space the page writes
   *  now: a late failure of a closed tour's write does not use up the new
   *  tour's line (E2c review #6). */
  function say(s: Space, reason: NoBackupReason): void {
    if (s !== space || told) return;
    told = true;
    deps.noBackup(reason);
  }

  function track<T>(work: Promise<T>): Promise<T> {
    writing += 1;
    if (writing === 1) deps.onWriting?.(true);
    const settled = (): void => {
      writing -= 1;
      if (writing > 0) return;
      deps.onWriting?.(false);
      const done = waiters;
      waiters = [];
      for (const wake of done) wake();
    };
    work.then(settled, settled);
    return work;
  }

  async function forget(fileKey: string): Promise<boolean> {
    // A content key may be another tour's on the same recording.
    if (isTourContentKey(fileKey)) return false;
    const key = editorDraftKey(fileKey);
    const lock = await deps.holdLock(key).catch(() => null);
    if (lock === null || !lock.granted) return false;
    try {
      const store = await deps.openStore(key);
      if (store === undefined) return false;
      const keys = await store.keys();
      if (keys.length === 0) return false;
      // Only a draft proved to be an older version's: the same tour's
      // current copy shares this key.
      if (!(await isOlderVersionDraft(store))) return false;
      await store.clear(META_KEY);
      return keys.includes(META_KEY);
    } catch {
      return false;
    } finally {
      lock.release();
    }
  }

  function makeSpace(fileKey: string): Space {
    const key = editorDraftKey(fileKey);
    const made: Space = {
      key,
      fileKey,
      store: Promise.resolve(undefined),
      lock: null,
      refused: null,
      rejected: [],
      rejectedOnDisk: new Set(),
      ids: new Set(),
      work: new Set(),
    };
    made.store = (async () => {
      const lock = await deps.holdLock(key).catch(() => null);
      if (lock === null || !lock.granted) {
        made.refused = lock === null ? "storage" : "other-tab";
        return undefined;
      }
      made.lock = lock;
      const store = await deps.openStore(key).catch(() => undefined);
      if (store === undefined) made.refused = "storage";
      // Inside the space's own promise: every write of it waits for this.
      else await discardOlderFormatDraft(store);
      return store;
    })();
    return made;
  }

  function metaChain(s: Space): string {
    return JSON.stringify([s.key, "meta"]);
  }
  function objectChain(s: Space, id: string): string {
    return JSON.stringify([s.key, "object", id]);
  }
  function settingsChain(s: Space): string {
    return JSON.stringify([s.key, "settings"]);
  }
  function filesChain(s: Space): string {
    return JSON.stringify([s.key, "files"]);
  }

  /** The list of `files` as it stands now; null when it is empty. Taken
   *  when a write is queued, never when it runs: a later change's list
   *  may name bytes its own write has not put yet. */
  function listText(): string | null {
    return files.size === 0
      ? null
      : JSON.stringify([...files.values()].map(listItem));
  }

  /** A list taken by `listText` written into `store`. */
  function writeList(
    store: DraftFileStore,
    list: string | null,
  ): Promise<boolean> {
    return list === null
      ? store.remove(ASSETS_KEY).then(() => true)
      : store.put(ASSETS_KEY, list);
  }

  /** `file`'s bytes (its original's first, when kept), then the list,
   *  into `s`; whether all landed. A write that did not land is said,
   *  once. */
  function fileIn(s: Space, file: DraftFile): Promise<boolean> {
    const list = listText();
    const original = file.original?.blob;
    return inSpace(
      s,
      chain.run(filesChain(s), async () => {
        const store = await s.store;
        if (store === undefined) return false;
        if (
          original !== undefined &&
          !(await store.put(`${ASSET_PREFIX}${file.asset.id}`, original))
        ) {
          return false;
        }
        if (!(await store.put(bytesKey(file), file.blob))) return false;
        return writeList(store, list);
      }),
    )
      .catch(() => false)
      .then((ok) => {
        if (!ok) say(s, s.refused ?? "storage");
        return ok;
      });
  }

  /** `fileIn`, and `filesNotKept` told whether it landed - for the open
   *  it was asked in: a close forgets what it knew. */
  function keepFile(s: Space, file: DraftFile): Promise<boolean> {
    const mine = generation;
    return fileIn(s, file).then((ok) => {
      if (mine !== generation) return ok;
      if (ok) filesNotKept.delete(file.asset.id);
      else filesNotKept.add(file.asset.id);
      return ok;
    });
  }

  /** The offer's files: every one this draft holds (a write keeps only
   *  what the tour names). */
  function filesOffered(): { files?: readonly DraftFile[] } {
    return files.size === 0 ? {} : { files: [...files.values()] };
  }

  /** After an open: with nothing offered the files go; every `asset:`
   *  entry the list does not name goes, and the list is written as the
   *  mirror holds it. */
  function tidyFiles(s: Space): void {
    if (offer === null) files.clear();
    const named = new Set([...files.values()].flatMap(keysOf));
    const list = listText();
    void inSpace(
      s,
      chain.run(filesChain(s), async () => {
        const store = await s.store;
        if (store === undefined) return;
        for (const key of await store.keys()) {
          if (key.startsWith(ASSET_PREFIX) && !named.has(key)) {
            await store.remove(key);
          }
        }
        await writeList(store, list);
      }),
    ).catch(() => undefined);
  }

  /** The files `ids` taken out of the mirror and out of `s` with every
   *  key they use, the list first: a reload midway finds none it lists
   *  missing. */
  function dropFiles(s: Space, ids: readonly string[]): void {
    if (ids.length === 0) return;
    const keys = ids.flatMap((id) => {
      const file = files.get(id);
      return file === undefined ? [`${ASSET_PREFIX}${id}`] : keysOf(file);
    });
    for (const id of ids) files.delete(id);
    const list = listText();
    void inSpace(
      s,
      chain.run(filesChain(s), async () => {
        const store = await s.store;
        if (store === undefined) return;
        await writeList(store, list);
        for (const key of keys) await store.remove(key);
      }),
    ).catch(() => undefined);
  }

  /** `swapAsset`'s writes into `s`: `put` (the new bytes) first, then the
   *  list taken now, then the keys no longer used; whether all landed. */
  function swapIn(
    s: Space,
    put: { readonly key: string; readonly blob: Blob } | undefined,
    stale: readonly string[],
  ): Promise<boolean> {
    const list = listText();
    return inSpace(
      s,
      chain.run(filesChain(s), async () => {
        const store = await s.store;
        if (store === undefined) return false;
        if (put !== undefined && !(await store.put(put.key, put.blob))) {
          return false;
        }
        if (!(await writeList(store, list))) return false;
        for (const key of stale) await store.remove(key);
        return true;
      }),
    )
      .catch(() => false)
      .then((ok) => {
        if (!ok) say(s, s.refused ?? "storage");
        return ok;
      });
  }

  /** `s`'s settings record written (`value`) or removed (null), in its
   *  own queue; whether it landed. Not said: callers say what they ask. */
  function settingsIn(
    s: Space,
    value: EditorTourSettings | null,
    after?: Promise<unknown>,
  ): Promise<boolean> {
    return inSpace(
      s,
      chain.run(settingsChain(s), async () => {
        await after;
        const store = await s.store;
        if (store === undefined) return false;
        if (value === null) {
          await store.remove(SETTINGS_KEY);
          return true;
        }
        return store.put(SETTINGS_KEY, settingsRecordText(value));
      }),
    ).catch(() => false);
  }

  /** `settingsIn`, and a write that did not land said, once. */
  function writeSettingsIn(
    s: Space,
    value: EditorTourSettings | null,
    after?: Promise<unknown>,
  ): Promise<boolean> {
    return settingsIn(s, value, after).then((ok) => {
      if (!ok) say(s, s.refused ?? "storage");
      return ok;
    });
  }

  /** The meta `readDraft` reads: the editor has no code to measure, so a
   *  default size, and no codes. Values captured now, written in order;
   *  counted among `s`'s writes, so a close lets the hold go only after it
   *  landed - "Delete it"'s commit point among them (PR #622 bot finding
   *  B). */
  function writeMeta(s: Space): Promise<boolean> {
    const rejected = s.rejected;
    const meta = {
      tourUrl: s.fileKey,
      sizeM: AUTHOR_DEFAULT_SIZE_M,
      rejected,
    };
    return inSpace(
      s,
      chain.run(metaChain(s), async () => {
        const store = await s.store;
        const ok = store !== undefined && (await writeDraftMeta(store, meta));
        if (ok) s.rejectedOnDisk = new Set(rejected);
        return ok;
      }),
    ).catch(() => false);
  }

  /** `work` counted for `idle` and for `s`'s hold. */
  function inSpace<T>(s: Space, work: Promise<T>): Promise<T> {
    s.work.add(work);
    const done = (): void => {
      s.work.delete(work);
    };
    work.then(done, done);
    return track(work);
  }

  /** Every write of `s` settled, those queued meanwhile too. */
  async function drained(s: Space): Promise<void> {
    while (s.work.size > 0) await Promise.allSettled([...s.work]);
  }

  /**
   * Run `task` for object `id` in `s`'s queue. An id the meta rejects is
   * CLAIMED first - its files removed, the meta rewritten without it - so
   * the change is newer than the rejection and the next read sees it (the
   * phone's `creator-draft.ts` rule, M4 review #1).
   */
  function inQueue(
    s: Space,
    id: string,
    task: (store: DraftFileStore) => Promise<boolean>,
  ): Promise<boolean> {
    s.ids.add(id);
    return inSpace(
      s,
      chain.run(objectChain(s, id), async () => {
        const store = await s.store;
        if (store === undefined) return false;
        let claimed = true;
        if (s.rejected.includes(id) || s.rejectedOnDisk.has(id)) {
          await removeDraftObject(store, id);
          s.rejected = s.rejected.filter((r) => r !== id);
          claimed = await writeMeta(s);
        }
        return (await task(store)) && claimed;
      }),
    ).catch(() => false);
  }

  /** `inQueue`, and a write that did not land said, once. */
  function writeIn(
    s: Space,
    id: string,
    task: (store: DraftFileStore) => Promise<boolean>,
  ): Promise<boolean> {
    return inQueue(s, id, task).then((ok) => {
      if (!ok) say(s, s.refused ?? "storage");
      return ok;
    });
  }

  /** A write the page asked for, in the open tour's namespace. True with
   *  no tour open: there is nothing to back up. */
  function write(
    id: string,
    task: (store: DraftFileStore) => Promise<boolean>,
  ): Promise<boolean> {
    const s = space;
    return s === null ? Promise.resolve(true) : writeIn(s, id, task);
  }

  function removeIn(s: Space, id: string): void {
    void inQueue(s, id, (store) =>
      removeDraftObject(store, id).then(() => true),
    );
  }

  /**
   * `id`'s change written into `s` with its base (a key move); whether it
   * landed. NOT a claim: an id "Delete it" rejected since the move is
   * skipped, never brought back (E2c review #5).
   */
  function carry(
    s: Space,
    id: string,
    change: TourObject | null,
    base: DraftBase | undefined,
    picture?: Blob,
    after?: Promise<unknown>,
  ): Promise<boolean> {
    s.ids.add(id);
    return inSpace(
      s,
      chain.run(objectChain(s, id), async () => {
        await after;
        if (s.rejected.includes(id)) return true;
        const store = await s.store;
        if (store === undefined) return false;
        // A live record, as `saveObject` writes it: the new key's namespace
        // may hold an older session's tombstone for this id.
        const wrote =
          change === null
            ? await writeDraftDeletion(store, id)
            : await writeDraftLiveRecord(store, change, picture, undefined);
        // After the record: a record without its base is never superseded.
        if (base !== undefined) await writeDraftBase(store, id, base);
        return wrote;
      }),
    )
      .catch(() => false)
      .then((ok) => {
        if (!ok) say(s, s.refused ?? "storage");
        return ok;
      });
  }

  /** The old namespace emptied behind its own queued writes, its meta
   *  last. Run only once everything it held landed in the new one. */
  async function empty(old: Space): Promise<void> {
    await Promise.all(
      [...old.ids].map((id) =>
        inSpace(
          old,
          chain.run(objectChain(old, id), async () => {
            const store = await old.store;
            if (store !== undefined) await removeDraftObject(store, id);
          }),
        ),
      ),
    );
    await settingsIn(old, null);
    await inSpace(
      old,
      chain.run(filesChain(old), async () => {
        const store = await old.store;
        if (store === undefined) return;
        for (const key of await store.keys()) {
          if (key === ASSETS_KEY || key.startsWith(ASSET_PREFIX)) {
            await store.remove(key);
          }
        }
      }),
    );
    await inSpace(
      old,
      chain.run(metaChain(old), async () => {
        const store = await old.store;
        if (store !== undefined) await store.remove(META_KEY);
      }),
    );
  }

  function seenKey(id: string): string | undefined {
    return hostedObjects(opened).key(id);
  }

  function close(): void {
    generation += 1;
    const s = space;
    space = null;
    opened = null;
    offer = null;
    pending.clear();
    pendingPictures.clear();
    files.clear();
    filesHere.clear();
    filesNotKept.clear();
    touched.clear();
    bases.clear();
    settingsPending = null;
    settingsWanted = null;
    built.length = 0;
    if (s === null) return;
    // After its queued writes (E2c review #6): until they land, another
    // tab taking the draft would read it half written. Chained on the last
    // hold's let-go, which a key move may still be running (PR #626 bot
    // finding 2).
    letGo = letGo
      .then(() => s.store)
      .then(() => drained(s))
      .then(async () => {
        s.lock?.release();
        await s.lock?.released;
      });
  }

  const none: EditorDraftOpened = {
    offer: null,
    superseded: null,
    backedUp: false,
  };

  /**
   * The draft follows `fileKey` (`landed`, `moved`): synchronously, so
   * every write from here on goes to the new namespace; what is pending,
   * the settings kept and an offer not yet answered are carried, and -
   * with `emptyOld` - the old namespace is emptied once everything landed
   * in the new one.
   */
  function moveTo(s: Space, fileKey: string, emptyOld: boolean): void {
    const next = makeSpace(fileKey);
    space = next;
    // The files first: a record or a story frame naming a file the new
    // namespace lacks yet would, for a tab closed mid-move, be dropped by
    // the reopen. Each record still queues now, in its own chain, so a
    // change made after the move lands after it. Only a record naming a
    // carried file waits for them: one naming none reaches the new key at
    // once. The settings always wait (a station's story may name one).
    const filesCarried = [...files.values()].map((file) =>
      keepFile(next, file),
    );
    const filesIn = Promise.all(filesCarried);
    const waitFor = (
      change: TourObject | null,
    ): Promise<unknown> | undefined =>
      change !== null &&
      tourBlockAssetIds(change).some((asset) => files.has(asset))
        ? filesIn
        : undefined;
    const carried = [writeMeta(next), ...filesCarried];
    for (const [id, change] of pending) {
      carried.push(
        carry(
          next,
          id,
          change,
          bases.get(id),
          pendingPictures.get(id),
          waitFor(change),
        ),
      );
    }
    if (settingsPending !== null) {
      carried.push(writeSettingsIn(next, settingsPending, filesIn));
    }
    // An offer not yet answered (or put off with "Not now") moves too.
    if (offer !== null) {
      for (const object of offer.objects) {
        if (!touched.has(object.id)) {
          carried.push(
            carry(
              next,
              object.id,
              object,
              bases.get(object.id),
              offer.pictures?.get(object.id),
              waitFor(object),
            ),
          );
        }
      }
      for (const id of offer.deleted) {
        if (!touched.has(id)) {
          carried.push(carry(next, id, null, undefined, undefined));
        }
      }
      if (offer.settings !== undefined && settingsWanted === null) {
        carried.push(writeSettingsIn(next, offer.settings, filesIn));
      }
    }
    // The old namespace goes only once the new one holds everything
    // (E2c review #2): a tab closed right after "Saved to" - nothing
    // asks, no change is pending - must not find both half written.
    // When anything did not land the old one stays (its key is the
    // overwritten file's, or the downloaded-from one's: reached only by
    // that file or a copy of it).
    const moved = Promise.all(carried)
      .then(async (oks) => {
        if (emptyOld && oks.every(Boolean)) await empty(s);
      })
      .catch(() => undefined)
      .finally(() => {
        s.lock?.release();
      });
    void track(moved);
    // The next open waits for the old key's hold to go, as after
    // `close()`: the pre-save file reopened in this tab must not find
    // this tab's own hold and say "another tab" (PR #626 bot finding 2).
    letGo = letGo
      .then(() => moved)
      .then(async () => {
        await s.lock?.released;
      });
  }

  // `built`, `landed` and `moved` are reached only through `writes()`,
  // bound to the tour open when it was called.
  const api: DraftApi = {
    async open(fileKey, manifest, sizeInFile) {
      close();
      const mine = generation;
      told = false;
      opened = manifest;
      await letGo;
      if (mine !== generation) return none;
      const s = makeSpace(fileKey);
      space = s;
      const store = await s.store;
      if (mine !== generation) return none;
      if (store === undefined) {
        say(s, s.refused ?? "storage");
        return none;
      }
      // The settings record (THE SETTINGS), read whether or not a meta
      // landed: its namespace already names the tour. Offered while the
      // file does not carry it; spent or unreadable, it goes.
      const settingsText = await store.getText(SETTINGS_KEY);
      if (mine !== generation) return none;
      let lost = false;
      // The files brought in: one the file on disk lists is
      // its own now and goes; a list that does not read, or a file it
      // names that is missing, is told.
      const listed = assetListOf(await store.getText(ASSETS_KEY));
      if (mine !== generation) return none;
      if (listed === null) lost = true;
      const inFile = new Set(manifest.assets.map((a) => a.id));
      // Matched by id AND path: after a smaller file the id alone no
      // longer says which bytes the file on disk carries.
      const pathInFile = new Map(manifest.assets.map((a) => [a.id, a.path]));
      // Copied into memory now: the store hands out a snapshot of the
      // entry, which a landed save or a key move later removes while the
      // session still needs the bytes (a preview, an undo after a save).
      // A file brought in this visit is held the same way.
      const bytesAt = async (key: string): Promise<Blob | undefined> => {
        const stored = await store.getBlob(key);
        const bytes = await stored?.arrayBuffer().catch(() => undefined);
        return stored === undefined || bytes === undefined
          ? undefined
          : new Blob([bytes], { type: stored.type });
      };
      for (const { asset, original, originalKept, originalChosen } of listed ??
        []) {
        // A file the file on disk lists at its path is its own when the
        // entry there has its size (`sizeInFile`): the path alone does not
        // say which bytes are there - a save that started before "use the
        // original" lands the smaller file at the original's path. Without
        // sizes a plain file is its own by its path, and a smaller file
        // stays (it may share the path with other bytes).
        const ownAtPath = (blob: Blob): boolean =>
          pathInFile.get(asset.id) === asset.path &&
          (sizeInFile === undefined
            ? original === undefined
            : sizeInFile(asset.path) === blob.size);
        if (original === undefined) {
          if (
            sizeInFile === undefined &&
            pathInFile.get(asset.id) === asset.path
          ) {
            continue;
          }
          const blob = await bytesAt(`${ASSET_PREFIX}${asset.id}`);
          if (mine !== generation) return none;
          if (blob !== undefined && ownAtPath(blob)) continue;
          if (blob === undefined) {
            // Bytes gone while the file on disk holds an entry at the
            // record's path: an open's tidy removed them as the file's own
            // before it rewrote the list, and a reload came between. The
            // file carries it, so nothing of the draft's is lost.
            const onDisk =
              pathInFile.get(asset.id) === asset.path &&
              sizeInFile?.(asset.path) !== undefined;
            if (!onDisk) lost = true;
          } else {
            files.set(asset.id, {
              asset,
              blob,
              ...(originalChosen === true ? { originalChosen } : {}),
            });
          }
          continue;
        }
        const blob = await bytesAt(
          bytesKey({ asset, blob: new Blob(), original: { asset: original } }),
        );
        if (mine !== generation) return none;
        // At its path with bytes of its size (a save by download wrote
        // it there): the file's own now, its original with it. A smaller
        // file and the bytes it replaced never share a size.
        if (blob !== undefined && ownAtPath(blob)) continue;
        const kept = originalKept
          ? await bytesAt(`${ASSET_PREFIX}${asset.id}`)
          : undefined;
        if (mine !== generation) return none;
        if (originalKept && kept === undefined) lost = true;
        const was =
          kept === undefined
            ? { asset: original }
            : { asset: original, blob: kept };
        if (blob !== undefined)
          files.set(asset.id, { asset, blob, original: was });
        else {
          // The smaller bytes are gone: the original stands, when kept.
          lost = true;
          if (kept !== undefined) {
            files.set(asset.id, { asset: original, blob: kept });
          }
        }
      }
      /** Smaller files for assets the opened file carries: work of their
       *  own, offered though no record names them anew. */
      const swaps = [...files.values()].filter((f) =>
        inFile.has(f.asset.id),
      ).length;
      // Read against the opened file and the files held: a new station's
      // story may name a file brought in, which the next save writes.
      const withHeld: TourManifest = {
        ...manifest,
        assets: [
          ...manifest.assets.filter((a) => !files.has(a.id)),
          ...[...files.values()].map((f) => f.asset),
        ],
      };
      // A station that no longer reads may read again against a corrected
      // file: told, and its record stays. A record that does not read at
      // all has no such way back: told, and it goes.
      let frameLost = false;
      const readSettings = parseSettingsRecord(
        settingsText,
        withHeld,
        (what) => {
          lost = true;
          if (what === "frame") frameLost = true;
        },
      );
      /** Told once, for the settings and the files alike. */
      const sayUnread = (): void => {
        if (lost) deps.unreadDraft?.();
      };
      const storedSettings =
        readSettings === undefined
          ? undefined
          : heldAgainst(readSettings, withHeld);
      let settings: EditorTourSettings | undefined;
      /** The record offered beside `notes` offered notes, or none - then
       *  it goes. Stations the page created alone are kept only for the
       *  notes that name them. */
      const offerSettings = (notes: number): void => {
        const file = settingsOf(manifest);
        settings =
          storedSettings !== undefined &&
          (changesSettings(storedSettings, file) ||
            (notes > 0 && addsStations(storedSettings, file)))
            ? storedSettings
            : undefined;
        if (
          settingsText !== undefined &&
          settings === undefined &&
          !frameLost
        ) {
          void settingsIn(s, null);
        }
      };
      /** The offer's words, and how its settings part is named. Notes
       *  and deletions count by id, so one a moved station carries is named
       *  with that move instead; `swapped` are smaller files for assets the
       *  opened file carries, work of their own no record names. */
      const offerWords = (
        notes: readonly string[],
        gone: readonly string[],
        swapped: number,
      ): { text: string; settingsWhat?: string } => {
        const what =
          settings === undefined
            ? undefined
            : settingsWhatOf(settings, manifest);
        const moved = movedIds(settings, manifest);
        const own = (ids: readonly string[]) =>
          ids.filter((id) => !moved.has(id)).length;
        return {
          text: offerText(own(notes) + swapped, own(gone), settings, manifest),
          ...(what === undefined ? {} : { settingsWhat: what }),
        };
      };
      // A photo note's bytes are in the opened file, never in the draft
      // (E2c review #1): its record is kept without them.
      const stored = await readDraft(store, { photoBytesRequired: false });
      if (mine !== generation) return none;
      if (stored === undefined) {
        // Said when it does not land, as the pruning write below is: the
        // shared reader reads nothing without a meta, so the namespace
        // would be unreadable while the page claimed a backup (PR #626 bot
        // finding 1). Tracked with its line, so `idle()` covers the saying.
        void track(
          writeMeta(s).then((ok) => {
            if (!ok) say(s, s.refused ?? "storage");
          }),
        );
        offerSettings(0);
        offer =
          settings === undefined && swaps === 0
            ? null
            : {
                objects: [],
                deleted: [],
                ...(settings === undefined ? {} : { settings }),
                ...filesOffered(),
              };
        tidyFiles(s);
        sayUnread();
        return {
          offer:
            offer === null ? null : { ...offer, ...offerWords([], [], swaps) },
          superseded: null,
          backedUp: true,
        };
      }
      for (const id of stored.storedIds) s.ids.add(id);
      // The pruned list, written back at once: a rejected id whose files
      // are gone must not stay in the meta. Until that write lands, a
      // later edit of such an id is claimed against the meta on disk
      // (`rejectedOnDisk`), and a write that did not land is said.
      s.rejected = stored.rejectedIds;
      s.rejectedOnDisk = new Set(stored.rejectedOnDisk);
      // Tracked with its line, so `idle()` covers the saying too.
      void track(
        writeMeta(s).then((ok) => {
          if (!ok) say(s, s.refused ?? "storage");
        }),
      );
      const hosted = hostedObjects(manifest);
      // A file object put into a station this page created (moved to a
      // new station where it stands) reads as hosted - a station the file
      // lacks is no move to the phone's writer - but the record holds that
      // station whole, so the move is offered with it.
      const created = new Set(
        (storedSettings?.createdStations ?? []).map((f) => f.id),
      );
      const hostedHome = new Map(hosted.objects.map((o) => [o.id, o.station]));
      const yetHosted = draftObjectsNotYetHosted(stored.draft, manifest);
      const notHosted = [
        ...yetHosted,
        ...stored.draft.objects.filter(
          (o) =>
            !yetHosted.includes(o) &&
            o.station !== undefined &&
            created.has(o.station) &&
            hostedHome.has(o.id) &&
            hostedHome.get(o.id) !== o.station,
        ),
      ];
      // A record of an id the file does not carry is a copy made here (no
      // file this browser opened showed it: no `seen` base) in a station
      // the file or the record knows, offered with its picture; any other
      // is a note deleted elsewhere, given way to like a replaced one.
      const knownStations = new Set([
        ...manifest.stations.map((st) => st.id),
        ...(storedSettings?.frames ?? []).map((f) => f.id),
        ...(storedSettings?.createdStations ?? []).map((f) => f.id),
      ]);
      const madeHere = notHosted.filter(
        (o) =>
          hosted.key(o.id) === undefined &&
          (stored.draft.bases?.get(o.id)?.seen.length ?? 0) === 0 &&
          o.station !== undefined &&
          knownStations.has(o.station),
      );
      const made = madeHere.filter(
        (o) =>
          o.kind !== "picture" || o.image !== o.id || stored.photos.has(o.id),
      );
      // A copy whose picture did not read is part of the draft that did
      // not read (told so), never a record replaced elsewhere (PR #876
      // review): it goes like any other unreadable record.
      const photoless = madeHere.length - made.length;
      if (photoless > 0) lost = true;
      const pictures = new Map(
        made.flatMap((o) => {
          const blob = stored.photos.get(o.id);
          return blob === undefined ? [] : [[o.id, blob] as const];
        }),
      );
      const offered = [
        ...notHosted.filter((o) => hosted.key(o.id) !== undefined),
        ...made,
      ];
      const replaced =
        draftObjectsSuperseded(stored.draft, manifest).length +
        (notHosted.length - offered.length - photoless);
      // A record naming a file neither the opened file nor this draft
      // holds is not offered as it is: a restore of it would make every
      // save fail (told: part of the draft did not read). A long text
      // whose voice is gone keeps its words, with the opened file's
      // narration; any other such record is left out.
      const heldFiles = new Set([...inFile, ...files.keys()]);
      const waiting = offered.flatMap((o) => {
        if (objectAssetsHeld(o, heldFiles)) return [o];
        lost = true;
        const kept = withFiledNarration(o, manifest);
        return kept !== o && objectAssetsHeld(kept, heldFiles) ? [kept] : [];
      });
      const deleted = draftDeletionsNotYetHosted(stored.draft, manifest);
      const kept = new Set([...waiting.map((o) => o.id), ...deleted]);
      offerSettings(waiting.length);
      // Everything else the read saw is in the file already, replaced, or
      // unreadable: it goes (no commit point needed - each leftover is
      // inert and goes again on the next open).
      for (const id of stored.storedIds) if (!kept.has(id)) removeIn(s, id);
      for (const id of kept) {
        const base = stored.draft.bases?.get(id);
        if (base !== undefined) bases.set(id, base);
      }
      offer =
        kept.size === 0 && settings === undefined && swaps === 0
          ? null
          : {
              objects: waiting,
              deleted,
              ...(made.length === 0 ? {} : { made: made.map((o) => o.id) }),
              ...(settings === undefined ? {} : { settings }),
              ...(pictures.size === 0 ? {} : { pictures }),
              ...filesOffered(),
            };
      tidyFiles(s);
      sayUnread();
      return {
        offer:
          offer === null
            ? null
            : {
                ...offer,
                ...offerWords(
                  waiting.map((o) => o.id),
                  deleted,
                  swaps,
                ),
              },
        superseded:
          replaced === 0 ? null : supersededLine(replaced, SUPERSEDED_WHERE),
        backedUp: true,
      };
    },

    writes() {
      const mine = generation;
      const live = (): boolean => mine === generation;
      return {
        saveObject: (object, blob) =>
          live() ? api.saveObject(object, blob) : Promise.resolve(true),
        saveDeletion: (id) =>
          live() ? api.saveDeletion(id) : Promise.resolve(true),
        forgetDeletion: (id) =>
          live() ? api.forgetDeletion(id) : Promise.resolve(true),
        forgetObject: (id) =>
          live() ? api.forgetObject(id) : Promise.resolve(),
        saveSettings: (settings) =>
          live() ? api.saveSettings(settings) : Promise.resolve(true),
        saveAsset: (asset, blob) =>
          live() ? api.saveAsset(asset, blob) : Promise.resolve(true),
        holdsFile: (id) => api.holdsFile(id),
        swapAsset: (asset, blob, originalChosen) =>
          live()
            ? api.swapAsset(asset, blob, originalChosen)
            : Promise.resolve(true),
        holdsOriginal: (id) => api.holdsOriginal(id),
        built: (written) => {
          if (live()) api.built(written);
        },
        landed: (written, fileKey, wrote) => {
          if (live()) api.landed(written, fileKey, wrote);
        },
        moved: (fileKey) => {
          if (live()) api.moved(fileKey);
        },
      };
    },

    restored() {
      offer = null;
    },

    async discard() {
      const s = space;
      const was = offer;
      offer = null;
      if (s === null || was === null) return true;
      // Minus what was edited since the open: that is live work now.
      const ids = [...was.objects.map((o) => o.id), ...was.deleted].filter(
        (id) => !touched.has(id),
      );
      const before = s.rejected;
      s.rejected = [...new Set([...before, ...ids])];
      // THE COMMIT POINT: once the meta rejects them, the next read
      // refuses them whether or not the removals below ran.
      // A rejection that did not land throws nothing away: the meta is
      // put back and the offer re-armed - a key move before the next open
      // still carries it - and the page says so.
      const fail = (): false => {
        s.rejected = before;
        void writeMeta(s);
        offer = was;
        return false;
      };
      if (!(await writeMeta(s))) return fail();
      // The offered settings record goes too, unless changed since the
      // open (live work): awaited, inside the namespace's work, so "Delete
      // it" is done only once it went, and a removal that did not land
      // fails it like the meta (M1b-2 milestone review #4).
      if (
        was.settings !== undefined &&
        settingsWanted === null &&
        !(await settingsIn(s, null))
      ) {
        return fail();
      }
      // The offered files go with it, minus those brought in since.
      dropFiles(
        s,
        (was.files ?? [])
          .map((f) => f.asset.id)
          .filter((id) => !filesHere.has(id)),
      );
      for (const id of ids) {
        // Counted among the namespace's writes, like the meta (finding B).
        void inSpace(
          s,
          chain.run(objectChain(s, id), async () => {
            // A change made since claimed the id: its files are the
            // change's now.
            if (!s.rejected.includes(id)) return;
            const store = await s.store;
            if (store !== undefined) await removeDraftObject(store, id);
          }),
        ).catch(() => undefined);
      }
      return true;
    },

    built(written) {
      const s = space;
      if (s === null) return;
      // As a reader of the written file sees it (the E2p third review #5).
      const read = manifestAsRead(written);
      built.push(read);
      const readObjects = hostedObjects(read);
      // A setting turned back while this save built is measured against
      // the build now (M1b-2 milestone review #1).
      if (redecideSettings()) void writeSettingsIn(s, settingsPending);
      for (const [id, change] of pending) {
        if (change === null) continue;
        const key = readObjects.key(id);
        if (key === undefined) continue;
        bases.set(id, withBaseKey(bases.get(id), "written", key));
        // Not said when it fails: a base that did not land is removed,
        // and no base is never superseded.
        void inQueue(s, id, (store) =>
          addDraftBaseKey(store, id, "written", key),
        );
      }
    },

    landed(written, fileKey, wrote) {
      const s = space;
      if (s === null) return;
      const read = manifestAsRead(written);
      const hosted = hostedObjects(read);
      // What the file carries now is no longer pending; an edit made
      // while the save ran is.
      const spent = [...pending].flatMap(([id, change]) =>
        (change === null ? hosted.key(id) === undefined : hosted.holds(change))
          ? [id]
          : [],
      );
      for (const id of spent) {
        pending.delete(id);
        bases.delete(id);
      }
      opened = read;
      // A file the written tour lists AT ITS PATH, with the bytes the save
      // wrote for it, is the file's own now, its original with it. Listed
      // at another path, or with other bytes (a save already running when
      // a smaller file came wrote the original - perhaps at the same
      // path), the swap is still to be written. A plain file the save
      // wrote no bytes for is the file's own by its path.
      const listedAt = new Map(read.assets.map((a) => [a.id, a.path]));
      const spentFiles = [...files.values()]
        .filter((f) => {
          if (listedAt.get(f.asset.id) !== f.asset.path) return false;
          const bytes = wrote?.get(f.asset.id);
          return bytes === undefined
            ? f.original === undefined
            : bytes === f.blob;
        })
        .map((f) => f.asset.id);
      // The settings decided again against the file on disk now: spent
      // when it carries them, kept when it does not (M1b-2 milestone
      // review #1); a key move below carries what is kept.
      const settingsChanged = redecideSettings();
      if (editorDraftKey(fileKey) === s.key) {
        for (const id of spent) removeIn(s, id);
        if (settingsChanged) void writeSettingsIn(s, settingsPending);
        dropFiles(s, spentFiles);
        return;
      }
      for (const id of spentFiles) files.delete(id);
      // The key moves (a tour of notes alone, or the first save that wrote
      // the tour's own id); the overwritten file's namespace is emptied.
      moveTo(s, fileKey, true);
    },

    moved(fileKey) {
      const s = space;
      if (s === null || editorDraftKey(fileKey) === s.key) return;
      // Nothing is spent, and the old namespace keeps what it holds: a
      // download is not known to be the file anyone opens ("a delivered
      // download clears nothing", WHAT THE DRAFT HOLDS above), so the
      // original opened again still offers what it did; an open of a file
      // that carries an edit spends it there.
      moveTo(s, fileKey, false);
    },

    backsUp() {
      return space !== null && space.refused === null && !told;
    },

    close,

    forget,

    idle() {
      if (writing === 0) return Promise.resolve();
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },

    saveObject(object, blob) {
      const id = object.id;
      pending.set(id, object);
      if (blob === undefined) pendingPictures.delete(id);
      else pendingPictures.set(id, blob);
      touched.add(id);
      const seen = seenKey(id);
      if (seen !== undefined) {
        bases.set(id, withBaseKey(bases.get(id), "seen", seen));
      }
      // A live record takes its id's stale tombstone away (an offered
      // deletion edited meanwhile), once the record landed.
      return write(id, (store) =>
        writeDraftLiveRecord(store, object, blob, seen),
      );
    },
    saveDeletion(id) {
      pending.set(id, null);
      touched.add(id);
      return write(id, (store) => writeDraftDeletion(store, id));
    },
    forgetDeletion(id) {
      if (pending.get(id) === null) pending.delete(id);
      touched.add(id);
      return write(id, (store) => removeDraftDeletion(store, id));
    },
    saveAsset(asset, blob) {
      const file = { asset, blob };
      files.set(asset.id, file);
      filesHere.add(asset.id);
      const s = space;
      if (s === null) return Promise.resolve(true);
      return keepFile(s, file);
    },
    holdsFile: (id) => !filesNotKept.has(id),
    swapAsset(asset, blob, originalChosen) {
      const id = asset.id;
      const prev = files.get(id);
      const onDisk = opened?.assets.find((a) => a.id === id);
      // What stands for the id when no smaller file does: the entry's own
      // original, the entry itself, or the file on disk's record.
      const original =
        prev?.original ??
        (prev !== undefined
          ? { asset: prev.asset, blob: prev.blob }
          : onDisk === undefined
            ? undefined
            : { asset: onDisk });
      if (original === undefined) return Promise.resolve(space === null);
      const back = original.blob;
      const next: DraftFile | undefined =
        blob === undefined
          ? back === undefined
            ? undefined
            : { asset: original.asset, blob: back }
          : blob === back && asset.path === original.asset.path
            ? {
                asset: original.asset,
                blob,
                ...(originalChosen === true
                  ? { originalChosen: true as const }
                  : {}),
              }
            : { asset, blob, original };
      const before = prev === undefined ? [] : keysOf(prev);
      if (next === undefined) files.delete(id);
      else files.set(id, next);
      filesHere.add(id);
      const s = space;
      if (s === null) return Promise.resolve(true);
      const after = next === undefined ? [] : keysOf(next);
      const put =
        next !== undefined &&
        (next.original !== undefined || !before.includes(bytesKey(next)))
          ? { key: bytesKey(next), blob: next.blob }
          : undefined;
      return swapIn(
        s,
        put,
        before.filter((key) => !after.includes(key)),
      );
    },
    holdsOriginal: (id) => files.get(id)?.original?.blob !== undefined,
    saveSettings(settings) {
      settingsWanted = settings;
      // Kept while the file on disk differs, or a build wrote other
      // values (THE SETTINGS); else the record goes.
      settingsPending = keepSettings(settings) ? settings : null;
      const s = space;
      return s === null
        ? Promise.resolve(true)
        : writeSettingsIn(s, settingsPending);
    },
    forgetObject(id) {
      pending.delete(id);
      touched.add(id);
      return write(id, (store) =>
        removeDraftObject(store, id).then(() => true),
      ).then(() => undefined);
    },
  };
  return api;
}
