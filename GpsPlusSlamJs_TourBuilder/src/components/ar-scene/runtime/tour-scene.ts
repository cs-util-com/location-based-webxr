/**
 * The AR viewing scene (component 8) — the orchestrator.
 *
 * Subscribes to the store, anchors the tour, owns the proximity driver, turns
 * zone edges into scene commands, runs the breadcrumb trail, routes taps into
 * the story session, and tears all of it down again. It imports **no THREE and
 * no DOM**: every rendering effect goes through the `SceneAdapter` port, which
 * is what lets the replay e2e drive this exact code in Node (plan A20).
 *
 * Ownership, deliberately (plan A1/A2): this component creates the GPS anchors
 * and the proximity driver, because it is the only thing that holds the anchored
 * world positions the driver needs. Component 4 stays untouched and reusable —
 * component 8 is simply its first real consumer.
 *
 * What it never does: construct the store, construct the asset provider, start
 * an XR session, ask for permissions, or unlock the `AudioContext`.
 *
 * @see plans/2026-07-31-ar-scene-plan.md
 */

import type { Vector3 } from "three";

import {
  createProximityDriver,
  type ProximityDriver,
} from "gps-plus-slam-app-framework/visualization/proximity-driver";
import type { ProximityObject } from "gps-plus-slam-app-framework/visualization/proximity-machine";
import {
  selectNextUnvisitedWaypoint,
  selectTour,
  type ViewingStateShape,
} from "../../../store/selectors.js";
import { initZones, setWaypointZone } from "../../../store/zones-slice.js";
import { markWaypointVisited } from "../../../store/tour-progress-slice.js";
import type {
  AssetProvider,
  Tour,
  TourCoord,
  Waypoint,
} from "../../../store/types.js";
import {
  MAX_CONCURRENT_PARSES,
  MODEL_LRU_CAPACITY,
  TRAIL_ORB_POOL_SIZE,
  TRAIL_ORB_MIN_SEPARATION_M,
  TRAIL_WINDOW_RADIUS_M,
} from "../config.js";
import { diffZones, type ZoneMap } from "../core/zone-commands.js";
import { createModelCache, type ModelCache } from "../core/model-cache.js";
import { createParseQueue, type ParseQueue } from "../core/parse-queue.js";
import { assignOrbSlots, selectTrailWindow } from "../core/trail-window.js";
import { advanceBreadcrumbProgress } from "../core/breadcrumb-progress.js";
import { markBreadcrumbVisited } from "../../../store/breadcrumb-progress-slice.js";
import {
  BREADCRUMB_ARRIVAL_RADIUS_M,
  BREADCRUMB_GIVE_UP_RADIUS_M,
} from "../config.js";
import {
  initialStorySession,
  leaveActive,
  stopAll,
  storyEnded,
  tapWaypoint,
  type StoryCommand,
  type StorySessionState,
} from "../core/story-session.js";
import { hitToAction } from "../../billboard/core/panel-layout.js";
import {
  createWaypointPresenter,
  type WaypointPresenter,
} from "./waypoint-presenter.js";
import { createTemplateLoader } from "./template-loader.js";
import type {
  SceneAdapter,
  TapHit,
  TemplateHandle,
  WaypointHandle,
  WayfindingTarget,
} from "./scene-adapter.js";

/** Re-window the trail four times a second — orbs are metres apart, not pixels. */
const TRAIL_UPDATE_INTERVAL_S = 0.25;

/** The store surface this component uses. Structural, so the real RTK store fits. */
interface SceneStore {
  getState(): ViewingStateShape;
  subscribe(listener: () => void): () => void;
  dispatch(action: { type: string; payload?: unknown }): void;
}

export interface TourSceneOptions {
  readonly store: SceneStore;
  /** Injected, never held in the store (contract D14). */
  readonly assetProvider: AssetProvider;
  readonly adapter: SceneAdapter;
  /** Hysteresis fraction for the proximity machine (contract D16). */
  readonly hysteresisFraction: number;

  // seams
  readonly driverFactory?: typeof createProximityDriver;

  // Budgets (config.ts defaults). Explicit `undefined` is accepted and means
  // "use the default", so a caller can forward optional config straight through
  // under exactOptionalPropertyTypes.
  readonly modelLruCapacity?: number | undefined;
  readonly maxConcurrentParses?: number | undefined;
  readonly trailOrbPoolSize?: number | undefined;
  readonly trailWindowRadiusM?: number | undefined;

  /** The injected `AudioListener` was suspended and could not be resumed (A16). */
  readonly onAudioBlocked?: () => void;
  readonly log?: (message: string) => void;
}

