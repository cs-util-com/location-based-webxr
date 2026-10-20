/**
 * Why these tests matter: the Finish's rules - which entries a finished
 * tour writes and removes, a listed tour's series continued, the newest
 * bytes as the input - are what the phone's Finish and the desktop editor
 * (M6 E0, B10's "shared business logic") must agree on. A desktop save that
 * called the raw rebuild would leave deleted photos, a dead signature or a
 * broken series list (M6 design §5, cold review #2). These pin the shared
 * module's contract directly, on real zips; `creator-finish.test.ts` still
 * pins the phone's wiring around it.
 */
import { describe, expect, it, vi } from "vitest";
import {
  DecompressionBudget,
  packFilesAsZip,
} from "gps-plus-slam-app-framework/storage";
import {
  readStoredCentralDirectory,
  readStoredEntryBytes,
} from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
  type TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  finishedFileName,
  pendingAfterRebuild,
  rebuildFinishedTour,
} from "./finish-rebuild.js";
import { openTourFile, type TourSession } from "./tour-session.js";
import {
  buildListedTourFixture,
  buildSignedTourFixture,
  generateFixtureKey,
} from "./test-support/tour-signing-fixture.js";
import {
  stationIdOf,
  tourOf,
  withWorldObjects,
} from "./test-support/v3-tour.js";
import { withTourContent } from "./tour-content.js";

const WRAP = "mytour/";
const LEVEL_ID = "abc123";

function pin(id: string, label = `pin ${id}`): TourObject {
  return {
    id,
    kind: "pin",
    label,
    createdAtIso: "2026-09-11T00:00:01.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
  };
}

function photo(id: string): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-09-11T00:00:01.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

function manifestOf(objects: readonly TourObject[]): TourManifest {
  return tourOf([...objects]);
}

/** A station for the objects a test places: the tour document seats every
 *  object before a write, and the writer assigns none. */
const HERE: TourStation = {
  id: "here",
  geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  activateRadiusM: 50,
  foundRadiusM: 25,
  hint: "arrow",
  steps: [],
  items: [],
};

/** An empty tour with `HERE`. */
function hereTour(): TourManifest {
  return tourOf([], { stations: [HERE] });
}

/** `object` as the tour document seats it, in station `id`. */
function seated(object: TourObject, id = HERE.id): TourObject {
  return { ...object, station: id };
}

async function open(blob: Blob): Promise<TourSession> {
  return openTourFile(
    new File([blob], "mytour.zip", { type: "application/zip" }),
  );
}

/** A plain (unlisted) wrapped tour with these objects and content files. */
async function plainTour(
  objects: readonly TourObject[],
  content: Record<string, string> = {},
): Promise<TourSession> {
  return open(
    await packFilesAsZip([
      {
        path: `${WRAP}tour.json`,
        data: serializeTourManifest(manifestOf(objects)),
      },
      { path: `${WRAP}qr/${LEVEL_ID}.json`, data: '{"old":true}' },
      ...Object.entries(content).map(([path, data]) => ({
        path: `${WRAP}${path}`,
        data,
      })),
    ]),
  );
}

async function namesOf(blob: Blob): Promise<string[]> {
  return readStoredCentralDirectory(
    new Uint8Array(await blob.arrayBuffer()),
  ).map((e) => e.name);
}

/** An entry's text as the zip stores it - the bytes, not a report of
 *  them (E0 review #1: the in-memory manifest is no proof). */
async function textOf(blob: Blob, name: string): Promise<string | undefined> {
  const bytes = readStoredEntryBytes(
    new Uint8Array(await blob.arrayBuffer()),
    name,
  );
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
}

/** The manifest the zip carries, parsed from its bytes, with its pins
 *  and photos in the world (version 3 keeps them in stations). */
async function zipManifest(
  blob: Blob,
): Promise<ReturnType<typeof withWorldObjects>> {
  const text = await textOf(blob, `${WRAP}tour.json`);
  expect(text, "the zip must carry tour.json").toBeDefined();
  return withWorldObjects(parseTourManifest(JSON.parse(text!)));
}

/** The edits a test does not care about. */
const NO_EDITS = {
  placed: [],
  deleted: [],
  levels: [],
  keepScan: false,
  previous: null,
} as const;

