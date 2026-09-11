/**
 * Why these tests matter: this is the one path that writes the file the
 * WORLD downloads. A draft defect costs a creator their walk; a defect
 * here ships a broken tour to every visitor, and the creator has already
 * uploaded it by the time anyone finds out.
 *
 * A mutation sweep over the finish path on 2026-09-11 neutered fourteen
 * sites one at a time, against the unit suite and then against the browser
 * suite. **Nine survived both.** The browser tests cover the headline
 * contracts - a second finish rebuilds from the last rebuild, a placed
 * photo's bytes reach the zip, the manifest advances - and nothing at all
 * covered the three guards below, each of which decides the PATHS inside
 * the archive rather than the flow around it.
 *
 * All three were written in response to a real defect, and all three could
 * be deleted today with both suites still green:
 *
 * - the manifest path is reused from the session rather than derived again
 *   (the writer and the reader drifted apart exactly once, PR #435)
 * - a wrapped zip's existing level file is overwritten in place rather
 *   than a second copy added at the root
 * - objects are appended WITHOUT duplicate ids, because the serializer
 *   rejects duplicates and one restored object already in the manifest
 *   made every finish throw with no escape inside the app (M5 review #4)
 *
 * These assert the rebuilt archive's actual central directory rather than
 * the arguments handed to the rebuilder - the same discipline as the
 * framework's own packer tests, and the reason is the same: what a visitor
 * gets is the file, not the call.
 */
import { describe, expect, it } from "vitest";
import { Matrix4 } from "three";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import { readStoredCentralDirectory } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { MIN_ALIGNMENT_SAMPLES } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { wireCreatorSetup } from "./creator-setup.js";
import type { CreatorSetupDom } from "./creator-setup.js";
import { createTourViewerSession } from "./tour-viewer-session.js";

/** The element surface `creator-setup` writes to, and nothing else. */
interface FakeEl {
  hidden: boolean;
  textContent: string;
  disabled: boolean;
  value: string;
  open: boolean;
  handlers: Map<string, () => void>;
  addEventListener: (type: string, handler: () => void) => void;
  click: () => void;
}

function el(): FakeEl {
  const handlers = new Map<string, () => void>();
  return {
    hidden: false,
    textContent: "",
    disabled: false,
    value: "",
    open: false,
    handlers,
    addEventListener: (type, handler) => handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
  };
}

const DOM_KEYS = [
  "panel",
  "controls",
  "finishBlock",
  "replaceHelp",
  "replaceHelpShare",
  "sizeInput",
  "printPanel",
  "status",
  "mintButton",
  "finishButton",
  "finishStatus",
  "downloadButton",
  "pinButton",
  "pinLabel",
  "pinSave",
  "pinCancel",
  "photoButton",
  "draftOffer",
  "draftOfferText",
  "draftRestore",
  "draftDismiss",
  "draftDiscard",
] as const;

function fakeDom(): Record<(typeof DOM_KEYS)[number], FakeEl> {
  const out = {} as Record<(typeof DOM_KEYS)[number], FakeEl>;
  for (const key of DOM_KEYS) out[key] = el();
  return out;
}

function pin(id: string): TourObject {
  return {
    id,
    kind: "pin",
    label: `pin ${id}`,
    createdAtIso: "2026-09-11T00:00:01.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
  };
}

const LEVEL_ID = "abc123";
/** The WRAPPED shape - every entry under one top folder, which is what a
 *  zip made by "compress this folder" looks like and what the tolerated
 *  layout is. The root-relative shape is the easy case; this is the one
 *  the path guards exist for. */
const WRAP = "mytour/";

/**
 * A hosted archive in the wrapped shape, carrying one object already and a
 * level file for `LEVEL_ID`.
 */
async function hostedArchive(existing: readonly TourObject[]): Promise<Blob> {
  const manifest = { ...createEmptyTourManifest(), objects: [...existing] };
  return packFilesAsZip([
    { path: `${WRAP}tour.json`, data: serializeTourManifest(manifest) },
    { path: `${WRAP}qr/${LEVEL_ID}.json`, data: '{"old":true}' },
  ]);
}

/** The slice of an open session the finish handler actually reaches for. */
function fakeSession(blob: Blob): unknown {
  return {
    archive: { url: "https://example.test/mytour.zip", size: blob.size },
    entries: [
      { filename: `${WRAP}tour.json` },
      { filename: `${WRAP}qr/${LEVEL_ID}.json` },
    ],
    manifestWrap: WRAP,
    readWholeArchive: () => Promise.resolve(blob),
    loadEntry: () => Promise.resolve(new Blob([])),
  };
}

