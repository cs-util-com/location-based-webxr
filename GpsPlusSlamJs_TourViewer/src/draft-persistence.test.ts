/**
 * Why these tests matter. This is the layer between "a creator placed a
 * pin" and "bytes that survive the process being killed", and its failure
 * modes are all quiet:
 *
 * - a corrupt record that takes the whole draft with it, rather than just
 *   itself (the reason each object has its own file);
 * - a photo RECORD restored without its BYTES, which would name a content
 *   entry the rebuilt zip does not contain - the PR #435 failure;
 * - a draft whose objects come back in a different order each time;
 * - a draft with no meta file being appended to whichever tour happens to
 *   be open.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  objectKey,
  parseDraftObject,
  photoKey,
  readDraft,
  writeDraftMeta,
  writeDraftObject,
} from "./draft-persistence.js";

/** An in-memory store with the same contract as the OPFS one. */
function memoryStore(): DraftFileStore & { files: Map<string, Blob | string> } {
  const files = new Map<string, Blob | string>();
  return {
    files,
    put: (key, data) => {
      files.set(key, data as Blob | string);
      return Promise.resolve(true);
    },
    remove: (key) => {
      files.delete(key);
      return Promise.resolve();
    },
    getText: async (key) => {
      const value = files.get(key);
      if (value === undefined) return undefined;
      return typeof value === "string" ? value : value.text();
    },
    getBlob: (key) => {
      const value = files.get(key);
      if (value === undefined) return Promise.resolve(undefined);
      return Promise.resolve(
        typeof value === "string" ? new Blob([value]) : value,
      );
    },
    keys: () => Promise.resolve([...files.keys()]),
    clear: () => {
      files.clear();
      return Promise.resolve();
    },
  };
}

function pin(
  id: string,
  createdAtIso = "2026-09-09T00:00:00.000Z",
): TourObject {
  return {
    id,
    kind: "pin",
    label: id,
    createdAtIso,
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
  };
}

function photo(
  id: string,
  createdAtIso = "2026-09-09T00:00:01.000Z",
): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    createdAtIso,
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
    imageWidth: 4,
    imageHeight: 3,
  };
}

const META = { tourUrl: "https://h/t.zip", sizeM: 0.16, level: null };

describe("readDraft", () => {
  it("round-trips the meta and every placed object", async () => {
    const store = memoryStore();
    await writeDraftMeta(store, { ...META, sizeM: 0.2 });
    await writeDraftObject(store, pin("a"));
    await writeDraftObject(store, photo("b"), new Blob([new Uint8Array([9])]));
    const read = await readDraft(store);
    expect(read?.draft.tourUrl).toBe("https://h/t.zip");
    // The printed size is in here because a crash loses it: the field is
    // rewritten from the framework default on every load, so without this
    // a creator who printed at 20 cm would re-enter AR solving against 16.
    expect(read?.draft.sizeM).toBe(0.2);
    expect(read?.draft.objects.map((o) => o.id)).toEqual(["a", "b"]);
    expect(read?.photos.get("b")).toBeDefined();
  });

  it("gives nothing at all without a meta file", async () => {
    // A directory of objects with no meta cannot say which tour it belongs
    // to, and guessing is how a draft is appended to the wrong zip.
    const store = memoryStore();
    await writeDraftObject(store, pin("a"));
    expect(await readDraft(store)).toBeUndefined();
  });

  it("drops one corrupt record and keeps the rest", async () => {
    // The whole reason each object has its own file. A truncated write, or
    // a record from an older version of the app, must cost itself.
    const store = memoryStore();
    await writeDraftMeta(store, META);
    await writeDraftObject(store, pin("good"));
    await store.put(objectKey("broken"), "{ not json");
    await store.put(objectKey("wrong-shape"), JSON.stringify({ id: "x" }));
    const read = await readDraft(store);
    expect(read?.draft.objects.map((o) => o.id)).toEqual(["good"]);
  });

  it("drops a photo record whose bytes are gone", async () => {
    // A photo record without its bytes names a `content/<id>.jpg` the
    // rebuilt zip does not contain - the exact shape of the PR #435 bug,
    // and worse here because it would be introduced by the safety net.
    const store = memoryStore();
    await writeDraftMeta(store, META);
    await writeDraftObject(store, photo("p"), new Blob(["x"]));
    store.files.delete(photoKey("p"));
    expect((await readDraft(store))?.draft.objects).toEqual([]);
  });

  it("returns the objects in a stable order (property)", async () => {
    // The store lists in whatever order the directory yields. A tour whose
    // objects shuffle between restores would produce a different tour.json
    // each time, for no reason a reader could see.
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 0, max: 40 }), {
          minLength: 1,
          maxLength: 8,
        }),
        async (seconds) => {
          const store = memoryStore();
          await writeDraftMeta(store, META);
          for (const s of seconds) {
            const at = `2026-09-09T00:00:${String(s).padStart(2, "0")}.000Z`;
            await writeDraftObject(store, pin(`id-${String(s)}`, at));
          }
          const first = (await readDraft(store))?.draft.objects.map(
            (o) => o.id,
          );
          const second = (await readDraft(store))?.draft.objects.map(
            (o) => o.id,
          );
          expect(first).toEqual(second);
          // ...and it is the order they were placed in.
          expect(first).toEqual(
            [...seconds].sort((a, b) => a - b).map((s) => `id-${String(s)}`),
          );
        },
      ),
    );
  });
});

