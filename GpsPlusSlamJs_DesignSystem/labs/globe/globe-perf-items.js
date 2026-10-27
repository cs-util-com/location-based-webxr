/**
 * The fixed-view sweep's editor-style items (`globe-perf-views.js`): what a
 * tour editor draws per station, built the way it builds them (a pole, a
 * ground ring, a label sprite, a sign face and its back, each with its own
 * geometry, material and canvas texture), standing on the drawn ground on
 * the globe's Earth-centred group, so a frame recentre moves nothing.
 * Loaded by `globe-lab.js` only with `#perf=1`.
 *
 * @see globe-perf-items.js.md
 */
import * as THREE from "three";

import { worldFromEcefAt } from "/globe/globe-frame.js";

/** The items' sizes (m), close to the editor's station marks. */
export const PERF_ITEM = Object.freeze({
  poleM: 2,
  poleRadiusM: 0.06,
  ringM: 1.2,
  signM: 0.8,
  labelM: 1.6,
});

const DEG = Math.PI / 180;
/** The metres a degree of latitude (a sphere's: the offsets are metres). */
const M_PER_DEG = 111_320;

/** A canvas texture with `text` on it, as the editor's labels are drawn. */
function textTexture(text, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  g.fillStyle = "rgba(20, 28, 40, 0.85)";
  g.fillRect(0, 0, width, height);
  g.fillStyle = "#fff";
  g.font = `600 ${Math.round(height * 0.45)}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** One station-like item in its own east-up-south frame, its foot at 0. */
function buildItem(index) {
  const item = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(
      PERF_ITEM.poleRadiusM,
      PERF_ITEM.poleRadiusM,
      PERF_ITEM.poleM,
      8,
    ).translate(0, PERF_ITEM.poleM / 2, 0),
    new THREE.MeshLambertMaterial({ color: 0xd8dde3 }),
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(PERF_ITEM.ringM - 0.12, PERF_ITEM.ringM, 96)
      .rotateX(-Math.PI / 2)
      .translate(0, 0.05, 0),
    new THREE.MeshBasicMaterial({
      color: 0x3aa0ff,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    }),
  );
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: textTexture(`Station ${index + 1}`, 256, 64),
      depthTest: false,
    }),
  );
  label.scale.set(PERF_ITEM.labelM, PERF_ITEM.labelM / 4, 1);
  label.position.set(0, PERF_ITEM.poleM + 0.6, 0);
  const faceTexture = textTexture(String(index + 1), 128, 128);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(PERF_ITEM.signM, PERF_ITEM.signM),
    new THREE.MeshBasicMaterial({ map: faceTexture }),
  );
  face.position.set(0, PERF_ITEM.poleM - PERF_ITEM.signM / 2, 0.07);
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(PERF_ITEM.signM, PERF_ITEM.signM).rotateY(Math.PI),
    new THREE.MeshLambertMaterial({ color: 0x8b8e93 }),
  );
  back.position.copy(face.position).setZ(0.069);
  item.add(pole, ring, label, face, back);
  return item;
}

/**
 * The items' holder. `parent` the globe's Earth-centred group (its world
 * matrix is the frame), `ellipsoid` the globe's, `groundM(place)` the drawn
 * ground's height over the ellipsoid at a place, `eyeItems` the lab's map
 * of items the eye camera's near plane follows (the items are registered
 * there, as an editor's would be). Returns `{ set(offsets, place), count }`:
 * `set` replaces every item by one per offset (metres east and north of
 * `place`), each standing on the ground there; `[]` removes them all.
 */
export function createPerfItems({ parent, ellipsoid, groundM, eyeItems }) {
  const root = new THREE.Group();
  root.name = "globe-perf-items";
  parent.add(root);
  const local = new THREE.Matrix4();
  const keys = [];
  const dispose = () => {
    for (const item of root.children) {
      item.traverse((o) => {
        o.geometry?.dispose();
        o.material?.map?.dispose();
        o.material?.dispose();
      });
    }
    root.clear();
    for (const key of keys) eyeItems.delete(key);
    keys.length = 0;
  };
  return {
    set(offsets, place) {
      dispose();
      offsets.forEach(({ eastM, northM }, k) => {
        const at = {
          lat: place.lat + northM / M_PER_DEG,
          lng:
            place.lng +
            eastM / (M_PER_DEG * Math.max(Math.cos(place.lat * DEG), 0.01)),
        };
        const item = buildItem(k);
        item.matrixAutoUpdate = false;
        // The item's own east-up-south frame into ECEF, up to the ground.
        worldFromEcefAt(ellipsoid, at, local).invert();
        item.matrix
          .copy(local)
          .multiply(new THREE.Matrix4().makeTranslation(0, groundM(at), 0));
        root.add(item);
      });
      // Through the frame the parent holds now (its last frame's matrix).
      root.updateMatrixWorld(true);
      root.children.forEach((item, k) => {
        const key = `perf-item-${k}`;
        keys.push(key);
        const centre = new THREE.Vector3(0, PERF_ITEM.poleM / 2, 0);
        eyeItems.set(key, {
          mesh: item,
          sphere: new THREE.Sphere(
            centre.applyMatrix4(item.matrixWorld),
            PERF_ITEM.ringM,
          ),
        });
      });
    },
    get count() {
      return root.children.length;
    },
    /**
     * Where item `k` stands for `camera` now: `{ inView, footOverGroundM }`
     * (`inView` its pole's middle inside the camera's frustum; the foot's
     * height over `groundM` at its place, negative when the drawn ground
     * rose over it), or null without that item. For the smokes.
     */
    probe(k, camera, groundOf) {
      const item = root.children[k];
      if (!item) return null;
      root.updateMatrixWorld(true);
      camera.updateMatrixWorld();
      const middle = new THREE.Vector3(0, PERF_ITEM.poleM / 2, 0).applyMatrix4(
        item.matrixWorld,
      );
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(
          camera.projectionMatrix,
          camera.matrixWorldInverse,
        ),
      );
      // The foot in the parent's Earth-centred frame (the root is at its
      // identity there), then over the ellipsoid.
      const foot = new THREE.Vector3().applyMatrix4(item.matrix);
      const at = ellipsoid.getPositionToCartographic(foot, {});
      const place = { lat: at.lat / DEG, lng: at.lon / DEG };
      return {
        inView: frustum.containsPoint(middle),
        footOverGroundM: at.height - groundOf(place),
      };
    },
  };
}