function alignedArStore(): unknown {
  const state = {
    gpsData: {
      zero: { lat: 47.5, lon: 8.7 },
      gpsEvents: {
        alignmentMatrix: new Matrix4(),
        gpsPositions: Array.from({ length: MIN_ALIGNMENT_SAMPLES }, () => ({
          lat: 47.5,
          lon: 8.7,
        })),
      },
    },
  };
  return { getState: () => state, subscribe: () => () => undefined };
}

/**
 * Wire a creator whose tour is OPEN, measured, and settled - the three
 * preconditions the finish refuses without - and whose session is the
 * wrapped archive above.
 */
async function wireFinishable(options: {
  hosted: readonly TourObject[];
  placed: readonly TourObject[];
}) {
  const blob = await hostedArchive(options.hosted);
  const dom = fakeDom();
  const ctx = createTourViewerSession();
  ctx.session = fakeSession(blob) as never;
  ctx.mintedLevel = { id: LEVEL_ID, json: '{"measured":true}' };
  ctx.tourManifestStatus = "settled";
  ctx.tourManifest = {
    ...createEmptyTourManifest(),
    objects: [...options.hosted],
  };
  ctx.placedObjects = options.placed.map((object) => ({ object }));
  wireCreatorSetup({
    ctx,
    mode: "creator",
    arStore: alignedArStore() as never,
    arController: {
      getState: () => ({ status: "running" }),
      disable: () => undefined,
    } as never,
    seams: { canShareZip: () => false, getScene: () => null } as never,
    wizard: { openStep: () => undefined, revealStep: () => undefined } as never,
    dom: dom as unknown as CreatorSetupDom,
    openDraftStore: () => Promise.resolve(undefined),
  });
  return { dom, ctx };
}

/** Wait for the finish's unawaited async body to settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** The entry names of a rebuilt archive, read from its central directory. */
async function entryNamesOf(blob: Blob): Promise<string[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return readStoredCentralDirectory(bytes).map((e) => e.name);
}

describe("what the finish actually writes into the published zip", () => {
  it("keeps the manifest and the level INSIDE the wrap, adding no root copies", async () => {
    // Why this test matters: the reader derives the wrap when it opens the
    // archive, and the writer reuses that value. Deriving it a second time
    // here is how the two drifted apart once already (PR #435) - and the
    // result is a tour.json at the root of a wrapped zip, which the reader
    // never looks at. The published tour then has no objects at all, and
    // nothing fails visibly to say so.
    const { dom, ctx } = await wireFinishable({
      hosted: [pin("already-there")],
      placed: [pin("new-one")],
    });

    dom.finishButton.click();
    await settle();

    const rebuilt = ctx.rebuiltZip?.blob;
    expect(rebuilt, "the finish should have produced a zip").toBeDefined();
    const names = await entryNamesOf(rebuilt!);

    expect(names, "the manifest stays where the reader looks for it").toContain(
      `${WRAP}tour.json`,
    );
    expect(names, "and no second copy appears at the root").not.toContain(
      "tour.json",
    );
    expect(
      names,
      "the measured level overwrites the one already in the wrap",
    ).toContain(`${WRAP}qr/${LEVEL_ID}.json`);
    expect(
      names.filter((n) => n.endsWith(`${LEVEL_ID}.json`)),
      "exactly one level file for this id - a second would go stale on every finish",
    ).toHaveLength(1);
  });

  it("appends without duplicating an id the manifest already carries", async () => {
    // Why this test matters: the serializer REJECTS duplicate ids, so a
    // restored draft object that the hosted manifest already carries makes
    // every finish throw - for as long as the draft stays restored, with
    // no way out from inside the app (M5 review #4). The de-duplication is
    // what prevents that, and until this test nothing covered it in either
    // suite.
    const duplicated = pin("already-there");
    const { dom, ctx } = await wireFinishable({
      hosted: [duplicated],
      placed: [duplicated, pin("genuinely-new")],
    });

    dom.finishButton.click();
    await settle();

    expect(
      ctx.finishError,
      "a duplicate id must not make the finish fail",
    ).toBeNull();
    const rebuilt = ctx.rebuiltZip?.blob;
    expect(rebuilt).toBeDefined();

    const names = await entryNamesOf(rebuilt!);
    expect(names).toContain(`${WRAP}tour.json`);

    // And the manifest inside it carries each id exactly once.
    const ids = ctx.tourManifest?.objects.map((o) => o.id) ?? [];
    expect(ids).toEqual(["already-there", "genuinely-new"]);
    expect(
      new Set(ids).size,
      "every id appears exactly once in the written manifest",
    ).toBe(ids.length);
  });
});
