/**
 * zxing-wasm as a Node test oracle: an independent, real QR decoder for unit
 * tests, instantiated from the installed package file (never the CDN).
 *
 * Test-only. `zxing-wasm` is a framework devDependency, exact-pinned because
 * upstream releases have shifted reported corner positions by 1-2 px, and the
 * tolerances in the tests that use this oracle depend on it.
 * See zxing-node.ts.md.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  prepareZXingModule,
  readBarcodes,
  type ReaderOptions,
  type ReadResult,
} from 'zxing-wasm/reader';
import type { RgbaImage } from '../ar/qr/qr-frontend';

let loading: Promise<unknown> | null = null;

/**
 * Instantiate the zxing reader module once per test process, from the local
 * `zxing_reader.wasm`. Passing `wasmBinary` bypasses the library's default
 * `locateFile`, which would fetch the binary from jsDelivr.
 */
export function loadZxingReaderForNode(): Promise<void> {
  if (loading === null) {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve('zxing-wasm/reader/zxing_reader.wasm');
    const bytes = readFileSync(wasmPath);
    const wasmBinary = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );
    loading = prepareZXingModule({
      overrides: { wasmBinary },
      fireImmediately: true,
    });
  }
  return loading.then(() => undefined);
}

/**
 * Decode QR codes in an RGBA buffer. Defaults to `formats: ['QRCode']` (an
 * empty list means every format, 3-7x slower); any other option passes through.
 * Throws `RangeError` when the buffer length is not `width * height * 4`.
 */
export async function readQrCodes(
  image: RgbaImage,
  options: ReaderOptions = {}
): Promise<ReadResult[]> {
  if (image.data.length !== image.width * image.height * 4) {
    throw new RangeError(
      `zxing-node: expected ${image.width * image.height * 4} bytes for ` +
        `${image.width}x${image.height} RGBA, got ${image.data.length}`
    );
  }
  await loadZxingReaderForNode();
  // zxing-wasm duck-types ImageData: data + width + height is all it reads.
  const imageData = {
    data: image.data,
    width: image.width,
    height: image.height,
    colorSpace: 'srgb',
  } as ImageData;
  return readBarcodes(imageData, { formats: ['QRCode'], ...options });
}
