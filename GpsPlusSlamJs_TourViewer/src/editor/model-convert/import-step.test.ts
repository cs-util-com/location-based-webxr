/**
 * Why these tests matter: this is what the converter's Worker runs for each
 * import. A model it can make must come back as a `.glb` the tour accepts,
 * with what was left out in words; a model it cannot make must come back
 * as a refusal in words (the original is not added, and trying again
 * would not help), which the page tells apart from a failure (a crash, a
 * bad hand-over) that a retry may fix. It must stop when asked, and say
 * how far it is.
 */
import { describe, expect, it, vi } from "vitest";
import { checkGlbInert } from "gps-plus-slam-app-framework/ar/tour-media";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";

import { type GlbParts, readGlb } from "../asset-shelf/glb-file.js";
import {
  boxSpec,
  buildModel,
} from "../asset-shelf/test-support/glb-fixtures.js";
import { OPTIMIZER_SETTINGS } from "../asset-shelf/optimizer-settings.js";
import { convertImport, type ImportPayload } from "./import-step.js";
import { note, refusal } from "./model-import-words.js";
import { splitGlb } from "./test-support/gltf-split.js";

function partsOf(bytes: Uint8Array): GlbParts {
  const read = readGlb(bytes);
  if (!read.ok) throw new Error(read.reason);
  return read.parts;
}

const model = async () =>
  splitGlb(partsOf(await buildModel({ meshes: [boxSpec("a")] })), {
    gltfPath: "bust.gltf",
    bufferNames: ["bust.bin"],
  });

const blobOf = (bytes: Uint8Array) => new Blob([bytes.slice()]);

function loose(files: Map<string, Uint8Array>): ImportPayload {
  return {
    format: "gltf",
    name: "bust.gltf",
    files: [...files].map(([path, bytes]) => ({ path, blob: blobOf(bytes) })),
  };
}

const control = (signal = new AbortController().signal) => ({
  signal,
  progress: vi.fn(),
});

async function glbOf(answer: { blob?: Blob }): Promise<Uint8Array> {
  return new Uint8Array(await answer.blob!.arrayBuffer());
}

