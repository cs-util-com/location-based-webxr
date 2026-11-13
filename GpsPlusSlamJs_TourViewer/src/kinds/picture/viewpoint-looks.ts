/**
 * The meshes of the pictures seen from a viewpoint, in the viewpoint's
 * frame (the station's: north, up, east, the ground at height 0): the
 * picture's plane on the viewpoint's axis, the spot marker on the ground,
 * the viewer on its column, the finder's corner marks and the standing
 * frame the window shows the picture through. Geometry only: what shows
 * how much, and when, is `viewpoint-world.ts`'s.
 *
 * @see viewpoint-looks.ts.md
 */
import type { TourPictureViewpoint } from "gps-plus-slam-app-framework/ar/tour-kinds";
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Shape,
  ShapeGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Material,
  type Texture,
} from "three";

const DEG = Math.PI / 180;
/** The marks' colours, the prototype's: amber and paper. */
const AMBER = 0xe9b872;
const PAPER = 0xf4ede1;
const INK_DARK = 0x14110d;

/** The viewpoint's turn as a three quaternion. */
export function viewpointTurn(viewpoint: TourPictureViewpoint): Quaternion {
  return new Quaternion(...viewpoint.rotation).normalize();
}

/** The viewpoint's heading on the ground: the turn about up that points
 *  a group's local -Z the way the viewpoint looks. */
export function viewpointYaw(viewpoint: TourPictureViewpoint): number {
  const f = new Vector3(0, 0, -1).applyQuaternion(viewpointTurn(viewpoint));
  return Math.atan2(-f.x, -f.z);
}

/** The picture's half width at depth 1 (the lens's half angle). */
function halfTan(viewpoint: TourPictureViewpoint): number {
  return Math.tan((viewpoint.hfovDeg * DEG) / 2);
}

export interface ViewpointPlane {
  /** At the eye, turned as the camera was; the mesh hangs `depthM` ahead. */
  readonly holder: Group;
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly widthM: number;
  readonly heightM: number;
}

/**
 * The whole picture (or its centre `crop`, a share of the lens's width)
 * on one plane `depthM` along the viewpoint's axis, sized by the lens so
 * that from the eye it covers what the camera saw. `aspect` is the
 * picture's height over its width. Drawn over the place (no depth test),
 * as an overlay that lines up.
 */
export function viewpointPlane(
  viewpoint: TourPictureViewpoint,
  aspect: number,
  texture: Texture,
  depthM = viewpoint.distanceM,
  crop = 1,
): ViewpointPlane {
  const widthM = 2 * depthM * halfTan(viewpoint) * crop;
  const heightM = widthM * aspect;
  const geometry = new PlaneGeometry(widthM, heightM);
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(
      i,
      0.5 + (uv.getX(i) - 0.5) * crop,
      0.5 + (uv.getY(i) - 0.5) * crop,
    );
  }
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "picture-viewpoint-plane";
  mesh.position.z = -depthM;
  mesh.renderOrder = 50;
  mesh.frustumCulled = false;
  const holder = new Group();
  holder.position.set(...viewpoint.position);
  holder.quaternion.copy(viewpointTurn(viewpoint));
  holder.add(mesh);
  return { holder, mesh, widthM, heightM };
}

/** The "stand here" mark: a ring on the ground at the spot with an arrow
 *  the way to face. One material, so one opacity fades it. */
export function spotMarker(viewpoint: TourPictureViewpoint): {
  readonly group: Group;
  readonly material: MeshBasicMaterial;
} {
  const material = new MeshBasicMaterial({
    color: AMBER,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  });
  const ring = new Mesh(new RingGeometry(0.62, 0.7, 48), material);
  ring.rotation.x = -Math.PI / 2;
  const arrow = new Shape();
  arrow.moveTo(0, 0.86);
  arrow.lineTo(0.18, 0.62);
  arrow.lineTo(0, 0.7);
  arrow.lineTo(-0.18, 0.62);
  arrow.closePath();
  const tip = new Mesh(new ShapeGeometry(arrow), material);
  // The shape's +Y becomes the group's -Z: the arrow points ahead.
  tip.rotation.x = -Math.PI / 2;
  const group = new Group();
  group.name = "picture-spot";
  group.position.set(viewpoint.position[0], 0.02, viewpoint.position[2]);
  group.rotation.y = viewpointYaw(viewpoint);
  group.add(ring, tip);
  group.renderOrder = 2;
  return { group, material };
}

/** The viewer: a stand with binoculars on a column, 0.42 m ahead of the
 *  spot, its head tilted with the viewpoint. `materials` fade it. */
