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
import { Group, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { existsSync, readFileSync } from "node:fs";
import {
  DecompressionBudget,
  loadActionsFromZip,
  packFilesAsZip,
} from "gps-plus-slam-app-framework/storage";
import {
  readStoredCentralDirectory,
  readStoredEntryBytes,
} from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  createEmptyTourManifest,
  parseTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { MIN_ALIGNMENT_SAMPLES } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { wireCreatorSetup } from "./creator-setup.js";
import type { CreatorSetupDom } from "./creator-setup.js";
import {
  createTourViewerSession,
  createTourViewerStore,
} from "./tour-viewer-session.js";
import { objectPoseNue } from "./content-placement.js";
import {
  buildListedTourFixture,
  buildSignedTourFixture,
  generateFixtureKey,
} from "./test-support/tour-signing-fixture.js";
import { openTourFile, type TourSession } from "./tour-session.js";
import { describeTourTrust } from "./tour-trust-view.js";
import { linkTrustKey, type TrustStorage } from "./tour-trust.js";

/** The element surface `creator-setup` writes to, and nothing else. */
interface FakeEl {
  hidden: boolean;
  textContent: string;
  disabled: boolean;
  value: string;
  checked: boolean;
  open: boolean;
  /** The status line's AR clamp flag (`data-clamped`). */
  dataset: Record<string, string>;
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
    checked: false,
    open: false,
    dataset: {},
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
  "movePrompt",
  "movePromptText",
  "movePromptUse",
  "movePromptCopy",
  "movePromptLater",
  "moveUndo",
  "moveUndoText",
  "moveUndoButton",
  "keepScanRow",
  "keepScanInput",
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
function fakeSession(
  blob: Blob,
  hostedName: string | null = null,
  budget?: DecompressionBudget,
  /** Further entries the hosted zip carries (its `hostedContent`). */
  extraNames: readonly string[] = [],
): unknown {
  return {
    budget,
    archive: { url: "https://example.test/mytour.zip", size: blob.size },
    hostedFileName: () => hostedName,
    entries: [
      { filename: `${WRAP}tour.json` },
      { filename: `${WRAP}qr/${LEVEL_ID}.json` },
      ...extraNames.map((filename) => ({ filename })),
    ],
    manifestWrap: WRAP,
    integrity: { kind: "none" },
    readWholeArchive: () => Promise.resolve(blob),
    loadEntry: () => Promise.resolve(new Blob([])),
    loadEntryText: () => Promise.resolve(""),
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
  /** The open session's decompression budget (K0 milestone review R1). */
  budget?: DecompressionBudget;
  /** Objects placed in the RUNNING visit (0), at these odometry spots. */
  placedInVisit?: readonly {
    object: TourObject;
    local: [number, number, number];
  }[];
  /** A REAL open session in place of the fake one (its archive must carry
   *  `options.hosted` in `${WRAP}tour.json` and the level file). */
  session?: TourSession;
  /** Merged over the seams (the save hand-off, UI round 1, U2). */
  seamsExtras?: Record<string, unknown>;
  /** The AR controller's status (default "running"). */
  arStatus?: string;
  /** Merged over the fake session (a recording's readers, scan-pass S1). */
  sessionExtras?: Record<string, unknown>;
  /** Merged over the in-memory manifest the Finish starts from. */
  manifestExtras?: Partial<TourManifest>;
  /** No code in hand (a desk edit, code book plan M4d). */
  noCodeInHand?: boolean;
}) {
  const blob = await hostedArchive(options.hosted, options.hostedContent);
  const dom = fakeDom();
  // Mutable, so a test can end the session the way the back gesture does.
  const arStatus = { value: options.arStatus ?? "running" };
  const ctx = createTourViewerSession();
  ctx.session = (options.session ?? {
    ...(fakeSession(
      blob,
      options.hostedName ?? null,
      options.budget,
      (options.hostedContent ?? []).map((c) => c.path),
    ) as object),
    ...options.sessionExtras,
  }) as never;
  if (options.noCodeInHand !== true) {
    ctx.mintedLevel = { id: LEVEL_ID, json: '{"measured":true}' };
  }
  ctx.tourManifestStatus = "settled";
  ctx.tourManifest = {
    ...createEmptyTourManifest(),
    objects: [...options.hosted],
    ...options.manifestExtras,
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
      getState: () => ({ status: arStatus.value }),
      disable: () => {
        options.onDisable?.(ctx);
        return Promise.resolve();
      },
    } as never,
    seams: {
      canShareZip: () => false,
      getScene: () => null,
      ...options.seamsExtras,
    } as never,
    wizard: { openStep: () => undefined, revealStep: () => undefined } as never,
    dom: dom as unknown as CreatorSetupDom,
    openDraftStore: () => Promise.resolve(undefined),
  });
  return { dom, ctx, setup, dispatched: arStore.dispatched, arStatus };
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

describe("the finish rebuilds the open archive under its session's budget (K0 milestone review R1)", () => {
  it("fails the finish with the cap's sentence when the hosted zip passes the session's budget", async () => {
    // A tour from any link can carry a deflate bomb; the Finish used to
    // inflate every carried entry with no limit. A budget too small for
    // the archive stands in for one, so the test needs no bomb.
    const { dom, ctx } = await wireFinishable({
      hosted: [pin("already-there")],
      placed: [pin("new-one")],
      // A carried entry: the finish replaces tour.json and the level, so
      // only a file it keeps is inflated from the hosted zip.
      hostedContent: [{ path: `${WRAP}content/kept.jpg`, data: "0123456789" }],
      budget: new DecompressionBudget({ maxEntryBytes: 4, maxTotalBytes: 4 }),
    });

    dom.finishButton.click();
    await settle(ctx);

    expect(ctx.rebuiltZip).toBeNull();
    expect(ctx.finishError).toMatch(/too large once unpacked/);
  });
});

/** A hosted tour WITH a manifest (signed or not), opened as a real session
 *  from a file: the shape a Finish of a K1 tour starts from. */
async function listedHostedSession(signed: boolean, withLevel = true) {
  const files = {
    "tour.json": serializeTourManifest({
      ...createEmptyTourManifest(),
      objects: [pin("already-there")],
    }),
    ...(withLevel ? { [`qr/${LEVEL_ID}.json`]: '{"old":true}' } : {}),
    "content/kept.jpg": "0123456789",
  };
  const options = { wrap: WRAP, version: 3 };
  const fixture = signed
    ? await buildSignedTourFixture(files, await generateFixtureKey(), options)
    : await buildListedTourFixture(files, options);
  const session = await openTourFile(
    new File([fixture.zip], "mytour.zip", { type: "application/zip" }),
  );
  expect(session.integrity.kind).toBe("listed");
  return { fixture, session };
}

/** An in-memory `localStorage` stand-in for the trust records. */
function memoryStorage(): TrustStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

describe("the finish continues a listed tour's series, unsigned (K1 milestone review R7)", () => {
  // Why these tests matter: the Finish rewrites tour.json and the level
  // file, so the OLD list and any signature over it no longer match. It
  // used to drop manifest.json altogether - and with it the series id's
  // only home: the next version was a stranger to every phone that knew the
  // series, and a file-opened draft lost its key. Now the list continues:
  // the same series, the next version, the hashes of what the zip really
  // holds. Only the signature goes (K2 re-signs on export), so a phone that
  // knew the signed tour still warns that this copy is not signed.
  it.each([
    ["an unsigned", false],
    ["a signed", true],
  ])(
    "%s tour: the new zip opens as the next version of the same series, unsigned, every file listed",
    async (_label, signed) => {
      const { fixture, session } = await listedHostedSession(signed);
      const { dom, ctx } = await wireFinishable({
        hosted: [pin("already-there")],
        placed: [pin("new-one")],
        session,
      });
      dom.finishButton.click();
      await settle(ctx);
      expect(ctx.finishError).toBeNull();

      const blob = ctx.rebuiltZip!.blob;
      const names = await entryNamesOf(blob);
      expect(names).not.toContain(`${WRAP}manifest.sig.json`);
      const next = await openTourFile(
        new File([blob], "mytour.zip", { type: "application/zip" }),
      );
      expect(next.integrity).toMatchObject({
        kind: "listed",
        signature: null,
        manifest: {
          seriesId: fixture.manifest.seriesId,
          version: fixture.manifest.version + 1,
        },
      });
      // Every file the zip holds is listed with its real hash.
      await expect(next.wholeArchiveCheck).resolves.toBe("checked");
      // The draft stays attached: a file is keyed by its series.
      expect(next.archive.url).toBe(session.archive.url);
      await next.close();
      await session.close();
    },
  );

  it("a code new to a wrapped listed tour gets its level inside the tour's folder, where the list names it", async () => {
    const { session } = await listedHostedSession(false, false);
    const { dom, ctx } = await wireFinishable({
      hosted: [pin("already-there")],
      placed: [],
      session,
    });
    dom.finishButton.click();
    await settle(ctx);
    expect(ctx.finishError).toBeNull();
    const blob = ctx.rebuiltZip!.blob;
    expect(await entryNamesOf(blob)).toContain(`${WRAP}qr/${LEVEL_ID}.json`);
    const next = await openTourFile(
      new File([blob], "mytour.zip", { type: "application/zip" }),
    );
    expect(next.integrity.kind).toBe("listed");
    await next.close();
    await session.close();
  });

  it("a phone that knew the SIGNED tour at a link warns that the finished copy is not signed", async () => {
    const { session } = await listedHostedSession(true);
    const storage = memoryStorage();
    const link = linkTrustKey("https://host.example/mytour.zip");
    await describeTourTrust({
      integrity: session.integrity,
      sources: [link],
      storage,
      nowMs: 1,
    });
    const { dom, ctx } = await wireFinishable({
      hosted: [pin("already-there")],
      placed: [pin("new-one")],
      session,
    });
    dom.finishButton.click();
    await settle(ctx);
    const next = await openTourFile(
      new File([ctx.rebuiltZip!.blob], "mytour.zip", {
        type: "application/zip",
      }),
    );
    const lines = await describeTourTrust({
      integrity: next.integrity,
      sources: [link],
      storage,
      nowMs: 2,
    });
    expect(lines.join("\n")).toMatch(/This copy is not signed/);
    await next.close();
    await session.close();
  });

  it("a tour that uses nothing of version 2 is published as tour.json version 1, which older builds open (K1 milestone review R10)", async () => {
    const { dom, ctx } = await wireFinishable({
      hosted: [pin("already-there")],
      placed: [pin("new-one")],
    });
    dom.finishButton.click();
    await settle(ctx);
    const bytes = readStoredEntryBytes(
      new Uint8Array(await ctx.rebuiltZip!.blob.arrayBuffer()),
      `${WRAP}tour.json`,
    );
    expect(JSON.parse(new TextDecoder().decode(bytes))).toMatchObject({
      version: 1,
    });
  });
});

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

describe("a finished photo keeps its bytes for its preview (code book plan M2)", () => {
  // Why this test matters: the Finish takes a photo out of `placedObjects`,
  // while the HOSTED zip does not carry its bytes until the creator uploads
  // the rebuilt one. The Finish hands the bytes to the previews; without
  // that, the next visit's preview asks the hosted zip, finds nothing, and
  // the photo is gone from the scene. Node cannot decode a texture, but the
  // zip read happens before any decode, so it is what this test watches
  // (the sampled mutant "finished photo bytes dropped" was a known gap).
  it("renders the next visit's preview from the kept bytes, not the hosted zip", async () => {
    const zipReads: string[] = [];
    const scene = new Group();
    const { dom, ctx, setup } = await wireFinishable({
      hosted: [pin("a")],
      placed: [],
      seamsExtras: {
        getScene: () => scene,
        getArWorldGroup: () => null,
        createLabel: () => ({
          object: new Object3D(),
          dispose: () => undefined,
        }),
      },
      sessionExtras: {
        loadContentEntry: (name: string) => {
          zipReads.push(name);
          return Promise.resolve(new Blob([]));
        },
      },
    });
    ctx.placedObjects = [{ object: photo("new"), blob: new Blob(["jpg"]) }];
    dom.finishButton.click();
    await settle(ctx);
    expect(ctx.finishError).toBeNull();
    // Written, so it left the list of work to write.
    expect(ctx.placedObjects).toEqual([]);
    setup.beginAuthorVisit();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(zipReads).toEqual([]);
    // The positive control (M2 review #6): the preview WAS rendered, so the
    // empty list above is not a preview that was never attempted.
    expect(ctx.placedPreviews.has("new")).toBe(true);
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

  // Why this test matters (code book plan §3, M4 milestone review #6): a
  // Finish writes every changed code, but its log named only the code in
  // hand - which may not even be among the levels written. A replay of a
  // "the code is in the wrong place" report needs every level it wrote.
  it("lists every level the Finish wrote in its log", async () => {
    const { dom, ctx, setup, dispatched } = await wireFinishable({
      hosted: [],
      placed: [pin("new-one")],
    });
    // The page reads the book (the first code enters it), then a second
    // code is taken: the hand holds it.
    setup.renderAuthorReadout();
    ctx.mintedLevel = { id: "secondcode01", json: '{"measured":2}' };

    dom.finishButton.click();
    await settle(ctx);

    const finished = dispatched.filter(
      (a) => (a as { type: string }).type === "tourAuthoring/finished",
    ) as { payload: { levelId: string; levelIds: string[] } }[];
    expect(finished).toHaveLength(1);
    expect(finished[0]!.payload.levelId).toBe("secondcode01");
    expect(finished[0]!.payload.levelIds).toEqual([LEVEL_ID, "secondcode01"]);
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

describe("the finish bakes the recorded photos' spots (scan-pass plan S1, S-D11)", () => {
  // Why these tests matter: the baked spots are what every visitor places
  // instead of replaying the walk, and their presence switches the
  // visitor's live join OFF. So the Finish must bake exactly when the tour
  // carries a recording it can join, never write the marker for nothing,
  // and never let a recording it cannot join stop the creator's Finish.
  createTourViewerStore();
  const FIXTURE = new URL(
    "../../GpsPlusSlamJs_PhysicsDemo/playwright-tests/fixtures/sample-recording.zip",
    import.meta.url,
  );

  async function recordingExtras(odomCoordVersion = 5) {
    if (!existsSync(FIXTURE)) {
      throw new Error("creator-finish: the shared sample-recording.zip moved");
    }
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const actions = (await loadActionsFromZip(bytes)).map((e) => e.action);
    const images = Array.from(
      { length: 6 },
      (_, i) => `images/frame-${String(i + 1).padStart(6, "0")}.jpg`,
    );
    let replays = 0;
    return {
      extras: {
        hasRecording: true,
        entries: [
          { filename: `${WRAP}tour.json` },
          { filename: `${WRAP}qr/${LEVEL_ID}.json` },
          ...images.map((filename) => ({ filename, isImage: true })),
        ],
        loadSessionMeta: () => Promise.resolve({ odomCoordVersion }),
        loadRecordingActions: () => {
          replays += 1;
          return Promise.resolve(actions);
        },
      },
      replays: () => replays,
    };
  }

  async function writtenManifest(ctx: {
    rebuiltZip: { blob: Blob } | null;
  }): Promise<Record<string, unknown>> {
    const bytes = readStoredEntryBytes(
      new Uint8Array(await ctx.rebuiltZip!.blob.arrayBuffer()),
      `${WRAP}tour.json`,
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
  }

  it("writes the spots of a tour that carries a recording, at minor 1", async () => {
    const recording = await recordingExtras();
    const { dom, ctx } = await wireFinishable({
      hosted: [],
      placed: [pin("new-one")],
      sessionExtras: recording.extras,
    });
    dom.finishButton.click();
    await settle(ctx);
    expect(ctx.finishError).toBeNull();
    const written = await writtenManifest(ctx);
    expect(written).toMatchObject({ version: 2, minor: 1 });
    const spots = parseTourManifest(written).captureSpots;
    // 5 of 6: the fixture's first photo precedes the GPS zero.
    expect(spots?.captures).toHaveLength(5);
    // The in-memory manifest advances with it, as with objects.
    expect(ctx.tourManifest?.captureSpots).toEqual(spots);
  });

  it("does not bake again when the tour already carries its spots", async () => {
    const recording = await recordingExtras();
    const spots = {
      fixes: 9,
      gpsAccuracyMedianM: 2,
      captures: [
        {
          image: "images/frame-000002.jpg",
          geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
        },
      ],
    };
    const { dom, ctx } = await wireFinishable({
      hosted: [],
      placed: [pin("new-one")],
      sessionExtras: recording.extras,
      manifestExtras: { captureSpots: spots as never },
    });
    dom.finishButton.click();
    await settle(ctx);
    expect(recording.replays()).toBe(0);
    expect(parseTourManifest(await writtenManifest(ctx)).captureSpots).toEqual(
      spots,
    );
  });

  it("finishes WITHOUT the marker when the recording cannot be joined", async () => {
    const recording = await recordingExtras(3);
    const { dom, ctx } = await wireFinishable({
      hosted: [],
      placed: [pin("new-one")],
      sessionExtras: recording.extras,
    });
    dom.finishButton.click();
    await settle(ctx);
    expect(ctx.finishError).toBeNull();
    expect(await writtenManifest(ctx)).not.toHaveProperty("captureSpots");
  });

  it("finishes without the marker when reading the recording fails", async () => {
    const recording = await recordingExtras();
    const { dom, ctx } = await wireFinishable({
      hosted: [],
      placed: [pin("new-one")],
      sessionExtras: {
        ...recording.extras,
        loadRecordingActions: () => Promise.reject(new Error("bad stream")),
      },
    });
    dom.finishButton.click();
    await settle(ctx);
    expect(ctx.finishError).toBeNull();
    expect(await writtenManifest(ctx)).not.toHaveProperty("captureSpots");
  });
});

describe("the published copy carries only what visitors need (scan-pass plan S1, S-D10)", () => {
  // Why these tests matter: the hosted zip is what every visitor downloads.
  // By default the Finish leaves the creator's walk out of it - the action
  // stream, session.json and the frames no baked spot shows - and keeps it
  // only when the creator ticks the box (for a co-author). Both halves
  // matter: a walk shipped to visitors costs them megabytes and publishes
  // the creator's timestamped route; content dropped from the copy is a
  // broken tour nobody notices until the field.
  createTourViewerStore();
  const FIXTURE = new URL(
    "../../GpsPlusSlamJs_PhysicsDemo/playwright-tests/fixtures/sample-recording.zip",
    import.meta.url,
  );
  const FRAMES = Array.from(
    { length: 6 },
    (_, i) => `images/frame-${String(i + 1).padStart(6, "0")}.jpg`,
  );
  const WALK = ["session.json", "actions/000001.json", ...FRAMES];
  // A file of the creator's own that no viewer reads: never the walk.
  const README = `${WRAP}README.txt`;

  async function wireRecordingTour(keepScan: boolean, odomCoordVersion = 5) {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const actions = (await loadActionsFromZip(bytes)).map((e) => e.action);
    const wired = await wireFinishable({
      hosted: [],
      placed: [pin("new-one")],
      hostedContent: [...WALK, README].map((path) => ({ path, data: "x" })),
      sessionExtras: {
        hasRecording: true,
        entries: [
          { filename: `${WRAP}tour.json` },
          { filename: `${WRAP}qr/${LEVEL_ID}.json` },
          ...[...WALK, README].map((filename) => ({
            filename,
            isImage: filename.endsWith(".jpg"),
          })),
        ],
        loadSessionMeta: () => Promise.resolve({ odomCoordVersion }),
        loadRecordingActions: () => Promise.resolve(actions),
      },
    });
    wired.dom.keepScanInput.checked = keepScan;
    wired.dom.finishButton.click();
    await settle(wired.ctx);
    return wired;
  }

  it("leaves the walk out by default and keeps every photo a baked spot shows", async () => {
    const { ctx, dom } = await wireRecordingTour(false);
    expect(ctx.finishError).toBeNull();
    const names = await entryNamesOf(ctx.rebuiltZip!.blob);
    // The first frame precedes the GPS zero, so no spot shows it.
    expect(names.filter((n) => WALK.includes(n)).sort()).toEqual(
      FRAMES.slice(1).sort(),
    );
    expect(names).toContain(`${WRAP}tour.json`);
    expect(names).toContain(`${WRAP}qr/${LEVEL_ID}.json`);
    // A first version dropped every file a visitor does not read, which
    // would have taken a creator's README or licence out of the copy.
    expect(names).toContain(README);
    // The creator is told, because the hosted file may be their only copy.
    expect(dom.finishStatus.textContent).toContain(
      "leaves out the walk recording",
    );
  });

  it("keeps the walk when the photos could not be placed, and says why", async () => {
    // Why (S1 milestone review #2): without baked spots the walk is the
    // only way a visitor's viewer can place the photos - and the hosted
    // file may be the creator's only copy of it. A recording this build
    // cannot join (an old era here; a network blip reading it, a wrapped
    // zip) must leave the copy as it was, with the reason on screen.
    const { ctx, dom } = await wireRecordingTour(false, 3);
    expect(ctx.finishError).toBeNull();
    const names = await entryNamesOf(ctx.rebuiltZip!.blob);
    expect(names.filter((n) => WALK.includes(n)).sort()).toEqual(
      [...WALK].sort(),
    );
    expect(dom.finishStatus.textContent).not.toContain(
      "leaves out the walk recording",
    );
    expect(dom.finishStatus.textContent).toContain(
      "The recorded photos could not be placed",
    );
  });

  it("forgets the creator's tick with the tour it was given for", async () => {
    // Why (S1 milestone review #9): a "keep the walk" for one tour must not
    // silently apply to the next tour's Finish.
    const { dom, setup } = await wireRecordingTour(true);
    setup.resetFinishStep();
    expect(dom.keepScanInput.checked).toBe(false);
  });

  it("keeps the walk when the creator asks for it", async () => {
    const { ctx, dom } = await wireRecordingTour(true);
    const names = await entryNamesOf(ctx.rebuiltZip!.blob);
    expect(names.filter((n) => WALK.includes(n)).sort()).toEqual(
      [...WALK].sort(),
    );
    expect(dom.finishStatus.textContent).not.toContain(
      "leaves out the walk recording",
    );
  });

  it("offers the choice only for a tour that carries something visitors never read", async () => {
    // On the page, before AR (UI round 1, U2): never over the camera.
    const plain = await wireFinishable({
      hosted: [],
      placed: [],
      arStatus: "ready",
    });
    plain.setup.renderAuthorReadout();
    expect(plain.dom.keepScanRow.hidden).toBe(true);
    const withWalk = await wireFinishable({
      hosted: [],
      placed: [],
      hostedContent: [{ path: "actions/000001.json", data: "x" }],
      arStatus: "ready",
    });
    withWalk.setup.renderAuthorReadout();
    expect(withWalk.dom.keepScanRow.hidden).toBe(false);
    // In AR it is gone: the Finish there reads it.
    withWalk.arStatus.value = "running";
    withWalk.setup.renderAuthorReadout();
    expect(withWalk.dom.keepScanRow.hidden).toBe(true);
  });
});

describe("the save cannot be forgotten (UI round 1, U2)", () => {
  // Why these tests matter (owner decision 2026-10-06): the creator's work
  // reaches visitors only once the rebuilt file is SAVED and uploaded.
  // Leaving with an unsaved file asks first; a delivered save stops asking;
  // a session ended without Finish (the back gesture) makes Finish say what
  // is waiting.
  it("asks before leaving while the rebuilt file is unsaved, and stops once a save delivered it", async () => {
    const { dom, ctx, setup } = await wireFinishable({
      hosted: [],
      placed: [pin("new-one")],
      seamsExtras: {
        downloadZip: () => Promise.resolve(true),
        shareOrDownloadZip: () =>
          Promise.resolve({ route: "download", delivered: true }),
      },
    });
    expect(setup.leaveNeedsConfirm()).toBe(false);
    dom.finishButton.click();
    await settle(ctx);
    expect(setup.leaveNeedsConfirm()).toBe(true);
    dom.downloadButton.click();
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(ctx.rebuiltZip?.delivered).toBe(true);
    expect(setup.leaveNeedsConfirm()).toBe(false);
  });

  it("a dismissed save keeps asking", async () => {
    const { dom, ctx, setup } = await wireFinishable({
      hosted: [],
      placed: [pin("new-one")],
      seamsExtras: {
        shareOrDownloadZip: () =>
          Promise.resolve({ route: "download", delivered: false }),
      },
    });
    dom.finishButton.click();
    await settle(ctx);
    dom.downloadButton.click();
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(setup.leaveNeedsConfirm()).toBe(true);
  });

  it("after AR ends without a Finish, Finish leads with saving the changes", async () => {
    const { dom, setup, arStatus } = await wireFinishable({
      hosted: [],
      placed: [pin("new-one")],
    });
    arStatus.value = "ready"; // the back gesture ended the session
    setup.renderAuthorReadout();
    expect(dom.finishButton.textContent).toBe("Finish and save your changes");
  });
});

describe("after the Finish, the save leads (UI round 1, U2 milestone review #2, #5)", () => {
  // Why: the page used to scroll to the top of step 4 and lead with
  // "Start AR setup" and Finish again; and a "keep the walk" ticked after a
  // Finish could not change the file waiting to be saved.
  it("focuses the save, and on a phone hides Finish once AR has ended", async () => {
    const { dom, ctx, setup, arStatus } = await wireFinishable({
      hosted: [],
      placed: [pin("new-one")],
    });
    let focused = false;
    (dom.downloadButton as unknown as { focus: () => void }).focus = () => {
      focused = true;
    };
    dom.finishButton.click();
    await settle(ctx);
    expect(focused).toBe(true);
    arStatus.value = "ready"; // the Finish ended the session
    setup.renderAuthorReadout();
    expect(dom.finishButton.hidden).toBe(true);
    expect(dom.finishBlock.hidden).toBe(false);
  });

  it("hides the keep-the-walk switch while a rebuilt file waits", async () => {
    const { dom, ctx, setup, arStatus } = await wireFinishable({
      hosted: [],
      placed: [pin("new-one")],
      hostedContent: [{ path: "actions/000001.json", data: "x" }],
    });
    dom.finishButton.click();
    await settle(ctx);
    arStatus.value = "ready";
    setup.renderAuthorReadout();
    expect(dom.keepScanRow.hidden).toBe(true);
  });
});

describe("desk edits: a Finish with no AR visit (code book plan M4d, §9 D4)", () => {
  // Why these tests matter: the owner decided a tour can be edited at the
  // desk - change a pin's text, delete an object - and Finished without
  // walking to a code. The Finish used to refuse without a code in hand;
  // now it runs when something changed, and writes no level entry (the
  // rebuild keeps the hosted ones byte for byte).
  it("finishes a desk edit with no code in hand, writing no level entry", async () => {
    const edited: TourObject = { ...pin("b"), label: "the new text" };
    const { dom, ctx, setup } = await wireFinishable({
      hosted: [pin("a"), pin("b")],
      placed: [edited],
      noCodeInHand: true,
      arStatus: "idle",
    });
    setup.renderAuthorReadout();
    expect(dom.finishButton.hidden).toBe(false);
    expect(dom.finishButton.disabled).toBe(false);
    dom.finishButton.click();
    await settle(ctx);
    expect(ctx.finishError).toBeNull();
    const blob = ctx.rebuiltZip!.blob;
    const written = await publishedManifest(blob);
    expect(written.objects[1]).toEqual(edited);
    // The hosted level file is kept as it was: nothing rewrote it.
    const names = await entryNamesOf(blob);
    expect(names).toContain(`${WRAP}qr/${LEVEL_ID}.json`);
  });

  it("keeps Finish hidden on the page while nothing changed", async () => {
    const { dom, setup } = await wireFinishable({
      hosted: [pin("a")],
      placed: [],
      noCodeInHand: true,
      arStatus: "idle",
    });
    setup.renderAuthorReadout();
    expect(dom.finishButton.hidden).toBe(true);
  });

  // Why this test matters (code book plan M4e; the sampled mutant "finish
  // guard: placements not counted"): with a code to write, the guard calls
  // the page changed anyway, so no other test noticed a guard blind to
  // changed objects. A desk edit changes objects and no code: Finish must
  // still lead with saving them.
  it("leads with saving a desk edit that is not finished", async () => {
    const edited: TourObject = { ...pin("b"), label: "the new text" };
    const { dom, setup } = await wireFinishable({
      hosted: [pin("a"), pin("b")],
      placed: [edited],
      noCodeInHand: true,
      arStatus: "idle",
    });
    setup.renderAuthorReadout();
    expect(dom.finishButton.textContent).toBe("Finish and save your changes");
  });
});
