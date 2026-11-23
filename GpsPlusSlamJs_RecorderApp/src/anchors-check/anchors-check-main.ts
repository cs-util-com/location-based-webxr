/**
 * Entry point of `ar-anchors-check.html`. Supplies the real dependencies
 * (WebXR, the clipboard, a three.js scene with three small objects) to the
 * session and page modules; all behaviour and every test live there.
 *
 * Not reachable from the recorder's own entry, and the page is linked from
 * nothing (`anchors-check-isolation.test.ts`).
 *
 * Sidecar: `anchors-check-main.ts.md`.
 */

import * as THREE from 'three';
import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import { createAnchorsCheckPage } from './anchors-check-page';
import {
  createAnchorsCheck,
  type AnchorsCheckScene,
  type XrSystemLike,
} from './anchors-check-session';

function createScene(): AnchorsCheckScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  renderer.domElement.style.display = 'none';
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 3));

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.05, 0.065, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  // The anchor: a solid box. The marker: a larger ring around it, so both
  // stay visible when they coincide and the gap reads at once when not.
  const anchorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.06).translate(0, 0.03, 0),
    new THREE.MeshStandardMaterial({ color: 0x22c55e })
  );
  const markerMesh = new THREE.Mesh(
    new THREE.RingGeometry(0.1, 0.12, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide })
  );
  for (const mesh of [reticle, anchorMesh, markerMesh]) {
    mesh.visible = false;
    scene.add(mesh);
  }

  const show = (mesh: THREE.Object3D, pose: Pose | null): void => {
    mesh.visible = pose !== null;
    if (pose === null) return;
    mesh.position.fromArray(pose.position);
    mesh.quaternion.fromArray(pose.rotation);
  };

  return {
    async start(session, onFrame) {
      await renderer.xr.setSession(session as unknown as XRSession);
      renderer.domElement.style.display = '';
      const space = renderer.xr.getReferenceSpace();
      renderer.setAnimationLoop((t, frame) => {
        if (frame && space) onFrame(t, frame, space);
        renderer.render(scene, camera);
      });
      session.addEventListener('end', () => {
        renderer.setAnimationLoop(null);
        renderer.domElement.style.display = 'none';
      });
    },
    showReticle: (pose) => show(reticle, pose),
    showAnchor: (pose) => show(anchorMesh, pose),
    showMarker: (pose) => show(markerMesh, pose),
  };
}

const page = createAnchorsCheckPage({
  document,
  copyText: navigator.clipboard
    ? (text) => navigator.clipboard.writeText(text)
    : undefined,
});

const controller = createAnchorsCheck({
  xr: (navigator as { xr?: unknown }).xr as XrSystemLike | undefined,
  overlayRoot: page.overlayRoot,
  scene: createScene(),
  view: page.view,
  makeTransform: (pose) =>
    new XRRigidTransform(
      { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
      {
        x: pose.rotation[0],
        y: pose.rotation[1],
        z: pose.rotation[2],
        w: pose.rotation[3],
      }
    ),
  environment: {
    userAgent: navigator.userAgent,
    page: 'ar-anchors-check.html',
    buildCommit: globalThis.__BUILD_COMMIT__ ?? 'dev',
  },
  nowIso: () => new Date().toISOString(),
});

page.connect(controller);
void controller.checkSupport();
