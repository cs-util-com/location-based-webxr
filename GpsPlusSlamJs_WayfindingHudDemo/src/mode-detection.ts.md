# mode-detection.ts

- **Purpose:** decide the entry mode — live AR (WebXR `immersive-ar` supported) vs the desktop walk simulator — and apply the either-or mode screen (PhysicsDemo pattern).
- **Public API:**
  - `detectArSupport(xr?): Promise<boolean>` — defensive probe; missing `navigator.xr`, missing `isSessionSupported`, or a throwing probe all resolve `false` (run the simulator, never crash).
  - `applyModeEntry(arSupported, { startArButton, simNote })` — shows exactly ONE entry: the Start-AR button on capable devices, the simulator hint elsewhere. Elements are structural (`Pick<HTMLElement, "hidden">`) so tests pass plain objects.
- **Invariants:** either-or — never both entries visible; the probe never rejects.
- **Example:** `applyModeEntry(await detectArSupport(), { startArButton, simNote })`.
- **Tests:** `mode-detection.test.ts` (probe fallbacks, probe pass-through, both entry states).
