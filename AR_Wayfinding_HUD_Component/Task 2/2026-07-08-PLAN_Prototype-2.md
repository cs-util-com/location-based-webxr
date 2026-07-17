# Architectural Plan: AR Wayfinding HUD — Mobile AR Test Environment

## 1. Problem Statement and Use Case

Prototype 1 produced the `ARWayfindingHUD` module and verified it in a desktop Three.js sandbox (keyboard-driven movement). To validate the HUD in a real AR context — where physical device movement drives the camera — a second test environment is required. This environment runs on a mobile device with ARCore, renders pre-defined world-space waypoints, and integrates the `ARWayfindingHUD` module as a direct copy.

## 2. Objectives and Success Criteria

1. **Module copy:** `ARWayfindingHUD.js` and `DistanceLabel.js` are copied 1:1 from `AR_Wayfinding_HUD_Component/Task 2/AR-wayfinding-HUD-Prototype-1/` into `AR_Wayfinding_HUD_Component/Task 2/AR-wayfinding-HUD-Prototype-2/`. No relative cross-folder imports are used, keeping both projects self-contained.
2. **Real AR session:** The app opens a WebXR `immersive-ar` session on an ARCore-capable Android device via Chrome.
3. **Pre-defined waypoints:** A fixed set of world-space offsets in meters from the AR session origin is hard-coded in `main.js`. No GPS required — the session origin is wherever the user was standing when they tapped "Enter AR".
4. **Physical locomotion:** The WebXR runtime (ARCore) drives the camera pose automatically from device movement. No keyboard or gamepad input.
5. **Mobile accessibility:** Local HTTPS dev server via `vite-plugin-mkcert` — no accounts, no external tunnels, no APK build required.

## 3. Project Structure

The project is a direct copy of `AR_Wayfinding_HUD_Component/Task 2/AR-wayfinding-HUD-Prototype-1/`, placed at `AR_Wayfinding_HUD_Component/Task 2/AR-wayfinding-HUD-Prototype-2/`, with `main.js` replaced for the AR context.

```plaintext
AR_Wayfinding_HUD_Component/
└── Task 2/
    └── AR-wayfinding-HUD-Prototype-2/
    ├── index.html          ← AR UI: #ar-root, #status overlay, #enter-ar button
    ├── package.json        ← Vite + three + vite-plugin-mkcert
    ├── vite.config.js      ← mkcert plugin + host: true
    └── src/
        ├── main.js         ← AR session bootstrap, waypoints, HUD integration
        ├── ARWayfindingHUD.js   ← copied from Prototype 1, extended for mobile
        ├── DistanceLabel.js     ← copied from Prototype 1, extended for mobile
        └── assets/         ← optional HUD sprites (copied from Prototype 1)
```

### 3.1 Framework Choice: Vite + Vanilla JS

Identical stack to `AR_Wayfinding_HUD_Component/Task 2/AR-wayfinding-HUD-Prototype-1/`. No TypeScript, no Angular — plain ES modules with Vite as the bundler. This keeps the project self-contained and the `ARWayfindingHUD.js` module usable without any transpilation step.

## 4. Mobile Accessibility — Local HTTPS with vite-plugin-mkcert

WebXR requires a secure context (HTTPS). The chosen approach uses **`vite-plugin-mkcert`** as a devDependency — it automatically installs mkcert internally and generates a locally-trusted certificate on first run. No account, no external service, no manual certificate management required.

```bash
npm install          # installs vite + three + vite-plugin-mkcert
npm run dev:host     # starts HTTPS dev server exposed on local network
```

Vite outputs a `https://192.168.x.x:5173` Network URL. The phone (on the same Wi-Fi) opens this URL in Chrome. On first visit Chrome shows a certificate warning — tap "Advanced → Proceed" once, then WebXR is available.

### Rejected alternatives

| Option | Reason rejected |
|---|---|
| `@vitejs/plugin-basic-ssl` | Does not support Vite 8 (`peer vite@"^3–6"`) |
| Vite built-in `https: true` | Produces `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` on Android Chrome |
| ngrok | Requires account registration |
| APK build (Capacitor) | Disproportionate complexity for a test environment |

## 5. Waypoint Strategy

