/**
 * The caster-mode order table: every order of AR start / stop, suspend /
 * resume and rebuild, with a shadow check and the city setting on and off.
 *
 * Why this file matters: an app has several writers of the shadow flags
 * (the AR session, a shadow check, the city setting, a rebuild). A stored
 * mode lets the last writer win, so an AR dispose after a resume wiped the
 * city's casters. Here the view model keeps only HELD INPUTS and, after
 * every event, derives the mode and writes both flags on every mesh; the
 * test asserts the flags after each step equal what the table says for the
 * derived mode, whatever the order.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { applyShadowCasting, type ShadowLayerTable } from './shadow-casting.js';
import {
  castingMode,
  layerShadowFlags,
  type CastingInputs,
  type ShadowTier,
} from './two-map-shadow-rig.js';

const on = { cast: true, receive: true };
const recv = { cast: false, receive: true };
const none = { cast: false, receive: false };

const TABLE: ShadowLayerTable = {
  rows: {
    buildings: { off: none, ar: on, city: on },
    ground: { off: recv, ar: recv, city: recv },
    heat: { off: none, ar: none, city: none },
  },
  fallback: { off: none, ar: none, city: recv },
  layerOf: (mesh) => mesh.userData['layer'] as string | undefined,
};

type Event = 'arStart' | 'arStop' | 'suspend' | 'resume' | 'rebuild';

/** A view that holds inputs only, as the apps do. */
class ViewModel {
  readonly root = new THREE.Group();
  private arSession = false;
  private suspended = false;
  constructor(
    private readonly shadowCheck: boolean,
    private readonly cityTier: ShadowTier
  ) {
    this.rebuild();
  }

  inputs(): CastingInputs {
    return {
      arCasting: this.arSession || this.shadowCheck,
      suspended: this.suspended,
      cityTier: this.cityTier,
    };
  }

  apply(event: Event): void {
    if (event === 'arStart') {
      this.arSession = true;
      this.suspended = true;
    } else if (event === 'arStop') {
      this.arSession = false;
    } else if (event === 'suspend') {
      this.suspended = true;
    } else if (event === 'resume') {
      this.suspended = false;
    } else {
      this.rebuild();
    }
    applyShadowCasting(this.root, castingMode(this.inputs()), TABLE);
  }

  private rebuild(): void {
    this.root.clear();
    for (const layer of ['buildings', 'ground', 'heat', undefined]) {
      const mesh = new THREE.Mesh();
      // A fresh mesh carries arbitrary flags until the writer runs.
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (layer !== undefined) mesh.userData['layer'] = layer;
      this.root.add(mesh);
    }
    applyShadowCasting(this.root, castingMode(this.inputs()), TABLE);
  }
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
      item,
      ...rest,
    ])
  );
}

/** Every mesh whose flags differ from the table row for the derived mode. */
function wrongFlags(view: ViewModel, step: string): string[] {
  const mode = castingMode(view.inputs());
  const wrong: string[] = [];
  view.root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const want = layerShadowFlags(TABLE, mode, TABLE.layerOf(object));
    if (
      object.castShadow !== want.cast ||
      object.receiveShadow !== want.receive
    ) {
      wrong.push(`${step}: ${String(object.userData['layer'])} in ${mode}`);
    }
  });
  return wrong;
}

describe('applyShadowCasting through castingMode, in every order', () => {
  const EVENTS: Event[] = ['arStart', 'suspend', 'resume', 'arStop', 'rebuild'];
  for (const shadowCheck of [false, true]) {
    for (const cityTier of ['off', 'high'] as const) {
      it(`leaves the derived flags after every step (check ${shadowCheck}, city ${cityTier})`, () => {
        const wrong: string[] = [];
        for (const order of permutations(EVENTS)) {
          const view = new ViewModel(shadowCheck, cityTier);
          for (const [i, event] of order.entries()) {
            view.apply(event);
            wrong.push(...wrongFlags(view, order.slice(0, i + 1).join('>')));
          }
        }
        expect(wrong).toEqual([]);
      });
    }
  }

  // The order that broke a stored mode: resume the city, then the AR
  // session's dispose arrives last. City shadows must stay on.
  it('keeps city shadows after "resume, then AR dispose"', () => {
    const view = new ViewModel(false, 'high');
    view.apply('arStart');
    view.apply('resume');
    view.apply('arStop');
    expect(castingMode(view.inputs())).toBe('city');
    const buildings = view.root.children[0]!;
    expect(buildings.castShadow).toBe(true);
  });
});

describe('applyShadowCasting', () => {
  it('writes both flags on every mesh, instanced ones and the root included', () => {
    const root = new THREE.Mesh();
    root.userData['layer'] = 'buildings';
    const inst = new THREE.InstancedMesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
      1
    );
    inst.castShadow = true;
    inst.receiveShadow = false;
    const group = new THREE.Group();
    group.add(inst);
    root.add(group);
    expect(applyShadowCasting(root, 'city', TABLE)).toBe(2);
    expect([root.castShadow, root.receiveShadow]).toEqual([true, true]);
    expect([inst.castShadow, inst.receiveShadow]).toEqual([false, true]);
    // A mode switch leaves no stale flag.
    applyShadowCasting(root, 'off', TABLE);
    expect([root.castShadow, root.receiveShadow]).toEqual([false, false]);
    expect([inst.castShadow, inst.receiveShadow]).toEqual([false, false]);
    expect(group.castShadow).toBe(false);
  });

  it('refuses an unknown mode', () => {
    expect(() =>
      applyShadowCasting(new THREE.Group(), 'sun' as never, TABLE)
    ).toThrow(RangeError);
  });
});
