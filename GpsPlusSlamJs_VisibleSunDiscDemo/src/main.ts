import { calculateSunPosition } from "gps-plus-slam-app-framework/geo";
import {
  createVisibleSunDisc,
  type SunDiscVisibility,
} from "gps-plus-slam-app-framework/visualization";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import "./style.css";

const BERLIN_LATITUDE_DEG = 52.52;
const BERLIN_LONGITUDE_DEG = 13.405;
// Midnight at the start of 21 June in Berlin (CEST, UTC+2).
const SIMULATION_START_MS = Date.parse("2026-06-20T22:00:00Z");
const RESET_MINUTE = 4 * 60;
const MAX_MINUTE = 36 * 60;
const MS_PER_MINUTE = 60_000;

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.querySelector<T>(`#${id}`);
  if (!element) throw new Error(`Missing page element: #${id}`);
  return element;
}

const sceneHost = getElement<HTMLDivElement>("scene");
const playPauseButton = getElement<HTMLButtonElement>("play-pause");
const resetButton = getElement<HTMLButtonElement>("reset");
const speedSelect = getElement<HTMLSelectElement>("speed");
const timeSlider = getElement<HTMLInputElement>("time-slider");
const simulatedDateOutput = getElement<HTMLOutputElement>("simulated-date");
const altitudeOutput = getElement<HTMLElement>("altitude");
const directionOutput = getElement<HTMLElement>("direction");
const vectorLengthOutput = getElement<HTMLElement>("vector-length");
const aboveHorizonOutput = getElement<HTMLElement>("above-horizon");
const visibilityOutput = getElement<HTMLElement>("visibility");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10233a);
scene.fog = new THREE.Fog(0x10233a, 14, 35);

const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
camera.position.set(1.5, 1.6, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
sceneHost.append(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-4, 3.2, 0);
controls.enableDamping = true;
controls.minDistance = 1;
controls.maxDistance = 8;
controls.update();

// These aids follow the observer so their plane remains the local horizon as
// OrbitControls moves the camera. Their axes are the framework's GPS-world NUE.
const horizon = new THREE.Group();
scene.add(horizon);

const grid = new THREE.GridHelper(24, 24, 0x91b3d4, 0x35506c);
grid.material.transparent = true;
grid.material.opacity = 0.55;
horizon.add(grid);

const horizonRingPoints = Array.from({ length: 128 }, (_, index) => {
  const angle = (index / 128) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(angle) * 10, 0, Math.sin(angle) * 10);
});
const horizonRing = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints(horizonRingPoints),
  new THREE.LineBasicMaterial({ color: 0xbfd8eb }),
);
horizon.add(horizonRing);

horizon.add(
  new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(),
    3,
    0xff5f67,
  ),
  new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(),
    3,
    0x62e585,
  ),
  new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(),
    3,
    0x5f9cff,
  ),
);

function createAxisLabel(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");

  context.font = "700 34px system-ui";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(5, 14, 25, 0.82)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      depthTest: false,
    }),
  );
  sprite.scale.set(2.4, 0.9, 1);
  return sprite;
}

const northLabel = createAxisLabel("+X NORTH", "#ff747a");
northLabel.position.set(4, 0.5, 0);
horizon.add(northLabel);
const eastLabel = createAxisLabel("+Z EAST", "#74a9ff");
eastLabel.position.set(0, 0.5, 4);
horizon.add(eastLabel);
const upLabel = createAxisLabel("+Y UP", "#7aeb98");
upLabel.position.set(0, 3.8, 0);
horizon.add(upLabel);

const sunDisc = createVisibleSunDisc(scene, {
  distance: 10,
  diameter: 0.72,
});
sunDisc.object.renderOrder = 10;

const berlinDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZoneName: "short",
});

let isPlaying = true;
let simulatedMinute = RESET_MINUTE;
let previousFrameMs = performance.now();

function getSimulatedDate(): Date {
  return new Date(SIMULATION_START_MS + simulatedMinute * MS_PER_MINUTE);
}

function setVisibilityStatus(state: SunDiscVisibility): void {
  visibilityOutput.textContent = state;
  visibilityOutput.dataset.state = state;
}

function updateSun(): void {
  const date = getSimulatedDate();
  const result = calculateSunPosition(
    date,
    BERLIN_LATITUDE_DEG,
    BERLIN_LONGITUDE_DEG,
  );
  const { x, y, z } = result.directionNue;
  const controllerState = sunDisc.update(result.directionNue, camera);

  simulatedDateOutput.textContent = berlinDateFormatter.format(date);
  altitudeOutput.textContent = `${THREE.MathUtils.radToDeg(result.altitudeRad).toFixed(2)}° (${result.altitudeRad.toFixed(4)} rad)`;
  directionOutput.textContent = `(${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)})`;
  vectorLengthOutput.textContent = Math.hypot(x, y, z).toFixed(8);
  aboveHorizonOutput.textContent = String(result.isAboveHorizon);
  setVisibilityStatus(controllerState);
}

function resizeRenderer(): void {
  const width = sceneHost.clientWidth;
  const height = sceneHost.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}

function setPlaying(nextPlaying: boolean): void {
  isPlaying = nextPlaying;
  playPauseButton.textContent = isPlaying ? "Pause" : "Play";
}

playPauseButton.addEventListener("click", () => {
  setPlaying(!isPlaying);
});

resetButton.addEventListener("click", () => {
  simulatedMinute = RESET_MINUTE;
  timeSlider.valueAsNumber = simulatedMinute;
  setPlaying(false);
  updateSun();
});

timeSlider.addEventListener("input", () => {
  simulatedMinute = timeSlider.valueAsNumber;
  setPlaying(false);
  updateSun();
});

window.addEventListener("resize", resizeRenderer);
resizeRenderer();
updateSun();

function animate(frameMs: number): void {
  const elapsedSeconds = Math.min((frameMs - previousFrameMs) / 1000, 0.25);
  previousFrameMs = frameMs;

  if (isPlaying) {
    simulatedMinute += elapsedSeconds * Number(speedSelect.value);
    if (simulatedMinute > MAX_MINUTE) simulatedMinute = 0;
    timeSlider.valueAsNumber = simulatedMinute;
  }

  controls.update();
  camera.updateMatrixWorld(true);
  horizon.position.copy(camera.position);
  horizon.updateMatrixWorld(true);
  updateSun();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
