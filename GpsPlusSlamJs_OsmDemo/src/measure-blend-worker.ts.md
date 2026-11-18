# measure-blend-worker.ts

- **Purpose:** the transfer probe of the time-of-day blend measurement (`measure-blend.ts`). It allocates `k` colour buffers of `bytes` each and posts them to the page, copied or transferred.
- **Public API:** one message in, `{ bytes, k, transfer }`; one message out, `{ buffers, sentAt }`, where `sentAt` is `performance.timeOrigin + performance.now()` read just before the post, or `{ error }` for a request that is not two non-negative integers (`k` at least 1).
- **Invariants:** every buffer is written through before the clock starts, so the page's time is the post and the delivery, not the allocation. A copied post includes its structured-clone serialisation; a transferred one detaches the worker's buffers.
- **Tests:** none; a measurement tool on a spike branch, never merged.
