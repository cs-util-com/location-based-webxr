# data-uri.ts

**Purpose:** a base64 `data:` URI decoded to its bytes, with the decoded size checked against a cap from the URI's length before anything is decoded. The one decoder for glTF data URIs in this workspace: the tour media check (`ar/tour-media.ts`, images inside a `.glb`) and the Tour Viewer's glTF repack (buffers and pictures inside a `.gltf`) both use it. Deep-imported as `gps-plus-slam-app-framework/utils/data-uri`, never through the `utils` barrel.

## Public API

- `decodeDataUri(uri, maxBytes): DataUriRead`
  - `{ ok: true, bytes, mime }`: `mime` is the media type before any `;parameter`, possibly empty (`data:;base64,...`).
  - `{ ok: false, why: "too-large", size }`: the payload would decode to `size` bytes, more than `maxBytes`, judged from its length alone.
  - `{ ok: false, why: "malformed" }`: not a `data:` URI by `isDataUri` (the scheme and the `;base64` token are read in any letter case, as fetch reads them), no `;base64` as the last header part (glTF allows base64 only), a payload length that is no multiple of 4 (missing padding), or characters outside the strict base64 alphabet (whitespace, misplaced padding).
- `isDataUri(uri)`: whether three.js reads `uri` as embedded data rather than resolving and fetching it: its own test, `/^data:.*,.*$/i` (any letter case, a comma, no line break). The one answer to "is this a data URI" for every reader of a model's URIs (`ar/tour-media.ts`, the Tour Viewer's glTF repack, and `decodeDataUri` itself), so none is stricter or looser than three.
- `decodedLengthOf(payload)`: the exact decoded length of a strict base64 payload (length / 4 \* 3 minus its padding).

## Invariants

- The cap is checked before the alphabet and before `atob`, so an over-cap URI allocates nothing beyond the string the JSON parser already holds.
- Never throws, on any string.
- Strict on purpose: the input is untrusted text, and a lenient decoder (plain `atob` skips whitespace and accepts missing padding) would turn a garbled file into a half-decoded buffer instead of a refusal in words. The tour check and the import therefore agree on which URIs are readable.
- `tour-media.ts` passes the `.glb`'s own length as the cap: a URI inside the file can never decode to more bytes than the file has.

## Example

```ts
import { decodeDataUri } from 'gps-plus-slam-app-framework/utils/data-uri';

const read = decodeDataUri(buffer.uri, remainingBytes);
if (!read.ok) return read.why === 'too-large' ? tooLarge(read.size) : broken();
use(read.bytes);
```

## Tests

- `data-uri.test.ts`: decode with the MIME type, parameters and an empty type; the scheme and token in upper and mixed case; `isDataUri` on fixed cases and, as a property, equal to three's regex on any string; every malformed shape; an over-cap URI refused from its length with its size (its malformed tail proves no decode ran); exactly the cap; properties: a round trip of any bytes at any cap at least their length, every over-cap URI refused with its exact size, total on any string.
- `ar/tour-media.test.ts`: an image data URI with a space or without its padding is not readable.
