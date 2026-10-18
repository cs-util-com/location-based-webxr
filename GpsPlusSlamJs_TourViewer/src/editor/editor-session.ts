/**
 * The desktop editor's open tour and its edits (M6 E2a): the shared rules
 * of the phone's object list (`object-edits.ts`) over the tour the page
 * opened, and a Save built by the phone's own Finish rules
 * (`finish-rebuild.ts`). Page-free: the page shows `model()`, calls the
 * edits, and downloads what `save()` returns.
 *
 * @see editor-session.ts.md
 */

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { SignedTourManifest } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import {
  checkTourContact,
  checkTourDescription,
  tourCoverEntry,
  tourImageIds,
  TOUR_CONTACT_MAX_CHARS,
  TOUR_DESCRIPTION_MAX_CHARS,
} from "gps-plus-slam-app-framework/ar/tour-details";
import { rebuildZipWithEntries } from "gps-plus-slam-app-framework/storage";
import {
  captureSpotsForRebuild,
  finishedFileName,
  pendingAfterRebuild,
  rebuildFinishedTour,
  type FinishedTour,
  type RebuildPhotoSpots,
} from "../finish-rebuild.js";
import { recordingEntryNames, scanEntryNames } from "../tour-read-set.js";
import { objectContentKey } from "../authoring-draft.js";
import { recordDelete, type DraftObjectWrites } from "../draft-actions.js";
import {
  authoringObjects,
  deleteObject,
  moveObjectTo,
  pinTextEdit,
  upsertPlaced,
  type AuthoringObject,
} from "../object-edits.js";
import type { TourSession } from "../tour-session.js";
import type { DetailsForm, DetailsOutcome } from "./details-dialog.js";
import {
  detailsOf,
  type EditorTourDetails,
  type EditorTourSettings,
} from "./editor-draft.js";
import { buildEditorModel, type EditorModel } from "./editor-model.js";
import { checkNoGps, type NoGpsCheck } from "./no-gps-check.js";
import { readZipBlobEntry, zipBlobEntryNames } from "../zip-blob.js";

/** An edited or moved object, or one an undo brought back after a save
 *  wrote its delete - a photo then with its picture's bytes, which the
 *  saved file no longer carries (W2). */
interface EditorEntry {
  readonly object: TourObject;
  readonly blob?: Blob;
}

/** The tour as an undo step finds it: the objects with the edits, the
 *  setting and the details. A step goes BACK to such a state, whatever was
 *  saved since: what differs from the saved file is pending again. */
interface EditState {
  readonly objects: readonly TourObject[];
  readonly noGps: boolean;
  readonly details: EditorTourDetails;
}

interface UndoStep {
  readonly state: EditState;
  /** The edit in words: "the move of "Fountain"". */
  readonly what: string;
}

/** How many steps are kept: enough for a working session, bounded. */
const UNDO_LIMIT = 200;

/** Said for an undo or a redo asked for while a save runs: the save's end
 *  decides what the file carries, so the step waits (W2). */
const SAVE_RUNNING = "A save is running - undo or redo once it has finished.";

/** Said when an undo would bring back a photo a save already took out of
 *  the file, and its picture could not be kept. */
const PICTURE_GONE =
  "This photo's picture is no longer at hand, so its delete cannot be undone here.";

/** An object as the undo's words name it: its text, shortened, or what
 *  it is. */
function objectName(object: TourObject): string {
  const label =
    "label" in object && typeof object.label === "string"
      ? object.label.trim()
      : "";
  if (label === "") return object.kind === "photo" ? "a photo" : "a note";
  const chars = [...label];
  return `"${chars.length > 40 ? `${chars.slice(0, 39).join("")}…` : label}"`;
}

/** The outcome of an undo or a redo: the step taken (in words), nothing
 *  to take, or a refusal in words. */
type UndoOutcome =
  | { readonly kind: "undone" | "redone"; readonly what: string }
  | { readonly kind: "nothing" }
  | EditorRefusal;

export interface EditorSave {
  readonly blob: Blob;
  /** The opened file's name, made safe to save (the Finish's rule). */
  readonly filename: string;
  /** Entries visitors never read that the save left out. */
  readonly scanLeftOut: readonly string[];
  /** Why the recorded photos could not be placed, when they could not. */
  readonly notPlaced?: string;
  /** The manifest the zip carries (the draft's `written` versions, M6
   *  E2c). */
  readonly written: TourManifest;
}

/** The walk's own file, named after the tour's (W2, D19): `castle.zip`
 *  gives `castle-walk.zip`. */
export function walkFileName(tourName: string): string {
  return `${tourName.replace(/\.zip$/i, "")}-walk.zip`;
}

/** Said when "Move the walk out" finds no walk in the newest bytes. */
const NO_WALK = "This tour carries no walk recording to move out.";

