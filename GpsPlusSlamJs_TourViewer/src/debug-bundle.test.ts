/**
 * Why these tests matter: the debug bundle is the one file both pages hand
 * the creator when the walk leaves the tour file, and the one the editor
 * reads back to show the debug layer. If it left out a recording entry the
 * creator would lose part of the walk with nothing to see it; if it carried
 * tour content it would not be "debug data"; if it named the wrong tour the
 * editor's "saved from another tour" line would lie; and a hand-edited or
 * foreign file must be refused in words, never crash the editor. These pin
 * the builder on real zips and the reader on every refusal it promises.
 */
import { describe, expect, it } from "vitest";
import {
  packFilesAsZip,
  writeStoreZip,
} from "gps-plus-slam-app-framework/storage";

import {
  buildDebugBundle,
  bundleMatchesTour,
  debugBundleFileName,
  debugBundlePlan,
  readDebugBundle,
  type DebugBundleFound,
  type DebugBundleIdentity,
  type DebugBundleRead,
  type DebugBundleTour,
} from "./debug-bundle.js";
import { readZipBlobEntry, zipBlobEntryNames } from "./zip-blob.js";

const SERIES = "AbCdEfGhIjKlMnOp_-123";
const WHEN = new Date("2026-10-20T12:34:56.789Z");
const now = (): Date => WHEN;

const LISTED: DebugBundleTour = {
  seriesId: SERIES,
  title: "Castle walk",
  fileName: "castle.zip",
};

/** Every kind of entry a Recorder zip writes, plus tour content beside it. */
function recorderNames(wrap: string): { recording: string[]; other: string[] } {
  return {
    recording: [
      `${wrap}session.json`,
      `${wrap}actions/000001.json`,
      `${wrap}actions/000002.json`,
      `${wrap}images/frame-000001.jpg`,
      `${wrap}frames/frame-000002.png`,
      `${wrap}sparse/0/points3D.txt`,
      `${wrap}sparse/0/images.txt`,
      `${wrap}refPoints/ref-1.json`,
    ],
    other: [
      `${wrap}tour.json`,
      `${wrap}content/photo-1.jpg`,
      `${wrap}images/cover.jpg`, // an image of the tour's own, not a frame
      "qr/abc123.json",
      "manifest.json",
      "README.txt",
    ],
  };
}

/** A zip holding `names`, each entry's bytes naming itself. */
async function zipOf(names: readonly string[]): Promise<Blob> {
  return packFilesAsZip(
    names.map((path) => ({ path, data: `bytes of ${path}` })),
  );
}

async function textOf(blob: Blob, name: string): Promise<string> {
  return (await readZipBlobEntry(blob, name)).text();
}

/** A reader over an in-memory map, as the editor's readers hand Blobs. */
function readerOf(files: Record<string, string>) {
  return (name: string): Promise<Blob> => {
    const text = files[name];
    return text === undefined
      ? Promise.reject(new Error(`no ${name}`))
      : Promise.resolve(new Blob([text]));
  };
}

function bundleJson(fields: Record<string, unknown>): string {
  return JSON.stringify({
    format: 1,
    seriesId: SERIES,
    tour: "Castle walk",
    file: "castle.zip",
    writtenAt: WHEN.toISOString(),
    ...fields,
  });
}

/** Read a bundle that carries a recording and this `debug-bundle.json`. */
function readWith(json: string | Blob): Promise<DebugBundleRead> {
  const names = ["actions/000001.json", "debug-bundle.json"];
  return readDebugBundle(names, (name) =>
    name === "debug-bundle.json"
      ? Promise.resolve(typeof json === "string" ? new Blob([json]) : json)
      : Promise.reject(new Error("only the identity is read")),
  );
}

