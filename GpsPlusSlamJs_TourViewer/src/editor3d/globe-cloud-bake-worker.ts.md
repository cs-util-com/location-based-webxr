# globe-cloud-bake-worker.ts

Purpose: the editor's worker file for the near clouds' bakes. A shell only: the logic is `gps-plus-slam-globe/cloud-bake-worker`, as the city's worker is.

Public API: none; a worker entry. Messages are the core's (`GpsPlusSlamJs_Globe/src/globe-cloud-bake-worker-core.ts.md`).

Invariants: it bakes once and is ended by the page. Why a worker: the bakes take about 1.3 s on a desktop and several seconds on a slow phone, on whichever thread runs them.

Example: `new Worker(new URL("./globe-cloud-bake-worker.ts", import.meta.url), { type: "module" })`.

Tests: the core's `globe-cloud-bake-worker-core.test.ts`; the shell is started by `editor3d-globe-near-clouds.spec.js`, which opens the editor with `clouds=new` (the near clouds are experimental; the default clouds bake nothing); it reads that the near clouds are there, not that their bake finished.