export function viewerStand(viewpoint: TourPictureViewpoint): {
  readonly group: Group;
  readonly materials: readonly Material[];
} {
  const body = new MeshStandardMaterial({
    color: 0x2b4a44,
    roughness: 0.4,
    metalness: 0.15,
    transparent: true,
  });
  const brass = new MeshStandardMaterial({
    color: 0xd2ad62,
    roughness: 0.35,
    metalness: 0.25,
    transparent: true,
  });
  const rubber = new MeshStandardMaterial({
    color: 0x141210,
    roughness: 0.8,
    transparent: true,
  });
  const lensMat = new MeshStandardMaterial({
    color: 0x0c1418,
    roughness: 0.1,
    metalness: 0.5,
    transparent: true,
  });
  const hoodMat = body.clone();
  hoodMat.side = DoubleSide;
  const at = (mesh: Mesh, x: number, y: number, z: number): Mesh => {
    mesh.position.set(x, y, z);
    return mesh;
  };
  const stand = new Group();
  stand.position.z = -0.42;
  stand.add(
    at(new Mesh(new CylinderGeometry(0.26, 0.33, 0.07, 36), body), 0, 0.035, 0),
    at(new Mesh(new CylinderGeometry(0.05, 0.075, 1.1, 24), body), 0, 0.62, 0),
    at(
      new Mesh(new CylinderGeometry(0.075, 0.075, 0.05, 24), brass),
      0,
      1.18,
      0,
    ),
    at(new Mesh(new BoxGeometry(0.34, 0.05, 0.08), body), 0, 1.23, 0),
    at(new Mesh(new BoxGeometry(0.03, 0.16, 0.06), body), -0.16, 1.3, 0),
    at(new Mesh(new BoxGeometry(0.03, 0.16, 0.06), body), 0.16, 1.3, 0),
  );
  const head = new Group();
  head.position.y = 1.36;
  const f = new Vector3(0, 0, -1).applyQuaternion(viewpointTurn(viewpoint));
  head.rotation.x = Math.asin(Math.max(-1, Math.min(1, f.y)));
  const barrel = new Mesh(new CapsuleGeometry(0.115, 0.2, 8, 24), body);
  barrel.rotation.z = Math.PI / 2;
  head.add(
    barrel,
    at(new Mesh(new BoxGeometry(0.38, 0.02, 0.2), body), 0, 0.125, -0.02),
  );
  for (const x of [-0.105, 0.105]) {
    const hood = at(
      new Mesh(new CylinderGeometry(0.075, 0.07, 0.16, 28, 1, true), hoodMat),
      x,
      0,
      -0.16,
    );
    hood.rotation.x = Math.PI / 2;
    const lens = at(
      new Mesh(new PlaneGeometry(0.13, 0.13), lensMat),
      x,
      0,
      -0.2,
    );
    lens.rotation.y = Math.PI;
    const eye = at(
      new Mesh(new CylinderGeometry(0.034, 0.04, 0.07, 20), rubber),
      x * 0.85,
      0.01,
      0.15,
    );
    eye.rotation.x = Math.PI / 2;
    head.add(hood, lens, eye);
  }
  stand.add(head);
  const group = new Group();
  group.name = "picture-viewer";
  group.position.set(viewpoint.position[0], 0, viewpoint.position[2]);
  group.rotation.y = viewpointYaw(viewpoint);
  group.add(stand);
  return { group, materials: [body, brass, rubber, lensMat, hoodMat] };
}

/**
 * The finder's four corner marks: L-shaped brackets on the corners of the
 * picture's centre crop (`crop`, a share of the lens's width), each at its
 * own depth so they meet only from the spot, a light ink over a dark
 * underlay. Built in the viewpoint's frame; no depth test.
 */