Waypoints are defined as `THREE.Vector3` meter-offsets from the AR session origin (the user's position at session start). This allows testing anywhere without GPS.

```javascript
// src/main.js
const waypoints = [
    new THREE.Vector3( 10,  0,   0),   // 10 m to the right
    new THREE.Vector3(-8,   0,   5),   // 8 m left, 5 m forward
    new THREE.Vector3( 0,   0, -15),   // 15 m behind
    new THREE.Vector3( 5,   2,   8),   // elevated target
];
```

Each waypoint also gets a small green wireframe sphere in the Three.js scene as a visual marker.

## 6. Integration of `ARWayfindingHUD`

The module is instantiated after `renderer.xr.setSession()` resolves successfully, ensuring the XR camera is live before the HUD accesses `renderer.xr.getCamera()`.

```javascript
await renderer.xr.setSession(session);
hud = new ARWayfindingHUD(scene, camera, renderer, hudConfig);
```

The render loop calls `hud.update(waypoints)` every frame via `renderer.setAnimationLoop`. The HUD is set to `null` on session end and re-created on the next session start.

```javascript
renderer.setAnimationLoop(() => {
    if (hud) hud.update(waypoints);
    renderer.render(scene, camera);
});
```

### HUD config for real-world distances
```javascript
const hudConfig = {
    distanceMin: 1.5,   // hide indicator when closer than 1.5 m
    distanceMax: 3.0,   // show circle indicator beyond 3 m
    hudDistance: 1.5,   // HUD plane 1.5 m in front of camera
    indicatorScale: 0.4, // shrink arrow/circle for mobile screen
    labelScale: 0.5,     // shrink distance labels for mobile screen
};
```

## 7. Mobile Optimisation (post-first-test fixes)

After first on-device testing, three issues were identified and resolved:

### 7.1 Indicators and labels too large on mobile

All indicator and label sizes were calibrated for a desktop monitor. On a phone screen they appeared disproportionately large and overlapping.

**Fix — `indicatorScale` / `labelScale` config params (ARWayfindingHUD.js):**
Two optional config parameters were added. They apply a uniform scale multiplier to all sprite/mesh sizes and label sizes. Defaults to `1.0` (no change on desktop). Set to `< 1.0` for mobile.

**Fix — `hudDistance`-relative label sizing (ARWayfindingHUD.js + DistanceLabel.js):**
Label sprite size and label offset distances (`circleY - offset`, arrow label offset) were previously hardcoded absolute meter values (`0.2 m`, `0.25 m`). These are now computed relative to `hudDistance`:
- Circle label offset: `hudDistance × 0.08`
- Arrow label offset: `hudDistance × 0.1`
- Label sprite size: `0.16 × hudDistance × labelScale` (width), `0.08 × hudDistance × labelScale` (height)

This ensures labels look proportionally correct regardless of the configured `hudDistance`.

### 7.2 Off-position indicators in WebXR (projection matrix bug)

The `fov` and `aspect` properties of the XR sub-camera (`renderer.xr.getCamera().cameras[0]`) are not reliably updated by Three.js during a WebXR session. Using them to compute `frustumHeight`/`frustumWidth` produced incorrect values, causing circle and arrow indicators to be placed at wrong screen positions.

**Fix — read frustum directly from `projectionMatrix` (ARWayfindingHUD.js):**
```javascript
// WebXR path: extract from projection matrix
const m = evalCamera.projectionMatrix.elements;
const tanHalfFovY = 1.0 / m[5];  // m[5] = 1/tan(fovY/2)
const tanHalfFovX = 1.0 / m[0];  // m[0] = 1/tan(fovX/2)
frustumHeight = 2.0 * this.hudDistance * tanHalfFovY;
frustumWidth  = 2.0 * this.hudDistance * tanHalfFovX;
```
The non-XR desktop path continues to use `fov`/`aspect` as before.

## 8. Key Technical Constraints

| Constraint | Resolution |
|---|---|
| WebXR requires HTTPS | `vite-plugin-mkcert` provides locally-trusted cert |
| `renderer.xr` not yet active at construction time | HUD is instantiated only after `setSession()` resolves |
| `THREE.Sprite.material.rotation` for arrow sprites | Handled in `ARWayfindingHUD.js` (unchanged from Prototype 1) |
| DOM Overlay nesting — status/button must be inside `#ar-root` | `index.html` wraps all UI in `#ar-root`; canvas inserted as first child of same element |
| `fov`/`aspect` unreliable on XR sub-camera | Frustum now computed from `projectionMatrix.elements` in XR path (see Section 7.2) |
| Indicators/labels too large on mobile | `indicatorScale`, `labelScale` params + `hudDistance`-relative offsets (see Section 7.1) |

## 9. Local Development Workflow

```bash
# 1. Start HTTPS dev server (first run generates cert automatically)
npm run dev:host

# 2. Open on phone (same Wi-Fi)
#    https://<laptop-ip>:5173
#    Accept certificate warning once → tap "Enter AR" → walk around

# if you are in a public network, use hotspot on the host device and connect the phone to the hotspot
```
