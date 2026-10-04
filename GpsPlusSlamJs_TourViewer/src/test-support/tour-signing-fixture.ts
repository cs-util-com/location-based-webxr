/**
 * TEST ONLY (imported by `*.test.ts` files alone, never by the app): builds tour zips that carry a `manifest.json` (and, from the
 * signature step on, a `manifest.sig.json`) the way the format prescribes
 * (tour kit plan K1, §8 D4), so the verification tests have honest
 * fixtures. Never imported by production code and never shipped in an
 * app: key creation, signing and export for creators are K2's.
 *
 * The hashes are taken the way the READER takes them, which is the point
 * of §8 D4: the files are packed into a zip first, then read back through
 * zip.js and the K0 capped reader (`readZipEntryBlob`), and each entry's
 * DECOMPRESSED bytes are hashed. A fixture that hashed its input strings
 * instead would agree with the verifier by construction and prove nothing
 * about the read path.
 */

import { ZipReader } from "@zip.js/zip.js";
import {
  serializeSignedTourManifest,
  SIGNED_MANIFEST_ENTRY,
  type SignedTourManifest,
  type TourFileRecord,
  type TourSeriesLink,
} from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import {
  ByteSourceReader,
  DecompressionBudget,
  listZipEntriesCapped,
  LocalCacheByteSource,
  readZipEntryBlob,
  writeStoreZip,
  type ZipEntryInput,
} from "gps-plus-slam-app-framework/storage";
import { sha256Hex } from "gps-plus-slam-app-framework/utils/sha256-hex";

export interface TourFixtureOptions {
  /** A wrapping folder for every entry (`"mytour/"`), as a re-zip makes. */
  readonly wrap?: string;
  readonly seriesId?: string;
  readonly version?: number;
  readonly links?: readonly TourSeriesLink[];
  readonly recoveryKeyCommitment?: string;
}

export interface TourFixture {
  /** The finished archive. */
  readonly zip: Blob;
  /** Every entry of `zip`, in order - re-pack a changed copy of it (with
   *  `writeStoreZip`) to build a tampered archive around the same
   *  manifest. */
  readonly entries: readonly ZipEntryInput[];
  readonly manifest: SignedTourManifest;
  /** The exact bytes of `manifest.json` as stored. */
  readonly manifestText: string;
}

/** The decompressed bytes of every file entry, read the reader's way. */
async function readBack(zip: Blob): Promise<Map<string, Uint8Array>> {
  const reader = new ZipReader(
    new ByteSourceReader(new LocalCacheByteSource(zip)),
  );
  try {
    const budget = DecompressionBudget.forArchive(zip.size);
    const out = new Map<string, Uint8Array>();
    for (const entry of await listZipEntriesCapped(reader)) {
      if (entry.directory) continue;
      const blob = await readZipEntryBlob(
        entry,
        budget,
        "application/octet-stream",
      );
      out.set(entry.filename, new Uint8Array(await blob.arrayBuffer()));
    }
    return out;
  } finally {
    await reader.close();
  }
}

/**
 * A tour zip of `files` (names relative to the tour folder) plus a
 * `manifest.json` listing each one's SHA-256 and size, unsigned.
 */
export async function buildListedTourFixture(
  files: Readonly<Record<string, string | Uint8Array>>,
  options: TourFixtureOptions = {},
): Promise<TourFixture> {
  const wrap = options.wrap ?? "";
  const content: ZipEntryInput[] = Object.entries(files).map(
    ([path, data]) => ({
      path: `${wrap}${path}`,
      data,
    }),
  );
  const bytes = await readBack(await writeStoreZip(content, "tour fixture"));
  const records: Record<string, TourFileRecord> = {};
  for (const [name, data] of bytes) {
    records[name.slice(wrap.length)] = {
      sha256: await sha256Hex(data),
      size: data.length,
    };
  }
  const manifest: SignedTourManifest = {
    formatVersion: 1,
    seriesId: options.seriesId ?? "Fx7qT2mK9pL4sV8bN1rW6a",
    version: options.version ?? 1,
    createdAt: "2026-10-04T08:00:00.000Z",
    files: records,
    links: options.links ?? [],
    ...(options.recoveryKeyCommitment === undefined
      ? {}
      : { recoveryKeyCommitment: options.recoveryKeyCommitment }),
  };
  const manifestText = serializeSignedTourManifest(manifest);
  const entries = [
    ...content,
    { path: `${wrap}${SIGNED_MANIFEST_ENTRY}`, data: manifestText },
  ];
  return {
    zip: await writeStoreZip(entries, "tour fixture"),
    entries,
    manifest,
    manifestText,
  };
}