/** Said when the recorded photos the tour carries are still placed by the
 *  walk: moving it out would leave them nowhere (`finish-rebuild.ts`, S1
 *  milestone review #2). A walk that names no photo of the tour places
 *  nothing and moves out (the M4b milestone review #3). */
function walkStaysReason(notPlaced: string | undefined): string {
  return `The walk cannot be moved out: this tour's recorded photos can only be placed with it, and they could not be fixed in place without it${notPlaced === undefined ? "" : ` (${notPlaced})`}. The tour keeps its walk.`;
}

/** The note inside a moved-out walk's zip, at its root: which tour it came
 *  from (the M4b milestone review #8). */
export const WALK_NOTE = "about-this-walk.txt";

function walkNoteText(tour: {
  readonly fileName: string;
  readonly title: string | undefined;
  readonly seriesId: string | null;
}): string {
  return [
    "This is the walk recording of a tour: the GPS track of the walk, the depth the phone measured and the recorded photos.",
    `It was moved out of the tour file ${tour.fileName}${tour.title === undefined ? "" : ` (the tour "${tour.title}")`} by the tour editor, so that the tour file people open does not carry it.`,
    ...(tour.seriesId === null ? [] : [`The tour's series: ${tour.seriesId}.`]),
    "Keep this file to yourself: the tour does not need it.",
    "",
  ].join("\n");
}

/**
 * A built move of the walk out of the tour (W2, D19): the walk's own zip
 * (the whole recording of the newest bytes - the frames the tour keeps for
 * its visitors included - byte for byte, under its own paths, and a note
 * naming the tour, `WALK_NOTE`) and the tour without the walk, with the
 * pending edits. Nothing of the
 * session changes until `commit()`: the page writes the walk's zip first,
 * then the tour, and commits only when both landed - a commit before that
 * would let the next save rebuild from walk-free bytes the creator never
 * received. The page holds every save while a move runs.
 */
interface WalkMove {
  readonly kind: "ready";
  readonly walk: { readonly blob: Blob; readonly filename: string };
  readonly save: EditorSave;
  /** No other save landed since the move was built: asked before the
   *  tour is written, so a stale move writes nothing (the M4b milestone
   *  review #2: the page's second click may come after an autosave). */
  current(): boolean;
  /** Make the walk-free tour the session's newest bytes, as a landed save
   *  does; throws when another save landed since the move was built. */
  commit(): void;
}

/** Said for an id the tour no longer carries (a restore or a save took
 *  it away while its card was open, M6 E2c review #11). */
export const NOT_IN_TOUR = "That note is no longer in this tour.";

/** An edit, move or delete of an id the tour no longer carries, said in
 *  words (`NOT_IN_TOUR`) by all three alike (PR #622 bot finding C). */
interface EditorRefusal {
  readonly kind: "refused";
  readonly reason: string;
}

/** What a draft offers back (`editor-draft.ts`). */
interface EditorRestore {
  readonly objects: readonly TourObject[];
  readonly deleted: readonly string[];
  /** The tour-level settings, when the draft holds a change of them. */
  readonly settings?: EditorTourSettings;
}

/** Where the session backs its edits up: the objects' writes the phone
 *  shares (`draft-actions.ts`), and the tour's settings (QR-first M1b-2)
 *  with its details (W2). */
export interface EditorSessionDraft extends DraftObjectWrites {
  saveSettings(settings: EditorTourSettings): Promise<boolean>;
}

/** `manifest` with the "needs no GPS" flag set, or without the field:
 *  false is never written (`tour-manifest.ts`). */
function withNeedsNoGps(manifest: TourManifest, on: boolean): TourManifest {
  if (on) return { ...manifest, needsNoGps: true };
  const off = { ...manifest };
  delete off.needsNoGps;
  return off;
}

/** The longest tour name the editor takes: the phone's poster title's
 *  (`index.html`, `maxlength`), so a name fits the poster either way. */
export const TOUR_NAME_MAX_CHARS = 80;

/** One image a tour may show as its cover (W2): a placed photo, or an
 *  image the tour carries as a content asset. */
interface CoverChoice {
  readonly id: string;
  /** Its entry in the zip (`content/<id>.jpg`). */
  readonly image: string;
}

/** The details' fields, as the manifest names them. */
const DETAIL_FIELDS = ["title", "description", "cover", "contact"] as const;

/** `manifest` carrying `details` in place of its own. */
function withDetails(
  manifest: TourManifest,
  details: EditorTourDetails,
): TourManifest {
  const next = { ...manifest };
  for (const field of DETAIL_FIELDS) {
    const value = details[field];
    if (value === undefined) delete next[field];
    else next[field] = value;
  }
  return next;
}

/** Text counted as a reader counts it: in characters, not UTF-16 units. */
function charCount(text: string): number {
  return [...text].length;
}

