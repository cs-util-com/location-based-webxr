import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  authoringReducer,
  addWaypoint,
  attachAsset,
  setTourMeta,
} from "../../../store/authoring-slice.js";
import { selectExportedTour } from "../../../store/selectors.js";
import { sampleTour } from "../../../store/fixtures/sample-tour.js";
import { validateTour } from "../../../store/validate-tour.js";
import type { AssetEntry, Tour } from "../../../store/types.js";
import { PackagingError, packTour } from "./pack-tour.js";

/**
 * Why these tests matter: `tour.zip` is a one-way artifact. Once the author has
 * uploaded it and printed the QR, nothing revalidates it — component 6 just
 * range-reads bytes at the offsets the central directory advertises. Two
 * properties therefore have to be proven here, at pack time, or they are proven
 * in the field by a tour that silently misses an asset:
 *
 *  1. **Every entry is STORED, not deflated.** The whole point of the format
 *     choice: component 6 slices an asset out with a byte range and no
 *     decompression step. That is why the assertions below read the real ZIP
 *     bytes rather than trusting fflate's options — an accidental `level: 6`
 *     would still produce a perfectly valid ZIP that unzips fine in every test
 *     that only checks content, and would break only the range reader.
 *  2. **Every declared asset is actually in the archive.** Entries are keyed by
 *     path, so a duplicate `filename` would overwrite an asset with no error at
 *     all (contract §Invariant 3 makes that this component's job to catch).
 */

// ── ZIP byte readers ─────────────────────────────────────────────────────────
// Minimal, deliberately independent of fflate: if the library's own reader were
// used to check the library's own writer, a shared misunderstanding of the
// format would cancel out.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const STORED = 0x0000;

interface CentralEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);

