# Benchmark request measurement

`measureRequest(options, { fetchImpl }?)` measures one Overpass POST without retrying.
Options provide URL, query, raw/form encoding, client deadline and decoded-body cap.
The injectable fetch supports offline tests; this helper never schedules traffic.

Network timing ends when the stream completes, before UTF-8 decoding, JSON parsing
and semantic analysis. `bytes` counts decoded fetch-body bytes, not compressed
wire traffic. `decodeMs` includes parsing and hashing. Start/end timestamps describe
the network interval. Partial bytes and timing survive errors. A deadline covers
headers and body; exceeding the byte cap aborts and cancels the stream.

Success requires HTTP success, an elements array, valid OSM element identities,
and no nonempty Overpass remark. Semantic SHA-256 includes canonical element
objects ordered by type/id, retaining array ordering within geometry and members.
Top-level response metadata is excluded; `osmTimestamp` retains the source date.
An empty elements array is valid and is distinguishable by `elementCount: 0`.

Example: `await measureRequest({ url, query, encoding: "raw" })`.
Tests in `benchmark-request.test.mjs` cover payload validity, encoding, canonical
hashes, body deadlines, byte caps and retained network failure causes without I/O.
