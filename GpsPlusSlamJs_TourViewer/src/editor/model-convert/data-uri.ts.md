# data-uri.ts

**Purpose:** a base64 `data:` URI decoded to its bytes, with the decoded size checked against a cap from the URI's length before anything is decoded. Used by the glTF repack (`gltf-repack.ts`) for buffers and pictures a `.gltf` carries inside its text.

## Public API

- `decodeDataUri(uri, maxBytes): DataUriRead`
  - `{ ok: true, bytes, mime }`: `mime` is the media type before any `;parameter`, possibly empty (`data:;base64,...`).
  - `{ ok: false, why: "too-large" }`: the payload would decode to more than `maxBytes`, judged from its length alone.
  - `{ ok: false, why: "malformed" }`: not a `data:` URI, no `;base64` as the last header part (glTF allows base64 only), a payload length that is no multiple of 4, or characters outside the strict base64 alphabet (whitespace, misplaced padding).
- `decodedLengthOf(payload)`: the exact decoded length of a strict base64 payload (length / 4 \* 3 minus its padding).

## Invariants

- The cap is checked before the alphabet and before `atob`, so an over-cap URI allocates nothing beyond the string the JSON parser already holds.
- Never throws, on any string.
- Strict on purpose: the input is untrusted text, and a lenient decoder would turn a garbled file into a half-decoded buffer instead of a refusal in words.
- The framework's `tour-media.ts` has its own private, uncapped base64 reader for images already inside a `.glb`; this one adds the cap and the strict alphabet the import needs.

## Example

```ts
const read = decodeDataUri(buffer.uri, remainingBytes);
if (!read.ok) return read.why === "too-large" ? tooLarge() : broken();
use(read.bytes);
```

## Tests

- `data-uri.test.ts`: decode with the MIME type, parameters and an empty type; every malformed shape; an over-cap URI refused from its length (its malformed tail proves no decode ran); exactly the cap; properties: a round trip of any bytes at any cap at least their length, every over-cap URI refused with an exact length, total on any string.
