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
  TourCaptureSpots,
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
import {
  captureSpotsForRebuild,
  finishedFileName,
  pendingAfterRebuild,
  rebuildFinishedTour,
} from "../finish-rebuild.js";
import { objectContentKey } from "../authoring-draft.js";
import {
  recordDelete,
  recordUndoDelete,
  type DraftObjectWrites,
} from "../draft-actions.js";
import {
  authoringObjects,
  deleteObject,
  moveObjectTo,
  pinTextEdit,
  undoDelete,
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

/** An edited or moved object (the editor places nothing new yet). */
interface EditorEntry {
  readonly object: TourObject;
}

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
export interface CoverChoice {
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
 *  words: the details to keep, or why not. */
function checkForm(
  form: DetailsForm,
  covers: ReadonlySet<string>,
): { ok: true; details: EditorTourDetails } | { ok: false; reason: string } {
  const details: { -readonly [K in keyof EditorTourDetails]: string } = {};
  const name = form.name.trim();
  if (charCount(name) > TOUR_NAME_MAX_CHARS) {
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
  if (form.cover !== null) {
    if (!covers.has(form.cover)) {
      return {
        ok: false,
        reason: "That cover is not one of this tour's photos any more.",
      };
    }
    details.cover = form.cover;
  }
  if (form.contact.trim() !== "") {
    const checked = checkTourContact(form.contact);
    if (!checked.ok) {
      return {
        ok: false,
        reason:
          charCount(form.contact.trim()) > TOUR_CONTACT_MAX_CHARS
            ? `The contact is longer than ${String(TOUR_CONTACT_MAX_CHARS)} characters.`
            : "The contact must be an e-mail address or a web link starting with https://.",
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
  /** Delete, with its undo, which refuses (false) once a save wrote the
   *  delete - the saved file no longer carries the object or its photo
   *  (E2a review #9). Refused, deleting nothing, for an id the tour no
   *  longer carries. */
  remove(id: string): { kind: "deleted"; undo: () => boolean } | EditorRefusal;
  /** Put a draft's work back by the session's own rules (M6 E2c): an
   *  object the tour carries gets the draft's version, a deletion its
   *  tombstone; live work on an id wins, and an id the tour no longer
   *  carries is skipped. The settings likewise: a change made here since
   *  the open wins, and an applied one counts among `changed`. What was
   *  applied is written to the draft again. */
  restore(work: EditorRestore): { changed: number; deleted: number };
  /** Build the saved zip from the newest bytes; edits made while it runs
   *  wait for the next save. Saves run one after another: one called
   *  while another runs starts when it ends (E2a review #9). */
  save(options: { readonly keepScan: boolean }): Promise<EditorSave>;
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
  let spots: Promise<{ spots?: TourCaptureSpots; notPlaced?: string }> | null =
    null;
  /** The saved file's name: the opened one's, made safe (the Finish's rule). */
  const savedName = finishedFileName(session);
  /** The name the page shows when the tour has no title. */
  const shownName = input.fileName ?? savedName;

  /** Saves whose snapshot was taken: a delete's undo is refused once a
   *  save snapshotted AFTER it - that save writes the delete - and not for
   *  a save already running when it was made (E2b plan review #2, the
   *  third E2p review #6). */
  let snapshots = 0;
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
      const checked = checkForm(next, coverIds());
      if (!checked.ok) return { kind: "refused", reason: checked.reason };
      const now = effectiveDetails();
      if (DETAIL_FIELDS.every((f) => checked.details[f] === now[f])) {
        return { kind: "unchanged" };
      }
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
        placed = upsertPlaced(placed, { object: edit.after });
        backUp(edit.after);
        return { kind: "edited" };
      }
      return edit;
    },
    move(id, lat, lon) {
      const found = find(id);
      if (found === undefined) return notInTour;
      const after = moveObjectTo(found.object, lat, lon);
      placed = upsertPlaced(placed, { object: after });
      backUp(after);
      return { kind: "moved" };
    },
    remove(id) {
      const found = find(id);
      if (found === undefined) return notInTour;
      const gone = deleteObject({ placed, deleted }, found);
      placed = gone.placed;
      deleted = gone.deleted;
      // The shared sequences (`draft-actions.ts`), as the phone runs them.
      if (input.draft !== undefined) {
        void recordDelete(input.draft, id, gone.record.hosted);
      }
      const at = snapshots;
      const undo = (): boolean => {
        if (snapshots > at) return false;
        const back = undoDelete({ placed, deleted }, gone.record);
        placed = back.placed;
        deleted = back.deleted;
        // An edited note's record comes back too: the delete removed it.
        if (input.draft !== undefined) {
          void recordUndoDelete(input.draft, gone.record);
        }
        return true;
      };
      return { kind: "deleted", undo };
    },
    restore(work) {
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
      return { changed: changed + settingsChanged, deleted: gone };
    },
    save(options) {
      const start = (): Promise<EditorSave> => runSave(options);
      const next = inFlight === 0 ? start() : tail.then(start, start);
      inFlight += 1;
      tail = next
        .catch(() => undefined)
        .finally(() => {
          inFlight -= 1;
        });
      return next;
    },
  };

  async function runSave(options: {
    readonly keepScan: boolean;
  }): Promise<EditorSave> {
    // Snapshots before the first await: an edit made from here on waits
    // for the next save (`pendingAfterRebuild`).
    snapshots += 1;
    const placedNow = [...placed];
    const deletedNow = [...deleted];
    const manifestNow = withDetails(
      withNeedsNoGps(manifest, noGps),
      effectiveDetails(),
    );
    spots ??= captureSpotsForRebuild(session, manifestNow);
    const photos = await spots;
    const finished = await rebuildFinishedTour({
      tour: session,
      manifest: manifestNow,
      placed: placedNow,
      deleted: deletedNow,
      levels: [],
      keepScan: options.keepScan,
      ...(photos.spots === undefined ? {} : { captureSpots: photos.spots }),
      previous,
    });
    if (finished === null) throw new Error("the save was stopped");
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
}
