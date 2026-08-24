/**
 * The clickable cylindrical billboard (view layer / composition unit).
 *
 * Composes the pure pieces into one Three.js object: a textured sprite plane
 * plus the in-world transport panel below it, both yawing to face the user
 * (billboard math), with an audio element driven by the transport reducer.
 *
 * It is fed ready resources (a loaded `THREE.Texture`, an `HTMLAudioElement`,
 * and the shared `THREE.AudioListener`) — the demo/app owns loading — which is
 * exactly the seam component 8 reuses, swapping the plane for a GLTF model and
 * the element for an asset-provider URL. Audio is spatialized: the player's
 * `PositionalAudio` node is added to the group, so each clip is panned and
 * attenuated from this billboard's world position.
 *
 * `applyState` is this billboard's slice of the reconcile step: the *decision*
 * (seek-vs-leave-alone epsilon, play/pause diffing) is the pure, unit-tested
 * `reconcilePlayer` in core; this layer only executes the returned commands on
 * the panel and player. `faceCamera` runs every frame from the render loop.
 */
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type AudioListener,
  type Texture,
  type Vector3,
} from 'three';
import { disposeObject3D } from './three-dispose.js';

import { computeBillboardYaw, type HorizontalPoint } from './billboard-math.js';
import { createAudioPlayer } from './audio-player.js';
import { createTransportPanel } from './transport-panel-view.js';
import type { TransportState } from './playback-transport.js';
import { reconcilePlayer } from './transport-reconcile.js';

/** Stamped onto each pickable mesh so the raycaster can classify a hit. */
export interface BillboardUserData {
  readonly billboardId: string;
  readonly role: 'sprite' | 'panel';
}

export interface ClickableBillboard {
  readonly id: string;
  readonly group: Group;
  /**
   * Meshes the raycaster should test *right now*: the sprite always, the panel
   * only while it is shown. The raycaster does not skip invisible meshes, so
   * a hidden panel in the target set would soak up taps meant for whatever is
   * behind it — this accessor owns that decision so no caller has to.
   */
  getPickTargets(): readonly Mesh[];
  faceCamera(cameraWorldPosition: HorizontalPoint): void;
  applyState(state: TransportState): void;
  dispose(): void;
}

const SPRITE_SIZE = 1;
const PANEL_WIDTH = 1.15;
const PANEL_HEIGHT = 0.4;
const PANEL_Y_OFFSET = -0.9;

export function createClickableBillboard(options: {
  readonly id: string;
  readonly position: Vector3;
  readonly texture: Texture;
  readonly audio: HTMLAudioElement;
  readonly listener: AudioListener;
  readonly onTick: (
    id: string,
    positionSec: number,
    durationSec: number
  ) => void;
  readonly onEnded: (id: string) => void;
}): ClickableBillboard {
  const { id } = options;
  const group = new Group();
  group.position.copy(options.position);

  const spriteMesh = new Mesh(
    new PlaneGeometry(SPRITE_SIZE, SPRITE_SIZE),
    new MeshBasicMaterial({ map: options.texture, transparent: true })
  );
  spriteMesh.userData = {
    billboardId: id,
    role: 'sprite',
  } satisfies BillboardUserData;

  const panel = createTransportPanel(PANEL_WIDTH, PANEL_HEIGHT);
  panel.mesh.position.set(0, PANEL_Y_OFFSET, 0);
  panel.mesh.visible = false; // only shown for the active billboard
  panel.mesh.userData = {
    billboardId: id,
    role: 'panel',
  } satisfies BillboardUserData;

  const player = createAudioPlayer(options.audio, options.listener, {
    onTick: (positionSec, durationSec) =>
      options.onTick(id, positionSec, durationSec),
    onEnded: () => options.onEnded(id),
  });

  // The panner sits at the group origin (the billboard's world position), so
  // audio emanates from the marker as the camera orbits.
  group.add(spriteMesh, panel.mesh, player.spatialNode);

  function faceCamera(cameraWorldPosition: HorizontalPoint): void {
    // Yaw the whole group: the panel sits on the group's Y axis, so a Y
    // rotation keeps it directly below the sprite while both face the camera.
    group.rotation.set(
      0,
      computeBillboardYaw(group.position, cameraWorldPosition),
      0
    );
  }

  function applyState(state: TransportState): void {
    // The player object satisfies `PlayerSnapshot` structurally (its
    // `currentTime` / `paused` getters read the element live).
    const commands = reconcilePlayer(state, id, player);
    panel.mesh.visible = commands.panelVisible;
    if (commands.panelVisible) {
      panel.redraw(state, id);
    }
    if (commands.seekToSec !== null) {
      player.seekToSeconds(commands.seekToSec);
    }
    if (commands.playback === 'play') {
      player.play();
    } else if (commands.playback === 'pause') {
      player.pause();
    }
  }

  return {
    id,
    group,
    getPickTargets: () =>
      panel.mesh.visible ? [spriteMesh, panel.mesh] : [spriteMesh],
    faceCamera,
    applyState,
    dispose(): void {
      player.dispose();
      // Sprite GPU resources via the framework util; the panel owns its own
      // canvas-texture disposal.
      disposeObject3D(spriteMesh);
      panel.dispose();
    },
  };
}
