import * as THREE from 'three';
import { ARWayfindingHUD } from './ARWayfindingHUD.js';

// ---------------------------------------------------------------------------
// Pre-defined waypoint targets (world-space offsets in meters from the AR
// session origin, i.e. where the user was standing when they tapped Enter AR).
// Adjust these values to place targets at meaningful distances for your test.
// ---------------------------------------------------------------------------
const waypoints = [
    new THREE.Vector3( 3,  0,   0),   // 10 m to the right
    new THREE.Vector3(-2,   0,   5),   // 8 m left, 5 m forward
    new THREE.Vector3( 0,   0, -4),   // 15 m behind
    new THREE.Vector3( 1,   2,   2),   // elevated target
];

// ---------------------------------------------------------------------------
// Three.js scene + renderer
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;

// Insert canvas inside #ar-root so it sits under the DOM overlay
const arRoot = document.getElementById('ar-root');
arRoot.insertBefore(renderer.domElement, arRoot.firstChild);

// ---------------------------------------------------------------------------
// Visual markers for each waypoint (small green spheres, visible in AR)
// ---------------------------------------------------------------------------
waypoints.forEach((pos) => {
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0x4caf50, wireframe: true })
    );
    mesh.position.copy(pos);
    scene.add(mesh);
});

// ---------------------------------------------------------------------------
// HUD config — distanceMin/Max tuned for real-world walking distances.
// Optional arrowSprite / circleSprite can be set here (see ARWayfindingHUD.js).
// ---------------------------------------------------------------------------
const hudConfig = {
    distanceMin: 1.5,
    distanceMax: 3.0,
    hudDistance: 1.5,
    indicatorScale: 0.4,  // shrink indicators for mobile screen
    labelScale: 0.5,      // shrink distance labels for mobile screen
    arrowSprite: './src/assets/Arrow-Right-1-icon-1515697076.png',
    circleSprite: './src/assets/Circle-Logo-Template-PNG-HD-2761340067.png',
};

let hud = null;

// ---------------------------------------------------------------------------
// Status overlay helpers
// ---------------------------------------------------------------------------
const statusEl = document.getElementById('status');
const enterArBtn = document.getElementById('enter-ar');

function setStatus(text) {
    statusEl.textContent = text;
}

// ---------------------------------------------------------------------------
// WebXR support check
// ---------------------------------------------------------------------------
async function checkXrSupport() {
    if (!navigator.xr) {
        setStatus('WebXR not available.\nUse Chrome on an ARCore-capable Android device.');
        return;
    }
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (supported) {
        enterArBtn.textContent = 'Enter AR';
        enterArBtn.disabled = false;
        setStatus('AR supported.\nTap "Enter AR" to start.');
    } else {
        setStatus('immersive-ar not supported on this device.');
    }
}

// ---------------------------------------------------------------------------
// Start WebXR AR session
// ---------------------------------------------------------------------------
async function startAR() {
    enterArBtn.disabled = true;
    enterArBtn.textContent = 'Starting…';
    setStatus('Starting AR session…');

    try {
        const session = await navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['local-floor'],
            optionalFeatures: ['dom-overlay'],
            domOverlay: { root: arRoot },
        });

        await renderer.xr.setSession(session);

        // Instantiate HUD once the session (and therefore the XR camera) is live
        hud = new ARWayfindingHUD(scene, camera, renderer, hudConfig);
        hud.setWaypoints(waypoints);

        enterArBtn.textContent = 'AR running';
        setStatus('AR active.\nWalk around to test the HUD indicators.');

        session.addEventListener('end', () => {
            if (hud) {
                hud.destroy();
                hud = null;
            }
            enterArBtn.textContent = 'Enter AR';
            enterArBtn.disabled = false;
            setStatus('Session ended.\nTap "Enter AR" to restart.');
        });
    } catch (err) {
        enterArBtn.disabled = false;
        enterArBtn.textContent = 'Retry — Enter AR';
        setStatus('Failed to start AR:\n' + err.message);
    }
}

enterArBtn.addEventListener('click', () => { void startAR(); });

// ---------------------------------------------------------------------------
// Resize handler
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Render loop — physical device movement drives the camera automatically via
// the WebXR runtime (ARCore/ARKit); no keyboard input needed.
// ---------------------------------------------------------------------------
renderer.setAnimationLoop((timestamp) => {
    if (hud) {
        hud.update();
    }
    renderer.render(scene, camera);
});

// Kick off support check on load
void checkXrSupport();