describe("building the debug bundle", () => {
  it("carries every recording entry of a plain Recorder zip, byte for byte at its path, and nothing else", async () => {
    // Why: the bundle is the creator's only copy of the walk once the tour
    // file leaves it out - a missing folder (sparse/, refPoints/) is lost
    // data, and tour content in it would make it more than debug data.
    const { recording, other } = recorderNames("");
    const source = await zipOf([...other, ...recording]);
    const built = await buildDebugBundle(source, LISTED, { now });
    if (built.kind !== "built") throw new Error(built.reason);
    const names = await zipBlobEntryNames(built.blob);
    expect(
      names.filter(
        (n) => !n.startsWith("debug-bundle") && !n.startsWith("about-"),
      ),
    ).toEqual(recording);
    for (const name of recording) {
      expect(await textOf(built.blob, name)).toBe(`bytes of ${name}`);
    }
    expect(names).toContain("debug-bundle.json");
    expect(names).toContain("about-this-debug-data.txt");
  });

  it("keeps a wrapped tour's recording under its folder and writes the identity at the root", async () => {
    // Why: the wrap is kept (the sidecar says why: the rebuild carries
    // entries byte for byte and cannot rename, and every recording reader
    // already tolerates a folder). A builder that stripped or doubled it
    // would leave entries the reader of the bundle cannot find.
    const { recording, other } = recorderNames("mytour/");
    const source = await zipOf([...recording, ...other]);
    const built = await buildDebugBundle(source, LISTED, { now });
    if (built.kind !== "built") throw new Error(built.reason);
    const names = await zipBlobEntryNames(built.blob);
    expect(new Set(names)).toEqual(
      new Set([...recording, "debug-bundle.json", "about-this-debug-data.txt"]),
    );
  });

  it("writes the identity: format 1, the listed tour's series, its title, its file and when", async () => {
    // Why: the editor tells "this tour's debug data" from another tour's by
    // these fields (plan Q-C); a missing seriesId would make every listed
    // tour's bundle read as "another tour".
    const source = await zipOf(recorderNames("").recording);
    const built = await buildDebugBundle(source, LISTED, { now });
    if (built.kind !== "built") throw new Error(built.reason);
    expect(JSON.parse(await textOf(built.blob, "debug-bundle.json"))).toEqual({
      format: 1,
      seriesId: SERIES,
      tour: "Castle walk",
      file: "castle.zip",
      writtenAt: "2026-10-20T12:34:56.789Z",
    });
    expect(built.identity).toEqual({
      seriesId: SERIES,
      tour: "Castle walk",
      file: "castle.zip",
      writtenAt: "2026-10-20T12:34:56.789Z",
    });
    expect(built.filename).toBe("castle-debug.zip");
  });

  it("writes null for an unlisted tour's series and an untitled tour's title", () => {
    // Why: null is the format's "not known", which the matcher reads as no
    // evidence; an empty string or "undefined" would be compared as a value.
    const plan = debugBundlePlan(
      ["actions/000001.json"],
      { seriesId: null, title: "   ", fileName: undefined },
      WHEN,
    );
    expect(plan?.identity).toEqual({
      seriesId: null,
      tour: null,
      file: null,
      writtenAt: WHEN.toISOString(),
    });
  });

  it("says in its note what it is and where it came from, and never calls the frames photos", () => {
    // Why: the note is what a person finds in the zip months later; the
    // recorded frames are debug camera captures (plan M1 step 5), not the
    // tour's photos, and the words must say so.
    const plan = debugBundlePlan(["actions/000001.json"], LISTED, WHEN);
    const note = plan?.added.find(
      (e) => e.path === "about-this-debug-data.txt",
    );
    const text = note?.data;
    if (typeof text !== "string") throw new Error("no note written");
    expect(text).toContain("debug data");
    expect(text).toContain("debug camera captures");
    expect(text).toContain("castle.zip");
    expect(text).toContain('"Castle walk"');
    expect(text).toContain(SERIES);
    expect(text).not.toMatch(/photo/i);
  });

  it("refuses an archive without an action stream, and writes nothing", async () => {
    // Why: no action stream, no walk (`recordingEntryNames`): a tour's own
    // session.json or frame-named image is then just a file, and a bundle
    // of it would be debug data of nothing.
    const source = await zipOf([
      "tour.json",
      "session.json",
      "images/frame-000001.jpg",
    ]);
    const built = await buildDebugBundle(source, LISTED, { now });
    expect(built.kind).toBe("refused");
    expect(
      debugBundlePlan(["tour.json", "session.json"], LISTED, WHEN),
    ).toBeNull();
  });

  it("replaces an identity the source already carries instead of failing on it", async () => {
    // Why: a bundle bundled again (a debug bundle opened as a tour's
    // source) carries `debug-bundle.json` and the note already; the
    // rebuild refuses a path that is both removed and written, so the plan
    // must not list them for removal.
    const source = await zipOf([
      "debug-bundle.json",
      "about-this-debug-data.txt",
      "actions/000001.json",
    ]);
    const built = await buildDebugBundle(source, LISTED, { now });
    if (built.kind !== "built") throw new Error(built.reason);
    const names = await zipBlobEntryNames(built.blob);
    expect([...names].sort()).toEqual([
      "about-this-debug-data.txt",
      "actions/000001.json",
      "debug-bundle.json",
    ]);
    const identity = JSON.parse(
      await textOf(built.blob, "debug-bundle.json"),
    ) as { file?: unknown };
    expect(identity.file).toBe("castle.zip");
  });

  it("follows an archive written with ./ on every entry, and reads it back", async () => {
    // Why: some zip tools prefix every entry with ./; the rebuild then puts
    // new entries under the prefix too, so the reader must find
    // `./debug-bundle.json` as the identity.
    const source = await writeStoreZip(
      ["./session.json", "./actions/000001.json", "./tour.json"].map(
        (path) => ({
          path,
          data: path,
        }),
      ),
      "test",
    );
    const built = await buildDebugBundle(source, LISTED, { now });
    if (built.kind !== "built") throw new Error(built.reason);
    const names = await zipBlobEntryNames(built.blob);
    expect(names).toContain("./debug-bundle.json");
    expect(names).not.toContain("./tour.json");
    const read = await readDebugBundle(names, (n) =>
      readZipBlobEntry(built.blob, n),
    );
    expect(read).toEqual({ kind: "bundle", identity: built.identity });
  });

  it("refuses an identity the format cannot carry, as a programmer error", () => {
    // Why: what the writer writes, the reader must read back (the round
    // trip property); a series id or a time the reader refuses must fail
    // here, loudly, not produce a bundle the editor then calls malformed.
    expect(() =>
      debugBundlePlan(
        ["actions/1.json"],
        { ...LISTED, seriesId: "not a series id" },
        WHEN,
      ),
    ).toThrow(RangeError);
    expect(() =>
      debugBundlePlan(["actions/1.json"], LISTED, new Date(Number.NaN)),
    ).toThrow(RangeError);
    expect(() =>
      debugBundlePlan(
        ["actions/1.json"],
        LISTED,
        new Date("+012345-01-01T00:00:00Z"),
      ),
    ).toThrow(RangeError);
  });

  it("clips an over-long title to the format's cap rather than failing the save", () => {
    // Why: tour.json does not cap a title, so a hand-made tour may carry a
    // long one; saving the debug data must not fail over it.
    const plan = debugBundlePlan(
      ["actions/1.json"],
      { ...LISTED, title: "x".repeat(2000) },
      WHEN,
    );
    expect(plan?.identity.tour).toBe("x".repeat(512));
  });
});

