# Sun-Driven Lighting presentation

## Presentation day

From the repository root, using Node >=26 and the repository-defined pnpm version (currently 11.11.0), with workspace dependencies already installed:

```powershell
node presentations/sun-driven-lighting/launch.mjs
```

Wait for **Presentation ready**, then open **http://127.0.0.1:5193/**.

- **F** = fullscreen; **S** = speaker notes (allow the popup).
- Click the five **LIVE DEMO** cues to open the corresponding apps in new tabs. Close the demo tab to return to the same slide.
- **Ctrl+C** in the launcher's terminal stops the presentation and all five demo servers. Keep that terminal open while presenting.
- Arrow keys navigate; Esc opens the overview; B blanks the screen.

| Application | URL |
| --- | --- |
| Presentation | http://127.0.0.1:5193/ |
| Sun Position | http://127.0.0.1:5188/ |
| Visible Sun Disc | http://127.0.0.1:5189/ |
| Sun Altitude Lighting | http://127.0.0.1:5191/ |
| Shadow Rig | http://127.0.0.1:5190/ |
| Real Data Adapter | http://127.0.0.1:5192/ |

The launcher uses each demo's existing `dev` command. Each command builds the framework first, so startup is sequential to avoid concurrent writes to its build output. Allow a few minutes. Startup checks are bounded; failures print the relevant output and stop owned processes. Occupied ports cause a clear error, rather than silently opening another app. Stop the conflicting server yourself and retry.

The ports follow `docs/dev-server-ports.md`: explicit command-line overrides resolve the stale Shadow Rig/Lighting Vite defaults without changing either demo. The presentation uses 5193; stop any other application using that port before launching. All servers bind to local loopback.

## Manual fallback

Run each command from the repository root in its own terminal, waiting for the previous demo to finish its framework build before starting the next:

```powershell
node presentations/sun-driven-lighting/serve.mjs 5193
pnpm.cmd --dir GpsPlusSlamJs_SunPositionDemo run dev --host 127.0.0.1 --port 5188 --strictPort
pnpm.cmd --dir GpsPlusSlamJs_VisibleSunDiscDemo run dev --host 127.0.0.1 --port 5189 --strictPort
pnpm.cmd --dir GpsPlusSlamJs_SunAltitudeLightingDemo run dev --host 127.0.0.1 --port 5191 --strictPort
pnpm.cmd --dir GpsPlusSlamJs_SunShadowRigDemo run dev --host 127.0.0.1 --port 5190 --strictPort
pnpm.cmd --dir GpsPlusSlamJs_RealSunDataAdapterDemo run dev --host 127.0.0.1 --port 5192 --strictPort
```

`pnpm.cmd` avoids Windows PowerShell script-policy issues. On macOS/Linux use `pnpm`. Stop every manual terminal with Ctrl+C (confirm a batch termination prompt if Windows displays one).

## Offline and rehearsal

The slides and reveal.js assets are local. `index.html` also opens directly without a server; speaker notes require the HTTP server. Demo links need the corresponding local servers running. Once dependencies are installed, no CDN is needed. Live GPS requires browser permission and device availability; the adapter's fixed inputs are available for deterministic demonstration.

13 slides, approximately 14:40 including short demos, plus Q&A. Rehearse the five demos before presenting. Transitions are 480 ms opacity-only fades, including in reduced-motion mode; other element animations are disabled in that mode.

## Runtime verification

Uses the existing Recorder Playwright dependency and installed Edge; no new dependency:

```powershell
node presentations/sun-driven-lighting/check-runtime.mjs
node presentations/sun-driven-lighting/check.mjs
```

The first command launches servers as child processes, waits for bounded readiness, checks all five links/apps, return navigation, fade, fullscreen, speaker view, port-conflict handling and cleanup. It stops its servers when finished. Use `--existing` to check a launcher you already started; that mode leaves your servers running. The second checks all slides at three resolutions, direct-file opening and absence of remote presentation requests. Reports are under `assets/`; these are presentation checks, not astronomy or AR validation tests.

## Files and media

`index.html` holds unchanged slide wording and notes; `deck.css` the styling; `deck.js` reveal setup. `runtime-config.mjs` records launcher ports; links in `index.html` use the same URLs and are checked against that configuration. No demo or production source was changed. Existing dev commands regenerate framework build output and Vite caches as usual.

Slide 11 shows three real outdoor AR screenshots: the placed cube, cube shading, and the real sun alongside the virtual Sun Disc, with a compact integration pipeline. Slide 13 has the centered closing and the bottom line "Contributions to the source repository: Pull request pending" on the navy background. Task 1 uses the supplied recorder screenshot. All four screenshots are included under `assets/` with relative paths.

Local reveal.js 5.2.1 and its notes plugin retain their MIT license under `vendor/reveal/`.
## Export the PDF

To regenerate the PDF from the current presentation, run from the repository root:

```powershell
node presentations/sun-driven-lighting/export-pdf.mjs
```

This uses the existing Recorder Playwright dependency and installed Edge. It writes `presentations/sun-driven-lighting/sun-driven-lighting-presentation.pdf`: 13 landscape 16:9 pages, one per slide, without notes or navigation. Export styling is applied only in the temporary browser; the HTML deck and its fade transitions are unchanged. No demo servers need to be running.
