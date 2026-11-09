// A trivial kind, to show the seam and nothing else: a sign that asks, a small lamp to tap,
// an arrow that points at the tower. A variant replaces this file.
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SphereGeometry,
} from "three";

const FONT = 'Corbel, "Noto Sans", system-ui, sans-serif';

function wrap(g, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export const kind = {
  name: "lamp-sign",

  read(v, _view, tools) {
    return {
      ask: tools.requiredText(v, "ask", { max: 160 }),
      reply: tools.requiredText(v, "reply", { max: 160 }),
      ...tools.optionalText(v, "hint", { max: 120 }),
      showScore: v.showScore === true,
      colour: v.colour === "teal" ? "teal" : "amber",
      sign: { x: v.sign?.x ?? 0, z: v.sign?.z ?? 0 },
    };
  },

  fields: [
    { name: "ask", label: "Question", prose: true },
    { name: "reply", label: "Reply when tapped", prose: true },
    { name: "hint", label: "Hint (optional)" },
    { name: "showScore", label: "Show a score", type: "toggle" },
    {
      name: "colour",
      label: "Lamp colour",
      type: "choice",
      options: ["amber", "teal"],
    },
    { name: "sign", label: "Sign", type: "place" },
  ],

  world(block, env) {
    const lampColour = block.colour === "teal" ? "#2dd4bf" : "#fb923c";
    const object = new Group();
    const signGroup = new Group();
    signGroup.position.set(block.sign.x, 0, block.sign.z);

    const stone = new MeshLambertMaterial({ color: "#6d7278" });
    const postGeo = new BoxGeometry(0.1, 2, 0.1);
    const post = new Mesh(postGeo, stone);
    post.position.y = 1;

    const tex = env.paintText({
      width: 512,
      height: 256,
      draw(g, w, h) {
        g.fillStyle = "#fbf8f0";
        g.beginPath();
        g.roundRect(4, 4, w - 8, h - 8, 24);
        g.fill();
        g.fillStyle = "#1c2128";
        g.font = `600 44px ${FONT}`;
        g.textBaseline = "top";
        wrap(g, block.ask, w - 56)
          .slice(0, 4)
          .forEach((line, i) => g.fillText(line, 28, 26 + i * 52));
      },
    });
    const boardMat = new MeshBasicMaterial({ map: tex, transparent: true });
    const boardGeo = new PlaneGeometry(1.4, 0.7);
    const board = new Mesh(boardGeo, boardMat);
    board.position.y = 2.2;
    signGroup.add(post, board);

    // The lamp is small on purpose: the hit area is what makes it tappable.
    const lampMat = new MeshBasicMaterial({ color: lampColour });
    const lampGeo = new SphereGeometry(0.1, 16, 12);
    const lamp = new Mesh(lampGeo, lampMat);
    lamp.position.set(0.9, 1.2, 0);
    lamp.name = "lamp";
    lamp.add(env.hitArea({ radius: 0.45, name: "lamp" }));

    // The arrow reads a named spot of the place: in AR a creator would have set it.
    const { tower } = env.place.anchors;
    const arrowGeo = new ConeGeometry(0.08, 0.3, 12);
    const stemGeo = new CylinderGeometry(0.02, 0.02, 0.4, 8);
    const arrowMat = new MeshBasicMaterial({ color: "#ffffff" });
    const arrow = new Group();
    const tip = new Mesh(arrowGeo, arrowMat);
    tip.position.y = 0.35;
    const stem = new Mesh(stemGeo, arrowMat);
    arrow.add(tip, stem);
    arrow.position.set(-0.9, 1.3, 0);
    arrow.lookAt(tower); // no parent yet, so local and world agree here
    arrow.rotateX(Math.PI / 2);

    object.add(signGroup, lamp, arrow);

    let found = false;
    return {
      object,
      update(frame) {
        // A kind's motion comes from frame.time, so edit (time stopped) is still by itself.
        lamp.position.y = 1.2 + Math.sin(frame.time * 2) * 0.06;
        lamp.scale.setScalar(found ? 1.5 : 1);
        // Facing the viewer needs no allocation: frame.viewer is in this object's own metres.
        board.rotation.y = Math.atan2(
          frame.viewer.x - block.sign.x,
          frame.viewer.z - block.sign.z,
        );
      },
      tap(hit) {
        if (hit.name !== "lamp" || found) return;
        found = true;
        env.sound("right").play();
        env.say(block.reply, { mood: "happy" });
        env.done();
      },
      leave() {
        lampMat.color.set("#7b828a");
      },
      back() {
        lampMat.color.set(lampColour);
      },
      dispose() {
        for (const g of [postGeo, boardGeo, lampGeo, arrowGeo, stemGeo])
          g.dispose();
        for (const m of [stone, boardMat, lampMat, arrowMat]) m.dispose();
        tex.dispose();
      },
    };
  },

  card(block, el, env) {
    env.say(block.ask, { ask: true, eyebrow: "A question" });
    if (block.hint) {
      const hint = document.createElement("p");
      hint.className = "stamp";
      hint.textContent = block.hint;
      el.append(hint);
    }
    if (block.showScore) {
      const score = document.createElement("p");
      score.className = "speaker";
      score.textContent = "10 points";
      el.append(score);
    }
    return { dispose() {} };
  },
};
