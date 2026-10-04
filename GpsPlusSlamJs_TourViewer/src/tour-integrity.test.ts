/**
 * Why these tests matte  const repack = (entries: readonly ZipEntryInput[]) =>
    writeStoreZip(entries, "test");

r: a tour that carries `manifest.json` promises
 * that its archive is exactly the listed files (tour kit plan K1, §8 D3).
 * The first tier of that promise runs at open, before anything is shown:
 * a file slipped in beside the listed ones, a size that changed, or the
 * same name twice must stop the open - for a link and for a file alike -
 * while a tour with no manifest (every tour made before K1) must open
 * exactly as before. The fixtures hash the entries the way the reader
 * reads them (`test-support/tour-signing-fixture.ts`).
 */

import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { TourIntegrityError } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import {
  InMemoryLocalCacheStore,
  writeStoreZip,
  type FetchImpl,
  type ZipEntryInput,
} from "gps-plus-slam-app-framework/storage";

import {
  buildListedTourFixture,
  buildSignedTourFixture,
  generateFixtureKey,
  signManifestText,
} from "./test-support/tour-signing-fixture.js";
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

/** Serves real 206 slices of `bytes`; the range-less GET (the warm
 *  download) serves `fullBody`, which a test can make differ. */
function rangeServer(
  bytes: Uint8Array,
  fullBody: Uint8Array = bytes,
): FetchImpl {
  return (_input, init) => {
    const headers = { "content-length": String(bytes.length), etag: '"t1"' };
    if ((init?.method ?? "GET") === "HEAD") {
      return Promise.resolve(new Response(null, { status: 200, headers }));
    }
    const range = new Headers(init?.headers).get("range");
    if (range === null) {
      return Promise.resolve(
        new Response(fullBody.slice(), { status: 200, headers }),
      );
    }
    const m = /^bytes=(\d+)-(\d+)$/.exec(range)!;
    const [start, end] = [Number(m[1]), Number(m[2])];
    const slice = bytes.slice(start, Math.min(end + 1, bytes.length));
    return Promise.resolve(
      new Response(slice, {
        status: 206,
        headers: {
          ...headers,
          "content-range": `bytes ${String(start)}-${String(start + slice.length - 1)}/${String(bytes.length)}`,
        },
      }),
    );
  };
}

/** The fixture with one entry's bytes replaced by SAME-LENGTH bytes: the
 *  names and sizes still match (tier 1 passes), the hash does not. */
async function tampered(
  path: string,
  data: string,
  files: Record<string, string> = FILES,
): Promise<Blob> {
  const { entries } = await buildListedTourFixture(files);
  return writeStoreZip(
    entries.map((e) => (e.path === path ? { ...e, data } : e)),
    "test",
  );
}

describe("tier 2: every entry read is hashed", () => {
  it("a read whose bytes changed fails, is reported once, and every later read fails too", async () => {
    const zip = await tampered("content/gate.jpg", "JPEGDATB");
    const reported: string[] = [];
    const session = await openTourSession("https://host/t.zip", {
      fetchImpl: rangeServer(await bytesOf(zip)),
      onIntegrityFailure: (err, s) => {
        reported.push(err.kind);
        expect(s).toBe(session);
      },
    });
    // Tier 1 passed: names and sizes match.
    expect(session.integrity.kind).toBe("listed");
    expect(await failureKind(session.loadEntry("content/gate.jpg"))).toBe(
      "hash-mismatch",
    );
    expect(reported).toEqual(["hash-mismatch"]);
    expect(session.integrityFailure()?.kind).toBe("hash-mismatch");
    // An honest entry, read after the failure, is not shown either.
    expect(await failureKind(session.loadEntryText("tour.json"))).toBe(
      "hash-mismatch",
    );
    expect(await failureKind(session.readWholeArchive())).toBe("hash-mismatch");
    expect(reported).toHaveLength(1);
    await session.close();
  });

  it("honest entries read through unchanged", async () => {
    const { zip } = await buildListedTourFixture(FILES);
    const session = await openTourSession("https://host/t.zip", {
      fetchImpl: rangeServer(await bytesOf(zip)),
    });
    await expect(
      session.loadEntry("content/gate.jpg").then((b) => b.text()),
    ).resolves.toBe("JPEGDATA");
    expect(session.integrityFailure()).toBeNull();
    await session.close();
  });

  it("any single flipped byte of an entry fails its read (property)", async () => {
    // One honest archive, built once; each run flips one byte of the
    // entry's STORED data in place (store mode keeps the content verbatim),
    // so the names and sizes still match and only the hash can tell.
    const content = "0123456789abcdefghij";
    const { zip } = await buildListedTourFixture({
      ...FILES,
      "content/gate.jpg": content,
    });
    const honest = await bytesOf(zip);
    const needle = new TextEncoder().encode(content);
    const offset = honest.findIndex((_, i) =>
      needle.every((b, j) => honest[i + j] === b),
    );
    expect(offset).toBeGreaterThan(0);
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: content.length - 1 }),
        fc.integer({ min: 1, max: 255 }),
        async (at, xor) => {
          const bytes = honest.slice();
          bytes[offset + at] = bytes[offset + at]! ^ xor;
          const session = await openTourSession("https://host/t.zip", {
            fetchImpl: rangeServer(bytes),
          });
          expect(await failureKind(session.loadEntry("content/gate.jpg"))).toBe(
            "hash-mismatch",
          );
          await session.close();
        },
      ),
      { numRuns: 20 },
    );
  });

  it("hashes the recording's action entries too", async () => {
    const action = JSON.stringify({ type: "gps", t: 1 });
    const files = { ...FILES, "actions/000001.json": action };
    const zip = await tampered(
      "actions/000001.json",
      action.replace("1}", "2}"),
      files,
    );
    const session = await openTourSession("https://host/t.zip", {
      fetchImpl: rangeServer(await bytesOf(zip)),
    });
    expect(await failureKind(session.loadRecordingActions())).toBe(
      "hash-mismatch",
    );
    await session.close();
  });
});

