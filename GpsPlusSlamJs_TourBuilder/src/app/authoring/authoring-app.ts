/**
 * Goal-2 composition, Authoring mode (plan
 * `plans/2026-08-14-authoring-composition-plan.md`).
 *
 * Sequences the approved components into the real Authoring flow: onboarding
 * gate (9) → authoring tools (10, live GPS only — the replay-track toggle in
 * `components/authoring/demo.ts` is demo-only scaffolding, not part of
 * `mountAuthoringView`'s real contract) → export. Uses the real
 * `createAuthoringStore()`, not a hand-rolled reducer loop.
 *
 */
import "leaflet/dist/leaflet.css";

import {
  checkGeolocationPermission,
  requestGeolocationPermission,
} from "gps-plus-slam-app-framework/sensors";
import { buildMapData } from "gps-plus-slam-app-framework/visualization/map-data";

import { createAuthoringStore } from "../../store/authoring-store.js";
import { updateWaypoint } from "../../store/authoring-slice.js";
import type { TourCoord } from "../../store/types.js";
import { mountOnboardingGate } from "../../components/onboarding/view/onboarding-view.js";
import { createLiveGpsPositionSource } from "../../components/authoring/view/gps-position-source.js";
import { createFilesAssetProvider } from "../../components/authoring/view/files-asset-provider.js";
import { createAuthoringSession } from "../../components/authoring/view/authoring-session.js";
import { mountAuthoringView } from "../../components/authoring/view/authoring-view.js";
import { computeMarkerViewModels } from "../../components/map/core/map-marker-state.js";
import { createTourMap } from "../../components/map/view/tour-map.js";
import { mountPackAndSharePanel } from "./pack-and-share-panel.js";
import { packTour } from "../../components/packaging/core/pack-tour.js";
import { downloadZip } from "gps-plus-slam-app-framework/storage";
import { swapScreen } from "../screen-transition.js";
import {
  disableBeforeUnloadWarning,
  enableBeforeUnloadWarning,
} from "./unload-guard.js";
import { requestWakeLock, type WakeLockHandle } from "../wake-lock.js";
import {
  beginDurableAuthoringSession,
  discardDraft,
  findResumableDraft,
  restoreAuthoringDraft,
} from "./restore-authoring-draft.js";

/** Mounts the composed Authoring-mode flow into `root`. Entered from the
 *  landing screen's "Create your own tour" action (`src/app/landing/`),
 *  which owns the root-URL entry decision — this only ever renders the
 *  onboarding gate straight through to the authoring tools. */
export function mountAuthoringApp(root: HTMLElement): { destroy(): void } {
  const gateHost = document.createElement("div");
  gateHost.className = "gate-card";
  root.appendChild(gateHost);

  const gate = mountOnboardingGate(gateHost, {
    // Authoring is a 2D map + live GPS — it never opens the camera.
    required: ["gps"],
    checkGeolocationPermission,
    requestGeolocationPermission,
    createAudioContext: () => new AudioContext(),
    onComplete: () => {
      swapScreen(gateHost, () => {
        gate.destroy();
        void startAuthoringFlow(root);
      });
    },
  });

  return {
    destroy() {
      gate.destroy();
      gateHost.remove();
    },
  };
}

/** AC10: offers to resume an interrupted draft before the tools screen mounts. */
async function startAuthoringFlow(root: HTMLElement): Promise<void> {
  const resumableSessionName = await findResumableDraft();
  if (!resumableSessionName) {
    await mountAuthoringTools(root);
    return;
  }

  const promptHost = document.createElement("div");
  promptHost.className = "resume-prompt";

  const message = document.createElement("p");
  message.textContent =
    "An interrupted authoring session was found. Resume it, or discard and start fresh?";
  const actions = document.createElement("div");
  actions.className = "resume-prompt-actions";
  const resumeButton = document.createElement("button");
  resumeButton.className = "primary";
  resumeButton.textContent = "Resume previous draft";
  const discardButton = document.createElement("button");
  discardButton.textContent = "Discard and start fresh";
  actions.append(resumeButton, discardButton);
  promptHost.append(message, actions);
  root.appendChild(promptHost);

  resumeButton.addEventListener("click", () => {
    swapScreen(promptHost, () => {
      void mountAuthoringTools(root, resumableSessionName);
    });
  });
  discardButton.addEventListener("click", () => {
    swapScreen(promptHost, () => {
      void discardDraft(resumableSessionName).then(() =>
        mountAuthoringTools(root),
      );
    });
  });
}

