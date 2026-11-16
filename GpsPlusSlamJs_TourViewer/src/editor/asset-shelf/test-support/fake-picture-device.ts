/**
 * A picture device for the model optimizer's tests: it "decodes" a JPEG
 * or PNG header's size and "encodes" a header of the asked size and type
 * (JPEG, PNG or WebP),
 * `bytesPerPixel` per pixel long, so the tour's size check reads the
 * result like a real picture. Every call is recorded. Test-only.
 */
import type { DecodedPicture, PictureDevice } from "../picture-step.js";
import { jpegHeader, pngHeader } from "./glb-fixtures.js";

export interface FakePicture extends DecodedPicture {
  readonly purpose: string | undefined;
}

export interface EncodeCall {
  readonly w: number;
  readonly h: number;
  readonly type: string;
  readonly quality: number;
}

function sizeOf(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0x89) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[3] === 0xc0) {
    return { width: view.getUint16(9), height: view.getUint16(7) };
  }
  throw new Error("not a picture");
}

/** The first 30 bytes of a lossy WebP of `w` x `h`: its RIFF header and
 *  the start of its VP8 frame, which is what a header reader needs. */
function webpHeader(w: number, h: number): Uint8Array {
  const out = new Uint8Array(30);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 22, true);
  out.set(new TextEncoder().encode("WEBPVP8 "), 8);
  out.set([0x9d, 0x01, 0x2a], 23);
  view.setUint16(26, w, true);
  view.setUint16(28, h, true);
  return out;
}

const HEADERS: Readonly<Record<string, (w: number, h: number) => Uint8Array>> =
  { "image/png": pngHeader, "image/webp": webpHeader };

export function fakePictureDevice(bytesPerPixel = 0.1): {
  device: PictureDevice<FakePicture>;
  encoded: EncodeCall[];
  decoded: FakePicture[];
  closed: () => number;
} {
  const encoded: EncodeCall[] = [];
  const decoded: FakePicture[] = [];
  let closed = 0;
  return {
    encoded,
    decoded,
    closed: () => closed,
    device: {
      async decode(source, purpose) {
        const size = sizeOf(new Uint8Array(await source.arrayBuffer()));
        const picture = {
          ...size,
          purpose,
          close: () => {
            closed++;
          },
        };
        decoded.push(picture);
        return picture;
      },
      encode(_picture, w, h, format) {
        encoded.push({ w, h, type: format.type, quality: format.quality });
        const header = (HEADERS[format.type] ?? jpegHeader)(w, h);
        const bytes = new Uint8Array(
          Math.max(header.length, Math.round(w * h * bytesPerPixel)),
        );
        bytes.set(header);
        return Promise.resolve(new Blob([bytes], { type: format.type }));
      },
    },
  };
}