describe("rebuildFinishedTour (M6 E0: the Finish's rules, shared)", () => {
  it("writes the edits: an edit in place, a new object appended, a deleted photo's file removed, the level replaced inside the wrap", async () => {
    const tour = await plainTour([pin("a"), photo("gone"), photo("kept")], {
      "content/gone.jpg": "gone",
      "content/kept.jpg": "kept",
    });
    const manifest = manifestOf([pin("a"), photo("gone"), photo("kept")]);
    const result = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest,
      placed: [
        { object: pin("a", "new text") },
        { object: seated(pin("b"), stationIdOf("a")) },
      ],
      deleted: ["gone"],
      levels: [{ id: LEVEL_ID, json: '{"new":true}' }],
    });
    expect(result).not.toBeNull();
    const carried = await zipManifest(result!.blob);
    // In station order (version 3): the new "b" in the station it names,
    // a's.
    expect(carried.objects.map((o) => o.id)).toEqual(["a", "b", "kept"]);
    expect(carried.objects[0]).toMatchObject({ label: "new text" });
    // What it reports writing is what the zip carries.
    expect(withWorldObjects(result!.written)).toEqual(carried);
    const names = await namesOf(result!.blob);
    expect(names).not.toContain(`${WRAP}content/gone.jpg`);
    expect(names).toContain(`${WRAP}content/kept.jpg`);
    // The level is REPLACED inside the wrap: one copy, with the new bytes.
    expect(names.filter((n) => n.endsWith(`${LEVEL_ID}.json`))).toEqual([
      `${WRAP}qr/${LEVEL_ID}.json`,
    ]);
    await expect(
      textOf(result!.blob, `${WRAP}qr/${LEVEL_ID}.json`),
    ).resolves.toBe('{"new":true}');
    await tour.close();
  });

  // Why (tour editor plan 2026-10-17-1816, W2): an emptied name used to
  // keep the old title silently, so a creator could not remove it. Now the
  // phone's own name field says what the title is: typed, emptied (gone),
  // or never touched (null: the tour keeps its own).
  it("titles the tour with a typed name, removes it for an emptied one, keeps its own for none", async () => {
    const tour = await plainTour([]);
    const own = { ...manifestOf([]), title: "Old name" };
    const typed = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: own,
      title: "  New name ",
    });
    expect((await zipManifest(typed!.blob)).title).toBe("New name");
    const blank = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: own,
      title: "   ",
    });
    expect(blank!.written).not.toHaveProperty("title");
    expect(await zipManifest(blank!.blob)).not.toHaveProperty("title");
    const untouched = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: own,
      title: null,
    });
    expect(untouched!.written.title).toBe("Old name");
    await tour.close();
  });

  it("continues a listed tour's series: the same series, the next version, every file listed", async () => {
    const fixture = await buildListedTourFixture(
      {
        "tour.json": serializeTourManifest(manifestOf([pin("a")])),
        "content/kept.jpg": "0123456789",
      },
      { wrap: WRAP, version: 3 },
    );
    const tour = await open(new Blob([fixture.zip]));
    expect(tour.integrity.kind).toBe("listed");
    const result = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: manifestOf([pin("a")]),
      placed: [{ object: seated(pin("b"), stationIdOf("a")) }],
      now: () => new Date("2026-10-13T18:00:00.000Z"),
    });
    expect(result!.signedManifest).toMatchObject({
      seriesId: fixture.manifest.seriesId,
      version: 4,
      createdAt: "2026-10-13T18:00:00.000Z",
    });
    const next = await open(result!.blob);
    expect(next.integrity).toMatchObject({
      kind: "listed",
      signature: null,
      manifest: { seriesId: fixture.manifest.seriesId, version: 4 },
    });
    await expect(next.wholeArchiveCheck).resolves.toBe("checked");
    await next.close();
    await tour.close();
  });

  it("rebuilds from the previous result's bytes, not the tour's, when there is one", async () => {
    // The second-finish bug (PR #435 review): rebuilding from the hosted
    // zip again drops the first batch's content entries.
    const tour = await plainTour([]);
    const first = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: hereTour(),
      placed: [{ object: seated(photo("p1")), blob: new Blob(["jpg"]) }],
    });
    const read = vi.spyOn(tour, "readWholeArchive");
    const second = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: first!.written,
      placed: [{ object: seated(pin("b")) }],
      previous: { blob: first!.blob },
    });
    expect(read).not.toHaveBeenCalled();
    expect(await namesOf(second!.blob)).toContain(`${WRAP}content/p1.jpg`);
    expect((await zipManifest(second!.blob)).objects.map((o) => o.id)).toEqual([
      "p1",
      "b",
    ]);
    await tour.close();
  });

  // (A test that a Finish wrote the walk's photos as the open baked them,
  // and a later Finish kept them, stood here: the open bakes none, and
  // the document drops a file's - `withoutDebugCaptures`.)

  it("stops without rebuilding when the caller no longer wants the result", async () => {
    const tour = await plainTour([]);
    const progress = vi.fn();
    const result = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: hereTour(),
      placed: [{ object: seated(pin("b")) }],
      shouldContinue: () => false,
      onProgress: progress,
    });
    expect(result).toBeNull();
    expect(progress).not.toHaveBeenCalled();
    await tour.close();
  });

  it("leaves the walk out, and keeps it only when asked", async () => {
    // Why: visitors download the published copy, and the walk is the
    // creator's: no copy keeps it unless the creator asks. (This ran with
    // and without baked photo spots too, which once decided it; nothing
    // writes spots now.)
    const walk = [`${WRAP}session.json`, `${WRAP}actions/000001.json`];
    const tour = await plainTour([], {
      "session.json": "{}",
      "actions/000001.json": "[]",
    });
    const run = async (keepScan: boolean) => {
      const r = await rebuildFinishedTour({
        ...NO_EDITS,
        tour,
        manifest: manifestOf([]),
        keepScan,
      });
      return { left: r!.scanLeftOut, names: await namesOf(r!.blob) };
    };
    const out = await run(false);
    expect([...out.left].sort()).toEqual([...walk].sort());
    for (const name of walk) expect(out.names).not.toContain(name);
    const kept = await run(true);
    expect(kept.left).toEqual([]);
    for (const name of walk) expect(kept.names).toContain(name);
    await tour.close();
  });

  it("drops a signed tour's signature and continues its list unsigned", async () => {
    const fixture = await buildSignedTourFixture(
      { "tour.json": serializeTourManifest(manifestOf([])) },
      await generateFixtureKey(),
      { wrap: WRAP, version: 2 },
    );
    const tour = await open(new Blob([fixture.zip]));
    const result = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: hereTour(),
      placed: [{ object: seated(pin("b")) }],
    });
    expect(await namesOf(result!.blob)).not.toContain(
      `${WRAP}manifest.sig.json`,
    );
    const next = await open(result!.blob);
    expect(next.integrity).toMatchObject({
      kind: "listed",
      signature: null,
      manifest: { version: 3 },
    });
    await next.close();
    await tour.close();
  });

  it("rebuilds the hosted zip under the tour's budget, a previous rebuild without it", async () => {
    // K0 milestone review R1: the hosted archive is untrusted; a previous
    // rebuild is the page's own output. A budget too small for the
    // archive stands in for a deflate bomb.
    const real = await plainTour([], { "content/big.jpg": "0123456789" });
    const first = await rebuildFinishedTour({
      ...NO_EDITS,
      tour: real,
      manifest: manifestOf([]),
    });
    const tiny: Parameters<typeof rebuildFinishedTour>[0]["tour"] = {
      entries: real.entries,
      manifestWrap: real.manifestWrap,
      integrity: real.integrity,
      readWholeArchive: () => real.readWholeArchive(),
      budget: new DecompressionBudget({ maxEntryBytes: 4, maxTotalBytes: 4 }),
    };
    await expect(
      rebuildFinishedTour({
        ...NO_EDITS,
        tour: tiny,
        manifest: manifestOf([]),
      }),
    ).rejects.toThrow(/too large once unpacked/);
    // Omitted counts as "no previous" too, under the budget (review #8).
    const { previous: _omitted, ...noPrevious } = NO_EDITS;
    await expect(
      rebuildFinishedTour({
        ...noPrevious,
        tour: tiny,
        manifest: manifestOf([]),
      }),
    ).rejects.toThrow(/too large once unpacked/);
    await expect(
      rebuildFinishedTour({
        ...NO_EDITS,
        tour: tiny,
        manifest: first!.written,
        previous: { blob: first!.blob },
      }),
    ).resolves.not.toBeNull();
    await real.close();
  });

  it("a rebuild chained on a previous one stays at the open-time version + 1, listing both batches", async () => {
    // E0 review #3: every rebuild of one open tour continues the list the
    // tour was OPENED with - one version for the page load, however often
    // it saves. E2's "one version per editing session" builds on this.
    const fixture = await buildListedTourFixture(
      { "tour.json": serializeTourManifest(manifestOf([])) },
      { wrap: WRAP, version: 3 },
    );
    const tour = await open(new Blob([fixture.zip]));
    const first = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: hereTour(),
      placed: [{ object: seated(photo("p1")), blob: new Blob(["jpg"]) }],
    });
    const second = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: first!.written,
      placed: [{ object: seated(pin("b")) }],
      previous: {
        blob: first!.blob,
        ...(first!.signedManifest === undefined
          ? {}
          : { signedManifest: first!.signedManifest }),
      },
    });
    expect(second!.signedManifest?.version).toBe(4);
    const next = await open(second!.blob);
    expect(next.integrity).toMatchObject({ manifest: { version: 4 } });
    // The first batch's photo is in the zip AND in the list.
    await expect(next.wholeArchiveCheck).resolves.toBe("checked");
    expect(await namesOf(second!.blob)).toContain(`${WRAP}content/p1.jpg`);
    await next.close();
    await tour.close();
  });
});

