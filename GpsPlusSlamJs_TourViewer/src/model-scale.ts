/**
 * A placed model's size rule, shared by every page that draws one (the
 * desktop editor's 3D view, the phone's AR): the factor that makes the
 * model's largest side the tour's `sizeM` metres. The format defines
 * "largest side" once (`tour-blocks.ts` in the framework): the
 * axis-aligned box of the model at rest, node transforms included, in the
 * model's own frame.
 *
 * @see model-scale.ts.md
 */
import * as THREE from "three";

const box = new THREE.Box3();
const part = new THREE.Box3();
const size = new THREE.Vector3();
const toModel = new THREE.Matrix4();
const partToModel = new THREE.Matrix4();

/**
 * The factor that makes `model`'s largest side `sizeM` metres: the
 * format's one rule, the axis-aligned box of the model at rest (its
 * geometries' own boxes), node transforms included, in the model's own
 * frame (wherever it is placed, its own transform left out). 1 for a model
 * with nothing to measure (no extent). RangeError for a size that is not
 * finite and > 0.
 */
export function modelScale(model: THREE.Object3D, sizeM: number): number {
  if (!(Number.isFinite(sizeM) && sizeM > 0)) {
    throw new RangeError(`a model's size must be finite and > 0, got ${sizeM}`);
  }
  model.updateMatrixWorld(true);
  toModel.copy(model.matrixWorld).invert();
  box.makeEmpty();
  model.traverse((o) => {
    const geometry = (o as THREE.Mesh).geometry as
      THREE.BufferGeometry | undefined;
    if (geometry === undefined) return;
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    if (geometry.boundingBox === null) return;
    partToModel.multiplyMatrices(toModel, o.matrixWorld);
    box.union(part.copy(geometry.boundingBox).applyMatrix4(partToModel));
  });
  if (box.isEmpty()) return 1;
  const largest = Math.max(...box.getSize(size).toArray());
  return largest > 0 && Number.isFinite(largest) ? sizeM / largest : 1;
}
