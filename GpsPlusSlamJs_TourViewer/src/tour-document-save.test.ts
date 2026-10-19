/**
 * Why these tests matter: a save of the tour a creator edits is the tour
 * document's own work (D30's follow-up) - a thunk against the store that
 * takes its snapshot from the document, rebuilds the file from the newest
 * bytes and lands what it wrote. The slice's save status is then the only
 * place that says whether a save runs, landed or failed, so each outcome
 * is pinned here on the slice itself: a save that lands, one that fails,
 * a save asked for while another runs (it waits, and starts from the
 * first one's bytes), and an undo asked for while a save runs (refused by
 * the reducer, since the save's end moves the file the step is measured
 * against). Real zips, read back as the viewer reads them.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import { readStoredEntryBytes } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { openTourFile, type TourSession } from "./tour-session.js";
import { createTourViewerStore } from "./tour-viewer-session.js";
import {
  selectTourDocument,
  tourDocumentActions,
  type TourDocumentState,
} from "./tour-document.js";
import {
  createTourSaves,
  dispatchThunk,
  TOUR_REPLACED,
} from "./tour-document-save.js";
import { tourOf, withWorldObjects } from "./test-support/v3-tour.js";

beforeAll(() => {
  createTourViewerStore();
});

function pin(id: string, label = `pin ${id}`): TourObject {
  return {
    id,
    kind: "pin",
    label,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 },
  };
}

async function opened(objects: readonly TourObject[]): Promise<{
  session: TourSession;
  store: ReturnType<typeof createTourViewerStore>;
}> {
  const manifest = tourOf(objects);
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(manifest) },
  ]);
  const session = await openTourFile(
    new File([zip], "tour.zip", { type: "application/zip" }),
  );
  const store = createTourViewerStore();
  store.dispatch(tourDocumentActions.opened({ manifest }));
  return { session, store };
}

function doc(
  store: ReturnType<typeof createTourViewerStore>,
): TourDocumentState {
  return selectTourDocument(store.getState());
}

function savesOf(
  session: TourSession,
  store: ReturnType<typeof createTourViewerStore>,
): ReturnType<typeof createTourSaves> {
  return createTourSaves({
    tour: session,
    generation: doc(store).generation,
    pictureOf: () => undefined,
    picturesRead: () => Promise.resolve(),
  });
}

function rename(
  store: ReturnType<typeof createTourViewerStore>,
  id: string,
  label: string,
): void {
  store.dispatch(
    tourDocumentActions.edited({ object: pin(id, label), what: label }),
  );
}

async function labels(blob: Blob): Promise<string[]> {
  const bytes = readStoredEntryBytes(
    new Uint8Array(await blob.arrayBuffer()),
    "tour.json",
  );
  return withWorldObjects(
    parseTourManifest(JSON.parse(new TextDecoder().decode(bytes))),
  ).objects.map((o) => (o as { label: string }).label);
}

describe("createTourSaves", () => {
  it("an in-place save names the history position of the view it wrote; a download names none (D33)", async () => {
    // Why: an undo that crosses an in-place save writes the file again
    // (D33), and "crosses" is read against the position of the view the
    // file holds - the snapshot's, not where the document stood when the
    // write landed: an edit made while it ran is not in the file.
    const { session, store } = await opened([pin("a"), pin("b")]);
    const saves = savesOf(session, store);
    rename(store, "a", "First");
    const running = dispatchThunk(
      store,
      saves.save({ keepScan: false, inPlace: true }),
    );
    rename(store, "b", "During");
    await running;
    expect(doc(store).position).toBe(2);
    expect(doc(store).save.inPlaceAt).toBe(1);
    await dispatchThunk(store, saves.save({ keepScan: false }));
    expect(doc(store).save.inPlaceAt).toBeNull();
    await session.close();
  });

  it("a save is the document's: saving while it runs, then the written file, nothing pending, idle", async () => {
    const { session, store } = await opened([pin("a"), pin("b")]);
    const saves = savesOf(session, store);
    rename(store, "a", "First");
    const running = dispatchThunk(store, saves.save({ keepScan: false }));
    expect(doc(store).save).toMatchObject({ status: "saving", rebuilds: 1 });
    const built = await running;
    expect(await labels(built.finished.blob)).toEqual(["First", "pin b"]);
    expect(doc(store).written).toEqual(built.finished.written);
    expect(doc(store).placed).toEqual([]);
    expect(doc(store).save).toMatchObject({
      status: "idle",
      rebuilds: 0,
      error: null,
    });
    expect(saves.newest()?.blob).toBe(built.finished.blob);
    expect(saves.fileName).toBe("tour.zip");
    await session.close();
  });

  it("a failed save says why in the slice, writes nothing and keeps the edit pending", async () => {
    const { session, store } = await opened([pin("a")]);
    const unreadable = Object.create(session, {
      readWholeArchive: {
        value: () => Promise.reject(new Error("the file changed on disk")),
      },
    }) as TourSession;
    const saves = savesOf(unreadable, store);
    const before = doc(store).written;
    rename(store, "a", "Kept");
    await expect(
      dispatchThunk(store, saves.save({ keepScan: false })),
    ).rejects.toThrow("the file changed on disk");
    expect(doc(store).save).toMatchObject({
      status: "error",
      error: "the file changed on disk",
      rebuilds: 0,
    });
    expect(doc(store).written).toBe(before);
    expect(doc(store).placed.map((p) => p.object.id)).toEqual(["a"]);
    expect(saves.newest()).toBeNull();
    await session.close();
  });

  // Both checks fail without the queue (confirmed by running starts at
  // once): the second save would snapshot at its dispatch, missing the
  // edit made after it, and would read the opened file again instead of
  // starting from the first save's bytes.
  it("a save asked for while another runs starts only once the first landed: its snapshot then, from the first's bytes", async () => {
    const { session, store } = await opened([pin("a"), pin("b")]);
    let reads = 0;
    let release = (): void => undefined;
    const held = Object.create(session, {
      readWholeArchive: {
        value: () => {
          reads += 1;
          return new Promise<Blob>((resolve, reject) => {
            release = () => {
              session.readWholeArchive().then(resolve, reject);
            };
          });
        },
      },
    }) as TourSession;
    const saves = savesOf(held, store);
    rename(store, "a", "One");
    // Nothing runs: this one starts, and snapshots, at its dispatch.
    const first = dispatchThunk(store, saves.save({ keepScan: false }));
    rename(store, "b", "Two");
    const second = dispatchThunk(store, saves.save({ keepScan: false }));
    // Made after the second was asked for, before it started.
    rename(store, "b", "Three");
    expect(doc(store).save.rebuilds).toBe(2);
    await vi.waitFor(() => {
      expect(reads).toBe(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reads).toBe(1);
    release();
    const one = await first;
    expect(await labels(one.finished.blob)).toEqual(["One", "pin b"]);
    const two = await second;
    expect(await labels(two.finished.blob)).toEqual(["One", "Three"]);
    expect(reads).toBe(1);
    expect(doc(store).placed).toEqual([]);
    expect(doc(store).save).toMatchObject({ status: "idle", rebuilds: 0 });
    expect(saves.newest()?.blob).toBe(two.finished.blob);
    await session.close();
  });

  it("an undo asked for while a save runs stays refused, and runs once the save ended", async () => {
    const { session, store } = await opened([pin("a", "Old")]);
    const saves = savesOf(session, store);
    rename(store, "a", "New");
    const running = dispatchThunk(store, saves.save({ keepScan: false }));
    const during = doc(store);
    store.dispatch(tourDocumentActions.undone());
    expect(doc(store).revision).toBe(during.revision);
    expect(doc(store).past).toHaveLength(1);
    await running;
    store.dispatch(tourDocumentActions.undone());
    expect(doc(store).past).toHaveLength(0);
    // The undo is a change of its own against the file just written.
    expect(doc(store).placed.map((p) => p.object)).toMatchObject([
      { id: "a", label: "Old" },
    ]);
    await session.close();
  });

  it("a save of an open another replaced builds nothing, and one begun before lands nowhere", async () => {
    const { session, store } = await opened([pin("a")]);
    const saves = savesOf(session, store);
    rename(store, "a", "Late");
    const late = dispatchThunk(store, saves.save({ keepScan: false }));
    store.dispatch(
      tourDocumentActions.opened({ manifest: tourOf([pin("z")]) }),
    );
    const next = doc(store).written;
    expect(await labels((await late).finished.blob)).toEqual(["Late"]);
    expect(doc(store).written).toBe(next);
    await expect(
      dispatchThunk(store, saves.save({ keepScan: false })),
    ).rejects.toThrow(TOUR_REPLACED);
    await session.close();
  });
});
