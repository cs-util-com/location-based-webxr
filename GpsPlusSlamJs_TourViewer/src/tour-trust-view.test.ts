/**
 * Why these tests matter: this is where an opened tour's signature meets
 * the phone's memory (tour kit plan K1, §8 D2). The lines it returns are
 * what the visitor reads; the record it writes is what the NEXT open is
 * judged against. A signature this browser could not check must neither
 * be learned (a later forged key would then look like the reference) nor
 * produce warnings, and every key it names must be shown by fingerprint.
 */

import { describe, expect, it } from "vitest";

import { keyFingerprint } from "gps-plus-slam-app-framework/ar/tour-signature";

import type { TourIntegrity } from "./tour-integrity.js";
import { describeTourTrust } from "./tour-trust-view.js";
import {
  linkTrustKey,
  loadTrustRecords,
  type TrustStorage,
} from "./tour-trust.js";

const A = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const B = "did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP";
const LINK = linkTrustKey("https://host/tour.zip");

function memory(): TrustStorage {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_k, v) => {
      value = v;
    },
  };
}

function signed(
  author: string,
  kind: "valid" | "unsupported" = "valid",
  links: { seriesId: string; author: string }[] = [],
): TourIntegrity {
  return {
    kind: "listed",
    signature:
      kind === "valid"
        ? { kind, author }
        : { kind, author, reason: "no Ed25519" },
    manifest: {
      formatVersion: 1,
      seriesId: "K7fQ2mX9pL4sT8vB1nR6wA",
      version: 1,
      createdAt: "2026-10-04T00:00:00.000Z",
      files: {},
      links,
    },
    manifestEntry: "manifest.json",
    manifestSha256: "a".repeat(64),
    records: new Map(),
  };
}

const describeIt = (integrity: TourIntegrity, storage: TrustStorage) =>
  describeTourTrust({ integrity, sources: [LINK], storage, nowMs: 1000 });

describe("describeTourTrust", () => {
  it("names the signer by fingerprint and remembers the source", async () => {
    const storage = memory();
    const lines = await describeIt(signed(A), storage);
    expect(lines[0]).toContain(`Signed by key ${await keyFingerprint(A)}`);
    expect(loadTrustRecords(storage).get(LINK)?.author).toBe(A);
  });

  it("warns, by both fingerprints, when the same link later serves another key", async () => {
    const storage = memory();
    await describeIt(signed(A), storage);
    const lines = await describeIt(signed(B), storage);
    expect(lines).toContainEqual(
      expect.stringContaining(
        `used to open a tour signed by key ${await keyFingerprint(A)}. This one is signed by key ${await keyFingerprint(B)}`,
      ),
    );
  });

  it("says a tour without a manifest is not signed", async () => {
    const lines = await describeIt({ kind: "none" }, memory());
    expect(lines).toEqual([
      "Not signed: there is no way to check who made this tour or whether it was changed.",
    ]);
  });

  it("neither learns nor judges a signature this browser could not check", async () => {
    const storage = memory();
    await describeIt(signed(A), storage);
    const lines = await describeIt(signed(B, "unsupported"), storage);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("NOT checked");
    expect(loadTrustRecords(storage).get(LINK)?.author).toBe(A);
  });

  it("shows the links between series, by key", async () => {
    const lines = await describeIt(
      signed(A, "valid", [{ seriesId: "Z9yX8wV7uT6sR5qP4oN3mL", author: B }]),
      memory(),
    );
    expect(lines.at(-1)).toBe(
      `Links to 1 other tour: Z9yX8wV7 (key ${await keyFingerprint(B)}).`,
    );
  });
});
