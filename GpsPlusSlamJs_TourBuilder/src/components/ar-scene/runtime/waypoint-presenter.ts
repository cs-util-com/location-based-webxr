/**
 * One waypoint's presenter — the anchored root plus whatever heavy children its
 * zone currently justifies (plan A5).
 *
 * The root and its GPS anchor are created at tour load and live for the whole
 * tour: the proximity driver needs a stable world position for a waypoint even
 * while it is IDLE, since that is how it ever leaves IDLE. Only the expensive
 * parts follow the zone — the cloned visual, the transcript panel, the audio ref.
 *
 * All async safety lives in the pure `core/visual-lifecycle` machine; this file
 * executes its intents and owns the two ref-counted resources: the model asset
 * (held by the LRU entry, released on eviction — A9) and the audio asset (held
 * from first tap until the waypoint goes IDLE — A17).
 *
 * @see plans/2026-07-31-ar-scene-plan.md §5
 */

import type { AssetProvider, Waypoint, AssetId } from "../../../store/types.js";
import { selectWaypointVisual } from "../../../store/selectors.js";
import type { TemplateLoader } from "./template-loader.js";
import {
  initialLifecycleState,
  onBuild,
  onHide,
  onLoadFailed,
  onLoadResolved,
  onShow,
  onTeardown,
  type LifecycleIntent,
  type LifecycleResult,
  type VisualLifecycleState,
} from "../core/visual-lifecycle.js";
import type {
  SceneAdapter,
  VisualHandle,
  WaypointHandle,
} from "./scene-adapter.js";

export interface PresenterDeps {
  readonly waypoint: Waypoint;
  readonly adapter: SceneAdapter;
  readonly assetProvider: AssetProvider;
  /** Shared across presenters — the same asset id on two waypoints parses once. */
  readonly loader: TemplateLoader;
  readonly onVisited: (waypointId: string) => void;
  readonly log: (message: string) => void;
}

export interface WaypointPresenter {
  readonly id: string;
  readonly handle: WaypointHandle;
  /** Ready for proximity evaluation (anchor out of bootstrap, A19). */
  isAnchored(): boolean;
  build(): void;
  show(): void;
  hide(): void;
  teardown(): void;
  /** Fetch (once) and start this waypoint's story. */
  startStory(): void;
  showTranscript(): void;
  hideTranscript(): void;
  pageTranscript(uv?: { readonly u: number; readonly v: number }): void;
  /** Introspection for the demo HUD and the e2e assertions. */
  debugState(): VisualLifecycleState;
  dispose(): void;
}

