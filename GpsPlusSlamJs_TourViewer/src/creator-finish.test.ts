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
import { Matrix4, Quaternion, Vector3 } from "three";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import {
  readStoredCentralDirectory,
  readStoredEntryBytes,
} from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  createEmptyTourManifest,
  parseTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { MIN_ALIGNMENT_SAMPLES } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { wireCreatorSetup } from "./creator-setup.js";
import type { CreatorSetupDom } from "./creator-setup.js";
import {
  createTourViewerSession,
  createTourViewerStore,
} from "./tour-viewer-session.js";
import { objectPoseNue } from "./content-placement.js";

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
  bind: () => void;
  render: () => void;
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
    // The object list's view (authoring plan M4): a stand-in - its model
    // is tested in object-list.test.ts, its DOM by the Playwright suite.
    bind: () => undefined,
    render: () => undefined,
  };
}

const DOM_KEYS = [
  "panel",
  "controls",
  "finishBlock",
  "replaceHelp",
  "replaceHelpShare",
  "replaceHelpGeneric",
  "replaceHelpDrive",
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
  "sizeOffer",
  "sizeOfferText",
  "sizeOfferUse",
  "sizeOfferKeep",
  "objectList",
  "replaceCodeButton",
  "replaceCodeConfirm",
  "replaceCodeConfirmText",
  "replaceCodeYes",
  "replaceCodeNo",
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
async function hostedArchive(
  existing: readonly TourObject[],
  content: readonly { path: string; data: string }[] = [],
): Promise<Blob> {
  const manifest = { ...createEmptyTourManifest(), objects: [...existing] };
  return packFilesAsZip([
    { path: `${WRAP}tour.json`, data: serializeTourManifest(manifest) },
    { path: `${WRAP}qr/${LEVEL_ID}.json`, data: '{"old":true}' },
    ...content,
  ]);
}

/** The slice of an open session the finish handler actually reaches for. */
function fakeSession(blob: Blob, hostedName: string | null = null): unknown {
  return {
    archive: { url: "https://example.test/mytour.zip", size: blob.size },
    hostedFileName: () => hostedName,
    entries: [
      { filename: `${WRAP}tour.json` },
      { filename: `${WRAP}qr/${LEVEL_ID}.json` },
    ],
    manifestWrap: WRAP,
    readWholeArchive: () => Promise.resolve(blob),
    loadEntry: () => Promise.resolve(new Blob([])),
  };
}

function alignedArStore(alignment?: number[]): unknown {
  const state = {
    gpsData: {
      zero: { lat: 47.5, lon: 8.7 },
      gpsEvents: {
        // A three.js matrix object unless a test hands the store's real
        // shape (16 numbers): the settle reads only the latter, so the
        // tests about paths inside the zip see no settle at all.
        alignmentMatrix: alignment ?? new Matrix4(),
        gpsPositions: Array.from({ length: MIN_ALIGNMENT_SAMPLES }, () => ({
          lat: 47.5,
          lon: 8.7,
        })),
      },
    },
  };
  // `dispatch` records what the finish logs into the troubleshooting
  // recording (`tourAuthoring/finished`); nothing reads it back into state.
  const dispatched: unknown[] = [];
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    dispatch: (action: unknown) => dispatched.push(action),
    dispatched,
  };
}

/**
 * Wire a creator whose tour is OPEN, measured, and settled - the three
 * preconditions the finish refuses without - and whose session is the
 * wrapped archive above.
 */
