/**
 * Why this test matters: a narrated long text crosses five modules on
 * its way from the zip to the visitor and back into a Finish - the
 * session's capped, hashed entry reads (`TourSession.loadEntryText`, with
 * `manifestWrap` joined by the narration visitor), the integrity guard of
 * a listed tour, the stations' prefetch cache the voice is read through,
 * the read-along judge, and the Finish's asset rule. Each had unit tests
 * of its own while a Finish of any narrated tour failed: the asset rule
 * did not count the voice, so the write dropped it and the re-parse
 * refused the manifest. This runs the real modules - the session, the
 * guard, the prefetch, the narration visitor and the Finish - on a real
 * zip, composed by this test (not by `main.ts`, whose wiring it does not
 * load), so a seam that only each module's own fakes agree with cannot
 * pass.
 */
import { describe, expect, it } from "vitest";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourLongTextBlock,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  parseTourMarkdown,
  plainTextOf,
  textHashOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import {
  readStoredCentralDirectory,
  readStoredEntryBytes,
} from "gps-plus-slam-app-framework/test-utils/zip-central-directory";

import { rebuildFinishedTour } from "./finish-rebuild.js";
import type { NarrationPlayer } from "./narration-player.js";
import { createNarrationVisitor } from "./narration-visitor.js";
import { createStationPrefetch } from "./station-prefetch.js";
import { tourOf } from "./test-support/tour-of.js";
import { buildListedTourFixture } from "./test-support/tour-signing-fixture.js";
import { openTourFile, type TourSession } from "./tour-session.js";

const WRAP = "mytour/";
const BODY =
  "The wheel turned for a century.\n\n![The wheel](asset:wheel)\n\nIt stopped in 1950.";
const VOICE_BYTES = "ID3-the-voice";

/** A word track over the body's plain text, as a creator tool writes it
 *  (compact JSON). */
async function timingOf(body: string): Promise<string> {
  const p = plainTextOf(parseTourMarkdown(body)).text;
  const segments = [...p.matchAll(/\S+/gu)].map((m, i) => ({
    startMs: i * 400,
    endMs: i * 400 + 350,
    from: m.index,
    to: m.index + m[0].length,
  }));
  return JSON.stringify({
    granularity: "word",
    source: "file",
    textHash: await textHashOf(p),
    segments,
  });
}

const ESSAY: TourObject = {
  id: "essay",
  kind: "longText",
  view: "reading",
  title: "The mill",
  body: BODY,
  narration: {
    audio: "voice",
    timing: "timing/essay.json",
    synthetic: true,
    voiceCredit: "Read by the archive",
  },
  createdAtIso: "2026-10-31T00:00:01.000Z",
  geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
};

const MANIFEST: TourManifest = tourOf([ESSAY], {
  assets: [
    { id: "voice", path: "content/voice.mp3", kind: "audio" },
    { id: "wheel", path: "content/wheel.png", kind: "image" },
  ],
});

async function open(zip: Blob): Promise<TourSession> {
  return openTourFile(
    new File([zip], "mytour.zip", { type: "application/zip" }),
  );
}

/** The tour's manifest as the session reads it from the zip. */
async function manifestOf(session: TourSession): Promise<TourManifest> {
  return parseTourManifest(
    JSON.parse(
      await session.loadEntryText(`${session.manifestWrap}tour.json`),
    ) as unknown,
  );
}

function essayIn(manifest: TourManifest): TourLongTextBlock {
  const block = manifest.stations
    .flatMap((s) => s.blocks)
    .find((b) => b.id === "essay");
  if (block?.kind !== "longText") throw new Error("no essay in the tour");
  return block;
}

/** A player that only records what it was given to load. */
function recordingPlayer(loads: Promise<Blob>[]) {
  return (deps: { load(): Promise<Blob> }): NarrationPlayer => {
    loads.push(deps.load());
    return {
      nowMs: () => 0,
      durationMs: () => 0,
      playing: () => false,
      play: () => undefined,
      pause: () => undefined,
      seek: () => undefined,
      onChange: () => () => undefined,
      dispose: () => undefined,
    };
  };
}

describe("a narrated tour, from its zip to a Finish", () => {
  it("reads its timing and voice through the session, then a Finish keeps every file and writes a tour that opens", async () => {
    const timingText = await timingOf(BODY);
    const fixture = await buildListedTourFixture(
      {
        "tour.json": serializeTourManifest(MANIFEST),
        "timing/essay.json": timingText,
        "content/voice.mp3": VOICE_BYTES,
        "content/wheel.png": "PNG-the-wheel",
      },
      { wrap: WRAP },
    );
    const session = await open(fixture.zip);
    expect(session.integrity.kind).toBe("listed");
    expect(session.manifestWrap).toBe(WRAP);
    const manifest = await manifestOf(session);
    const essay = essayIn(manifest);
    expect(essay.narration?.timing).toBe("timing/essay.json");

    // The page's wiring (main.ts): the voice through the stations'
    // prefetch cache, the timing through the session's capped read.
    const prefetch = createStationPrefetch({
      assets: () => new Map(manifest.assets.map((a) => [a.id, a])),
      tour: () => manifest,
      read: (path) => session.loadContentEntry(path),
    });
    const loads: Promise<Blob>[] = [];
    const errors: string[] = [];
    const narration = createNarrationVisitor({
      tour: () => session,
      assets: () => manifest.assets,
      loadAsset: (path) => prefetch.load(path),
      onError: (message) => {
        errors.push(message);
      },
      makePlayer: recordingPlayer(loads),
      warn: (message) => {
        errors.push(message);
      },
    });
    expect(narration.verdictOf(essay), "nothing read at open").toBe("unread");
    const sheet = narration.sheetNarration(essay);
    expect(sheet?.synthetic).toBe(true);
    const timing = await sheet?.timing;
    expect(timing?.segments.length).toBeGreaterThan(0);
    expect(narration.verdictOf(essay)).toBe("live");
    expect(loads).toHaveLength(1);
    expect(await (await loads[0])?.text()).toBe(VOICE_BYTES);
    expect(narration.captions(essay)?.plain).toBe(
      plainTextOf(parseTourMarkdown(BODY)).text,
    );
    // Every read was listed and hashed: the guard saw nothing wrong.
    expect(session.integrityFailure()).toBeNull();
    expect(errors).toEqual([]);

    // A Finish of the tour as it is: the voice, its timing and the body's
    // picture stay, in the manifest and in the zip's bytes.
    const result = await rebuildFinishedTour({
      tour: session,
      manifest,
      placed: [],
      deleted: [],
      levels: [],
      keepScan: false,
      previous: null,
    });
    if (result === null) throw new Error("the Finish stopped");
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const names = readStoredCentralDirectory(bytes).map((e) => e.name);
    for (const name of [
      "timing/essay.json",
      "content/voice.mp3",
      "content/wheel.png",
    ]) {
      expect(names, name).toContain(`${WRAP}${name}`);
    }
    const timingBytes = readStoredEntryBytes(bytes, `${WRAP}timing/essay.json`);
    expect(new TextDecoder().decode(timingBytes)).toBe(timingText);

    // The finished file opens again, its narration whole.
    const reopened = await open(result.blob);
    const written = essayIn(await manifestOf(reopened));
    expect(written.narration).toEqual(essay.narration);
    expect((await manifestOf(reopened)).assets.map((a) => a.id).sort()).toEqual(
      ["voice", "wheel"],
    );
  });
});
