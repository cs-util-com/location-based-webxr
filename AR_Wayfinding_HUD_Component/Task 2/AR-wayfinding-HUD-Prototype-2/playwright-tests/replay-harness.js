import * as THREE from 'three';
import { ARWayfindingHUD } from '../src/ARWayfindingHUD.js';

const reportEl = document.getElementById('hud-report');
const stageEl = document.getElementById('stage');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06070a);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 0);
camera.lookAt(0, 0, -1);
camera.updateMatrixWorld(true);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
stageEl.appendChild(renderer.domElement);

const hud = new ARWayfindingHUD(scene, camera, renderer, {
  distanceMin: 1.5,
  distanceMax: 3.0,
  hudDistance: 2.5,
  indicatorScale: 1.0,
  labelScale: 1.0,
});

const toVector3 = (tuple) => new THREE.Vector3().fromArray(tuple);
const toQuaternion = (tuple) => new THREE.Quaternion().fromArray(tuple);

function buildWaypoints(firstFrame) {
  const origin = toVector3(firstFrame.position);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(toQuaternion(firstFrame.quaternion));
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(toQuaternion(firstFrame.quaternion));

  return [
    origin.clone().add(forward.clone().multiplyScalar(0.75)),
    origin.clone().add(forward.clone().multiplyScalar(6)),
    origin.clone().add(right.clone().multiplyScalar(10)),
  ];
}

function applyFrame(frame) {
  camera.position.fromArray(frame.position);
  camera.quaternion.fromArray(frame.quaternion);
  camera.updateMatrixWorld(true);
}

function summarizeStates() {
  return hud.targetStates.map((state) => state.currentState);
}

window.task2ReplayHarness = {
  ready: true,
  async run(frames) {
    if (!Array.isArray(frames) || frames.length === 0) {
      throw new Error('Replay frames are required.');
    }

    hud.setWaypoints(buildWaypoints(frames[0]));

    const stateHistory = [];
    for (const frame of frames) {
      applyFrame(frame);
      hud.update();
      renderer.render(scene, camera);
      stateHistory.push(summarizeStates());
    }

    const finalStates = summarizeStates();
    reportEl.textContent = [
      `frames: ${frames.length}`,
      `final: ${finalStates.join(', ')}`,
      `history: ${stateHistory.map((row) => row.join('|')).join(' -> ')}`,
    ].join('\n');

    return {
      frames: frames.length,
      finalStates,
      stateHistory,
      reportText: reportEl.textContent,
    };
  },
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
