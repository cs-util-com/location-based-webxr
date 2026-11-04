/**
 * The editor's interface on the globe drawn after the air: the stations'
 * billboards, found-radius rings and poles, the gizmo, the arrival's
 * marks and the model's section planes. The clouds' shadow and the haze
 * are composited over the whole frame after the scene (the shadow's rays
 * end at the relief's depth, behind these objects), so drawn in the scene
 * they were darkened like the ground. Lifted out of the scene's pass onto
 * their own layer each frame, drawn again after the air, and put back,
 * they stay as bright as without clouds; the ground and the tour's models
 * stay in the scene and take the shadow.
 *
 * @see globe-interface-pass.ts.md
 */
import * as THREE from "three";

export const GLOBE_INTERFACE = Object.freeze({
  /** The layer the interface is drawn on, after the air. */
  layer: 1,
  /**
   * Objects drawn as the interface with everything under them, by name:
   * the found radius's ring, the pole up to a billboard, a code's square,
   * the arrival's marks and the model's section planes.
   */
  names: Object.freeze([
    "found-radius",
    "pole",
    "code",
    "approach-marks",
    "model-sections",
  ]),
});

const NAMED: ReadonlySet<string> = new Set(GLOBE_INTERFACE.names);

/** Whether a material (or each of a list) is drawn without a depth test. */
function overlay(material: THREE.Material | THREE.Material[]): boolean {
  return Array.isArray(material)
    ? material.length > 0 && material.every((m) => !m.depthTest)
    : !material.depthTest;
}

/**
 * Whether an object is the interface by itself: a sprite (a billboard, a
 * label, a handle) or a mesh or line drawn over everything (no depth
 * test: the gizmo's parts). A named root (`GLOBE_INTERFACE.names`) carries
 * everything under it.
 */
export function isInterfacePart(object: THREE.Object3D): boolean {
  if (object instanceof THREE.Sprite) return true;
  if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
    return overlay(object.material as THREE.Material | THREE.Material[]);
  }
  return false;
}

export interface GlobeInterfacePass {
  /** Before the scene draws: the interface under `roots` onto its layer. */
  lift(): void;
  /** After the air: the lifted interface drawn over the frame, then put
   *  back on its own layers (the hit tests read them between frames). */
  draw(): void;
  /** How many objects the last frame lifted (the page's checks). */
  lifted(): number;
}

/**
 * The pass over the objects under `roots()` (walked each frame, visible
 * ones only; no allocation per frame). `lights` are enabled on the
 * interface's layer too, so a lit part (the pole) is not drawn black.
 */
export function createGlobeInterfacePass(deps: {
  readonly renderer: Pick<THREE.WebGLRenderer, "render">;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly roots: () => readonly THREE.Object3D[];
  readonly lights: readonly THREE.Object3D[];
}): GlobeInterfacePass {
  const { renderer, scene, camera, roots, lights } = deps;
  const { layer } = GLOBE_INTERFACE;
  for (const light of lights) light.layers.enable(layer);
  const objects: THREE.Object3D[] = [];
  const masks: number[] = [];
  let count = 0;

  const take = (o: THREE.Object3D) => {
    objects.push(o);
    masks.push(o.layers.mask);
    o.layers.set(layer);
  };
  const takeAll = (o: THREE.Object3D) => {
    if (!o.visible) return;
    take(o);
    for (const child of o.children) takeAll(child);
  };
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    if (NAMED.has(o.name)) {
      takeAll(o);
      return;
    }
    if (isInterfacePart(o)) take(o);
    for (const child of o.children) walk(child);
  };
  /** Every lifted object back on its own layers. */
  const putBack = () => {
    for (let i = 0; i < objects.length; i++) {
      objects[i]!.layers.mask = masks[i]!;
    }
    objects.length = 0;
    masks.length = 0;
  };

  return {
    lift() {
      // A frame that threw before its draw left objects lifted.
      putBack();
      for (const root of roots()) walk(root);
      count = objects.length;
    },
    draw() {
      if (objects.length === 0) return;
      const cameraMask = camera.layers.mask;
      // The scene's matrices were updated by its own pass this frame.
      const sceneAuto = scene.matrixWorldAutoUpdate;
      const background = scene.background;
      camera.layers.set(layer);
      scene.matrixWorldAutoUpdate = false;
      scene.background = null;
      try {
        renderer.render(scene, camera);
      } finally {
        camera.layers.mask = cameraMask;
        scene.matrixWorldAutoUpdate = sceneAuto;
        scene.background = background;
        putBack();
      }
    },
    lifted: () => count,
  };
}