async function wireFinishable(options: {
  hosted: readonly TourObject[];
  /** Content files the hosted zip carries (a photo's `content/<id>.jpg`). */
  hostedContent?: readonly { path: string; data: string }[];
  /** Ids deleted before the Finish (tombstones, M4). */
  deleted?: readonly string[];
  placed: readonly TourObject[];
  hostedName?: string | null;
  /** Runs while the finish awaits the AR session's end. */
  onDisable?: (ctx: ReturnType<typeof createTourViewerSession>) => void;
  /** The store's alignment as 16 numbers (enables the settle). */
  alignment?: number[];
  /** Objects placed in the RUNNING visit (0), at these odometry spots. */
  placedInVisit?: readonly {
    object: TourObject;
    local: [number, number, number];
  }[];
}) {
  const blob = await hostedArchive(options.hosted, options.hostedContent);
  const dom = fakeDom();
  const ctx = createTourViewerSession();
  ctx.session = fakeSession(blob, options.hostedName ?? null) as never;
  ctx.mintedLevel = { id: LEVEL_ID, json: '{"measured":true}' };
  ctx.tourManifestStatus = "settled";
  ctx.tourManifest = {
    ...createEmptyTourManifest(),
    objects: [...options.hosted],
  };
  ctx.deletedObjectIds = [...(options.deleted ?? [])];
  ctx.placedObjects = [
    ...options.placed.map((object) => ({ object })),
    ...(options.placedInVisit ?? []).map(({ object, local }) => ({
      object,
      placement: {
        visit: 0,
        local: { position: local, rotation: [0, 0, 0, 1] as const },
      },
    })),
  ];
  const arStore = alignedArStore(options.alignment) as {
    dispatched: unknown[];
  };
  const setup = wireCreatorSetup({
    ctx,
    mode: "creator",
    arStore: arStore as never,
    arController: {
      getState: () => ({ status: "running" }),
      disable: () => {
        options.onDisable?.(ctx);
        return Promise.resolve();
      },
    } as never,
    seams: { canShareZip: () => false, getScene: () => null } as never,
    wizard: { openStep: () => undefined, revealStep: () => undefined } as never,
    dom: dom as unknown as CreatorSetupDom,
    openDraftStore: () => Promise.resolve(undefined),
  });
  return { dom, ctx, setup, dispatched: arStore.dispatched };
}

/**
 * Wait for the finish's unawaited async body to reach an END STATE.
 *
 * A fixed count of turns would be a timing wait: this one has to outlast
 * a real zip rebuild - blob reads plus assembly - so "200 turns is
 * enough" is an assumption about machine speed, and its failure mode is
 * a false red on a loaded box that reports `no zip` rather than
 * `too slow` (PR #465 review). Polling the end state keeps an upper
 * bound while returning the moment the finish lands.
 */
async function settle(ctx: {
  rebuiltZip: unknown;
  finishError: unknown;
}): Promise<void> {
  for (let i = 0; i < 600; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (ctx.rebuiltZip !== null || ctx.finishError !== null) return;
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
    await settle(ctx);

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
    await settle(ctx);

    expect(
      ctx.finishError,
      "a duplicate id must not make the finish fail",
    ).toBeNull();
    const rebuilt = ctx.rebuiltZip?.blob;
    expect(rebuilt).toBeDefined();

    const names = await entryNamesOf(rebuilt!);
    expect(names).toContain(`${WRAP}tour.json`);

    // And the manifest the ARCHIVE CARRIES lists each id exactly once.
    // Read from the bytes, not from `ctx.tourManifest`: the in-memory
    // copy is the object the writer built, which this file's header
    // rejects as proof. A finish that de-duplicated its own state while
    // serializing a different list would pass the weaker assertion and
    // ship a zip full of duplicates (PR #465 review).
    const bytes = readStoredEntryBytes(
      new Uint8Array(await rebuilt!.arrayBuffer()),
      `${WRAP}tour.json`,
    );
    expect(bytes, "the archive must carry a manifest").toBeDefined();
    const written = parseTourManifest(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    const ids = written.objects.map((o) => o.id);
    expect(ids).toEqual(["already-there", "genuinely-new"]);
    expect(
      new Set(ids).size,
      "every id appears exactly once in the PUBLISHED manifest",
    ).toBe(ids.length);
  });
});

/** The manifest the rebuilt ARCHIVE carries, read from its bytes. */
async function publishedManifest(blob: Blob) {
  const bytes = readStoredEntryBytes(
    new Uint8Array(await blob.arrayBuffer()),
    `${WRAP}tour.json`,
  );
  expect(bytes, "the archive must carry a manifest").toBeDefined();
  return parseTourManifest(JSON.parse(new TextDecoder().decode(bytes)));
}

