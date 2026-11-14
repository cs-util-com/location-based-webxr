/**
 * A picture device for the model optimizer's tests: it "decodes" a JPEG
 * or PNG header's size and "encodes" a header of the asked size and type,
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
        const header =
          format.type === "image/png" ? pngHeader(w, h) : jpegHeader(w, h);
        const bytes = new Uint8Array(
          Math.max(header.length, Math.round(w * h * bytesPerPixel)),
        );
        bytes.set(header);
        return Promise.resolve(new Blob([bytes], { type: format.type }));
      },
    },
  };
}
