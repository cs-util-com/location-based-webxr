/**
 * Why these tests matter: a smaller file replaces an asset's bytes under
 * the same id (`swapAsset`), and the draft is what brings the work back
 * after a reload or a crash. It must keep the new bytes under a key of
 * their own, so the original stays readable until a save that wrote the
 * new file lands ("use the original"), write in an order a crash between
 * any two writes survives - every offered record's bytes are the bytes of
 * its path, never the other file's - and match what the file on disk
 * holds by id AND path, since the id alone no longer says which bytes a
 * written tour carries.
 */
import type {
  TourAsset,
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it } from "vitest";

import {
  freeDraftLocks,
  memoryDraftStores,
  type MemoryDraftStores,
} from "../test-support/memory-draft-stores.js";
import { tourOf } from "../test-support/tour-of.js";
import {
  createEditorDraft,
  editorDraftKey,
  type EditorDraft,
} from "./editor-draft.js";

const ID = "a".repeat(64);
/** One Blob each, as the session hands the draft the very bytes it holds:
 *  the draft tells a file's own bytes from others by identity. */
const RIFF = new Blob(["RIFF"]);
const OGGS = new Blob(["OggS"]);
const WAV: TourAsset = { id: ID, path: `content/${ID}.wav`, kind: "audio" };
const OPUS: TourAsset = { id: ID, path: `content/${ID}.opus`, kind: "audio" };
const K1 = "local-file:00000000000000000000000000000001";
const K2 = "local-file:00000000000000000000000000000002";
const SPACE = editorDraftKey(K1);

const ESSAY: TourObject = {
  id: "e",
  kind: "longText",
  view: "reading",
  title: "Essay",
  station: "st-a",
  body: "Typed here.",
  narration: { audio: ID, synthetic: false },
  createdAtIso: "2026-11-08T00:00:00.000Z",
  geo: { lat: 48.5, lon: 9.0, alt: 340, rotation: [0, 0, 0, 1] },
};

function draftOf(stores: { open: MemoryDraftStores["open"] }): EditorDraft {
  return createEditorDraft({
    openStore: stores.open,
    holdLock: freeDraftLocks,
    noBackup: () => undefined,
  });
}

/** The station "st-a" the essay stands in. */
const PIN: TourObject = {
  id: "a",
  kind: "shortText",
  view: "pin",
  caption: "Here.",
  createdAtIso: "2026-11-08T00:00:00.000Z",
  geo: { lat: 48.5, lon: 9.0, alt: 340, headingDeg: 0 },
};

function opened(...assets: TourAsset[]): TourManifest {
  return { ...tourOf([PIN]), assets };
}

/** What a reload offers for the id: each record with its bytes as text,
 *  and whether the original is offered too. */
async function offeredAfterReload(
  stores: { open: MemoryDraftStores["open"] },
  manifest: TourManifest,
  key = K1,
): Promise<{ path: string; text: string; original?: string }[]> {
  const again = draftOf(stores);
  const { offer } = await again.open(key, manifest);
  const files = offer?.files ?? [];
  const out = await Promise.all(
    files.map(async (f) => ({
      path: f.asset.path,
      text: await f.blob.text(),
      ...(f.original?.blob === undefined
        ? {}
        : { original: await f.original.blob.text() }),
    })),
  );
  await again.idle();
  again.close();
  return out;
}

/** A voice brought in, then made smaller. */
async function swapped(stores: MemoryDraftStores): Promise<EditorDraft> {
  const draft = draftOf(stores);
  await draft.open(K1, opened());
  expect(await draft.saveAsset(WAV, RIFF)).toBe(true);
  await draft.saveObject(ESSAY);
  expect(await draft.swapAsset(OPUS, OGGS)).toBe(true);
  await draft.idle();
  return draft;
}