describe("tier 3: the whole archive, once it is on the device", () => {
  it("checks the warm copy and caches it when it matches", async () => {
    const { zip } = await buildListedTourFixture(FILES);
    const cacheStore = new InMemoryLocalCacheStore();
    const session = await openTourSession("https://host/t.zip", {
      fetchImpl: rangeServer(await bytesOf(zip)),
      cacheStore,
    });
    await expect(session.wholeArchiveCheck).resolves.toBe("checked");
    await expect(cacheStore.get(session.archive.url)).resolves.toBeDefined();
    await session.close();
  });

  it("a warm copy that does not match fails LATE, is never cached, and stops every read", async () => {
    const good = await bytesOf((await buildListedTourFixture(FILES)).zip);
    const bad = await bytesOf(await tampered("content/gate.jpg", "JPEGDATB"));
    const cacheStore = new InMemoryLocalCacheStore();
    const reported: string[] = [];
    const session = await openTourSession("https://host/t.zip", {
      fetchImpl: rangeServer(good, bad),
      cacheStore,
      onIntegrityFailure: (err) => reported.push(err.kind),
    });
    await expect(session.wholeArchiveCheck).resolves.toBe("failed");
    expect(reported).toEqual(["hash-mismatch"]);
    await expect(cacheStore.get(session.archive.url)).resolves.toBeUndefined();
    expect(await failureKind(session.loadEntryText("tour.json"))).toBe(
      "hash-mismatch",
    );
    await session.close();
  });

  it("an archive downloaded whole at open is checked before it opens, and never cached when it fails", async () => {
    const bad = await bytesOf(await tampered("content/gate.jpg", "JPEGDATB"));
    const cacheStore = new InMemoryLocalCacheStore();
    // A host that ignores Range: the open downloads the whole body.
    expect(
      await failureKind(
        openTourSession("https://host/t.zip", {
          fetchImpl: server(bad),
          cacheStore,
        }),
      ),
    ).toBe("hash-mismatch");
    await expect(cacheStore.get("https://host/t.zip")).resolves.toBeUndefined();
  });

  it("re-checks a SAVED copy in the background and drops it when it fails", async () => {
    const bad = await tampered("content/gate.jpg", "JPEGDATB");
    const cacheStore = new InMemoryLocalCacheStore();
    // A copy saved before K1 existed (no check ran when it was stored).
    await cacheStore.put("https://host/t.zip", {
      blob: bad,
      validators: { etag: '"t1"' },
    });
    const reported: string[] = [];
    const session = await openTourSession("https://host/t.zip", {
      fetchImpl: rangeServer(await bytesOf(bad)),
      cacheStore,
      onIntegrityFailure: (err) => reported.push(err.kind),
    });
    expect(session.archive.origin).toBe("cache");
    await expect(session.wholeArchiveCheck).resolves.toBe("failed");
    expect(reported).toEqual(["hash-mismatch"]);
    await vi.waitFor(async () => {
      await expect(
        cacheStore.get("https://host/t.zip"),
      ).resolves.toBeUndefined();
    });
    await session.close();
  });

  it("checks a tour opened from a file as a whole", async () => {
    const bad = await tampered("content/gate.jpg", "JPEGDATB");
    const reported: string[] = [];
    const session = await openTourFile(
      new File([bad], "tour.zip", { type: "application/zip" }),
      { onIntegrityFailure: (err) => reported.push(err.kind) },
    );
    await expect(session.wholeArchiveCheck).resolves.toBe("failed");
    expect(reported).toEqual(["hash-mismatch"]);
    await session.close();
  });

  it("a tour without a manifest: checked with a cache (nothing to find), not checked without one", async () => {
    const zip = await writeStoreZip(
      Object.entries(FILES).map(([path, data]) => ({ path, data })),
      "test",
    );
    const cached = await openTourSession("https://host/t.zip", {
      fetchImpl: rangeServer(await bytesOf(zip)),
      cacheStore: new InMemoryLocalCacheStore(),
    });
    await expect(cached.wholeArchiveCheck).resolves.toBe("checked");
    await cached.close();
    const uncached = await openTourSession("https://host/t.zip", {
      fetchImpl: rangeServer(await bytesOf(zip)),
    });
    await expect(uncached.wholeArchiveCheck).resolves.toBe("not-checked");
    await uncached.close();
  });
});