export function createWaypointPresenter(
  deps: PresenterDeps,
): WaypointPresenter {
  const { waypoint, adapter, assetProvider, loader } = deps;
  const handle = adapter.createWaypointRoot(waypoint.id, waypoint.position);
  const visual = selectWaypointVisual(waypoint);
  const hasAudio = waypoint.content.audio !== undefined;
  const hasTranscript =
    waypoint.content.transcript !== undefined &&
    waypoint.content.transcript !== "";
  /** Breadcrumb-only stop with something to say: the transcript takes the
   *  visual's own slot instead of a placeholder cone sitting beside it. */
  const useTranscriptAsVisual = visual === null && hasTranscript;

  let state = initialLifecycleState();
  let instance: VisualHandle | null = null;
  /** The asset id whose LRU reference this presenter currently holds. */
  let heldModelAsset: AssetId | null = null;
  /** The audio id whose provider reference this presenter currently holds. */
  let heldAudioAsset: AssetId | null = null;
  let audioUrl: string | null = null;
  let transcriptShown = false;

  const apply = (result: LifecycleResult): void => {
    state = result.state;
    for (const intent of result.intents) execute(intent);
  };

  /** Shown as soon as the waypoint is visible — not gated by tap/story state
   *  (the transcript reads at a glance, no interaction required). */
  function showTranscript(): void {
    const text = waypoint.content.transcript;
    if (text === undefined || text === "") return;
    adapter.showTranscript(handle, text, useTranscriptAsVisual);
    transcriptShown = true;
  }

  function hideTranscript(): void {
    if (!transcriptShown) return;
    adapter.hideTranscript(handle);
    transcriptShown = false;
  }

  function execute(intent: LifecycleIntent): void {
    switch (intent.kind) {
      case "startLoad":
        startLoad(intent.generation);
        break;
      case "attach":
        // The template reference was taken by `startLoad`; instantiating is the
        // cheap half — a clone that shares the template's geometry/material.
        break;
      case "discard":
        // Landed after the visitor left: give back the template reference so the
        // cache can evict it (which is what releases the blob, A9).
        releaseModelRef();
        break;
      case "fallback":
        // A breadcrumb-only stop with a transcript shows the text in the
        // visual's own slot instead of beside a marker cone — still builds
        // the transport panel below it when there's audio to play.
        instance = adapter.buildFallbackVisual(
          handle,
          hasAudio,
          !useTranscriptAsVisual,
        );
        break;
      case "show":
        if (instance !== null) adapter.setVisible(instance, true);
        showTranscript();
        deps.onVisited(waypoint.id);
        break;
      case "hide":
        if (instance !== null) adapter.setVisible(instance, false);
        hideTranscript();
        break;
      case "teardown":
        tearDownChildren();
        break;
    }
  }

  /** Give back the LRU reference this presenter holds, if any. */
  function releaseModelRef(): void {
    if (heldModelAsset === null) return;
    loader.release(heldModelAsset);
    heldModelAsset = null;
  }

  function tearDownChildren(): void {
    if (instance !== null) {
      adapter.releaseVisual(instance); // drops the clone only — never the template
      instance = null;
    }
    releaseModelRef();
    if (heldAudioAsset !== null) {
      assetProvider.release(heldAudioAsset);
      heldAudioAsset = null;
      audioUrl = null;
    }
    adapter.disposeTranscript(handle);
    transcriptShown = false;
  }

  /**
   * Ask the shared loader for this waypoint's template. Everything that can go
   * wrong routes into `onLoadFailed` (soft-fail, contract D14b); the loader owns
   * the ref-count bookkeeping, so the only rule here is that a resolved acquire
   * is always matched by a `releaseModelRef()` — including when it lands too
   * late and the lifecycle answers `discard`.
   */
  function startLoad(generation: number): void {
    if (visual === null) {
      // A breadcrumb-only stop: nothing to load, but it still anchors, still
      // drives proximity, and still counts as visited.
      apply(onLoadFailed(state, generation));
      return;
    }
    const assetId = visual.assetId;

    void loader
      .acquire(assetId, visual.kind)
      .then((template) => {
        heldModelAsset = assetId;
        // Instantiate BEFORE consulting the lifecycle: a stale generation makes
        // the next line emit `discard`, which releases the reference we just took.
        const attached = adapter.instantiate(handle, template, hasAudio);
        const result = onLoadResolved(state, generation);
        if (result.intents.some((i) => i.kind === "discard")) {
          adapter.releaseVisual(attached);
        } else {
          instance = attached;
        }
        apply(result);
      })
      .catch((error: unknown) => {
        deps.log(
          `waypoint ${waypoint.id}: asset ${assetId} unavailable (${String(error)})`,
        );
        apply(onLoadFailed(state, generation));
      });
  }

  return {
    id: waypoint.id,
    handle,

    isAnchored: () => adapter.isAnchored(handle),
    build: () => {
      apply(onBuild(state));
    },
    show: () => {
      apply(onShow(state));
    },
    hide: () => {
      apply(onHide(state));
    },
    teardown: () => {
      apply(onTeardown(state));
    },

    startStory(): void {
      const audioId = waypoint.content.audio;
      if (audioId === undefined) return;
      if (audioUrl !== null) {
        adapter.playAudio(handle, audioUrl);
        return;
      }
      void assetProvider
        .getAssetUrl(audioId)
        .then((url) => {
          heldAudioAsset = audioId;
          audioUrl = url;
          adapter.playAudio(handle, url);
        })
        .catch((error: unknown) => {
          deps.log(
            `waypoint ${waypoint.id}: story audio ${audioId} unavailable (${String(error)})`,
          );
        });
    },

    showTranscript,
    hideTranscript,

    pageTranscript(uv?: { readonly u: number; readonly v: number }): void {
      if (transcriptShown) adapter.pageTranscript(handle, uv);
    },

    debugState: () => state,

    dispose(): void {
      apply(onTeardown(state));
      adapter.destroyWaypointRoot(handle);
    },
  };
}