describe("parseDraftObject", () => {
  it("accepts what the manifest accepts and refuses what it refuses", () => {
    // Validation is the manifest's own, on purpose: a draft must never
    // hold something the finish would later reject, and a second validator
    // here is how the two would come to disagree.
    expect(parseDraftObject(JSON.stringify(pin("a")))?.id).toBe("a");
    for (const bad of ["", "null", "{}", '{"id":"a"}', "[1,2]"]) {
      expect(parseDraftObject(bad), bad).toBeNull();
    }
  });
});

describe("writeDraftObject", () => {
  it("reports failure when the photo bytes could not be stored", async () => {
    // Half a photo is worse than none: the caller says persistence is off
    // rather than believing the walk is safe.
    const failing: DraftFileStore = {
      put: (key) => Promise.resolve(!key.startsWith("photo:")),
      getText: () => Promise.resolve(undefined),
      getBlob: () => Promise.resolve(undefined),
      keys: () => Promise.resolve([]),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    expect(await writeDraftObject(failing, photo("p"), new Blob(["x"]))).toBe(
      false,
    );
  });
});

describe("the meta's own validation", () => {
  it("keeps the walk when the level does not read, and drops only the measurement", async () => {
    // Why this test matters: `level` is the field that travels furthest -
    // it reaches the archive path builder, which throws on an id it cannot
    // write, leaving the creator an opaque finish failure at the moment
    // they have finished walking. So an unreadable one must never reach
    // the finish.
    //
    // But it must not take the DRAFT with it either. Every placement the
    // creator made is in the same directory, and the module's own rule two
    // screens up is that a record which does not read costs itself and
    // nothing else. A level that does not read means "no measurement yet",
    // which is a shape the whole flow already supports (M1/M3 review #10).
    //
    // The last three are ids that ARE strings and still cannot be written:
    // the framework rejects a separator and a `..` segment, so a check of
    // `typeof === "string"` would report this guard closed while the
    // opaque finish failure stayed reachable (PR #438 review, second pass).
    for (const level of [
      {},
      [],
      { id: 5 },
      { id: "a" },
      { json: "{}" },
      7,
      { id: "../escape", json: "{}" },
      { id: "a/b", json: "{}" },
      { id: "", json: "{}" },
    ]) {
      const store = memoryStore();
      store.files.set("meta", JSON.stringify({ ...META, level }));
      await writeDraftObject(store, pin("a"));
      const read = await readDraft(store);
      expect(read, JSON.stringify(level)).toBeDefined();
      expect(read?.draft.level, JSON.stringify(level)).toBeNull();
      expect(read?.draft.objects, JSON.stringify(level)).toHaveLength(1);
    }
  });

  it("accepts the two shapes a level really has", async () => {
    const withLevel = memoryStore();
    await writeDraftMeta(withLevel, {
      ...META,
      level: { id: "abc", json: "{}" },
    });
    expect((await readDraft(withLevel))?.draft.level).toEqual({
      id: "abc",
      json: "{}",
    });
    const withoutLevel = memoryStore();
    await writeDraftMeta(withoutLevel, META);
    expect((await readDraft(withoutLevel))?.draft.level).toBeNull();
  });
});

describe("a rejection recorded in the meta is the commit point", () => {
  /**
   * Why these tests matter. Until now a discard rewrote the meta and then
   * deleted the rejected object files WITHOUT awaiting them, so the moment
   * a rejection became true was spread across several writes. A reload
   * landing between them - or a delete that simply failed - found a valid
   * meta plus files that were still there, and the draft the creator had
   * just thrown away was offered a second time. Recording the rejection in
   * the meta makes ONE write the commit point, and these are the tests
   * that fail if the read stops honouring it.
   */

  it("hides an object the meta lists as rejected, though its file is still on disk", async () => {
    const store = memoryStore();
    await writeDraftMeta(store, { ...META, rejected: ["gone"] });
    await writeDraftObject(store, pin("gone"));
    await writeDraftObject(store, pin("kept"));

    const read = await readDraft(store);
    expect(read?.draft.objects.map((o) => o.id)).toEqual(["kept"]);
    expect(
      store.files.has(objectKey("gone")),
      "the file is deliberately still there - that is the whole point",
    ).toBe(true);
  });

  it("hides a rejected photo's BYTES as well as its record", async () => {
    // The photos map is what the finish writes as zip content. A rejected
    // photo whose bytes came back would name an entry the creator threw
    // away, which is the PR #435 failure from the other direction.
    const store = memoryStore();
    await writeDraftMeta(store, { ...META, rejected: ["shot"] });
    await writeDraftObject(
      store,
      photo("shot"),
      new Blob([new Uint8Array([1])]),
    );

    const read = await readDraft(store);
    expect(read?.draft.objects).toEqual([]);
    expect(read?.photos.get("shot")).toBeUndefined();
  });

  it("carries a rejection forward only while its files remain", async () => {
    // The list is rewritten on every meta write, so unpruned it would grow
    // for the life of the tour. The ids that still have files are both the
    // prune (everything else drops out) and the sweep list - those are the
    // deletes that did not finish, and nothing else would ever reclaim
    // them now that `clear` has no caller.
    const store = memoryStore();
    await writeDraftMeta(store, {
      ...META,
      rejected: ["already-swept", "still-there"],
    });
    await writeDraftObject(store, pin("still-there"));

    const read = await readDraft(store);
    expect(read?.rejectedIds).toEqual(["still-there"]);
  });

  it("treats a meta with no rejected list as no rejection", async () => {
    // Every meta file already on a real device is this shape. A
    // compatibility break here would hide a draft nobody rejected.
    const store = memoryStore();
    await writeDraftMeta(store, META);
    await writeDraftObject(store, pin("a"));

    const read = await readDraft(store);
    expect(read?.draft.objects.map((o) => o.id)).toEqual(["a"]);
    expect(read?.rejectedIds).toEqual([]);
  });

  it("treats a malformed rejected list as no rejection, never as a total one", async () => {
    // Which way this fails is a real decision. Reading a corrupt list as
    // "everything is rejected" would hide work the creator never threw
    // away - silent data loss, the exact failure this feature has produced
    // four times. Reading it as "nothing is rejected" costs at worst a
    // prompt shown twice. So it fails towards offering.
    const store = memoryStore();
    await store.put(
      "meta",
      JSON.stringify({ ...META, rejected: "not-an-array" }),
    );
    await writeDraftObject(store, pin("a"));

    const read = await readDraft(store);
    expect(read?.draft.objects.map((o) => o.id)).toEqual(["a"]);
    expect(read?.rejectedIds).toEqual([]);
  });

  it("ignores a non-string entry without discarding the rest of the list", async () => {
    const store = memoryStore();
    await store.put(
      "meta",
      JSON.stringify({ ...META, rejected: ["gone", 7, null] }),
    );
    await writeDraftObject(store, pin("gone"));
    await writeDraftObject(store, pin("kept"));

    const read = await readDraft(store);
    expect(read?.draft.objects.map((o) => o.id)).toEqual(["kept"]);
  });
});
