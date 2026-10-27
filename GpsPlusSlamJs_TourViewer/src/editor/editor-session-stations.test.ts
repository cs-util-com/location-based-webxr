/**
 * Why these tests matter: the 3D editor edits the tour's stations through
 * the editor session - a station renamed, resized, added, deleted,
 * reordered or copied, an item copied, put on the ground, resized, or
 * moved into a station of its own. The session is where each gesture
 * becomes one undo step, where a copied photo gets its own picture (or the
 * save writes a photo with no content file, a tour the reader refuses), and
 * where a draft's offer comes back after a reload. These tests drive the
 * real session, the real draft and the real save, and read the saved zip.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
  type TourPicture,
  type TourPin,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  packFilesAsZip,
  type DraftFileStore,
} from "gps-plus-slam-app-framework/storage";
import { readStoredEntryBytes } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { manifestToWrite } from "../tour-document.js";
import { openTourFile, type TourSession } from "../tour-session.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { createEditorDraft } from "./editor-draft.js";
import { createEditorSession } from "./editor-session.js";
import type { EditorLock } from "./save-target.js";
import { stationIdOf, tourOf } from "../test-support/tour-of.js";

beforeAll(() => {
  createTourViewerStore();
});

/** The world view of `tour` (none without one). */
function tourObjectsOf(tour: TourManifest | null): readonly TourObject[] {
  return tour === null ? [] : tourObjects(tour);
}