describe("the tour's own id in the identity", () => {
  // Why (r901 review #2): the tour's own id (`tour.json`'s `tourId`)
  // survives a rename and a retitle, and an unlisted tour has nothing
  // else that does - so a bundle that carries it is matched on it first.
  // It is optional: a bundle written before it, or of a tour without one,
  // reads as before.
  const TOUR_ID = "0123456789abcdef0123456789abcdef";

  /** The `debug-bundle.json` text a plan writes. */
  function identityOf(plan: ReturnType<typeof debugBundlePlan>): string {
    const json = plan?.added.find((e) => e.path === "debug-bundle.json")?.data;
    if (typeof json !== "string") throw new Error("no identity written");
    return json;
  }

  it("writes the tour's id when it has one, and reads it back", async () => {
    const plan = debugBundlePlan(
      ["actions/000001.json"],
      { ...LISTED, tourId: TOUR_ID },
      WHEN,
    );
    if (plan === null) throw new Error("no plan");
    expect(plan.identity.tourId).toBe(TOUR_ID);
    const json = identityOf(plan);
    expect(JSON.parse(json)).toMatchObject({ tourId: TOUR_ID });
    expect(await readWith(json)).toEqual({
      kind: "bundle",
      identity: plan.identity,
    });
  });

  it("writes no id for a tour without one, and reads a bundle without it", async () => {
    const plan = debugBundlePlan(
      ["actions/000001.json"],
      { ...LISTED, tourId: null },
      WHEN,
    );
    const json = identityOf(plan);
    expect("tourId" in (JSON.parse(json) as object)).toBe(false);
    const read = await readWith(bundleJson({}));
    expect(read.kind === "bundle" && "tourId" in read.identity).toBe(false);
  });

  it("reads a bundle whose id is not one a tour carries as having none", async () => {
    // As the tour reader treats a bad tourId: it costs the id, never the
    // file.
    for (const tourId of [null, 7, "", "has space", "x".repeat(65)]) {
      const read = await readWith(bundleJson({ tourId }));
      expect(read.kind).toBe("bundle");
      expect(read.kind === "bundle" && "tourId" in read.identity).toBe(false);
    }
  });

  it("refuses to write an id a tour cannot carry, as a programmer error", () => {
    expect(() =>
      debugBundlePlan(["actions/1.json"], { ...LISTED, tourId: "a b" }, WHEN),
    ).toThrow(RangeError);
  });

  it("matches on the tour's id first, when both sides carry one", () => {
    const withoutId: DebugBundleIdentity = {
      seriesId: SERIES,
      tour: "Castle walk",
      file: "castle.zip",
      writtenAt: WHEN.toISOString(),
    };
    const bundle: DebugBundleFound = {
      kind: "bundle",
      identity: { ...withoutId, tourId: TOUR_ID },
    };
    // The same id: this tour's, though everything else differs.
    expect(
      bundleMatchesTour(bundle, {
        seriesId: "OtherSeries_123456",
        tourId: TOUR_ID,
        title: "Other",
        fileName: "other.zip",
      }),
    ).toBe("this-tour");
    // Another id: another tour's, though everything else is the same.
    expect(
      bundleMatchesTour(bundle, { ...LISTED, tourId: "another_tour_id" }),
    ).toBe("other-tour");
    // One side without an id: the series, then the names decide.
    expect(bundleMatchesTour(bundle, { ...LISTED, tourId: null })).toBe(
      "this-tour",
    );
    expect(
      bundleMatchesTour(
        { kind: "bundle", identity: withoutId },
        { ...LISTED, tourId: "another_tour_id" },
      ),
    ).toBe("this-tour");
  });
});

