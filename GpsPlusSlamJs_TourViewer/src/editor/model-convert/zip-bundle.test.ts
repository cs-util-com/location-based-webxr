/**
 * Why these tests matter: a zip of a model's folder is the easiest way for
 * a creator to bring a `.gltf` with its parts, and it is untrusted input.
 * The reader must find the model inside, read only what a model can use,
 * refuse a tour's zip (which the start page opens) and a zip with no model
 * in words, never open a zip inside the zip, skip what a macOS re-zip
 * adds, and stop at its caps before it inflates what they forbid.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import {
  DEFAULT_ARCHIVE_LIMITS,
  packFilesAsZip,
} from "gps-plus-slam-app-framework/storage";

import { note, refusal } from "./model-import-words.js";
import { listZipModels, readZipBundle, zipBundleNotes } from "./zip-bundle.js";

const bytes = (text: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(text);
const zipOf = (files: Record<string, string>) =>
  packFilesAsZip(Object.entries(files).map(([path, data]) => ({ path, data })));

/** A zip whose two entries carry the same name: `b.gltf`'s name bytes
 *  rewritten to `a.gltf` in its headers (a writer refuses to make one). */
async function zipNamingTwice(): Promise<Blob> {
  const zip = new Uint8Array(
    await (await zipOf({ "a.gltf": "{}", "b.gltf": "{}" })).arrayBuffer(),
  );
  const from = bytes("b.gltf");
  for (let i = 0; i + from.length <= zip.length; i++) {
    if (from.every((b, k) => zip[i + k] === b)) zip[i] = "a".charCodeAt(0);
  }
  return new Blob([zip]);
}

/** A zip of `count` empty stored entries, written byte by byte: a writer
 *  takes seconds for twenty thousand of them. */
function emptyEntriesZip(count: number): Blob {
  const local: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const name = bytes(`f${i}.txt`);
    const head = new Uint8Array(30 + name.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 10, true);
    h.setUint16(26, name.length, true);
    head.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 10, true);
    c.setUint16(6, 10, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    entry.set(name, 46);
    local.push(head);
    central.push(entry);
    offset += head.length;
  }
  const size = central.reduce((sum, e) => sum + e.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, count, true);
  e.setUint16(10, count, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end]);
}

describe("readZipBundle", () => {
  it("finds the .gltf and reads its parts, leaving out what no model uses", async () => {
    const zip = await zipOf({
      "bust/bust.gltf": "{}",
      "bust/bust.bin": "BIN",
      "bust/tex/wood.png": "PNG",
      "bust/readme.txt": "hello",
      "__MACOSX/bust/._bust.gltf": "fork",
      "bust/._wood.png": "fork",
      "bust/.DS_Store": "x",
    });
    const bundle = await readZipBundle(zip, "bust.zip");
    expect(bundle).toEqual({
      ok: true,
      kind: "gltf",
      model: "bust/bust.gltf",
      files: new Map([
        ["bust/bust.gltf", bytes("{}")],
        ["bust/bust.bin", bytes("BIN")],
        ["bust/tex/wood.png", bytes("PNG")],
      ]),
      others: [],
      skipped: ["bust/readme.txt"],
    });
  });

  it("takes a .glb inside as it is", async () => {
    const zip = await zipOf({ "x/rock.glb": "GLB", "x/notes.txt": "n" });
    expect(await readZipBundle(zip, "rock.zip")).toEqual({
      ok: true,
      kind: "glb",
      model: "x/rock.glb",
      glb: bytes("GLB"),
      others: [],
      skipped: ["x/notes.txt"],
    });
  });

  it("makes the first model by path and names the others", async () => {
    const zip = await zipOf({
      "b/b.gltf": "{}",
      "a/a.gltf": "{}",
      "c.glb": "GLB",
    });
    const bundle = await readZipBundle(zip, "set.zip");
    expect(bundle).toMatchObject({
      ok: true,
      kind: "gltf",
      model: "a/a.gltf",
      others: ["b/b.gltf", "c.glb"],
    });
  });

  it("makes the model it is asked for, naming no other model", async () => {
    const zip = await zipOf({
      "b/b.gltf": "{}",
      "a/a.gltf": "{}",
      "c.glb": "GLB",
    });
    expect(await readZipBundle(zip, "set.zip", { model: "c.glb" })).toEqual({
      ok: true,
      kind: "glb",
      model: "c.glb",
      glb: bytes("GLB"),
      others: [],
      skipped: [],
    });
    expect(
      await readZipBundle(zip, "set.zip", { model: "b/b.gltf" }),
    ).toMatchObject({ ok: true, kind: "gltf", model: "b/b.gltf", others: [] });
    expect(await readZipBundle(zip, "set.zip", { model: "gone.gltf" })).toEqual(
      { ok: false, reason: refusal.zipNoModel("set.zip") },
    );
  });

  // Why: an entry named twice is ambiguous - which of the two is the
  // model's part? - so the zip is refused, never read first-wins.
  it("refuses a zip that names an entry twice", async () => {
    expect(await readZipBundle(await zipNamingTwice(), "twice.zip")).toEqual({
      ok: false,
      reason: refusal.zipNamedTwice("twice.zip", "a.gltf"),
    });
  });

  // Why: a zip past the archive caps is refused in size words, not as a
  // damaged zip: the creator must learn it is too large, not broken.
  it("says a zip past the archive's inflation budget is too large, not unreadable", async () => {
    const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 1 });
    const zeros = new Uint8Array(DEFAULT_ARCHIVE_LIMITS.totalFloorBytes + 1024);
    await writer.add("big.glb", new Uint8ArrayReader(zeros));
    const zip = new Blob([await writer.close()]);
    expect(zip.size).toBeLessThan(1024 * 1024);
    expect(await readZipBundle(zip, "big.zip")).toEqual({
      ok: false,
      reason: refusal.zipTooLarge(
        "big.zip",
        DEFAULT_ARCHIVE_LIMITS.totalFloorBytes,
      ),
    });
  }, 60_000);

  it("says a zip of more entries than a zip may list holds too many files, not that it is unreadable", async () => {
    const cap = DEFAULT_ARCHIVE_LIMITS.maxEntries;
    const zip = emptyEntriesZip(cap + 1);
    expect(await readZipBundle(zip, "many.zip")).toEqual({
      ok: false,
      reason: refusal.zipTooManyEntries("many.zip", cap),
    });
  }, 60_000);

  it("refuses a tour's zip, a zip with no model, and bytes that are no zip, in words", async () => {
    const tour = await zipOf({ "tour.json": "{}", "content/a.glb": "GLB" });
    expect(await readZipBundle(tour, "walk.zip")).toEqual({
      ok: false,
      reason: refusal.zipIsTour("walk.zip"),
    });
    const nested = await zipOf({ "inner.zip": "PK", "a.png": "PNG" });
    expect(await readZipBundle(nested, "outer.zip")).toEqual({
      ok: false,
      reason: refusal.zipNoModel("outer.zip"),
    });
    expect(
      await readZipBundle(new Blob([bytes("not a zip at all")]), "x.zip"),
    ).toEqual({ ok: false, reason: refusal.zipUnreadable("x.zip") });
  });

  it("refuses past its file count and its size cap before reading the entries", async () => {
    const zip = await zipOf({
      "m.gltf": "{}",
      "a.bin": "12345678",
      "b.png": "12345678",
    });
    expect(
      await readZipBundle(zip, "m.zip", { maxFiles: 2, maxBytes: 1000 }),
    ).toEqual({ ok: false, reason: refusal.zipTooManyFiles("m.zip", 3, 2) });
    expect(
      await readZipBundle(zip, "m.zip", { maxFiles: 10, maxBytes: 17 }),
    ).toEqual({ ok: false, reason: refusal.tooLarge("m.zip", 18, 17) });
  });

  it("stops when it is aborted", async () => {
    const zip = await zipOf({ "m.gltf": "{}" });
    const control = new AbortController();
    control.abort();
    await expect(
      readZipBundle(zip, "m.zip", {}, control.signal),
    ).rejects.toThrow();
  });
});

