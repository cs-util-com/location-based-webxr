/**
 * Counts the pixels of a PNG screenshot that wear the design system's accent
 * (`#f2971f` — red high, green mid, blue low), decoding the PNG in the page
 * so the check stays dependency-free (no node PNG library).
 *
 * The band is the ONE discriminator both HUD pixel specs share: the
 * procedural ring/cone are tinted with the accent, and the diamond sprite's
 * centre dot is filled with it. Nothing else in the simulator view is
 * orange — background #222, grid greys, waypoint markers green, labels
 * white — and the band is wide enough for antialiased edges blending toward
 * #222 (which keep the hue) while excluding white text (green too high) and
 * the retired red tint 0xff3b30 (green too low).
 */
export async function countAccentPixels(page, pngBuffer) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 180 && g > 100 && g < 190 && b < 90) count += 1;
    }
    return count;
  }, pngBuffer.toString("base64"));
}
