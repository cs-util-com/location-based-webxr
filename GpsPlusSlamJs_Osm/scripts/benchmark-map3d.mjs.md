# map3d comparison profiles and schedule

Pure request construction and round scheduling for the existing endpoint benchmark runner. This module sends no requests.

`buildComparisonProfiles({ bbox, keys })` returns named query profiles with raw/form encoding and declared timeout. The caller supplies production selector keys. `map3d` preserves the supplied building request; `encoded`, `geom-only`, and `timeout180` each change one variable. `full-production180` mirrors the production query, with byte-for-byte parity tested against `buildTileQuery`. `preview` selects building/building-part ways and areal relations. `everything` selects all nodes, ways and relations; `everything-areal` limits only relation types.

Three further arms decompose the production query itself, because the 2026-09-19 run established that first-byte cost dominates and tracks selector count but not which of production's 64 statements carries it. `nw-only-32` keeps only the 32 `nw["key"]` statements, `rel-only-32` only the 32 `relation["key"]["type"~...]` statements, and rejoining the two reproduces `full-production180` byte for byte (asserted). `prod-33` keeps every key and collapses the 32 relation statements into a single `relation["type"="multipolygon"]`, which is the one arm here with a plausible route to production.

`prod-33` and `everything-areal` differ in a way worth stating: `boundary` is **not** among the 32 selector keys, so in production a `type=boundary` relation is admitted only when it also carries a selected key. `everything-areal` drops that qualification and therefore newly admits every administrative boundary crossing the box, emitting each one's full geometry under `out geom` - it is larger than production on relations, not smaller. `prod-33` omits the `boundary` alternative for exactly that reason.

`planComparisonCells({ hosts, sites, repeats = 3, profilesForSite })` returns cells with unique IDs, profile ID, query, encoding, timeout, endpoint/operator, site ID, bbox and one-based round. Sites have `{ id, bbox }`; hosts are URLs. `profilesForSite(site)` can select a subset of profiles. Each round covers every site/host/profile before another round starts. Deterministic rotation/reversal changes arm order across rounds; this counterbalances order without claiming randomized independent samples.

Bounds must be finite, ordered geographic coordinates; repeats must be positive integers; dimension IDs must be nonempty and unique. Invalid inputs throw before any schedule is returned. No antimeridian-crossing boxes are accepted. The runner owns cooldown, refusal handling, cancellation and byte/time limits; a schedule is not permission to bypass those controls.

Example: `planComparisonCells({ hosts, sites, profilesForSite: (site) => buildComparisonProfiles({ bbox: site.bbox, keys }).filter((p) => ["map3d", "full-production180"].includes(p.id)) })`.

Verification: `pnpm run test:unit scripts/benchmark-map3d.test.mjs` checks exact request shape, production parity, isolated variants, broad-query semantics, rejected input, complete rounds, unique IDs and varied profile subsets/repeat counts. No live server is involved.
