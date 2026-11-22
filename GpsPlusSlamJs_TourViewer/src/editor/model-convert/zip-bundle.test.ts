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
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";

import { note, refusal } from "./model-import-words.js";
import { readZipBundle, zipBundleNotes } from "./zip-bundle.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const zipOf = (files: Record<string, string>) =>
  packFilesAsZip(
    Object.entries(files).map(([path, data]) => ({ path, data })),
  );

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
        { model: "a.gltf", files: new Map([["a.gltf", bytes("{}")]]), others: [], skipped: [] },
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
          expect(bundle.ok || !isTour || bundle.reason === refusal.zipIsTour("p.zip")).toBe(true);
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
