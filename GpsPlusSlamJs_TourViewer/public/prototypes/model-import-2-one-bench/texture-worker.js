// The bench's texture Worker: a model's images re-encoded at one texture
// step, exactly as the editor's picture device does (createImageBitmap
// with a high-quality resize, an OffscreenCanvas, convertToBlob), so the
// bytes are the bytes the shelf would write. Jobs queue; the page may
// move a job to the front. Each finished step keeps only its files; the
// page asks for the pictures of the one it shows.

const queue = [];
const made = new Map(); // key -> [{ index, blob, kept }]
let images = []; // [{ index, blob, mime, use, rewritable }]
let busy = false;

const DECODE = {
  imageOrientation: "from-image",
  colorSpaceConversion: "none",
  premultiplyAlpha: "none",
};
const JPEG = "image/jpeg";
const PNG = "image/png";

function formatOf(use, mime, webp) {
  const lossy = webp ? "image/webp" : JPEG;
  if (use.alpha) {
    return { type: PNG, quality: 1 };
  }
  if (use.data) {
    return mime === PNG
      ? { type: PNG, quality: 1 }
      : { type: lossy, quality: 0.92 };
  }
  return { type: lossy, quality: 0.85 };
}

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

async function encodeOne(image, side, webp) {
  if (!image.rewritable) {
    return { index: image.index, blob: image.blob, kept: true };
  }
  const bitmap = await createImageBitmap(image.blob, DECODE);
  try {
    const size = fit(bitmap.width, bitmap.height, side);
    const format = formatOf(image.use, image.mime, webp);
    const resized =
      size.width !== bitmap.width || size.height !== bitmap.height;
    if (!resized && format.type === image.mime && format.type === PNG) {
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

async function runJob(job) {
  const out = [];
  for (let i = 0; i < images.length; i++) {
    out.push(await encodeOne(images[i], job.side, job.webp));
    self.postMessage({
      type: "progress",
      key: job.key,
      done: i + 1,
      of: images.length,
    });
  }
  made.set(job.key, out);
  self.postMessage({
    type: "made",
    key: job.key,
    sizes: out.map((o) => ({
      index: o.index,
      bytes: o.blob.size,
      kept: o.kept,
    })),
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
        await runJob(job);
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
    // The given order replaces the queue's; a step already made is skipped.
    queue.splice(0, queue.length, ...m.jobs);
    void pump();
  } else if (m?.type === "pictures") {
    void pictures(m.key, m.ticket);
  }
});
