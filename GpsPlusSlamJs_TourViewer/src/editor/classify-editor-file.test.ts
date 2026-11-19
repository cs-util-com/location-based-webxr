import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import type * as Storage from "gps-plus-slam-app-framework/storage";
import { MAX_IDENTITY_BYTES } from "../debug-bundle.js";
import { tourManifestEntryOf } from "gps-plus-slam-app-framework/ar/tour-archive";
import { qrLevelIdFromEntryName } from "gps-plus-slam-app-framework/ar/qr/qr-level-archive";
import {
  BlobWriter,
  TextReader,
  Uint8ArrayReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { recordingEntryNames } from "../tour-read-set.js";

/** Every entry read, kept: the cap it was given, and its blob's size or
 *  what it threw. The read itself is the real one; this only watches it. */
const reads = vi.hoisted(
  () =>
    [] as Array<{
      cap: number | undefined;
      end: { size: number } | { error: unknown };
    }>,
);
vi.mock("gps-plus-slam-app-framework/storage", async (importOriginal) => {
  const real = await importOriginal<typeof Storage>();
  return {
    ...real,
    readZipEntryBlob: async (
      ...args: Parameters<typeof real.readZipEntryBlob>
    ) => {
      const cap = args[3];
      try {
        const blob = await real.readZipEntryBlob(...args);
        reads.push({ cap, end: { size: blob.size } });
        return blob;
      } catch (error) {
        reads.push({ cap, end: { error } });
        throw error;
      }
    },
  };
});
import {
  classifyEditorFile,
  classifyEditorFiles,
  TOUR_SUMMARY_MAX_BYTES,
} from "./classify-editor-file.js";
import { NOT_A_TOUR, NOT_A_ZIP } from "./editor-open.js";

async function zipFile(
  name: string,
  entries: readonly { path: string; data: string }[],
): Promise<File> {
  const blob = await packFilesAsZip(entries);
  return new File([blob], name, { type: "application/zip" });
}

/** A File that counts the bytes its readers slice out of it. */
class CountingFile extends File {
  bytesRead = 0;
  override slice(start?: number, end?: number, type?: string): Blob {
    const part = super.slice(start, end, type);
    this.bytesRead += part.size;
    return part;
  }
}

const IDENTITY = JSON.stringify({
  format: 1,
  seriesId: null,
  tour: "Castle walk",
  file: "castle.zip",
  writtenAt: "2026-11-19T10:00:00.000Z",
});

/**
 * Why these tests matter: the editor decides from this what a dropped or
 * chosen file IS before opening anything - a tour opens, a scan is added
 * beside a tour, anything else is refused in words. A scan read as a tour
 * would open a recording as an empty tour; a tour read as a scan would
 * never open.
 */
describe("classifyEditorFile", () => {
  it("sorts a tour.json zip as a tour", async () => {
    const file = await zipFile("castle.zip", [
      { path: "tour.json", data: "{}" },
    ]);
    // "{}" has no title and no stations: the summary says nothing.
    expect(await classifyEditorFile(file)).toEqual({
      kind: "tour",
      file,
      title: null,
      stations: null,
    });
  });

  // Why: the drop area names a tour by its title and station count, read
  // from its small tour.json - but only while that read stays cheap and
  // safe: an oversized or broken tour.json is still a tour, named only so.
  it("reads a tour's title and station count from its tour.json, wrapped too", async () => {
    const manifest = JSON.stringify({
      title: "  Castle walk  ",
      stations: [{}, {}, {}],
    });
    const file = await zipFile("castle.zip", [
      { path: "mytour/tour.json", data: manifest },
    ]);
    expect(await classifyEditorFile(file)).toMatchObject({
      kind: "tour",
      title: "Castle walk",
      stations: 3,
    });
  });

  it("names a tour only as a tour when its tour.json is broken, odd or too large", async () => {
    for (const data of [
      "not json",
      JSON.stringify({ title: 7, stations: "many" }),
      JSON.stringify({ title: "", stations: [] }),
      JSON.stringify({ title: "Big", pad: "x".repeat(TOUR_SUMMARY_MAX_BYTES) }),
    ]) {
      const file = await zipFile("t.zip", [{ path: "tour.json", data }]);
      const kind = await classifyEditorFile(file);
      expect(kind.kind).toBe("tour");
      if (kind.kind !== "tour") continue;
      expect(kind.title).toBeNull();
      expect(kind.stations === null || kind.stations === 0).toBe(true);
    }
  });

  it("sorts a zip of printed codes only as a tour", async () => {
    const file = await zipFile("codes.zip", [
      { path: "qr/abc.json", data: "{}" },
    ]);
    expect((await classifyEditorFile(file)).kind).toBe("tour");
  });

  // Why: a tour may carry its own walk; it is still the tour, never a scan.
  it("sorts a tour that carries a walk as a tour", async () => {
    const file = await zipFile("walked.zip", [
      { path: "tour.json", data: "{}" },
      { path: "actions/000001.json", data: "[]" },
    ]);
    expect((await classifyEditorFile(file)).kind).toBe("tour");
  });

  it("sorts a plain Recorder zip as a recording scan", async () => {
    const file = await zipFile("walk.zip", [
      { path: "session.json", data: "{}" },
      { path: "actions/000001.json", data: "[]" },
    ]);
    expect(await classifyEditorFile(file)).toEqual({
      kind: "scan",
      file,
      scan: { kind: "recording" },
      captures: 0,
    });
  });

  // Why: the scan row says how many camera captures it brings, counted
  // from the zip directory only (its frame images), never by reading them.
  it("counts a scan's camera captures from its directory", async () => {
    const file = await zipFile("walk.zip", [
      { path: "session.json", data: "{}" },
      { path: "actions/000001.json", data: "[]" },
      { path: "images/frame-000001.jpg", data: "j" },
      { path: "images/frame-000002.jpg", data: "j" },
      { path: "images/notes.txt", data: "n" },
    ]);
    expect(await classifyEditorFile(file)).toMatchObject({
      kind: "scan",
      captures: 2,
    });
  });

  it("sorts a debug bundle as a bundle scan with its identity", async () => {
    const file = await zipFile("castle-debug.zip", [
      { path: "actions/000001.json", data: "[]" },
      { path: "debug-bundle.json", data: IDENTITY },
    ]);
    const kind = await classifyEditorFile(file);
    expect(kind.kind).toBe("scan");
    if (kind.kind !== "scan" || kind.scan.kind !== "bundle") throw new Error();
    expect(kind.scan.identity.tour).toBe("Castle walk");
  });

  // Why: the e2e refusal specs drop a zip of only a session.json; it must
  // keep saying it is not a tour, as the open did before.
  it("refuses a zip with neither a tour nor a recording as not a tour", async () => {
    const file = await zipFile("session.zip", [
      { path: "session.json", data: "{}" },
    ]);
    expect(await classifyEditorFile(file)).toEqual({
      kind: "neither",
      file,
      reason: NOT_A_TOUR,
    });
  });

  it("refuses a file that is not a zip by name, and one whose bytes are not", async () => {
    const text = new File(["hello"], "notes.txt", { type: "text/plain" });
    expect(await classifyEditorFile(text)).toEqual({
      kind: "neither",
      file: text,
      reason: NOT_A_ZIP,
    });
    const fake = new File(["not a zip"], "fake.zip", {
      type: "application/zip",
    });
    const kind = await classifyEditorFile(fake);
    expect(kind.kind).toBe("neither");
  });

  it("refuses a bundle whose identity is unreadable, with the bundle's reason", async () => {
    const file = await zipFile("bad.zip", [
      { path: "actions/000001.json", data: "[]" },
      { path: "debug-bundle.json", data: "{ not json" },
    ]);
    const kind = await classifyEditorFile(file);
    expect(kind.kind).toBe("neither");
    if (kind.kind !== "neither") throw new Error();
    expect(kind.reason).not.toBe(NOT_A_TOUR);
  });

  // Why: the file is untrusted. Its directory may say its identity entry
  // is 100 bytes while it inflates to 8 MiB. The read must stop early (the
  // bytes inflated are measured) and the file be refused as unreadable;
  // the identity read carries its own cap, so it stops near 16 KiB even
  // where the zip reader's own check against the declared size does not
  // apply, rather than under the archive's budget of tens of MiB.
  it("stops a crafted identity entry that inflates far past what its directory declares", async () => {
    const writer = new ZipWriter(new BlobWriter("application/zip"), {
      level: 9,
    });
    await writer.add("actions/000001.json", new TextReader("[]"));
    await writer.add(
      "debug-bundle.json",
      new Uint8ArrayReader(new Uint8Array(8 << 20).fill(0x20)),
    );
    const bytes = new Uint8Array(await (await writer.close()).arrayBuffer());
    const view = new DataView(bytes.buffer);
    for (let i = 0; i + 4 <= bytes.length; i++) {
      const sig = view.getUint32(i, true);
      if (sig === 0x04034b50) view.setUint32(i + 22, 100, true);
      if (sig === 0x02014b50) view.setUint32(i + 24, 100, true);
    }
    const file = new File([bytes], "bomb.zip", { type: "application/zip" });
    reads.length = 0;
    const kind = await classifyEditorFile(file);
    expect(kind.kind).toBe("neither");
    if (kind.kind !== "neither") throw new Error();
    expect(kind.reason).toBe("Its debug-bundle.json could not be read.");
    expect(reads).toHaveLength(1);
    const read = reads[0];
    expect(read?.cap).toBe(MAX_IDENTITY_BYTES);
    if (read === undefined || !("error" in read.end)) {
      throw new Error("the identity read did not fail");
    }
    // Whichever guard stopped it, it stopped near the start.
    const err = read.end.error as { observed?: number; outputSize?: number };
    const inflated = err.observed ?? err.outputSize;
    expect(inflated).toBeDefined();
    expect(inflated).toBeLessThan(1 << 20);
  });

  // Why: two identity entries of one name say two different tours; the
  // directory lists both, so the file is refused as ambiguous rather than
  // read for the first.
  it("refuses a scan carrying its identity entry twice under one name", async () => {
    const writer = new ZipWriter(new BlobWriter("application/zip"), {
      level: 0,
    });
    await writer.add("actions/000001.json", new TextReader("[]"));
    await writer.add("debug-bundle.json", new TextReader(IDENTITY));
    await writer.add("debug-bundle.jsox", new TextReader(IDENTITY));
    const bytes = new Uint8Array(await (await writer.close()).arrayBuffer());
    const from = new TextEncoder().encode("debug-bundle.jsox");
    for (let i = 0; i + from.length <= bytes.length; i++) {
      if (from.every((b, k) => bytes[i + k] === b)) bytes[i + 16] = 0x6e;
    }
    const file = new File([bytes], "twice.zip", { type: "application/zip" });
    const kind = await classifyEditorFile(file);
    expect(kind.kind).toBe("neither");
    if (kind.kind !== "neither") throw new Error();
    expect(kind.reason).toMatch(/more than one debug-bundle\.json/);
  });

  // Why: the plan's "chips without reading the scan" - a scan sorts from
  // its directory; its walk's bytes are never read.
  it("reads only the directory of a scan, never its walk", async () => {
    const big = "x".repeat(2_000_000);
    const blob = await packFilesAsZip([
      { path: "actions/000001.json", data: big },
      { path: "content/photo.jpg", data: big },
    ]);
    const file = new CountingFile([blob], "walk.zip", {
      type: "application/zip",
    });
    expect((await classifyEditorFile(file)).kind).toBe("scan");
    expect(file.bytesRead).toBeGreaterThan(0);
    // The byte source reads in cache blocks (tens of KB): a fixed cost,
    // not one that grows with the walk.
    expect(file.bytesRead).toBeLessThan(200_000);
    expect(file.size).toBeGreaterThan(4_000_000);
  });

  // Why: a list sorts every file, in its order, and one bad file costs
  // only itself.
  it("sorts every file of a list, in order", async () => {
    const tour = await zipFile("t.zip", [{ path: "tour.json", data: "{}" }]);
    const scan = await zipFile("s.zip", [
      { path: "actions/1.json", data: "[]" },
    ]);
    const text = new File(["x"], "x.txt");
    const kinds = await classifyEditorFiles([tour, text, scan]);
    expect(kinds.map((k) => k.kind)).toEqual(["tour", "neither", "scan"]);
    expect(kinds.map((k) => k.file)).toEqual([tour, text, scan]);
  });

  // Why: the file is untrusted - whatever entry names it carries, the
  // classifier answers and never rejects, and a tour entry always wins.
  // The oracle is the archive's own predicates (a wrapped tour, `w/tour.json`
  // or `ab/qr/cd.json`, is a tour too), so wrapped tours are tested as well.
  it("never rejects, and a tour entry always makes a tour", async () => {
    const name = fc.oneof(
      fc.constantFrom(
        "tour.json",
        "qr/a.json",
        "actions/1.json",
        "debug-bundle.json",
        "w/tour.json",
        "ab/qr/cd.json",
        "w/actions/1.json",
      ),
      fc.stringMatching(/^[a-z]{1,6}(\/[a-z]{1,6}){0,2}\.(json|jpg|bin)$/),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(name, { maxLength: 6 }),
        async (names) => {
          const file = await zipFile(
            "f.zip",
            names.map((path) => ({ path, data: "{}" })),
          );
          const kind = await classifyEditorFile(file);
          const tourish =
            tourManifestEntryOf(names) !== null ||
            names.some((n) => qrLevelIdFromEntryName(n) !== null);
          const walk = recordingEntryNames(names).length > 0;
          const allowed = tourish
            ? ["tour"]
            : walk
              ? ["scan", "neither"]
              : ["neither"];
          expect(allowed).toContain(kind.kind);
        },
      ),
      { numRuns: 60 },
    );
  });
});
