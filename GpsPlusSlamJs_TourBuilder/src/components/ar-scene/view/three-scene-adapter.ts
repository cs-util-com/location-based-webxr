/**
 * The one real `SceneAdapter` — Three.js on one side, the port on the other
 * (plan A20).
 *
 * This file is the orchestrator only: it owns the waypoint registry and
 * wires the sub-modules together, but every actual THREE-specific behavior
 * lives in its own module in this folder:
 *
 * - `waypoint-registry.ts` — the `WaypointNode` map, anchoring, teardown.
 * - `visual-instances.ts` — template parse/dispose, clone instantiate/release.
 * - `transcript.ts` — the in-world text panel (component 2).
 * - `audio-transport.ts` — the audio player + always-visible transport panel.
 * - `tap-picking.ts` — the raycast pick set and tap classification.
 * - `pick-classify.ts` — the `userData.arScene` stamp both sides share.
 * - `breadcrumb-orbs.ts` / `gltf-loading.ts` / `ray-sources.ts` — unchanged.
 *
 * Framework specifics are **injected** rather than imported: `createAnchor`,
 * `toWorld` and `getUserWorldPos` are the three seams where the framework's
 * GPS/alignment machinery would otherwise leak in. That is what lets the demo
 * run the very same adapter with an identity anchor factory on a desktop, with
 * no GPS zero reference and no alignment matrix in sight (plan A23).
 *
 * The transport panel deliberately deviates from A13/A14's tap-only design: it
 * is always visible alongside the visual (not shown only once a story starts),
 * for discoverability. A hit on it is classified with the "transport" role and
 * carries the panel-local `uv`; the runtime maps that through component 1's
 * `hitToAction` to tell a button tap (toggle, same as tapping the visual) from
 * a track tap (seek) instead of treating every hit on the panel as a toggle.
 */

import type { Object3D } from "three";
import { Vector3, type AudioListener, type PerspectiveCamera } from "three";

import type { TourCoord } from "../../../store/types.js";
import { computeBillboardYaw } from "../../shared/billboard-math.js";
import type {
  WayfindingTarget,
  SceneAdapter,
  TemplateHandle,
  VisualHandle,
  WaypointHandle,
} from "../runtime/scene-adapter.js";
import {
  BREADCRUMB_GUIDE_DISTANCE_MIN_M,
  BREADCRUMB_GUIDE_DISTANCE_MAX_M,
} from "../config.js";
import { parseTemplate } from "./gltf-loading.js";
import {
  createBreadcrumbOrbs,
  type BreadcrumbOrbs,
} from "./breadcrumb-orbs.js";
import {
  createBreadcrumbGuide,
  type BreadcrumbGuide,
} from "./breadcrumb-guide.js";
import type { TargetRayMatrixSource, XrSessionLike } from "./ray-sources.js";
import {
  createWaypointRegistry,
  type AnchorFactory,
  type SceneAnchor,
} from "./waypoint-registry.js";
import { createVisualInstances } from "./visual-instances.js";
import {
  disposeTranscript,
  hideTranscript,
  pageTranscript,
  showTranscript,
} from "./transcript.js";
import { createAudioTransport } from "./audio-transport.js";
import { createTapPicking } from "./tap-picking.js";

export type { SceneAnchor };

export interface ThreeSceneAdapterOptions {
  /** The `arWorldGroup` (or any world-space parent in replay mode). */
  readonly parent: Object3D;
  readonly camera: PerspectiveCamera;
  /** Must already be running — component 8 never unlocks it (plan A16). */
  readonly audioListener: AudioListener;
  /** Wraps `createGpsAnchor`; the demo injects an identity implementation. */
  readonly createAnchor: AnchorFactory;
  /** Geo → world without anchoring, for the trail window (plan A3). */
  readonly toWorld: (coord: TourCoord) => Vector3 | null;
  /** The visitor's live world-space pose, in the same frame as the anchors. */
  readonly getUserWorldPos: () => Vector3 | null;
  readonly orbPoolSize: number;
  /** Desktop tap source. Omit when an `xrSession` is given. */
  readonly domElement?: HTMLElement;
  readonly xrSession?: XrSessionLike;
  readonly getTargetRayMatrix?: TargetRayMatrixSource;
  /** Test seam; defaults to the real GLTF/texture parse. */
  readonly parse?: typeof parseTemplate;
}

