/**
 * The feature matching benchmark page's entry: the store, the log, the
 * camera, the measuring block (`bench-engine.ts`) and the view. It is a
 * view on the page's store (`feature-match-store.ts`): taps dispatch
 * actions, each part's `render` draws the state.
 *
 * @see feature-match-check.ts.md
 */
import { startBenchEngine } from "./bench-engine";
import { sessionToken } from "./bench-export";
import { errorText } from "./bench-net";
import { createCameraControl } from "./camera-control";
import { sameDrawing } from "./cockpit-model";
import { cockpitVideo, startCockpitView } from "./cockpit-view";
import { featureMatchActions as A } from "./feature-match-slice";
import { guidedVideo, startGuidedView } from "./guided-view";
import { indexedDbKeyValueStore } from "../../key-value-db";
import {
  createFeatureMatchStore,
  PHOTO_DB,
  PHOTO_STORE,
  type KeyValueStorage,
} from "./feature-match-store";

/** `localStorage` behind calls, so a blocked storage throws inside them. */
const pageStorage: KeyValueStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => {
    localStorage.setItem(key, value);
  },
};

/** Starts the page on `root` (the document in the HTML entry). */
export function startFeatureMatchCheck(root: ParentNode = document): void {
  const fm = createFeatureMatchStore({
    storage: pageStorage,
    // This page load's token for the frames JSON (no time, no place).
    session: sessionToken(crypto.getRandomValues(new Uint8Array(4))),
    revokeUrl: (url) => URL.revokeObjectURL(url),
    photoDb: indexedDbKeyValueStore(
      typeof indexedDB === "undefined" ? undefined : indexedDB,
      PHOTO_DB,
      PHOTO_STORE,
    ),
    // Called only after a database call settled, long after `fail` exists.
    photoDbFailed: (e) => {
      fail("photo storage", e);
    },
  });
  const { store } = fm;

  /** A log line with the page time in front. */
  const stamp = (line: string): string =>
    `[${(performance.now() / 1000).toFixed(1)}s] ${line}`;
  const log = (line: string): void => {
    store.dispatch(A.logged(stamp(line)));
  };
  const fail = (where: string, e: unknown): void => {
    const line = `${where}: ${errorText(e)}`;
    store.dispatch(A.failed({ line, stamped: stamp(`ERROR ${line}`) }));
  };
  window.addEventListener("error", (ev) =>
    fail("page", ev.error ?? ev.message),
  );
  window.addEventListener("unhandledrejection", (ev) =>
    fail("page", ev.reason),
  );

  try {
    performance.setResourceTimingBufferSize(1000);
  } catch {
    // Older browsers keep their default buffer; sizes may then read "-".
  }

  // The camera stays out of the state: it is a browser resource. It must
  // not run beside the timed runs (it costs the CPU and GPU measured).
  // The view is picked in the page head from `?ui` (guided by default).
  const guided = document.documentElement.dataset.ui !== "cockpit";
  const camera = createCameraControl(
    guided ? guidedVideo(root) : cockpitVideo(root),
    {
      getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
      log,
      fail,
      changed: (on) => store.dispatch(A.cameraChanged(on)),
    },
  );
  const engine = startBenchEngine({
    root,
    fm,
    log,
    fail,
    stamp,
    stopCamera: camera.stop,
  });
  const viewDeps = { root, fm, engine, camera, log, fail };
  const view = guided ? startGuidedView(viewDeps) : startCockpitView(viewDeps);

  window.addEventListener("pagehide", camera.stop);
  // A motion reading writes the store up to 60 times a second; the page
  // draws only when what it shows changed (`sameDrawing`).
  let drawn = store.getState();
  store.subscribe(() => {
    const s = store.getState();
    if (sameDrawing(drawn, s)) {
      return;
    }
    drawn = s;
    engine.render();
    view();
  });
  engine.render();
  view();
  // The restore fills the photo side table without an action: draw again.
  void fm.restorePhotos().then(view, (e: unknown) => {
    fail("photo storage", e);
  });
  if (fm.oldPlanDiscarded) {
    log("stored plan of version 1 discarded (no migration)");
  }
  log("ready");
}