describe("the bundle's file name", () => {
  it("is the tour's name with -debug before .zip, as the walk's was with -walk", () => {
    // Why: the creator finds the two files side by side by name.
    expect(debugBundleFileName("castle.zip")).toBe("castle-debug.zip");
    expect(debugBundleFileName("Castle.ZIP")).toBe("Castle-debug.zip");
    expect(debugBundleFileName("castle")).toBe("castle-debug.zip");
    expect(debugBundleFileName("a.zip.zip")).toBe("a.zip-debug.zip");
  });

  it("falls back to tour-debug.zip for a tour without a usable name", () => {
    // Why: a name of nothing would give "-debug.zip", a hidden-looking file.
    expect(debugBundleFileName("")).toBe("tour-debug.zip");
    expect(debugBundleFileName("  .zip ")).toBe("tour-debug.zip");
    expect(debugBundleFileName(null)).toBe("tour-debug.zip");
  });
});

describe("reading a bundle back", () => {
  it("reads the identity of a bundle", async () => {
    // Why: the editor's line about which tour this debug data is from.
    expect(await readWith(bundleJson({}))).toEqual({
      kind: "bundle",
      identity: {
        seriesId: SERIES,
        tour: "Castle walk",
        file: "castle.zip",
        writtenAt: WHEN.toISOString(),
      },
    });
  });

  it("reads a plain Recorder zip as a recording, with no identity", async () => {
    // Why: a Recorder zip is a debug bundle in all but name (plan M2 step
    // 5) and must be accepted, but it names no tour.
    const read = await readDebugBundle(
      ["session.json", "actions/000001.json", "images/frame-000001.jpg"],
      readerOf({}),
    );
    expect(read).toEqual({ kind: "recording" });
  });

  it("finds the identity under one more folder, as a re-zipped bundle has it", async () => {
    // Why: unzipping a bundle and zipping its folder again wraps every
    // entry once more; the recording readers tolerate that, so this does.
    const read = await readDebugBundle(
      ["castle-debug/debug-bundle.json", "castle-debug/actions/000001.json"],
      readerOf({ "castle-debug/debug-bundle.json": bundleJson({}) }),
    );
    expect(read.kind).toBe("bundle");
  });

  it("refuses a file that carries no recording, with or without an identity", async () => {
    // Why: without an action stream there is nothing to show; a bare
    // identity is not debug data of anything.
    for (const names of [
      ["tour.json", "content/a.jpg"],
      ["debug-bundle.json", "session.json"],
      [],
    ]) {
      const read = await readDebugBundle(
        names,
        readerOf({ "debug-bundle.json": bundleJson({}) }),
      );
      expect(read).toMatchObject({ kind: "refused", code: "no-recording" });
    }
  });

  it("refuses a file naming more than one identity", async () => {
    // Why: two identities give two answers to "which tour"; picking one
    // would be a guess presented as a fact.
    const read = await readDebugBundle(
      ["debug-bundle.json", "old/debug-bundle.json", "actions/000001.json"],
      readerOf({
        "debug-bundle.json": bundleJson({}),
        "old/debug-bundle.json": bundleJson({}),
      }),
    );
    expect(read).toMatchObject({ kind: "refused", code: "ambiguous" });
  });

  it("refuses a format it does not know as newer, and a non-number format as malformed", async () => {
    // Why: a format 2 bundle is a newer Tour Viewer's, and saying so tells
    // the creator what to do; reading it as format 1 could misname a tour.
    expect(await readWith(bundleJson({ format: 2 }))).toMatchObject({
      kind: "refused",
      code: "unknown-format",
    });
    expect(await readWith(bundleJson({ format: "1" }))).toMatchObject({
      kind: "refused",
      code: "malformed",
    });
  });

  it("refuses wrong types, missing fields and bad JSON as malformed, without throwing", async () => {
    // Why: the file is untrusted (plan M2 step 5); a hand-edited or foreign
    // debug-bundle.json must become a refusal in words, never an exception
    // that takes the editor's open down with it.
    const bad = [
      "not json",
      "null",
      "[1]",
      '"text"',
      bundleJson({ seriesId: 5 }),
      bundleJson({ seriesId: "has spaces" }),
      bundleJson({ tour: ["a"] }),
      bundleJson({ file: { name: "x" } }),
      bundleJson({ writtenAt: "yesterday" }),
      bundleJson({ writtenAt: "2026-02-30T00:00:00.000Z" }),
      bundleJson({ writtenAt: 12 }),
      JSON.stringify({
        format: 1,
        seriesId: null,
        tour: null,
        writtenAt: WHEN.toISOString(),
      }),
    ];
    for (const json of bad) {
      expect(await readWith(json), json).toMatchObject({
        kind: "refused",
        code: "malformed",
      });
    }
  });

  it("refuses an oversized identity file before reading it, and an oversized field", async () => {
    // Why: the identity is a few hundred bytes; a large one is not ours,
    // and its text is not read into memory to find that out.
    // Valid in every field, padded past the cap with whitespace JSON
    // allows: only the size check can refuse it.
    const big = new Blob([bundleJson({}) + " ".repeat(20 * 1024)]);
    expect(await readWith(big)).toMatchObject({
      kind: "refused",
      code: "too-large",
    });
    expect(await readWith(bundleJson({ tour: "x".repeat(600) }))).toMatchObject(
      {
        kind: "refused",
        code: "too-large",
      },
    );
  });

  it("refuses an identity whose declared size is past the cap, without reading it", async () => {
    // Why (r901 review #10): a blob's size is known only once the entry was
    // inflated; the zip's directory says it first, so an oversized identity
    // is refused before any of it is read.
    let reads = 0;
    const read = await readDebugBundle(
      ["actions/000001.json", "debug-bundle.json"],
      () => {
        reads += 1;
        return Promise.resolve(new Blob([bundleJson({})]));
      },
      { sizeOf: (name) => (name === "debug-bundle.json" ? 17 * 1024 : 0) },
    );
    expect(read).toMatchObject({ kind: "refused", code: "too-large" });
    expect(reads).toBe(0);
    // A declared size within the cap is read; the read's own size is still
    // checked, since a directory can understate it.
    const small = await readDebugBundle(
      ["actions/000001.json", "debug-bundle.json"],
      () => Promise.resolve(new Blob([bundleJson({})])),
      { sizeOf: () => 200 },
    );
    expect(small.kind).toBe("bundle");
  });

  it("refuses an identity that cannot be read, without throwing", async () => {
    // Why: a cap or a corrupt entry throws in the zip reader; the bundle
    // is a second, optional file, so its failure is a refusal.
    const read = await readDebugBundle(
      ["debug-bundle.json", "actions/000001.json"],
      () => Promise.reject(new Error("cap")),
    );
    expect(read).toMatchObject({ kind: "refused", code: "unreadable" });
  });

  it("reads the text fields as the writer writes them: trimmed, empty as null", async () => {
    // Why: a hand-edited " Castle " is still that tour; the matcher
    // compares normalised text on both sides.
    const read = await readWith(
      bundleJson({ tour: "  Castle walk ", file: "" }),
    );
    expect(read).toMatchObject({
      kind: "bundle",
      identity: { tour: "Castle walk", file: null },
    });
  });
});

