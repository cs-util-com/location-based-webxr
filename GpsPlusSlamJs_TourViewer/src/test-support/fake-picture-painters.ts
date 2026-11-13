/** Picture painters for node tests: no canvas, each painted thing a
 *  sized stand-in, and every call recorded. */
import type {
  PaintedPanel,
  PicturePainters,
  PlateWords,
  TagWords,
} from "../kinds/picture/picture-paint.js";

/** A plate's fixed height (m) in these tests. */
const FAKE_PLATE_HEIGHT_M = 0.3;

export function fakePicturePainters(): {
  painters: PicturePainters;
  painted: {
    plates: PlateWords[];
    tags: TagWords[];
    mats: number;
    shadows: number;
  };
} {
  const painted = {
    plates: [] as PlateWords[],
    tags: [] as TagWords[],
    mats: 0,
    shadows: 0,
  };
  const image = (w: number, h: number) =>
    ({ width: w, height: h }) as unknown as HTMLCanvasElement;
  return {
    painted,
    painters: {
      plate(words, widthM): PaintedPanel {
        painted.plates.push(words);
        return {
          image: image(100, 30),
          widthM,
          heightM: FAKE_PLATE_HEIGHT_M,
        };
      },
      mat() {
        painted.mats++;
        return image(100, 100);
      },
      tag(words) {
        painted.tags.push(words);
        return image(62, 21);
      },
      shadow() {
        painted.shadows++;
        return image(128, 128);
      },
    },
  };
}
