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

## `--hosts` defaults to the WHOLE pool, and refuses one operator

The comparison mode (`--compare-map3d`) compares every endpoint in
`DEFAULT_OVERPASS_ENDPOINTS` unless `--hosts` narrows it. Narrowing to a single
OPERATOR is refused unless `--accept-single-host` is also passed.

**Why the refusal exists.** On 2026-09-20 a one-statement relation query
measured 1.7-2.2x faster over two cities and two resolutions, shipped, and was
reverted within two hours: across the full pool it halved the per-request
success rate, and `maps.mail.ru` - weight 3 of 8 in the operator draw - went
3/3 to 0/3. The benchmark had never asked the other endpoints, because
`--hosts` defaulted to one hostname.

That write-up DID record "one operator, one instance... inferred, not measured"
in its limitations, before shipping, and it changed nothing. **A named
limitation is not a mitigation**, which is why this is a refusal rather than a
warning: narrowing the pool now has to appear in the command line, and therefore
in the artifact.

The guard keys on OPERATOR, not hostname: `lz4`, `z` and `overpass-api.de` are
three names for one operator, and it was one of those three that produced the
misleading verdict.