describe("rebuildFinishedTour drops the assets nothing uses", () => {
  // Why this test matters: the write is where an asset nothing names any
  // more leaves the tour - from the manifest AND from the zip, or every
  // copy keeps carrying its bytes. Read from the zip's bytes, so a manifest
  // that only says so would not pass.
  it("writes the step's asset and the cover, and leaves out a stray asset's entry", async () => {
    const told: TourStation = {
      ...HERE,
      steps: [
        {
          id: "look",
          block: { kind: "image", asset: "used" },
          advance: { mode: "tap" },
        },
      ],
    };
    const manifest = tourOf([], {
      stations: [told],
      assets: [
        { id: "used", path: "content/used.png", kind: "image" },
        { id: "cover-art", path: "content/cover-art.png", kind: "image" },
        { id: "stray", path: "content/stray.png", kind: "image" },
      ],
      cover: "cover-art",
    });
    const tour = await open(
      await packFilesAsZip([
        { path: `${WRAP}tour.json`, data: serializeTourManifest(manifest) },
        { path: `${WRAP}content/used.png`, data: "u" },
        { path: `${WRAP}content/cover-art.png`, data: "c" },
        { path: `${WRAP}content/stray.png`, data: "s" },
      ]),
    );
    const result = await rebuildFinishedTour({ tour, manifest, ...NO_EDITS });
    const names = await namesOf(result!.blob);
    expect(names).toContain(`${WRAP}content/used.png`);
    expect(names).toContain(`${WRAP}content/cover-art.png`);
    expect(names).not.toContain(`${WRAP}content/stray.png`);
    const written = parseTourManifest(
      JSON.parse((await textOf(result!.blob, `${WRAP}tour.json`))!),
    );
    expect(written.assets.map((a) => a.id)).toEqual(["used", "cover-art"]);
  });

  it("writes a placed model's file, and leaves out a model asset no item or step names", async () => {
    // Why: a placed model names its model file as an asset, not as a
    // content file of its own. Were the item not counted as naming it, the
    // write would delete the model's file from every copy; were every model
    // asset kept, a model the creator replaced would ride along for good.
    const statue: TourObject = {
      id: "m1",
      kind: "model",
      asset: "statue",
      sizeM: 4,
      createdAtIso: "2026-10-20T00:00:00.000Z",
      geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
    };
    const manifest = tourOf([statue], {
      assets: [
        { id: "statue", path: "content/statue.glb", kind: "model" },
        { id: "spare", path: "content/spare.glb", kind: "model" },
      ],
    });
    const tour = await open(
      await packFilesAsZip([
        { path: `${WRAP}tour.json`, data: serializeTourManifest(manifest) },
        { path: `${WRAP}content/statue.glb`, data: "glTF-statue" },
        { path: `${WRAP}content/spare.glb`, data: "glTF-spare" },
      ]),
    );
    const result = await rebuildFinishedTour({ tour, manifest, ...NO_EDITS });
    const names = await namesOf(result!.blob);
    expect(names).toContain(`${WRAP}content/statue.glb`);
    expect(names).not.toContain(`${WRAP}content/spare.glb`);
    const written = parseTourManifest(
      JSON.parse((await textOf(result!.blob, `${WRAP}tour.json`))!),
    );
    expect(written.assets.map((a) => a.id)).toEqual(["statue"]);
    expect(withWorldObjects(written).objects.map((o) => o.id)).toEqual(["m1"]);
  });
});

