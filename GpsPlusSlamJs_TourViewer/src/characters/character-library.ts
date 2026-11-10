/**
 * The character library on this device: each character is a folder with
 * `frames.png` (the cut sheet), `image.png` (the author's picture) and
 * `character.json` (the record). The record is written last, so a folder
 * without one is an interrupted save: `list()` skips and counts it and the
 * next `save()` removes it. A folder whose record does not read (damaged,
 * or written by a newer version) is skipped and counted too, but kept.
 *
 * Storage is behind `LibraryStore`, so the rules here are tested in memory
 * and the page passes the device store (`opfs-library-store.ts`).
 */

import {
  type CharacterRecord,
  CHARACTER_FORMAT,
  cappedName,
  DEFAULT_TOOL,
  nameProblem,
  newLibraryId,
  nextGuideName,
  recordOf,
} from "./character-record.js";

export type LibraryFile = "frames.png" | "image.png" | "character.json";

export interface LibraryStore {
  /** The ids of every folder, complete or not. */
  ids(): Promise<string[]>;
  read(id: string, file: LibraryFile): Promise<Blob | null>;
  write(id: string, file: LibraryFile, blob: Blob): Promise<void>;
  /** Removes the folder and everything in it; a missing one is fine. */
  remove(id: string): Promise<void>;
}

interface SaveRequest {
  readonly name: string;
  readonly steady: boolean;
  readonly describedAs: string;
  readonly frames: Blob;
  readonly image: Blob;
  readonly tool?: string;
}

interface LibraryListing {
  /** Complete entries, newest first. */
  readonly entries: CharacterRecord[];
  /** Folders without a readable record (unfinished or damaged). */
  readonly interrupted: number;
}

interface CharacterFiles {
  readonly record: CharacterRecord;
  readonly frames: Blob;
  readonly image: Blob;
}

export interface CharacterLibrary {
  save(req: SaveRequest): Promise<CharacterRecord>;
  list(): Promise<LibraryListing>;
  rename(id: string, name: string): Promise<CharacterRecord>;
  remove(id: string): Promise<void>;
  files(id: string): Promise<CharacterFiles>;
  /** Removes the unfinished saves now, as the next save would. */
  tidy(): Promise<void>;
}

export interface LibraryClock {
  now(): number;
  random(): number;
}

const GONE = "This character is no longer on this device.";

const jsonBlob = (rec: CharacterRecord): Blob =>
  new Blob([JSON.stringify(rec)], { type: "application/json" });

export function createCharacterLibrary(
  store: LibraryStore,
  clock: LibraryClock = { now: Date.now, random: Math.random },
): CharacterLibrary {
  async function readRecord(id: string): Promise<CharacterRecord | null> {
    const blob = await store.read(id, "character.json");
    if (!blob) return null;
    try {
      const rec = recordOf(JSON.parse(await blob.text()));
      return rec && rec.libraryId === id ? rec : null;
    } catch {
      return null;
    }
  }

  async function scan(): Promise<{
    entries: CharacterRecord[];
    unreadable: number;
    unfinished: string[];
  }> {
    const entries: CharacterRecord[] = [];
    const unfinished: string[] = [];
    let unreadable = 0;
    for (const id of await store.ids()) {
      const rec = await readRecord(id);
      if (rec) entries.push(rec);
      else if (await store.read(id, "character.json")) unreadable++;
      else unfinished.push(id);
    }
    entries.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
    return { entries, unreadable, unfinished };
  }

  async function existing(id: string): Promise<CharacterRecord> {
    const rec = await readRecord(id);
    if (!rec) throw new Error(GONE);
    return rec;
  }

  return {
    async save(req) {
      const { entries, unfinished } = await scan();
      for (const id of unfinished) await store.remove(id);
      const given = cappedName(req.name);
      const now = clock.now();
      const rec: CharacterRecord = {
        format: CHARACTER_FORMAT,
        libraryId: newLibraryId(now, () => clock.random()),
        name: given || nextGuideName(entries.map((e) => e.name)),
        autoName: given === "",
        createdAtIso: new Date(now).toISOString(),
        steady: req.steady,
        describedAs: req.describedAs,
        tool: req.tool ?? DEFAULT_TOOL,
      };
      await store.write(rec.libraryId, "frames.png", req.frames);
      await store.write(rec.libraryId, "image.png", req.image);
      await store.write(rec.libraryId, "character.json", jsonBlob(rec));
      return rec;
    },

    async list() {
      const { entries, unreadable, unfinished } = await scan();
      return { entries, interrupted: unreadable + unfinished.length };
    },

    async rename(id, name) {
      const problem = nameProblem(name);
      if (problem) throw new Error(problem);
      const rec = await existing(id);
      const next = { ...rec, name: cappedName(name), autoName: false };
      await store.write(id, "character.json", jsonBlob(next));
      return next;
    },

    async remove(id) {
      await store.remove(id);
    },

    async tidy() {
      for (const id of (await scan()).unfinished) await store.remove(id);
    },

    async files(id) {
      const record = await existing(id);
      const frames = await store.read(id, "frames.png");
      const image = await store.read(id, "image.png");
      if (!frames || !image) throw new Error(GONE);
      return { record, frames, image };
    },
  };
}