describe("the draft of a smaller file", () => {
  it("keeps the new bytes beside the original, and a reload offers both", async () => {
    const stores = memoryDraftStores();
    const draft = await swapped(stores);
    const keys = [...(stores.spaces.get(SPACE)?.keys() ?? [])];
    expect(keys).toContain(`asset:${ID}`);
    expect(keys).toContain(`asset:${ID}.opus`);
    expect(draft.holdsOriginal(ID)).toBe(true);
    draft.close();
    expect(await offeredAfterReload(stores, opened())).toEqual([
      { path: OPUS.path, text: "OggS", original: "RIFF" },
    ]);
  });

  // Why: the save that wrote the new file is the end of the original; it
  // must go from the draft then, and "use the original" with it.
  it("drops both once a save that wrote the new file landed", async () => {
    const stores = memoryDraftStores();
    const draft = await swapped(stores);
    const written = { ...tourOf([PIN, ESSAY]), assets: [OPUS] };
    draft.writes().built(written);
    draft.writes().landed(written, K1, new Map([[ID, OGGS]]));
    await draft.idle();
    const keys = [...(stores.spaces.get(SPACE)?.keys() ?? [])];
    expect(keys.filter((k) => k.startsWith("asset"))).toEqual([]);
    expect(draft.holdsOriginal(ID)).toBe(false);
    draft.close();
    expect(await offeredAfterReload(stores, written)).toEqual([]);
  });

  // Why: a save already running when the swap landed wrote the ORIGINAL.
  // The id is listed, but at the other path: the swap is still pending,
  // and a reload against that file must still offer it.
  it("keeps the swap when the save that landed wrote the original", async () => {
    const stores = memoryDraftStores();
    const draft = await swapped(stores);
    const written = { ...tourOf([PIN, ESSAY]), assets: [WAV] };
    draft.writes().built(written);
    draft.writes().landed(written, K1);
    await draft.idle();
    expect(draft.holdsOriginal(ID)).toBe(true);
    draft.close();
    expect(await offeredAfterReload(stores, written)).toEqual([
      { path: OPUS.path, text: "OggS", original: "RIFF" },
    ]);
  });

  it("goes back to the original as a plain file, the smaller bytes removed", async () => {
    const stores = memoryDraftStores();
    const draft = await swapped(stores);
    expect(await draft.swapAsset(WAV, RIFF)).toBe(true);
    await draft.idle();
    const keys = [...(stores.spaces.get(SPACE)?.keys() ?? [])];
    expect(keys).toContain(`asset:${ID}`);
    expect(keys).not.toContain(`asset:${ID}.opus`);
    expect(draft.holdsOriginal(ID)).toBe(false);
    draft.close();
    expect(await offeredAfterReload(stores, opened())).toEqual([
      { path: WAV.path, text: "RIFF" },
    ]);
  });

  // Why: an asset the opened file already carries has its original in
  // that file, not in the draft; the draft keeps the smaller bytes only,
  // and offers no original of its own. Back to the original, it keeps the
  // bytes it was handed: a save writing the smaller file may still be
  // running and land over the file on disk, so that file cannot be
  // counted on to hold the original.
  it("keeps a smaller file for an asset of the opened file", async () => {
    const stores = memoryDraftStores();
    const draft = draftOf(stores);
    const tour = opened(WAV);
    await draft.open(K1, tour);
    expect(await draft.swapAsset(OPUS, OGGS)).toBe(true);
    await draft.idle();
    expect(draft.holdsOriginal(ID)).toBe(false);
    draft.close();
    expect(await offeredAfterReload(stores, tour)).toEqual([
      { path: OPUS.path, text: "OggS" },
    ]);
    const back = draftOf(stores);
    await back.open(K1, tour);
    expect(await back.swapAsset(WAV, RIFF)).toBe(true);
    await back.idle();
    back.close();
    expect(await offeredAfterReload(stores, tour)).toEqual([
      { path: WAV.path, text: "RIFF" },
    ]);
  });

  // Why: "use the original" while an in-place save writing the smaller
  // file still runs. That save lands over the file on disk, so the
  // original's bytes exist only in the draft; a reload must offer them.
  it("keeps the original handed back while a save writing the smaller file lands", async () => {
    const stores = memoryDraftStores();
    const draft = draftOf(stores);
    await draft.open(K1, opened(WAV));
    expect(await draft.swapAsset(OPUS, OGGS)).toBe(true);
    expect(await draft.swapAsset(WAV, RIFF)).toBe(true);
    const written = { ...tourOf([PIN, ESSAY]), assets: [OPUS] };
    draft.writes().built(written);
    draft.writes().landed(written, K1, new Map([[ID, OGGS]]));
    await draft.idle();
    draft.close();
    expect(await offeredAfterReload(stores, written)).toEqual([
      { path: WAV.path, text: "RIFF" },
    ]);
  });

  // Why: a smaller file under the same path (a WebP made smaller as WebP)
  // is told from the file on disk by its bytes, not its path: a save that
  // started before it wrote the old bytes, and only a save that wrote these
  // spends it.
  it("keeps a swap at the same path until a save that wrote its bytes landed", async () => {
    const WEBP: TourAsset = {
      id: ID,
      path: `content/${ID}.webp`,
      kind: "image",
      width: 4,
      height: 4,
    };
    const SMALL = { ...WEBP, width: 2, height: 2 };
    const BYTES = new Blob(["RIFF-small-webp"]);
    const stores = memoryDraftStores();
    const draft = draftOf(stores);
    const tour = opened(WEBP);
    await draft.open(K1, tour);
    expect(await draft.swapAsset(SMALL, BYTES)).toBe(true);
    const stale = { ...tourOf([PIN]), assets: [WEBP] };
    draft.writes().built(stale);
    draft.writes().landed(stale, K1, new Map());
    await draft.idle();
    draft.close();
    expect(await offeredAfterReload(stores, tour)).toEqual([
      { path: WEBP.path, text: "RIFF-small-webp" },
    ]);
    // A save that wrote these bytes spends it.
    const fresh = memoryDraftStores();
    const later = draftOf(fresh);
    await later.open(K1, tour);
    expect(await later.swapAsset(SMALL, BYTES)).toBe(true);
    const written = { ...tourOf([PIN]), assets: [SMALL] };
    later.writes().built(written);
    later.writes().landed(written, K1, new Map([[ID, BYTES]]));
    await later.idle();
    later.close();
    expect(await offeredAfterReload(fresh, written)).toEqual([]);
  });

  it("carries the smaller file and the original when a download moves the key", async () => {
    const stores = memoryDraftStores();
    const draft = await swapped(stores);
    draft.writes().moved(K2);
    await draft.idle();
    draft.close();
    expect(await offeredAfterReload(stores, opened(), K2)).toEqual([
      { path: OPUS.path, text: "OggS", original: "RIFF" },
    ]);
  });

  // Why: a tab closed between any two of the draft's writes must leave a
  // namespace that reads - every record offered with the bytes of its own
  // path, the id offered once - and the next open tidies what is stray.
  it("survives a crash between each pair of its writes", async () => {
    const stores = memoryDraftStores();
    const snapshots: Map<string, Blob | string>[] = [];
    let recording = false;
    const spy = {
      open: async (key: string): Promise<DraftFileStore | undefined> => {
        const store = await stores.open(key);
        if (store === undefined) return undefined;
        const snap = (): void => {
          if (recording && key === SPACE) {
            snapshots.push(new Map(stores.spaces.get(SPACE)));
          }
        };
        return {
          ...store,
          put: async (k, data) => {
            const ok = await store.put(k, data);
            snap();
            return ok;
          },
          remove: async (k) => {
            await store.remove(k);
            snap();
          },
        };
      },
    };
    const draft = draftOf(spy);
    await draft.open(K1, opened());
    await draft.saveAsset(WAV, RIFF);
    await draft.saveObject(ESSAY);
    await draft.idle();
    recording = true;
    snapshots.push(new Map(stores.spaces.get(SPACE)));
    await draft.swapAsset(OPUS, OGGS);
    await draft.swapAsset(
      { ...OPUS, path: `content/${ID}.mp3` },
      new Blob(["ID3"]),
    );
    await draft.swapAsset(WAV, RIFF);
    await draft.idle();
    recording = false;
    draft.close();
    expect(snapshots.length).toBeGreaterThan(4);
    const bytesOf: Record<string, string> = {
      [WAV.path]: "RIFF",
      [OPUS.path]: "OggS",
      [`content/${ID}.mp3`]: "ID3",
    };
    for (const [i, snapshot] of snapshots.entries()) {
      const crashed = memoryDraftStores();
      crashed.spaces.set(SPACE, new Map(snapshot));
      const offered = await offeredAfterReload(crashed, opened());
      expect(offered, `after write ${String(i)}`).toHaveLength(1);
      const [file] = offered;
      expect(file?.text, `after write ${String(i)}`).toBe(
        bytesOf[file?.path ?? ""],
      );
      // A kept original always reads as the original bytes.
      expect(file?.original ?? "RIFF").toBe("RIFF");
      // The open tidied: no key is left that the list does not name.
      const left = [...(crashed.spaces.get(SPACE)?.keys() ?? [])].filter((k) =>
        k.startsWith("asset:"),
      );
      const named = new Set([
        `asset:${ID}`,
        ...(file?.path === WAV.path
          ? []
          : [`asset:${ID}.${file?.path.split(".").pop() ?? ""}`]),
      ]);
      for (const k of left)
        expect(named.has(k), `${k} after write ${String(i)}`).toBe(true);
    }
  });
});
