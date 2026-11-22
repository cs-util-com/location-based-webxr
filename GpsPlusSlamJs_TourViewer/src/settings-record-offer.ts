/**
 * What a stored settings record (`tour-document-draft.ts`) offers against
 * a tour, and what its restore puts back: one rule for both pages' drafts
 * (the desktop editor's `editor/editor-draft.ts` and `editor-session.ts`,
 * the phone's `creator-draft.ts`). The setting, the details, the station
 * poses, the stations' own fields, their order, the deleted stations and
 * the characters are compared and restored here; the pages add their own
 * words and their own stores.
 *
 * @see settings-record-offer.ts.md
 */

import { tourStories } from "gps-plus-slam-app-framework/ar/tour-story";
import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourImageIds } from "gps-plus-slam-app-framework/ar/tour-details";
import { characterChanges } from "./declared-characters.js";
import {
  checkDetailsForm,
  DETAIL_FIELDS,
  detailsOf,
  type TourDetailFields,
} from "./tour-details-form.js";
import {
  coverImageIds,
  effectiveDetails,
  framesOf,
  sameBeyondPose,
  type StationFrame,
  type TourDocumentState,
  type TourRestore,
  tourDocumentActions,
  tourDocumentReducer,
} from "./tour-document.js";
import {
  changedStations,
  type TourSettingsRecord,
} from "./tour-document-draft.js";

/** One of the details' fields (`tour-details-form.ts`), in the order an
 *  offer names them. */
export type DetailField = (typeof DETAIL_FIELDS)[number];

/** Each field as the pages name it (`edit.html`'s "Tour details"). */
const DETAIL_NAMES: Readonly<Record<DetailField, string>> = {
  title: "name",
  description: "description",
  cover: "cover",
  contact: "contact",
};

/** The fields `wanted` changes against `against`; none for a record
 *  without details (no opinion). */
export function changedDetails(
  wanted: TourDetailFields | undefined,
  against: TourDetailFields | undefined,
): DetailField[] {
  if (wanted === undefined) return [];
  return DETAIL_FIELDS.filter((f) => wanted[f] !== against?.[f]);
}

/** The characters `wanted` changes against `against`'s (each added,
 *  gone or declared otherwise); none for a record without them. */
function changedCharacters(
  wanted: TourSettingsRecord,
  against: TourSettingsRecord,
): number {
  if (wanted.characters === undefined) return 0;
  return characterChanges(against.characters ?? [], wanted.characters);
}

/** What a record's whole frames change against `against`'s: the stations
 *  edited beyond their pose (a pose is `stations`' to name), the stations
 *  it adds that carry the creator's own work (a station a placement
 *  started is no change of its own: `addsStations`), the stations of
 *  `against` it deletes, and whether it orders the shared ones anew. None
 *  for a record without frames. */
