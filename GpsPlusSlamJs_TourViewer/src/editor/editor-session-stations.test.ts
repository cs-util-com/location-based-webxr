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
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  packFilesAsZip,
  type DraftFileStore,
} from "gps-plus-slam-app-framework/storage";
import { readStoredEntryBytes } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import { openTourFile, type TourSession } from "../tour-session.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { createEditorDraft } from "./editor-draft.js";
import { createEditorSession } from "./editor-session.js";
import type { EditorLock } from "./save-target.js";
import { stationIdOf, tourOf } from "../test-support/v3-tour.js";

beforeAll(() => {
  createTourViewerStore();
});

function pin(id: string, lat = 48.52): TourObject {
  return {
    id,
    kind: "pin",
    label: `pin ${id}`,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

function photo(id: string, lat: number): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

function model(id: string, lat: number): TourObject {
  return {
    id,
    kind: "model",
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

async function opened(): Promise<{
  session: TourSession;
  manifest: TourManifest;
}> {
  const manifest = parseTourManifest(
    JSON.parse(
      serializeTourManifest(
        tourOf(OBJECTS, {
          assets: [{ id: "m1", path: "content/m1.glb", kind: "model" }],
        }),
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
    expect(copy?.items).toHaveLength(1);
    const item = copy?.items[0];
    expect(item?.kind).toBe("photo");
    const image = item?.kind === "photo" ? item.image : "";
    expect(image).not.toBe("content/f.jpg");
    expect(await entryText(saved.blob, image)).toBe("the picture of f");
    expect(
      tour.stations.find((s) => s.id === stationIdOf("a"))?.items,
    ).toHaveLength(2);
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
      for (const item of station.items) {
        if (item.kind !== "photo") continue;
        expect(await entryText(after.blob, item.image)).toBe(
          "the picture of f",
        );
      }
    }
    await session.close();
  });
});