/** Offset of the End Of Central Directory record (scanned from the tail). */
function findEocd(view: DataView): number {
  for (let i = view.byteLength - EOCD_MIN_SIZE; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  throw new Error("not a ZIP: no EOCD record");
}

/**
 * Parse the central directory — the index component 6 actually reads. Method
 * and sizes live here as well as in each local header, and the two are allowed
 * to disagree in a malformed file, so both get asserted.
 */
function readCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  const view = viewOf(bytes);
  const eocd = findEocd(view);
  const total = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const entries: CentralEntry[] = [];

  for (let i = 0; i < total; i++) {
    if (view.getUint32(at, true) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error(`corrupt central directory at ${at}`);
    }
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    entries.push({
      name: new TextDecoder().decode(
        bytes.subarray(at + 46, at + 46 + nameLength),
      ),
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      uncompressedSize: view.getUint32(at + 24, true),
      localHeaderOffset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Compression method recorded in the local file header at `offset`. */
function readLocalMethod(bytes: Uint8Array, offset: number): number {
  const view = viewOf(bytes);
  if (view.getUint32(offset, true) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error(`no local header at ${offset}`);
  }
  return view.getUint16(offset + 8, true);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

// Recognisable magic bytes: makes a mixed-up entry obvious in a failure diff.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]);
const MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]);

const sampleFiles = (): Map<string, File> =>
  new Map([
    ["asset-gate", new File([PNG_BYTES], "gate.png")],
    ["asset-intro", new File([MP3_BYTES], "intro.mp3")],
  ]);

/** `sampleTour` with its asset registry swapped for `assets`. */
const tourWithAssets = (assets: readonly AssetEntry[]): Tour => ({
  ...sampleTour,
  assets,
});

const zipBytesOf = async (blob: Blob): Promise<Uint8Array> =>
  new Uint8Array(await blob.arrayBuffer());

// ── Tests ────────────────────────────────────────────────────────────────────

describe("packTour", () => {
  it("returns a ZIP blob containing tour.json and every declared asset", async () => {
    const blob = await packTour(sampleTour, sampleFiles());
    expect(blob.type).toBe("application/zip");

    const unzipped = unzipSync(await zipBytesOf(blob));
    expect(Object.keys(unzipped).sort()).toEqual([
      "assets/asset-gate.png",
      "assets/asset-intro.mp3",
      "tour.json",
    ]);
    expect(unzipped["assets/asset-gate.png"]).toEqual(PNG_BYTES);
    expect(unzipped["assets/asset-intro.mp3"]).toEqual(MP3_BYTES);
  });

  it("writes a tour.json that survives validateTour unchanged", async () => {
    const blob = await packTour(sampleTour, sampleFiles());
    const unzipped = unzipSync(await zipBytesOf(blob));
    const json = new TextDecoder().decode(unzipped["tour.json"]);

    expect(validateTour(JSON.parse(json))).toEqual(sampleTour);
  });

  it("stores every entry uncompressed, in both the local header and the central directory", async () => {
    const bytes = await zipBytesOf(await packTour(sampleTour, sampleFiles()));
    const entries = readCentralDirectory(bytes);

    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      // The central directory is what the range reader consults...
      expect(entry.method).toBe(STORED);
      expect(entry.compressedSize).toBe(entry.uncompressedSize);
      // ...and the local header must agree, or a reader trusting either one wins.
      expect(readLocalMethod(bytes, entry.localHeaderOffset)).toBe(STORED);
    }
  });

  it("names every missing asset id in one error, and produces no blob", async () => {
    const files = sampleFiles();
    files.delete("asset-gate");
    files.delete("asset-intro");

    const promise = packTour(sampleTour, files);
    await expect(promise).rejects.toBeInstanceOf(PackagingError);
    // Both, not just the first: the author fixes one round-trip, not two.
    await expect(promise).rejects.toThrow(/asset-gate/);
    await expect(promise).rejects.toThrow(/asset-intro/);
  });

  it("rejects a single missing asset id", async () => {
    const files = sampleFiles();
    files.delete("asset-intro");

    await expect(packTour(sampleTour, files)).rejects.toThrow(/asset-intro/);
  });

  it("rejects duplicate filenames instead of silently overwriting an asset", async () => {
    // Entries are keyed by path: without this check the archive would come out
    // one asset short, valid, and wrong.
    const tour = tourWithAssets([
      { id: "asset-gate", type: "sprite", filename: "assets/same.bin" },
      { id: "asset-intro", type: "audio", filename: "assets/same.bin" },
    ]);

    await expect(packTour(tour, sampleFiles())).rejects.toThrow(
      /assets\/same\.bin/,
    );
  });

  it.each([
    ["a parent-directory escape", "../escape.glb"],
    ["an absolute path", "/abs.glb"],
    ["a drive-lettered path", "C:/abs.glb"],
    ["a backslash separator", "assets\\gate.png"],
    ["an empty filename", ""],
    ["a collision with tour.json", "tour.json"],
  ])("rejects %s", async (_label, filename) => {
    const tour = tourWithAssets([
      { id: "asset-gate", type: "sprite", filename },
    ]);
    const files = new Map([["asset-gate", new File([PNG_BYTES], "gate.png")]]);

    await expect(packTour(tour, files)).rejects.toBeInstanceOf(PackagingError);
  });

  it("packs a tour exported straight from the authoring slice", async () => {
    // The real authoring → packaging path (contract D12): draft actions →
    // selectExportedTour → packTour → tour.json that validates back out.
    const asset: AssetEntry = {
      id: "asset-a",
      type: "sprite",
      filename: "assets/asset-a.png",
    };
    const actions = [
      setTourMeta({ name: "Harbour Walk", description: "Along the docks." }),
      addWaypoint({ id: "wp-1", position: { lat: 53.55, lon: 9.99 } }),
      attachAsset({ waypointId: "wp-1", slot: "sprite", asset }),
    ];
    const authoring = actions.reduce(
      authoringReducer,
      authoringReducer(undefined, { type: "@@init" }),
    );
    const exported = selectExportedTour({ authoring });

    const blob = await packTour(
      exported,
      new Map([["asset-a", new File([PNG_BYTES], "a.png")]]),
    );
    const unzipped = unzipSync(await zipBytesOf(blob));
    const packed = validateTour(
      JSON.parse(new TextDecoder().decode(unzipped["tour.json"])),
    );

    expect(packed).toEqual(exported);
    expect(unzipped["assets/asset-a.png"]).toEqual(PNG_BYTES);
  });
});