function pin(id: string, lat = 48.52): TourPin {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: `pin ${id}`,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

function photo(id: string, lat: number): TourPicture {
  return {
    id,
    kind: "picture",
    view: "plane",
    image: id,
    widthM: 1,
    imageAsset: {
      id: id,
      path: `content/${id}.jpg`,
      kind: "image",
      width: 4,
      height: 3,
    },
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

function model(id: string, lat: number): TourObject {
  return {
    id,
    kind: "model",
    view: "placed",
    asset: "m1",
    sizeM: 2,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

const OBJECTS = [
  pin("a"),
  pin("b", 48.5202),
  photo("f", 48.5204),
  model("m", 48.5206),
];

/** The tour of `OBJECTS` opened as a file; `changed` edits it first (the
 *  same tour as changed on another device). */
async function opened(
  changed: (manifest: TourManifest) => TourManifest = (m) => m,
): Promise<{
  session: TourSession;
  manifest: TourManifest;
}> {
  const manifest = parseTourManifest(
    JSON.parse(
      serializeTourManifest(
        changed(
          tourOf(OBJECTS, {
            assets: [{ id: "m1", path: "content/m1.glb", kind: "model" }],
          }),
        ),
      ),
    ),
  );
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(manifest) },
    { path: "content/f.jpg", data: "the picture of f" },
    { path: "content/m1.glb", data: "glb" },
  ]);
  const session = await openTourFile(
    new File([zip], "tour.zip", { type: "application/zip" }),
  );
  return { session, manifest };
}

/** An entry of a saved zip, as text; undefined when it lacks it. */
async function entryText(
  blob: Blob,
  name: string,
): Promise<string | undefined> {
  try {
    const bytes = readStoredEntryBytes(
      new Uint8Array(await blob.arrayBuffer()),
      name,
    );
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

async function savedTour(blob: Blob): Promise<TourManifest> {
  const text = await entryText(blob, "tour.json");
  if (text === undefined) throw new Error("no tour.json");
  return parseTourManifest(JSON.parse(text));
}

function memoryDraftStores(): {
  open: (key: string) => Promise<DraftFileStore | undefined>;
} {
  const spaces = new Map<string, Map<string, Blob | string>>();
  return {
    open: (key) => {
      const files = spaces.get(key) ?? new Map<string, Blob | string>();
      spaces.set(key, files);
      return Promise.resolve({
        put: (k, data) => {
          files.set(k, data as Blob | string);
          return Promise.resolve(true);
        },
        remove: (k) => {
          files.delete(k);
          return Promise.resolve();
        },
        getText: async (k) => {
          const v = files.get(k);
          return v === undefined
            ? undefined
            : typeof v === "string"
              ? v
              : v.text();
        },
        getBlob: (k) => {
          const v = files.get(k);
          return Promise.resolve(
            v === undefined
              ? undefined
              : typeof v === "string"
                ? new Blob([v])
                : v,
          );
        },
        keys: () => Promise.resolve([...files.keys()]),
        clear: () => {
          files.clear();
          return Promise.resolve();
        },
      });
    },
  };
}

function freeLocks(): Promise<EditorLock> {
  return Promise.resolve({
    granted: true,
    release: () => undefined,
    released: Promise.resolve(),
  });
}

const K = "local-file:00000000000000000000000000000002";

describe("the editor session's station edits", () => {
  it("each edit is one undo step, and a refusal says why in words and changes nothing", async () => {
    const { session, manifest } = await opened();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const st = stationIdOf("a");
    expect(editor.editStation(st, { title: "The gate" })).toEqual({
      kind: "edited",
    });
    expect(editor.changeCount()).toBe(1);
    expect(editor.editStation(st, { title: "The gate" })).toEqual({
      kind: "unchanged",
    });
    const refused = editor.editStation(st, { foundRadiusM: 1.999 });
    expect(refused).toMatchObject({ kind: "refused" });
    expect(refused.kind === "refused" ? refused.reason : "").toMatch(/2 m/);
    expect(editor.editStation("nope", { title: "x" })).toMatchObject({
      kind: "refused",
    });
    expect(editor.resizeModel("a", 3)).toMatchObject({ kind: "refused" });
    expect(editor.resizeModel("m", 500.01)).toMatchObject({
      kind: "refused",
    });
    expect(editor.resizeModel("m", 0.05)).toEqual({ kind: "resized" });
    expect(editor.changeCount()).toBe(2);
    expect(editor.undo()).toMatchObject({ kind: "undone" });
    expect(editor.undo()).toMatchObject({ kind: "undone" });
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  // Why: an edit of a station a delete emptied - its radius alone - is
  // dropped by the document (the next write and a reload leave such a
  // station out, so the live tour must not list it again). Reported as
  // "edited", the page would offer an undo of a step that was never taken
  // and start an autosave for nothing.
  it("an edit the document drops, of a station a delete emptied, is unchanged, not edited", async () => {
    const { session, manifest } = await opened();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.remove("a")).toEqual({ kind: "deleted" });
    expect(editor.changeCount()).toBe(1);
    expect(editor.editStation(stationIdOf("a"), { foundRadiusM: 40 })).toEqual({
      kind: "unchanged",
    });
    expect(editor.changeCount()).toBe(1);
    expect(editor.undo()).toMatchObject({ kind: "undone" });
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("the last station cannot be deleted; another can, and its delete is one step", async () => {
    const { session, manifest } = await opened();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    for (const id of ["a", "b", "f"]) {
      expect(editor.deleteStation(stationIdOf(id))).toEqual({
        kind: "deleted",
      });
    }
    const last = editor.deleteStation(stationIdOf("m"));
    expect(last).toMatchObject({ kind: "refused" });
    expect(last.kind === "refused" ? last.reason : "").toMatch(/last station/);
    expect(editor.undo()).toMatchObject({ kind: "undone" });
    expect(
      editor.model().items.filter((i) => i.kind === "station"),
    ).toHaveLength(2);
    await session.close();
  });

  it("a copied photo station saves the copy's picture under the copy's own content file", async () => {
    // Why: a photo copied under a new id names `content/<new id>.jpg`; a
    // save that wrote no such entry would write a tour the reader refuses.
    const { session, manifest } = await opened();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const copied = await editor.duplicateStation(stationIdOf("f"));
    expect(copied).toMatchObject({ kind: "duplicated" });
    const pinCopy = await editor.duplicateObject("a");
    expect(pinCopy).toMatchObject({ kind: "duplicated" });
    const saved = await editor.save({ keepScan: false });
    const tour = await savedTour(saved.blob);
    const stationId = copied.kind === "duplicated" ? copied.stationId : "";
    const copy = tour.stations.find((s) => s.id === stationId);
    expect(copy?.blocks).toHaveLength(1);
    const item = copy?.blocks[0];
    expect(item?.kind).toBe("picture");
    const image = item?.kind === "picture" ? item.image : "";
    const path = tour.assets.find((a) => a.id === image)?.path ?? "";
    expect(path).toBe(`content/${image}.jpg`);
    expect(path).not.toBe("content/f.jpg");
    expect(await entryText(saved.blob, path)).toBe("the picture of f");
    expect(
      tour.stations.find((s) => s.id === stationIdOf("a"))?.blocks,
    ).toHaveLength(2);
    await session.close();
  });

  it("a copied story station saves its story under new block ids, the original's unchanged", async () => {
    // Why: block ids are unique across the tour (format 4); a copy that
    // kept its story blocks' ids would save a tour the reader refuses.
    const { session, manifest } = await opened((m) => ({
      ...m,
      stations: m.stations.map((s) =>
        s.id === stationIdOf("a")
          ? {
              ...s,
              steps: [
                {
                  id: "s1",
                  action: { kind: "show", block: "intro" },
                  advance: { mode: "tap" },
                },
              ],
              blocks: [
                ...s.blocks,
                {
                  id: "intro",
                  kind: "shortText",
                  view: "card",
                  caption: "Welcome",
                  pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
                },
              ],
            }
          : s,
      ),
    }));
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const copied = await editor.duplicateStation(stationIdOf("a"));
    expect(copied).toMatchObject({ kind: "duplicated" });
    const tour = await savedTour((await editor.save({ keepScan: false })).blob);
    const stationId = copied.kind === "duplicated" ? copied.stationId : "";
    const copy = tour.stations.find((s) => s.id === stationId);
    const shown = copy?.steps.map((step) =>
      step.action.kind === "show" ? step.action.block : "",
    );
    expect(shown).toHaveLength(1);
    expect(shown?.[0]).not.toBe("intro");
    expect(copy?.blocks.find((b) => b.id === shown?.[0])).toMatchObject({
      kind: "shortText",
      caption: "Welcome",
    });
    expect(
      tour.stations
        .find((s) => s.id === stationIdOf("a"))
        ?.blocks.some((b) => b.id === "intro"),
    ).toBe(true);
    await session.close();
  });

  // Why: "Move to a new station" splits an item out where it stands, and
  // the page selects the station it made - so the session must say which,
  // move nothing, and take it back in one undo.
  it("moveToNewStation gives an item a station of its own where it stands, one step, and names it", async () => {
    const { session, manifest } = await opened();
    const store = createTourViewerStore();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      store,
    });
    const tour = () => manifestToWrite(store.getState().tourDocument);
    const stationOf = (id: string) =>
      tour()?.stations.find((st) => st.blocks.some((i) => i.id === id));
    const before = tourObjectsOf(tour()).find((o) => o.id === "b")?.geo;
    const outcome = editor.moveToNewStation("b");
    expect(outcome).toMatchObject({ kind: "moved" });
    const made = "stationId" in outcome ? outcome.stationId : "";
    expect(made).not.toBe(stationIdOf("b"));
    expect(stationOf("b")?.id).toBe(made);
    // Where it stood, turned as it was.
    expect(tourObjectsOf(tour()).find((o) => o.id === "b")?.geo).toEqual(
      before,
    );
    expect(editor.changeCount()).toBeGreaterThan(0);
    expect(editor.undo()).toMatchObject({ kind: "undone" });
    expect(stationOf("b")?.id).toBe(stationIdOf("b"));
    expect(editor.moveToNewStation("nope")).toMatchObject({
      kind: "refused",
    });
    await session.close();
  });

  it("an item moved into a station of its own, and items put on the ground as one step", async () => {
    const { session, manifest } = await opened();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const a = editor.model().items.find((i) => i.id === "a");
    expect(a).toBeDefined();
    const geo = {
      lat: 48.52,
      lon: 9.05,
      alt: 342,
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    };
    expect(editor.pose("a", geo, { newStation: true })).toEqual({
      kind: "moved",
    });
    expect(
      editor.groundItems([
        { id: "a", alt: 339 },
        { id: "b", alt: 338 },
      ]),
    ).toEqual({ kind: "grounded" });
    expect(editor.changeCount()).toBe(2);
    expect(editor.undo()).toMatchObject({ kind: "undone" });
    expect(editor.changeCount()).toBe(1);
    await session.close();
  });
});

describe("the station edits across a reload", () => {
  it("renamed, added, copied, deleted and reordered stations come back from the draft as the save had them", async () => {
    const { session, manifest } = await opened();
    const stores = memoryDraftStores();
    const draft = createEditorDraft({
      openStore: stores.open,
      holdLock: freeLocks,
      noBackup: () => undefined,
    });
    await draft.open(K, manifest);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft: draft.writes(),
    });
    expect(
      editor.editStation(stationIdOf("a"), {
        title: "The gate",
        foundRadiusM: 40,
      }),
    ).toEqual({ kind: "edited" });
    expect(
      editor.addStation({ lat: 48.53, lon: 9.05, alt: 340 }),
    ).toMatchObject({
      kind: "added",
    });
    expect(await editor.duplicateStation(stationIdOf("f"))).toMatchObject({
      kind: "duplicated",
    });
    expect(await editor.duplicateObject("b")).toMatchObject({
      kind: "duplicated",
    });
    expect(editor.deleteStation(stationIdOf("m"))).toEqual({ kind: "deleted" });
    const order = editor
      .model()
      .items.filter((i) => i.kind === "station")
      .map((i) => i.id.replace(/^station:/, ""))
      .reverse();
    expect(editor.reorderStations(order)).toEqual({ kind: "reordered" });
    const pending = editor.changeCount();
    const before = await editor.save({ keepScan: false });
    const beforeTour = await savedTour(before.blob);
    await draft.idle();
    draft.close();

    const again = createEditorDraft({
      openStore: stores.open,
      holdLock: freeLocks,
      noBackup: () => undefined,
    });
    const { offer } = await again.open(K, manifest);
    expect(offer).not.toBeNull();
    expect(offer?.text).toMatch(/station/);
    const reloaded = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft: again.writes(),
    });
    const restored = reloaded.restore(offer!);
    expect(restored.changed).toBeGreaterThan(0);
    expect(reloaded.changeCount()).toBe(pending);
    const after = await reloaded.save({ keepScan: false });
    expect((await savedTour(after.blob)).stations).toEqual(beforeTour.stations);
    for (const station of beforeTour.stations) {
      for (const item of station.blocks) {
        if (item.kind !== "picture") continue;
        const path = beforeTour.assets.find((a) => a.id === item.image)?.path;
        expect(await entryText(after.blob, path ?? "")).toBe(
          "the picture of f",
        );
      }
    }
    await session.close();
  });

  // Why: an item split off into a station of its own, right after its
  // first station, came back from a reload without that station - the
  // item was seated back into the station it had left - while the save
  // before the reload had them apart.
  it("an added station, an order changed, an item split off and a station deleted come back from the draft as the save had them", async () => {
    const { session, manifest } = await opened();
    const stores = memoryDraftStores();
    const draft = draftOver(stores);
    await draft.open(K, manifest);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft: draft.writes(),
    });
    const added = editor.addStation({ lat: 48.53, lon: 9.05, alt: 340 });
    if (added.kind !== "added") throw new Error("not added");
    const ids = () =>
      editor
        .model()
        .items.filter((i) => i.kind === "station")
        .map((i) => i.id.replace(/^station:/, ""));
    const order = ids();
    const at = order.indexOf(added.stationId);
    order.splice(at, 1);
    order.splice(at - 1, 0, added.stationId);
    expect(editor.reorderStations(order)).toEqual({ kind: "reordered" });
    expect(editor.moveToNewStation("b")).toMatchObject({ kind: "moved" });
    expect(editor.deleteStation(stationIdOf("a"))).toEqual({ kind: "deleted" });
    const pending = editor.changeCount();
    const beforeTour = await savedTour(
      (await editor.save({ keepScan: false })).blob,
    );
    await draft.idle();
    draft.close();

    const again = draftOver(stores);
    const { offer } = await again.open(K, manifest);
    expect(offer).not.toBeNull();
    const reloaded = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft: again.writes(),
    });
    reloaded.restore(offer!);
    expect(reloaded.changeCount()).toBe(pending);
    const after = await savedTour(
      (await reloaded.save({ keepScan: false })).blob,
    );
    expect(after.stations.map((s) => s.id)).toEqual(
      beforeTour.stations.map((s) => s.id),
    );
    expect(after.stations).toEqual(beforeTour.stations);
    await session.close();
  });

  /** A draft over `stores`, as one page load opens it. */
  function draftOver(stores: ReturnType<typeof memoryDraftStores>) {
    return createEditorDraft({
      openStore: stores.open,
      holdLock: freeLocks,
      noBackup: () => undefined,
    });
  }

  it("an in-place save of an added station and a photo card offers nothing after a reload", async () => {
    // Why: the record's frames were compared with the file's by their JSON
    // text, so a frame alike in every field but written with its keys in
    // another order (a card image put back after the rest) read as edited:
    // the record outlived the save that wrote it, and every reload offered
    // "the details of a station" that Restore could not change.
    const { session, manifest } = await opened();
    const stores = memoryDraftStores();
    const draft = draftOver(stores);
    await draft.open(K, manifest);
    const writes = draft.writes();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft: writes,
    });
    expect(
      editor.addStation({ lat: 48.53, lon: 9.05, alt: 340 }),
    ).toMatchObject({ kind: "added" });
    expect(editor.editStation(stationIdOf("f"), { image: "f" })).toEqual({
      kind: "edited",
    });
    const saved = await editor.save({ keepScan: false });
    writes.built(saved.written);
    writes.landed(saved.written, K);
    await draft.idle();
    draft.close();
    const { offer } = await draftOver(stores).open(
      K,
      await savedTour(saved.blob),
    );
    expect(offer).toBeNull();
    await session.close();
  });

  it("a record restored over a file changed elsewhere brings back only the stations edited here, at the file's poses", async () => {
    // Why: the record kept every station whole, its pose included, so a
    // restore over a file moved and renamed on another device silently put
    // the old poses and the old names of stations nobody edited here back.
    const { session: here, manifest } = await opened();
    const stores = memoryDraftStores();
    const draft = draftOver(stores);
    await draft.open(K, manifest);
    const editor = createEditorSession({
      session: here,
      manifest,
      levels: new Map(),
      draft: draft.writes(),
    });
    expect(editor.editStation(stationIdOf("a"), { title: "The gate" })).toEqual(
      { kind: "edited" },
    );
    await draft.idle();
    draft.close();
    await here.close();

    const movedA = { lat: 48.5201, lon: 9.0502, alt: 341 };
    const { session, manifest: elsewhere } = await opened((m) => ({
      ...m,
      stations: m.stations.map((s) =>
        s.id === stationIdOf("a")
          ? { ...s, geo: { ...s.geo, ...movedA } }
          : s.id === stationIdOf("b")
            ? { ...s, title: "Named elsewhere" }
            : s,
      ),
    }));
    const again = draftOver(stores);
    const { offer } = await again.open(K, elsewhere);
    expect(offer?.text).toMatch(/the details of a station\b/);
    const reloaded = createEditorSession({
      session,
      manifest: elsewhere,
      levels: new Map(),
      draft: again.writes(),
    });
    expect(reloaded.restore(offer!).changed).toBe(1);
    const tour = await savedTour(
      (await reloaded.save({ keepScan: false })).blob,
    );
    const a = tour.stations.find((s) => s.id === stationIdOf("a"));
    expect(a?.title).toBe("The gate");
    expect(a?.geo).toMatchObject(movedA);
    expect(tour.stations.find((s) => s.id === stationIdOf("b"))?.title).toBe(
      "Named elsewhere",
    );
    await session.close();
  });

  it("a copy made here, saved in place, deleted, saved in place and undone is offered after a reload", async () => {
    // Why: a record of an id the opened file lacks is offered only as a
    // copy made here (no file this browser opened showed it); one that a
    // save once wrote must still count as made here once an undo brings it
    // back after a later save wrote its delete, or the reload loses it.
    const { session, manifest } = await opened();
    const stores = memoryDraftStores();
    const draft = draftOver(stores);
    await draft.open(K, manifest);
    const writes = draft.writes();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      draft: writes,
    });
    const copy = await editor.duplicateObject("b");
    const copyId = copy.kind === "duplicated" ? copy.id : "";
    expect(copyId).not.toBe("");
    const first = await editor.save({ keepScan: false });
    writes.built(first.written);
    writes.landed(first.written, K);
    expect(editor.remove(copyId)).toEqual({ kind: "deleted" });
    const second = await editor.save({ keepScan: false });
    writes.built(second.written);
    writes.landed(second.written, K);
    expect(editor.undo()).toMatchObject({ kind: "undone" });
    await draft.idle();
    draft.close();
    const { offer } = await draftOver(stores).open(
      K,
      await savedTour(second.blob),
    );
    expect(offer?.made).toEqual([copyId]);
    expect(offer?.objects.map((o) => o.id)).toEqual([copyId]);
    await session.close();
  });
});