describe("the signature (tour kit plan K1, K-D2)", () => {
  // Why this matters: a signature is checked before anything the manifest
  // says is believed. A valid one names its key; one that does not verify
  // - another key, a re-made list, a signature with no list - stops the
  // open as "modified"; and a browser that cannot check Ed25519 opens the
  // tour as signed-but-NOT-checked, never as valid.
  const repack = (entries: readonly ZipEntryInput[]) =>
    writeStoreZip(entries, "test");

  it("opens a signed tour, naming the key that signed it", async () => {
    const key = await generateFixtureKey();
    const { zip } = await buildSignedTourFixture(FILES, key);
    const session = await openLink(zip);
    expect(session.integrity).toMatchObject({
      kind: "listed",
      signature: { kind: "valid", author: key.author },
    });
    await session.close();
  });

  it("a listed but unsigned tour carries no signature verdict", async () => {
    const { zip } = await buildListedTourFixture(FILES);
    const session = await openLink(zip);
    expect(session.integrity).toMatchObject({
      kind: "listed",
      signature: null,
    });
    await session.close();
  });

  it("refuses a signature that names another key", async () => {
    const key = await generateFixtureKey();
    const other = await generateFixtureKey();
    const { entries, signatureText } = await buildSignedTourFixture(FILES, key);
    const forged = JSON.stringify({
      ...(JSON.parse(signatureText) as object),
      author: other.author,
    });
    const zip = await repack(
      entries.map((e) =>
        e.path === "manifest.sig.json" ? { ...e, data: forged } : e,
      ),
    );
    expect(await failureKind(openLink(zip))).toBe("bad-signature");
  });

  it("refuses a list re-made after signing, though every hash in it is right", async () => {
    const key = await generateFixtureKey();
    const signed = await buildSignedTourFixture(FILES, key);
    // The attacker adds a file and lists it honestly - only the signature
    // is now over the OLD list.
    const remade = await buildListedTourFixture({
      ...FILES,
      "content/evil.jpg": "X",
    });
    const zip = await repack([
      ...remade.entries,
      { path: "manifest.sig.json", data: signed.signatureText },
    ]);
    expect(await failureKind(openLink(zip))).toBe("bad-signature");
  });

  it("refuses a signature with no manifest to sign", async () => {
    const key = await generateFixtureKey();
    const zip = await repack([
      ...Object.entries(FILES).map(([path, data]) => ({ path, data })),
      { path: "manifest.sig.json", data: await signManifestText("{}", key) },
    ]);
    expect(await failureKind(openLink(zip))).toBe("malformed-signature");
  });

  it("on a browser without Ed25519 the tour opens as signed but NOT checked", async () => {
    const key = await generateFixtureKey();
    const { zip } = await buildSignedTourFixture(FILES, key);
    const spy = vi
      .spyOn(crypto.subtle, "importKey")
      .mockRejectedValue(
        new DOMException("Unrecognized name", "NotSupportedError"),
      );
    try {
      const session = await openLink(zip);
      expect(session.integrity).toMatchObject({
        signature: { kind: "unsupported", author: key.author },
      });
      await session.close();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("a file-opened tour's key (tour kit plan K1, R7)", () => {
  // Why this matters: the draft store, the open tour's identity and the
  // scan comparisons key on `archive.url`, which for a file is this key.
  const file = (zip: Blob) =>
    new File([zip], "tour.zip", { type: "application/zip" });

  it("is the series id when the tour carries a manifest, whatever its content", async () => {
    const first = await buildListedTourFixture(FILES, {
      seriesId: "SeriesAAAAAAAAAAAAAAAAA",
    });
    const next = await buildListedTourFixture(
      { ...FILES, "content/new.jpg": "NEW" },
      { seriesId: "SeriesAAAAAAAAAAAAAAAAA", version: 2 },
    );
    const a = await openTourFile(file(first.zip));
    const b = await openTourFile(file(next.zip));
    expect(a.archive.url).toBe("local-file:series:SeriesAAAAAAAAAAAAAAAAA");
    expect(b.archive.url).toBe(a.archive.url);
    await a.close();
    await b.close();
  });

  it("stays the content key for a tour without a manifest", async () => {
    const zip = await writeStoreZip(
      Object.entries(FILES).map(([path, data]) => ({ path, data })),
      "test",
    );
    const session = await openTourFile(file(zip));
    expect(session.archive.url).toMatch(/^local-file:[0-9a-f]{32}$/);
    await session.close();
  });
});