describe("pendingAfterRebuild (M6 E0b: what is still to save after a write)", () => {
  // Why: a page that keeps editing while a save runs (the phone's Finish
  // during a rebuild, the desktop editor's continuous saving) must drop
  // exactly what the written zip carries - by CONTENT, not id: an object
  // edited again while the zip was rebuilt is in neither and waits for the
  // next save (M2c review #6). The phone had this inline; E2 needs it too.
  const written = manifestOf([pin("a", "saved text"), pin("b")]);

  it("drops what the zip carries with the same content, keeps a later edit and a new placement", () => {
    const savedA = { object: pin("a", "saved text") };
    const editedAgain = { object: pin("b", "edited during the save") };
    const placedDuring = { object: pin("c") };
    const out = pendingAfterRebuild(
      { placed: [savedA, editedAgain, placedDuring], deleted: [] },
      written,
      [],
    );
    expect(out.placed).toEqual([editedAgain, placedDuring]);
    expect(out.finished).toEqual([savedA]);
  });

  it("clears only the deletions the write applied", () => {
    const out = pendingAfterRebuild(
      { placed: [], deleted: ["gone", "deleted-during-the-save"] },
      written,
      ["gone"],
    );
    expect(out.deleted).toEqual(["deleted-during-the-save"]);
  });

  it("counts a placement as written when the station it joined reads it back a few micrometres off (version 3)", () => {
    // Why (tour editor plan W3): a pin that joins a station is stored at a
    // local pose and read back through the station's frame, so its geo
    // pose differs from the placed one in the last digits. Compared by raw
    // content it would never count as written, and every later save and
    // draft would offer it again.
    const near: TourObject = {
      ...pin("near"),
      geo: {
        lat: 47.5 + 7 / 111_320,
        lon: 8.70004,
        alt: 401.37,
        headingDeg: 0,
      },
    };
    const saved = withTourContent(manifestOf([pin("a")]), {
      objects: [pin("a"), seated(near, stationIdOf("a"))],
    });
    expect(saved.stations.map((s) => s.items.map((i) => i.id))).toEqual([
      ["a", "near"],
    ]);
    const placed = { object: near };
    const out = pendingAfterRebuild(
      { placed: [placed], deleted: [] },
      saved,
      [],
    );
    expect(out.finished).toEqual([placed]);
    expect(out.placed).toEqual([]);
  });

  it("keeps the caller's objects, so a photo's bytes travel with it", () => {
    const shot = { object: photo("p"), blob: new Blob(["jpg"]) };
    const out = pendingAfterRebuild(
      { placed: [shot], deleted: [] },
      manifestOf([photo("p")]),
      [],
    );
    expect(out.finished[0]).toBe(shot);
  });
});

