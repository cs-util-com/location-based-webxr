# 3D look-dev page

A no-build page for developing the demos' 3D look (sky, atmosphere,
lighting, tone mapping) before it goes into an app. Plan and decisions:
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-23-0048-3d-sky-atmosphere-lookdev-plan.md`.

## Open it

```bash
pnpm run serve        # then http://localhost:4173/3d/ (or the LAN URL on a phone)
pnpm run shoot:3d     # screenshots of every preset × tone map × view
```

The page imports the framework's TypeScript SOURCE (`/fw/…`) and OsmDemo's
sun model (`/osm/sun-position.js`) through `serve.mjs`, which strips the types on the
fly. Edit a framework `.ts` file or a file here, refresh, see it. Nothing
here is a copy: the atmosphere judged on this page is the code the apps run.

## Files

- `index.html` — import map (three from the framework's lockfile-pinned
  copy), canvas, control plate built from `design.css` atoms.
- `lookdev.js` — renderer, presets, sliders, tone-map A/B, haze and cloud
  controls, camera views, and the `window.__lookdev` test surface. See
  `lookdev.js.md`. (A switch to OsmDemo's old Preetham sky was retired in
  M3, when OsmDemo adopted this sky.)
- `preset-glide.js` - the preset buttons' 5 s eased glide (round-3 plan
  2026-09-27-0532, feedback 1); `api.setPreset` and links stay instant.
- `stand-in-scene.js` — the world the sky is judged against.
- `parity.js` — GPU/CPU comparison of the atmosphere's LUTs.
- `gpu-timer.js` — GPU frame time for the cost readout, where the
  `EXT_disjoint_timer_query_webgl2` extension exists.
- `lookdev.css` — page layout only.
- `lookdev.smoke.spec.mjs` + `playwright.config.mjs` — the `test:e2e` gate
  stage.

## The smoke test (`pnpm run test:e2e`)

The only place the atmosphere's shaders are compiled, drawn and checked. A
three.js shader error throws nothing and only logs, so the smoke asserts
what three cannot hide:

- every preset draws a non-uniform image with no console error;
- at noon the high sky is bluer than the horizon;
- at golden hour the horizon toward the sun is brighter and warmer than the
  anti-sun horizon;
- LUT texels match the framework's CPU model at all five presets, with
  per-LUT bounds from the measured worst cases (this check found the
  multi-scattering resolution defect on its first run, and, swept to five
  presets, the linear altitude rows that darkened the sky in haze);
- on-screen sky pixels, tone mapping off, match the CPU model along the same
  view direction within 4 of 255 levels (the lookup path, scale and colour
  space);
- the haze fades the distant ridges several times more than the near city,
  moves every changed ridge pixel TOWARD the sky above it, and at golden hour
  leaves the distance brighter toward the sun than away from it;
- raising the cloud cover changes the upper sky;
- lit geometry, not just a lit sky, for every preset;
- the framework's CPU fallback sky (for devices without float render
  targets) agrees with the GPU sky per preset: exposure within 10 %, horizon
  within 20 %;
- the lake's waves move on the GPU, and the lake warms with the sky from
  noon to golden hour;
- the desktop pipeline with bloom switched off draws the phone picture
  away from edges (≤ 3 levels, three presets); its MSAA cuts the edge
  pixels more than 30 levels off the canvas to ≤ 75 % of the no-MSAA count;
  and its bloom glows around the TRUE sun position (+4.7), veils < 15 % of
  the frame and darkens nothing;
- the preset buttons glide (`preset-glide.smoke.spec.mjs`): eased at
  t = 0.25, the short azimuth arc, a retarget from the current state, the
  exact end and the hash written then, a link that cancels it, and no
  program compiled mid-glide across the 2° shadow floor.

Port 5198 (aux range, `docs/dev-server-ports.md`), bound to 127.0.0.1, never
reused, one worker (SwiftShader measures queueing, not work, in parallel).
Colour claims are relative, never golden images.