describe("convertImport", () => {
  it("makes loose glTF files into one tour model, naming what it used", async () => {
    const files = await model();
    const extra = new Map(files).set("other.png", new Uint8Array(4));
    const steps = control();
    const answer = await convertImport(loose(extra), OPTIMIZER_SETTINGS, steps);
    expect(answer).toMatchObject({
      type: "done",
      extension: "glb",
      conversion: { notes: [], used: ["bust.bin"] },
    });
    expect(checkGlbInert(await glbOf(answer as { blob: Blob }))).toEqual({
      ok: true,
    });
    expect(steps.progress).toHaveBeenCalled();
    const fractions = steps.progress.mock.calls.map(([f]) => f as number);
    expect(fractions.every((f) => f >= 0 && f <= 1)).toBe(true);
  });

  // Why: every loose model of a drop is handed all the drop's parts, so
  // the step cannot know whether a part it did not use is another
  // model's: it reports what it used, and the runner names a part no
  // model of the drop used (model-import-runner).
  it("names no loose part it did not use, and reports the parts it used", async () => {
    const files = new Map(await model())
      .set("stray.bin", new Uint8Array(4))
      .set("wood.tga", new Uint8Array(4))
      .set("photo.png", new Uint8Array(4));
    const answer = await convertImport(
      loose(files),
      OPTIMIZER_SETTINGS,
      control(),
    );
    expect(answer).toMatchObject({
      type: "done",
      conversion: {
        notes: [],
        used: ["bust.bin"],
      },
    });
  });

  // Why: a dropped folder arrives flat, by file name only, so
  // textures/diffuse.png and normals/diffuse.png both arrive as
  // diffuse.png. Taking one of them would give the model the wrong
  // picture without a word; a zip of the folder keeps both apart.
  it("refuses two loose files of the same name, as the zip reader does", async () => {
    const payload = loose(await model());
    const twice: ImportPayload = {
      ...payload,
      files: [
        ...(payload.format === "gltf" ? payload.files : []),
        { path: "diffuse.png", blob: blobOf(new Uint8Array(4)) },
        { path: "diffuse.png", blob: blobOf(new Uint8Array(8)) },
      ],
    };
    expect(await convertImport(twice, OPTIMIZER_SETTINGS, control())).toEqual({
      type: "kept",
      reason: refusal.namedTwice("bust.gltf", "diffuse.png"),
    });
  });

  it("refuses a model it cannot make in words, as kept, not as a failure", async () => {
    const files = await model();
    files.delete("bust.bin");
    expect(
      await convertImport(loose(files), OPTIMIZER_SETTINGS, control()),
    ).toEqual({
      type: "kept",
      reason: refusal.missingFile("bust.gltf", "bust.bin"),
    });
  });

  it("makes a zip of the model's folder, with notes on what it did not use", async () => {
    const files = await model();
    const zip = await packFilesAsZip([
      ...[...files].map(([path, data]) => ({ path: `bust/${path}`, data })),
      { path: "bust/readme.txt", data: "hi" },
    ]);
    const answer = await convertImport(
      { format: "zip", name: "bust.zip", zip },
      OPTIMIZER_SETTINGS,
      control(),
    );
    expect(answer).toMatchObject({
      type: "done",
      extension: "glb",
      conversion: {
        notes: [note.unusedFiles(["bust/readme.txt"])],
        used: ["bust/bust.bin"],
      },
    });
    expect(checkGlbInert(await glbOf(answer as { blob: Blob }))).toEqual({
      ok: true,
    });
  });

  it("takes a .glb from a zip as it is, and refuses a zip with no model", async () => {
    const glb = await buildModel({ meshes: [boxSpec("a")] });
    const withGlb = await packFilesAsZip([{ path: "rock.glb", data: glb }]);
    const answer = await convertImport(
      { format: "zip", name: "rock.zip", zip: withGlb },
      OPTIMIZER_SETTINGS,
      control(),
    );
    expect(answer).toMatchObject({ type: "done", extension: "glb" });
    expect(await glbOf(answer as { blob: Blob })).toEqual(glb);
    const empty = await packFilesAsZip([{ path: "a.txt", data: "x" }]);
    expect(
      await convertImport(
        { format: "zip", name: "e.zip", zip: empty },
        OPTIMIZER_SETTINGS,
        control(),
      ),
    ).toEqual({ type: "kept", reason: refusal.zipNoModel("e.zip") });
  });

  // Why: the page makes one import per model of a zip, each naming its
  // model; each must make that model, and name no other in a note.
  it("makes the model of a zip it is handed by path, naming no other", async () => {
    const a = await buildModel({ meshes: [boxSpec("a")] });
    const b = await buildModel({ meshes: [boxSpec("b"), boxSpec("c")] });
    const zip = await packFilesAsZip([
      { path: "a.glb", data: a },
      { path: "b.glb", data: b },
    ]);
    const answer = await convertImport(
      { format: "zip", name: "set.zip", zip, model: "b.glb" },
      OPTIMIZER_SETTINGS,
      control(),
    );
    expect(answer).toMatchObject({
      type: "done",
      conversion: { notes: [], used: [] },
    });
    expect(await glbOf(answer as { blob: Blob })).toEqual(b);
  });

  it("fails a hand-over that is no import, and stops when it is aborted", async () => {
    for (const payload of [
      null,
      new Blob(["x"]),
      { format: "obj", name: "a.obj", files: [] },
      { format: "gltf", name: "a.gltf", files: [{ path: "a.gltf" }] },
      { format: "zip", name: "a.zip" },
      { format: "zip", name: "a.zip", zip: new Blob(["x"]), model: 3 },
    ]) {
      await expect(
        convertImport(payload, OPTIMIZER_SETTINGS, control()),
        JSON.stringify(payload),
      ).rejects.toThrow("the converter was handed no files it can read");
    }
    const stop = new AbortController();
    stop.abort();
    await expect(
      convertImport(
        loose(await model()),
        OPTIMIZER_SETTINGS,
        control(stop.signal),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("refuses loose files larger together than a model may be, before reading them", async () => {
    const files = await model();
    const payload = loose(files);
    const answer = await convertImport(payload, OPTIMIZER_SETTINGS, control(), {
      maxBytes: 10,
    });
    expect(answer).toEqual({
      type: "kept",
      reason: refusal.tooLarge(
        "bust.gltf",
        [...files.values()].reduce((sum, b) => sum + b.byteLength, 0),
        10,
      ),
    });
  });
});
