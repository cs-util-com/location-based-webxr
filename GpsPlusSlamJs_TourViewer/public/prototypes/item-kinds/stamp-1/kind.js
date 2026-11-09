/**
 * A sample item kind for the item lab (`item-lab.html?kind=stamp-1`): a stamp
 * on a post. Its card says its words at once and shows its picture; where a
 * host has a stage it stands as a figure there, and a tap plays its thud. In
 * the world it is a post with a painted plate, which tips when tapped.
 *
 * The lab's contract, the same halves a kind of the app has:
 * - `read(record)` gives `{ block, problems }`: the record as the kind uses
 *   it, and what it had to fix;
 * - `assets(block)` lists every file `card` or `world` may read;
 * - `card(block, host)` fills the story card through `host` only;
 * - `world(block, env)` gives `{ object, tapTarget, tap, update, dispose }`
 *   in metres, Y up, origin at its foot; it never touches the scene, the
 *   camera, the renderer, the frame loop or `document`;
 * - `fields(view)` lists the editor's fields as data.
 *
 * Imports: three only, by named import, no addons.
 */
import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
} from "three";

/** The longest name and words a plate shows; longer is cut, with a note. */
const NAME_MAX = 40;
const WORDS_MAX = 160;
/** The post (m). */
const POST_HEIGHT_M = 1.1;
const POST_RADIUS_M = 0.04;
/** The plate (m), and its canvas (px). */
const PLATE_W_M = 0.6;
const PLATE_H_M = 0.4;
const PLATE_W_PX = 768;
const PLATE_H_PX = 512;
/** How far a tap tips the plate (rad), and how it sways in play (Hz, rad). */
const TIP_RAD = 0.35;
const SWAY_HZ = 0.25;
const SWAY_RAD = 0.03;

function text(value, max, label, problems) {
  if (typeof value !== "string" || value.trim() === "") return "";
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  problems.push(`${label} cut to ${String(max)} characters`);
  return trimmed.slice(0, max);
}

/** The record as the kind uses it: a name and words, its picture and sound
 *  by asset id (null: none). */
export function read(record) {
  const problems = [];
  const raw = record !== null && typeof record === "object" ? record : {};
  const name = text(raw.name, NAME_MAX, "name", problems);
  if (name === "") problems.push("no name: shown as 'A stamp'");
  return {
    block: {
      kind: "stamp",
      view: "post",
      name: name === "" ? "A stamp" : name,
      words: text(raw.words, WORDS_MAX, "words", problems),
      image: typeof raw.image === "string" ? raw.image : null,
      sound: typeof raw.sound === "string" ? raw.sound : null,
    },
    problems,
  };
}

/** Every file `card` or `world` may read. */
export function assets(block) {
  return [block.image, block.sound].filter((id) => id !== null);
}

/** Show the item: its words first, its files as they load. */
export function card(block, host) {
  host.slots.text.textContent = block.words;
  host.slots.speaker.textContent = block.name;
  host.slots.speaker.hidden = false;
  if (block.image !== null) {
    host.asset(block.image, "stamp", async (blob) => {
      const problem = await host.checkPicture(blob);
      if (problem !== null) return "The stamp is too large to show here.";
      if (!host.showing()) return undefined;
      host.slots.image.src = host.url(blob);
      host.slots.image.alt = block.name;
      host.slots.image.hidden = false;
      const look = {
        view: "speak",
        name: block.name,
        line: block.words,
        voiced: block.sound !== null,
      };
      await host.stage?.stand("stamp", (world, place) =>
        world.showCharacter(place.stationId, blob, place.onWaiting, look),
      );
      return undefined;
    });
  }
  host.stage?.tapTarget({
    bubble: false,
    ...(block.sound === null ? {} : { voice: block.sound }),
  });
}

/** Words on a canvas: the name large, the words wrapped below it. */
function paintPlate(canvas, block) {
  const g = canvas.getContext("2d");
  if (g === null) return;
  g.fillStyle = "#f4ecd8";
  g.fillRect(0, 0, PLATE_W_PX, PLATE_H_PX);
  g.strokeStyle = "#2b3440";
  g.lineWidth = 12;
  g.strokeRect(6, 6, PLATE_W_PX - 12, PLATE_H_PX - 12);
  g.fillStyle = "#1c2329";
  g.font = "bold 64px system-ui, sans-serif";
  g.textBaseline = "top";
  g.fillText(block.name, 40, 40, PLATE_W_PX - 80);
  g.font = "40px system-ui, sans-serif";
  let line = "";
  let y = 140;
  for (const word of block.words.split(/\s+/)) {
    const next = line === "" ? word : `${line} ${word}`;
    if (g.measureText(next).width > PLATE_W_PX - 80 && line !== "") {
      g.fillText(line, 40, y);
      line = word;
      y += 52;
    } else {
      line = next;
    }
  }
  if (line !== "") g.fillText(line, 40, y);
}

/** The stamp in the world: a post and its plate, the plate what a tap is
 *  cast against. In `edit` it stands still. */
export function world(block, env) {
  const object = new Group();
  const post = new Mesh(
    new CylinderGeometry(POST_RADIUS_M, POST_RADIUS_M, POST_HEIGHT_M, 12),
    new MeshLambertMaterial({ color: 0x5a6a78 }),
  );
  post.position.y = POST_HEIGHT_M / 2;
  const canvas = new OffscreenCanvas(PLATE_W_PX, PLATE_H_PX);
  paintPlate(canvas, block);
  const texture = env.canvasTexture(canvas);
  const hinge = new Group();
  hinge.position.y = POST_HEIGHT_M;
  const plate = new Mesh(
    new PlaneGeometry(PLATE_W_M, PLATE_H_M),
    new MeshBasicMaterial({ map: texture }),
  );
  plate.position.y = PLATE_H_M / 2;
  hinge.add(plate);
  object.add(post, hinge);
  let tipped = false;
  return {
    object,
    tapTarget: plate,
    tap() {
      tipped = !tipped;
      hinge.rotation.x = tipped ? -TIP_RAD : 0;
    },
    update(frame) {
      if (env.mode === "edit") return;
      hinge.rotation.z =
        Math.sin(frame.seconds * SWAY_HZ * 2 * Math.PI) * SWAY_RAD;
    },
    dispose() {
      post.geometry.dispose();
      post.material.dispose();
      plate.geometry.dispose();
      plate.material.dispose();
      texture.dispose();
    },
  };
}

const FIELDS = Object.freeze([
  { key: "name", label: "Name", type: "text", max: NAME_MAX },
  { key: "words", label: "Words", type: "text", max: WORDS_MAX },
]);

/** The editor's fields for a view, as data. */
export function fields() {
  return FIELDS;
}
