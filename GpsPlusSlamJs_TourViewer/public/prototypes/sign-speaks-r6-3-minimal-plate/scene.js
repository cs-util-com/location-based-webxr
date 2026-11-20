// Sign speaks 6.3 - the camera stand-in both pages draw: an invented lane with a small pump
// house, and the phone camera's field of view. Throwaway prototype; nothing runs in AR.
import * as THREE from "three";

/** A phone camera, as the earlier sign prototype measured it: 42 degrees across an upright
 *  phone, 50 degrees from top to bottom of a sideways one. Gives the vertical fov in degrees
 *  and the focal length in CSS px. */
export function phoneCamera(w, h) {
  const f =
    w <= h
      ? w / 2 / Math.tan((21 * Math.PI) / 180)
      : h / 2 / Math.tan((25 * Math.PI) / 180);
  return { fovDeg: (2 * Math.atan(h / 2 / f) * 180) / Math.PI, focalPx: f };
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** The host's texture maker for the kind (`env.canvasTexture`). */
export function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function paint(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  return canvasTexture(c);
}

/** Sky, light, ground, houses along a lane and a pump house behind the sign at the origin. */
export function buildLane(scene) {
  scene.background = paint(4, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#7fa6c9");
    grad.addColorStop(0.55, "#c4d6e3");
    grad.addColorStop(1, "#e6ebee");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0xd8e1e7, 40, 200);
  scene.add(new THREE.HemisphereLight(0xdfe9f2, 0x6b5e50, 1.5));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
  sun.position.set(30, 70, 40);
  scene.add(sun);

  const rand = rng(5);
  const cobbles = paint(256, 256, (g, w, h) => {
    g.fillStyle = "#6f6a62";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      for (let x = (y / 16) % 2 ? -8 : 0; x < w; x += 16) {
        const v = 120 + Math.floor(rand() * 40);
        g.fillStyle = `rgb(${v} ${v - 6} ${v - 14})`;
        g.beginPath();
        g.roundRect(x + 1.5, y + 1.5, 13, 13, 4);
        g.fill();
      }
    }
  });
  cobbles.wrapS = THREE.RepeatWrapping;
  cobbles.wrapT = THREE.RepeatWrapping;
  cobbles.repeat.set(60, 60);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ map: cobbles }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const facade = paint(128, 128, (g, w, h) => {
    g.fillStyle = "#f4efe6";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#3b3f45";
    for (let y = 14; y < h - 30; y += 30) {
      for (let x = 14; x < w - 10; x += 28) {
        g.fillRect(x, y, 14, 18);
      }
    }
    g.fillStyle = "#5a4330";
    g.fillRect(52, h - 26, 22, 26);
  });
  const spots = [];
  for (let z = 30; z > -110; z -= 9) {
    spots.push([-17, z], [17, z]);
  }
  for (let x = -12; x <= 12; x += 9) {
    spots.push([x, -112]);
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  const walls = new THREE.InstancedMesh(
    box,
    new THREE.MeshLambertMaterial({ map: facade }),
    spots.length,
  );
  const roofs = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.75, 1, 4),
    new THREE.MeshLambertMaterial({ color: 0xa04a30 }),
    spots.length,
  );
  const m = new THREE.Matrix4();
  const turn = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI / 4,
  );
  const colors = [0xffffff, 0xf0dcc0, 0xe6cfb0, 0xdfe3e0, 0xf3d9c6, 0xe9e0cf];
  const c = new THREE.Color();
  spots.forEach(([x, z], i) => {
    const h = 9 + rand() * 7;
    m.compose(
      new THREE.Vector3(x, h / 2, z),
      new THREE.Quaternion(),
      new THREE.Vector3(8.4, h, 8.4),
    );
    walls.setMatrixAt(i, m);
    walls.setColorAt(i, c.setHex(colors[Math.floor(rand() * colors.length)]));
    m.compose(
      new THREE.Vector3(x, h + 1.6, z),
      turn,
      new THREE.Vector3(8.4, 3.2, 8.4),
    );
    roofs.setMatrixAt(i, m);
  });
  scene.add(walls, roofs);

  // the pump house the text is about, a few metres behind the sign
  const house = new THREE.Group();
  house.position.set(-1.5, 0, -7);
  const hw = new THREE.Mesh(
    box,
    new THREE.MeshLambertMaterial({ color: 0xd9c9ad }),
  );
  hw.scale.set(4, 3, 3.4);
  hw.position.y = 1.5;
  const hr = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 1.6, 4),
    new THREE.MeshLambertMaterial({ color: 0x7b3f2a }),
  );
  hr.position.y = 3.8;
  hr.rotation.y = Math.PI / 4;
  const door = new THREE.Mesh(
    box,
    new THREE.MeshLambertMaterial({ color: 0x4a3524 }),
  );
  door.scale.set(1, 2, 0.1);
  door.position.set(0.6, 1, 1.72);
  const trough = new THREE.Mesh(
    box,
    new THREE.MeshLambertMaterial({ color: 0x8d8a83 }),
  );
  trough.scale.set(2, 0.6, 0.8);
  trough.position.set(-0.7, 0.3, 2.3);
  house.add(hw, hr, door, trough);
  scene.add(house);
}