async function mountAuthoringTools(
  root: HTMLElement,
  resumeSessionName?: string,
): Promise<void> {
  const toolsHost = document.createElement("div");
  toolsHost.className = "tools-shell screen-enter";
  root.appendChild(toolsHost);

  const store = createAuthoringStore();

  // AC10: continue (or start) durable draft persistence, then rehydrate the
  // store from a resumed session's log using the PLAIN dispatch — actions
  // already on disk must not be re-written under new indices.
  const durable = await beginDurableAuthoringSession(resumeSessionName);
  if (resumeSessionName) {
    await restoreAuthoringDraft(store.dispatch, durable.sessionName);
  }
  const dispatch = durable.wrapDispatch(store.dispatch);

  // AC11: keep the screen awake while the author is actively walking the
  // route — a sleeping screen silently stalls the live GPS position source.
  // Re-requested on visibilitychange, since the OS releases the lock
  // whenever the tab is hidden.
  let wakeLockHandle: WakeLockHandle | null = null;
  let exported = false;
  void requestWakeLock().then((handle) => {
    wakeLockHandle = handle;
  });
  function onVisibilityChange(): void {
    if (document.visibilityState !== "visible" || exported) return;
    void requestWakeLock().then((handle) => {
      wakeLockHandle = handle;
    });
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  // AC12: warn before leaving with an unexported, non-empty draft.
  enableBeforeUnloadWarning(() => {
    if (exported) return false;
    const draft = store.getState().authoring;
    return draft.waypoints.length > 0 || draft.breadcrumb.length > 0;
  });

  // `.map-shell` never touches Leaflet's own DOM subtree — the GPS badge is
  // its sibling, not a child of `.map-card`, so Leaflet's internal rendering
  // can never clobber it. `.map-card` stays the direct element passed to
  // createTourMap, exactly as before (see tour-map.ts / app.css).
  const mapShell = document.createElement("div");
  mapShell.className = "map-shell";
  toolsHost.appendChild(mapShell);

  const mapHost = document.createElement("div");
  mapHost.className = "map-card map-card-flush map-card-fullscreen";
  mapShell.appendChild(mapHost);
  // `session` and `authoringRoot` (the floating panel) are each declared
  // `const` further down, but the map's callbacks close over them here —
  // safe because neither callback runs until well after the rest of this
  // function has finished (a real user click, or the next GPS
  // fix/waypoint-list change), by which point those `const`s have run.
  // Full-bleed and interactive: the map IS the authoring screen now, so
  // the author can pan/zoom to see the route, drag a marker to fine-tune
  // its position, or click an empty spot to drop one exactly there — three
  // ways to place a waypoint, alongside walking to the spot and pressing
  // Drop Waypoint.
  const tourMap = createTourMap(mapHost, {
    interactive: true,
    onWaypointDragEnd: (id, lat, lon) => {
      dispatch(updateWaypoint({ id, changes: { position: { lat, lon } } }));
    },
    onDropWaypointHere: (lat, lon) => {
      const id = session.dropWaypoint({ lat, lon });
      if (id !== null) view.focusWaypoint(id);
    },
    // On desktop the panel is a sidebar (doesn't cover the map's bottom
    // edge at all); on mobile it's a bottom sheet that does, and its own
    // height changes as its content does — so this reads it fresh every
    // time rather than caching a value that would go stale (see
    // `getObscuredBottomPx`'s own doc comment in tour-map.ts).
    getObscuredBottomPx: () =>
      window.innerWidth > 720
        ? 0
        : authoringRoot.getBoundingClientRect().height,
  });
  tourMap?.show();

  // AC13: explicit waiting state until the first live GPS fix arrives —
  // Drop Waypoint has nothing to drop at until then.
  const gpsBadge = document.createElement("div");
  gpsBadge.className = "map-badge map-badge-waiting";
  gpsBadge.dataset["testid"] = "gps-status";
  gpsBadge.textContent = "Waiting for GPS…";
  mapShell.appendChild(gpsBadge);

  function refreshMapWaypoints(): void {
    tourMap?.setWaypoints(
      computeMarkerViewModels(store.getState().authoring.waypoints, [], null),
    );
  }
  store.subscribe(refreshMapWaypoints);
  refreshMapWaypoints();

  let hasGpsFix = false;
  function updateMapPosition(pos: TourCoord): void {
    if (!hasGpsFix) {
      hasGpsFix = true;
      gpsBadge.className = "map-badge map-badge-live";
      gpsBadge.textContent = "Live";
    }
    tourMap?.setGpsPosition(pos.lat, pos.lon);
    tourMap?.render(
      buildMapData({ userPosition: { lat: pos.lat, lng: pos.lon } }),
    );
  }

  const positionSource = createLiveGpsPositionSource();
  const withMapSync = {
    subscribe(onPosition: (pos: TourCoord) => void) {
      return positionSource.subscribe((pos) => {
        updateMapPosition(pos);
        onPosition(pos);
      });
    },
  };

  const filesAssetProvider = createFilesAssetProvider();
  const session = createAuthoringSession({
    positionSource: withMapSync,
    dispatch,
    getState: store.getState,
    filesAssetProvider,
  });

  const authoringRoot = document.createElement("div");
  authoringRoot.className = "authoring-sections";
  toolsHost.appendChild(authoringRoot);

  const view = mountAuthoringView(authoringRoot, {
    session,
    subscribe: store.subscribe,
    getState: store.getState,
    dispatch,
    packAndDownload: async (tour, assetFiles) => {
      const blob = await packTour(tour, new Map(assetFiles));
      // downloadZip resolves `false` (never throws) when the visitor
      // dismisses the native save dialog — turn that into a rejection so
      // the view's existing catch keeps the author on this screen instead
      // of treating a cancelled save as a completed export.
      const saved = await downloadZip(blob, "tour.zip");
      if (!saved) throw new Error("Download cancelled.");
    },
    // The share panel needs neither the tour nor the asset files (only
    // packaging did, and that already ran in packAndDownload above), so
    // the parameter below is intentionally unused.
    onExport: (_result: ReturnType<typeof session.exportTour>) => {
      exported = true;
      disableBeforeUnloadWarning();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      wakeLockHandle?.release();
      void durable.discard(); // packed successfully — nothing left to resume
      // Swap out the WHOLE tools screen, not just the floating panel: the
      // full-bleed map (`toolsHost`, `position:fixed`) is still live
      // underneath otherwise, and the share panel — a normal card meant
      // for the padded `#app-root` column every other screen uses — ends
      // up rendered on top of it instead of replacing it.
      swapScreen(toolsHost, () => {
        view.destroy();
        tourMap?.destroy();
        const shareHost = mountPackAndSharePanel(root);
        shareHost.root.classList.add("screen-enter");
      });
    },
  });
}
