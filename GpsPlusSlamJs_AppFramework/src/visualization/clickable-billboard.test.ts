import { describe, expect, it, vi } from 'vitest';
import {
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Texture,
  Vector3,
  type AudioListener,
  type PositionalAudio,
} from 'three';

import { INITIAL, type TransportState } from './playback-transport.js';
import {
  createClickableBillboard,
  type BillboardUserData,
} from './clickable-billboard.js';

/**
 * Pins the pick-target policy: an invisible panel must never be raycast.
 * three's raycaster does NOT skip `visible = false` meshes, so if a hidden
 * panel stayed in the target set, a click at its screen position would resolve
 * to a toggle/seek against whichever clip is active — or swallow a legitimate
 * sprite click behind it. The billboard owns this decision so no caller can
 * get it wrong. Player + panel canvas are mocked (WebAudio/2D-canvas are
 * browser-only); the reconcile decision itself is core-tested.
 */

vi.mock('./audio-player.js', () => ({
  createAudioPlayer: (): unknown => ({
    spatialNode: new Object3D() as PositionalAudio,
    play: vi.fn(),
    pause: vi.fn(),
    seekToSeconds: vi.fn(),
    currentTime: 0,
    paused: true,
    dispose: vi.fn(),
  }),
}));

vi.mock('./transport-panel-view.js', () => ({
  createTransportPanel: (): unknown => ({
    mesh: new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial()),
    redraw: vi.fn(),
    dispose: vi.fn(),
  }),
}));

function makeBillboard(id = 'bb-1') {
  return createClickableBillboard({
    id,
    position: new Vector3(),
    texture: new Texture(),
    audio: {} as HTMLAudioElement,
    listener: {} as AudioListener,
    onTick: vi.fn(),
    onEnded: vi.fn(),
  });
}

const activeState = (id: string): TransportState => ({
  activeId: id,
  status: 'playing',
  positionSec: 0,
  durationSec: 10,
});

const rolesOf = (targets: readonly Mesh[]): (string | undefined)[] =>
  targets.map((m) => (m.userData as Partial<BillboardUserData>).role);

describe('createClickableBillboard — pick-target policy', () => {
  it('excludes the hidden panel initially (only the sprite is pickable)', () => {
    const bb = makeBillboard();
    expect(rolesOf(bb.getPickTargets())).toEqual(['sprite']);
  });

  it('includes the panel while this billboard is the active one', () => {
    const bb = makeBillboard('bb-1');
    bb.applyState(activeState('bb-1'));
    expect(rolesOf(bb.getPickTargets())).toEqual(['sprite', 'panel']);
  });

  it('drops the panel again when another billboard becomes active', () => {
    const bb = makeBillboard('bb-1');
    bb.applyState(activeState('bb-1'));
    bb.applyState(activeState('bb-2'));
    expect(rolesOf(bb.getPickTargets())).toEqual(['sprite']);
  });

  it('drops the panel on reset to idle', () => {
    const bb = makeBillboard('bb-1');
    bb.applyState(activeState('bb-1'));
    bb.applyState(INITIAL);
    expect(rolesOf(bb.getPickTargets())).toEqual(['sprite']);
  });
});