export interface FrameChanges {
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
  wanted: TourSettingsRecord,
  against: TourSettingsRecord,
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

/** How many changes a record's frames count as. */
export function frameChangeCount(changes: FrameChanges): number {
  return (
    changes.edited.length +
    changes.added.length +
    changes.deleted.length +
    (changes.reordered ? 1 : 0)
  );
}

/** A tour's own settings, in the record's shape: what a record is
 *  compared with. */
export function settingsOf(manifest: TourManifest): TourSettingsRecord {
  return {
    needsNoGps: manifest.needsNoGps === true,
    details: detailsOf(manifest),
    stations: manifest.stations.map(({ id, geo }) => ({ id, geo })),
    frames: framesOf(manifest),
    characters: manifest.characters ?? [],
  };
}

/** Whether `wanted` changes a setting, a detail, a station's pose or a
 *  station beyond its pose that `against` holds: what an offer names. */
export function changesSettings(
  wanted: TourSettingsRecord,
  against: TourSettingsRecord,
): boolean {
  return (
    wanted.needsNoGps !== against.needsNoGps ||
    changedDetails(wanted.details, against.details).length > 0 ||
    changedStations(wanted.stations, against.stations).length > 0 ||
    frameChangeCount(changedFrames(wanted, against)) > 0 ||
    changedCharacters(wanted, against) > 0
  );
}

/** Whether `wanted` holds a station the page created that `against` does
 *  not carry: the draft's objects name it, so the record is work to keep
 *  (whole, its pose as it stands) even when nothing else changed. */
export function addsStations(
  wanted: TourSettingsRecord,
  against: TourSettingsRecord,
): boolean {
  const carried = new Set((against.stations ?? []).map((s) => s.id));
  return (wanted.createdStations ?? []).some((f) => !carried.has(f.id));
}

/** Whether `wanted` holds anything `against` lacks. */
export function differs(
  wanted: TourSettingsRecord,
  against: TourSettingsRecord,
): boolean {
  return changesSettings(wanted, against) || addsStations(wanted, against);
}

/** What an offered record changes against a tour, part by part. */
export interface SettingsChanges {
  readonly noGps: boolean;
  readonly details: readonly DetailField[];
  readonly stations: readonly string[];
  readonly frames: FrameChanges;
  readonly characters: number;
}

/** What `settings` changes against `manifest`'s own. */
export function settingsChanges(
  settings: TourSettingsRecord,
  manifest: TourManifest,
): SettingsChanges {
  const file = settingsOf(manifest);
  return {
    noGps: settings.needsNoGps !== file.needsNoGps,
    details: changedDetails(settings.details, file.details),
    stations: changedStations(settings.stations, file.stations),
    frames: changedFrames(settings, file),
    characters: changedCharacters(settings, file),
  };
}

/** How many changes a settings record counts as: the setting, each detail
 *  and each station one, the characters by declaration. */
export function settingsChangeCount(changes: SettingsChanges): number {
  return (
    (changes.noGps ? 1 : 0) +
    changes.details.length +
    changes.stations.length +
    frameChangeCount(changes.frames) +
    changes.characters
  );
}

/** "a station" or "3 stations". */
function stationsWord(count: number): string {
  return count === 1 ? "a station" : `${String(count)} stations`;
}

/** An offer's named parts of a settings record, in the pages' order;
 *  `noGps` names the setting when it changed. */
export function settingsParts(
  changes: SettingsChanges,
  noGps: string,
): string[] {
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
  if (changes.characters > 0)
    parts.push("the tour's characters, replacing the current ones");
  return parts;
}

/** `parts` as one phrase: the one part alone, or "a, b, and c" (two
 *  parts read "a, and b", as the offer has always said them). */
export function joinedParts(parts: readonly string[]): string {
  const rest = [...parts];
  const last = rest.pop() ?? "";
  return rest.length === 0 ? last : `${rest.join(", ")}, and ${last}`;
}

/** The items an offered record moves between a story and the free items:
 *  the story entries of each station whose frame it edits, in its frame or
 *  in the tour's. Such an item's object record (out of a story) or
 *  tombstone (into one) is part of that frame's change, counted there and
 *  never as a change or a deletion of its own. */
export function movedIds(
  settings: TourSettingsRecord | undefined,
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

/**
 * `settings` as measured against `manifest`: a cover naming no image of
 * that tour (a deleted photo) is no opinion about the cover - the tour's
 * own stands - since no save could write it (a record that
 * kept the deleted photo's cover made every later open offer a cover
 * change that Restore could not make).
 */
export function heldAgainst(
  settings: TourSettingsRecord,
  manifest: TourManifest,
): TourSettingsRecord {
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

/** A record's details put back by the details form's own checks (a record
 *  whose details the format would drop leaves them as they are), against
 *  `state` (the draft's objects already put back: a cover may name one);
 *  null when nothing would change. */
function restorableDetails(
  state: TourDocumentState,
  offered: TourDetailFields,
): TourDetailFields | null {
  const was = effectiveDetails(state);
  const checked = checkDetailsForm(
    {
      name: offered.title ?? "",
      description: offered.description ?? "",
      cover: offered.cover ?? null,
      contact: offered.contact ?? "",
    },
    coverImageIds(state),
    was,
    "drop",
  );
  if (!checked.ok) return null;
  return DETAIL_FIELDS.some((f) => checked.details[f] !== was[f])
    ? checked.details
    : null;
}

/** The objects' part of a restore, which the settings join. */
export type RestoreBase = Pick<TourRestore, "objects" | "deleted" | "assets">;

/**
 * A draft's restore with its settings record's part (`settings`, or none)
 * against the document `state` holds now: the station poses that differ,
 * the created and hand-made stations, the recorded frames, order and
 * deleted stations, the characters, the setting when it differs, and the
 * details as the details form checks them. `withObjects` is `state` with
 * the restore applied but for the setting and the details (what a page
 * counts the restored station edits against).
 */
export function restoreWithSettings(
  state: TourDocumentState,
  base: RestoreBase,
  settings: TourSettingsRecord | undefined,
): { readonly work: TourRestore; readonly withObjects: TourDocumentState } {
  const moved = new Set(changedStations(settings?.stations, state.stations));
  const stations = (settings?.stations ?? []).filter((p) => moved.has(p.id));
  const created = settings?.createdStations ?? [];
  const handMade = settings?.handMadeStations ?? [];
  const stationsWork: Partial<TourRestore> = {
    ...(stations.length === 0 ? {} : { stations }),
    ...(created.length === 0 ? {} : { createdStations: created }),
    ...(handMade.length === 0 ? {} : { handMadeStations: handMade }),
    ...(settings?.frames === undefined ? {} : { frames: settings.frames }),
    ...(settings?.order === undefined ? {} : { order: settings.order }),
    ...(settings?.deletedStations === undefined
      ? {}
      : { deletedStations: settings.deletedStations }),
    ...(settings?.characters === undefined
      ? {}
      : { characters: settings.characters }),
  };
  const restore: TourRestore = {
    objects: base.objects,
    deleted: base.deleted,
    ...(base.assets === undefined || base.assets.length === 0
      ? {}
      : { assets: base.assets }),
    ...stationsWork,
  };
  // The details against the tour with the draft's objects back: a cover
  // may name a photo they bring.
  const withObjects = tourDocumentReducer(
    state,
    tourDocumentActions.restored({ ...restore, what: "" }),
  );
  const details =
    settings?.details === undefined
      ? null
      : restorableDetails(withObjects, settings.details);
  const needsNoGps =
    settings !== undefined && settings.needsNoGps !== state.needsNoGps
      ? settings.needsNoGps
      : undefined;
  return {
    work: {
      ...restore,
      ...(needsNoGps === undefined ? {} : { needsNoGps }),
      ...(details === null ? {} : { details }),
    },
    withObjects,
  };
}