export interface TourScene {
  /** Call once per frame from whichever loop owns the app (plan A21). */
  tick(dtSeconds: number): void;
  /**
   * Show/hide the single wayfinding guide indicator (off by default — an
   * opt-in aid, not forced on every visitor). Breadcrumb progress keeps
   * advancing in the background either way; this only gates whether
   * `adapter.setWayfindingTarget` ever receives a non-null target.
   */
  setWayfindingEnabled(enabled: boolean): void;
  /** Idempotent, ordered teardown. Safe while loads are in flight. */
  dispose(): void;
  /** Introspection for the demo HUD and the replay assertions. */
  debug(): {
    readonly presenters: readonly WaypointPresenter[];
    readonly cachedTemplates: readonly string[];
    readonly pendingParses: number;
    readonly activeParses: number;
    readonly story: StorySessionState;
  };
}

export function createTourScene(options: TourSceneOptions): TourScene {
  const { store, adapter, assetProvider } = options;
  // Field diagnostics: a missing asset or a blocked AudioContext must leave a
  // trace in the console when no logger is injected. Never called per frame —
  // only on zone edges, load failures, eviction and audio problems (plan §8).
  const log =
    options.log ??
    // eslint-disable-next-line no-console
    ((message: string) => console.warn(`[ar-scene] ${message}`));
  const poolSize = options.trailOrbPoolSize ?? TRAIL_ORB_POOL_SIZE;
  const trailRadiusM = options.trailWindowRadiusM ?? TRAIL_WINDOW_RADIUS_M;

  const queue: ParseQueue = createParseQueue({
    concurrency: options.maxConcurrentParses ?? MAX_CONCURRENT_PARSES,
  });

  // Tier-2 memory: the cache entry owns the asset's blob reference, so evicting
  // a template is what finally releases it (plan A9).
  const cache: ModelCache<TemplateHandle> = createModelCache<TemplateHandle>({
    capacity: options.modelLruCapacity ?? MODEL_LRU_CAPACITY,
    onEvict: (assetId, template) => {
      adapter.disposeTemplate(template);
      assetProvider.release(assetId);
    },
  });

  // One loader for the whole tour: it de-duplicates concurrent loads of the same
  // asset id, which two nearby waypoints sharing a model would otherwise parse
  // twice in the same update.
  const loader = createTemplateLoader({
    adapter,
    assetProvider,
    queue,
    cache,
  });

  const presenters = new Map<string, WaypointPresenter>();
  let currentTour: Tour | null = null;
  let previousZones: ZoneMap = {};
  let story: StorySessionState = initialStorySession();
  let orbSlots: readonly (number | null)[] = new Array<number | null>(
    poolSize,
  ).fill(null);
  let sinceTrailUpdate = TRAIL_UPDATE_INTERVAL_S;
  let syncing = false;
  let disposed = false;
  let wayfindingEnabled = false;

  // ── Proximity (plan A2) ─────────────────────────────────────────────────────
  const scratchObjects: ProximityObject[] = [];

  /** Anchored waypoints only — a bootstrapping anchor has no trustworthy pose (A19). */
  function collectObjects(): readonly ProximityObject[] {
    scratchObjects.length = 0;
    if (currentTour === null) return scratchObjects;
    for (const waypoint of currentTour.waypoints) {
      const presenter = presenters.get(waypoint.id);
      if (presenter === undefined || !presenter.isAnchored()) continue;
      const position = adapter.getWorldPosition(presenter.handle);
      if (position === null) continue;
      scratchObjects.push({
        id: waypoint.id,
        position,
        prefetchRadius: waypoint.prefetchRadius,
        activeRadius: waypoint.activeRadius,
      });
    }
    return scratchObjects;
  }

  const driver: ProximityDriver = (
    options.driverFactory ?? createProximityDriver
  )({
    getUserWorldPos: () => adapter.getUserPosition(),
    getObjects: collectObjects,
    getZones: () => store.getState().zones.byWaypointId,
    onTransition: (transition) => {
      store.dispatch(
        setWaypointZone({ id: transition.id, zone: transition.to }),
      );
    },
    config: { hysteresisFraction: options.hysteresisFraction },
  });

  // ── Tour lifecycle ──────────────────────────────────────────────────────────

  /** A new tour (or none) replaces everything — no incremental diff (plan A22). */
  function rebuild(tour: Tour | null): void {
    runStoryCommands(stopAll(story));
    for (const presenter of presenters.values()) presenter.dispose();
    presenters.clear();
    loader.invalidate();
    cache.clear();
    queue.drain();
    previousZones = {};
    orbSlots = new Array<number | null>(poolSize).fill(null);
    adapter.setOrbCoords(new Array<TourCoord | null>(poolSize).fill(null));
    adapter.setPickTargets([]);
    currentTour = tour;
    if (tour === null) return;

    for (const waypoint of tour.waypoints) {
      presenters.set(
        waypoint.id,
        createWaypointPresenter({
          waypoint,
          adapter,
          assetProvider,
          loader,
          onVisited: (id) => {
            store.dispatch(markWaypointVisited(id));
          },
          log,
        }),
      );
    }
    store.dispatch(initZones(tour.waypoints.map((w) => w.id)));
    driver.reset();
  }

  // ── Zone edges → scene commands ─────────────────────────────────────────────

  function syncZones(): void {
    // The driver dispatches while we are inside `tick`, and executing a command
    // dispatches `markWaypointVisited` — both re-enter this listener. Let the
    // outermost call drain the changes in a loop instead of recursing.
    if (syncing) return;
    syncing = true;
    try {
      for (;;) {
        const next = store.getState().zones.byWaypointId;
        const commands = diffZones(previousZones, next);
        previousZones = next;
        if (commands.length === 0) break;
        for (const command of commands) {
          const presenter = presenters.get(command.id);
          if (presenter === undefined) continue;
          switch (command.kind) {
            case "build":
              presenter.build();
              break;
            case "show":
              presenter.show();
              break;
            case "hide":
              presenter.hide();
              runStoryCommands(leaveActive(story, command.id));
              break;
            case "teardown":
              presenter.teardown();
              break;
          }
        }
      }
      refreshPickTargets();
    } finally {
      syncing = false;
    }
  }

  /** Only ACTIVE knights are tappable — an invisible mesh would eat taps (A12). */
  function refreshPickTargets(): void {
    const handles: WaypointHandle[] = [];
    for (const [id, zone] of Object.entries(previousZones)) {
      if (zone !== "ACTIVE") continue;
      const presenter = presenters.get(id);
      if (presenter !== undefined) handles.push(presenter.handle);
    }
    adapter.setPickTargets(handles);
  }

  function onStoreChange(): void {
    if (disposed) return;
    const tour = selectTour(store.getState());
    if (tour !== currentTour) rebuild(tour);
    syncZones();
  }

  // ── Story (plan A13) ────────────────────────────────────────────────────────

  function runStoryCommands(result: {
    state: StorySessionState;
    commands: readonly StoryCommand[];
  }): void {
    story = result.state;
    for (const command of result.commands) {
      const presenter = presenters.get(command.id);
      switch (command.kind) {
        case "stop":
          adapter.stopAudio();
          break;
        case "start":
          presenter?.startStory();
          break;
        case "pause":
          adapter.pauseAudio();
          break;
        case "resume":
          adapter.resumeAudio();
          break;
      }
    }
  }

  /**
   * A transport-panel hit needs its `uv` resolved through component 1's
   * `hitToAction` before it can be treated as a toggle — otherwise a track tap
   * (seek) would be misread as a button tap (toggle), the bug this fixes.
   * Returns `true` once the hit is fully handled (seek, or inert chrome);
   * `false` means the caller should fall through to the shared toggle path.
   */
  function handleTransportTap(
    hit: TapHit,
    presenter: WaypointPresenter,
  ): boolean {
    if (hit.uv === undefined) return false;
    const action = hitToAction(hit.uv);
    if (action === null) return true; // panel padding/chrome — not interactive
    if (action.type !== "seek") return false; // toggle: shared path handles it
    // Only the waypoint that is actually playing has an audio element to
    // scrub; a track tap on any other panel is a no-op.
    if (story.playingId === hit.waypointId) {
      adapter.seekAudio(presenter.handle, action.fraction);
    }
    return true;
  }

  const unsubscribeTap = adapter.onTap((hit) => {
    if (disposed) return;
    const presenter = presenters.get(hit.waypointId);
    if (presenter === undefined) return;
    if (hit.role === "transcript") {
      presenter.pageTranscript(hit.uv);
      return;
    }
    if (hit.role === "transport" && handleTransportTap(hit, presenter)) return;
    if (previousZones[hit.waypointId] !== "ACTIVE") return;
    if (!adapter.isAudioReady()) {
      // Silent failure is the worst field outcome: surface it so the app can
      // put the onboarding gate back up (plan A16).
      log("audio context is not running — the story cannot start");
      options.onAudioBlocked?.();
      return;
    }
    runStoryCommands(tapWaypoint(story, hit.waypointId));
  });

  const unsubscribeAudioEnd = adapter.onAudioEnded(() => {
    if (!disposed) runStoryCommands(storyEnded(story));
  });

  // ── Trail (plan A3/A4) ──────────────────────────────────────────────────────

  const giveUpRadiusSq =
    BREADCRUMB_GIVE_UP_RADIUS_M * BREADCRUMB_GIVE_UP_RADIUS_M;

  /** A breadcrumb target only counts as trustworthy within the give-up
   *  radius; farther than that (or none left) is the caller's cue to fall
   *  back to the next unvisited waypoint in tour order (D8) instead. */
  function resolveBreadcrumbTarget(
    next: number | null,
    nextCoord: TourCoord | null,
    nextDistSq: number | null,
  ): WayfindingTarget | null {
    if (next === null || nextCoord === null || nextDistSq === null) {
      return null;
    }
    if (nextDistSq > giveUpRadiusSq) return null;
    return { kind: "breadcrumb", index: next, coord: nextCoord };
  }

  function waypointFallbackTarget(): WayfindingTarget | null {
    const waypoint: Waypoint | null = selectNextUnvisitedWaypoint(
      store.getState(),
    );
    return waypoint === null
      ? null
      : { kind: "waypoint", id: waypoint.id, coord: waypoint.position };
  }

  function updateTrail(): void {
    if (currentTour === null) return;
    const coords: readonly TourCoord[] = currentTour.breadcrumb;
    if (coords.length === 0) return;

    const world: readonly (Vector3 | null)[] = adapter.toWorldPositions(coords);
    const selected = selectTrailWindow(world, adapter.getUserPosition(), {
      maxOrbs: poolSize,
      radiusM: trailRadiusM,
      minSeparationM: TRAIL_ORB_MIN_SEPARATION_M,
    });
    orbSlots = assignOrbSlots(orbSlots, selected, poolSize);
    adapter.setOrbCoords(
      orbSlots.map((index) =>
        index === null ? null : (coords[index] ?? null),
      ),
    );

    const visited = new Set(store.getState().breadcrumbProgress.visitedIndices);
    const { next, newlyVisited, nextDistSq } = advanceBreadcrumbProgress(
      world,
      visited,
      adapter.getUserPosition(),
      BREADCRUMB_ARRIVAL_RADIUS_M,
    );
    if (newlyVisited !== null) {
      store.dispatch(markBreadcrumbVisited(newlyVisited));
    }
    const nextCoord = next === null ? null : (coords[next] ?? null);
    const breadcrumbTarget = resolveBreadcrumbTarget(
      next,
      nextCoord,
      nextDistSq,
    );
    adapter.setWayfindingTarget(
      wayfindingEnabled ? (breadcrumbTarget ?? waypointFallbackTarget()) : null,
    );

    adapter.setActiveWaypointPositions(collectActiveWaypointPositions());
  }

  // Every ACTIVE waypoint's world position — the adapter suppresses the
  // wayfinding indicator only while one of these is actually in the
  // camera's current view (it has the camera; this layer doesn't), not
  // for the whole time a zone stays ACTIVE. Walking past an open waypoint
  // and turning away must bring the guide back even though that zone
  // hasn't exited yet.
  function collectActiveWaypointPositions(): readonly Vector3[] {
    if (currentTour === null) return [];
    const positions: Vector3[] = [];
    for (const waypoint of currentTour.waypoints) {
      if (previousZones[waypoint.id] !== "ACTIVE") continue;
      const presenter = presenters.get(waypoint.id);
      if (presenter === undefined) continue;
      const position = adapter.getWorldPosition(presenter.handle);
      if (position !== null) positions.push(position);
    }
    return positions;
  }

  const unsubscribeStore = store.subscribe(onStoreChange);
  onStoreChange(); // adopt a tour that was already loaded before we attached

  return {
    setWayfindingEnabled(enabled: boolean): void {
      wayfindingEnabled = enabled;
    },

    tick(dtSeconds: number): void {
      if (disposed) return;
      driver.tick();
      sinceTrailUpdate += dtSeconds;
      if (sinceTrailUpdate >= TRAIL_UPDATE_INTERVAL_S) {
        sinceTrailUpdate = 0;
        updateTrail();
      }
      adapter.update(dtSeconds);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Ordered so that nothing can resurrect after it: audio, then the store
      // feed, then the in-flight loads (each presenter's generation bump makes
      // late results self-discard), then the scene, then the listeners.
      runStoryCommands(stopAll(story));
      unsubscribeStore();
      queue.drain();
      loader.invalidate(); // in-flight loads now free themselves on arrival
      for (const presenter of presenters.values()) presenter.dispose();
      presenters.clear();
      cache.clear(); // disposes templates AND releases their asset refs
      unsubscribeTap();
      unsubscribeAudioEnd();
      adapter.dispose();
      currentTour = null;
      previousZones = {};
    },

    debug: () => ({
      presenters: [...presenters.values()],
      cachedTemplates: cache.keys(),
      pendingParses: queue.pending,
      activeParses: queue.active,
      story,
    }),
  };
}
