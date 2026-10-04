/**
 * Why these tests matter: a tour that carries `manifest.json` promises
 * that its archive is exactly the listed files (tour kit plan K1, §8 D3).
 * The first tier of that promise runs at open, before anything is shown:
 * a file slipped in beside the listed ones, a size that changed, or the
 * same name twice must stop the open - for a link and for a file alike -
 * while a tour with no manifest (every tour made before K1) must open
 * exactly as before. The fixtures hash the entries the way the reader
 * reads them (`test-support/tour-signing-fixture.ts`).
 */

import { describe, expect, it } from "vitest";

import { TourIntegrityError } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import {
  writeStoreZip,
  type FetchImpl,
  type ZipEntryInput,
} from "gps-plus-slam-app-framework/storage";

import { buildListedTourFixture } from "./test-support/tour-signing-fixture.js";
import type { TourIntegrity } from "./tour-integrity.js";
import { openTourFile, openTourSession } from "./tour-session.js";

const FILES = {
  "tour.json": JSON.stringify({ version: 2, objects: [] }),
  "content/gate.jpg": "JPEGDATA",
};

/** Serves `bytes` as one whole body: the open reads it eagerly. */
function server(bytes: Uint8Array): FetchImpl {
  return (_input, init) =>
    Promise.resolve(
      (init?.method ?? "GET") === "HEAD"
        ? new Response(null, {
            status: 200,
            headers: { "content-length": String(bytes.length) },
          })
        : new Response(bytes.slice(), { status: 200 }),
    );
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

async function openLink(zip: Blob) {
  return openTourSession("https://host/tour.zip", {
    fetchImpl: server(await bytesOf(zip)),
  });
}

async function failureKind(open: Promise<unknown>): Promise<string | null> {
  try {
    await open;
    return null;
  } catch (err) {
    return err instanceof TourIntegrityError ? err.kind : String(err);
  }
}

describe("tier 1: the archive against its manifest, at open", () => {
  it("opens a listed tour and exposes what was checked", async () => {
    const fixture = await buildListedTourFixture(FILES, { version: 4 });
    const session = await openLink(fixture.zip);
    expect(session.integrity).toMatchObject({
      kind: "listed",
      manifest: { version: 4, seriesId: fixture.manifest.seriesId },
    });
    const { records } = session.integrity as Extract<
      TourIntegrity,
      { kind: "listed" }
    >;
    expect(records.get("content/gate.jpg")?.size).toBe(8);
    await session.close();
  });

  it("opens a tour without a manifest exactly as before, with nothing to check", async () => {
    const zip = await writeStoreZip(
      Object.entries(FILES).map(([path, data]) => ({ path, data })),
      "test",
    );
    const session = await openLink(zip);
    expect(session.integrity).toEqual({ kind: "none" });
    await session.close();
  });

  it("opens a tour re-zipped into a folder with ./ names", async () => {
    const fixture = await buildListedTourFixture(FILES, { wrap: "./mytour/" });
    const session = await openLink(fixture.zip);
    expect(session.integrity.kind).toBe("listed");
    await session.close();
  });

  const repack = (entries: readonly ZipEntryInput[]) =>
    writeStoreZip(entries, "test");

  it("refuses a file slipped in beside the listed ones", async () => {
    const { entries } = await buildListedTourFixture(FILES);
    const zip = await repack([
      ...entries,
      { path: "content/extra.jpg", data: "X" },
    ]);
    expect(await failureKind(openLink(zip))).toBe("unlisted-file");
  });

  it("refuses a listed file that is missing", async () => {
    const { entries } = await buildListedTourFixture(FILES);
    const zip = await repack(
      entries.filter((e) => e.path !== "content/gate.jpg"),
    );
    expect(await failureKind(openLink(zip))).toBe("missing-file");
  });

  it("refuses a file whose size changed", async () => {
    const { entries } = await buildListedTourFixture(FILES);
    const zip = await repack(
      entries.map((e) =>
        e.path === "content/gate.jpg" ? { ...e, data: "JPEGDATA!" } : e,
      ),
    );
    expect(await failureKind(openLink(zip))).toBe("size-mismatch");
  });

  it("refuses the same name twice", async () => {
    // zip.js refuses to WRITE a duplicate name, so the crafted archive
    // carries a same-length name that is patched into the duplicate in
    // place - the way K0's own duplicate-name tests build one.
    const { entries } = await buildListedTourFixture(FILES);
    const zip = await repack([
      ...entries,
      { path: "content/gatX.jpg", data: "JPEGDATA" },
    ]);
    const bytes = await bytesOf(zip);
    const from = new TextEncoder().encode("content/gatX.jpg");
    const to = new TextEncoder().encode("content/gate.jpg");
    for (let i = 0; i + from.length <= bytes.length; i += 1) {
      if (from.every((b, j) => bytes[i + j] === b)) bytes.set(to, i);
    }
    expect(await failureKind(openLink(new Blob([bytes as BlobPart])))).toBe(
      "duplicate-name",
    );
  });

  it("refuses the same file under two spellings", async () => {
    const { entries } = await buildListedTourFixture(FILES);
    const zip = await repack([
      ...entries,
      { path: "./content/gate.jpg", data: "JPEGDATA" },
    ]);
    expect(await failureKind(openLink(zip))).toBe("duplicate-name");
  });

  it("refuses a malformed manifest", async () => {
    const { entries } = await buildListedTourFixture(FILES);
    const zip = await repack(
      entries.map((e) =>
        e.path === "manifest.json" ? { ...e, data: "{ nope" } : e,
      ),
    );
    expect(await failureKind(openLink(zip))).toBe("malformed-manifest");
  });

  it("checks a tour opened from a FILE the same way", async () => {
    const { entries } = await buildListedTourFixture(FILES);
    const zip = await repack([...entries, { path: "evil.jpg", data: "X" }]);
    const file = new File([zip], "tour.zip", { type: "application/zip" });
    expect(await failureKind(openTourFile(file))).toBe("unlisted-file");
  });
});
