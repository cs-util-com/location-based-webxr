// Throwaway prototype: the on-device character library, shared by the
// editor page (index.html) and the character maker (maker.html).
//
// - Storage: characters/<libraryId>/ with frames.png, image.png and
//   character.json, in the origin-private file system when the browser has
//   it, else in localStorage. Both pages are on one origin, so the maker in
//   the editor's dialog, the maker in another tab and the editor all see the
//   same library. character.json is written LAST: a folder without it is an
//   interrupted save, which the list skips and the next save tidies up.
// - There is no message between the pages. The editor reads the library
//   again when the maker's dialog closes and when its tab comes back to the
//   front.
// - The exchange file is the sheet PNG with the record in a tEXt chunk.
// - The stand-in characters are drawn here; there is no image AI.
(function () {
  "use strict";

  const FORMAT = 1;
  const TEXT_KEY = "tour-character";
  const CELL_W = 512;
  const CELL_H = 1024;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------ the store
  function opfsStore(dir) {
    return {
      kind: "opfs",
      async ids() {
        const out = [];
        for await (const [name, h] of dir.entries())
          if (h.kind === "directory") out.push(name);
        return out;
      },
      async read(id, file) {
        try {
          const d = await dir.getDirectoryHandle(id);
          const f = await d.getFileHandle(file);
          return await f.getFile();
        } catch {
          return null;
        }
      },
      async write(id, file, blob) {
        const d = await dir.getDirectoryHandle(id, { create: true });
        const f = await d.getFileHandle(file, { create: true });
        const w = await f.createWritable();
        await w.write(blob);
        await w.close();
      },
      async remove(id) {
        await dir.removeEntry(id, { recursive: true });
      },
      async clear() {
        for (const id of await this.ids()) await this.remove(id);
      },
    };
  }

  const LS = "charlib1:fs:";
  const mem = new Map();
  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return mem.get(k) ?? null;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      if (e && e.name === "QuotaExceededError")
        throw new Error("this browser's storage is full", { cause: e });
      mem.set(k, v);
    }
  }
  function lsKeys() {
    try {
      return Object.keys(localStorage);
    } catch {
      return [...mem.keys()];
    }
  }
  function lsDel(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      // storage unavailable: nothing to remove
    }
    mem.delete(k);
  }
  const blobToDataUrl = (b) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(b);
    });
  const localStore = {
    kind: "local",
    async ids() {
      const s = new Set();
      for (const k of lsKeys())
        if (k.startsWith(LS)) s.add(k.slice(LS.length).split("/")[0]);
      return [...s];
    },
    async read(id, file) {
      const v = lsGet(LS + id + "/" + file);
      if (!v) return null;
      return (await fetch(v)).blob();
    },
    async write(id, file, blob) {
      lsSet(LS + id + "/" + file, await blobToDataUrl(blob));
    },
    async remove(id) {
      for (const k of lsKeys()) if (k.startsWith(LS + id + "/")) lsDel(k);
    },
    async clear() {
      for (const k of lsKeys()) if (k.startsWith(LS)) lsDel(k);
    },
  };

  let storeP = null;
  function store() {
    if (!storeP)
      storeP = (async () => {
        try {
          if (!navigator.storage || !navigator.storage.getDirectory)
            return localStore;
          const root = await navigator.storage.getDirectory();
          const dir = await root.getDirectoryHandle("characters", {
            create: true,
          });
          const probe = await dir.getFileHandle(".probe", { create: true });
          if (!probe.createWritable) return localStore;
          await dir.removeEntry(".probe");
          return opfsStore(dir);
        } catch {
          return localStore;
        }
      })();
    return storeP;
  }

  // ------------------------------------------------------------ the library
  const newId = () =>
    "c" +
    Date.now().toString(36) +
    Math.floor(Math.random() * 1e6).toString(36);

  async function list() {
    const s = await store();
    const entries = [];
    let interrupted = 0;
    for (const id of await s.ids()) {
      const f = await s.read(id, "character.json");
      if (!f) {
        interrupted++;
        continue;
      }
      try {
        const rec = JSON.parse(await f.text());
        if (rec && rec.libraryId) entries.push(rec);
        else interrupted++;
      } catch {
        interrupted++;
      }
    }
    entries.sort((a, b) => (a.createdAtIso < b.createdAtIso ? 1 : -1));
    return { entries, interrupted };
  }

  async function nextGuideName() {
    const { entries } = await list();
    let n = 1;
    const names = new Set(entries.map((e) => e.name));
    while (names.has("Guide " + n)) n++;
    return "Guide " + n;
  }

  async function tidy() {
    const s = await store();
    let n = 0;
    for (const id of await s.ids())
      if (!(await s.read(id, "character.json"))) {
        await s.remove(id);
        n++;
      }
    return n;
  }

  // frames and image are Blobs (PNG). Returns the record.
  async function save({ name, steady, describedAs, frames, image, from }) {
    const s = await store();
    await tidy();
    const clean = String(name || "").trim().slice(0, 40);
    const rec = {
      format: FORMAT,
      libraryId: newId(),
      name: clean || (await nextGuideName()),
      autoName: !clean,
      createdAtIso: new Date().toISOString(),
      steady: !!steady,
      describedAs: describedAs || "",
      tool: from || "character maker",
    };
    await s.write(rec.libraryId, "frames.png", frames);
    await s.write(rec.libraryId, "image.png", image);
    await sleep(350); // a real write of two pictures is not instant on a phone
    await s.write(
      rec.libraryId,
      "character.json",
      new Blob([JSON.stringify(rec)], { type: "application/json" }),
    );
    return rec;
  }

  async function readRecord(id) {
    const s = await store();
    const f = await s.read(id, "character.json");
    if (!f) throw new Error("this character is no longer on this device");
    return JSON.parse(await f.text());
  }

  async function rename(id, name) {
    const clean = String(name || "").trim();
    if (!clean) throw new Error("a name needs at least one letter");
    if (clean.length > 40) throw new Error("a name can have up to 40 letters");
    const s = await store();
    const rec = await readRecord(id);
    rec.name = clean;
    rec.autoName = false;
    await sleep(150);
    await s.write(
      id,
      "character.json",
      new Blob([JSON.stringify(rec)], { type: "application/json" }),
    );
    return rec;
  }

  async function remove(id) {
    const s = await store();
    await sleep(150);
    await s.remove(id);
  }

  async function files(id) {
    const s = await store();
    return {
      record: await readRecord(id),
      frames: await s.read(id, "frames.png"),
      image: await s.read(id, "image.png"),
    };
  }

  // ------------------------------------------------------------ PNG chunks
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++)
      c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  const isPng = (u8) => SIG.every((b, i) => u8[i] === b);
  const isJpeg = (u8) => u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff;
  function chunks(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const out = [];
    let p = 8;
    while (p + 12 <= u8.length) {
      const len = dv.getUint32(p);
      const type = String.fromCharCode(...u8.subarray(p + 4, p + 8));
      if (p + 12 + len > u8.length) throw new Error("cut-off PNG");
      out.push({ type, start: p, data: u8.subarray(p + 8, p + 8 + len) });
      p += 12 + len;
      if (type === "IEND") break;
    }
    return out;
  }
  // the record as ASCII-only JSON, so a tEXt chunk (Latin-1) carries any name
  const asciiJson = (o) =>
    JSON.stringify(o).replace(
      /[\u007f-￿]/g,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    );
  function withText(u8, key, text) {
    const end = chunks(u8).find((c) => c.type === "IEND");
    const body = new TextEncoder().encode(key + "\0" + text);
    const chunk = new Uint8Array(12 + body.length);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, body.length);
    chunk.set([116, 69, 88, 116], 4); // "tEXt"
    chunk.set(body, 8);
    dv.setUint32(8 + body.length, crc32(chunk.subarray(4, 8 + body.length)));
    const out = new Uint8Array(u8.length + chunk.length);
    out.set(u8.subarray(0, end.start), 0);
    out.set(chunk, end.start);
    out.set(u8.subarray(end.start), end.start + chunk.length);
    return out;
  }
  function readText(list, key) {
    for (const c of list) {
      if (c.type !== "tEXt") continue;
      const s = new TextDecoder("latin1").decode(c.data);
      const z = s.indexOf("\0");
      if (z > 0 && s.slice(0, z) === key) return s.slice(z + 1);
    }
    return null;
  }

  // the exchange file: the sheet with the record inside
  async function exchangeFile(id) {
    const f = await files(id);
    const u8 = new Uint8Array(await f.frames.arrayBuffer());
    const { libraryId: _libraryId, ...rest } = f.record;
    const out = withText(u8, TEXT_KEY, asciiJson(rest));
    const safe = f.record.name.replace(/[^\w\- ]+/g, "").trim() || "character";
    return new File([out], safe + ".png", { type: "image/png" });
  }

  // ------------------------------------------------------------ "Import character..."
  // Never guesses: a damaged copy is refused with plain words.
  class Refusal extends Error {
    constructor(title, words) {
      super(title);
      this.title = title;
      this.words = words;
    }
  }
  const LOST_ALPHA = () =>
    new Refusal(
      "This copy lost its transparency",
      "Messengers often turn a picture into a photo and fill in its see-through background. Send the character as a file, not as a photo, and import that file.",
    );
  const NOT_SHEET = (more) =>
    new Refusal(
      "This is not a character sheet",
      more ||
        "A character file is a PNG picture saved by the character maker: four poses side by side, twice as wide as it is high.",
    );

  async function inspect(file) {
    if (!file) throw NOT_SHEET();
    const u8 = new Uint8Array(await file.arrayBuffer());
    if (isJpeg(u8)) throw LOST_ALPHA();
    if (!isPng(u8)) {
      if ((file.type || "").startsWith("image/")) throw NOT_SHEET();
      throw new Refusal(
        "This file is not a picture",
        "Choose the PNG file of a character that the character maker saved.",
      );
    }
    let list;
    try {
      list = chunks(u8);
    } catch {
      throw new Refusal(
        "This file is damaged",
        "The picture ends too early, probably because it was not fully sent. Ask for the file again.",
      );
    }
    const ihdr = list.find((c) => c.type === "IHDR");
    if (!ihdr) throw NOT_SHEET();
    const dv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, 13);
    const w = dv.getUint32(0);
    const h = dv.getUint32(4);
    const colorType = ihdr.data[9];
    const hasAlpha =
      colorType === 4 || colorType === 6 || list.some((c) => c.type === "tRNS");
    if (!hasAlpha) throw LOST_ALPHA();
    if (w !== 2 * h) throw NOT_SHEET();
    if (w !== 4 * CELL_W || h !== CELL_H)
      throw NOT_SHEET(
        "It has the right shape but not the right size, so it was probably made smaller on the way. Send the original file, not a preview of it.",
      );
    // the record, if it is there
    let record = null;
    let recordNote = "";
    const text = readText(list, TEXT_KEY);
    if (text != null) {
      try {
        record = JSON.parse(text);
      } catch {
        recordNote = "Its name could not be read.";
      }
      if (record && typeof record.format === "number" && record.format > FORMAT)
        throw new Refusal(
          "This character was made by a newer version",
          "Open the newest version of the character maker and import it there.",
        );
      if (record && typeof record.format !== "number") {
        record = null;
        recordNote = "Its name could not be read.";
      }
    }
    // pixels: not fully opaque, and each quarter holds one pose on transparency
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      throw new Refusal(
        "This picture could not be opened",
        "The file may be damaged. Ask for it again.",
      );
    }
    const c = canvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close && bmp.close();
    const d = ctx.getImageData(0, 0, w, h).data;
    let clear = 0;
    for (let i = 3; i < d.length; i += 4 * 13) if (d[i] < 250) clear++;
    if (clear === 0) throw LOST_ALPHA();
    for (let k = 0; k < 4; k++) {
      let figure = 0;
      let rim = 0;
      for (let y = 0; y < h; y += 4)
        for (let x = 0; x < CELL_W; x += 4) {
          const a = d[(y * w + k * CELL_W + x) * 4 + 3];
          if (a < 128) continue;
          figure++;
          if (x < 8 || x >= CELL_W - 8) rim++;
        }
      if (figure < 300 || rim > 40)
        throw NOT_SHEET(
          "Each of its four quarters must hold one whole pose on a see-through background, and this one does not.",
        );
    }
    const frames = [0, 1, 2, 3].map((k) => {
      const f = canvas(CELL_W, CELL_H);
      f.getContext("2d").drawImage(
        c,
        k * CELL_W,
        0,
        CELL_W,
        CELL_H,
        0,
        0,
        CELL_W,
        CELL_H,
      );
      return f;
    });
    const name = record && typeof record.name === "string" ? record.name : "";
    return {
      record,
      recordNote,
      name: name.trim().slice(0, 40),
      frames,
      framesBlob: new Blob([u8], { type: "image/png" }),
      imageBlob: await toPng(frames[0]),
    };
  }

  // ------------------------------------------------------------ drawing helpers
  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  const toPng = (c) =>
    new Promise((res, rej) =>
      c.toBlob(
        (b) => (b ? res(b) : rej(new Error("the picture could not be written"))),
        "image/png",
      ),
    );
  function sheetOf(frames) {
    const c = canvas(CELL_W * 4, CELL_H);
    const ctx = c.getContext("2d");
    frames.forEach((f, i) => ctx.drawImage(f, i * CELL_W, 0, CELL_W, CELL_H));
    return c;
  }
  async function framesFromBlob(blob) {
    const bmp = await createImageBitmap(blob);
    const cw = bmp.width / 4;
    const out = [0, 1, 2, 3].map((k) => {
      const f = canvas(CELL_W, CELL_H);
      f.getContext("2d").drawImage(
        bmp,
        k * cw,
        0,
        cw,
        bmp.height,
        0,
        0,
        CELL_W,
        CELL_H,
      );
      return f;
    });
    bmp.close && bmp.close();
    return out;
  }

  // the four outdoor backdrops, chosen by hand; "checks" shows transparency
  const BACKDROPS = [
    { id: "meadow", label: "Meadow" },
    { id: "autumn", label: "Autumn path" },
    { id: "city", label: "City stone" },
    { id: "snow", label: "Snow and sky" },
  ];
  const SKY_GROUND = {
    meadow: [
      ["#cfe3ee", "#eef3e6"],
      "#9aa77e",
      ["#8fb36b", "#5f8a45"],
    ],
    autumn: [
      ["#f3d9b8", "#f7ecd9"],
      "#b0794a",
      ["#c0763a", "#7a4524"],
    ],
    city: [
      ["#c9d1d8", "#e9ecee"],
      "#8a8d90",
      ["#a9aaa8", "#6f7174"],
    ],
    snow: [
      ["#9cc4e8", "#dcebf7"],
      "#c9d6e2",
      ["#f6f9fc", "#dbe4ee"],
    ],
  };
  function paintBackdrop(ctx, W, H, kind) {
    if (kind === "checks") {
      const s = 16;
      for (let y = 0; y < H; y += s)
        for (let x = 0; x < W; x += s) {
          ctx.fillStyle = (x / s + y / s) % 2 ? "#d9d9d9" : "#f4f4f4";
          ctx.fillRect(x, y, s, s);
        }
      return;
    }
    const [sky, horizon, ground] = SKY_GROUND[kind] || SKY_GROUND.meadow;
    const g1 = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    g1.addColorStop(0, sky[0]);
    g1.addColorStop(1, sky[1]);
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = horizon;
    ctx.fillRect(0, H * 0.6, W, H * 0.06);
    const g2 = ctx.createLinearGradient(0, H * 0.62, 0, H);
    g2.addColorStop(0, ground[0]);
    g2.addColorStop(1, ground[1]);
    ctx.fillStyle = g2;
    ctx.fillRect(0, H * 0.64, W, H);
  }
  // CSS for a list thumbnail behind a transparent figure
  const MEADOW_CSS =
    "linear-gradient(#cfe3ee, #eef3e6 60%, #9aa77e 60%, #9aa77e 64%, #8fb36b 64%, #5f8a45)";

  // ------------------------------------------------------------ the stand-in guides
  // A flat cartoon figure in design units: 300 wide, 800 high, feet at y = 800.
  // look: { coat, skin, legs, boots, head: "hat" | "ears" | "beanie", hat }
  const INK = "#1f1b16";
  function fs(ctx, fill, lw = 8) {
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  function limb(ctx, p, wd, col) {
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    ctx.quadraticCurveTo(p[1][0], p[1][1], p[2][0], p[2][1]);
    ctx.lineCap = "round";
    ctx.strokeStyle = INK;
    ctx.lineWidth = wd + 14;
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = wd;
    ctx.stroke();
  }
  function disc(ctx, x, y, r, col, lw = 7) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    fs(ctx, col, lw);
  }
  function openHand(ctx, x, y, rot, skin) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    for (const fx of [-15, -5, 5, 15]) {
      ctx.beginPath();
      ctx.roundRect(fx - 5, -50, 10, 34, 5);
      fs(ctx, skin, 5);
    }
    ctx.beginPath();
    ctx.roundRect(-22, -22, 44, 40, 14);
    fs(ctx, skin, 6);
    ctx.beginPath();
    ctx.roundRect(-34, -14, 14, 26, 7);
    fs(ctx, skin, 5);
    ctx.restore();
  }
  // wobble > 0 redraws the body a little differently per pose, as a painting AI does
  function drawGuide(ctx, cx, baseY, H, pose, look, wobble = 0) {
    const u = H / 800;
    const L = { ...LOOKS.fox, ...look };
    const wb = wobble * [0, 1, -0.9, 0.4][pose];
    ctx.save();
    ctx.translate(cx, baseY - H);
    ctx.scale(u, u);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const x of [-52, 12]) {
      ctx.beginPath();
      ctx.roundRect(x + wb * 0.6, 560, 40, 200, 12);
      fs(ctx, L.legs);
    }
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 36, 768, 44, 26, 0, 0, Math.PI * 2);
      fs(ctx, L.boots);
    }
    limb(
      ctx,
      [
        [-72, 320],
        [-118 - wb * 1.6, 440],
        [-104 - wb, 556],
      ],
      42,
      L.coat,
    );
    disc(ctx, -104 - wb, 562, 24, L.skin);
    if (pose === 3) {
      limb(
        ctx,
        [
          [72, 320],
          [168, 264],
          [230, 206],
        ],
        42,
        L.coat,
      );
      openHand(ctx, 244, 190, 0.85, L.skin);
    } else {
      limb(
        ctx,
        [
          [72, 320],
          [118 + wb * 1.6, 440],
          [104 + wb, 556],
        ],
        42,
        L.coat,
      );
      disc(ctx, 104 + wb, 562, 24, L.skin);
    }
    ctx.beginPath();
    ctx.moveTo(-78, 300);
    ctx.quadraticCurveTo(0, 282, 78, 300);
    ctx.lineTo(104 + wb * 1.4, 600);
    ctx.quadraticCurveTo(0, 622 + wb, -104 - wb * 1.4, 600);
    ctx.closePath();
    fs(ctx, L.coat);
    ctx.beginPath();
    ctx.rect(-94, 466 + wb * 0.8, 188, 30);
    fs(ctx, "#6b4a2b", 6);
    ctx.beginPath();
    ctx.rect(-16 + wb, 462 + wb * 0.8, 32, 38);
    fs(ctx, "#e3b341", 6);
    // head
    if (L.head === "ears")
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 92, 120);
        ctx.lineTo(s * 74, 22);
        ctx.lineTo(s * 26, 84);
        ctx.closePath();
        fs(ctx, L.skin, 7);
        ctx.beginPath();
        ctx.moveTo(s * 78, 100);
        ctx.lineTo(s * 70, 48);
        ctx.lineTo(s * 44, 82);
        ctx.closePath();
        ctx.fillStyle = "#3a2a1c";
        ctx.fill();
      }
    ctx.beginPath();
    ctx.arc(0, 172, 100, 0, Math.PI * 2);
    fs(ctx, L.skin);
    if (L.head === "ears") {
      ctx.beginPath();
      ctx.ellipse(0, 214, 56, 44, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#fff6ea";
      ctx.fill();
    }
    ctx.fillStyle = "rgba(214,110,90,0.45)";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 62, 200, 16, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 38, 160, 21, 25, 0, 0, Math.PI * 2);
      fs(ctx, "#ffffff", 6);
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(s * 38 + 3, 166, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s * 38 + 6, 161, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, 192, 12, 9, 0, 0, Math.PI * 2);
    fs(ctx, L.head === "ears" ? INK : "#d99772", 5);
    if (pose === 1) {
      ctx.beginPath();
      ctx.ellipse(0, 226, 22, 11, 0, 0, Math.PI * 2);
      fs(ctx, "#5a1d1a", 6);
    } else if (pose === 2) {
      ctx.beginPath();
      ctx.ellipse(0, 226, 26, 24, 0, 0, Math.PI * 2);
      fs(ctx, "#5a1d1a", 6);
      ctx.fillStyle = "#d65a5a";
      ctx.beginPath();
      ctx.ellipse(0, 240, 14, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(-22, 218);
      ctx.quadraticCurveTo(0, 236, 22, 218);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 7;
      ctx.stroke();
    }
    if (L.head === "hat") {
      ctx.beginPath();
      ctx.ellipse(0, 92, 148, 28, 0, 0, Math.PI * 2);
      fs(ctx, L.hat);
      ctx.beginPath();
      ctx.moveTo(-82, 90);
      ctx.quadraticCurveTo(-78, 10, 0, 10);
      ctx.quadraticCurveTo(78, 10, 82, 90);
      ctx.closePath();
      fs(ctx, L.hat);
      ctx.beginPath();
      ctx.rect(-80, 62, 160, 20);
      fs(ctx, "#5b3a1a", 5);
    } else if (L.head === "beanie") {
      ctx.beginPath();
      ctx.moveTo(-96, 128);
      ctx.quadraticCurveTo(-96, 40, 0, 40);
      ctx.quadraticCurveTo(96, 40, 96, 128);
      ctx.closePath();
      fs(ctx, L.hat);
      disc(ctx, 0, 34, 20, "#f4efe6", 6);
    }
    ctx.restore();
  }
  const LOOKS = {
    fox: {
      coat: "#2f8f74",
      skin: "#e8873a",
      legs: "#5b4632",
      boots: "#3a2a1c",
      head: "ears",
      hat: "#a8732f",
    },
    keeper: {
      coat: "#e2b52f",
      skin: "#f2c79b",
      legs: "#3c4a6b",
      boots: "#2a2a30",
      head: "beanie",
      hat: "#b8392b",
    },
    ranger: {
      coat: "#3f6fb0",
      skin: "#d9a477",
      legs: "#4a3b2a",
      boots: "#2b2118",
      head: "hat",
      hat: "#7a5a32",
    },
  };
  // a look from any description, so "your" made-up picture differs from the samples
  function lookFor(text) {
    let h = 0;
    for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const coats = ["#2f8f74", "#b8392b", "#3f6fb0", "#7b4ea3", "#c27b1c"];
    const skins = ["#e8873a", "#f2c79b", "#d9a477", "#a8784f", "#c9c3b8"];
    const heads = ["ears", "hat", "beanie"];
    return {
      coat: coats[h % coats.length],
      skin: skins[(h >>> 3) % skins.length],
      legs: "#4a3b2a",
      boots: "#2b2118",
      head: heads[(h >>> 6) % heads.length],
      hat: ["#a8732f", "#355e3b", "#b8392b"][(h >>> 9) % 3],
    };
  }
  // four cells as the maker would save them (no cut needed)
  function drawFrames(look) {
    return [0, 1, 2, 3].map((p) => {
      const c = canvas(CELL_W, CELL_H);
      drawGuide(c.getContext("2d"), CELL_W / 2, CELL_H * 0.96, 640, p, look);
      return c;
    });
  }
  // a stand-in for the image AI's answer: four poses in a row on white, each
  // with a soft grey ground shadow (as the AI drew one although the prompt
  // said no), noise, and a JPEG round trip
  function mulberry(a) {
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  async function aiPicture(look, opt = {}) {
    const W = 1536;
    const H = 1024;
    const c = canvas(W, H);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const clear = !!opt.transparent;
    if (!clear) {
      ctx.fillStyle = "#fdfdfd";
      ctx.fillRect(0, 0, W, H);
    }
    const xs = opt.three ? [270, 760, 1230] : [200, 570, 925, 1250];
    const poses = opt.three ? [0, 1, 3] : [0, 1, 2, 3];
    if (opt.shadow !== false && !clear)
      for (const x of xs) {
        const g = ctx.createRadialGradient(x, 0, 0, x, 0, 175);
        const k = opt.shadowCore || 226; // the measured AI shadow was about 229 on 254
        g.addColorStop(0, `rgb(${k},${k},${k})`);
        g.addColorStop(0.7, `rgb(${k + 6},${k + 6},${k + 6})`);
        g.addColorStop(1, "rgba(253,253,253,0)");
        ctx.save();
        ctx.translate(0, 972);
        ctx.scale(1, 0.13);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, 0, 175, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    xs.forEach((x, i) =>
      drawGuide(ctx, x, 975, 760, poses[i], look, opt.wobble || 0),
    );
    if (!clear) {
      const img = ctx.getImageData(0, 0, W, H);
      const d = img.data;
      const rnd = mulberry(opt.seed || 7);
      for (let i = 0; i < d.length; i += 4) {
        const n = (rnd() - 0.5) * 12;
        d[i] += n;
        d[i + 1] += n + (rnd() - 0.5) * 3;
        d[i + 2] += n + (rnd() - 0.5) * 3;
      }
      ctx.putImageData(img, 0, 0);
    }
    return new Promise((res) =>
      c.toBlob(res, clear ? "image/png" : "image/jpeg", 0.86),
    );
  }

  // ------------------------------------------------------------ prepared files
  // Files to try "Import character..." with, made here so nothing is downloaded.
  const PREPARED = [
    { id: "good", label: "A character file" },
    { id: "noname", label: "A sheet without its name inside" },
    { id: "messenger", label: "A copy sent through a messenger (JPEG)" },
    { id: "opaque", label: "A picture without transparency" },
    { id: "small", label: "A copy made smaller on the way" },
    { id: "photo", label: "The image AI's picture itself" },
    { id: "newer", label: "A file from a newer version" },
  ];
  async function preparedFile(kind) {
    const look = { ...LOOKS.fox, coat: "#7b4ea3", head: "hat", hat: "#355e3b" };
    const sheet = sheetOf(drawFrames(look));
    const rec = {
      format: FORMAT,
      name: "Fennel",
      createdAtIso: new Date().toISOString(),
      steady: false,
      describedAs: "a fox in a purple coat with a green hat",
      tool: "character maker",
    };
    const png = async (c) => new Uint8Array(await (await toPng(c)).arrayBuffer());
    const file = (bytes, name, type = "image/png") =>
      new File([bytes], name, { type });
    if (kind === "good" || kind === "newer") {
      const r = kind === "newer" ? { ...rec, format: FORMAT + 1 } : rec;
      return file(
        withText(await png(sheet), TEXT_KEY, asciiJson(r)),
        "Fennel.png",
      );
    }
    if (kind === "noname") return file(await png(sheet), "IMG_2041.png");
    if (kind === "messenger" || kind === "opaque") {
      const flat = canvas(sheet.width, sheet.height);
      const ctx = flat.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(sheet, 0, 0);
      if (kind === "opaque") return file(await png(flat), "Fennel.png");
      const jpg = await new Promise((r) => flat.toBlob(r, "image/jpeg", 0.8));
      return file(jpg, "IMG-20261108-WA0007.jpg", "image/jpeg");
    }
    if (kind === "small") {
      const half = canvas(sheet.width / 2, sheet.height / 2);
      half.getContext("2d").drawImage(sheet, 0, 0, half.width, half.height);
      return file(await png(half), "Fennel (preview).png");
    }
    const ai = await aiPicture(look, { transparent: true });
    return file(ai, "Generated image.png");
  }

  // ------------------------------------------------------------ first visit
  const SEEDED = "charlib1:seeded";
  async function seedOnce() {
    try {
      if (localStorage.getItem(SEEDED)) return false;
      localStorage.setItem(SEEDED, "1");
    } catch {
      return false;
    }
    const day = 864e5;
    const s = await store();
    const put = async (name, look, ageDays, autoName, describedAs) => {
      const fr = drawFrames(look);
      const rec = {
        format: FORMAT,
        libraryId: newId(),
        name,
        autoName,
        createdAtIso: new Date(Date.now() - ageDays * day).toISOString(),
        steady: false,
        describedAs,
        tool: "character maker",
      };
      await s.write(rec.libraryId, "frames.png", await toPng(sheetOf(fr)));
      await s.write(rec.libraryId, "image.png", await toPng(fr[0]));
      await s.write(
        rec.libraryId,
        "character.json",
        new Blob([JSON.stringify(rec)], { type: "application/json" }),
      );
    };
    await put(
      "Ranger Rosa",
      LOOKS.ranger,
      3,
      false,
      "a park ranger in a blue coat",
    );
    await put(
      "Pip",
      LOOKS.fox,
      2,
      false,
      "a fox park ranger, flat cartoon style",
    );
    await put(
      "Guide 3",
      LOOKS.keeper,
      0.2,
      true,
      "a lighthouse keeper in a yellow coat",
    );
    // an interrupted save: the pictures were written, the record never was
    await s.write(
      "c-interrupted",
      "frames.png",
      await toPng(sheetOf(drawFrames(LOOKS.fox))),
    );
    return true;
  }
  async function resetAll() {
    const s = await store();
    await s.clear();
    try {
      for (const k of Object.keys(localStorage))
        if (k.startsWith("charlib1:")) localStorage.removeItem(k);
    } catch {
      // storage unavailable: nothing to remove
    }
  }

  // ------------------------------------------------------------ small words
  function when(iso) {
    const t = new Date(iso);
    const days = Math.floor((Date.now() - t.getTime()) / 864e5);
    const time = t.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (days < 1 && new Date().getDate() === t.getDate())
      return "made today, " + time;
    if (days < 2) return "made yesterday";
    return "made " + days + " days ago";
  }

  window.CharLib = {
    FORMAT,
    CELL_W,
    CELL_H,
    BACKDROPS,
    LOOKS,
    MEADOW_CSS,
    Refusal,
    store,
    list,
    save,
    rename,
    remove,
    files,
    tidy,
    exchangeFile,
    inspect,
    withText,
    asciiJson,
    TEXT_KEY,
    canvas,
    toPng,
    sheetOf,
    framesFromBlob,
    paintBackdrop,
    drawGuide,
    drawFrames,
    lookFor,
    aiPicture,
    PREPARED,
    preparedFile,
    seedOnce,
    resetAll,
    when,
    sleep,
  };
})();