describe("finishedFileName (M6 E2a: the Finish's naming rule, shared)", () => {
  // Why: Drive offers "Replace" only for a file of the same name (Drive
  // replace plan §2 decision 3), so a saved tour keeps the hosted file's
  // name - made safe where a phone would change it - on the phone and on
  // the desktop alike (E2 plan review #7).
  const tour = (hosted: string | null, url: string) => ({
    hostedFileName: () => hosted,
    archive: { url },
  });

  it("keeps the hosted file's name", () => {
    expect(finishedFileName(tour("Altstadt.zip", "x"))).toBe("Altstadt.zip");
  });

  it("makes a name a download would change safe", () => {
    // A hosted name never carries a path separator (the header parser
    // refuses one); a save replaces what a file system refuses, and Chrome
    // appends a missing .zip.
    expect(finishedFileName(tour("Walk: part 2?.zip", "x"))).toBe(
      "Walk- part 2-.zip",
    );
    expect(finishedFileName(tour("walk", "x"))).toBe("walk.zip");
  });

  it("falls back to the link's file name, else tour.zip", () => {
    expect(
      finishedFileName(tour(null, "https://example.org/tours/walk.zip")),
    ).toBe("walk.zip");
    expect(finishedFileName(tour(null, "https://example.org/share?id=1"))).toBe(
      "tour.zip",
    );
  });
});
