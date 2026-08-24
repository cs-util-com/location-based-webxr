/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';

import { QR_OPTIONS, generateQr, renderQrSvg } from './qr-render.js';

/**
 * Why these tests matter: a generated QR is often verified in the worst
 * possible place — outdoors, by someone who cannot debug it. So the contract
 * worth pinning is narrow but absolute: the string reaches the encoder
 * byte-identical. A helpful-looking trim or re-encode here would silently
 * corrupt a presigned URL.
 *
 * `qrcode` is mocked rather than exercised: its encoding is its own
 * project's problem, and rendering a real SVG would test the library, not
 * this wrapper. (Module mock, not `vi.spyOn` on the namespace — an ESM
 * default export's methods are not writable.)
 */

vi.mock('qrcode', () => ({
  default: { toString: vi.fn(() => Promise.resolve('<svg>fake</svg>')) },
}));

const toString = vi.mocked(QRCode.toString);
const URL_WITH_QUERY =
  'https://tours.example.com/viewer/?tour=https%3A%2F%2Fcdn%2Fx.zip%3Fsig%3Dabc%26exp%3D1';

describe('generateQr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encodes the URL it is given, unchanged, as an SVG', async () => {
    await generateQr(URL_WITH_QUERY);

    expect(toString).toHaveBeenCalledTimes(1);
    expect(toString).toHaveBeenCalledWith(URL_WITH_QUERY, QR_OPTIONS);
    expect(QR_OPTIONS.type).toBe('svg');
  });

  it("returns the encoder's SVG string", async () => {
    await expect(generateQr(URL_WITH_QUERY)).resolves.toBe('<svg>fake</svg>');
  });

  it('propagates an encoder failure instead of returning empty markup', async () => {
    // Rendering "" would look like a blank QR the author might print anyway.
    toString.mockRejectedValueOnce(new Error('data too long'));

    await expect(generateQr(URL_WITH_QUERY)).rejects.toThrow(/data too long/);
  });
});

describe('renderQrSvg', () => {
  it('replaces the host contents with the given SVG markup', () => {
    const host = document.createElement('div');
    host.innerHTML = '<span>stale</span>';

    renderQrSvg(host, '<svg>fresh</svg>');

    expect(host.innerHTML).toBe('<svg>fresh</svg>');
  });
});