/** A form checked by the format's rules (`tour-details.ts`), in plain
 *  words: the details to keep, or why not. `was` is the details as they
 *  stand: a name kept as it is passes whatever its length (a tour named
 *  elsewhere, M4a review #10). A cover naming no image of the tour is
 *  refused, or - for a draft's record, whose photo may have gone since -
 *  dropped (`unknownCover`), as the format's reader drops it (review #1). */
function checkForm(
  form: DetailsForm,
  covers: ReadonlySet<string>,
  was: EditorTourDetails,
  unknownCover: "refuse" | "drop" = "refuse",
): { ok: true; details: EditorTourDetails } | { ok: false; reason: string } {
  const details: { -readonly [K in keyof EditorTourDetails]: string } = {};
  const name = form.name.trim();
  if (charCount(name) > TOUR_NAME_MAX_CHARS && name !== was.title) {
    return {
      ok: false,
      reason: `The name is longer than ${String(TOUR_NAME_MAX_CHARS)} characters.`,
    };
  }
  if (name !== "") details.title = name;
  if (form.description.trim() !== "") {
    const checked = checkTourDescription(form.description);
    if (!checked.ok) {
      return {
        ok: false,
        reason: `The description is longer than ${String(TOUR_DESCRIPTION_MAX_CHARS)} characters.`,
      };
    }
    details.description = checked.value;
  }
  if (form.cover !== null && covers.has(form.cover)) {
    details.cover = form.cover;
  } else if (form.cover !== null && unknownCover === "refuse") {
    return {
      ok: false,
      reason: "That cover is not one of this tour's photos any more.",
    };
  }
  if (form.contact.trim() !== "") {
    const checked = checkTourContact(form.contact);
    if (!checked.ok) {
      return {
        ok: false,
        reason:
          charCount(form.contact.trim()) > TOUR_CONTACT_MAX_CHARS
            ? `The contact is longer than ${String(TOUR_CONTACT_MAX_CHARS)} characters.`
            : "The contact must be an e-mail address or a web link starting with http:// or https://.",
      };
    }
    details.contact = checked.value;
  }
  return { ok: true, details };
}

export interface EditorSession {
  /** The tour as it stands with the edits, for the rail and the map. */
  model(): EditorModel;
  /** Edits and deletions not yet in a saved file, by content: a text
   *  edited back to the tour's own is no change (E2a review #10). */
  changeCount(): number;
  /** The ids of the notes with an edit or a move not yet saved. */
  pendingIds(): string[];
  /** The tour's "needs no GPS" setting as it stands with the edits
   *  (QR-first M1b-2, owner Q-QF-1). */
  needsNoGps(): boolean;
  /** Turn it on or off: one pending change while it differs from the
   *  saved file, none once it is back at the file's own value. */
  setNeedsNoGps(on: boolean): { kind: "changed" | "unchanged" };
  /** The tour's name, description, cover and contact as they stand with
   *  the edits (W2); a cover whose image is gone (a deleted photo) is
   *  none. */
  details(): DetailsForm;
  /** Change them all at once (the "Tour details" dialog): each field that
   *  differs from the saved file is one pending change, an emptied field
   *  removes the detail. Refused in plain words, changing nothing, for
   *  what the format would drop. */
  setDetails(next: DetailsForm): DetailsOutcome;
  /** The images the tour may show as its cover: its placed photos and
   *  image assets, as they stand with the edits. */
  coverChoices(): CoverChoice[];
  /** What the setting's warnings are about: the code-less stations, the
   *  stations on a code the viewer cannot use, and whether a code can
   *  place the tour (`no-gps-check.ts`). */
  noGpsCheck(): NoGpsCheck;
  editText(
    id: string,
    text: string,
  ): { kind: "edited" | "unchanged" } | EditorRefusal;
  /** Move a note on the map (its height and facing kept); refused for an
   *  id the tour no longer carries. Throws for a position the tour
   *  cannot hold (`moveObjectTo`). */
  move(id: string, lat: number, lon: number): { kind: "moved" } | EditorRefusal;
  /** Delete (undone by `undo`, also after a save wrote it: a photo's
   *  picture is kept for that). Refused, deleting nothing, for an id the
   *  tour no longer carries. */
  remove(id: string): { kind: "deleted" } | EditorRefusal;
  /** Take back the newest edit (W2): the tour goes back to how it stood
   *  before it - an edit like any other, pending until saved and written
   *  to the draft. A note brought back after a save wrote its delete is
   *  not offered by a later open's draft, though (it places nothing new):
   *  that undo lasts this tab (M4a review #2). Refused while a save runs. */
  undo(): UndoOutcome;
  /** Take an undone edit again; a new edit drops what could be redone. */
  redo(): UndoOutcome;
  /** Counts every edit, undo and redo: a page holding an older offer
   *  (the delete toast's Undo) tells whether it is still the newest. */
  revision(): number;
  /** A photo's picture this session holds and the opened file may not (one
   *  an undo brought back after a save took it out), for the card. */
  pictureOf(id: string): Blob | undefined;
  /** Put a draft's work back by the session's own rules (M6 E2c): an
   *  object the tour carries gets the draft's version, a deletion its
   *  tombstone; live work on an id wins, and an id the tour no longer
   *  carries is skipped. The settings likewise: a change made here since
   *  the open wins, and an applied one counts among `changed`. What was
   *  applied is written to the draft again; it is one step to undo. */
  restore(work: EditorRestore): { changed: number; deleted: number };
  /** Build the saved zip from the newest bytes; edits made while it runs
   *  wait for the next save. Saves run one after another: one called
   *  while another runs starts when it ends (E2a review #9). */
  save(options: { readonly keepScan: boolean }): Promise<EditorSave>;
  /** The walk recording's entries in the newest bytes (W2, D19): none
   *  once it was moved out, or when the last save left it out. */
  walkEntries(): Promise<string[]>;
  /** Build the move of the walk out (`WalkMove`), queued with the saves;
   *  refused, in words, when there is no walk or the recorded photos the
   *  tour carries still need it (a walk that places nothing moves out).
   *  Bringing a walk back is a later feature. */
  moveWalkOut(): Promise<WalkMove | EditorRefusal>;
}