describe("does the bundle belong to this tour", () => {
  const identity = (
    fields: Partial<DebugBundleIdentity>,
  ): DebugBundleFound => ({
    kind: "bundle",
    identity: {
      seriesId: null,
      tour: "Castle walk",
      file: "castle.zip",
      writtenAt: WHEN.toISOString(),
      ...fields,
    },
  });

  it("matches a listed tour on its series alone", () => {
    // Why: a listed tour's series survives a rename and a retitle; its
    // title or file name says nothing once the series differs.
    expect(
      bundleMatchesTour(identity({ seriesId: SERIES }), {
        ...LISTED,
        title: "New",
      }),
    ).toBe("this-tour");
    expect(
      bundleMatchesTour(identity({ seriesId: "OtherSeries_123456" }), LISTED),
    ).toBe("other-tour");
  });

  it("falls back to the title and the file name for a listed tour's bundle saved before it was listed", () => {
    // Why (plan section 10, changed when M2 wired the module): a bundle
    // without a series id was saved while the tour was unlisted, so the
    // series says nothing either way - the unlisted rule decides. It used
    // to read as "other-tour", which called the tour's own walk another
    // tour's once the tour was listed.
    expect(bundleMatchesTour(identity({ seriesId: null }), LISTED)).toBe(
      "this-tour",
    );
    expect(
      bundleMatchesTour(identity({ seriesId: null }), {
        ...LISTED,
        title: "Renamed",
      }),
    ).toBe("this-tour");
    expect(
      bundleMatchesTour(identity({ seriesId: null }), {
        seriesId: SERIES,
        title: "Other",
        fileName: "other.zip",
      }),
    ).toBe("other-tour");
    // A bundle that names a series is still judged on it alone.
    expect(
      bundleMatchesTour(identity({ seriesId: "OtherSeries_123456" }), LISTED),
    ).toBe("other-tour");
  });

  it("matches an unlisted tour unless its title AND its file name both differ", () => {
    // Why: the plan's rule (Q-C): a renamed file or an edited title alone
    // is still this tour; only both differing says "another tour".
    const unlisted: DebugBundleTour = {
      seriesId: null,
      title: "Castle walk",
      fileName: "castle.zip",
    };
    expect(bundleMatchesTour(identity({}), unlisted)).toBe("this-tour");
    expect(
      bundleMatchesTour(identity({}), { ...unlisted, title: "Renamed" }),
    ).toBe("this-tour");
    expect(
      bundleMatchesTour(identity({}), {
        ...unlisted,
        fileName: "castle (1).zip",
      }),
    ).toBe("this-tour");
    expect(
      bundleMatchesTour(identity({}), {
        seriesId: null,
        title: "Other",
        fileName: "other.zip",
      }),
    ).toBe("other-tour");
  });

  it("never matches on a title or file name neither side knows", () => {
    // Why: two untitled tours are not the same tour; "no title" is no
    // evidence either way.
    expect(
      bundleMatchesTour(identity({ tour: null, file: null }), {
        seriesId: null,
        title: undefined,
        fileName: null,
      }),
    ).toBe("other-tour");
  });

  it("compares the tour's title as the writer clipped it", () => {
    // Why: an over-long title is written clipped; the same tour must still
    // match its own bundle.
    const long = "y".repeat(900);
    const plan = debugBundlePlan(
      ["actions/1.json"],
      { seriesId: null, title: long, fileName: null },
      WHEN,
    );
    if (plan === null) throw new Error("no plan");
    expect(
      bundleMatchesTour(
        { kind: "bundle", identity: plan.identity },
        { seriesId: null, title: long, fileName: null },
      ),
    ).toBe("this-tour");
  });

  it("calls a plain recording its own case", () => {
    // Why: a Recorder zip carries no identity, so it is neither this tour's
    // nor another's: "a recording, not saved from this tour".
    expect(bundleMatchesTour({ kind: "recording" }, LISTED)).toBe("recording");
  });
});
