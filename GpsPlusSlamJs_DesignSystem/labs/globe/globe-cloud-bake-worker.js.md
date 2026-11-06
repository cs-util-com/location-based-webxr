# globe-cloud-bake-worker.js

Purpose: the globe lab's worker file for the near clouds' bakes, the lab's copy of the editor's shell around `GpsPlusSlamJs_Globe/src/globe-cloud-bake-worker-core.ts`.

Public API: none; a worker entry, reached through the worker view (`/w/labs/globe/globe-cloud-bake-worker.js`).

Invariants: bakes once, ended by the page.

Example: `new Worker("/w/labs/globe/globe-cloud-bake-worker.js", { type: "module" })`.

Tests: the core's unit test; the lab's `#cloudNear=1` reaches it.