describe("listZipModels", () => {
  // Why: the page makes one import per model a zip holds, so it must list
  // them as the reader picks them, and list none for a zip the reader
  // refuses whole (its one import then says why).
  it("lists the models by path as the reader does, and none for a zip it refuses whole", async () => {
    const set = await zipOf({
      "b/b.gltf": "{}",
      "a/a.gltf": "{}",
      "c.glb": "GLB",
      "__MACOSX/._d.gltf": "fork",
      "a/a.bin": "B",
    });
    expect(await listZipModels(set)).toEqual(["a/a.gltf", "b/b.gltf", "c.glb"]);
    const tour = await zipOf({ "tour.json": "{}", "a.glb": "GLB" });
    expect(await listZipModels(tour)).toEqual([]);
    expect(await listZipModels(await zipNamingTwice())).toEqual([]);
    expect(await listZipModels(new Blob([bytes("no zip")]))).toEqual([]);
  });
});

describe("zipBundleNotes", () => {
  it("names the other models and the files the model did not use", () => {
    expect(
      zipBundleNotes(
        {
          model: "a.gltf",
          files: new Map([
            ["a.gltf", bytes("{}")],
            ["a.bin", bytes("B")],
            ["extra.png", bytes("P")],
          ]),
          others: ["b.gltf"],
          skipped: ["readme.txt"],
        },
        ["a.bin"],
      ),
    ).toEqual([
      note.otherModels("a.gltf", ["b.gltf"]),
      note.unusedFiles(["extra.png", "readme.txt"]),
    ]);
  });

  it("says nothing when the model used every file", () => {
    expect(
      zipBundleNotes(
        {
          model: "a.gltf",
          files: new Map([["a.gltf", bytes("{}")]]),
          others: [],
          skipped: [],
        },
        [],
      ),
    ).toEqual([]);
  });
});

describe("readZipBundle, properties", () => {
  const entryName = fc
    .tuple(
      fc.constantFrom("", "m/", "m/tex/", "__MACOSX/", "m/._"),
      fc.constantFrom("a", "b", "tour"),
      fc.constantFrom(".gltf", ".glb", ".bin", ".png", ".txt", ".zip", ".json"),
    )
    .map(([dir, stem, ext]) => dir + stem + ext);

  it("reads every model file it keeps, claims each entry once, and keeps no macOS metadata", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(entryName, { minLength: 1, maxLength: 8 }),
        async (names) => {
          const zip = await zipOf(Object.fromEntries(names.map((n) => [n, n])));
          const bundle = await readZipBundle(zip, "p.zip");
          const isTour = names.some(
            (n) => n.endsWith("tour.json") && !/__MACOSX\/|\/\._/.test(n),
          );
          expect(
            !isTour ||
              (!bundle.ok && bundle.reason === refusal.zipIsTour("p.zip")),
          ).toBe(true);
          if (!bundle.ok) return;
          const kept =
            bundle.kind === "gltf" ? [...bundle.files.keys()] : [bundle.model];
          const claimed = [...kept, ...bundle.others, ...bundle.skipped];
          expect(new Set(claimed).size).toBe(claimed.length);
          for (const name of claimed) {
            expect(/__MACOSX\/|(^|\/)\._/.test(name)).toBe(false);
          }
          for (const name of kept) {
            expect(names).toContain(name);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});