export function createThreeSceneAdapter(
  options: ThreeSceneAdapterOptions,
): SceneAdapter {
  const registry = createWaypointRegistry(options.parent, options.createAnchor);
  const audioTransport = createAudioTransport(options.audioListener);
  const visuals = createVisualInstances(
    options.parse ?? parseTemplate,
    audioTransport.ensureTransportPanel,
  );
  const tapPicking = createTapPicking(options);

  const orbs: BreadcrumbOrbs = createBreadcrumbOrbs({
    parent: options.parent,
    poolSize: options.orbPoolSize,
    anchorFactory: (object3D, coord) => options.createAnchor(object3D, coord),
  });

  const breadcrumbGuide: BreadcrumbGuide = createBreadcrumbGuide({
    parent: options.parent,
    camera: options.camera,
    anchorFactory: (object3D, coord) => options.createAnchor(object3D, coord),
    distanceMinM: BREADCRUMB_GUIDE_DISTANCE_MIN_M,
    distanceMaxM: BREADCRUMB_GUIDE_DISTANCE_MAX_M,
  });

  return {
    createWaypointRoot(id: string, coord: TourCoord): WaypointHandle {
      return registry.create(id, coord);
    },

    destroyWaypointRoot(handle: WaypointHandle): void {
      registry.destroy(handle);
    },

    isAnchored(handle: WaypointHandle): boolean {
      return registry.isAnchored(handle);
    },

    getWorldPosition(handle: WaypointHandle): Vector3 | null {
      return registry.getWorldPosition(handle);
    },

    toWorldPositions(
      coords: readonly TourCoord[],
    ): readonly (Vector3 | null)[] {
      return coords.map((coord) => options.toWorld(coord));
    },

    getUserPosition(): Vector3 | null {
      return options.getUserWorldPos();
    },

    setOrbCoords(coords: readonly (TourCoord | null)[]): void {
      orbs.setCoords(coords);
    },

    setWayfindingTarget(target: WayfindingTarget | null): void {
      breadcrumbGuide.setTarget(target);
    },

    setActiveWaypointPositions(positions: readonly Vector3[]): void {
      breadcrumbGuide.setActiveWaypointPositions(positions);
    },

    buildTemplate(
      kind: "model" | "sprite",
      url: string,
    ): Promise<TemplateHandle> {
      return visuals.buildTemplate(kind, url);
    },

    disposeTemplate(template: TemplateHandle): void {
      visuals.disposeTemplate(template);
    },

    instantiate(
      handle: WaypointHandle,
      template: TemplateHandle,
      hasAudio = true,
    ): VisualHandle {
      return visuals.instantiate(
        registry.get(handle.waypointId),
        handle,
        template,
        hasAudio,
      );
    },

    buildFallbackVisual(
      handle: WaypointHandle,
      hasAudio = true,
      showMarker = true,
    ): VisualHandle {
      return visuals.buildFallbackVisual(
        registry.get(handle.waypointId),
        handle,
        hasAudio,
        showMarker,
      );
    },

    releaseVisual(visual: VisualHandle): void {
      visuals.releaseVisual(visual);
    },

    setVisible(visual: VisualHandle, isVisible: boolean): void {
      visuals.setVisible(visual, isVisible);
    },

    showTranscript(
      handle: WaypointHandle,
      text: string,
      centered = false,
    ): void {
      const node = registry.get(handle.waypointId);
      if (node === undefined) return;
      showTranscript(node, text, centered);
    },

    hideTranscript(handle: WaypointHandle): void {
      const node = registry.get(handle.waypointId);
      if (node !== undefined) hideTranscript(node);
    },

    disposeTranscript(handle: WaypointHandle): void {
      const node = registry.get(handle.waypointId);
      if (node !== undefined) disposeTranscript(node);
    },

    pageTranscript(
      handle: WaypointHandle,
      uv?: { readonly u: number; readonly v: number },
    ): void {
      const node = registry.get(handle.waypointId);
      if (node !== undefined) pageTranscript(node, uv);
    },

    playAudio(handle: WaypointHandle, url: string): void {
      const node = registry.get(handle.waypointId);
      if (node === undefined) return;
      audioTransport.playAudio(node, url);
    },

    pauseAudio(): void {
      audioTransport.pauseAudio();
    },

    resumeAudio(): void {
      audioTransport.resumeAudio();
    },

    stopAudio(): void {
      audioTransport.stopAudio();
    },

    seekAudio(handle: WaypointHandle, fraction: number): void {
      const node = registry.get(handle.waypointId);
      if (node === undefined) return;
      audioTransport.seekAudio(node, fraction);
    },

    isAudioReady(): boolean {
      return audioTransport.isAudioReady();
    },

    setPickTargets(handles: readonly WaypointHandle[]): void {
      tapPicking.setPickTargets(
        handles.map((handle) => registry.get(handle.waypointId)),
      );
    },

    onTap(listener) {
      return tapPicking.onTap(listener);
    },

    onAudioEnded(listener: () => void): () => void {
      return audioTransport.onAudioEnded(listener);
    },

    update(dtSeconds: number): void {
      const cameraPos = options.camera.getWorldPosition(new Vector3());
      for (const node of registry.values()) {
        // Cylindrical billboarding: yaw only, never pitch or roll (component 1).
        // The text is a child of this same group at a fixed local offset, so
        // this one yaw already faces it correctly too — `InWorldText.faceCamera`
        // expects a *world* position, but the text's `group.position` here is its
        // local offset inside `node.group` (contract A14), so calling it would
        // apply a second, wrong rotation on top of this one and turn the panel
        // away from the camera instead of leaving it aligned with its parent.
        //
        // The yaw is written to a LOCAL rotation, so it must be solved in the
        // parent's frame: on a phone the parent (`arWorldGroup`) carries the
        // alignment matrix's arbitrary heading, and a yaw solved from world
        // positions would be rotated by that heading again on screen.
        const parent = node.group.parent ?? options.parent;
        node.group.rotation.y = computeBillboardYaw(
          node.group.position,
          parent.worldToLocal(cameraPos.clone()),
          node.group.rotation.y,
        );
      }
      orbs.update(dtSeconds);
      breadcrumbGuide.update(dtSeconds);
    },

    dispose(): void {
      tapPicking.dispose();
      orbs.dispose();
      breadcrumbGuide.dispose();
      for (const node of registry.values()) {
        node.text?.dispose();
        node.audio?.dispose();
        node.anchor.dispose();
        node.group.removeFromParent();
      }
      registry.clear();
      visuals.disposeAllTemplates();
      audioTransport.dispose();
    },
  };
}