export function finderCorners(
  viewpoint: TourPictureViewpoint,
  aspect: number,
  crop: number,
): { readonly ink: Mesh; readonly under: Mesh } {
  const P = new Vector3(...viewpoint.position);
  const q = viewpointTurn(viewpoint);
  const D = viewpoint.distanceM;
  const tw = halfTan(viewpoint) * crop;
  const th = tw * aspect;
  const ink: Vector3[][] = [];
  const under: Vector3[][] = [];
  const corners: readonly (readonly [number, number, number])[] = [
    [-1, 1, D * 1.2],
    [1, 1, D * 0.75],
    [1, -1, 6.5],
    [-1, -1, 4.5],
  ];
  for (const [sx, sy, d0] of corners) {
    let d = d0;
    const ray = new Vector3(sx * tw, sy * th, -1).applyQuaternion(q);
    // A lower corner never sinks under the ground.
    if (ray.y < 0) d = Math.max(0.5, Math.min(d, (P.y - 0.25) / -ray.y));
    const span = 2 * tw * d;
    const L = span * 0.14;
    const t = span * 0.013;
    const cx = sx * tw * d;
    const cy = sy * th * d;
    const quad = (
      out: Vector3[][],
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ): void => {
      out.push(
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ].map(([x = 0, y = 0]) =>
          new Vector3(x, y, -d).applyQuaternion(q).add(P),
        ),
      );
    };
    const arm = (out: Vector3[][], tt: number, o: number): void => {
      const xa = cx + sx * o;
      const xb = cx - sx * L;
      quad(out, Math.min(xa, xb), cy - tt / 2, Math.max(xa, xb), cy + tt / 2);
      const ya = cy + sy * o;
      const yb = cy - sy * L;
      quad(out, cx - tt / 2, Math.min(ya, yb), cx + tt / 2, Math.max(ya, yb));
    };
    arm(under, t * 2.8, t * 0.9);
    arm(ink, t, t * 0.5);
  }
  const mesh = (
    quads: Vector3[][],
    color: number,
    order: number,
    name: string,
  ): Mesh => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (const corners4 of quads) {
      const b = pos.length / 3;
      for (const v of corners4) pos.push(v.x, v.y, v.z);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
    geometry.setIndex(idx);
    const m = new Mesh(
      geometry,
      new MeshBasicMaterial({
        color,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    );
    m.name = name;
    m.renderOrder = order;
    m.frustumCulled = false;
    return m;
  };
  return {
    under: mesh(under, INK_DARK, 51, "picture-finder-under"),
    ink: mesh(ink, PAPER, 52, "picture-finder-ink"),
  };
}

/** The finder's ink colour once the visitor stands on the spot. */
export const FINDER_ON_SPOT_COLOR = AMBER;
export const FINDER_INK_COLOR = PAPER;

/** The standing frame: 1 m wide, 1.5 m ahead of the spot, a 6 cm border,
 *  4 cm deep, a 16 cm reveal behind its opening. The prototype's chosen
 *  default of its sweep (widths 0.8, 1.0, 1.4 by distances 1, 1.5, 2.5). */
export const PORTAL_FRAME = {
  widthM: 1,
  aheadM: 1.5,
  borderM: 0.06,
  depthM: 0.04,
  revealM: 0.16,
  /** The edge's fade into the dark box, a share of the picture's width. */
  edgeFade: 0.04,
} as const;

const VS_PORTAL = `varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/* The ray from the eye (each eye of a headset is drawn with its own
   camera, so this is that eye's position) through the fragment meets the
   picture's plane; the picture is sampled there, a dark box past its
   edges. Nothing is in screen space. */
const FS_PORTAL = `uniform sampler2D uTex;
uniform vec3 uC, uR, uU, uN;
uniform vec2 uSize;
uniform float uFade, uAlpha;
varying vec3 vWorld;
void main() {
  vec3 d = vWorld - cameraPosition;
  float den = dot(d, uN);
  float t = den > 1e-6 ? dot(uC - cameraPosition, uN) / den : -1.0;
  vec3 X = cameraPosition + d * max(t, 0.0);
  vec2 uv = vec2(dot(X - uC, uR) / uSize.x, dot(X - uC, uU) / uSize.y) + 0.5;
  float ahead = t > 0.0 ? 1.0 : 0.0;
  float fu = max(uFade, 1e-4), fv = fu * uSize.x / uSize.y;
  float m = ahead * smoothstep(0.0, fu, uv.x) * smoothstep(0.0, fu, 1.0 - uv.x)
    * smoothstep(0.0, fv, uv.y) * smoothstep(0.0, fv, 1.0 - uv.y);
  vec3 col = mix(vec3(0.010, 0.009, 0.008), texture2D(uTex, clamp(uv, 0.0, 1.0)).rgb, m);
  gl_FragColor = vec4(col, uAlpha);
  #include <colorspace_fragment>
}`;

/** The picture's plane in the viewpoint's frame, as the portal's shader
 *  reads it: centre, right, up, normal (the way the camera looked). */
export interface PortalPlane {
  readonly center: Vector3;
  readonly right: Vector3;
  readonly up: Vector3;
  readonly normal: Vector3;
  readonly widthM: number;
  readonly heightM: number;
}

export interface PortalLook {
  readonly group: Group;
  /** The opening, its material the ray-cast shader. */
  readonly opening: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly plane: PortalPlane;
  /** The frame's lit materials, which fade with the opening. */
  readonly materials: readonly Material[];
}

function ringGeometry(
  ow: number,
  oh: number,
  iw: number,
  ih: number,
  depth: number,
): ExtrudeGeometry {
  const shape = new Shape();
  shape.moveTo(-ow / 2, -oh / 2);
  shape.lineTo(ow / 2, -oh / 2);
  shape.lineTo(ow / 2, oh / 2);
  shape.lineTo(-ow / 2, oh / 2);
  shape.closePath();
  const hole = new Path();
  hole.moveTo(-iw / 2, -ih / 2);
  hole.lineTo(-iw / 2, ih / 2);
  hole.lineTo(iw / 2, ih / 2);
  hole.lineTo(iw / 2, -ih / 2);
  hole.closePath();
  shape.holes.push(hole);
  return new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
  });
}

/**
 * The window: a frame upright on two posts `PORTAL_FRAME.aheadM` ahead of
 * the spot, facing it, at the eye's height plus the viewpoint's pitch; the
 * opening at the back of a short dark reveal shows the picture hanging at
 * the subject's depth (the then-and-now plane), so from the spot it lines
 * up and a step aside shows more of it, as through a real window.
 */
export function portalLook(
  viewpoint: TourPictureViewpoint,
  aspect: number,
  texture: Texture,
): PortalLook {
  const F = PORTAL_FRAME;
  const P = new Vector3(...viewpoint.position);
  const q = viewpointTurn(viewpoint);
  const D = viewpoint.distanceM;
  const W = 2 * D * halfTan(viewpoint);
  const normal = new Vector3(0, 0, -1).applyQuaternion(q);
  const plane: PortalPlane = {
    center: normal.clone().multiplyScalar(D).add(P),
    right: new Vector3(1, 0, 0).applyQuaternion(q),
    up: new Vector3(0, 1, 0).applyQuaternion(q),
    normal,
    widthM: W,
    heightM: W * aspect,
  };
  const w = F.widthM;
  const h = w * aspect;
  const ow = w + 2 * F.borderM;
  const oh = h + 2 * F.borderM;
  const yaw = viewpointYaw(viewpoint);
  const group = new Group();
  group.name = "picture-portal";
  const ahead = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const pitch = Math.asin(Math.max(-1, Math.min(1, normal.y)));
  group.position.copy(P).addScaledVector(ahead, F.aheadM);
  group.position.y = P.y + F.aheadM * Math.tan(pitch);
  // Local +Z faces the spot; the opening's front face is at z = 0.
  group.rotation.y = yaw;
  const lit = (color: number, roughness: number): MeshStandardMaterial =>
    new MeshStandardMaterial({
      color,
      roughness,
      metalness: 0.05,
      transparent: true,
    });
  const ringM = lit(0x2b2018, 0.5);
  const caseM = lit(0x15110d, 0.8);
  const wallM = lit(0x1d1813, 0.95);
  wallM.side = DoubleSide;
  const hidden = new MeshBasicMaterial({ visible: false });
  const rv = F.revealM;
  const ring = new Mesh(ringGeometry(ow, oh, w, h, F.depthM), ringM);
  ring.name = "picture-portal-frame";
  // The case behind the opening, open at its front.
  const box = new Mesh(new BoxGeometry(ow, oh, rv), [
    caseM,
    caseM,
    caseM,
    caseM,
    hidden,
    caseM,
  ]);
  box.position.z = -rv / 2;
  const wall = (
    gw: number,
    gh: number,
    rx: number,
    ry: number,
    x: number,
    y: number,
  ): Mesh => {
    const m = new Mesh(new PlaneGeometry(gw, gh), wallM);
    m.rotation.set(rx, ry, 0);
    m.position.set(x, y, -rv / 2);
    return m;
  };
  const material = new ShaderMaterial({
    uniforms: {
      uTex: { value: texture },
      uC: { value: new Vector3() },
      uR: { value: new Vector3() },
      uU: { value: new Vector3() },
      uN: { value: new Vector3() },
      uSize: { value: new Vector2(plane.widthM, plane.heightM) },
      uFade: { value: F.edgeFade },
      uAlpha: { value: 1 },
    },
    vertexShader: VS_PORTAL,
    fragmentShader: FS_PORTAL,
    transparent: true,
  });
  const opening = new Mesh(new PlaneGeometry(w, h), material);
  opening.name = "picture-portal-opening";
  opening.position.z = -rv;
  group.add(
    ring,
    box,
    wall(rv, h, 0, Math.PI / 2, -w / 2, 0),
    wall(rv, h, 0, -Math.PI / 2, w / 2, 0),
    wall(w, rv, Math.PI / 2, 0, 0, h / 2),
    wall(w, rv, -Math.PI / 2, 0, 0, -h / 2),
    opening,
  );
  // Two posts with feet when the frame clears the ground (a low
  // viewpoint's may not).
  const lift = group.position.y - oh / 2;
  if (lift > 0.05) {
    for (const sx of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.05, lift, 0.05), caseM);
      post.position.set(sx * (ow / 2 - 0.03), -oh / 2 - lift / 2, -rv / 2);
      const foot = new Mesh(new BoxGeometry(0.07, 0.04, 0.5), caseM);
      foot.position.set(
        sx * (ow / 2 - 0.03),
        -group.position.y + 0.02,
        -rv / 2,
      );
      group.add(post, foot);
    }
  }
  return { group, opening, plane, materials: [ringM, caseM, wallM] };
}
