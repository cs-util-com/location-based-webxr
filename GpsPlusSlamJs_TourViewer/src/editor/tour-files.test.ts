import { describe, expect, it } from "vitest";
import { sha256Hex } from "gps-plus-slam-app-framework/utils/sha256-hex";
import type { TourAsset } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { readTourFile, TOUR_FILE_LIMITS } from "./tour-files.js";

const bytes = (text: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(text);
const blobOf = (text: string): Blob => new Blob([bytes(text)]);
const none = (): TourAsset | undefined => undefined;

/** A minimal glTF binary: the header and one JSON chunk. */
function glb(json: object): Blob {
  const text = JSON.stringify(json);
  const padded = text + " ".repeat((4 - (text.length % 4)) % 4);
  const chunk = bytes(padded);
  const out = new Uint8Array(12 + 8 + chunk.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, chunk.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(chunk, 20);
  return new Blob([out]);
}

/** A 1 x 1 PNG's header bytes (what `imageInfoOfBlob` reads). */
function png(width: number, height: number): Blob {
  const out = new Uint8Array(33);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13);
  out.set(bytes("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([out]);
}

describe("readTourFile", () => {
  // Why this test matters: a dropped File is lazy - its bytes are read
  // from the disk when asked for, so a source moved or deleted after the
  // drop failed the next save. The import reads it at once, and what the
  // tour holds is that copy.
  it("reads a dropped file at the drop, so a moved source does not matter", async () => {
    let reads = 0;
    const source = {
      size: 5,
      type: "",
      arrayBuffer: () => {
        reads += 1;
        if (reads > 1) return Promise.reject(new Error("moved"));
        return Promise.resolve(bytes("voice").buffer);
      },
    } as unknown as Blob;
    const read = await readTourFile(source, "Voice.MP3", {
      tourBytes: 0,
      known: none,
    });
    if (read.kind !== "read") throw new Error(read.reason);
    expect(await read.blob.text()).toBe("voice");
    expect(read.blob.type).toBe("audio/mpeg");
    expect(reads).toBe(1);
  });

  // Why: the source that cannot be read at the drop is refused in words,
  // never held as a promise of bytes that will not come.
  it("refuses a file that cannot be read at the drop", async () => {
    const source = {
      size: 5,
      type: "",
      arrayBuffer: () => Promise.reject(new Error("gone")),
    } as unknown as Blob;
    const read = await readTourFile(source, "a.mp3", {
      tourBytes: 0,
      known: none,
    });
    expect(read).toEqual({
      kind: "refused",
      reason: "That file could not be read. Is it still where it was?",
    });
  });

  // Why: the content hash is the asset's id, so the same file dropped
  // twice - in two stations, or after a reload - is one entry of the zip.
  it("names the asset by its content hash and its kind by the extension", async () => {
    const read = await readTourFile(blobOf("voice"), "a.Mp3", {
      tourBytes: 0,
      known: none,
    });
    const sha = await sha256Hex(bytes("voice"));
    expect(read).toMatchObject({
      kind: "read",
      isNew: true,
      asset: { id: sha, path: `content/${sha}.mp3`, kind: "audio" },
    });
  });

  // Why: a file the tour already holds is used from there, never stored
  // twice (the table's, the opened file's, a signed list's).
  it("reuses an asset the tour already holds for the same bytes", async () => {
    const sha = await sha256Hex(bytes("voice"));
    const held: TourAsset = {
      id: "old",
      path: "content/old.mp3",
      kind: "audio",
    };
    const read = await readTourFile(blobOf("voice"), "b.mp3", {
      tourBytes: 0,
      known: (s) => (s === sha ? held : undefined),
    });
    expect(read).toMatchObject({ kind: "read", isNew: false, asset: held });
  });

  // Why: an extension the format does not carry, or a kind the caller
  // does not take, is refused in words that name what is taken.
  it("refuses a file of another type, naming the ones taken", async () => {
    const unknown = await readTourFile(blobOf("x"), "notes.txt", {
      tourBytes: 0,
      known: none,
    });
    expect(unknown.kind).toBe("refused");
    const voiceOnly = await readTourFile(blobOf("x"), "a.png", {
      tourBytes: 0,
      known: none,
      kinds: ["audio"],
    });
    expect(voiceOnly).toMatchObject({ kind: "refused" });
    expect("reason" in voiceOnly && voiceOnly.reason).toContain("mp3");
    expect("reason" in voiceOnly && voiceOnly.reason).not.toContain("png");
  });

  // Why: the archive's own caps (256 MiB an entry, 1024 MiB a tour) are
  // hard: a save over them fails after the creator's work. The import
  // refuses first, in words naming the sizes, below the caps.
  it("refuses a file over the entry cap and one the tour has no room for", async () => {
    const limits = {
      maxEntryBytes: 100,
      maxArchiveBytes: 200,
      marginBytes: 10,
    };
    const big = await readTourFile(new Blob([new Uint8Array(91)]), "a.mp3", {
      tourBytes: 0,
      known: none,
      limits,
    });
    expect(big).toEqual({
      kind: "refused",
      reason:
        "That file is too large for a tour (91 B; a file can be at most 90 B).",
    });
    const fits = await readTourFile(new Blob([new Uint8Array(90)]), "a.mp3", {
      tourBytes: 100,
      known: none,
      limits,
    });
    expect(fits.kind).toBe("read");
    const full = await readTourFile(new Blob([new Uint8Array(90)]), "a.mp3", {
      tourBytes: 101,
      known: none,
      limits,
    });
    expect(full).toEqual({
      kind: "refused",
      reason:
        "The tour has no room for that file (90 B more on 101 B; a tour can be at most 190 B).",
    });
  });

  // Why: bytes the tour already holds add nothing to it, so a tour near
  // its cap must still take them (one more item using the same voice); the
  // room is judged by what an import ADDS, after its hash is known.
  it("takes bytes the tour already holds however full it is", async () => {
    const limits = {
      maxEntryBytes: 100,
      maxArchiveBytes: 200,
      marginBytes: 10,
    };
    const data = new Uint8Array(90).fill(7);
    const sha = await sha256Hex(data);
    const held: TourAsset = {
      id: sha,
      path: `content/${sha}.mp3`,
      kind: "audio",
    };
    const again = await readTourFile(new Blob([data]), "same.mp3", {
      tourBytes: 190,
      known: (s) => (s === sha ? held : undefined),
      limits,
    });
    expect(again).toMatchObject({ kind: "read", isNew: false, asset: held });
  });

  // Why: the default caps are the archive reader's, less a margin, so an
  // import the editor took is one a visitor's phone opens.
  it("keeps its caps below the archive reader's", () => {
    expect(TOUR_FILE_LIMITS.maxEntryBytes).toBe(256 * 1024 * 1024);
    expect(TOUR_FILE_LIMITS.maxArchiveBytes).toBe(1024 * 1024 * 1024);
    expect(TOUR_FILE_LIMITS.marginBytes).toBeGreaterThan(0);
  });

  // Why: a model with no mesh, or one whose bounds are zero, passes the
  // inert check but shows nothing and cannot be sized: refused at the
  // import, as is a model the inert check refuses.
  it("refuses a model that is not inert, shows nothing or cannot be measured", async () => {
    const remote = await readTourFile(
      glb({ asset: { version: "2.0" }, buffers: [{ uri: "https://x/b.bin" }] }),
      "m.glb",
      { tourBytes: 0, known: none, measureModel: () => Promise.resolve(1) },
    );
    expect(remote.kind).toBe("refused");
    const empty = await readTourFile(
      glb({ asset: { version: "2.0" } }),
      "m.glb",
      {
        tourBytes: 0,
        known: none,
        measureModel: () => Promise.resolve(0),
      },
    );
    expect(empty).toEqual({
      kind: "refused",
      reason:
        "That 3D model has nothing to show: it has no mesh, or its size is zero.",
    });
    const unread = await readTourFile(
      glb({ asset: { version: "2.0" } }),
      "m.glb",
      {
        tourBytes: 0,
        known: none,
        measureModel: () => Promise.reject(new Error("bad")),
      },
    );
    expect(unread).toEqual({
      kind: "refused",
      reason: "That 3D model could not be read.",
    });
    const ok = await readTourFile(glb({ asset: { version: "2.0" } }), "m.glb", {
      tourBytes: 0,
      known: none,
      measureModel: () => Promise.resolve(2),
    });
    expect(ok).toMatchObject({ kind: "read", asset: { kind: "model" } });
  });

  // Why: an image carries its pixel size (the plane's aspect without a
  // decode), and one larger than a phone can decode is refused.
  it("measures an image and refuses one over the pixel cap", async () => {
    const ok = await readTourFile(png(30, 20), "p.png", {
      tourBytes: 0,
      known: none,
    });
    expect(ok).toMatchObject({
      kind: "read",
      asset: { kind: "image", width: 30, height: 20 },
    });
    const huge = await readTourFile(png(5000, 5000), "p.png", {
      tourBytes: 0,
      known: none,
    });
    expect(huge.kind).toBe("refused");
  });

  // Why: a video's poster is the still the card shows until the clip
  // plays; minted at the import, it is an image asset of its own, by its
  // own hash. A video whose poster cannot be made is still taken.
  it("mints a video's poster as an image asset of its own", async () => {
    const poster = png(16, 9);
    const read = await readTourFile(blobOf("film"), "f.mp4", {
      tourBytes: 0,
      known: none,
      posterOf: () => Promise.resolve(poster),
    });
    if (read.kind !== "read") throw new Error(read.reason);
    const sha = await sha256Hex(new Uint8Array(await poster.arrayBuffer()));
    expect(read.poster?.asset).toEqual({
      id: sha,
      path: `content/${sha}.png`,
      kind: "image",
      width: 16,
      height: 9,
    });
    const without = await readTourFile(blobOf("film2"), "f.mp4", {
      tourBytes: 0,
      known: none,
      posterOf: () => Promise.reject(new Error("no decoder")),
    });
    expect(without).toMatchObject({ kind: "read", asset: { kind: "video" } });
    expect("poster" in without && without.poster).toBeFalsy();
  });
});
