/**
 * The page-open housekeeping of the troubleshooting recordings, wired as
 * the page wires it, over the framework's OPFS mock (authoring recording
 * plan 2026-09-28-0953, M1b).
 *
 * Why these tests matter: the offer is the only way a killed tab's
 * recording comes back, and the `session.json` it rebuilds decides how the
 * Recorder replays it. A recording that holds no log action of either kind
 * is labelled by the page that saves it - so the page must pass ITS OWN
 * tag: a visitor's `?debug=1` page used to label such a recording an
 * authoring one (M1b review #7).
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSessionMetadataFromZip } from "gps-plus-slam-app-framework/storage";
import {
  installOPFSMocks,
  type MockOPFSDirectoryHandle,
} from "gps-plus-slam-app-framework/test-utils/browser-mocks";

import {
  AUTHORING_CONTEXT_TAG,
  openRecordingsDir,
  VIEWING_CONTEXT_TAG,
  type RecordingContextTag,
} from "./recording-folders.js";
import { wireRecordingHousekeeping } from "./recording-housekeeping.js";
import { createSaveGuard } from "./recording-panel.js";

const T0 = Date.UTC(2026, 8, 28, 10, 0, 0);
const ORPHAN = "recording-2026-09-28_10-00-00utc";

let root: MockOPFSDirectoryHandle;
let cleanup: () => void;

beforeEach(() => {
  const mocks = installOPFSMocks();
  root = mocks.root;
  cleanup = mocks.cleanup;
});

afterEach(() => {
  cleanup();
});

function el() {
  const handlers = new Map<string, () => void>();
  return {
    hidden: false,
    textContent: "",
    disabled: false,
    dataset: {} as Record<string, string>,
    addEventListener: (type: string, handler: () => void) =>
      handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A killed tab's folder: GPS fixes only - no `tourAuthoring/*` and no
 *  `tourViewing/*` action, so nothing in it says which page recorded it. */
async function orphanWithFixesOnly(): Promise<void> {
  const dir = (await openRecordingsDir(
    root,
    true,
  )) as unknown as MockOPFSDirectoryHandle;
  const folder = (await dir.getDirectoryHandle(ORPHAN, {
    create: true,
  })) as unknown as MockOPFSDirectoryHandle;
  const actions = (await folder.getDirectoryHandle("actions", {
    create: true,
  })) as unknown as MockOPFSDirectoryHandle;
  actions.setStoredContent(
    "000001.json",
    JSON.stringify({
      type: "gpsData/recordGpsEvent",
      payload: {
        odomPosition: [0, 0, 0],
        odomRotation: [0, 0, 0, 1],
        rawGpsPoint: {
          id: "fix-0",
          latitude: 47.5,
          longitude: 8.7,
          altitude: 400,
          latLongAccuracy: 5,
          timestamp: T0,
        },
      },
    }),
  );
}

function wire(contextTag: RecordingContextTag) {
  const dom = {
    offer: el(),
    text: el(),
    saveButton: el(),
    dismissButton: el(),
    discardButton: el(),
    status: el(),
    block: el(),
  };
  const handOff = vi.fn((_blob: Blob, _filename: string) =>
    Promise.resolve({ route: "download" as const, delivered: true }),
  );
  const checked = wireRecordingHousekeeping({
    dom: dom as never,
    openRoot: () => Promise.resolve(root as never),
    locks: undefined,
    contextTag,
    environment: () => ({ userAgent: "test-agent", pageUrl: undefined }),
    handOff,
    canShare: () => false,
    now: () => new Date(T0 + 2 * 60 * 60 * 1000),
    describeTime: () => "earlier",
    reveal: () => undefined,
    saveGuard: createSaveGuard(),
  });
  return { dom, handOff, checked };
}

/** Offer found, "Save it" (prepare), then the hand-off tap. */
async function saveTheOrphan(h: ReturnType<typeof wire>): Promise<string> {
  await h.checked;
  expect(h.dom.block.dataset["housekeeping"]).toBe("done");
  expect(h.dom.offer.hidden).toBe(false);
  h.dom.saveButton.click();
  await settle();
  h.dom.saveButton.click();
  await settle();
  const blob = h.handOff.mock.calls[0]?.[0];
  if (blob === undefined) throw new Error("nothing was handed over");
  const meta = await loadSessionMetadataFromZip(
    new Uint8Array(await blob.arrayBuffer()),
  );
  return (meta as { contextTag: string }).contextTag;
}

describe("the recording housekeeping a page wires at open", () => {
  it("an orphan saved from a visitor's debug page gets the visitor's tag, not the creator's", async () => {
    await orphanWithFixesOnly();
    expect(await saveTheOrphan(wire(VIEWING_CONTEXT_TAG))).toBe(
      VIEWING_CONTEXT_TAG,
    );
  });

  it("an orphan saved from a creator's page gets the creator's tag", async () => {
    await orphanWithFixesOnly();
    expect(await saveTheOrphan(wire(AUTHORING_CONTEXT_TAG))).toBe(
      AUTHORING_CONTEXT_TAG,
    );
  });

  it("without private file storage it offers nothing and still reports the check done", async () => {
    const dom = { offer: el(), block: el() };
    await wireRecordingHousekeeping({
      dom: {
        ...dom,
        text: el(),
        saveButton: el(),
        dismissButton: el(),
        discardButton: el(),
        status: el(),
      } as never,
      openRoot: () => Promise.reject(new Error("no OPFS")),
      locks: undefined,
      contextTag: VIEWING_CONTEXT_TAG,
      environment: () => ({ userAgent: "x", pageUrl: undefined }),
      handOff: () => Promise.resolve({ route: "download", delivered: true }),
      canShare: () => false,
      now: () => new Date(T0),
      describeTime: () => "",
      reveal: () => undefined,
      saveGuard: createSaveGuard(),
    });
    expect(dom.block.dataset["housekeeping"]).toBe("done");
  });
});
