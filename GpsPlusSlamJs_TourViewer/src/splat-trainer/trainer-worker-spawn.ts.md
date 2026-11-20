# trainer-worker-spawn.ts

## Purpose

Starts the splat trainer's worker so that its request for Splat.js names
no page.

## Public API

- `workerShimSource(url) -> string` - the `blob:` start module: it first
  sets `globalThis[SHIM_IMPORT_KEY] = (u) => import(u);`, then
  `import "<url>";`, the address as one JSON string.
- `spawnTrainerWorker() -> WorkerLike` - a module worker started from that
  `blob:` module, which imports the built worker script
  (`splat-trainer.worker.ts?worker&url`) by its absolute address.

## Why the shim

A worker created from a `blob:` address inherits the creating page's
referrer policy, and `splat/index.html` sets `no-referrer`. But an
`import()` takes its referrer policy from the module it is written in:
the worker script itself is served by this site under the default policy,
so an `import()` written there sent the site's origin to the CDN (seen in
the browser test). The importer is therefore written in the `blob:`
module, and the worker loads Splat.js only through it. Splat.js's own
imports of its sibling files then name only that CDN file.

The importer is set before the worker script's message handler can run
(static imports evaluate first, but the worker reads the importer only
when a stretch starts). The `blob:` address is released when the worker
is terminated (revoking it at once could race the worker's load).

## Tests

`trainer-worker-spawn.test.ts`: the shim imports exactly the given
address, a quote staying inside the string, and its first line leaves an
`import()` under the shared key. The e2e
`playwright-tests/splat-trainer-gpu.spec.js` asserts the CDN request
carries no Referer.
