import * as THREE from 'three';
import { calculateSunPosition } from 'gps-plus-slam-app-framework/geo';
import { createSunShadowRig } from 'gps-plus-slam-app-framework/visualization';

// Demo configuration
const DEFAULT_LATITUDE = 52.52; // Berlin
const DEFAULT_LONGITUDE = 13.405; // Berlin
const DEFAULT_DATE = '2026-06-21T12:00:00Z'; // Summer solstice noon

// State
let latitude = DEFAULT_LATITUDE;
let longitude = DEFAULT_LONGITUDE;
let currentDate = new Date(DEFAULT_DATE);
let isPlaying = false;
let timeSpeed = 1; // multiplier for real-time
let lastTimestamp = 0;

// Three.js setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Sky blue

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 5, 15);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Ensure canvas takes full viewport
document.body.style.margin = '0';
document.body.style.padding = '0';
document.body.style.overflow = 'hidden';
renderer.domElement.style.display = 'block';
renderer.domElement.style.width = '100vw';
renderer.domElement.style.height = '100vh';

// Ground plane
const groundGeometry = new THREE.PlaneGeometry(100, 100);
const groundMaterial = new THREE.MeshStandardMaterial({ 
  color: 0x808080,
  roughness: 0.8,
  metalness: 0.2
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
ground.receiveShadow = true;
scene.add(ground);

// Box (shadow caster)
const boxGeometry = new THREE.BoxGeometry(2, 2, 2);
const boxMaterial = new THREE.MeshStandardMaterial({ 
  color: 0xff6b6b,
  roughness: 0.5,
  metalness: 0.1
});
const box = new THREE.Mesh(boxGeometry, boxMaterial);
box.position.set(0, 1, 0); // Position above ground
box.castShadow = true;
box.receiveShadow = true;
scene.add(box);

// Ambient light for base illumination
const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
scene.add(ambientLight);

// Create sun shadow rig
const sunShadowRig = createSunShadowRig(scene, {
  targetOrigin: { x: 0, y: 0, z: 0 },
  distance: 50,
  mapSize: 2048,
  groundPlaneSize: 100,
  shadowOpacity: 0.4,
  margin: 1.15,
  defaultContentExtent: 15
});

// UI Elements
const container = document.createElement('div');
container.style.position = 'absolute';
container.style.top = '10px';
container.style.left = '10px';
container.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
container.style.padding = '15px';
container.style.borderRadius = '8px';
container.style.fontFamily = 'Arial, sans-serif';
container.style.fontSize = '14px';
container.style.maxWidth = '300px';
document.body.appendChild(container);

// Location controls
const locationDiv = document.createElement('div');
locationDiv.innerHTML = `
  <h3 style="margin: 0 0 10px 0;">Location</h3>
  <label>
    Latitude: <input type="number" id="latitude" value="${latitude}" step="0.01" min="-90" max="90" style="width: 80px;">
  </label><br>
  <label>
    Longitude: <input type="number" id="longitude" value="${longitude}" step="0.01" min="-180" max="180" style="width: 80px;">
  </label>
`;
container.appendChild(locationDiv);

// Time controls
const timeDiv = document.createElement('div');
timeDiv.style.marginTop = '15px';
timeDiv.innerHTML = `
  <h3 style="margin: 0 0 10px 0;">Time</h3>
  <label>
    Date/Time: <input type="datetime-local" id="datetime" step="1" style="width: 180px;">
  </label><br>
  <label>
    Time of day: <input type="range" id="timeSlider" min="0" max="23.9" step="0.1" value="12" style="width: 180px;">
    <span id="timeValue">12:00</span>
  </label><br>
  <button id="playPause" style="margin-top: 5px;">Play</button>
  <button id="reset" style="margin-top: 5px;">Reset</button><br>
  <label style="margin-top: 5px; display: block;">
    Speed: <input type="range" id="speedSlider" min="0.1" max="10" step="0.1" value="1" style="width: 100px;">
    <span id="speedValue">1x</span>
  </label>
`;
container.appendChild(timeDiv);

// Status display
const statusDiv = document.createElement('div');
statusDiv.style.marginTop = '15px';
statusDiv.innerHTML = `
  <h3 style="margin: 0 0 10px 0;">Sun Status</h3>
  <div id="sunStatus">
    <div>Altitude: <span id="altitude">--</span>°</div>
    <div>Azimuth: <span id="azimuth">--</span>°</div>
    <div>NUE Direction: <span id="nueDirection">--</span></div>
    <div>Above Horizon: <span id="aboveHorizon">--</span></div>
    <div>Shadow Visible: <span id="shadowVisible">--</span></div>
  </div>
`;
container.appendChild(statusDiv);

// Get UI elements
const latitudeInput = document.getElementById('latitude') as HTMLInputElement;
const longitudeInput = document.getElementById('longitude') as HTMLInputElement;
const datetimeInput = document.getElementById('datetime') as HTMLInputElement;
const timeSlider = document.getElementById('timeSlider') as HTMLInputElement;
const timeValue = document.getElementById('timeValue') as HTMLSpanElement;
const playPauseButton = document.getElementById('playPause') as HTMLButtonElement;
const resetButton = document.getElementById('reset') as HTMLButtonElement;
const speedSlider = document.getElementById('speedSlider') as HTMLInputElement;
const speedValue = document.getElementById('speedValue') as HTMLSpanElement;
const altitudeDisplay = document.getElementById('altitude') as HTMLSpanElement;
const azimuthDisplay = document.getElementById('azimuth') as HTMLSpanElement;
const nueDirectionDisplay = document.getElementById('nueDirection') as HTMLSpanElement;
const aboveHorizonDisplay = document.getElementById('aboveHorizon') as HTMLSpanElement;
const shadowVisibleDisplay = document.getElementById('shadowVisible') as HTMLSpanElement;

// Initialize datetime input
function updateDateTimeInput() {
  const localDate = new Date(currentDate.getTime() - currentDate.getTimezoneOffset() * 60000);
  datetimeInput.value = localDate.toISOString().slice(0, 16);
}
updateDateTimeInput();

// Update sun position and shadow rig
function updateSunPosition() {
  try {
    const result = calculateSunPosition(currentDate, latitude, longitude);
    
    // Update status display
    altitudeDisplay.textContent = (result.altitudeRad * 180 / Math.PI).toFixed(1);
    azimuthDisplay.textContent = (result.azimuthRad * 180 / Math.PI).toFixed(1);
    nueDirectionDisplay.textContent = 
      `(${result.directionNue.x.toFixed(2)}, ${result.directionNue.y.toFixed(2)}, ${result.directionNue.z.toFixed(2)})`;
    aboveHorizonDisplay.textContent = result.isAboveHorizon ? 'Yes' : 'No';
    
    // Update shadow rig (without lighting model)
    sunShadowRig.update(result.directionNue);
    shadowVisibleDisplay.textContent = sunShadowRig.shadowCatcher.visible ? 'Yes' : 'No';
    
    // Update time slider based on current time
    const hours = currentDate.getUTCHours() + currentDate.getUTCMinutes() / 60 + currentDate.getUTCSeconds() / 3600;
    timeSlider.value = hours.toString();
    const displayHours = Math.floor(hours);
    const displayMinutes = Math.floor((hours - displayHours) * 60);
    timeValue.textContent = `${displayHours.toString().padStart(2, '0')}:${displayMinutes.toString().padStart(2, '0')}`;
    
  } catch (error) {
    console.error('Error calculating sun position:', error);
    altitudeDisplay.textContent = 'Error';
    azimuthDisplay.textContent = 'Error';
    nueDirectionDisplay.textContent = 'Error';
    aboveHorizonDisplay.textContent = 'Error';
    shadowVisibleDisplay.textContent = 'Error';
  }
}

// Event listeners
latitudeInput.addEventListener('change', () => {
  latitude = parseFloat(latitudeInput.value);
  updateSunPosition();
});

longitudeInput.addEventListener('change', () => {
  longitude = parseFloat(longitudeInput.value);
  updateSunPosition();
});

datetimeInput.addEventListener('change', () => {
  const localDate = new Date(datetimeInput.value);
  currentDate = new Date(localDate.getTime() + currentDate.getTimezoneOffset() * 60000);
  updateSunPosition();
});

timeSlider.addEventListener('input', () => {
  let hours = parseFloat(timeSlider.value);
  
  // Clamp to valid 24-hour range (exclusive of 24 to prevent date rollover)
  hours = Math.max(0, Math.min(23.99, hours));
  
  const date = new Date(currentDate);
  // Preserve the current date, only change the time within the same day
  const currentYear = date.getUTCFullYear();
  const currentMonth = date.getUTCMonth();
  const currentDay = date.getUTCDate();
  
  // Set the new time while keeping the same date
  date.setUTCFullYear(currentYear, currentMonth, currentDay);
  date.setUTCHours(Math.floor(hours));
  date.setUTCMinutes(Math.floor((hours - Math.floor(hours)) * 60));
  date.setUTCSeconds(0);
  date.setUTCMilliseconds(0);
  
  currentDate = date;
  updateDateTimeInput();
  updateSunPosition();
});

playPauseButton.addEventListener('click', () => {
  isPlaying = !isPlaying;
  playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
  if (isPlaying) {
    lastTimestamp = performance.now();
  }
});

resetButton.addEventListener('click', () => {
  currentDate = new Date(DEFAULT_DATE);
  latitude = DEFAULT_LATITUDE;
  longitude = DEFAULT_LONGITUDE;
  latitudeInput.value = latitude.toString();
  longitudeInput.value = longitude.toString();
  isPlaying = false;
  playPauseButton.textContent = 'Play';
  updateDateTimeInput();
  updateSunPosition();
});

speedSlider.addEventListener('input', () => {
  timeSpeed = parseFloat(speedSlider.value);
  speedValue.textContent = `${timeSpeed.toFixed(1)}x`;
});

// Window resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animation loop
function animate(timestamp: number) {
  requestAnimationFrame(animate);
  
  // Update camera controls
  const moveSpeed = 0.1;
  if (keys['w'] || keys['W']) camera.position.z -= moveSpeed;
  if (keys['s'] || keys['S']) camera.position.z += moveSpeed;
  if (keys['a'] || keys['A']) camera.position.x -= moveSpeed;
  if (keys['d'] || keys['D']) camera.position.x += moveSpeed;
  if (keys['q'] || keys['Q']) camera.position.y += moveSpeed;
  if (keys['e'] || keys['E']) camera.position.y -= moveSpeed;
  camera.lookAt(0, 0, 0);
  
  if (isPlaying) {
    const delta = (timestamp - lastTimestamp) / 1000; // Convert to seconds
    lastTimestamp = timestamp;
    
    // Advance time based on speed multiplier
    const timeAdvance = delta * timeSpeed * 1000; // Convert to milliseconds
    currentDate = new Date(currentDate.getTime() + timeAdvance);
    updateDateTimeInput();
    updateSunPosition();
  } else {
    lastTimestamp = timestamp;
  }
  
  renderer.render(scene, camera);
}

// Simple camera controls (keyboard)
const keys: { [key: string]: boolean } = {};
window.addEventListener('keydown', (e) => { keys[e.key] = true; });
window.addEventListener('keyup', (e) => { keys[e.key] = false; });

// Initial update
updateSunPosition();
animate(0);
