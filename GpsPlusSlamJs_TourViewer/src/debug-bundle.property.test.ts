import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  bundleMatchesTour,
  debugBundlePlan,
  readDebugBundle,
  type DebugBundleRead,
  type DebugBundleTour,
} from "./debug-bundle.js";

/**
 * Why these properties matter: the example tests pin the archives someone
 * thought of; these pin the bundle's two contracts over any archive and any
 * identity. The selection: every recording entry is kept at its path (its
 * wrap included) and nothing else is, so no part of the walk is lost and
 * no tour content leaks into "debug data". The round trip: what the writer
 * writes, the reader reads back as the same identity, and the tour it was
 * written from matches it - otherwise the editor would call a creator's
 * own debug data "another tour's". And the reader never throws on any
 * text, because the file is untrusted.
 */

const WHEN = new Date("2026-10-20T12:34:56.789Z");
const IDENTITY = "debug-bundle.json";
const NOTE = "about-this-debug-data.txt";

/** A name a recording writes, under `wrap`; `action` marks the stream. */
const recordingName = (wrap: string) =>
  fc.oneof(
    fc.constant({ name: `${wrap}session.json`, action: false }),
    fc.nat(999_999).map((n) => ({
      name: `${wrap}actions/${String(n).padStart(6, "0")}.json`,
      action: true,
    })),
    fc
      .tuple(
        fc.constantFrom("images", "frames"),
        fc.nat(999_999),
        fc.constantFrom("jpg", "png", "webp"),
      )
      .map(([dir, n, ext]) => ({
        name: `${wrap}${dir}/frame-${String(n).padStart(6, "0")}.${ext}`,
        action: false,
      })),
    fc
      .tuple(fc.constantFrom("sparse/0", "sparse", "refPoints"), fc.nat(9999))
      .map(([dir, n]) => ({ name: `${wrap}${dir}/f${n}.txt`, action: false })),
  );

/** A name a recording never writes: tour content and the files beside it,
 *  under the wrap or at the root. */
const otherName = (wrap: string) =>
  fc
    .tuple(
      fc.constantFrom(wrap, ""),
      fc.constantFrom(
        "tour.json",
        "manifest.json",
        "README.txt",
        "content/c",
        "images/cover",
        "qr/q",
        "docs/session",
      ),
      fc.nat(9999),
    )
    .map(([at, base, n]) => ({
      name: base.includes(".")
        ? `${at}${base}`
        : `${at}${base}${n}.${base.startsWith("qr") ? "json" : "jpg"}`,
    }));

const archive = fc.constantFrom("", "mytour/", "deep/er/").chain((wrap) =>
  fc
    .uniqueArray(
      fc.oneof(
        recordingName(wrap).map((r) => ({ ...r, recording: true })),
        otherName(wrap).map((o) => ({ ...o, recording: false, action: false })),
      ),
      { selector: (e) => e.name, maxLength: 40 },
    )
    .map((entries) => ({ wrap, entries })),
);

/** Text as tours carry it: plain, any code point, graphemes, sometimes
 *  past the format's 512-character cap, sometimes only whitespace. */
const text = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.string({ unit: "binary", maxLength: 40 }),
  fc.string({ unit: "grapheme", minLength: 500, maxLength: 700 }),
  fc.constantFrom("   ", "　x　", ""),
);

const tour: fc.Arbitrary<DebugBundleTour> = fc.record({
  seriesId: fc.option(fc.stringMatching(/^[A-Za-z0-9_-]{1,128}$/)),
  title: fc.oneof(fc.constant(undefined), fc.constant(null), text),
  fileName: fc.oneof(fc.constant(undefined), fc.constant(null), text),
});

const writtenAt = fc.date({
  min: new Date("0000-01-01T00:00:00.000Z"),
  max: new Date("9999-12-31T23:59:59.999Z"),
  noInvalidDate: true,
});

function readBack(json: string): Promise<DebugBundleRead> {
  return readDebugBundle(["actions/000001.json", IDENTITY], (name) =>
    name === IDENTITY
      ? Promise.resolve(new Blob([json]))
      : Promise.reject(new Error(name)),
  );
}

describe("debug bundle (properties)", () => {
  it("keeps every recording entry at its path and only those, or nothing without an action stream", () => {
    fc.assert(
      fc.property(archive, ({ entries }) => {
        const names = entries.map((e) => e.name);
        const plan = debugBundlePlan(
          names,
          { seriesId: null, title: "t", fileName: "t.zip" },
          WHEN,
        );
        // No action stream, no plan; with one, always a plan.
        expect(plan === null).toBe(!entries.some((e) => e.action));
        if (plan === null) return;
        // Every recording entry, in archive order, at its own path - the
        // wrap kept, never stripped or doubled.
        expect(plan.keep).toEqual(
          entries.filter((e) => e.recording).map((e) => e.name),
        );
        // Everything else is removed: the two lists split the archive.
        expect(plan.remove).toEqual(
          entries.filter((e) => !e.recording).map((e) => e.name),
        );
        // The identity and the note at the root, beside the kept entries.
        expect(plan.added.map((e) => e.path)).toEqual([IDENTITY, NOTE]);
      }),
    );
  });

  it("reads back the identity it wrote, and the tour it was written from matches it", async () => {
    await fc.assert(
      fc.asyncProperty(tour, writtenAt, async (t, when) => {
        const plan = debugBundlePlan(["actions/000001.json"], t, when);
        if (plan === null) throw new Error("a recording gave no plan");
        const json = plan.added.find((e) => e.path === IDENTITY)?.data;
        if (typeof json !== "string") throw new Error("no identity written");
        const read = await readBack(json);
        expect(read).toEqual({ kind: "bundle", identity: plan.identity });
        expect(plan.identity.writtenAt).toBe(when.toISOString());
        // With any evidence to go on, the bundle is this tour's; with none
        // (no series, no title, no file name), nothing can say so.
        const evidence =
          plan.identity.seriesId !== null ||
          plan.identity.tour !== null ||
          plan.identity.file !== null;
        if (read.kind === "refused") throw new Error(read.reason);
        expect(bundleMatchesTour(read, t)).toBe(
          evidence ? "this-tour" : "other-tour",
        );
      }),
    );
  });

  it("never throws on any identity text, and refuses what is not a bundle's", async () => {
    const field = fc.oneof(fc.anything(), fc.string(), fc.constant(null));
    const anyJson = fc.oneof(
      fc.string(),
      fc.jsonValue().map((v) => JSON.stringify(v)),
      fc
        .record(
          {
            format: fc.oneof(fc.constant(1), field),
            seriesId: field,
            tour: field,
            file: field,
            writtenAt: field,
          },
          { requiredKeys: [] },
        )
        .map((v) => JSON.stringify(v)),
    );
    await fc.assert(
      fc.asyncProperty(anyJson, async (json) => {
        const read = await readBack(json);
        expect(["bundle", "refused"]).toContain(read.kind);
        // Only a format-1 identity reads as a bundle.
        const format =
          read.kind === "bundle"
            ? (JSON.parse(json) as { format?: unknown }).format
            : 1;
        expect(format).toBe(1);
      }),
    );
  });
});
