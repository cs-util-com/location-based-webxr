# Overpass endpoint benchmark

On-demand live network instrument, never invoked by a test gate. Legacy default and `--matrix` modes retain their historical behavior. Their HTTP-success records do not establish payload validity.

## Controlled comparison

```sh
node scripts/benchmark-endpoints.mjs --compare-map3d --site manhattan --profiles map3d,encoded,geom-only,timeout180,full-production180,preview --repeats 2 --budget-minutes 15 --out overpass-comparison-YYYY-MM-DD-parameters.json
node scripts/benchmark-endpoints.mjs --compare-map3d --site cologne --res 10 --profiles full-production180,everything,everything-areal --repeats 2 --out overpass-comparison-YYYY-MM-DD-all-res10.json
```

`--site manhattan` uses the owner's exact rectangle. `--site cologne --res 7` uses the demo's default position and production tile resolution. `--hosts` accepts comma-separated exact known hostnames, default `overpass-api.de`; `--profiles` accepts named profiles in `benchmark-map3d.mjs`. `--dry-run` prints exact queries and execution order without requests or artifact writes.

Comparison artifacts require a new filename in `docs/`; existing files are never overwritten, including with `--force`. Each row records its exact query, endpoint, bbox, encoding, order, validated response and decoded-byte counts. Full production query parity is guarded by a test against the actual query builder. Browser caching, CORS, rendering and application retries are outside this Node measurement.

The comparison runner enforces operator cooldown, failure stopping, byte budget and network deadlines. See [runner](benchmark-comparison-run.mjs.md), [profiles](benchmark-map3d.mjs.md) and [measurement](benchmark-request.mjs.md). Offline tests live beside those modules and execute through `pnpm run test:unit scripts/`. Never run the historical full matrix accidentally while investigating one contrast.
