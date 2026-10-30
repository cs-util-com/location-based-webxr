# upload-queue.ts - staged first uploads

- Purpose: the per-frame queue behind the globe editor's staged uploads
  (the full-globe editor plan 2026-10-27-1850, GV1b step 7). The page
  queues each station's first drawing - its materials compiled, its
  textures uploaded - and shows the station only once that job ran, so a
  large tour is drawn over several frames instead of in one long first
  frame.
- Public API:
  - `UPLOADS.perFrame` - the page's choice, 4 jobs a frame (declared, not
    measured on a phone; the sweep below shows the trade).
  - `createUploadQueue({ perFrame, now? })` -> the queue:
    - `add(key, job)` - one job per key; a key asked again keeps its place
      in the line with its newest job;
    - `drop(key)` - forget a key's job (a station removed before its turn);
    - `has(key)`, `pending()`;
    - `step()` - each frame before the drawing: runs at most `perFrame`
      jobs, first asked first run, and returns `{ ran, ms }`;
    - `stats()` - `{ pending, ran, worstFrameMs }` for the page's checks.
  - Type `UploadStep`.
  - RangeError for a `perFrame` that is not a whole number of at least one.
- Invariants and assumptions:
  - Pure: no WebGL. The jobs are the page's; the clock is injectable.
  - A job that throws counts as run, so a lost context cannot wedge the
    queue; the page's own error path (the frame's) is not involved.
  - `ms` is the time the step's jobs took, by the clock; with WebGL the
    driver may finish the upload later, so the measure is a lower bound.
- Example:

  ```ts
  const uploads = createUploadQueue({ perFrame: UPLOADS.perFrame });
  uploads.add(stationId, () => {
    renderer.compile(root, camera, scene);
  });
  // each frame, before the drawing:
  uploads.step();
  ```

- Tests: `upload-queue.test.ts` - the per-step limit and the order, one job
  per key and `drop`, a throwing job, the refusals, a property (every job
  once, in order, never more than `perFrame` a step), and the sweep the plan
  asks for: 40 jobs at a declared 3 ms each give a worst frame of 3, 12 and
  48 ms and 40, 10 and 3 frames to finish for `perFrame` 1, 4 and 16.
