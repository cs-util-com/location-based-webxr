// The protect prototype's picture Worker: a model's images re-encoded at
// one picture step the way the editor's picture device does
// (createImageBitmap with a high-quality resize, an OffscreenCanvas,
// convertToBlob), so the bytes are the bytes the shelf would write. Jobs
// run one after the other, the one the author chose first; a made step
// keeps its files, and the page asks for the pictures of the step it shows.
import { pictureFormat } from "./protect-sizes.js";

const DECODE = {
  imageOrientation: "from-image",
  colorSpaceConversion: "none",
  premultiplyAlpha: "none",
};
const PNG = "image/png";
const queue = [];
const made = new Map(); // key -> [{ index, blob, kept }]
let images = [];
let busy = false;

function fit(width, height, side) {
  const longest = Math.max(width, height);
  if (longest <= side) {
    return { width, height };
  }
  const s = side / longest;
  return {
    width: Math.max(1, Math.round(width * s)),
    height: Math.max(1, Math.round(height * s)),
  };
}

async function encode(image, side, webp) {
  if (!image.rewritable) {
    return { index: image.index, blob: image.blob, kept: true };
  }
  const bitmap = await createImageBitmap(image.blob, DECODE);
  try {
    const size = fit(bitmap.width, bitmap.height, side);
    const format = pictureFormat(image.use, image.mime, webp);
    const resized =
      size.width !== bitmap.width || size.height !== bitmap.height;
    if (!resized && format.type === PNG && image.mime === PNG) {
      return { index: image.index, blob: image.blob, kept: true };
    }
    const small = resized
      ? await createImageBitmap(bitmap, {
          resizeWidth: size.width,
          resizeHeight: size.height,
          resizeQuality: "high",
          premultiplyAlpha: "none",
        })
      : null;
    try {
      const canvas = new OffscreenCanvas(size.width, size.height);
      canvas.getContext("2d").drawImage(small ?? bitmap, 0, 0);
      const blob = await canvas.convertToBlob(format);
      // A re-encode that is not smaller keeps the original bytes.
      if (!resized && blob.size >= image.blob.size) {
        return { index: image.index, blob: image.blob, kept: true };
      }
      return { index: image.index, blob, kept: false };
    } finally {
      small?.close();
    }
  } finally {
    bitmap.close();
  }
}

async function run(job) {
  const out = [];
  for (let i = 0; i < images.length; i++) {
    out.push(await encode(images[i], job.side, job.webp));
    self.postMessage({
      type: "progress",
      key: job.key,
      done: (i + 1) / images.length,
    });
  }
  made.set(job.key, out);
  self.postMessage({
    type: "made",
    key: job.key,
    bytes: out.reduce((s, o) => s + o.blob.size, 0),
  });
}

async function pump() {
  if (busy) {
    return;
  }
  busy = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      if (made.has(job.key)) {
        continue;
      }
      try {
        await run(job);
      } catch (error) {
        self.postMessage({
          type: "failed",
          key: job.key,
          reason: String(error?.message ?? error),
        });
      }
    }
  } finally {
    busy = false;
  }
}

async function pictures(key, ticket) {
  const files = made.get(key);
  if (!files) {
    return;
  }
  const bitmaps = [];
  for (const f of files) {
    bitmaps.push({
      index: f.index,
      bitmap: await createImageBitmap(f.blob, DECODE),
    });
  }
  self.postMessage(
    { type: "pictures", key, ticket, bitmaps },
    bitmaps.map((b) => b.bitmap),
  );
}

self.addEventListener("message", (event) => {
  const m = event.data;
  if (m?.type === "images") {
    images = m.images;
    queue.length = 0;
    made.clear();
  } else if (m?.type === "jobs") {
    queue.splice(0, queue.length, ...m.jobs);
    void pump();
  } else if (m?.type === "pictures") {
    void pictures(m.key, m.ticket);
  }
});
