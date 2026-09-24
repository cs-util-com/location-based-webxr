# Realistic Sun Lighting & Shading AR Demo

> **Flagship showcase for physically grounded outdoor AR rendering with real-world solar lighting and contact shadows.**

This demo fuses five core solar modules from `gps-plus-slam-app-framework`:

1. **Real Sun Data Adapter** (`createRealSunDataAdapter`): Manages live device GPS and wall-clock inputs alongside simulation overrides.
2. **Sun Position** (`calculateSunPosition`): Calculates true solar azimuth, altitude, and North-Up-East (NUE) direction vectors.
3. **Visible Sun Disc** (`createVisibleSunDisc`): Renders a billboarded, camera-relative sun disc at the astronomical position in the sky dome.
4. **Sun Altitude Lighting** (`sunAltitudeToLighting`): Dynamically maps solar altitude angle to physical light intensity, ambient level, and color temperature (night, dawn, midday, golden hour, dusk).
5. **Sun Shadow Rig** (`createSunShadowRig`): Casts real-world aligned directional shadows tightly framed around placed digital content and onto an invisible `THREE.ShadowMaterial` ground-catcher plane at $Y = 0$.

---

## Architecture

```
                               ┌───────────────────────────┐
                               │   Device GPS / Clock      │
                               │   or Simulation Overrides │
                               └─────────────┬─────────────┘
                                             │
                                             ▼
                               ┌───────────────────────────┐
                               │   RealSunDataAdapter      │
                               └─────────────┬─────────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       │                                           │
                       ▼                                           ▼
         ┌───────────────────────────┐               ┌───────────────────────────┐
         │   calculateSunPosition    │               │   sunAltitudeToLighting   │
         │   (Azimuth / Altitude /   │               │   (Intensity / Color /    │
         │    NUE Direction Vector)  │               │    Ambient Level)         │
         └─────────────┬─────────────┘               └─────────────┬─────────────┘
                       │                                           │
           ┌───────────┴───────────┐                   ┌───────────┴───────────┐
           │                       │                   │                       │
           ▼                       ▼                   ▼                       ▼
┌────────────────────┐   ┌────────────────────────────────────────────────────────┐
│   VisibleSunDisc   │   │                     SunShadowRig                       │
│ (Sky Billboard at  │   │  (Directional Light along NUE Vector + Ground Shadows) │
│  Sun Coordinates)  │   │                                                        │
└────────────────────┘   └────────────────────────────────────────────────────────┘
```

---

## Features

- **WebXR Surface Hit-Testing & Tap-to-Place**: Detects horizontal real-world surfaces and anchors a simple 3D geometry for shadow testing.
- **Drift-Corrected GPS Anchoring**: Virtual objects stay planted in the real world using `createGpsAnchor` and `enableArWorldGroupAlignment`.
- **Astronomically Grounded Shadows**: Directional shadows align with true solar cardinal directions (+X North, +Y Up, +Z East).
- **Time Scrubbing Simulation**: Scrub 24 hours of daylight to watch shadows swing, elongate at golden hour, and extinguish at night.
- **Geographic Location Presets**: Test lighting and shadow behavior across Berlin, London, Tokyo, Sydney, and the Equator.

---

## Running Locally

```bash
# Start dev server on port 5193
pnpm run dev
```

Open `http://localhost:5193/` or test on an AR-compatible mobile browser via HTTPS/USB debugging.

---

## Testing

```bash
pnpm test
```