function photo(id: string): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-09-11T00:00:01.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

describe("edits and deletions reach the published zip (authoring plan 2026-09-28-0953 §3.4, M4)", () => {
  // Why these tests matter: the finish used to APPEND, skipping ids the
  // manifest already had - so an edit of a hosted pin was silently dropped
  // at Finish, a delete could not be written at all, and nothing could
  // take a deleted photo's jpg out of the archive.

  it("replaces an edited hosted object in place, keeping its position in the list", async () => {
    const edited: TourObject = { ...pin("b"), label: "the new text" };
    const { dom, ctx } = await wireFinishable({
      hosted: [pin("a"), pin("b"), pin("c")],
      placed: [edited],
    });
    dom.finishButton.click();
    await settle(ctx);
    expect(ctx.finishError).toBeNull();
    const written = await publishedManifest(ctx.rebuiltZip!.blob);
    expect(written.objects.map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(written.objects[1]).toEqual(edited);
    // The edit is in the zip, so it leaves the list of work to write.
    expect(ctx.placedObjects).toEqual([]);
  });

  it("drops a deleted object and takes a deleted photo's jpg out of the archive", async () => {
    const { dom, ctx } = await wireFinishable({
      hosted: [pin("a"), photo("gone"), photo("kept")],
      hostedContent: [
        { path: `${WRAP}content/gone.jpg`, data: "gone" },
        { path: `${WRAP}content/kept.jpg`, data: "kept" },
      ],
      placed: [],
      deleted: ["gone", "a"],
    });
    dom.finishButton.click();
    await settle(ctx);
    expect(ctx.finishError).toBeNull();
    const blob = ctx.rebuiltZip!.blob;
    const written = await publishedManifest(blob);
    expect(written.objects.map((o) => o.id)).toEqual(["kept"]);
    const names = await entryNamesOf(blob);
    expect(names).not.toContain(`${WRAP}content/gone.jpg`);
    expect(names).toContain(`${WRAP}content/kept.jpg`);
    // Applied: the next Finish has nothing left to delete.
    expect(ctx.deletedObjectIds).toEqual([]);
  });
});

describe("the rebuilt zip's name (Drive replace plan §2 decision 3)", () => {
  // Why this matters: Drive offers "Replace" only when the uploaded file has
  // the SAME name as the one in Drive, and a Drive link carries no name -
  // the host's content-disposition does. A wrong name uploads a silent
  // second file, and the printed code keeps pointing at the old one.
  it("takes the name the host sent", async () => {
    const { dom, ctx } = await wireFinishable({
      hosted: [],
      placed: [],
      hostedName: "Altstadt Tour.zip",
    });
    dom.finishButton.click();
    await settle(ctx);
    expect(ctx.rebuiltZip?.filename).toBe("Altstadt Tour.zip");
  });

  it("falls back to the name in the link without one", async () => {
    const { dom, ctx } = await wireFinishable({ hosted: [], placed: [] });
    dom.finishButton.click();
    await settle(ctx);
    expect(ctx.rebuiltZip?.filename).toBe("mytour.zip");
  });
});

describe("a tour closed while the finish ends the AR session", () => {
  it("does not reveal the closed tour's finish block", async () => {
    // Why this matters (DEC-A3, found by the Drive replace milestone review
    // #7): every other await in the finish re-checks that its tour is still
    // open, but the one that ends the AR session did not. A close in that
    // window hid the block (resetFinishStep) and the finish then showed it
    // again - the closed tour's disabled button, on the page of whatever
    // opens next.
    const { dom, ctx } = await wireFinishable({
      hosted: [],
      placed: [],
      onDisable: (c) => {
        c.session = null;
      },
    });
    dom.finishBlock.hidden = true;
    dom.finishButton.click();
    await settle(ctx);
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(dom.finishBlock.hidden).toBe(true);
  });
});

describe("the troubleshooting recording's log of the finish", () => {
  it("records the manifest the rebuilt zip carries", async () => {
    // Why this test matters (authoring recording plan 2026-09-28-0953,
    // M1a): the Finish is what a troubleshooting session is usually about
    // ("the note is not where I put it"), so the recording must hold what
    // the finish WROTE. (That the tour zip never carries the recording is
    // pinned end to end, with a recording running, in ar-mode.spec.js.)
    const { dom, ctx, dispatched } = await wireFinishable({
      hosted: [pin("already-there")],
      placed: [pin("new-one")],
    });

    dom.finishButton.click();
    await settle(ctx);

    const finished = dispatched.filter(
      (a) => (a as { type: string }).type === "tourAuthoring/finished",
    ) as {
      payload: { levelId: string; manifest: { objects: TourObject[] } };
    }[];
    expect(finished).toHaveLength(1);
    expect(finished[0]!.payload.levelId).toBe(LEVEL_ID);
    expect(finished[0]!.payload.manifest.objects.map((o) => o.id)).toEqual([
      "already-there",
      "new-one",
    ]);
  });
});

describe("the finish settles the AR visit still running (authoring plan 2026-09-28-0953 §3.2, M2c)", () => {
  // Why these tests matter: a Finish tapped inside AR writes the zip
  // BEFORE the session ends, so the session-end settle comes too late for
  // the zip. The visit is settled at the tap instead - and then must not be
  // settled again a moment later, or the draft's level would differ from
  // the one just written and the draft would be offered again after upload.
  // The geodesy is licence-gated; building a store activates it, as the
  // page does at boot.
  createTourViewerStore();
  const END = new Matrix4()
    .compose(
      new Vector3(4, 400, -3),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 6),
      new Vector3(1, 1, 1),
    )
    .toArray();

  it("writes the objects placed in the running visit with their settled geo", async () => {
    const { dom, ctx, dispatched } = await wireFinishable({
      hosted: [],
      placed: [],
      alignment: END,
      placedInVisit: [{ object: pin("in-visit"), local: [2, 0, -1] }],
    });

    dom.finishButton.click();
    await settle(ctx);

    const types = dispatched.map((a) => (a as { type: string }).type);
    expect(types.indexOf("tourAuthoring/settled")).toBeLessThan(
      types.indexOf("tourAuthoring/finished"),
    );
    const finished = dispatched.find(
      (a) => (a as { type: string }).type === "tourAuthoring/finished",
    ) as { payload: { manifest: { objects: TourObject[] } } };
    const written = finished.payload.manifest.objects[0]!;
    const expected = new Vector3(2, 0, -1).applyMatrix4(
      new Matrix4().fromArray(END),
    );
    const at = objectPoseNue(written.geo, { lat: 47.5, lon: 8.7 }).positionNue;
    expect(new Vector3(...at).distanceTo(expected)).toBeLessThan(1e-3);
  });

  it("does not settle the same visit again when its session then ends", async () => {
    const { dom, ctx, setup, dispatched } = await wireFinishable({
      hosted: [],
      placed: [],
      alignment: END,
      placedInVisit: [{ object: pin("in-visit"), local: [2, 0, -1] }],
    });
    // The code was measured in this visit, so a second settle would
    // re-mint it - which is exactly what must not happen after the zip.
    ctx.codeMeasurement = {
      levelId: LEVEL_ID,
      text: "https://example.test/code",
      odomPose: { position: [0, 1.5, -1], rotation: [0, 0, 0, 1] },
      sizeM: 0.16,
      visit: 0,
    };

    dom.finishButton.click();
    await settle(ctx);
    const level = ctx.mintedLevel;
    setup.endAuthorVisit();

    const settles = dispatched.filter(
      (a) => (a as { type: string }).type === "tourAuthoring/settled",
    );
    expect(settles).toHaveLength(1);
    expect(ctx.mintedLevel).toBe(level);
  });
});
