/**
 * The travelling box's flight quad: the words texture drawn in screen
 * space while it flies between the plate and the dock or sits docked.
 * Each corner carries a clip-space position, so a corner flying from the
 * plate's projected corner to the dock's keeps the texture mapped in
 * perspective all the way. One mesh of the scene, drawn last over
 * everything (no second pass): the clip-space shader ignores the camera,
 * the XR eye's included.
 *
 * @see travelling-box-quad.ts.md
 */
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  ShaderMaterial,
  type Camera,
  type Texture,
} from "three";

/** Drawn after every other mesh of the scene. */
const TRAVELLING_BOX_QUAD_ORDER = 1000;

const VERTEX = `attribute vec4 clipPos;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = clipPos;
}`;

const FRAGMENT = `uniform sampler2D map;
uniform float opacity;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  gl_FragColor = vec4(c.rgb, c.a * opacity);
  #include <colorspace_fragment>
}`;

export interface TravellingBoxQuad {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  setMap(texture: Texture | null): void;
  setOpacity(opacity: number): void;
  dispose(): void;
}

/**
 * The quad. Before each draw `writeCorners(camera, out)` fills `out`
 * with the 4 corners' clip positions (x, y, z, w each, in the order
 * top-left, top-right, bottom-left, bottom-right) for the camera of that
 * render.
 */
export function createTravellingBoxQuad(
  writeCorners: (camera: Camera, out: Float32Array) => void,
): TravellingBoxQuad {
  const geometry = new BufferGeometry();
  // three.js wants a position to draw; the shader reads clipPos only.
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(12), 3),
  );
  const clip = new BufferAttribute(new Float32Array(16), 4);
  geometry.setAttribute("clipPos", clip);
  geometry.setAttribute(
    "uv",
    new BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2),
  );
  geometry.setIndex([0, 2, 1, 2, 3, 1]);
  const material = new ShaderMaterial({
    uniforms: { map: { value: null }, opacity: { value: 1 } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "travelling-box-quad";
  mesh.frustumCulled = false;
  mesh.renderOrder = TRAVELLING_BOX_QUAD_ORDER;
  mesh.visible = false;
  mesh.raycast = () => undefined;
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    writeCorners(camera, clip.array as Float32Array);
    clip.needsUpdate = true;
  };
  return {
    mesh,
    setMap(texture) {
      if (material.uniforms.map !== undefined) {
        material.uniforms.map.value = texture;
      }
    },
    setOpacity(opacity) {
      if (material.uniforms.opacity !== undefined) {
        material.uniforms.opacity.value = opacity;
      }
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
