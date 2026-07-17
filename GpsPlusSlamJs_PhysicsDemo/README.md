# gps-plus-slam-physics-demo

Physics balls bounce off the **reconstructed occupancy mesh** of a real space.
Two modes, one placement/spawn story:

- **AR (on device):** a live WebXR session reconstructs the room from the depth
  stream and balls bounce off it; tap to shoot a ball from the camera along your
  aim. Android + Chrome; verify with `pnpm dev` on a phone.
- **Desktop replay (the developer harness):** load a recorded walk (`.zip`) and
  replay it — the same occupancy mesh reconstructs from the replayed depth stream
  while you shoot balls against it. No phone, no WebXR, deterministic world.

The mode screen is **either-or**: a WebXR-capable device shows only **Start AR**;
the desktop shows only the recording loader. An always-on **FPS / memory panel**
(Stats.js, top-right) is shown in both modes so a developer can watch the framerate
and JS heap while the physics runs.

This is the next rung after `GpsPlusSlamJs_AnchorStarter`: it demonstrates
"developer content reacts to the real reconstructed world" and doubles as a
TDD-friendly harness (record once, iterate on the desktop).

## Status

Both modes implemented: desktop replay (load a recording → live occupancy mesh →
click to shoot balls that bounce & settle) and live AR (initAR → live occupancy →
tap to shoot from the camera). Physics is Rapier; the collider is a **trimesh**
rebuilt from the occluder's own geometry, so occlusion and physics share one mesh.
An always-on Stats.js FPS/memory panel is auto-shown. The physics logic is
deterministically tested headlessly with real Rapier; the WebXR AR glue is
device-verified (`pnpm dev` on a phone). Built on the framework's
`startReplaySession` + `pointer-picking` + the live-AR seams (`initAR`,
`subscribeReplayOccupancy`).

See the design + implementation docs in the private repo:
`GpsPlusSlamJs_Docs/docs/2026-07-15-0533-replay-as-dev-harness-and-physics-demo-design.md`
and its `…-0751-…-summary-and-followups.md` companion.

## Develop

```bash
cd GpsPlusSlamJs_PhysicsDemo
pnpm run dev     # builds the framework, serves on http://localhost:5182
pnpm test        # format + lint + typecheck + unit + e2e
pnpm run test:unit
pnpm run test:e2e
```

The framework is a workspace dependency consumed from its built `dist/`; the
scripts run `build:framework` first, so rebuild after changing framework source.