export function createEditorSession(input: {
  readonly session: TourSession;
  readonly manifest: TourManifest;
  readonly levels: ReadonlyMap<string, QrLevel>;
  /** The file's name for the model's title (default: the session's). */
  readonly fileName?: string;
  /** Where every edit, move, delete and undo is backed up (M6 E2c); none
   *  in a test that does not need it. */
  readonly draft?: EditorSessionDraft;
  /** Read a photo's picture by its entry (`content/<id>.jpg`) when it is
   *  deleted, so an undo after a save can bring it back (default: the
   *  opened file's; the page reads its copy of what it last wrote). */
  readonly loadPhoto?: (image: string) => Promise<Blob>;
}): EditorSession {
  const { session, levels } = input;
  let manifest = input.manifest;
  /** The "needs no GPS" setting with the edits; pending while it differs
   *  from `manifest` (the file as last saved). */
  let noGps = manifest.needsNoGps === true;
  /** The setting was changed here since the open: live work, which wins
   *  over a draft's offer. */
  let noGpsTouched = false;
  const noGpsPending = (): boolean => noGps !== (manifest.needsNoGps === true);
  /** The tour's details with the edits (W2); the cover as chosen, shown
   *  and written only while its image is in the tour (`effectiveDetails`). */
  let details: EditorTourDetails = detailsOf(manifest);
  /** The details were changed here since the open: live work, which wins
   *  over a draft's offer. */
  let detailsTouched = false;
  /** The settings record carries the details: once they were set or
   *  restored here (an untouched record keeps no opinion about them). */
  let detailsRecorded = false;
  let placed: EditorEntry[] = [];
  let deleted: string[] = [];
  let previous: { blob: Blob; signedManifest?: SignedTourManifest } | null =
    null;
  /** The photo spots, decided once per open (a decline is not re-baked on
   *  every save, E1 review #11). */
  let spots: Promise<RebuildPhotoSpots> | null = null;
  /** The saved file's name: the opened one's, made safe (the Finish's rule). */
  const savedName = finishedFileName(session);
  /** The name the page shows when the tour has no title. */
  const shownName = input.fileName ?? savedName;

  /** The edit stack (W2): the states to go back to, newest last, and the
   *  undone ones to go to again. */
  const undoSteps: UndoStep[] = [];
  const redoSteps: UndoStep[] = [];
  let revisionCount = 0;
  /** Deleted photos' pictures, for an undo after a save took them out. */
  const pictures = new Map<string, Blob>();
  /** Pictures being read: a save waits for them, so an undo right after
   *  the save that wrote a photo's delete finds its picture. */
  const pictureReads = new Set<Promise<void>>();
  const loadPhoto =
    input.loadPhoto ?? ((image: string) => session.loadContentEntry(image));
  /** The saves started and not yet ended, and the end of the last. */
  let inFlight = 0;
  let tail: Promise<unknown> = Promise.resolve();

  /** The entries whose content the tour does not carry yet. */
  function unsaved(): EditorEntry[] {
    const hosted = new Map(
      manifest.objects.map((o) => [o.id, objectContentKey(o)]),
    );
    return placed.filter(
      (p) => hosted.get(p.object.id) !== objectContentKey(p.object),
    );
  }

  function objects(): AuthoringObject<EditorEntry>[] {
    return authoringObjects(manifest.objects, placed, deleted);
  }

  const notInTour: EditorRefusal = { kind: "refused", reason: NOT_IN_TOUR };

  /** Undefined for an id the tour no longer carries: a page holding an
   *  older card gets a refusal, never a throw (E2c plan review #11). */
  function find(id: string): AuthoringObject<EditorEntry> | undefined {
    return objects().find((o) => o.object.id === id);
  }

  /** The tour as it stands with the edits, for what reads its images. */
  function current(): TourManifest {
    return { ...manifest, objects: objects().map((o) => o.object) };
  }

  function coverIds(): Set<string> {
    const tour = current();
    return tourImageIds({ objects: tour.objects, assets: tour.assets });
  }

  /** The details as shown and written: a cover whose image is gone (a
   *  deleted photo) is none, and comes back with an undo of the delete. */
  function effectiveDetails(): EditorTourDetails {
    if (details.cover === undefined || coverIds().has(details.cover)) {
      return details;
    }
    const { cover: _gone, ...rest } = details;
    return rest;
  }

  /** The details' fields that differ from the saved file. */
  function detailChanges(): number {
    const now = effectiveDetails();
    return DETAIL_FIELDS.filter((f) => now[f] !== manifest[f]).length;
  }

  /** The whole settings record as it stands (THE SETTINGS of
   *  `editor-draft.ts`). */
  function record(): EditorTourSettings {
    return detailsRecorded
      ? { needsNoGps: noGps, details }
      : { needsNoGps: noGps };
  }

  /** A draft's details put back by the dialog's own checks (a record
   *  whose details the format would drop leaves them as they are); how
   *  many fields changed. */
  function restoreDetails(offered: EditorTourDetails): number {
    const checked = checkForm(
      {
        name: offered.title ?? "",
        description: offered.description ?? "",
        cover: offered.cover ?? null,
        contact: offered.contact ?? "",
      },
      coverIds(),
      effectiveDetails(),
      "drop",
    );
    if (!checked.ok) return 0;
    const now = effectiveDetails();
    const fields = DETAIL_FIELDS.filter(
      (f) => checked.details[f] !== now[f],
    ).length;
    if (fields > 0) {
      details = checked.details;
      detailsRecorded = true;
    }
    return fields;
  }

  /** The draft's copy of an edit (fire-and-forget: the draft says its own
   *  failures, once). */
  function backUp(object: TourObject): void {
    void input.draft?.saveObject(object);
  }

  /** `object` as an entry, keeping the picture its entry carries. */
  function entryOf(object: TourObject): EditorEntry {
    const blob = placed.find((p) => p.object.id === object.id)?.blob;
    return blob === undefined ? { object } : { object, blob };
  }

  function stateNow(): EditState {
    return { objects: objects().map((o) => o.object), noGps, details };
  }

  /** An edit was made from `before`: one step to undo, and nothing left
   *  to redo. */
  function edited(what: string, before: EditState): void {
    undoSteps.push({ state: before, what });
    if (undoSteps.length > UNDO_LIMIT) undoSteps.shift();
    redoSteps.length = 0;
    revisionCount += 1;
  }

  /** Keep a deleted photo's picture for an undo after a save. */
  function keepPicture(found: AuthoringObject<EditorEntry>): void {
    const object = found.object;
    if (object.kind !== "photo") return;
    const id = object.id;
    const carried = found.placed?.blob;
    if (carried !== undefined) {
      pictures.set(id, carried);
      return;
    }
    if (pictures.has(id)) return;
    // Read now, while the copy that carries it is at hand; failing that,
    // from this session's own last bytes - the page's copy may not read
    // right after an in-place write (M4a review #5). A read that fails
    // both ways leaves an undo after a save refused, in words.
    const newest = previous?.blob;
    const read = loadPhoto(object.image)
      .catch((err: unknown) =>
        newest === undefined
          ? Promise.reject(err instanceof Error ? err : new Error(String(err)))
          : readZipBlobEntry(newest, `${session.manifestWrap}${object.image}`),
      )
      .then(
        (blob) => {
          pictures.set(id, blob);
        },
        () => undefined,
      )
      .finally(() => {
        pictureReads.delete(read);
      });
    pictureReads.add(read);
  }

  /** Where an id stands against the saved file. */
  function standing(
    id: string,
    entries: readonly EditorEntry[],
    gone: readonly string[],
  ): EditorEntry | "deleted" | null {
    if (gone.includes(id)) return "deleted";
    return entries.find((p) => p.object.id === id) ?? null;
  }

  /** The draft follows a step: each id whose standing changed is written
   *  as the edits' own writes would (a record before its tombstone goes,
   *  as `recordUndoDelete` does). */
  function backUpStep(
    entries: readonly EditorEntry[],
    gone: readonly string[],
  ): void {
    const draft = input.draft;
    if (draft === undefined) return;
    const ids = new Set([
      ...placed.map((p) => p.object.id),
      ...deleted,
      ...entries.map((p) => p.object.id),
      ...gone,
    ]);
    for (const id of ids) {
      backUpId(
        draft,
        id,
        standing(id, placed, deleted),
        standing(id, entries, gone),
      );
    }
  }

  /** One id's draft writes for a step from `was` to `now`. */
  function backUpId(
    draft: EditorSessionDraft,
    id: string,
    was: EditorEntry | "deleted" | null,
    now: EditorEntry | "deleted" | null,
  ): void {
    if (now === "deleted") {
      if (was !== "deleted") void draft.saveDeletion(id);
      return;
    }
    if (now === null) {
      if (was === "deleted") void draft.forgetDeletion(id);
      else if (was !== null) void draft.forgetObject(id);
      return;
    }
    const same =
      was !== null &&
      was !== "deleted" &&
      objectContentKey(was.object) === objectContentKey(now.object);
    if (!same) void draft.saveObject(now.object, now.blob);
    if (was === "deleted") void draft.forgetDeletion(id);
  }

  /** The tour back at `target`, measured against the file as saved now;
   *  a refusal, changing nothing, when a photo it brings back has no
   *  picture. */
  function goTo(target: EditState): EditorRefusal | null {
    const entries = entriesFor(target);
    if (entries === null) return { kind: "refused", reason: PICTURE_GONE };
    const kept = new Set(target.objects.map((o) => o.id));
    const gone = manifest.objects
      .filter((o) => !kept.has(o.id))
      .map((o) => o.id);
    backUpStep(entries, gone);
    placed = entries;
    deleted = gone;
    settingsTo(target);
    return null;
  }

  /** The entries that make the saved file look like `target`; null when a
   *  photo it brings back has no picture. */
  function entriesFor(target: EditState): EditorEntry[] | null {
    const hosted = new Map(manifest.objects.map((o) => [o.id, o]));
    const entries: EditorEntry[] = [];
    for (const object of target.objects) {
      const host = hosted.get(object.id);
      if (
        host !== undefined &&
        objectContentKey(host) === objectContentKey(object)
      ) {
        continue;
      }
      const blob =
        placed.find((p) => p.object.id === object.id)?.blob ??
        pictures.get(object.id);
      if (host === undefined && object.kind === "photo" && blob === undefined) {
        return null;
      }
      entries.push(blob === undefined ? { object } : { object, blob });
    }
    return entries;
  }

  /** The setting and the details at `target`'s, backed up when they move. */
  function settingsTo(target: EditState): void {
    const settingMoved = target.noGps !== noGps;
    const detailsMoved = DETAIL_FIELDS.some(
      (f) => target.details[f] !== details[f],
    );
    noGps = target.noGps;
    details = target.details;
    if (settingMoved) noGpsTouched = true;
    if (detailsMoved) {
      detailsTouched = true;
      detailsRecorded = true;
    }
    if (settingMoved || detailsMoved) {
      void input.draft?.saveSettings(record());
    }
  }

  /** One step from `from` (undo or redo), the state left behind kept on
   *  `to`. */
  function step(
    from: UndoStep[],
    to: UndoStep[],
    kind: "undone" | "redone",
  ): UndoOutcome {
    if (inFlight > 0) return { kind: "refused", reason: SAVE_RUNNING };
    const next = from.at(-1);
    if (next === undefined) return { kind: "nothing" };
    const here = stateNow();
    const refused = goTo(next.state);
    if (refused !== null) return refused;
    from.pop();
    to.push({ state: here, what: next.what });
    revisionCount += 1;
    return { kind, what: next.what };
  }

  return {
    model() {
      return buildEditorModel({
        manifest: withDetails(current(), effectiveDetails()),
        levels,
        fileName: shownName,
      });
    },
    changeCount() {
      return (
        unsaved().length +
        deleted.length +
        (noGpsPending() ? 1 : 0) +
        detailChanges()
      );
    },
    pendingIds() {
      return unsaved().map((p) => p.object.id);
    },
    needsNoGps() {
      return noGps;
    },
    setNeedsNoGps(on) {
      if (on === noGps) return { kind: "unchanged" };
      edited('the "needs no GPS" setting', stateNow());
      noGps = on;
      noGpsTouched = true;
      void input.draft?.saveSettings(record());
      return { kind: "changed" };
    },
    details() {
      const now = effectiveDetails();
      return {
        name: now.title ?? "",
        description: now.description ?? "",
        cover: now.cover ?? null,
        contact: now.contact ?? "",
      };
    },
    setDetails(next) {
      const checked = checkForm(next, coverIds(), effectiveDetails());
      if (!checked.ok) return { kind: "refused", reason: checked.reason };
      const now = effectiveDetails();
      if (DETAIL_FIELDS.every((f) => checked.details[f] === now[f])) {
        return { kind: "unchanged" };
      }
      edited("the tour details", stateNow());
      details = checked.details;
      detailsTouched = true;
      detailsRecorded = true;
      void input.draft?.saveSettings(record());
      return { kind: "changed" };
    },
    coverChoices() {
      const tour = current();
      const ids = coverIds();
      return [...ids].flatMap((id) => {
        const image = tourCoverEntry({ ...tour, cover: id });
        return image === null ? [] : [{ id, image }];
      });
    },
    noGpsCheck() {
      return checkNoGps({ stations: manifest.stations, levels });
    },
    editText(id, text) {
      const found = find(id);
      if (found === undefined) return notInTour;
      const edit = pinTextEdit(found.object, text);
      if (edit.kind === "edited") {
        edited(`the text of ${objectName(edit.after)}`, stateNow());
        placed = upsertPlaced(placed, entryOf(edit.after));
        backUp(edit.after);
        return { kind: "edited" };
      }
      return edit;
    },
    move(id, lat, lon) {
      const found = find(id);
      if (found === undefined) return notInTour;
      const after = moveObjectTo(found.object, lat, lon);
      edited(`the move of ${objectName(found.object)}`, stateNow());
      placed = upsertPlaced(placed, entryOf(after));
      backUp(after);
      return { kind: "moved" };
    },
    remove(id) {
      const found = find(id);
      if (found === undefined) return notInTour;
      edited(`the delete of ${objectName(found.object)}`, stateNow());
      keepPicture(found);
      const gone = deleteObject({ placed, deleted }, found);
      placed = gone.placed;
      deleted = gone.deleted;
      // The shared sequences (`draft-actions.ts`), as the phone runs them.
      if (input.draft !== undefined) {
        void recordDelete(input.draft, id, gone.record.hosted);
      }
      return { kind: "deleted" };
    },
    undo() {
      return step(undoSteps, redoSteps, "undone");
    },
    redo() {
      return step(redoSteps, undoSteps, "redone");
    },
    revision() {
      return revisionCount;
    },
    pictureOf(id) {
      return placed.find((p) => p.object.id === id)?.blob;
    },
    restore(work) {
      const before = stateNow();
      const live = new Set([...placed.map((p) => p.object.id), ...deleted]);
      let changed = 0;
      let gone = 0;
      for (const object of work.objects) {
        if (live.has(object.id) || find(object.id) === undefined) continue;
        placed = upsertPlaced(placed, { object });
        backUp(object);
        changed += 1;
      }
      for (const id of work.deleted) {
        const found = live.has(id) ? undefined : find(id);
        if (found === undefined) continue;
        const after = deleteObject({ placed, deleted }, found);
        placed = after.placed;
        deleted = after.deleted;
        void input.draft?.saveDeletion(id);
        gone += 1;
      }
      const settings = work.settings;
      let settingsChanged = 0;
      if (
        settings !== undefined &&
        !noGpsTouched &&
        settings.needsNoGps !== noGps
      ) {
        noGps = settings.needsNoGps;
        settingsChanged += 1;
      }
      if (settings?.details !== undefined && !detailsTouched) {
        settingsChanged += restoreDetails(settings.details);
      }
      if (settingsChanged > 0) void input.draft?.saveSettings(record());
      if (changed + gone + settingsChanged > 0) {
        edited("the restored changes", before);
      }
      return { changed: changed + settingsChanged, deleted: gone };
    },
    save(options) {
      return queued(() => runSave(options));
    },
    async walkEntries() {
      return scanEntryNames(
        await newestNames(),
        manifest,
        session.manifestWrap,
      );
    },
    moveWalkOut() {
      return queued(buildWalkMove);
    },
  };

  /** Saves (and moves of the walk) run one after another: one asked for
   *  while another runs starts when it ends (E2a review #9). */
  function queued<T>(start: () => Promise<T>): Promise<T> {
    const run = inFlight === 0 ? start() : tail.then(start, start);
    inFlight += 1;
    // Counted down BEFORE the caller hears the end: an undo asked for
    // right after an awaited save is not refused as "a save is running".
    const next = run.finally(() => {
      inFlight -= 1;
    });
    tail = next.catch(() => undefined);
    return next;
  }

  /** The newest bytes' entry names: the last save's, else the opened
   *  file's. */
  async function newestNames(): Promise<string[]> {
    return previous === null
      ? session.entries.map((e) => e.filename)
      : zipBlobEntryNames(previous.blob);
  }

  /** What a rebuild starts from, taken before its first await: an edit
   *  made from then on waits for the next save (`pendingAfterRebuild`). */
  function snapshot(): {
    placedNow: EditorEntry[];
    deletedNow: string[];
    manifestNow: TourManifest;
  } {
    return {
      placedNow: [...placed],
      deletedNow: [...deleted],
      manifestNow: withDetails(
        withNeedsNoGps(manifest, noGps),
        effectiveDetails(),
      ),
    };
  }

  /** The photo spots for a rebuild, decided once per open; a deleted
   *  photo's picture is read first, before the rebuild replaces the bytes
   *  it may be read from. */
  async function photoSpots(
    manifestNow: TourManifest,
  ): Promise<RebuildPhotoSpots> {
    await Promise.all(pictureReads);
    spots ??= captureSpotsForRebuild(session, manifestNow);
    return spots;
  }

  /** `whole` is the opened file as already read, when the caller read it
   *  (the walk's move): the rebuild then does not read it again (the M4b
   *  milestone review #11 - a listed tour's whole-file check ran twice). */
  async function rebuild(
    snap: ReturnType<typeof snapshot>,
    photos: RebuildPhotoSpots,
    keepScan: boolean,
    whole?: Blob,
  ): Promise<FinishedTour> {
    const finished = await rebuildFinishedTour({
      tour:
        whole === undefined
          ? session
          : {
              entries: session.entries,
              manifestWrap: session.manifestWrap,
              integrity: session.integrity,
              budget: session.budget,
              readWholeArchive: () => Promise.resolve(whole),
            },
      manifest: snap.manifestNow,
      placed: snap.placedNow,
      deleted: snap.deletedNow,
      levels: [],
      keepScan,
      ...(photos.spots === undefined ? {} : { captureSpots: photos.spots }),
      walkPlacesNothing: photos.placesNothing === true,
      previous,
    });
    if (finished === null) throw new Error("the save was stopped");
    return finished;
  }

  /** `finished` becomes the newest bytes: what it carries is no longer
   *  pending. */
  function landed(finished: FinishedTour, deletedNow: readonly string[]): void {
    previous = {
      blob: finished.blob,
      ...(finished.signedManifest === undefined
        ? {}
        : { signedManifest: finished.signedManifest }),
    };
    manifest = finished.written;
    const pending = pendingAfterRebuild(
      { placed, deleted },
      finished.written,
      deletedNow,
    );
    placed = pending.placed;
    deleted = pending.deleted;
  }

  function saveOf(
    finished: FinishedTour,
    photos: { notPlaced?: string },
  ): EditorSave {
    return {
      blob: finished.blob,
      filename: savedName,
      scanLeftOut: finished.scanLeftOut,
      written: finished.written,
      ...(photos.notPlaced === undefined
        ? {}
        : { notPlaced: photos.notPlaced }),
    };
  }

  async function runSave(options: {
    readonly keepScan: boolean;
  }): Promise<EditorSave> {
    const snap = snapshot();
    const photos = await photoSpots(snap.manifestNow);
    const finished = await rebuild(snap, photos, options.keepScan);
    landed(finished, snap.deletedNow);
    return saveOf(finished, photos);
  }

  /** The move of the walk out (D19), built from the newest bytes. */
  async function buildWalkMove(): Promise<WalkMove | EditorRefusal> {
    const snap = snapshot();
    const base = previous;
    const wrap = session.manifestWrap;
    const names = await newestNames();
    if (scanEntryNames(names, snap.manifestNow, wrap).length === 0) {
      return { kind: "refused", reason: NO_WALK };
    }
    const photos = await photoSpots(snap.manifestNow);
    // Without baked spots the walk is what places the recorded photos: the
    // rebuild would keep it (`finish-rebuild.ts`), so the move refuses -
    // unless the walk places nothing (the M4b milestone review #3).
    if (photos.spots === undefined && photos.placesNothing !== true) {
      return { kind: "refused", reason: walkStaysReason(photos.notPlaced) };
    }
    // The walk's own file is the whole recording (the M4b milestone review
    // #8): the frames the tour keeps for its visitors too, so it is a
    // complete recording on its own.
    const recording = new Set(recordingEntryNames(names));
    const source = base === null ? await session.readWholeArchive() : base.blob;
    const walkBlob = await rebuildZipWithEntries(
      source,
      [
        {
          path: WALK_NOTE,
          data: walkNoteText({
            fileName: savedName,
            title: snap.manifestNow.title,
            seriesId:
              session.integrity.kind === "listed"
                ? session.integrity.manifest.seriesId
                : null,
          }),
        },
      ],
      {
        remove: names.filter((name) => !recording.has(name)),
        // The opened file is untrusted: read under the session's budget, as
        // the rebuild below reads it (K0 milestone review R1).
        ...(base === null ? { budget: session.budget } : {}),
      },
    );
    // From the same bytes, read once (review #11).
    const finished = await rebuild(
      snap,
      photos,
      false,
      base === null ? source : undefined,
    );
    return {
      kind: "ready",
      walk: { blob: walkBlob, filename: walkFileName(savedName) },
      save: saveOf(finished, photos),
      current: () => previous === base,
      commit() {
        if (previous !== base) {
          throw new Error(
            "another save landed while the walk was moved out - move it again",
          );
        }
        landed(finished, snap.deletedNow);
      },
    };
  }
}
