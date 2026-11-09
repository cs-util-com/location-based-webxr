# asset-jobs.ts

**Purpose:** one shelf file's optimization job as a pure state machine (plain data, stored by `asset-shelf-slice.ts`).

## Public API

- `ShelfPhase`: `idle | queued | running | optimized | kept | failed`.
- `ShelfJob`: `{ phase, progress (0..1), reason?, retryable, attempts }`; `IDLE_JOB`.
- `MAX_JOB_ATTEMPTS` (2): how often in all a job whose Worker crashed is tried.
- Transitions, each returning the SAME object when it does not apply:
  - `jobQueued` (idle only), `jobStarted` (queued only; attempts + 1);
  - `jobProgress(job, f)` (running only; clamped to 1, never backwards, NaN and negatives ignored);
  - `jobOptimized` (running; progress 1), `jobKept(job, reason)` (running; not retryable);
  - `jobFailed(job, reason, { retryable, crashed? })` (running; a crash with attempts left goes back to queued);
  - `jobRetried` (a retryable failed or kept end; fresh attempts);
  - `originalUsed(job, reason)` (optimized only; ends kept and retryable, so the smaller file can be asked for again).

## Invariants

- A late message never moves a finished job: every transition is guarded by phase, and the identity return lets the slice skip a state change.
- A retry by the author resets `attempts`; only automatic crash retries count against `MAX_JOB_ATTEMPTS`.

## Tests

`asset-jobs.test.ts`: every transition, the guards, progress clamping, the crash retry limit, retry and "use the original".
