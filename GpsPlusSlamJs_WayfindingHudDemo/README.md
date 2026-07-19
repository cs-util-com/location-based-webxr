# Wayfinding HUD demo

Demo consuming `gps-plus-slam-app-framework`: the **wayfinding HUD** — edge arrows for off-screen targets, on-screen rings, live distance labels, and an anti-flicker hysteresis deadband ("show beyond X, hide when you arrive at Y").

Dual-mode (PhysicsDemo architecture):

- **Phone (AR)** — `pnpm dev`, open on an ARCore-capable device: tap surfaces to place waypoints; the HUD guides you back to every one of them. No GPS involved (the AnchorStarter owns the GPS-anchor story).
- **Desktop (walk simulator)** — open in any browser: a grid world with synthetic waypoints. **W/A/S/D** or arrow keys to walk, **drag** to look. The simulator drives the _real_ framework HUD in explicit-tick mode — this is also what the Playwright e2e asserts hysteresis against (no WebXR fakes).

Both modes share a live control panel (deadband distances, indicator scale, and a procedural ↔ image indicator toggle — the image path exercises the framework's `arrowSprite`/`circleSprite` URL loading with self-made PNG assets) that re-creates the HUD on change, plus a status line derived from the HUD's actual scene output.

## Commands

```bash
pnpm dev            # vite dev server (port 5183)
pnpm test           # full gate: format, lint, checks, typecheck, unit, e2e
pnpm run test:unit  # vitest only
pnpm run test:e2e   # Playwright (desktop simulator, real HUD)
```

Design/decision history: `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-17-1254-wayfinding-hud-demo-app-plan.md` and the HUD graduation plan referenced there.
