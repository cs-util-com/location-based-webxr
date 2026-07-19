import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ARWayfindingHUD } from './ARWayfindingHUD.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.6, 5); 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true; // Enable XR for future headset testing
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.target.set(0, 1.6, 4.99);
controls.update();

const keysPressed = {
    w: false, a: false, s: false, d: false,
    ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false
};

window.addEventListener('keydown', (e) => {
    if (e.key in keysPressed) keysPressed[e.key] = true;
});

window.addEventListener('keyup', (e) => {
    if (e.key in keysPressed) keysPressed[e.key] = false;
});

const gridHelper = new THREE.GridHelper(50, 50);
scene.add(gridHelper);

const dummyTargets = [
    new THREE.Vector3(15, 1.6, 0),    
    new THREE.Vector3(-10, 1.6, 10),  
    new THREE.Vector3(0, 1.6, -25),   
    new THREE.Vector3(0, 15, 25)
];

dummyTargets.forEach((pos) => {
    const geometry = new THREE.SphereGeometry(0.5, 32, 32);
    const material = new THREE.MeshBasicMaterial({ color: 0x4CAF50, wireframe: true });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(pos);
    scene.add(sphere);
});

const hudConfig = {
    distanceMin: 18.0,
    distanceMax: 20.0,
    hudDistance: 2.5,
    // Optional: provide custom sprite textures for the HUD indicators.
    // Accepts a URL string (relative to the project root) or a pre-built THREE.Texture.
    // If omitted, the module falls back to procedural ConeGeometry / RingGeometry.
    arrowSprite: './src/assets/Arrow-Right-1-icon-1515697076.png',
    //circleSprite: './src/assets/Circle-Logo-Template-PNG-HD-2761340067.png',
};

// Pass the renderer into the HUD so it can access the active WebXR camera array
const hud = new ARWayfindingHUD(scene, camera, renderer, hudConfig);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

const moveSpeed = 0.1;
const moveVector = new THREE.Vector3();

function animate() {
    // requestAnimationFrame is replaced by renderer.setAnimationLoop for WebXR compatibility
    moveVector.set(0, 0, 0);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0;
    right.normalize();

    if (keysPressed.w || keysPressed.ArrowUp) moveVector.add(forward);
    if (keysPressed.s || keysPressed.ArrowDown) moveVector.addScaledVector(forward, -1);
    if (keysPressed.d || keysPressed.ArrowRight) moveVector.add(right);
    if (keysPressed.a || keysPressed.ArrowLeft) moveVector.addScaledVector(right, -1);

    if (moveVector.lengthSq() > 0) {
        moveVector.normalize().multiplyScalar(moveSpeed);
        camera.position.add(moveVector);
        controls.target.add(moveVector);
    }

    controls.update();
    hud.update(dummyTargets);
    renderer.render(scene, camera);
}

// Best practice: use setAnimationLoop instead of requestAnimationFrame for WebXR support
renderer.setAnimationLoop(animate);