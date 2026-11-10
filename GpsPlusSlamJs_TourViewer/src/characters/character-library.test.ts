import { describe, expect, it } from "vitest";

import { createCharacterLibrary } from "./character-library.js";
import { memoryLibraryStore } from "./test-support/memory-library-store.js";

const png = (tag: string): Blob => new Blob([tag], { type: "image/png" });

function library() {
  const store = memoryLibraryStore();
  let t = Date.parse("2026-11-10T08:00:00.000Z");
  let r = 0;
  const lib = createCharacterLibrary(store, {
    now: () => (t += 60_000),
    random: () => (r = (r + 0.137) % 1),
  });
  return { store, lib };
}

const SAVE = {
  name: "Pip",
  steady: false,
  describedAs: "a fox",
  frames: png("frames"),
  image: png("image"),
};

describe("character-library", () => {
  // Why: the record's presence is the sign that an entry is complete, so it
  // must be the last file written.
  it("writes the pictures first and the record last", async () => {
    const { store, lib } = library();
    const rec = await lib.save(SAVE);
    expect(store.writes).toEqual([
      `${rec.libraryId}/frames.png`,
      `${rec.libraryId}/image.png`,
      `${rec.libraryId}/character.json`,
    ]);
    expect(rec).toMatchObject({
      format: 1,
      name: "Pip",
      autoName: false,
      tool: "character maker",
    });
  });

  // Why: a save interrupted before its record (a closed page) leaves a
  // folder the list must skip and count, and the next save tidies it.
  it("skips and later tidies an interrupted save", async () => {
    const { store, lib } = library();
    store.failNextWriteOf("character.json");
    await expect(lib.save(SAVE)).rejects.toThrow("the page closed");
    expect(await lib.list()).toEqual({ entries: [], interrupted: 1 });
    await lib.save({ ...SAVE, name: "Rosa" });
    const after = await lib.list();
    expect(after.interrupted).toBe(0);
    expect(after.entries.map((e) => e.name)).toEqual(["Rosa"]);
  });

  // Why: "Tidy up now" removes the unfinished saves at once, and keeps a
  // record that only does not read (it may be from a newer version).
  it("tidies unfinished saves on request and keeps unreadable records", async () => {
    const { store, lib } = library();
    store.failNextWriteOf("character.json");
    await expect(lib.save(SAVE)).rejects.toThrow();
    await store.write("cbroken", "character.json", new Blob(["{nope"]));
    await lib.tidy();
    expect(await lib.list()).toEqual({ entries: [], interrupted: 1 });
    expect(await store.ids()).toEqual(["cbroken"]);
  });

  // Why: a damaged record counts as interrupted instead of breaking the list.
  it("counts an unreadable record as interrupted", async () => {
    const { store, lib } = library();
    await store.write("cbroken", "character.json", new Blob(["{nope"]));
    await lib.save(SAVE);
    const { entries, interrupted } = await lib.list();
    expect(entries).toHaveLength(1);
    expect(interrupted).toBe(1);
  });

  // Why: the format refuses an empty name, so a character saved without one
  // gets the first free "Guide N", marked so the list can ask for a name.
  it("names an unnamed character Guide N", async () => {
    const { lib } = library();
    const a = await lib.save({ ...SAVE, name: "  " });
    const b = await lib.save({ ...SAVE, name: "" });
    expect([a.name, a.autoName, b.name]).toEqual(["Guide 1", true, "Guide 2"]);
  });

  // Why: the newest character comes first, which is the one an author just made.
  it("lists newest first", async () => {
    const { lib } = library();
    await lib.save({ ...SAVE, name: "First" });
    await lib.save({ ...SAVE, name: "Second" });
    expect((await lib.list()).entries.map((e) => e.name)).toEqual([
      "Second",
      "First",
    ]);
  });

  // Why: rename refuses with the words the field shows, and clears the
  // "no name yet" mark.
  it("renames, and refuses a bad name with words", async () => {
    const { lib } = library();
    const rec = await lib.save({ ...SAVE, name: "" });
    await expect(lib.rename(rec.libraryId, " ")).rejects.toThrow(
      "A name needs at least one letter.",
    );
    const renamed = await lib.rename(rec.libraryId, " Rita ");
    expect([renamed.name, renamed.autoName]).toEqual(["Rita", false]);
    await expect(lib.rename("cmissing", "X")).rejects.toThrow(
      "This character is no longer on this device.",
    );
  });

  // Why: files() hands the pictures and the record to the exchange file and
  // the editor; remove() takes the whole folder.
  it("reads and removes an entry", async () => {
    const { lib } = library();
    const rec = await lib.save(SAVE);
    const f = await lib.files(rec.libraryId);
    expect(await f.frames.text()).toBe("frames");
    expect(await f.image.text()).toBe("image");
    expect(f.record.name).toBe("Pip");
    await lib.remove(rec.libraryId);
    expect((await lib.list()).entries).toEqual([]);
    await expect(lib.files(rec.libraryId)).rejects.toThrow(
      "no longer on this device",
    );
  });

  // Why: names are capped at the field's 40 letters before they are stored.
  it("caps a long name", async () => {
    const { lib } = library();
    expect(
      (await lib.save({ ...SAVE, name: "z".repeat(55) })).name,
    ).toHaveLength(40);
  });
});
